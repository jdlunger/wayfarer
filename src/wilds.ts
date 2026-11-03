import * as THREE from 'three';
import { Character, CharStyle, Pose, PropKind, placeTumbling } from './character';
import { floorHeight, groundHeight, isWet, WORLD_LIMIT, VILLAGE_R } from './terrain';
import { isBlocked } from './colliders';
import { state } from './state';
import { sfx } from './audio';
import type { Flingable } from './chaos';
import type { Railway, Crossing } from './railway';
import type { Animal } from './animals';

/**
 * Life beyond the village: travellers, hermits and oddballs wandering the countryside,
 * herds that migrate back and forth over the railway, and a hot-air balloon drifting overhead.
 */

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]): T => xs[(Math.random() * xs.length) | 0];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

/** Random dry, open spots in the countryside, spread apart. */
export function outbackSpots(n: number, minR = 72, maxR = 205, gap = 22): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let tries = 0; tries < n * 60 && out.length < n; tries++) {
    const a = Math.random() * Math.PI * 2, r = rnd(minR, maxR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = groundHeight(x, z);
    if (h < 1.5 || h > 30 || isWet(x, z) || isBlocked(x, z, 1.5)) continue;
    if (out.some(p => Math.hypot(p.x - x, p.z - z) < gap)) continue;
    out.push(V(x, h, z));
  }
  return out;
}

type Habit = 'roam' | 'commute' | 'jog' | 'linger';
interface Role {
  name: string;
  style: CharStyle;
  habit: Habit;
  speed: number;
  /** What they do when they stop. */
  pose: Pose;
  prop?: PropKind;
  /** Carried while walking. */
  walkProp?: PropKind;
  /** Chance they cut straight over the line instead of using a crossing. */
  jaywalk: number;
  lines: string[];
}

