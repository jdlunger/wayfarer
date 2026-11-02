import * as THREE from 'three';
import { bake, charMat, Piece, SHAPES } from './character';
import { floorHeight, isWet, inPond, POND, groundNormalY } from './terrain';
import { resolve } from './colliders';
import { state, take, Item, ITEMS } from './state';
import { svc } from './interact';

const { BOX } = SHAPES;

export type AnimalKind = 'chicken' | 'dog' | 'cat' | 'sheep' | 'cow' | 'pig' | 'deer' | 'rabbit' | 'frog' | 'duck' | 'gull' | 'pigeon';
type Act = 'none' | 'graze' | 'peck' | 'sit' | 'sleep' | 'look';

interface Spec {
  name: string;
  walk: number;
  run: number;
  /** Distance at which it bolts from the player when [walking, running]. 0 = never. */
  flee: [number, number];
  sounds: string[];
  likes?: Item;
  idle: Act[];
  range: number;
  hop?: number;
  swim?: boolean;
  fly?: boolean;
  /** Scared of the dog. */
  timid?: boolean;
}

const SPEC: Record<AnimalKind, Spec> = {
  chicken: { name: 'chicken', walk: 0.9, run: 3.8, flee: [1.4, 5], sounds: ['Bawk!', 'Cluck cluck.', 'Bok?', 'BAWK!'], likes: 'berries', idle: ['peck', 'peck', 'look'], range: 6, timid: true },
  dog: { name: 'dog', walk: 2.0, run: 6.5, flee: [0, 0], sounds: ['Woof!', 'Arf arf!', '*pant pant*', 'Wruff?'], idle: ['sit', 'look', 'sleep'], range: 14 },
  cat: { name: 'cat', walk: 1.1, run: 5, flee: [0, 3.2], sounds: ['Mrrp.', 'Meow.', '*purr*', 'Mew?'], likes: 'fish', idle: ['sleep', 'sit', 'sit', 'look'], range: 8, timid: true },
  sheep: { name: 'sheep', walk: 0.8, run: 3, flee: [0, 3], sounds: ['Baa.', 'Baaaa!', 'Meh-eh-eh.'], likes: 'flowers', idle: ['graze', 'graze', 'look'], range: 5 },
  cow: { name: 'cow', walk: 0.7, run: 2.4, flee: [0, 0], sounds: ['Moo.', 'Mooooo.', '*chews*'], likes: 'apples', idle: ['graze', 'graze', 'look'], range: 5 },
  pig: { name: 'pig', walk: 0.9, run: 3, flee: [0, 2.2], sounds: ['Oink!', 'Snrk snrk.', 'Oink oink?'], likes: 'mushrooms', idle: ['graze', 'sleep', 'look'], range: 1.8 },
  deer: { name: 'deer', walk: 1.2, run: 7.5, flee: [6, 16], sounds: ['*snort*', '*sniff*'], likes: 'apples', idle: ['graze', 'graze', 'look'], range: 14 },
  rabbit: { name: 'rabbit', walk: 1.6, run: 6, flee: [3.5, 10], sounds: ['*sniff sniff*', '*thump*'], likes: 'berries', idle: ['graze', 'look', 'sit'], range: 10, hop: 0.22, timid: true },
  frog: { name: 'frog', walk: 1.4, run: 3.4, flee: [1.3, 3], sounds: ['Ribbit.', 'Croak!', 'Rrrbt.'], idle: ['sit', 'sit', 'look'], range: 6, hop: 0.3 },
  duck: { name: 'duck', walk: 0.8, run: 2.4, flee: [1.5, 3.5], sounds: ['Quack!', 'Quack quack.', '*splash*'], likes: 'berries', idle: ['look', 'peck'], range: 4, swim: true },
  gull: { name: 'gull', walk: 4, run: 6, flee: [0, 0], sounds: ['Caw!', 'Kee-ow!', 'Caw caw!'], idle: ['none'], range: 14, fly: true },
  pigeon: { name: 'pigeon', walk: 0.9, run: 3, flee: [1.2, 4], sounds: ['Coo.', 'Coo-roo.', '*flap flap*'], likes: 'berries', idle: ['peck', 'peck', 'look'], range: 5, timid: true },
};

