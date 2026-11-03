import * as THREE from 'three';
import { bake, charMat, Character, CharStyle, Piece, Pose, SHAPES } from './character';
import { floorHeight, groundHeight } from './terrain';
import { addPlatform } from './colliders';
import { state } from './state';
import { sfx } from './audio';
import type { Chaos } from './chaos';
import type { NPC } from './npcs';
import type { Animal } from './animals';
import type { Player } from './player';

/**
 * A steam railway looping around Thistlewick: two trains, four stations, passengers
 * hopping on and off, porters shifting cargo — and anything left standing on the line
 * gets sent flying. Trains never derail; they just keep going.
 */

const { BOX, CYL, BALL } = SHAPES;
const CYL_Z = CYL.clone().rotateX(Math.PI / 2);
const CYL_X = CYL.clone().rotateZ(Math.PI / 2);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]): T => xs[(Math.random() * xs.length) | 0];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const DS = 0.5;               // track sample spacing (m)
const RAIL_TOP = 0.42;        // rail head above the ballast base line
const VMAX = 15;
const ACCEL = 2.2, BRAKE = 1.7;

// ---------- Track ----------
class Track {
  readonly xs: Float32Array; readonly zs: Float32Array; readonly ys: Float32Array;
  readonly tx: Float32Array; readonly tz: Float32Array;
  readonly n: number;
  readonly length: number;