const ROLES: Role[] = [
  { name: 'Odo the Hiker', habit: 'roam', speed: 1.9, pose: 'look', jaywalk: 0.3, style: { skin: '#e0ac85', shirt: '#4a7a3a', pants: '#5a4a32', hair: '#5a3a20', hat: '#6a5a3a' },
    lines: ['Lovely day for a ramble!', 'I\'ve walked round this island 312 times.', 'Have you seen the view from the hills?', 'My boots have boots.'] },
  { name: 'Mags the Forager', habit: 'roam', speed: 1.4, pose: 'reach', walkProp: 'basket', prop: 'basket', jaywalk: 0.4, style: { skin: '#c68a62', shirt: '#a85ab0', pants: '#3a3a3a', hair: '#a04a20' },
    lines: ['Don\'t eat the purple ones.', 'Mushrooms are just the forest\'s gossip.', 'Ooh, wild garlic!', 'This one\'s either delicious or deadly.'] },
  { name: 'Grimsby the Woodcutter', habit: 'roam', speed: 1.5, pose: 'chop', prop: 'axe', walkProp: 'axe', jaywalk: 0.6, style: { skin: '#f1c9a5', shirt: '#b04050', pants: '#2a4a3a', hair: '#2a1a10', beard: '#2a1a10', scale: 1.08 },
    lines: ['Timber!', 'Don\'t tell the trees I\'m coming.', 'Chop chop.', 'Every tree has a story. Then I chop it.'] },
  { name: 'Wandering Wilbur', habit: 'roam', speed: 1.2, pose: 'lute', prop: 'lute', jaywalk: 0.7, style: { skin: '#e9c09a', shirt: '#d8a03a', pants: '#6a4a8a', hair: '#c8a060', hat: '#8a2a2a' },
    lines: ['♪ Oh the train goes round and round... ♪', '♪ Fa la la, the frogs fell down... ♪', 'Requests? No? Fine.', '♪ A ballad of a brave wayfarer! ♪'] },
  { name: 'Sister Thessaly', habit: 'roam', speed: 1.0, pose: 'read', jaywalk: 0.2, style: { skin: '#8d5a3b', shirt: '#3a4a6a', pants: '#3a4a6a', hair: '#e8e0d0', robe: true },
    lines: ['The stars are restless tonight.', 'I read that a meteor is just a rock with ambition.', 'Peace be with you. And with your hat.', 'Hush. The hills are listening.'] },
  { name: 'Old Moss the Hermit', habit: 'linger', speed: 0.8, pose: 'sitGround', jaywalk: 0.5, style: { skin: '#e0ac85', shirt: '#5a5040', pants: '#4a3a2a', hair: '#888', beard: '#bbb', robe: true },
    lines: ['Get off my hill.', 'I came out here for the quiet. Then they built a railway.', 'Hmph.', 'The village? Too many people. Eleven, at least.'] },
  { name: 'Postie Pell', habit: 'commute', speed: 3.2, pose: 'wave', walkProp: 'crate', jaywalk: 0.5, style: { skin: '#f1c9a5', shirt: '#c8302a', pants: '#1f3a5a', hair: '#1a1a1a', hat: '#c8302a' },
    lines: ['Parcel for... hang on.', 'Neither rain nor frogs shall stop me!', 'Sign here! No time! Bye!', 'Every house, every day. Even the hermit.'] },
  { name: 'Farmer Hobb', habit: 'commute', speed: 1.5, pose: 'hoe', prop: 'hoe', walkProp: 'hoe', jaywalk: 0.8, style: { skin: '#c68a62', shirt: '#5a9a4a', pants: '#4a3a2a', hair: '#5a3a20', hat: '#d8c890' },
    lines: ['Crops won\'t grow themselves. Well, they do. But slowly.', 'Shortcut over the tracks. Always works.', 'Turnips. Ask me about turnips.', 'That train scared my goats again.'] },
  { name: 'Bess the Milkmaid', habit: 'commute', speed: 1.6, pose: 'wave', walkProp: 'bucket', jaywalk: 0.3, style: { skin: '#f1c9a5', shirt: '#e8e0d0', pants: '#3d7ac8', hair: '#c8a060' },
    lines: ['Fresh milk! Fresh-ish!', 'The cows out here are wilder than the village ones.', 'Mind the bucket!', 'Morning! Or is it?'] },
  { name: 'Sprinting Sal', habit: 'jog', speed: 5.2, pose: 'cheer', jaywalk: 0.9, style: { skin: '#5e3b26', shirt: '#38a8a0', pants: '#2a2a2a', hair: '#1a1a1a' },
    lines: ['Can\'t stop! Training!', 'Lap forty-two!', 'Race you to the coast!', 'Personal best! Probably!'] },
  { name: 'Kip', habit: 'jog', speed: 4.2, pose: 'cheer', jaywalk: 1, style: { skin: '#e0ac85', shirt: '#ff8c42', pants: '#2f3e57', hair: '#a04a20', scale: 0.72 },
    lines: ['I\'m chasing a butterfly!', 'Mum says don\'t play on the tracks!', 'Wheeee!', 'Bet you can\'t catch me!'] },
  { name: 'Percival, Explorer', habit: 'roam', speed: 1.6, pose: 'look', jaywalk: 0.2, style: { skin: '#f1c9a5', shirt: '#d8c890', pants: '#d8c890', hair: '#888', hat: '#d8c890', beard: '#888' },
    lines: ['Fascinating! A rock!', 'I shall name this hill "Percival\'s Hill".', 'My map says there\'s a sea monster here.', 'Onwards, to the unknown! Or that tree.'] },
  { name: 'Nell the Painter', habit: 'linger', speed: 1.2, pose: 'sit', jaywalk: 0.3, style: { skin: '#c68a62', shirt: '#6a4a8a', pants: '#2a4a3a', hair: '#2a1a10', hat: '#2a2a3a' },
    lines: ['Hold still, you\'re in my landscape.', 'The light out here is perfect.', 'I paint the trains. They never sit still.', 'Is that a cloud or a sheep?'] },
  { name: 'Tinker Jem', habit: 'commute', speed: 1.3, pose: 'hammer', prop: 'hammer', walkProp: 'logs', jaywalk: 0.6, style: { skin: '#8d5a3b', shirt: '#6a6e74', pants: '#3a3a3a', hair: '#1a1a1a', hat: '#4b3a2a' },
    lines: ['Pots mended! Kettles fixed! Trains... no.', 'I can fix anything. Except that.', 'Got any broken things? I love broken things.', 'Clank clank.'] },
];