interface Parts {
  model: THREE.Group;
  legs: THREE.Group[];
  head: THREE.Group;
  tail?: THREE.Group;
  wings?: THREE.Group[];
  legH: number;
  height: number;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function part(parent: THREE.Object3D, key: string, pieces: Piece[], x = 0, y = 0, z = 0): THREE.Group {
  let geo = geoCache.get(key);
  if (!geo) geoCache.set(key, (geo = bake(pieces)));
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const m = new THREE.Mesh(geo, charMat);
  m.castShadow = true;
  g.add(m);
  parent.add(g);
  return g;
}

interface QuadOpts {
  bw: number; bh: number; bl: number; legH: number; legW: number;
  body: string; leg: string; head: string; hs: number; neckUp?: number;
  headPieces?: (hy: number, front: number) => Piece[];
  bodyExtra?: (by: number) => Piece[];
  tail?: Piece[]; tailTilt?: number;
}
function quad(key: string, o: QuadOpts): Parts {
  const model = new THREE.Group();
  const by = o.legH + o.bh / 2;
  part(model, key + 'b', [[BOX, o.body, 0, by, 0, o.bw, o.bh, o.bl], ...(o.bodyExtra?.(by) ?? [])]);
  const lx = o.bw / 2 - o.legW / 2, lz = o.bl / 2 - o.legW * 0.8;
  const legs = [[-lx, lz], [lx, lz], [-lx, -lz], [lx, -lz]].map(([x, z]) =>
    part(model, key + 'l', [[BOX, o.leg, 0, -o.legH / 2, 0, o.legW, o.legH, o.legW]], x, o.legH, z));
  const hy = o.hs * 0.2 + (o.neckUp ?? 0), hz = o.hs * 0.45;
  const head = part(model, key + 'h', [[BOX, o.head, 0, hy, hz, o.hs, o.hs, o.hs * 1.1], ...(o.headPieces?.(hy, hz + o.hs * 0.55) ?? [])], 0, by + o.bh * 0.3, o.bl / 2);
  let tail: THREE.Group | undefined;
  if (o.tail) {
    tail = part(model, key + 't', o.tail, 0, by + o.bh * 0.3, -o.bl / 2);
    tail.children[0].rotation.x = o.tailTilt ?? -0.6;
  }
  return { model, legs, head, tail, legH: o.legH, height: by + o.bh / 2 + o.hs + (o.neckUp ?? 0) };
}

interface BirdOpts { bw: number; bh: number; bl: number; legH: number; body: string; head: string; hs: number; beak: string; leg: string; wing: string; span: number; headExtra?: Piece[]; tail?: Piece[] }
function bird(key: string, o: BirdOpts): Parts {
  const model = new THREE.Group();
  const by = o.legH + o.bh / 2;
  part(model, key + 'b', [[BOX, o.body, 0, by, 0, o.bw, o.bh, o.bl], ...(o.tail ?? []).map(p => [p[0], p[1], p[2], p[3] + by, p[4] - o.bl / 2, p[5], p[6], p[7]] as Piece)]);
  const legs = [-1, 1].map(s => part(model, key + 'l', [[BOX, o.leg, 0, -o.legH / 2, 0, 0.035, o.legH, 0.035], [BOX, o.leg, 0, -o.legH + 0.01, 0.03, 0.08, 0.02, 0.1]], s * o.bw * 0.22, o.legH, 0));
  const head = part(model, key + 'h', [
    [BOX, o.head, 0, o.hs * 0.5, o.hs * 0.2, o.hs, o.hs, o.hs],
    [BOX, o.beak, 0, o.hs * 0.42, o.hs * 0.2 + o.hs * 0.6, o.hs * 0.4, o.hs * 0.22, o.hs * 0.4],
    [BOX, '#111', -o.hs * 0.5, o.hs * 0.62, o.hs * 0.35, 0.02, 0.04, 0.04],
    [BOX, '#111', o.hs * 0.5, o.hs * 0.62, o.hs * 0.35, 0.02, 0.04, 0.04],
    ...(o.headExtra ?? []),
  ], 0, by + o.bh * 0.25, o.bl * 0.38);
  const wings = [-1, 1].map(s => part(model, key + 'w' + s, [[BOX, o.wing, s * o.span / 2, 0, 0, o.span, 0.04, o.bl * 0.7]], s * o.bw / 2, by + o.bh * 0.2, -0.02));
  return { model, legs, head, wings, legH: o.legH, height: by + o.bh / 2 + o.hs };
}

function build(kind: AnimalKind, v: number): Parts {
  const k = kind + v;
  switch (kind) {
    case 'dog': {
      const c = ['#c08a45', '#3a2c22', '#e8e0d0'][v % 3], d = ['#8a5a2a', '#1e1712', '#a89a88'][v % 3];
      return quad(k, {
        bw: 0.34, bh: 0.34, bl: 0.78, legH: 0.36, legW: 0.11, body: c, leg: c, head: c, hs: 0.3,
        headPieces: (hy, f) => [
          [BOX, c, 0, hy - 0.06, f + 0.07, 0.17, 0.14, 0.16], [BOX, '#161210', 0, hy - 0.01, f + 0.15, 0.07, 0.05, 0.03],
          [BOX, '#111', -0.08, hy + 0.05, f, 0.05, 0.05, 0.02], [BOX, '#111', 0.08, hy + 0.05, f, 0.05, 0.05, 0.02],
          [BOX, d, -0.13, hy + 0.08, f - 0.2, 0.07, 0.18, 0.09], [BOX, d, 0.13, hy + 0.08, f - 0.2, 0.07, 0.18, 0.09],
        ],
        tail: [[BOX, c, 0, 0.14, 0, 0.07, 0.3, 0.07]], tailTilt: -0.7,
      });
    }
    case 'cat': {
      const c = ['#d98a3a', '#7d7d80', '#2a2a2e', '#efe8dc'][v % 4];
      return quad(k, {
        bw: 0.22, bh: 0.22, bl: 0.5, legH: 0.2, legW: 0.07, body: c, leg: c, head: c, hs: 0.22,
        headPieces: (hy, f) => [
          [BOX, c, -0.07, hy + 0.14, f - 0.12, 0.06, 0.09, 0.04], [BOX, c, 0.07, hy + 0.14, f - 0.12, 0.06, 0.09, 0.04],
          [BOX, '#7acb4a', -0.055, hy + 0.03, f, 0.045, 0.04, 0.02], [BOX, '#7acb4a', 0.055, hy + 0.03, f, 0.045, 0.04, 0.02],
          [BOX, '#e89a9a', 0, hy - 0.03, f + 0.005, 0.04, 0.03, 0.02],
        ],
        tail: [[BOX, c, 0, 0.2, 0, 0.05, 0.42, 0.05]], tailTilt: -0.35,
      });
    }
    case 'sheep': {
      const wool = v === 9 ? '#d8d2c2' : '#f0ece2';
      return quad(k, {
        bw: 0.62, bh: 0.52, bl: 0.86, legH: 0.34, legW: 0.1, body: wool, leg: '#3a3330', head: '#3a3330', hs: 0.28,
        bodyExtra: by => [[BOX, wool, 0, by + 0.05, 0, 0.7, 0.48, 0.76]],
        headPieces: (hy, f) => [
          [BOX, wool, 0, hy + 0.16, f - 0.17, 0.3, 0.1, 0.22],
          [BOX, '#3a3330', -0.19, hy + 0.05, f - 0.2, 0.12, 0.06, 0.08], [BOX, '#3a3330', 0.19, hy + 0.05, f - 0.2, 0.12, 0.06, 0.08],
          [BOX, '#eee', -0.07, hy + 0.05, f, 0.05, 0.04, 0.02], [BOX, '#eee', 0.07, hy + 0.05, f, 0.05, 0.04, 0.02],
        ],
        tail: [[BOX, wool, 0, 0, -0.04, 0.12, 0.14, 0.1]], tailTilt: 0,
      });
    }
    case 'cow': {
      const spot = v % 2 ? '#6b4a2f' : '#2b2522';
      return quad(k, {
        bw: 0.72, bh: 0.66, bl: 1.45, legH: 0.62, legW: 0.16, body: '#f2efe8', leg: '#f2efe8', head: '#f2efe8', hs: 0.42,
        bodyExtra: by => [
          [BOX, spot, -0.365, by + 0.08, 0.2, 0.02, 0.32, 0.4], [BOX, spot, 0.365, by - 0.05, -0.3, 0.02, 0.36, 0.46],
          [BOX, spot, 0, by + 0.335, -0.1, 0.4, 0.02, 0.4], [BOX, '#e8a8a8', 0, by - 0.36, -0.35, 0.22, 0.08, 0.2],
        ],
        headPieces: (hy, f) => [
          [BOX, '#e8b0a8', 0, hy - 0.1, f + 0.04, 0.34, 0.2, 0.1],
          [BOX, '#e0d6bc', -0.23, hy + 0.2, f - 0.25, 0.12, 0.06, 0.06], [BOX, '#e0d6bc', 0.23, hy + 0.2, f - 0.25, 0.12, 0.06, 0.06],
          [BOX, spot, -0.25, hy + 0.08, f - 0.25, 0.1, 0.08, 0.12], [BOX, spot, 0.25, hy + 0.08, f - 0.25, 0.1, 0.08, 0.12],
          [BOX, '#111', -0.12, hy + 0.08, f, 0.06, 0.06, 0.02], [BOX, '#111', 0.12, hy + 0.08, f, 0.06, 0.06, 0.02],
        ],
        tail: [[BOX, '#f2efe8', 0, -0.25, -0.02, 0.06, 0.5, 0.06], [BOX, spot, 0, -0.52, -0.02, 0.1, 0.1, 0.1]], tailTilt: 0.05,
      });
    }
    case 'pig':
      return quad(k, {
        bw: 0.5, bh: 0.44, bl: 0.82, legH: 0.22, legW: 0.12, body: '#eaa7a2', leg: '#d98f8a', head: '#eaa7a2', hs: 0.36,
        headPieces: (hy, f) => [
          [BOX, '#d98580', 0, hy - 0.05, f + 0.04, 0.18, 0.13, 0.08], [BOX, '#8a4a48', -0.04, hy - 0.05, f + 0.085, 0.03, 0.04, 0.01], [BOX, '#8a4a48', 0.04, hy - 0.05, f + 0.085, 0.03, 0.04, 0.01],
          [BOX, '#d98f8a', -0.14, hy + 0.17, f - 0.15, 0.1, 0.06, 0.12], [BOX, '#d98f8a', 0.14, hy + 0.17, f - 0.15, 0.1, 0.06, 0.12],
          [BOX, '#111', -0.1, hy + 0.07, f, 0.04, 0.04, 0.02], [BOX, '#111', 0.1, hy + 0.07, f, 0.04, 0.04, 0.02],
        ],
        tail: [[BOX, '#d98f8a', 0, 0.06, -0.03, 0.04, 0.12, 0.04]], tailTilt: -0.8,
      });
    case 'deer': {
      const c = '#9a6a3c';
      return quad(k, {
        bw: 0.36, bh: 0.42, bl: 0.95, legH: 0.72, legW: 0.08, body: c, leg: '#7a5230', head: c, hs: 0.26, neckUp: 0.42,
        bodyExtra: by => [[BOX, '#e8dcc6', 0, by - 0.2, 0, 0.3, 0.04, 0.7]],
        headPieces: (hy, f) => [
          [BOX, c, 0, hy - 0.28, -0.02, 0.16, 0.48, 0.18],
          [BOX, '#3a2a1e', 0, hy - 0.04, f + 0.06, 0.12, 0.1, 0.1],
          [BOX, '#111', -0.1, hy + 0.05, f - 0.05, 0.04, 0.05, 0.04], [BOX, '#111', 0.1, hy + 0.05, f - 0.05, 0.04, 0.05, 0.04],
          [BOX, c, -0.15, hy + 0.12, f - 0.22, 0.12, 0.06, 0.05], [BOX, c, 0.15, hy + 0.12, f - 0.22, 0.12, 0.06, 0.05],
          ...(v % 2 === 0 ? [
            [BOX, '#d8c8a8', -0.08, hy + 0.3, f - 0.2, 0.04, 0.32, 0.04], [BOX, '#d8c8a8', 0.08, hy + 0.3, f - 0.2, 0.04, 0.32, 0.04],
            [BOX, '#d8c8a8', -0.14, hy + 0.36, f - 0.12, 0.12, 0.04, 0.04], [BOX, '#d8c8a8', 0.14, hy + 0.36, f - 0.12, 0.12, 0.04, 0.04],
          ] as Piece[] : []),
        ],
        tail: [[BOX, '#f4eee2', 0, 0.02, -0.04, 0.1, 0.14, 0.06]], tailTilt: -0.3,
      });
    }
    case 'rabbit': {
      const c = ['#a58a6a', '#e8e2d6', '#6e5a48'][v % 3];
      return quad(k, {
        bw: 0.22, bh: 0.22, bl: 0.32, legH: 0.08, legW: 0.08, body: c, leg: c, head: c, hs: 0.18,
        headPieces: (hy, f) => [
          [BOX, c, -0.04, hy + 0.2, f - 0.12, 0.05, 0.24, 0.04], [BOX, c, 0.04, hy + 0.2, f - 0.12, 0.05, 0.24, 0.04],
          [BOX, '#111', -0.07, hy + 0.03, f - 0.04, 0.03, 0.04, 0.03], [BOX, '#111', 0.07, hy + 0.03, f - 0.04, 0.03, 0.04, 0.03],
        ],
        tail: [[BOX, '#fff', 0, 0, -0.02, 0.08, 0.08, 0.06]], tailTilt: 0,
      });
    }
    case 'frog':
      return quad(k, {
        bw: 0.26, bh: 0.12, bl: 0.24, legH: 0.06, legW: 0.08, body: v % 2 ? '#5a9a3a' : '#7aa83a', leg: '#4a7a2a', head: v % 2 ? '#5a9a3a' : '#7aa83a', hs: 0.16,
        headPieces: (hy, f) => [
          [BOX, '#e8e8a0', -0.07, hy + 0.09, f - 0.12, 0.07, 0.07, 0.07], [BOX, '#e8e8a0', 0.07, hy + 0.09, f - 0.12, 0.07, 0.07, 0.07],
          [BOX, '#111', -0.07, hy + 0.1, f - 0.08, 0.04, 0.04, 0.02], [BOX, '#111', 0.07, hy + 0.1, f - 0.08, 0.04, 0.04, 0.02],
        ],
      });
    case 'chicken': {
      const c = ['#f4f0e6', '#b8743a', '#3a2e28'][v % 3];
      return bird(k, {
        bw: 0.3, bh: 0.28, bl: 0.38, legH: 0.22, body: c, head: c, hs: 0.17, beak: '#e8b030', leg: '#e8b030', wing: c, span: 0.1,
        headExtra: [[BOX, '#d8342a', 0, 0.2, 0.05, 0.04, 0.1, 0.14], [BOX, '#d8342a', 0, 0.02, 0.18, 0.04, 0.08, 0.04]],
        tail: [[BOX, c, 0, 0.1, 0, 0.16, 0.22, 0.08]],
      });
    }
    case 'duck': {
      const drake = v % 2 === 0;
      return bird(k, {
        bw: 0.3, bh: 0.22, bl: 0.44, legH: 0.12, body: drake ? '#d8d4c8' : '#9a7a58', head: drake ? '#2a6a3a' : '#8a6a4a', hs: 0.16,
        beak: '#e89a2a', leg: '#e89a2a', wing: drake ? '#8a8a90' : '#7a5a3a', span: 0.1,
        tail: [[BOX, drake ? '#d8d4c8' : '#9a7a58', 0, 0.06, 0, 0.18, 0.08, 0.1]],
      });
    }
    case 'pigeon':
      return bird(k, {
        bw: 0.2, bh: 0.18, bl: 0.28, legH: 0.1, body: '#8a8f98', head: '#6a7078', hs: 0.12, beak: '#3a3a3a', leg: '#d88a8a', wing: '#7a8088', span: 0.08,
        headExtra: [[BOX, '#5a8a7a', 0, -0.02, 0.06, 0.13, 0.05, 0.1]],
        tail: [[BOX, '#5a5f68', 0, 0.0, -0.04, 0.14, 0.04, 0.14]],
      });
    case 'gull':
      return bird(k, {
        bw: 0.22, bh: 0.2, bl: 0.5, legH: 0.12, body: '#f4f4f0', head: '#f4f4f0', hs: 0.15, beak: '#e8c030', leg: '#e8c030', wing: '#9aa0a8', span: 0.6,
        tail: [[BOX, '#3a3a3a', 0, 0, -0.04, 0.16, 0.04, 0.12]],
      });
  }
}

export interface Villager {
  readonly pos: THREE.Vector3;
  readonly available: boolean;
  petDog(a: Animal): void;
}
export interface AnimalWorld {
  player: THREE.Vector3;
  running: boolean;
  animals: Animal[];
  villagers: Villager[];
  night: boolean;
}

type Mode = 'idle' | 'walk' | 'flee' | 'follow' | 'chase' | 'visit';
const tmp = new THREE.Vector3();
const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

export class Animal {
  readonly root = new THREE.Group();
  readonly pos: THREE.Vector3;
  readonly parts: Parts;
  readonly spec: Spec;
  readonly home: THREE.Vector3;
  readonly label: HTMLDivElement;
  readonly labelH: number;
  private bubble: HTMLDivElement;
  yaw = Math.random() * Math.PI * 2;
  mode: Mode = 'idle';
  act: Act = 'none';
  range: number;
  private timer = Math.random() * 4;
  private target = new THREE.Vector3();
  private fleeFrom = new THREE.Vector3();
  private speed = 0;
  private t = Math.random() * 10;
  private phase = 0;
  private hopT = 0;
  private barkTimer = 0;
  private barkCd = Math.random() * 10;
  private chaseTarget: Animal | null = null;
  private visitTarget: Villager | null = null;
  private orbit = Math.random() * Math.PI * 2;
  /** Follow the player (or anything) until `until` (state.clock seconds). */
  follow: { target: THREE.Vector3; until: number } | null = null;
  /** Quest animals that need leading home. */
  lost = false;
  hidden = false;
  /** Small critters skip shadows and are culled sooner. */
  readonly small: boolean;