  constructor(points: THREE.Vector3[]) {
    const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
    this.length = curve.getLength();
    this.n = Math.ceil(this.length / DS);
    const pts = curve.getSpacedPoints(this.n);
    const N = this.n;
    this.xs = new Float32Array(N); this.zs = new Float32Array(N); this.ys = new Float32Array(N);
    this.tx = new Float32Array(N); this.tz = new Float32Array(N);
    const ground = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.xs[i] = pts[i].x; this.zs[i] = pts[i].z;
      // Highest ground under the full width of the track.
      let g = -Infinity;
      for (const [ox, oz] of [[0, 0], [1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]]) g = Math.max(g, groundHeight(pts[i].x + ox, pts[i].z + oz));
      ground[i] = g;
    }
    for (let i = 0; i < N; i++) {
      const a = (i + 1) % N, b = (i - 1 + N) % N;
      const dx = this.xs[a] - this.xs[b], dz = this.zs[a] - this.zs[b], l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
    }
    // Smooth gradient that never dips below the ground (an upper envelope).
    let h = Float32Array.from(ground);
    const K = 16;
    for (let it = 0; it < 40; it++) {
      const next = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let k = -K; k <= K; k++) s += h[(i + k + N) % N];
        next[i] = Math.max(ground[i], s / (2 * K + 1));
      }
      h = next;
    }
    for (let i = 0; i < N; i++) this.ys[i] = h[i] + 0.1;
  }

  private idx(s: number): [number, number, number] {
    s = ((s % this.length) + this.length) % this.length;
    const f = s / DS;
    const i = Math.floor(f) % this.n;
    return [i, (i + 1) % this.n, f - Math.floor(f)];
  }
  /** Rail-head position at distance s. */
  pos(s: number, out = new THREE.Vector3()) {
    const [i, j, f] = this.idx(s);
    return out.set(
      this.xs[i] + (this.xs[j] - this.xs[i]) * f,
      this.ys[i] + (this.ys[j] - this.ys[i]) * f + RAIL_TOP,
      this.zs[i] + (this.zs[j] - this.zs[i]) * f,
    );
  }
  tangent(s: number, out = new THREE.Vector3()) {
    const [i] = this.idx(s);
    return out.set(this.tx[i], 0, this.tz[i]);
  }
  /** Closest distance-along-track to a point (coarse + local refine). */
  project(x: number, z: number): { s: number; d: number } {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.n; i += 4) {
      const d = (this.xs[i] - x) ** 2 + (this.zs[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    for (let k = -4; k <= 4; k++) {
      const i = (best + k + this.n) % this.n;
      const d = (this.xs[i] - x) ** 2 + (this.zs[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return { s: best * DS, d: Math.sqrt(bd) };
  }

  /** Extrude a 2D cross-section (x across, y up) along the track. */
  sweep(profile: [number, number][], color: string): THREE.Mesh {
    const N = this.n, P = profile.length;
    const pos = new Float32Array(N * P * 3);
    for (let i = 0; i < N; i++) {
      const rx = this.tz[i], rz = -this.tx[i];
      for (let p = 0; p < P; p++) {
        const [px, py] = profile[p];
        const o = (i * P + p) * 3;
        pos[o] = this.xs[i] + rx * px; pos[o + 1] = this.ys[i] + py; pos[o + 2] = this.zs[i] + rz * px;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      for (let p = 0; p < P - 1; p++) {
        const a = i * P + p, b = i * P + p + 1, c = j * P + p, d = j * P + p + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    return m;
  }
}

// ---------- Rolling stock ----------
type CarKind = 'loco' | 'tender' | 'coach' | 'flat';
const CAR_LEN: Record<CarKind, number> = { loco: 7, tender: 4.6, coach: 9, flat: 7 };
const GAP = 0.7;

function wheels(z: number[], color = '#1e1e22'): Piece[] {
  const p: Piece[] = [];
  for (const wz of z) for (const x of [-0.82, 0.82]) p.push([CYL_X, color, x, 0.12, wz, 0.18, 0.9, 0.9], [CYL_X, '#b8a040', x * 1.12, 0.12, wz, 0.04, 0.3, 0.3]);
  return p;
}
const buffers = (half: number): Piece[] => [
  [BOX, '#2a2a2e', 0, 0.55, half, 2.1, 0.25, 0.12], [CYL_Z, '#888', -0.7, 0.55, half + 0.15, 0.18, 0.18, 0.3], [CYL_Z, '#888', 0.7, 0.55, half + 0.15, 0.18, 0.18, 0.3],
  [BOX, '#2a2a2e', 0, 0.55, -half, 2.1, 0.25, 0.12], [CYL_Z, '#888', -0.7, 0.55, -half - 0.15, 0.18, 0.18, 0.3], [CYL_Z, '#888', 0.7, 0.55, -half - 0.15, 0.18, 0.18, 0.3],
];

interface Livery { body: string; trim: string; boiler: string; coach: string; coachLow: string }
const LIVERIES: Livery[] = [
  { body: '#8a2a24', trim: '#d8b04a', boiler: '#1f3a2c', coach: '#e8dcc0', coachLow: '#7a2a24' },
  { body: '#24506a', trim: '#e0c060', boiler: '#202428', coach: '#d8e2e0', coachLow: '#24506a' },
];

function carGeo(kind: CarKind, L: Livery): THREE.BufferGeometry {
  const h = CAR_LEN[kind] / 2;
  switch (kind) {
    case 'loco': return bake([
      [BOX, '#2a2a2e', 0, 0.45, 0, 2.0, 0.3, 7], ...buffers(3.5),
      [CYL_Z, L.boiler, 0, 1.45, 0.9, 1.75, 1.75, 4.6], [BOX, L.trim, 0, 1.45, 0.2, 1.8, 1.8, 0.1], [BOX, L.trim, 0, 1.45, 1.8, 1.8, 1.8, 0.1],
      [CYL_Z, '#222', 0, 1.45, 3.25, 1.8, 1.8, 0.35], [BOX, '#ffe9a0', 0, 2.2, 3.45, 0.35, 0.35, 0.2],
      [CYL, '#222', 0, 2.75, 2.55, 0.5, 1.1, 0.5], [CYL, '#222', 0, 3.3, 2.55, 0.8, 0.25, 0.8],
      [BALL, L.trim, 0, 2.4, 0.9, 0.7, 0.6, 0.7], [BALL, L.trim, 0, 2.35, -0.3, 0.45, 0.4, 0.45],
      [BOX, L.body, 0, 1.9, -2.25, 2.2, 2.3, 2.4], [BOX, '#2a2a2e', 0, 3.12, -2.25, 2.5, 0.15, 2.8],
      [BOX, '#1d2630', -1.11, 2.35, -2.0, 0.04, 0.6, 0.8], [BOX, '#1d2630', 1.11, 2.35, -2.0, 0.04, 0.6, 0.8],
      [BOX, L.trim, -1.11, 1.2, -2.25, 0.05, 0.12, 2.4], [BOX, L.trim, 1.11, 1.2, -2.25, 0.05, 0.12, 2.4],
      [BOX, L.body, 0, 0.35, 3.85, 1.8, 0.4, 0.5], [BOX, '#555', -1.0, 0.75, 1, 0.3, 0.12, 4], [BOX, '#555', 1.0, 0.75, 1, 0.3, 0.12, 4],
      ...wheels([2.3, 0.7, -0.9, -2.5]),
      [CYL_Z, '#777', -0.95, 0.3, 0.7, 0.08, 0.08, 3.4], [CYL_Z, '#777', 0.95, 0.3, 0.7, 0.08, 0.08, 3.4],
    ]);
    case 'tender': return bake([
      [BOX, '#2a2a2e', 0, 0.45, 0, 2.0, 0.3, 4.6], ...buffers(h),
      [BOX, L.body, 0, 1.35, 0, 2.2, 1.5, 4.3], [BOX, L.trim, 0, 2.1, 0, 2.25, 0.1, 4.35], [BOX, '#161616', 0, 2.15, 0.3, 1.9, 0.3, 3.2], [BALL, '#161616', 0, 2.3, 0.4, 1.6, 0.5, 2.4],
      ...wheels([1.3, -1.3]),
    ]);
    case 'coach': {
      const p: Piece[] = [
        [BOX, '#2a2a2e', 0, 0.45, 0, 2.0, 0.3, 9], ...buffers(h),
        [BOX, L.coach, 0, 1.85, 0, 2.4, 2.2, 8.6], [BOX, L.coachLow, 0, 1.0, 0, 2.42, 0.5, 8.62],
        [BOX, L.trim, 0, 1.3, 0, 2.43, 0.08, 8.63], [BOX, '#3a3a40', 0, 3.02, 0, 2.6, 0.2, 9], [BOX, '#3a3a40', 0, 3.15, 0, 1.8, 0.15, 8.6],
        ...wheels([3.6, 2.6, -2.6, -3.6]),
      ];
      for (let i = 0; i < 5; i++) {
        const z = -3.0 + i * 1.5;
        for (const x of [-1.21, 1.21]) p.push([BOX, '#26323c', x, 2.15, z, 0.03, 0.75, 1.0]);
      }
      for (const z of [-3.95, 3.95]) for (const x of [-1.21, 1.21]) p.push([BOX, L.coachLow, x, 1.7, z, 0.04, 1.8, 0.6]);
      return bake(p);
    }
    case 'flat': return bake([
      [BOX, '#2a2a2e', 0, 0.45, 0, 2.0, 0.3, 7], ...buffers(h),
      [BOX, '#7a5634', 0, 0.72, 0, 2.3, 0.22, 6.8], [BOX, '#5b3d26', -1.12, 0.95, 0, 0.08, 0.3, 6.8], [BOX, '#5b3d26', 1.12, 0.95, 0, 0.08, 0.3, 6.8],
      ...[-3.2, -1.1, 1.1, 3.2].flatMap(z => [[BOX, '#5b3d26', -1.12, 1.2, z, 0.1, 0.8, 0.1], [BOX, '#5b3d26', 1.12, 1.2, z, 0.1, 0.8, 0.1]] as Piece[]),
      ...wheels([2.5, -2.5]),
    ]);
  }
}

const crateGeo = bake([[BOX, '#9b7748', 0, 0.42, 0, 0.85, 0.85, 0.85], [BOX, '#6e5232', 0, 0.42, 0, 0.9, 0.12, 0.9], [BOX, '#6e5232', 0, 0.42, 0, 0.12, 0.9, 0.9]]);
const SKINS = ['#f1c9a5', '#e0ac85', '#c68a62', '#8d5a3b', '#5e3b26'];
const SHIRTS = ['#c8553d', '#3d7ac8', '#5a9a4a', '#a85ab0', '#d8a03a', '#38a8a0', '#e8e0d0', '#6a4a8a', '#b04050'];
const PANTS = ['#2f3e57', '#4a3a2a', '#3a3a3a', '#5a5040', '#2a4a3a'];
const HAIRS = ['#2a1a10', '#5a3a20', '#c8a060', '#888', '#1a1a1a', '#a04a20', '#e8e0d0'];
const HATS = [undefined, undefined, '#4b3a2a', '#2a2a3a', '#8a2a2a', '#d8c890'];
const randomStyle = (): CharStyle => ({ skin: pick(SKINS), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIRS), hat: pick(HATS), scale: rnd(0.92, 1.05) });
function seatGeo(): THREE.BufferGeometry {
  const st = randomStyle();
  return bake([[BOX, st.shirt, 0, 1.5, 0, 0.5, 0.6, 0.36], [BOX, st.skin, 0, 2.02, 0, 0.36, 0.36, 0.34], [BOX, st.hair, 0, 2.22, 0, 0.38, 0.1, 0.36], ...(st.hat ? [[CYL, st.hat, 0, 2.3, 0, 0.42, 0.14, 0.42] as Piece] : [])]);
}

interface Seat { mesh: THREE.Mesh; full: boolean }
class Car {
  readonly group = new THREE.Group();
  readonly seats: Seat[] = [];
  readonly crates: THREE.Mesh[] = [];
  /** Distance of this car's centre behind the train's head. */
  offset = 0;
  readonly half: number;
  constructor(readonly kind: CarKind, livery: Livery, scene: THREE.Scene) {
    this.half = CAR_LEN[kind] / 2;
    const m = new THREE.Mesh(carGeo(kind, livery), charMat);
    m.castShadow = true;
    this.group.add(m);
    if (kind === 'coach') {
      for (let i = 0; i < 5; i++) for (const x of [-0.6, 0.6]) {
        const s = new THREE.Mesh(seatGeo(), charMat);
        s.position.set(x, 0, -3.0 + i * 1.5);
        s.visible = Math.random() < 0.55;
        this.group.add(s);
        this.seats.push({ mesh: s, full: s.visible });
      }
    }
    if (kind === 'flat') {
      for (const z of [-2.2, 0, 2.2]) {
        const c = new THREE.Mesh(crateGeo, charMat);
        c.position.set(0, 0.83, z);
        c.rotation.y = rnd(-0.15, 0.15);
        c.castShadow = true;
        c.visible = Math.random() < 0.6;
        this.group.add(c);
        this.crates.push(c);
      }
    }
    scene.add(this.group);
  }
}

// ---------- People on foot (passengers & porters) ----------
interface Walker {
  c: Character;
  path: THREE.Vector3[];
  speed: number;
  pose: Pose;
  /** Look at this when idle. */
  face: THREE.Vector3 | null;
  done: (() => void) | null;
  active: boolean;
  waiting: boolean;
}

interface Station {
  name: string;
  s: number;
  /** Unit vector from the track toward the platform side. */
  side: THREE.Vector3;
  center: THREE.Vector3;
  pile: THREE.Mesh[];
  waiting: Walker[];
  porter: Walker;
  spawnT: number;
  townward: THREE.Vector3;
}

class Train {
  s: number;
  v = 0;
  readonly cars: Car[];
  stopAt: Station | null = null;
  next = 0;
  dwell = 0;
  departing = false;
  braking = false;
  chuffT = 0;
  clackT = 0;
  hornCd = 0;
  smokeT = 0;
  readonly length: number;
  jobs = 0;

  constructor(readonly id: number, s: number, scene: THREE.Scene) {
    this.s = s;
    const L = LIVERIES[id % LIVERIES.length];
    const kinds: CarKind[] = id % 2 ? ['loco', 'tender', 'coach', 'flat', 'coach'] : ['loco', 'tender', 'coach', 'coach', 'flat'];
    this.cars = kinds.map(k => new Car(k, L, scene));
    let off = 0;
    for (const c of this.cars) { c.offset = off + c.half; off += c.half * 2 + GAP; }
    this.length = off;
  }
  get loco() { return this.cars[0]; }
}

export interface Crossing { s: number; pos: THREE.Vector3; t: THREE.Vector3; right: THREE.Vector3; lamps: THREE.Mesh[]; ringing: boolean; bellT: number }

export class Railway {
  readonly track: Track;
  readonly stations: Station[] = [];
  readonly trains: Train[] = [];
  private walkers: Walker[] = [];
  private tmp = V(); private tmp2 = V(); private tmp3 = V();
  chaos: Chaos | null = null;
  world: { player: Player; npcs: NPC[]; animals: Animal[] } | null = null;
  private mischiefT = 40;
  /** Level crossings where paths cross the line (people and herds aim for these). */
  readonly crossings: Crossing[] = [];

  constructor(private scene: THREE.Scene, clearings: { x: number; z: number; r: number }[]) {
    // A gently wavy loop just outside the village plateau.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 36; i++) {
      const a = i / 36 * Math.PI * 2, r = 62 + 3.5 * Math.sin(3 * a + 0.7);
      pts.push(V(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const T = (this.track = new Track(pts));

    scene.add(T.sweep([[-1.9, -0.6], [-1.35, 0.05], [1.35, 0.05], [1.9, -0.6]], '#8a8278'));
    for (const x of [-0.72, 0.72]) scene.add(T.sweep([[x - 0.07, 0.2], [x - 0.07, RAIL_TOP], [x + 0.07, RAIL_TOP], [x + 0.07, 0.2], [x - 0.07, 0.2]], '#6a6e74'));
    // Sleepers
    const sl = Math.floor(T.length / 0.85);
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.14, 0.32), new THREE.MeshLambertMaterial({ color: '#5a4030' }), sl);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = V(1, 1, 1);
    for (let i = 0; i < sl; i++) {
      const s = i * T.length / sl;
      const p = T.pos(s).setY(T.pos(s).y - RAIL_TOP + 0.13), t = T.tangent(s);
      m.compose(p, q.setFromEuler(e.set(0, Math.atan2(t.x, t.z), 0)), one);
      sleepers.setMatrixAt(i, m);
    }
    sleepers.receiveShadow = true;
    scene.add(sleepers);
    for (let i = 0; i < T.n; i += 6) clearings.push({ x: T.xs[i], z: T.zs[i], r: 4 });

    // Stations
    const names: [number, string][] = [[1.0, 'Harbour Halt'], [3.0, 'Thistlewick Gate'], [4.9, 'Campfire Crossing'], [6.0, 'Pasture Junction']];
    for (const [ang, name] of names) {
      const st = this.buildStation(name, T.project(Math.cos(ang) * 62, Math.sin(ang) * 62).s, clearings);
      this.stations.push(st);
    }
    this.stations.sort((a, b) => a.s - b.s);

    // Level crossings between the stations, placed where the line sits closest to the ground.
    for (const ang of [0.25, 1.6, 2.3, 3.95, 5.45]) {
      const s0 = T.project(Math.cos(ang) * 62, Math.sin(ang) * 62).s;
      let best = s0, bh = Infinity;
      for (let k = -24; k <= 24; k += 2) {
        const p = T.pos(s0 + k);
        const h = p.y - groundHeight(p.x, p.z);
        if (h < bh) { bh = h; best = s0 + k; }
      }
      this.crossings.push(this.buildCrossing(((best % T.length) + T.length) % T.length, clearings));
    }

    for (let i = 0; i < 2; i++) {
      const tr = new Train(i, this.stations[i * 2].s + 26, scene);
      tr.next = (i * 2 + 1) % this.stations.length;
      this.trains.push(tr);
    }
    this.trains.forEach(t => this.placeTrain(t));
  }

  private buildCrossing(s: number, clearings: { x: number; z: number; r: number }[]): Crossing {
    const T = this.track;
    const p = T.pos(s), t = T.tangent(s);
    const yaw = Math.atan2(t.x, t.z);
    const right = V(t.z, 0, -t.x);
    const top = p.y + 0.02;
    // Plank deck over the rails
    const deck = new THREE.Mesh(bake([
      [BOX, '#7a5a3a', 0, -0.12, 0, 4.4, 0.24, 2.8],
      ...[-1.05, -0.35, 0.35, 1.05].map(z => [BOX, '#6a4a2e', 0, 0.005, z, 4.4, 0.02, 0.08] as Piece),
    ]), charMat);
    deck.position.set(p.x, top, p.z);
    deck.rotation.y = yaw;
    deck.receiveShadow = true;
    this.scene.add(deck);
    addPlatform(p.x, p.z, 2.2, 1.4, yaw, top);
    clearings.push({ x: p.x, z: p.z, r: 7 });
    // Crossbuck signs with warning lamps, one each side
    const lamps: THREE.Mesh[] = [];
    const lampMat = new THREE.MeshBasicMaterial({ color: '#3a1010' });
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const at = p.clone().addScaledVector(right, side * 2.9).addScaledVector(t, side * 1.8);
      g.position.set(at.x, groundHeight(at.x, at.z), at.z);
      g.rotation.y = yaw + Math.PI / 2;
      const post = new THREE.Mesh(bake([[CYL, '#e8e4dc', 0, 1.4, 0, 0.1, 2.8, 0.1], [BOX, '#222', 0, 1.95, 0.02, 0.7, 0.24, 0.12]]), charMat);
      post.castShadow = true;
      g.add(post);
      for (const r of [0.65, -0.65]) {
        const bar = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: '#f2efe8' }));
        bar.scale.set(1.3, 0.18, 0.04);
        bar.position.set(0, 2.6, 0.08);
        bar.rotation.z = r;
        const stripe = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: '#c8302a' }));
        stripe.scale.set(0.3, 1.05, 1.1);
        bar.add(stripe);
        g.add(bar);
      }
      for (const x of [-0.22, 0.22]) {
        const lamp = new THREE.Mesh(BALL, lampMat.clone());
        lamp.scale.setScalar(0.3);
        lamp.position.set(x, 1.95, 0.12);
        g.add(lamp);
        lamps.push(lamp);
      }
      this.scene.add(g);
    }
    return { s, pos: p.clone().setY(top), t: t.clone(), right, lamps, ringing: false, bellT: 0 };
  }

  private buildStation(name: string, s: number, clearings: { x: number; z: number; r: number }[]): Station {
    const T = this.track;
    const p = T.pos(s), t = T.tangent(s);
    const right = V(t.z, 0, -t.x);
    const side = right.dot(V(-p.x, 0, -p.z)) > 0 ? right.clone() : right.clone().negate();
    const center = p.clone().addScaledVector(side, 3.4);
    const yaw = Math.atan2(t.x, t.z);
    const ground = groundHeight(center.x, center.z);
    const top = Math.max(T.pos(s).y - RAIL_TOP + 0.45, ground + 0.3);
    center.y = top;
    const sx = side.dot(right) > 0 ? 1 : -1;   // platform side in the station's local x
    const L = 15;
    const pieces: Piece[] = [
      [BOX, '#a49a8c', 0, (top - ground) / 2 - 0.4, 0, 3.2, top - ground + 0.8, L * 2],
      [BOX, '#e8d890', -sx * 1.5, top - ground + 0.01, 0, 0.18, 0.02, L * 2],
    ];
    // Shelter
    const back = sx * 1.3;
    for (const z of [-4, 0, 4]) pieces.push([BOX, '#5b3d26', back, top - ground + 1.4, z, 0.18, 2.8, 0.18], [BOX, '#5b3d26', back - sx * 1.6, top - ground + 1.4, z, 0.14, 2.8, 0.14]);
    pieces.push(
      [BOX, '#8a3a2e', back - sx * 0.8, top - ground + 2.9, 0, 2.4, 0.2, 10], [BOX, '#7a5634', back + sx * 0.05, top - ground + 0.8, 0, 0.1, 0.9, 8],
      [BOX, '#7a5634', back - sx * 0.35, top - ground + 0.45, 0, 0.5, 0.1, 4], [BOX, '#5b3d26', back - sx * 0.35, top - ground + 0.22, -1.8, 0.4, 0.45, 0.1], [BOX, '#5b3d26', back - sx * 0.35, top - ground + 0.22, 1.8, 0.4, 0.45, 0.1],
      // lamp posts
      [CYL, '#2a2a2e', back - sx * 0.2, top - ground + 1.6, -11, 0.12, 3.2, 0.12], [BOX, '#ffe9a0', back - sx * 0.2, top - ground + 3.3, -11, 0.3, 0.4, 0.3],
      [CYL, '#2a2a2e', back - sx * 0.2, top - ground + 1.6, 11, 0.12, 3.2, 0.12], [BOX, '#ffe9a0', back - sx * 0.2, top - ground + 3.3, 11, 0.3, 0.4, 0.3],
      // sign posts
      [BOX, '#3a2a1a', back, top - ground + 1.6, 6.8, 0.12, 3.2, 0.12], [BOX, '#3a2a1a', back, top - ground + 1.6, 9.2, 0.12, 3.2, 0.12],
    );
    const plat = new THREE.Mesh(bake(pieces), charMat);
    plat.position.set(center.x, ground, center.z);
    plat.rotation.y = yaw;
    plat.castShadow = plat.receiveShadow = true;
    this.scene.add(plat);
    addPlatform(center.x, center.z, 1.6, L, yaw, top);
    for (let k = -L; k <= L; k += 5) { const c = center.clone().addScaledVector(t, k); clearings.push({ x: c.x, z: c.z, r: 4 }); }

    // Name board (double-sided canvas texture)
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 96;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#1f3a5a'; g.fillRect(0, 0, 512, 96);
    g.strokeStyle = '#e8d8a8'; g.lineWidth = 8; g.strokeRect(6, 6, 500, 84);
    g.fillStyle = '#f4ecd8'; g.font = 'bold 46px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, 256, 52);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.56), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    board.position.copy(center).addScaledVector(side, 1.3).addScaledVector(t, 8);
    board.position.y = top + 2.7;
    board.rotation.y = yaw + Math.PI / 2;
    this.scene.add(board);

    // Cargo pile at the flatcar end of the platform
    const pile: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(crateGeo, charMat);
      c.position.copy(center).addScaledVector(side, 0.6 - (i % 2) * 0.95).addScaledVector(t, -11.8 + Math.floor(i / 2) * 0.95);
      c.position.y = top;
      c.rotation.y = yaw + rnd(-0.2, 0.2);
      c.castShadow = true;
      c.visible = Math.random() < 0.5;
      this.scene.add(c);
      pile.push(c);
    }
    const townward = V(-center.x, 0, -center.z).normalize();
    const porterSpot = center.clone().addScaledVector(t, -10);
    const porter = this.walker({ skin: pick(SKINS), shirt: '#2a3a5a', pants: '#1a2030', hair: pick(HAIRS), hat: '#1a2a4a' }, porterSpot);
    porter.face = p.clone();
    const st: Station = { name, s, side, center, pile, waiting: [], porter, spawnT: rnd(0, 6), townward };
    for (let i = 0; i < 2; i++) this.spawnWaiting(st, true);
    return st;
  }

  // ---------- walkers ----------
  private walker(style: CharStyle, at: THREE.Vector3): Walker {
    let w = this.walkers.find(x => !x.active && !x.waiting && x !== undefined && !this.stations.some(s => s.porter === x));
    if (!w) {
      const c = new Character(style);
      this.scene.add(c.root);
      w = { c, path: [], speed: 1.6, pose: 'none', face: null, done: null, active: true, waiting: false };
      this.walkers.push(w);
    }
    w.active = true; w.waiting = false; w.path = []; w.done = null; w.pose = 'none'; w.face = null;
    w.c.root.visible = true;
    w.c.setProp(null);
    w.c.root.position.set(at.x, floorHeight(at.x, at.z), at.z);
    return w;
  }
  private walkTo(w: Walker, path: THREE.Vector3[], speed: number, done?: () => void) {
    w.path = path.map(p => p.clone());
    w.speed = speed;
    w.done = done ?? null;
  }
  private retire(w: Walker) { w.active = false; w.waiting = false; w.c.root.visible = false; }

  private platformSpot(st: Station) {
    const t = this.track.tangent(st.s);
    return st.center.clone().addScaledVector(t, rnd(-6, 8)).addScaledVector(st.side, rnd(-0.4, 0.6));
  }
  private spawnWaiting(st: Station, instant = false) {
    const spot = this.platformSpot(st);
    const from = instant ? spot : spot.clone().addScaledVector(st.townward, 22).add(V(rnd(-4, 4), 0, rnd(-4, 4)));
    const w = this.walker(randomStyle(), from);
    w.waiting = true;
    st.waiting.push(w);
    w.face = this.track.pos(st.s);
    if (!instant) this.walkTo(w, [spot], rnd(1.4, 2));
  }

  private carWorld(tr: Train, c: Car, along: number, lateral: number) {
    const s = tr.s - c.offset + along;
    const p = this.track.pos(s, V()), t = this.track.tangent(s);
    return p.add(V(t.z, 0, -t.x).multiplyScalar(lateral));
  }
  private doorFor(tr: Train, c: Car, st: Station, end = 1) {
    const t = this.track.tangent(tr.s - c.offset);
    const right = V(t.z, 0, -t.x);
    const lat = right.dot(st.side) > 0 ? 1.7 : -1.7;
    return this.carWorld(tr, c, end * 3.95, lat);
  }

  // ---------- station stops ----------
  private arrive(tr: Train, st: Station) {
    tr.stopAt = st; tr.dwell = 0; tr.jobs = 0;
    sfx.play('bell', st.center, { range: 90 });
    let delay = 0.6;
    // Passengers get off.
    for (const c of tr.cars) {
      if (c.kind !== 'coach') continue;
      for (const seat of c.seats) {
        if (!seat.full || Math.random() < 0.45) continue;
        seat.full = false;
        const dz = seat.mesh.position.z > 0 ? 1 : -1;
        tr.jobs++;
        setTimeout(() => {
          seat.mesh.visible = false;
          const door = this.doorFor(tr, c, st, dz);
          const w = this.walker(randomStyle(), door);
          const off = door.clone().addScaledVector(st.side, 1.6);
          const away = off.clone().addScaledVector(st.townward, rnd(18, 28)).add(V(rnd(-6, 6), 0, rnd(-6, 6)));
          tr.jobs--;
          this.walkTo(w, [off, away], rnd(1.5, 2.2), () => this.retire(w));
        }, (delay += rnd(0.4, 0.9)) * 1000);
      }
    }
    // Waiting passengers get on.
    for (const w of [...st.waiting]) {
      const coaches = tr.cars.filter(c => c.kind === 'coach' && c.seats.some(s => !s.full));
      if (!coaches.length) break;
      const c = pick(coaches);
      const seat = c.seats.find(s => !s.full)!;
      seat.full = true;
      st.waiting.splice(st.waiting.indexOf(w), 1);
      w.waiting = false;
      tr.jobs++;
      const door = this.doorFor(tr, c, st, seat.mesh.position.z > 0 ? 1 : -1);
      setTimeout(() => this.walkTo(w, [door.clone().addScaledVector(st.side, 1.3), door], rnd(1.8, 2.4), () => {
        this.retire(w); seat.mesh.visible = true; tr.jobs--;
        if (Math.random() < 0.15) sfx.play('clack', door, { range: 30 });
      }), (delay += rnd(0.2, 0.6)) * 1000);
    }
    // Cargo: the porter unloads a crate or two, then loads one.
    const flat = tr.cars.find(c => c.kind === 'flat');
    if (flat) {
      const jobs: ('unload' | 'load')[] = [];
      const onCar = flat.crates.filter(c => c.visible).length, onPile = st.pile.filter(c => c.visible).length;
      for (let i = 0; i < Math.min(onCar, 4 - onPile, 1 + ((Math.random() * 2) | 0)); i++) jobs.push('unload');
      if (Math.random() < 0.8) jobs.push('load');
      this.runPorter(tr, st, flat, jobs);
    }
  }

  private runPorter(tr: Train, st: Station, flat: Car, jobs: ('unload' | 'load')[]): void {
    const job = jobs.shift();
    const w = st.porter;
    if (!job) return;
    const carCrate = job === 'unload' ? flat.crates.find(c => c.visible) : flat.crates.find(c => !c.visible);
    const pileCrate = job === 'unload' ? st.pile.find(c => !c.visible) : st.pile.find(c => c.visible);
    if (!carCrate || !pileCrate) { this.runPorter(tr, st, flat, jobs); return; }
    tr.jobs++;
    const t = this.track.tangent(tr.s - flat.offset);
    const right = V(t.z, 0, -t.x);
    const lat = right.dot(st.side) > 0 ? 1.75 : -1.75;
    const atCar = this.carWorld(tr, flat, carCrate.position.z, lat);
    const atPile = pileCrate.position.clone().addScaledVector(st.side, -0.9);
    const first = job === 'unload' ? atCar : atPile, second = job === 'unload' ? atPile : atCar;
    this.walkTo(w, [first], 2.4, () => {
      (job === 'unload' ? carCrate : pileCrate).visible = false;
      w.c.setProp('crate'); w.pose = 'carry';
      sfx.play('thud', first, { range: 30, vol: 0.5 });
      this.walkTo(w, [second], 1.8, () => {
        (job === 'unload' ? pileCrate : carCrate).visible = true;
        w.c.setProp(null); w.pose = 'none';
        sfx.play('thud', second, { range: 30, vol: 0.5 });
        tr.jobs--;
        this.runPorter(tr, st, flat, jobs);
      });
    });
  }

  // ---------- simulation ----------
  update(dt: number) {
    const T = this.track;
    for (const tr of this.trains) {
      tr.hornCd -= dt;
      if (tr.stopAt) {
        tr.dwell += dt;
        tr.v = 0;
        if ((tr.dwell > 9 && tr.jobs <= 0) || tr.dwell > 30) {
          tr.stopAt = null;
          tr.next = (tr.next + 1) % this.stations.length;
          sfx.play('whistle', this.locoPos(tr), { range: 260 });
          tr.departing = true;
        }
      } else {
        const st = this.stations[tr.next];
        const stopS = st.s + 26;
        const d = ((stopS - tr.s) % T.length + T.length) % T.length;
        let want = Math.min(VMAX, Math.sqrt(2 * BRAKE * Math.max(0, d - 0.2)));
        // Keep a safe distance from the train ahead.
        for (const o of this.trains) {
          if (o === tr) continue;
          const gap = ((o.s - o.length - tr.s) % T.length + T.length) % T.length;
          want = Math.min(want, Math.sqrt(2 * BRAKE * Math.max(0, gap - 25)));
        }
        if (want < tr.v - 3 && tr.v > 8 && !tr.braking) { tr.braking = true; sfx.play('brakes', this.locoPos(tr), { range: 120 }); }
        if (want > tr.v) tr.braking = false;
        tr.v = want > tr.v ? Math.min(want, tr.v + ACCEL * dt) : Math.max(want, tr.v - BRAKE * 2.5 * dt);
        tr.s = (tr.s + tr.v * dt) % T.length;
        if (d < 0.5 && tr.v < 0.6) this.arrive(tr, st);
      }
      this.placeTrain(tr);
      this.trainFx(tr, dt);
      this.collide(tr);
    }

    // Stations: new passengers wander up to the platforms.
    for (const st of this.stations) {
      if ((st.spawnT -= dt) <= 0) {
        st.spawnT = rnd(8, 18);
        if (st.waiting.length < 4) this.spawnWaiting(st);
      }
    }

    // Walkers
    for (const w of this.walkers) {
      if (!w.active && !w.waiting) continue;
      const r = w.c.root;
      let speed = 0;
      if (w.path.length) {
        const tgt = w.path[0];
        const dx = tgt.x - r.position.x, dz = tgt.z - r.position.z, d = Math.hypot(dx, dz);
        if (d < 0.25) {
          w.path.shift();
          if (!w.path.length && w.done) { const f = w.done; w.done = null; f(); }
        } else {
          const step = Math.min(d, w.speed * dt);
          r.position.x += dx / d * step; r.position.z += dz / d * step;
          let dy = Math.atan2(dx, dz) - r.rotation.y;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          r.rotation.y += dy * Math.min(1, dt * 10);
          speed = w.speed;
        }
      } else if (w.face) {
        let dy = Math.atan2(w.face.x - r.position.x, w.face.z - r.position.z) - r.rotation.y;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        r.rotation.y += dy * Math.min(1, dt * 3);
      }
      r.position.y = floorHeight(r.position.x, r.position.z);
      const near = this.world ? r.position.distanceTo(this.world.player.pos) < 140 : true;
      r.visible = near && (w.active || w.waiting || this.stations.some(s => s.porter === w));
      if (near) w.c.animate(dt, speed, false, false, w.pose === 'carry' ? 'carry' : speed ? 'none' : w.pose);
    }

    this.mischief(dt);
    this.updateCrossings(dt);
  }

  /** Crossing lamps flash and the bell rings while a train is near. */
  private updateCrossings(dt: number) {
    const T = this.track;
    for (const c of this.crossings) {
      let near = false;
      for (const tr of this.trains) {
        const ahead = ((c.s - tr.s) % T.length + T.length) % T.length;       // crossing ahead of the loco
        const behind = ((tr.s - tr.length - c.s) % T.length + T.length) % T.length; // tail still to clear
        if ((ahead < 45 && tr.v > 0.5) || ahead < 8 || ahead > T.length - tr.length - 2 || behind < 2) near = true;
      }
      c.ringing = near;
      const blink = near && Math.sin(performance.now() * 0.009) > 0;
      c.lamps.forEach((l, i) => (l.material as THREE.MeshBasicMaterial).color.set(near && (i % 2 === 0) === blink ? '#ff3a2a' : '#3a1010'));
      if (near && (c.bellT -= dt) <= 0) { c.bellT = 0.55; sfx.play('bell', c.pos, { range: 45, vol: 0.35 }); }
    }
  }

  /** Is a train about to come through (or still going through) this crossing? */
  crossingBusy(c: Crossing) { return c.ringing; }
  /** The crossing closest to a point. */
  nearestCrossing(x: number, z: number) {
    let best = this.crossings[0], bd = Infinity;
    for (const c of this.crossings) { const d = Math.hypot(c.pos.x - x, c.pos.z - z); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  /** +1 if the point is outside the loop, -1 if inside. */
  sideOf(x: number, z: number) {
    const pr = this.track.project(x, z);
    const tp = this.track.pos(pr.s);
    return Math.hypot(x, z) > Math.hypot(tp.x, tp.z) ? 1 : -1;
  }
  /** A point beside the line at angle `ang`, `off` metres outward (negative = toward the village). */
  besideLine(ang: number, off: number) {
    const pr = this.track.project(Math.cos(ang) * 62, Math.sin(ang) * 62);
    const tp = this.track.pos(pr.s);
    const r = Math.hypot(tp.x, tp.z);
    return V(tp.x / r * (r + off), 0, tp.z / r * (r + off));
  }

  private locoPos(tr: Train) { return this.track.pos(tr.s - tr.loco.offset); }

  private placeTrain(tr: Train) {
    const T = this.track;
    for (const c of tr.cars) {
      const sc = tr.s - c.offset;
      const f = T.pos(sc + c.half * 0.7, this.tmp), b = T.pos(sc - c.half * 0.7, this.tmp2);
      const dx = f.x - b.x, dy = f.y - b.y, dz = f.z - b.z;
      c.group.position.set((f.x + b.x) / 2, (f.y + b.y) / 2, (f.z + b.z) / 2);
      c.group.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0, 'YXZ');
    }
  }

  private trainFx(tr: Train, dt: number) {
    const p = this.locoPos(tr);
    const fx = this.chaos?._fx;
    const t = this.track.tangent(tr.s - tr.loco.offset);
    // Chimney smoke: puffs in time with the chuffs, wisps while standing.
    tr.smokeT -= dt;
    if (fx && tr.smokeT <= 0) {
      tr.smokeT = tr.v > 0.5 ? Math.max(0.05, 0.9 / tr.v) : 0.35;
      const cx = p.x + t.x * 2.55, cz = p.z + t.z * 2.55, cy = p.y + 3.5;
      const n = tr.v > 0.5 ? 4 : 1;
      for (let k = 0; k < n; k++) fx.emit(cx + rnd(-0.2, 0.2), cy, cz + rnd(-0.2, 0.2), -t.x * tr.v * 0.3 + rnd(-0.6, 0.6), rnd(2.5, 4.5), -t.z * tr.v * 0.3 + rnd(-0.6, 0.6), rnd(1.8, 3), rnd(0.5, 0.9), pick(['#eeeeee', '#d8d8d8', '#bbbbbb', '#999999']), -0.03, 0.8);
    }
    if (tr.v > 0.5) {
      if ((tr.chuffT -= dt) <= 0) { tr.chuffT = Math.max(0.1, 0.86 / tr.v); sfx.play('chuff', p, { range: 90, vol: 0.7 }); }
      if ((tr.clackT -= dt) <= 0) { tr.clackT = 12 / tr.v; sfx.play('clack', p, { range: 60, vol: 0.6 }); }
    }
    if (tr.departing && tr.v > 3) tr.departing = false;
  }

  /** Anything on the line gets bowled over (or warned with the horn first). */
  private collide(tr: Train) {
    const ch = this.chaos;
    if (!ch) return;
    const T = this.track;
    const head = T.pos(tr.s);
    const fwd = T.tangent(tr.s, this.tmp3);
    // Horn for things on the track ahead.
    if (tr.v > 4 && tr.hornCd <= 0) {
      const ahead = head.clone().addScaledVector(fwd, 18);
      let blocked = false;
      ch._bodies(ahead, 16, (b, pos) => {
        const pr = T.project(pos.x, pos.z);
        if (pr.d > 1.8) return;
        blocked = true;
        if (b.kind === 'npc' && Math.random() < 0.55) b.n.startReact('scared', 1.6, head, pick(['TRAIN!', 'Whoa!', 'Mind the train!', 'Not today, iron beast!']), T.pos(pr.s));
        else if (b.kind === 'animal' && Math.random() < 0.5) b.a.startFlee(T.pos(pr.s), 2);
        else if (b.kind === 'other' && Math.random() < 0.6) b.o.scare(head, pick(['TRAIN!', 'Whoa whoa whoa!', 'Mind the train!', 'Not today, iron beast!']));
      });
      if (blocked) { sfx.play('horn', head, { range: 200 }); tr.hornCd = 4; }
    }
    for (const c of tr.cars) {
      const sc = tr.s - c.offset;
      const cp = T.pos(sc), t = T.tangent(sc);
      ch._bodies(cp, c.half + 2.2, (b, pos) => {
        const dx = pos.x - cp.x, dz = pos.z - cp.z;
        const along = dx * t.x + dz * t.z, lat = dx * t.z - dz * t.x;
        if (Math.abs(along) > c.half + 0.35 || Math.abs(lat) > 1.55) return;
        if (pos.y > cp.y + 3.4 || pos.y < cp.y - 2) return;
        const airborne = b.kind === 'player' ? this.world!.player.airborne : b.kind === 'npc' ? !!b.n.air : b.kind === 'other' ? b.o.airborne : !!b.a.air;
        const sgn = lat >= 0 ? 1 : -1;
        if (tr.v > 2.5 && !airborne) {
          const v = V(t.x * tr.v * 1.3 + t.z * sgn * 7, 7 + tr.v * 0.6, t.z * tr.v * 1.3 - t.x * sgn * 7);
          ch._launch(b, v);
          sfx.play('thud', pos, { range: 70 });
          sfx.play('horn', cp, { range: 200, gap: 2 });
          if (b.kind === 'npc') setTimeout(() => b.n.bark(pick(['I was on the TRACKS?!', 'Who put a railway there?!', 'Ticket... please...', 'Next time I\'m taking the cart.', 'Ow. Choo choo.']), 3.5), 900);
          if (b.kind === 'other') setTimeout(() => b.o.bark(pick(['I LOOKED both ways!', 'Who put a railway there?!', 'Ticket... please...', 'I should have taken the crossing.', 'Ow. Choo choo.'])), 900);
          if (b.kind === 'player') state.toast(pick(['Hit by a train. Character building.', 'You have been delivered.', 'Mind the gap. And the train.']));
        } else if (!airborne) {
          // Slow/stopped: just nudge them off to the side.
          const push = 1.6 - Math.abs(lat);
          pos.x += t.z * sgn * push; pos.z += -t.x * sgn * push;
        }
      });
    }
  }

  /** Every so often, an animal wanders onto the line. */
  private mischief(dt: number) {
    if ((this.mischiefT -= dt) > 0 || !this.world) return;
    this.mischiefT = rnd(30, 60);
    const pool = this.world.animals.filter(a => !a.spec.fly && !a.lost && !a.puppet && !a.air && !a.follow && !a.spec.swim && this.track.project(a.pos.x, a.pos.z).d < 25);
    const a = pick(pool);
    if (!a) return;
    const pr = this.track.project(a.pos.x, a.pos.z);
    a.goTo(this.track.pos(pr.s).setY(0), 60);
  }

  /** For the minimap. */
  get loopPoints() {
    const out: { x: number; z: number }[] = [];
    for (let i = 0; i < this.track.n; i += 8) out.push({ x: this.track.xs[i], z: this.track.zs[i] });
    return out;
  }
  get trainHeads() { return this.trains.map(t => this.locoPos(t)); }
}