export class Traveller implements Flingable {
  readonly char: Character;
  readonly pos: THREE.Vector3;
  readonly label: HTMLDivElement;
  private bubble: HTMLDivElement;
  private barkT = 0;
  private barkCd = rnd(5, 20);
  private path: THREE.Vector3[] = [];
  private pauseT = rnd(0, 6);
  private yaw = Math.random() * Math.PI * 2;
  private hurry = 0;
  private sore = 0;
  private air: { v: THREE.Vector3; spin: number } | null = null;
  /** Which crossing they're waiting at, if any. */
  private waitAt: Crossing | null = null;
  private legs = 0;
  active = true;

  constructor(readonly role: Role, start: THREE.Vector3, scene: THREE.Scene, labels: HTMLElement, private rail: Railway, private home: THREE.Vector3) {
    this.char = new Character(role.style);
    this.pos = V(start.x, floorHeight(start.x, start.z), start.z);
    scene.add(this.char.root);
    this.label = document.createElement('div');
    this.label.className = 'label';
    this.bubble = document.createElement('div');
    this.bubble.className = 'bubble';
    const n = document.createElement('div');
    n.className = 'name';
    n.textContent = role.name;
    this.label.append(this.bubble, n);
    labels.append(this.label);
  }

  get name() { return this.role.name; }
  get airborne() { return this.air !== null; }

  bark(text = pick(this.role.lines), dur = 3.5) {
    this.bubble.textContent = text;
    this.label.classList.add('barking');
    this.barkT = dur;
    this.barkCd = rnd(18, 35);
  }

  /** Talk when the player presses E. */
  chat(from: THREE.Vector3) {
    this.yaw = Math.atan2(from.x - this.pos.x, from.z - this.pos.z);
    this.bark();
    this.pauseT = Math.max(this.pauseT, 3);
  }

  launch(v: THREE.Vector3) {
    if (this.air) { this.air.v.add(v); return; }
    this.air = { v: v.clone(), spin: 0 };
    this.pos.y += 0.05;
    this.waitAt = null;
    if (v.y > 6) this.bark(pick(['AAAAAH!', 'Not again!', 'WHEEEE!', 'My hat!', 'I regret everything!']), 2.5);
  }

  scare(from: THREE.Vector3, line?: string) {
    if (this.air) return;
    this.hurry = 2.5;
    if (line) this.bark(line, 2);
    // Step back off the line if they're right on it.
    const pr = this.rail.track.project(this.pos.x, this.pos.z);
    if (pr.d < 2.2) {
      const tp = this.rail.track.pos(pr.s);
      const away = V(this.pos.x - tp.x, 0, this.pos.z - tp.z);
      if (away.lengthSq() < 0.01) away.set(this.pos.x - from.x, 0, this.pos.z - from.z);
      away.normalize().multiplyScalar(4).add(tp);
      this.path.unshift(away);
    }
  }