  constructor(readonly kind: AnimalKind, home: THREE.Vector3, scene: THREE.Scene, labels: HTMLElement, opts: { name?: string; variant?: number; range?: number } = {}) {
    this.spec = SPEC[kind];
    this.parts = build(kind, opts.variant ?? (Math.random() * 4) | 0);
    this.root.add(this.parts.model);
    this.small = kind === 'frog' || kind === 'pigeon' || kind === 'rabbit' || kind === 'duck' || kind === 'chicken' || kind === 'gull';
    if (this.small) this.root.traverse(o => (o.castShadow = false));
    scene.add(this.root);
    this.home = home.clone();
    this.range = opts.range ?? this.spec.range;
    this.pos = home.clone();
    if (this.spec.fly) this.pos.y = floorHeight(home.x, home.z) + 9;
    this.labelH = this.parts.height + 0.35;

    this.label = document.createElement('div');
    this.label.className = 'label animal';
    this.bubble = document.createElement('div');
    this.bubble.className = 'bubble';
    this.label.append(this.bubble);
    if (opts.name) {
      const n = document.createElement('div');
      n.className = 'name';
      n.textContent = opts.name;
      this.label.append(n);
    }
    this.name = opts.name;
    labels.append(this.label);
  }
  readonly name: string | undefined;
  get title() { return this.name ?? `the ${this.spec.name}`; }

