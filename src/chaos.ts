import * as THREE from 'three';
import { floorHeight, isWet, groundHeight, WATER_Y, WORLD_LIMIT } from './terrain';
import { state } from './state';
import { Animal, AnimalKind } from './animals';
import type { NPC } from './npcs';
import type { Player } from './player';
import { sfx } from './audio';

/**
 * The Chaos Director: a constant stream of world events — meteors, tornadoes,
 * frog rain, stampedes, UFOs, earthquakes — that fling villagers, animals and
 * the player all over the island.
 */

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]): T => xs[(Math.random() * xs.length) | 0];
const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const SCREAMS = ['AAAAAAH!', 'RUN!', 'WE\'RE ALL GOING TO DIE!', 'Not my crops!', 'MY HOUSE!', 'Save the cheese!', 'Every island for itself!', 'Is this normal?!', 'I KNEW this would happen!', 'Mother!', 'The prophecy!', 'HELP!', 'Why us?!', 'Somebody DO something!', 'This is fine. This is fine.', 'Brann! Protect us!', 'I left the oven on!'];
const FIRE = ['#ff3b1f', '#ff7a1a', '#ffb02e', '#ffe066'];
const SMOKE = ['#4a4440', '#6b6560', '#3a3532', '#8a847e'];
const WATERC = ['#bfe6ff', '#7cc4f0', '#ffffff', '#5aa8dc'];
const CONFETTI = ['#ff4d6d', '#ffd23f', '#3bceac', '#4d96ff', '#c77dff', '#ff8c42', '#ffffff'];
const DIRT = ['#6b4a2f', '#8a6a44', '#5a4632', '#9c8f78'];