  /** Pick the next leg of the journey. */
  private plan(spots: THREE.Vector3[]) {
    const R = this.role;
    let dest: THREE.Vector3;
    const ang = Math.atan2(this.pos.z, this.pos.x);
    switch (R.habit) {
      case 'commute': {
        // Back and forth between the village edge and the fields beyond the line.
        const inside = this.rail.sideOf(this.pos.x, this.pos.z) < 0;
        dest = inside ? (this.legs % 2 ? this.home.clone() : pick(spots)) : this.rail.besideLine(ang + rnd(-0.5, 0.5), -rnd(5, 9));
        break;
      }
      case 'jog': {
        // Big zig-zags back and forth over the line.
        const a = ang + rnd(0.35, 0.8) * (this.legs % 3 === 2 ? -1 : 1);
        const out = this.rail.sideOf(this.pos.x, this.pos.z) < 0;
        dest = this.rail.besideLine(a, out ? rnd(10, 40) : -rnd(5, 9));
        break;
      }
      case 'linger':
        dest = this.home.clone().add(V(rnd(-6, 6), 0, rnd(-6, 6)));
        break;
      default:
        dest = Math.random() < 0.35 ? this.rail.besideLine(ang + rnd(-0.6, 0.6), -rnd(5, 9)) : pick(spots);
    }
    if (isWet(dest.x, dest.z) || Math.hypot(dest.x, dest.z) > WORLD_LIMIT - 4 || Math.hypot(dest.x, dest.z) < VILLAGE_R + 2) dest = this.home.clone();
    this.legs++;
    const path: THREE.Vector3[] = [];
    const s0 = this.rail.sideOf(this.pos.x, this.pos.z), s1 = this.rail.sideOf(dest.x, dest.z);
    if (s0 !== s1 && Math.random() > R.jaywalk) {
      // Go round by the nearest level crossing.
      const mid = V((this.pos.x + dest.x) / 2, 0, (this.pos.z + dest.z) / 2);
      const c = this.rail.nearestCrossing(mid.x, mid.z);
      const r = Math.hypot(c.pos.x, c.pos.z);
      const out = V(c.pos.x / r, 0, c.pos.z / r);
      const near = c.pos.clone().addScaledVector(out, s0 * 4.5), far = c.pos.clone().addScaledVector(out, s1 * 4.5);
      if (flat(near, this.pos) < 120) path.push(near, c.pos, far);
    }
    path.push(dest);
    this.path = path;
  }

  update(dt: number, spots: THREE.Vector3[], player: THREE.Vector3) {
    if (this.barkT > 0 && (this.barkT -= dt) <= 0) this.label.classList.remove('barking');
    this.barkCd -= dt;
    this.hurry = Math.max(0, this.hurry - dt);
    const R = this.role;
    const root = this.char.root;

    if (this.air) {
      const a = this.air;
      a.v.y -= 24 * state.gravity * dt;
      a.v.x *= Math.exp(-dt * 0.3); a.v.z *= Math.exp(-dt * 0.3);
      this.pos.addScaledVector(a.v, dt);
      const r = Math.hypot(this.pos.x, this.pos.z);
      if (r > WORLD_LIMIT) { this.pos.x *= WORLD_LIMIT / r; this.pos.z *= WORLD_LIMIT / r; }
      a.spin += dt * 8;
      const floor = floorHeight(this.pos.x, this.pos.z);
      if (this.pos.y <= floor && a.v.y < 0) {
        this.pos.y = floor;
        this.air = null;
        if (a.v.y < -8) sfx.play('thud', this.pos, { range: 50 });
        this.sore = 2.5;
        this.path = [];
        this.pauseT = 3;
        root.rotation.set(0, this.yaw, 0);
        setTimeout(() => this.bark(pick(['Ow.', 'I\'m fine! I\'m fine.', 'Where am I?', 'That\'s one way to travel.', 'Ugh. My everything.'])), 700);
      } else {
        placeTumbling(root, this.pos, this.yaw, a.spin, a.spin * 0.4, 0.95);
        this.char.animate(dt, 0, true, false, 'scared');
        this.char.setGroundOffset(floor - this.pos.y);
        return;
      }
    }

    let speed = 0;
    let pose: Pose = 'none';
    if (this.sore > 0) {
      this.sore -= dt;
      pose = 'sitGround';
    } else if (this.path.length) {
      const tgt = this.path[0];
      // At a crossing: wait for the train to pass.
      const c = this.rail.crossings.find(x => x.pos === tgt);
      if (c && c.ringing && flat(this.pos, tgt) < 6 && this.hurry <= 0) {
        if (this.waitAt !== c) { this.waitAt = c; if (Math.random() < 0.5) this.bark(pick(['Train coming. I\'ll wait.', 'Here it comes!', 'Choo choo!', 'Patience...'])); }
        pose = 'look';
        const tp = this.rail.track.pos(c.s);
        this.yaw = turn(this.yaw, Math.atan2(tp.x - this.pos.x, tp.z - this.pos.z) + 0.8, dt * 3);
      } else {
        this.waitAt = null;
        const dx = tgt.x - this.pos.x, dz = tgt.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.4) this.path.shift();
        else {
          speed = R.speed * (this.hurry > 0 ? 2.2 : 1);
          const step = Math.min(d, speed * dt);
          this.pos.x += dx / d * step; this.pos.z += dz / d * step;
          this.yaw = turn(this.yaw, Math.atan2(dx, dz), dt * 8);
        }
        if (!this.path.length) this.pauseT = R.habit === 'jog' ? rnd(0.5, 2) : R.habit === 'linger' ? rnd(10, 25) : rnd(5, 14);
      }
      this.char.setProp(speed > 0 ? R.walkProp ?? null : R.prop ?? null);
    } else {
      pose = R.pose;
      this.char.setProp(R.prop ?? null);
      if ((this.pauseT -= dt) <= 0) this.plan(spots);
    }