  bark(text?: string) {
    const s = this.spec.sounds;
    this.bubble.textContent = text ?? s[(Math.random() * s.length) | 0];
    this.label.classList.add('barking');
    this.barkTimer = 2.4;
    this.barkCd = 8 + Math.random() * 14;
  }

  startFlee(from: THREE.Vector3, dur = 1.6 + Math.random()) {
    this.mode = 'flee';
    this.act = 'none';
    this.timer = dur;
    this.fleeFrom.copy(from);
    if (this.barkCd <= 0 || Math.random() < 0.3) this.bark(this.kind === 'cat' ? 'Hssss!' : undefined);
  }

  // ---------- player interaction ----------
  promptLabel(): string | null {
    if (this.spec.fly || this.hidden) return null;
    if (this.lost && !this.follow) return `Lead ${this.title} home`;
    const likes = this.spec.likes;
    if (likes && state.inv[likes] > 0 && !this.lost) return `Feed ${this.title} ${ITEMS[likes].icon}`;
    if (this.kind === 'frog') return 'Boop the frog';
    return `Pet ${this.title}`;
  }

  interact(player: THREE.Vector3) {
    svc.playerAction('pet', 0.9, null);
    this.mode = 'idle';
    this.timer = 3;
    this.yaw = Math.atan2(player.x - this.pos.x, player.z - this.pos.z);
    if (this.lost && !this.follow) {
      this.follow = { target: player, until: Infinity };
      this.bark();
      state.toast(`${this.name} is following you`);
      return;
    }
    const likes = this.spec.likes;
    if (likes && state.inv[likes] > 0 && !this.lost && take(likes)) {
      this.bark(`♥ ${this.spec.sounds[0]}`);
      this.follow = { target: player, until: state.clock + 25 };
      state.toast(`${cap(this.title)} gobbles up ${ITEMS[likes].one} and follows you around`);
      return;
    }
    if (this.kind === 'frog') {
      this.bark('Rrribbit?!');
      this.mode = 'flee'; this.timer = 1; this.fleeFrom.copy(player);
      return;
    }
    this.bark(`♥ ${this.spec.sounds[(Math.random() * this.spec.sounds.length) | 0]}`);
    if (this.kind === 'dog') { this.follow = { target: player, until: state.clock + 45 }; state.toast(`${cap(this.title)} wants to come along!`); }
    if (this.kind === 'cat') { this.act = 'sit'; this.timer = 4; }
  }