// ---------- Particles (one instanced draw call) ----------
class Particles {
  static N = 3000;
  readonly mesh: THREE.InstancedMesh;
  private p = new Float32Array(Particles.N * 3);
  private v = new Float32Array(Particles.N * 3);
  private life = new Float32Array(Particles.N);
  private max = new Float32Array(Particles.N);
  private size = new Float32Array(Particles.N);
  private grav = new Float32Array(Particles.N);
  private drag = new Float32Array(Particles.N);
  private next = 0;
  private c = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#fff' }), Particles.N);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const m = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < Particles.N; i++) { m.fill(0, i * 16, i * 16 + 16); this.mesh.setColorAt(i, this.c.set('#fff')); }
    scene.add(this.mesh);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: string, grav = 1, drag = 0.6) {
    const i = this.next;
    this.next = (this.next + 1) % Particles.N;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = this.max[i] = life;
    this.size[i] = size;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.mesh.setColorAt(i, this.c.set(color));
    this.mesh.instanceColor!.needsUpdate = true;
  }

  /** Spherical burst. */
  burst(at: THREE.Vector3, n: number, speed: number, colors: string[], size = 0.3, life = 1.2, grav = 1, up = 0) {
    for (let k = 0; k < n; k++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), s = speed * rnd(0.3, 1);
      this.emit(at.x, at.y, at.z, Math.cos(th) * r * s, u * s + up, Math.sin(th) * r * s, life * rnd(0.6, 1.2), size * rnd(0.6, 1.3), pick(colors), grav);
    }
  }

  update(dt: number) {
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const g = 24 * state.gravity;
    for (let i = 0; i < Particles.N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const o = i * 16;
      if (this.life[i] <= 0) { m[o] = m[o + 5] = m[o + 10] = 0; continue; }
      const j = i * 3;
      const d = Math.exp(-dt * this.drag[i]);
      this.v[j] *= d; this.v[j + 2] *= d;
      this.v[j + 1] = this.v[j + 1] * d - g * this.grav[i] * dt;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      const s = this.size[i] * Math.sqrt(this.life[i] / this.max[i]);
      m[o] = s; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = s; m[o + 11] = 0;
      m[o + 12] = this.p[j]; m[o + 13] = this.p[j + 1]; m[o + 14] = this.p[j + 2]; m[o + 15] = 1;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------- Shared meshes ----------
const flashMat = () => new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
const ROCK = new THREE.DodecahedronGeometry(1, 0);
const BALL = new THREE.IcosahedronGeometry(1, 1);
const SEG = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
const meteorMat = new THREE.MeshLambertMaterial({ color: '#3a2a22', emissive: '#ff5a1a', emissiveIntensity: 1.4 });
const cannonMat = new THREE.MeshLambertMaterial({ color: '#1a1a1e' });
const emberMat = new THREE.MeshLambertMaterial({ color: '#2a201c', emissive: '#ff4010', emissiveIntensity: 0.8 });
const rocketMats = CONFETTI.map(c => new THREE.MeshBasicMaterial({ color: c }));
const boltMat = new THREE.MeshBasicMaterial({ color: '#e8f4ff', fog: false });

interface Projectile { mesh: THREE.Mesh; v: THREE.Vector3; trail: string[]; power: number; radius: number; ember: boolean; grav: number; fuse?: number; firework?: boolean }
interface Flash { mesh: THREE.Mesh; t: number; dur: number; r: number }
interface Fire { pos: THREE.Vector3; t: number; mesh?: THREE.Mesh }
interface Running { def: EventDef; t: number; dur: number; tick: (dt: number, t: number) => void; end?: () => void }
interface EventDef { id: string; title: string; sub: string; w: number; dur: [number, number]; start: (this: Chaos, r: Running) => Pick<Running, 'tick' | 'end'> }

export interface ChaosWorld {
  scene: THREE.Scene;
  player: Player;
  npcs: NPC[];
  animals: Animal[];
  labels: HTMLElement;
  canHitPlayer: () => boolean;
  /** Anything else that can be knocked about (wandering travellers...). */
  extras?: Flingable[];
}

/** Minimal interface for other things the chaos (and the trains) can send flying. */
export interface Flingable {
  readonly pos: THREE.Vector3;
  readonly airborne: boolean;
  readonly active: boolean;
  launch(v: THREE.Vector3): void;
  /** Something big is coming: get out of the way. */
  scare(from: THREE.Vector3, line?: string): void;
  bark(text: string): void;
}

type Body = { kind: 'player' } | { kind: 'npc'; n: NPC } | { kind: 'animal'; a: Animal } | { kind: 'other'; o: Flingable };

export class Chaos {
  shake = 0;
  private shakeOff = new THREE.Vector3();
  private fx: Particles;
  private projectiles: Projectile[] = [];
  private flashes: Flash[] = [];
  private fires: Fire[] = [];
  private light = new THREE.PointLight('#ff8a3a', 0, 60, 1);
  private running: Running[] = [];
  /** Seconds until the next event (the first one comes a little sooner). */
  private cooldown = 40;
  private lastIds: string[] = [];
  private spawned: { a: Animal; until: number }[] = [];
  private bolts: THREE.Mesh[] = [];
  private boltT = 0;
  /** Sky tint target and current blend. */
  private tint = new THREE.Color();
  private tintWant = 0;
  private tintAmt = 0;
  private flash = 0;
  private disco = 0;
  count = 0;

  constructor(private w: ChaosWorld) {
    this.fx = new Particles(w.scene);
    w.scene.add(this.light);
    for (let i = 0; i < 14; i++) {
      const b = new THREE.Mesh(SEG, boltMat);
      b.visible = false;
      w.scene.add(b);
      this.bolts.push(b);
    }
  }

  get p() { return this.w.player.pos; }

  // ---------- Director ----------
  update(dt: number) {
    this.cooldown -= dt;
    // About one event a minute.
    if (this.cooldown <= 0) {
      this.cooldown = rnd(55, 65);
      this.trigger();
    }
    for (const r of [...this.running]) {
      r.t += dt;
      r.tick(dt, r.t);
      if (r.t >= r.dur) { r.end?.(); this.running.splice(this.running.indexOf(r), 1); }
    }

    this.updateProjectiles(dt);
    this.updateFires(dt);
    this.fx.update(dt);

    for (const f of [...this.flashes]) {
      f.t += dt;
      const k = f.t / f.dur;
      f.mesh.scale.setScalar(f.r * Math.min(1, k * 2.5));
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
      if (k >= 1) { this.w.scene.remove(f.mesh); (f.mesh.material as THREE.Material).dispose(); this.flashes.splice(this.flashes.indexOf(f), 1); }
    }
    this.light.intensity *= Math.exp(-dt * 6);
    if ((this.boltT -= dt) <= 0) for (const b of this.bolts) b.visible = false;

    for (const s of [...this.spawned]) {
      if (s.until > state.clock) continue;
      this.despawn(s.a);
      this.spawned.splice(this.spawned.indexOf(s), 1);
    }

    this.tintAmt += (this.tintWant - this.tintAmt) * Math.min(1, dt * 1.5);
    this.flash *= Math.exp(-dt * 9);
    this.shake *= Math.exp(-dt * 3);
  }

  /** Start a random (or named) event. */
  trigger(id?: string) {
    const busy = new Set(this.running.map(r => r.def.id));
    let pool = EVENTS.filter(e => !busy.has(e.id) && (id ? e.id === id : !this.lastIds.includes(e.id)));
    if (!pool.length) pool = EVENTS.filter(e => !busy.has(e.id));
    if (!pool.length) return;
    const total = pool.reduce((s, e) => s + e.w, 0);
    let r = Math.random() * total, def = pool[0];
    for (const e of pool) if ((r -= e.w) <= 0) { def = e; break; }
    const run: Running = { def, t: 0, dur: rnd(def.dur[0], def.dur[1]), tick: () => {} };
    Object.assign(run, def.start.call(this, run));
    this.running.push(run);
    this.lastIds = [def.id, ...this.lastIds].slice(0, 4);
    this.count++;
    sfx.play('sting', null, { vol: 0.8 });
  }

  get activeTitles() { return this.running.map(r => r.def.title); }

  // ---------- Hooks for main.ts ----------
  applyCamera(camera: THREE.PerspectiveCamera) {
    const s = Math.min(this.shake, 2.5);
    this.shakeOff.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s).multiplyScalar(0.6);
    camera.position.add(this.shakeOff);
    camera.rotation.z += (Math.random() - 0.5) * s * 0.03;
  }

  applySky(top: THREE.Color, bottom: THREE.Color, fog: THREE.Color, bg: THREE.Color, hemi: THREE.HemisphereLight) {
    if (this.disco > 0) this.tint.setHSL((performance.now() * 0.0004) % 1, 0.9, 0.5);
    const a = this.tintAmt;
    if (a > 0.005) {
      top.lerp(this.tint, a);
      bottom.lerp(this.tint, a * 0.8);
      fog.copy(bottom); bg.copy(bottom);
      hemi.color.lerp(this.tint, a * 0.6);
    }
    if (this.flash > 0.01) {
      const white = new THREE.Color('#f4f8ff');
      top.lerp(white, this.flash); bottom.lerp(white, this.flash); fog.lerp(white, this.flash); bg.lerp(white, this.flash);
      hemi.intensity += this.flash * 3;
    }
  }

  // ---------- Bodies ----------
  private bodies(at: THREE.Vector3, r: number, fn: (b: Body, pos: THREE.Vector3, d: number) => void) {
    if (this.w.canHitPlayer()) { const d = flat(this.p, at); if (d < r) fn({ kind: 'player' }, this.p, d); }
    for (const n of this.w.npcs) {
      if (n.atHome || n.puppet) continue;
      const d = flat(n.pos, at);
      if (d < r) fn({ kind: 'npc', n }, n.pos, d);
    }
    for (const a of this.w.animals) {
      if (a.spec.fly || a.puppet) continue;
      const d = flat(a.pos, at);
      if (d < r) fn({ kind: 'animal', a }, a.pos, d);
    }
    for (const o of this.w.extras ?? []) {
      if (!o.active) continue;
      const d = flat(o.pos, at);
      if (d < r) fn({ kind: 'other', o }, o.pos, d);
    }
  }

  private launch(b: Body, v: THREE.Vector3) {
    if (b.kind === 'player') { if (!this.w.player.airborne) sfx.play('boing', null, { gap: 0.2 }); this.w.player.launch(v); }
    else if (b.kind === 'npc') { if (!b.n.air && v.y > 6) sfx.play('scream', b.n.pos, { range: 60, gap: 0.25 }); b.n.launch(v); }
    else if (b.kind === 'other') { if (!b.o.airborne && v.y > 6) sfx.play('scream', b.o.pos, { range: 60, gap: 0.25 }); b.o.launch(v); }
    else b.a.launch(v);
  }

  /** Knock everything near `at` outward and upward. */
  blast(at: THREE.Vector3, r: number, power: number) {
    this.bodies(at, r, (b, pos, d) => {
      const k = 1 - d / r;
      const dir = V(pos.x - at.x, 0, pos.z - at.z);
      if (dir.lengthSq() < 1e-4) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      dir.normalize().multiplyScalar(power * (0.4 + k));
      dir.y = power * (0.5 + k * 0.9);
      this.launch(b, dir);
    });
    this.panic(at, r * 4);
  }

  /** Villagers scream and run, animals bolt. */
  panic(at: THREE.Vector3, r = 30, lines = SCREAMS) {
    for (const n of this.w.npcs) {
      if (n.atHome || n.air || n.puppet || n.mode === 'talk' || flat(n.pos, at) > r) continue;
      if (Math.random() < 0.7) n.startReact('scared', rnd(2, 4), at, Math.random() < 0.6 ? pick(lines) : undefined, Math.random() < 0.7 ? at : undefined);
    }
    for (const a of this.w.animals) {
      if (a.air || a.puppet || a.spec.fly || flat(a.pos, at) > r * 0.8) continue;
      a.startFlee(at, rnd(2, 4));
    }
  }

  explode(at: THREE.Vector3, r: number, power: number, opts: { ember?: boolean; colors?: string[] } = {}) {
    const wet = groundHeight(at.x, at.z) < WATER_Y;
    const pos = at.clone();
    sfx.play(wet ? 'splash' : r >= 7 ? 'bigBoom' : 'boom', pos, { range: 220, vol: wet ? 1 : 0.9 });
    this.fx.burst(pos, 50 + r * 10, power * 1.4, wet ? WATERC : opts.colors ?? FIRE, 0.45, 1.0, 0.6, power * 0.4);
    this.fx.burst(pos, 25 + r * 4, power * 0.6, wet ? WATERC : SMOKE, 0.9, 2.2, -0.05, 2);
    if (!wet) this.fx.burst(pos, 30, power, DIRT, 0.25, 1.6, 1, power * 0.7);
    const m = new THREE.Mesh(BALL, flashMat());
    if (wet) (m.material as THREE.MeshBasicMaterial).color.set('#cfefff');
    m.position.copy(pos);
    this.w.scene.add(m);
    this.flashes.push({ mesh: m, t: 0, dur: 0.45, r: r * 0.9 });
    this.light.position.copy(pos).setY(pos.y + 2);
    this.light.intensity = 40;
    const d = flat(this.p, at);
    this.shake = Math.max(this.shake, Math.max(0, 1.6 - d / 40) * (r / 6));
    this.blast(at, r, power);
    if (opts.ember && !wet) this.addFire(pos, true);
  }

  private addFire(pos: THREE.Vector3, rock = false) {
    if (this.fires.length > 16) { const old = this.fires.shift()!; if (old.mesh) this.w.scene.remove(old.mesh); }
    const f: Fire = { pos: V(pos.x, floorHeight(pos.x, pos.z), pos.z), t: rnd(12, 22) };
    if (rock) {
      f.mesh = new THREE.Mesh(ROCK, emberMat);
      f.mesh.scale.setScalar(rnd(0.6, 1.1));
      f.mesh.position.copy(f.pos).setY(f.pos.y + 0.3);
      f.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.w.scene.add(f.mesh);
    }
    this.fires.push(f);
  }

  private updateFires(dt: number) {
    for (const f of [...this.fires]) {
      f.t -= dt;
      const p = f.pos;
      if (Math.random() < 0.9) this.fx.emit(p.x + rnd(-0.6, 0.6), p.y + 0.3, p.z + rnd(-0.6, 0.6), rnd(-0.5, 0.5), rnd(3, 6), rnd(-0.5, 0.5), rnd(0.4, 0.9), rnd(0.25, 0.5), pick(FIRE), -0.1, 1);
      if (Math.random() < 0.25) this.fx.emit(p.x, p.y + 1.2, p.z, rnd(-0.4, 0.4), rnd(2, 3), rnd(-0.4, 0.4), rnd(1.5, 2.5), rnd(0.5, 0.9), pick(SMOKE), -0.08, 0.5);
      // Hot feet!
      if (Math.random() < dt * 3) this.bodies(p, 1.6, (b, pos) => {
        this.launch(b, V((pos.x - p.x) * 3, 7, (pos.z - p.z) * 3));
        if (b.kind === 'npc') b.n.bark(pick(['HOT HOT HOT!', 'MY BOOTS!', 'Ow ow ow ow!', 'Fire! Bad! FIRE BAD!']), 2);
      });
      if (f.t <= 0) { if (f.mesh) this.w.scene.remove(f.mesh); this.fires.splice(this.fires.indexOf(f), 1); }
    }
  }

  // ---------- Projectiles ----------
  private fire(from: THREE.Vector3, v: THREE.Vector3, mat: THREE.Material, scale: number, o: Partial<Projectile>) {
    const mesh = new THREE.Mesh(o.firework || mat === cannonMat ? BALL : ROCK, mat);
    mesh.scale.setScalar(scale);
    mesh.position.copy(from);
    mesh.castShadow = true;
    this.w.scene.add(mesh);
    if (o.firework) sfx.play('rocket', from, { range: 80, gap: 0.05 });
    else if (mat === cannonMat) sfx.play('cannon', from, { range: 600, vol: 0.5, gap: 0.1 });
    else sfx.play('meteor', from.clone().lerp(this.p, 0.7), { range: 150, gap: 0.15 });
    this.projectiles.push({ mesh, v, trail: FIRE, power: 12, radius: 6, ember: false, grav: 0, ...o });
  }

  private updateProjectiles(dt: number) {
    for (const pr of [...this.projectiles]) {
      pr.v.y -= 24 * pr.grav * state.gravity * dt;
      const m = pr.mesh;
      m.position.addScaledVector(pr.v, dt);
      m.rotation.x += dt * 5; m.rotation.y += dt * 3;
      for (let k = 0; k < 3; k++) this.fx.emit(m.position.x + rnd(-0.3, 0.3), m.position.y + rnd(-0.3, 0.3), m.position.z + rnd(-0.3, 0.3), rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), rnd(0.3, 0.8), m.scale.x * rnd(0.5, 1), pick(pr.trail), -0.05, 1);
      const floor = Math.max(floorHeight(m.position.x, m.position.z), WATER_Y);
      let boom = m.position.y <= floor + 0.2;
      if (pr.fuse !== undefined && (pr.fuse -= dt) <= 0) boom = true;
      if (Math.hypot(m.position.x, m.position.z) > WORLD_LIMIT + 60) boom = true;
      if (!boom) continue;
      this.w.scene.remove(m);
      this.projectiles.splice(this.projectiles.indexOf(pr), 1);
      if (pr.firework && m.position.y > floor + 2) {
        this.fx.burst(m.position, 160, 16, [pick(CONFETTI), pick(CONFETTI), '#ffffff'], 0.35, 1.8, 0.15);
        this.light.position.copy(m.position); this.light.intensity = 25;
        sfx.play('pop', m.position, { range: 150 });
        this.shake = Math.max(this.shake, 0.2);
      } else this.explode(m.position.clone().setY(floor + 0.3), pr.radius, pr.power, { ember: pr.ember, colors: pr.firework ? CONFETTI : undefined });
    }
  }

  private spot(r0: number, r1: number, around = this.p) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, d = rnd(r0, r1);
      const x = around.x + Math.cos(a) * d, z = around.z + Math.sin(a) * d;
      if (Math.hypot(x, z) < WORLD_LIMIT && !isWet(x, z)) return V(x, floorHeight(x, z), z);
    }
    return V(around.x, floorHeight(around.x, around.z), around.z);
  }

  /** A random villager or animal near the player (for targeted mischief). */
  private victim(r = 40): Body | null {
    const pool: Body[] = [];
    for (const n of this.w.npcs) if (!n.atHome && !n.air && !n.puppet && n.mode !== 'talk' && flat(n.pos, this.p) < r) pool.push({ kind: 'npc', n });
    for (const a of this.w.animals) if (!a.spec.fly && !a.air && !a.puppet && !a.lost && flat(a.pos, this.p) < r) pool.push({ kind: 'animal', a });
    return pool.length ? pick(pool) : null;
  }
  private posOf(b: Body) { return b.kind === 'player' ? this.p : b.kind === 'npc' ? b.n.pos : b.kind === 'other' ? b.o.pos : b.a.pos; }

  private spawn(kind: AnimalKind, at: THREE.Vector3, life: number, range = 8) {
    const a = new Animal(kind, at, this.w.scene, this.w.labels, { range, variant: (Math.random() * 4) | 0 });
    this.w.animals.push(a);
    this.spawned.push({ a, until: state.clock + life });
    return a;
  }
  private despawn(a: Animal) {
    this.w.scene.remove(a.root);
    a.label.remove();
    const i = this.w.animals.indexOf(a);
    if (i >= 0) this.w.animals.splice(i, 1);
  }

  // ---------- Lightning ----------
  strike(at: THREE.Vector3) {
    let x = at.x, z = at.z, y = at.y + 90;
    const segs = this.bolts.length;
    for (let i = 0; i < segs; i++) {
      const ny = at.y + 90 * (1 - (i + 1) / segs);
      const nx = i === segs - 1 ? at.x : at.x + rnd(-4, 4) * (1 - i / segs), nz = i === segs - 1 ? at.z : at.z + rnd(-4, 4) * (1 - i / segs);
      const b = this.bolts[i];
      b.position.set(x, y, z);
      const len = Math.hypot(nx - x, ny - y, nz - z);
      b.scale.set(0.35, 0.35, len);
      b.lookAt(nx, ny, nz);
      b.visible = true;
      x = nx; y = ny; z = nz;
    }
    this.boltT = 0.18;
    sfx.play('thunder', at, { range: 400 });
    this.flash = Math.max(this.flash, 0.85);
    this.explode(at.clone().setY(at.y + 0.3), 4.5, 11, { ember: true, colors: ['#ffffff', '#cfe8ff', '#ffe066', '#9fd0ff'] });
    this.addFire(at);
  }

  // ---------- Sky helpers for events ----------
  setTint(color: string, amt: number) { this.tint.set(color); this.tintWant = amt; }
  clearTint() { this.tintWant = 0; }
  setDisco(on: boolean) { this.disco = on ? 1 : 0; this.tintWant = on ? 0.55 : 0; }

  // Expose internals to the event table below.
  get _fx() { return this.fx; }
  _fire(from: THREE.Vector3, v: THREE.Vector3, mat: THREE.Material, scale: number, o: Partial<Projectile>) { this.fire(from, v, mat, scale, o); }
  _spot(r0: number, r1: number, around?: THREE.Vector3) { return this.spot(r0, r1, around); }
  _victim(r?: number) { return this.victim(r); }
  _posOf(b: Body) { return this.posOf(b); }
  _bodies(at: THREE.Vector3, r: number, fn: (b: Body, pos: THREE.Vector3, d: number) => void) { this.bodies(at, r, fn); }
  _launch(b: Body, v: THREE.Vector3) { this.launch(b, v); }
  _spawn(kind: AnimalKind, at: THREE.Vector3, life: number, range?: number) { return this.spawn(kind, at, life, range); }
  _despawn(a: Animal) { this.despawn(a); }
  get _w() { return this.w; }
  /** How long the named running event has left. */
  _runLeft(el: number, id: string) {
    const r = this.running.find(x => x.def.id === id);
    return r ? r.dur - el : 0;
  }
}