    // Look at, and sometimes greet, the player when close.
    const dP = flat(this.pos, player);
    if (dP < 9 && !speed && pose !== 'chop' && pose !== 'lute' && pose !== 'sitGround' && pose !== 'sit') this.yaw = turn(this.yaw, Math.atan2(player.x - this.pos.x, player.z - this.pos.z), dt * 3);
    if (dP < 12 && this.barkCd <= 0 && Math.random() < dt * 0.4) this.bark();

    this.pos.y = floorHeight(this.pos.x, this.pos.z);
    root.position.copy(this.pos);
    root.rotation.set(0, this.yaw, 0);
    this.char.animate(dt, speed * 0.75, false, false, speed ? 'none' : pose);
    this.char.setGroundOffset(0);
  }
}

function turn(from: number, to: number, k: number) {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return from + d * Math.min(1, k);
}

// ---------- Hot-air balloon ----------
function buildBalloon(): THREE.Group {
  const g = new THREE.Group();
  const stripes = ['#e84a3a', '#ffd23f', '#3d7ac8', '#f4efe6'];
  for (let i = 0; i < 8; i++) {
    const seg = new THREE.Mesh(
      new THREE.SphereGeometry(4, 6, 10, i / 8 * Math.PI * 2, Math.PI * 2 / 8, 0, Math.PI * 0.78),
      new THREE.MeshLambertMaterial({ color: stripes[i % stripes.length], side: THREE.DoubleSide, flatShading: true }),
    );
    seg.scale.set(1, 1.2, 1);
    seg.castShadow = true;
    g.add(seg);
  }
  const basket = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 1.6), new THREE.MeshLambertMaterial({ color: '#8a6a3a' }));
  basket.position.y = -7.2;
  basket.castShadow = true;
  g.add(basket);
  const ropeMat = new THREE.MeshLambertMaterial({ color: '#4a3a2a' });
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, 3.6, 0.05), ropeMat);
    r.position.set(x * 1.6, -5, z * 1.6);
    r.rotation.set(-z * 0.35, 0, x * 0.35);
    g.add(r);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 6), new THREE.MeshBasicMaterial({ color: '#ffb02e' }));
  flame.position.y = -5.6;
  flame.name = 'flame';
  g.add(flame);
  return g;
}

// ---------- The countryside director ----------
export class Wilds {
  readonly travellers: Traveller[] = [];
  private spots: THREE.Vector3[];
  private herdT = 25;
  private balloon: THREE.Group;
  private balloonA = Math.random() * Math.PI * 2;
  private passengers: Character[] = [];