  // ---------- simulation ----------
  update(dt: number, w: AnimalWorld) {
    this.t += dt;
    if (this.barkTimer > 0 && (this.barkTimer -= dt) <= 0) this.label.classList.remove('barking');
    this.barkCd -= dt;
    if (this.spec.fly) return this.updateFly(dt, w);

    const sp = this.spec;
    const dP = flat(this.pos, w.player);
    this.speed = 0;
    let desired = this.yaw;

    if (this.follow && this.follow.until < state.clock) { this.follow = null; this.mode = 'idle'; this.timer = 1; }

    // Threats: the player (unless lured with food) and, for timid animals, the dog.
    if (!this.follow && this.mode !== 'flee' && this.mode !== 'chase') {
      const lured = sp.likes !== undefined && state.inv[sp.likes] > 0;
      const fr = w.running ? sp.flee[1] : lured ? 0 : sp.flee[0];
      if (fr > 0 && dP < fr) this.startFlee(w.player);
      else if (sp.timid) {
        for (const a of w.animals) {
          if (a.kind === 'dog' && !a.hidden && flat(a.pos, this.pos) < (a.mode === 'chase' ? 5 : 2.2)) { this.startFlee(a.pos); break; }
        }
      }
    }

    if (this.follow) this.mode = 'follow';
    else if (this.mode === 'follow') { this.mode = 'idle'; this.timer = 2; }

    switch (this.mode) {
      case 'idle': {
        this.timer -= dt;
        if (dP < 4 && this.act !== 'sleep' && this.act !== 'graze') desired = Math.atan2(w.player.x - this.pos.x, w.player.z - this.pos.z);
        if (dP < 8 && this.barkCd <= 0 && Math.random() < dt * 0.3) this.bark();
        if (this.timer <= 0) this.decide(w);
        break;
      }
      case 'walk': {
        this.timer -= dt;
        const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
        if (Math.hypot(dx, dz) < 0.4 || this.timer <= 0) { this.mode = 'idle'; this.timer = 2 + Math.random() * 5; this.pickAct(w); }
        else { desired = Math.atan2(dx, dz); this.speed = sp.walk; }
        break;
      }
      case 'flee': {
        this.timer -= dt;
        tmp.copy(this.pos).sub(this.fleeFrom).setY(0);
        // Don't run off forever: bend back toward home when far out.
        const hx = this.home.x - this.pos.x, hz = this.home.z - this.pos.z;
        const hd = Math.hypot(hx, hz);
        if (hd > this.range * 1.6) { tmp.normalize().multiplyScalar(0.4); tmp.x += hx / hd; tmp.z += hz / hd; }
        desired = Math.atan2(tmp.x, tmp.z) + Math.sin(this.t * 3) * 0.3;
        this.speed = sp.run;
        if (this.timer <= 0) { this.mode = 'idle'; this.timer = 1 + Math.random() * 2; this.act = 'look'; }
        break;
      }
      case 'follow': {
        const f = this.follow!;
        const dx = f.target.x - this.pos.x, dz = f.target.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        desired = Math.atan2(dx, dz);
        this.act = 'none';
        if (d > 2.2) this.speed = d > 7 ? sp.run : sp.walk * 1.4;
        if (d > 60) { this.pos.set(f.target.x - dx / d * 3, 0, f.target.z - dz / d * 3); }
        if (this.kind === 'dog' && this.barkCd <= 0 && Math.random() < dt * 0.2) this.bark();
        break;
      }
      case 'chase': {
        const c = this.chaseTarget;
        this.timer -= dt;
        if (!c || this.timer <= 0) { this.mode = 'idle'; this.timer = 3; this.act = 'sit'; break; }
        const dx = c.pos.x - this.pos.x, dz = c.pos.z - this.pos.z;
        desired = Math.atan2(dx, dz);
        this.speed = sp.run * 0.8;
        if (Math.hypot(dx, dz) < 1.1) { this.bark('Woof! Woof!'); this.mode = 'idle'; this.timer = 3; this.act = 'sit'; }
        break;
      }
      case 'visit': {
        const v = this.visitTarget;
        this.timer -= dt;
        if (!v || !v.available || this.timer <= 0) { this.mode = 'idle'; this.timer = 2; break; }
        const dx = v.pos.x - this.pos.x, dz = v.pos.z - this.pos.z;
        desired = Math.atan2(dx, dz);
        if (Math.hypot(dx, dz) > 1.4) this.speed = sp.walk * 1.3;
        else { v.petDog(this); this.mode = 'idle'; this.act = 'sit'; this.timer = 5; this.bark('*wag wag*'); }
        break;
      }
    }

    let dy = desired - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * (this.mode === 'flee' ? 10 : 5));