// ======================================================================
//  The events
// ======================================================================

type C = Chaos;
const ballistic = (from: THREE.Vector3, to: THREE.Vector3, T: number) =>
  V((to.x - from.x) / T, (to.y - from.y) / T + 0.5 * 24 * T, (to.z - from.z) / T);

const EVENTS: EventDef[] = [
  {
    id: 'meteors', title: '☄️ METEOR SHOWER', sub: 'The sky is falling. Literally.', w: 3, dur: [16, 24],
    start(this: C) {
      let next = 0;
      this.setTint('#ff7a3a', 0.35);
      this._w.npcs.forEach(n => Math.random() < 0.3 && n.bark(pick(['Is that... a shooting star?', 'Make a wish!', "That's getting closer.", 'THAT IS GETTING CLOSER!']), 3));
      return {
        tick: (dt: number) => {
          if ((next -= dt) > 0) return;
          next = rnd(0.2, 0.55);
          const target = Math.random() < 0.2 ? this._spot(0, 8) : this._spot(5, 50);
          const from = target.clone().add(V(rnd(-40, 40), rnd(70, 100), rnd(-40, 40)));
          const v = target.clone().sub(from).normalize().multiplyScalar(rnd(45, 65));
          this._fire(from, v, meteorMat, rnd(0.6, 1.6), { power: rnd(10, 16), radius: rnd(5, 8), ember: Math.random() < 0.6 });
        },
        end: () => this.clearTint(),
      };
    },
  },
  {
    id: 'pirates', title: '🏴‍☠️ PIRATE BOMBARDMENT', sub: 'Cannonballs incoming from the sea!', w: 2, dur: [14, 20],
    start(this: C) {
      let next = 1;
      const ang = Math.random() * Math.PI * 2;
      return {
        tick: (dt: number) => {
          if ((next -= dt) > 0) return;
          next = rnd(0.25, 0.7);
          const a = ang + rnd(-0.4, 0.4);
          const from = V(Math.cos(a) * 240, 4, Math.sin(a) * 240);
          const target = Math.random() < 0.25 ? this._spot(0, 6) : this._spot(3, 40);
          const T = rnd(2.8, 4);
          this._fire(from, ballistic(from, target, T), cannonMat, 0.55, { power: 13, radius: 6, grav: 1, trail: SMOKE });
        },
      };
    },
  },
  {
    id: 'tornado', title: '🌪️ TORNADO', sub: 'Hold on to your hats. And your sheep.', w: 3, dur: [22, 32],
    start(this: C) {
      const w = this._w;
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: '#9a948c', transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
      const rings: THREE.Mesh[] = [];
      for (let i = 0; i < 16; i++) {
        const r = 0.8 + Math.pow(i / 15, 1.6) * 10;
        const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.35 + i * 0.05, 4, 18), mat);
        m.rotation.x = Math.PI / 2;
        m.position.y = i * 2.1;
        g.add(m); rings.push(m);
      }
      const pos = this._spot(28, 38);
      g.position.copy(pos);
      w.scene.add(g);
      const vel = V();
      let t = 0;
      this.setTint('#59606a', 0.5);
      const wind = sfx.loop('wind', pos, { range: 120, vol: 1.2 });
      this.panic(pos, 80, ['TORNADO!', 'To the cellar!', 'We have a cellar?', 'Grab the cows!', 'Hold on to something!']);
      return {
        tick: (dt: number, el: number) => {
          t += dt;
          // Wander, but keep hunting the player.
          const to = V(this.p.x - pos.x, 0, this.p.z - pos.z);
          const d = to.length();
          to.normalize().multiplyScalar(d > 15 ? 6 : 2.5);
          to.x += Math.sin(t * 0.7) * 5; to.z += Math.cos(t * 0.9) * 5;
          vel.lerp(to, Math.min(1, dt));
          pos.addScaledVector(vel, dt);
          if (Math.hypot(pos.x, pos.z) > WORLD_LIMIT) pos.multiplyScalar(0.99);
          pos.y = Math.max(floorHeight(pos.x, pos.z), WATER_Y);
          const grow = Math.min(1, el / 2, (this._runLeft(el, 'tornado')) / 2);
          g.position.copy(pos);
          g.scale.setScalar(Math.max(0.01, grow));
          wind.setPos(pos); wind.setVolume(1.2 * grow);
          rings.forEach((m, i) => {
            m.rotation.z += dt * (6 - i * 0.2);
            m.position.x = Math.sin(t * 2 + i * 0.4) * i * 0.25;
            m.position.z = Math.cos(t * 1.7 + i * 0.4) * i * 0.25;
          });
          // Debris
          const fx = this._fx;
          for (let k = 0; k < 8; k++) {
            const h = Math.random() * 30 * grow, a = Math.random() * Math.PI * 2, r = (1 + h * 0.3) * grow;
            const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
            fx.emit(x, pos.y + h, z, -Math.sin(a) * 14, rnd(2, 6), Math.cos(a) * 14, rnd(0.3, 0.8), rnd(0.15, 0.45), pick(Math.random() < 0.5 ? DIRT : SMOKE), 0, 0.2);
          }
          this.shake = Math.max(this.shake, Math.max(0, 0.9 - flat(this.p, pos) / 40));
          // Suck everything in, then fling it up.
          this._bodies(pos, 16 * grow, (b, bp, dd) => {
            const ix = (pos.x - bp.x) / (dd || 1), iz = (pos.z - bp.z) / (dd || 1);
            if (dd < 3.5 * grow) {
              const sp = rnd(10, 18);
              this._launch(b, V(-iz * sp + ix * 2, rnd(14, 22), ix * sp + iz * 2));
            } else if (b.kind === 'player') {
              const k = (1 - dd / 16) * 30 * dt;
              w.player.nudge(ix * k - iz * k * 0.6, iz * k + ix * k * 0.6);
            } else {
              const k = (1 - dd / 16) * 5 * dt;
              bp.x += ix * k - iz * k; bp.z += iz * k + ix * k;
            }
          });
        },
        end: () => { wind.stop(); w.scene.remove(g); rings.forEach(r => r.geometry.dispose()); mat.dispose(); this.clearTint(); },
      };
    },
  },
  {
    id: 'frogs', title: '🐸 IT IS RAINING FROGS', sub: 'Guard Brann has left the chat.', w: 3, dur: [12, 16],
    start(this: C) {
      let next = 0, n = 0;
      this.setTint('#4f7a3a', 0.4);
      const brann = this._w.npcs.find(x => x.def.id === 'brann');
      brann?.bark('No. No no no no. NOOOOOOO!', 4);
      return {
        tick: (dt: number) => {
          if ((next -= dt) > 0 || n > 70) return;
          next = 0.1;
          n++;
          const at = this._spot(0, 26);
          const f = this._spawn('frog', at, 50, 6);
          f.pos.y = at.y + rnd(20, 35);
          f.launch(V(rnd(-2, 2), -rnd(2, 8), rnd(-2, 2)));
          if (brann && !brann.air && Math.random() < 0.08) brann.startReact('scared', 2.5, f.pos, pick(['THEY\'RE IN MY HELMET!', 'FROG! FROG! FROG!', 'Mother, help!', 'I resign!']), f.pos);
        },
        end: () => this.clearTint(),
      };
    },
  },
  {
    id: 'stampede', title: '🐄 STAMPEDE!', sub: 'Something spooked the livestock. Something big.', w: 3, dur: [9, 12],
    start(this: C) {
      const ang = Math.random() * Math.PI * 2;
      const dir = V(Math.cos(ang), 0, Math.sin(ang));
      const side = V(-dir.z, 0, dir.x);
      const herd: { a: Animal; sp: number; off: number }[] = [];
      const kinds: AnimalKind[] = ['cow', 'cow', 'sheep', 'sheep', 'pig', 'deer', 'cow', 'sheep'];
      for (let i = 0; i < 18; i++) {
        const off = rnd(-14, 14);
        const at = this.p.clone().addScaledVector(dir, -rnd(35, 50)).addScaledVector(side, off);
        at.y = floorHeight(at.x, at.z);
        const a = this._spawn(pick(kinds), at, 14);
        a.puppet = true;
        herd.push({ a, sp: rnd(9, 13), off });
      }
      this.shake = 0.3;
      const rumble = sfx.loop('rumble', herd[0].a.pos, { range: 120, vol: 1.3 });
      return {
        tick: (dt: number) => {
          const yaw = Math.atan2(dir.x, dir.z);
          let close = 99;
          for (const h of herd) {
            const a = h.a;
            if (!a.puppet) continue;
            a.pos.addScaledVector(dir, h.sp * dt);
            a.pos.y = floorHeight(a.pos.x, a.pos.z);
            if (isWet(a.pos.x, a.pos.z)) { this._fx.burst(a.pos, 20, 6, WATERC, 0.3, 0.8); a.puppet = false; a.root.visible = false; a.pos.y = -50; continue; }
            a.puppetStep(dt, h.sp, yaw);
            a.root.position.y += Math.abs(Math.sin(state.clock * 12 + h.off)) * 0.25;
            if (Math.random() < dt * 0.6) a.bark(a.kind === 'cow' ? 'MOOOOOOOO!' : a.kind === 'pig' ? 'SQUEEEE!' : a.kind === 'sheep' ? 'BAAAAAAA!' : undefined);
            if (Math.random() < dt * 8) this._fx.emit(a.pos.x, a.pos.y + 0.1, a.pos.z, rnd(-1, 1), rnd(1, 3), rnd(-1, 1), rnd(0.6, 1.2), rnd(0.3, 0.7), pick(DIRT), 0.3, 1);
            close = Math.min(close, flat(a.pos, this.p));
            this._bodies(a.pos, 1.7, (b) => {
              if (b.kind === 'animal' && herd.some(x => x.a === b.a)) return;
              this._launch(b, dir.clone().multiplyScalar(rnd(12, 18)).add(side.clone().multiplyScalar(rnd(-4, 4))).setY(rnd(9, 14)));
              sfx.play('thud', this._posOf(b), { range: 60 });
              if (b.kind === 'npc') b.n.bark(pick(['MOOOO— OOF!', 'Not the cows!', 'Run over by a sheep. Typical.']), 2.5);
            });
          }
          this.shake = Math.max(this.shake, Math.max(0, 0.8 - close / 40));
          const lead = herd.find(h => h.a.puppet);
          if (lead) rumble.setPos(lead.a.pos);
        },
        end: () => { rumble.stop(); herd.forEach(h => this._despawn(h.a)); },
      };
    },
  },
  {
    id: 'ufo', title: '🛸 UNIDENTIFIED FLYING OBJECT', sub: 'They come in peace. Probably.', w: 3, dur: [20, 26],
    start(this: C) {
      const w = this._w;
      const g = new THREE.Group();
      const metal = new THREE.MeshLambertMaterial({ color: '#a8b2bc', emissive: '#1a2028' });
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(3.6, 5, 0.9, 20), metal));
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 0.25, 20), new THREE.MeshLambertMaterial({ color: '#6a7480' }));
      g.add(rim);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#7ff0ff', transparent: true, opacity: 0.65 }));
      dome.position.y = 0.4;
      g.add(dome);
      const lights: THREE.Mesh[] = [];
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2;
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 4), new THREE.MeshBasicMaterial({ color: '#fff' }));
        l.position.set(Math.cos(a) * 5.5, -0.1, Math.sin(a) * 5.5);
        g.add(l); lights.push(l);
      }
      const beamGeo = new THREE.ConeGeometry(3.5, 1, 18, 1, true).translate(0, -0.5, 0);
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: '#7dff9a', transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.visible = false;
      g.add(beam);
      w.scene.add(g);
      const hum = sfx.loop('hum', g.position, { range: 160, vol: 1 });

      // Choose who gets abducted: usually a cow or a villager, sometimes YOU.
      let victim: Body | null = null;
      if (w.canHitPlayer() && Math.random() < 0.25) victim = { kind: 'player' };
      else {
        const cow = w.animals.find(a => a.kind === 'cow' && !a.puppet && !a.air && flat(a.pos, this.p) < 80);
        victim = cow && Math.random() < 0.5 ? { kind: 'animal', a: cow } : this._victim(45) ?? { kind: 'player' };
      }
      const vpos = this._posOf(victim);
      const home = vpos.clone();
      g.position.set(vpos.x + 120, vpos.y + 70, vpos.z - 80);
      let phase: 'arrive' | 'beam' | 'leave' = 'arrive';
      let t = 0, lifted = 0;
      const vName = victim.kind === 'npc' ? victim.n.first : victim.kind === 'animal' ? victim.a.title : 'YOU';
      return {
        tick: (dt: number) => {
          t += dt;
          lights.forEach((l, i) => (l.material as THREE.MeshBasicMaterial).color.setHSL((t * 0.8 + i / 12) % 1, 1, 0.6));
          rim.rotation.y += dt * 4;
          hum.setPos(g.position);
          const above = V(vpos.x, Math.max(floorHeight(vpos.x, vpos.z), 0) + 16, vpos.z);
          if (phase === 'arrive') {
            g.position.lerp(above, Math.min(1, dt * 1.4));
            g.rotation.z = Math.sin(t * 2) * 0.1;
            if (g.position.distanceTo(above) < 1.5) {
              phase = 'beam';
              beam.visible = true;
              sfx.play('zap', g.position, { range: 120 });
              this.panic(vpos, 40, ['ALIENS!', 'THE SKY PEOPLE!', `They're taking ${vName}!`, 'Take Brann instead!', 'I knew Sela was right!']);
              if (victim!.kind === 'npc') { victim!.n.puppet = true; victim!.n.bark('Um. Hello? Put me down?', 4); }
              if (victim!.kind === 'animal') { victim!.a.puppet = true; victim!.a.bark(); }
              if (victim!.kind === 'player') state.toast('You feel... lighter.');
            }
          } else if (phase === 'beam') {
            g.position.lerp(above, Math.min(1, dt * 2));
            g.rotation.z = Math.sin(t * 2) * 0.05;
            const H = g.position.y - (floorHeight(g.position.x, g.position.z));
            beam.scale.set(1, H, 1);
            lifted += dt;
            if (victim!.kind === 'player') {
              if (w.canHitPlayer() && this.p.y < g.position.y - 3) w.player.launch(V((g.position.x - this.p.x) * 2, 5, (g.position.z - this.p.z) * 2));
              if (lifted > 4) phase = 'leave';
            } else {
              const vp = this._posOf(victim!);
              vp.x += (g.position.x - vp.x) * Math.min(1, dt * 3);
              vp.z += (g.position.z - vp.z) * Math.min(1, dt * 3);
              vp.y += dt * 3;
              if (victim!.kind === 'animal') { const a = victim!.a; a.root.position.copy(vp); a.yaw += dt * 4; a.root.rotation.set(0, a.yaw, 0); }
              if (vp.y > g.position.y - 1) { phase = 'leave'; if (victim!.kind === 'animal') victim!.a.root.visible = false; else if (victim!.kind === 'npc') victim!.n.char.root.scale.setScalar(0.001); }
            }
            for (let k = 0; k < 4; k++) this._fx.emit(g.position.x + rnd(-3, 3), g.position.y - rnd(0, H), g.position.z + rnd(-3, 3), 0, rnd(3, 6), 0, rnd(0.5, 1), 0.15, pick(['#7dff9a', '#c8ffd4', '#ffffff']), 0, 0.5);
          } else {
            beam.visible = false;
            g.position.y += dt * (10 + t * 2);
            g.position.x += dt * 30;
          }
        },
        end: () => {
          hum.stop();
          w.scene.remove(g);
          // Return the victim, unceremoniously, from a great height.
          if (victim && victim.kind !== 'player') {
            const vp = this._posOf(victim);
            vp.set(home.x + rnd(-3, 3), home.y + 30, home.z + rnd(-3, 3));
            const v = V(0, -2, 0);
            if (victim.kind === 'animal') { const a = victim.a; a.puppet = false; a.root.visible = true; a.launch(v); setTimeout(() => a.bark(pick(['Moo...?', '*vacant stare*', '...', '*thousand-yard stare*'])), 2500); }
            else if (victim.kind === 'npc') { const n = victim.n; n.puppet = false; n.char.root.scale.setScalar(1); n.char.root.rotation.set(0, n.yaw, 0); n.launch(v); setTimeout(() => n.bark(pick(["I've seen things.", 'They were very polite.', 'They probed my cheese.', 'I am different now.']), 4), 2500); }
            state.toast(`${vName[0].toUpperCase() + vName.slice(1)} falls out of the sky!`);
          }
        },
      };
    },
  },
  {
    id: 'quake', title: '🌋 EARTHQUAKE', sub: 'The island is having a moment.', w: 2, dur: [7, 10],
    start(this: C) {
      let next = 0, hop = 0.6;
      this.panic(this.p, 90);
      const rumble = sfx.loop('rumble', null, { vol: 2 });
      return {
        tick: (dt: number) => {
          this.shake = Math.max(this.shake, 1.3);
          if ((hop -= dt) <= 0 && this._w.canHitPlayer()) { hop = rnd(0.6, 1.4); this._w.player.launch(V(rnd(-3, 3), rnd(4, 7), rnd(-3, 3))); }
          if ((next -= dt) > 0) return;
          next = 0.08;
          const v = this._victim(70);
          if (v && v.kind !== 'player') this._launch(v, V(rnd(-3, 3), rnd(4, 9), rnd(-3, 3)));
          const s = this._spot(0, 25);
          this._fx.burst(s, 10, 4, DIRT, 0.4, 1, 1, 3);
        },
        end: () => rumble.stop(),
      };
    },
  },
  {
    id: 'storm', title: '⚡ THUNDERSTORM', sub: 'Lightning never strikes the same place twice. It strikes EVERYWHERE.', w: 3, dur: [16, 22],
    start(this: C) {
      let next = 1.2;
      this.setTint('#1a2240', 0.7);
      const rain = sfx.loop('rain', null, { vol: 0.35 });
      return {
        tick: (dt: number) => {
          if ((next -= dt) > 0) return;
          next = rnd(0.35, 1.3);
          let at: THREE.Vector3;
          const v = Math.random() < 0.35 ? this._victim(45) : null;
          if (v) { const p = this._posOf(v); at = V(p.x, floorHeight(p.x, p.z), p.z); }
          else if (this._w.canHitPlayer() && Math.random() < 0.08) at = V(this.p.x, floorHeight(this.p.x, this.p.z), this.p.z);
          else at = this._spot(3, 45);
          this.strike(at);
        },
        end: () => { rain.stop(); this.clearTint(); },
      };
    },
  },
  {
    id: 'chickens', title: '🐔 THE CHICKENS HAVE RISEN', sub: 'They remember every egg you ate.', w: 3, dur: [16, 22],
    start(this: C) {
      const w = this._w;
      const flock: Animal[] = w.animals.filter(a => a.kind === 'chicken' && !a.puppet);
      for (let i = 0; i < 14; i++) flock.push(this._spawn('chicken', this._spot(18, 30), 40, 6));
      flock.forEach(a => { a.puppet = true; a.root.scale.setScalar(rnd(1.8, 3.2)); a.bark('BAWK!!!'); });
      let hitCd = 0;
      return {
        tick: (dt: number) => {
          hitCd -= dt;
          for (const a of flock) {
            if (!a.puppet) continue;
            const dx = this.p.x - a.pos.x, dz = this.p.z - a.pos.z, d = Math.hypot(dx, dz);
            const yaw = Math.atan2(dx, dz) + Math.sin(state.clock * 3 + a.pos.x) * 0.4;
            const sp = d > 25 ? 12 : 6.8;
            const nx = a.pos.x + Math.sin(yaw) * sp * dt, nz = a.pos.z + Math.cos(yaw) * sp * dt;
            if (!isWet(nx, nz) && d > 1.2) { a.pos.x = nx; a.pos.z = nz; }
            a.pos.y = floorHeight(a.pos.x, a.pos.z);
            a.puppetStep(dt, d > 1.2 ? sp : 0, yaw);
            a.root.position.y += Math.abs(Math.sin(state.clock * 14 + a.pos.z)) * 0.3;
            if (Math.random() < dt * 0.25) a.bark(pick(['BAWK!!!', 'BOK BOK BOK!', 'VENGEANCE!', 'For the coop!', 'CLUCK YOU!']));
            if (d < 2 && hitCd <= 0 && w.canHitPlayer()) {
              hitCd = 0.9;
              w.player.launch(V(dx / d * 9, 6, dz / d * 9));
              this._fx.burst(this.p.clone().setY(this.p.y + 1), 25, 5, ['#ffffff', '#f2ead8', '#e8d8b0'], 0.2, 1.4, 0.15);
            }
          }
        },
        end: () => flock.forEach(a => { a.puppet = false; a.root.scale.setScalar(1); a.bark('...bok.'); }),
      };
    },
  },
  {
    id: 'disco', title: '🪩 SPONTANEOUS DISCO', sub: 'Nobody knows where the music is coming from.', w: 2, dur: [16, 22],
    start(this: C) {
      this.setDisco(true);
      const music = sfx.loop('disco', null, { vol: 0.9 });
      let next = 0, boom = 0;
      return {
        tick: (dt: number) => {
          state.party = { x: this.p.x, z: this.p.z, until: state.clock + 1 };
          if ((boom -= dt) <= 0) {
            boom = 0.47;
            this.shake = Math.max(this.shake, 0.25);
            this._fx.burst(this.p.clone().add(V(rnd(-10, 10), rnd(6, 12), rnd(-10, 10))), 60, 10, CONFETTI, 0.25, 2, 0.1);
          }
          if ((next -= dt) > 0) return;
          next = 0.6;
          for (const n of this._w.npcs) {
            if (n.atHome || n.air || n.puppet || n.mode === 'talk' || flat(n.pos, this.p) > 45) continue;
            n.startReact(Math.random() < 0.8 ? 'dance' : 'cheer', 0.7, this.p, Math.random() < 0.06 ? pick(['WOOOO!', 'I can\'t stop!', 'My legs have a mind of their own!', 'Is this the festival?', 'DISCO!']) : undefined);
          }
          this._bodies(this.p, 35, b => { if (b.kind === 'animal' && Math.random() < 0.25) b.a.launch(V(0, rnd(3, 6), 0)); });
        },
        end: () => { music.stop(); this.setDisco(false); state.party = null; },
      };
    },
  },
  {
    id: 'gravity', title: '🌌 GRAVITY HAS STOPPED WORKING', sub: 'Please remain calm and do not drift into space.', w: 2, dur: [12, 16],
    start(this: C) {
      state.gravity = 0.08;
      sfx.play('zap', null, { vol: 0.6 });
      const hum = sfx.loop('hum', null, { vol: 0.35 });
      this.setTint('#6a4aa8', 0.35);
      this._bodies(this.p, 70, b => this._launch(b, V(rnd(-1, 1), rnd(3, 7), rnd(-1, 1))));
      return {
        tick: (_dt: number, t: number) => {
          if (Math.random() < 0.02) { const v = this._victim(60); if (v) this._launch(v, V(rnd(-1, 1), rnd(3, 6), rnd(-1, 1))); }
          if (t > 2 && Math.random() < 0.01) this._w.npcs.find(n => n.air && Math.random() < 0.3)?.bark(pick(['I\'m floating!', 'Wheeee!', 'I can see my house!', 'How do I get DOWN?', 'This is the best day of my life.']), 3);
        },
        end: () => { hum.stop(); state.gravity = 1; this.clearTint(); state.toast('Gravity is back. Brace for landing.'); },
      };
    },
  },
  {
    id: 'geysers', title: '💦 GEYSERS!', sub: 'The ground is very, very angry.', w: 2, dur: [14, 18],
    start(this: C) {
      const gs: { p: THREE.Vector3; warn: number; blow: number }[] = [];
      const hiss = sfx.loop('hiss', null, { vol: 0 });
      for (let i = 0; i < 9; i++) gs.push({ p: i === 0 ? this._spot(0, 3) : this._spot(3, 28), warn: rnd(1, 9), blow: rnd(2.5, 4) });
      return {
        tick: (dt: number) => {
          let near = 99;
          for (const g of gs) if (g.warn <= 0 && g.blow > 0) near = Math.min(near, flat(g.p, this.p));
          hiss.setVolume(Math.max(0, 0.6 - near / 60));
          for (const g of gs) {
            const p = g.p;
            if (g.warn > 0) {
              g.warn -= dt;
              if (Math.random() < 0.6) this._fx.emit(p.x + rnd(-1, 1), p.y + 0.1, p.z + rnd(-1, 1), 0, rnd(1, 3), 0, 0.5, 0.25, pick(WATERC), 0.5, 1);
              if (g.warn <= 0) { sfx.play('splash', p, { range: 90, vol: 1.2 }); this.shake = Math.max(this.shake, Math.max(0, 1 - flat(p, this.p) / 30)); this.panic(p, 15, ['Is the ground... gurgling?', 'WATER!', 'Sploosh!']); }
            } else if (g.blow > 0) {
              g.blow -= dt;
              for (let k = 0; k < 10; k++) this._fx.emit(p.x + rnd(-0.6, 0.6), p.y, p.z + rnd(-0.6, 0.6), rnd(-1.5, 1.5), rnd(25, 38), rnd(-1.5, 1.5), rnd(1, 1.6), rnd(0.3, 0.6), pick(WATERC), 1, 0.2);
              this._bodies(p, 2.4, b => this._launch(b, V(rnd(-3, 3), rnd(22, 30), rnd(-3, 3))));
            }
          }
        },
        end: () => hiss.stop(),
      };
    },
  },
  {
    id: 'bloodmoon', title: '🌕 BLOOD MOON', sub: 'The animals are acting strange.', w: 2, dur: [18, 24],
    start(this: C) {
      this.setTint('#8a0f12', 0.75);
      const followers = this._w.animals.filter(a => !a.spec.fly && !a.puppet && !a.lost && flat(a.pos, this.p) < 70);
      followers.forEach(a => { a.follow = { target: this.p, until: state.clock + 22 }; });
      let next = 0;
      return {
        tick: (dt: number) => {
          if ((next -= dt) > 0) return;
          next = rnd(0.5, 1.2);
          const a = pick(followers);
          a?.bark(pick(['...', 'The moon calls.', 'We see you.', 'Join us.', 'It is time.', '*stares*', 'Moo.']));
          const n = pick(this._w.npcs);
          if (n && !n.atHome && flat(n.pos, this.p) < 40) n.bark(pick(['The moon... it\'s RED.', 'Why is the cat looking at me like that?', 'Lock the doors!', 'The sheep are WHISPERING.', 'I don\'t like this.']), 3);
        },
        end: () => { this.clearTint(); followers.forEach(a => { if (a.follow) a.follow.until = state.clock; }); },
      };
    },
  },
  {
    id: 'fireworks', title: '🎆 FIREWORKS MISFIRE', sub: 'Fennick was in charge of safety.', w: 2, dur: [10, 14],
    start(this: C) {
      let next = 0;
      return {
        tick: (dt: number) => {
          if ((next -= dt) > 0) return;
          next = rnd(0.08, 0.3);
          const from = this._spot(2, 20);
          from.y += 0.5;
          const a = Math.random() * Math.PI * 2;
          const v = V(Math.cos(a) * rnd(4, 18), rnd(8, 24), Math.sin(a) * rnd(4, 18));
          this._fire(from, v, pick(rocketMats), 0.3, { firework: true, fuse: rnd(0.8, 2.2), grav: 0.6, trail: ['#ffe066', '#ffffff', '#ffb02e'], power: 8, radius: 4 });
        },
      };
    },
  },
];