  constructor(scene: THREE.Scene, labels: HTMLElement, private rail: Railway, private animals: Animal[], spots: THREE.Vector3[]) {
    this.spots = spots;
    let commuters = 0;
    ROLES.forEach((role, i) => {
      const home = role.habit === 'commute'
        ? rail.besideLine(commuters++ * Math.PI / 2 + 0.4, -rnd(5, 8))
        : spots[(i * 7 + 3) % spots.length].clone().add(V(rnd(-4, 4), 0, rnd(-4, 4)));
      if (isWet(home.x, home.z)) home.copy(spots[i % spots.length]);
      this.travellers.push(new Traveller(role, home, scene, labels, rail, home));
    });

    this.balloon = buildBalloon();
    for (const [x, s] of [[-0.35, 0], [0.4, 1]] as const) {
      const c = new Character([{ skin: '#f1c9a5', shirt: '#3d7ac8', pants: '#2f3e57', hair: '#c8a060', hat: '#2a2a3a' }, { skin: '#c68a62', shirt: '#c8553d', pants: '#4a3a2a', hair: '#1a1a1a' }][s]);
      c.root.scale.setScalar(0.7);
      c.root.position.set(x, -7.9, 0);
      c.setBlobVisible(false);
      this.balloon.add(c.root);
      this.passengers.push(c);
    }
    scene.add(this.balloon);
  }

  update(dt: number, player: THREE.Vector3) {
    for (const t of this.travellers) {
      const near = flat(t.pos, player) < 150 || t.airborne;
      t.active = near;
      t.char.root.visible = near;
      if (near) t.update(dt, this.spots, player);
    }
    this.migrate(dt, player);

    // Balloon drifts in a big lazy loop over the island.
    this.balloonA += dt * 0.012;
    const r = 120 + Math.sin(this.balloonA * 2.3) * 40;
    const x = Math.cos(this.balloonA) * r, z = Math.sin(this.balloonA) * r;
    const y = Math.max(groundHeight(x, z), 0) + 45 + Math.sin(performance.now() * 0.0003) * 4;
    this.balloon.position.set(x, y, z);
    this.balloon.rotation.y += dt * 0.05;
    const flame = this.balloon.getObjectByName('flame')!;
    flame.visible = Math.sin(performance.now() * 0.0011) > 0.3;
    flame.scale.setScalar(0.8 + Math.random() * 0.4);
    const t = performance.now() / 1000;
    this.passengers.forEach((c, i) => c.animate(dt, 0, false, false, Math.sin(t * 0.3 + i * 2) > 0.4 ? 'wave' : 'look'));
  }

  /** Every so often a herd near the player decides the grass is greener over the line. */
  private migrate(dt: number, player: THREE.Vector3) {
    if ((this.herdT -= dt) > 0) return;
    this.herdT = rnd(22, 40);
    const T = this.rail.track;
    const candidates = this.animals.filter(a => !a.spec.fly && !a.spec.swim && !a.lost && !a.follow && !a.puppet && !a.air && a.name === undefined
      && flat(a.pos, player) < 85 && T.project(a.pos.x, a.pos.z).d < 45 && Math.hypot(a.home.x, a.home.z) > VILLAGE_R + 4);
    const lead = pick(candidates);
    if (!lead) return;
    const herd = this.animals.filter(a => a.kind === lead.kind && !a.lost && !a.follow && !a.puppet && a.name === undefined && flat(a.home, lead.home) < 3 && flat(a.pos, lead.pos) < 25);
    const side = this.rail.sideOf(lead.pos.x, lead.pos.z);
    const ang = Math.atan2(lead.pos.z, lead.pos.x) + rnd(-0.15, 0.15);
    const dest = this.rail.besideLine(ang, -side * rnd(9, 22));
    if (isWet(dest.x, dest.z) || Math.hypot(dest.x, dest.z) < VILLAGE_R + 3) return;
    for (const a of herd) {
      a.home.set(dest.x, 0, dest.z);
      const spot = dest.clone().add(V(rnd(-3, 3), 0, rnd(-3, 3)));
      setTimeout(() => a.goTo(spot, 50), rnd(0, 2500));
    }
  }
}