    if (this.speed > 0) {
      const step = this.speed * dt;
      const nx = this.pos.x + Math.sin(this.yaw) * step, nz = this.pos.z + Math.cos(this.yaw) * step;
      const ok = sp.swim ? inPond(nx, nz, -0.7) : !isWet(nx, nz) || this.mode === 'follow';
      if (ok) { this.pos.x = nx; this.pos.z = nz; }
      else if (this.mode === 'walk') { this.mode = 'idle'; this.timer = 0.5; }
      else this.yaw += dt * 4;
      if (!sp.swim) resolve(this.pos, 0.25);
    }
    this.pos.y = sp.swim ? POND.y - 0.08 : floorHeight(this.pos.x, this.pos.z);
    this.animate(dt);
  }

  private decide(w: AnimalWorld) {
    const r = Math.random();
    if (this.kind === 'dog' && !w.night) {
      if (r < 0.25) {
        let best: Animal | null = null, bd = 16;
        for (const a of w.animals) if (a.kind === 'chicken' || a.kind === 'cat' || a.kind === 'pigeon') {
          const d = flat(a.pos, this.pos);
          if (d < bd) { bd = d; best = a; }
        }
        if (best) { this.mode = 'chase'; this.chaseTarget = best; this.timer = 5; this.bark('Woof!'); this.act = 'none'; return; }
      } else if (r < 0.5) {
        const near = w.villagers.filter(v => v.available && flat(v.pos, this.pos) < 30);
        if (near.length) { this.visitTarget = near[(Math.random() * near.length) | 0]; this.mode = 'visit'; this.timer = 15; this.act = 'none'; return; }
      }
    }
    if (r < 0.55 && !(w.night && this.spec.idle.includes('sleep'))) {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * this.range;
        const tx = this.home.x + Math.cos(a) * d, tz = this.home.z + Math.sin(a) * d;
        const ok = this.spec.swim ? inPond(tx, tz, -1) : !isWet(tx, tz) && groundNormalY(tx, tz) > 0.75;
        if (ok) {
          this.target.set(tx, 0, tz);
          this.mode = 'walk';
          this.act = 'none';
          this.timer = 4 + Math.hypot(tx - this.pos.x, tz - this.pos.z) / this.spec.walk * 1.5;
          return;
        }
      }
    }
    this.timer = 2 + Math.random() * 6;
    this.pickAct(w);
  }

  private pickAct(w: AnimalWorld) {
    const idle = this.spec.idle;
    this.act = w.night && idle.includes('sleep') ? 'sleep' : idle[(Math.random() * idle.length) | 0];
  }

  private updateFly(dt: number, w: AnimalWorld) {
    const R = this.range;
    this.orbit += dt * this.spec.walk / R;
    const wob = Math.sin(this.orbit * 0.7 + this.t * 0.1) * 3;
    const x = this.home.x + Math.cos(this.orbit) * (R + wob), z = this.home.z + Math.sin(this.orbit) * (R + wob);
    const y = Math.max(floorHeight(x, z), 0) + 8 + Math.sin(this.t * 0.5) * 2;
    this.yaw = Math.atan2(x - this.pos.x, z - this.pos.z);
    this.pos.set(x, y, z);
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.yaw, Math.sin(this.orbit * 0.5) * 0.1 - 0.35);
    const flap = Math.sin(this.t * 1.3) > 0.2 ? Math.sin(this.t * 10) * 0.6 : 0.1;
    this.parts.wings![0].rotation.z = -flap;
    this.parts.wings![1].rotation.z = flap;
    this.parts.legs.forEach(l => (l.rotation.x = 1.2));
    if (flat(this.pos, w.player) < 25 && this.barkCd <= 0 && Math.random() < dt * 0.15) this.bark();
  }

  private animate(dt: number) {
    const p = this.parts;
    const k = 1 - Math.exp(-dt * 10);
    const moving = this.speed > 0.05;
    const quad = p.legs.length === 4;
    this.phase += dt * this.speed * (1.6 / Math.max(0.12, p.legH));
    const sw = moving ? Math.sin(this.phase) * (quad ? 0.6 : 0.8) : 0;

    let headX = 0, headY = 0, bodyX = 0, bodyY = 0;
    // Leg order: front-left, front-right, back-left, back-right (diagonal pairs swing together).
    let L = quad ? [sw, -sw, -sw, sw] : [sw, -sw];
    const act = moving ? 'none' : this.act;
    switch (act) {
      case 'graze': headX = quad ? 0.9 + Math.sin(this.t * 2) * 0.05 : 0.9; break;
      case 'peck': headX = Math.sin(this.t * 9) > 0.3 ? 1.1 : 0.15; break;
      case 'look': headY = Math.sin(this.t * 0.7) * 0.6; break;
      case 'sit':
        if (this.kind === 'dog' || this.kind === 'cat' || this.kind === 'rabbit') { bodyX = -0.4; L = [0.4, 0.4, -1.1, -1.1]; bodyY = -p.legH * 0.25; headX = -0.3; }
        else if (this.kind === 'frog') bodyX = -0.3;
        break;
      case 'sleep':
        if (quad) { bodyY = -p.legH * 0.85; L = [-1.4, -1.4, 1.4, 1.4]; headX = 0.35; }
        break;
    }
    if (this.mode === 'follow' || this.mode === 'visit') headX = -0.15;

    let hop = 0;
    if (this.spec.hop && moving) {
      this.hopT += dt * 7;
      hop = Math.abs(Math.sin(this.hopT)) * this.spec.hop;
      const h = Math.sin(this.hopT) * 0.6;
      L = [h, h, -h, -h];
    }
    if (this.spec.swim) { bodyY = Math.sin(this.t * 2) * 0.02; p.legs.forEach(l => (l.visible = false)); }

    p.legs.forEach((l, i) => (l.rotation.x += (L[i] - l.rotation.x) * k));
    p.head.rotation.x += (headX - p.head.rotation.x) * k;
    p.head.rotation.y += (headY - p.head.rotation.y) * k;
    p.model.rotation.x += (bodyX - p.model.rotation.x) * k;
    p.model.position.y += (bodyY + hop - p.model.position.y) * Math.min(1, k * 2);
    if (p.tail) p.tail.rotation.y = this.kind === 'dog' && (this.mode === 'follow' || this.mode === 'visit' || this.barkTimer > 0) ? Math.sin(this.t * 16) * 0.6 : Math.sin(this.t * 1.5) * 0.15;
    if (p.wings) {
      const flap = this.mode === 'flee' ? 0.3 + Math.sin(this.t * 30) * 0.5 : 0;
      p.wings[0].rotation.z = -flap;
      p.wings[1].rotation.z = flap;
    }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export interface AnimalSpots {
  coop: THREE.Vector3;
  pen: THREE.Vector3;
  pigpen: THREE.Vector3;
  pond: THREE.Vector3;
  dock: THREE.Vector3;
  plaza: THREE.Vector3;
  farm: THREE.Vector3;
  wild: THREE.Vector3[];
  mittens: THREE.Vector3;
  clover: THREE.Vector3;
}

export function spawnAnimals(scene: THREE.Scene, labels: HTMLElement, s: AnimalSpots) {
  const out: Animal[] = [];
  const add = (kind: AnimalKind, at: THREE.Vector3, opts: { name?: string; variant?: number; range?: number } = {}, jitter = 2) => {
    const p = at.clone();
    for (let i = 0; i < 8; i++) {
      p.set(at.x + (Math.random() - 0.5) * jitter * 2, 0, at.z + (Math.random() - 0.5) * jitter * 2);
      if (SPEC[kind].swim ? inPond(p.x, p.z, -1) : !isWet(p.x, p.z)) break;
    }
    p.y = floorHeight(p.x, p.z);
    const a = new Animal(kind, kind === 'gull' ? at : p, scene, labels, opts);
    out.push(a);
    return a;
  };
  for (let i = 0; i < 9; i++) add('chicken', s.coop, { variant: i, range: 7 }, 4);
  add('dog', s.plaza, { name: 'Biscuit', variant: 0, range: 22 });
  add('dog', s.farm, { name: 'Pepper', variant: 1, range: 12 });
  add('cat', s.plaza, { name: 'Dumpling', variant: 0, range: 14 }, 8);
  add('cat', s.dock, { name: 'Captain', variant: 1, range: 6 }, 2);
  const mittens = add('cat', s.mittens, { name: 'Mittens', variant: 2, range: 3 }, 0.5);
  mittens.lost = true;
  for (let i = 0; i < 6; i++) add('sheep', s.pen, { range: 4.5 }, 3);
  const clover = add('sheep', s.clover, { name: 'Clover', variant: 9, range: 4 }, 0.5);
  clover.lost = true;
  for (let i = 0; i < 2; i++) add('cow', s.pen, { variant: i, range: 4 }, 3);
  for (let i = 0; i < 2; i++) add('pig', s.pigpen, { range: 1.6 }, 1);
  for (let i = 0; i < 4; i++) add('duck', s.pond, { variant: i, range: 3.5 }, 2);
  for (let i = 0; i < 5; i++) add('frog', s.pond, { variant: i, range: 7 }, 7);
  for (let i = 0; i < 6; i++) add('pigeon', s.plaza, { range: 7 }, 6);
  for (let i = 0; i < 5; i++) add('gull', s.dock, { range: 10 + i * 2.5 });
  s.wild.forEach((p, i) => {
    if (i % 3 === 0) for (let j = 0; j < 3; j++) add('deer', p, { variant: j, range: 16 }, 5);
    else for (let j = 0; j < 2; j++) add('rabbit', p, { variant: j + i, range: 9 }, 4);
  });
  return out;
}
