import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bake, charMat, Piece, SHAPES } from './character';
import { groundHeight, floorHeight, groundNormalY, isWet, POND, WATER_Y, VILLAGE_R } from './terrain';
import { addBox, addCircle, addPlatform, isBlocked } from './colliders';
import { addInteractable, readText, svc } from './interact';
import { state, give, addCoins, isNight, SHARDS_NEEDED } from './state';
import { makeRng } from './noise';

const { BOX, CYL, BALL, CONE } = SHAPES;
const CYL_X = CYL.clone().rotateZ(Math.PI / 2);
const rng = makeRng(9001);
const rand = (a: number, b: number) => a + rng() * (b - a);

const V = (x: number, z: number) => new THREE.Vector3(x, floorHeight(x, z), z);
/** Local → world for an object at (x0, z0) rotated by `rot` (Object3D.rotation.y convention). */
const local = (x0: number, z0: number, rot: number, lx: number, lz: number) =>
  V(x0 + lx * Math.cos(rot) + lz * Math.sin(rot), z0 - lx * Math.sin(rot) + lz * Math.cos(rot));
const facing = (x: number, z: number) => Math.atan2(-x, -z); // rotation whose +z looks at the plaza

/**
 * Static props are collected here and merged into a handful of chunked meshes at the end
 * of buildVillage, so hundreds of props cost a few draw calls instead of hundreds.
 */
const statics: { geo: THREE.BufferGeometry; m: THREE.Matrix4; shadow: boolean; mat: THREE.Material }[] = [];
function place(_scene: THREE.Object3D, geo: THREE.BufferGeometry, x: number, z: number, rot = 0, y?: number, shadow = true, mat: THREE.Material = charMat) {
  statics.push({ geo, m: new THREE.Matrix4().makeRotationY(rot).setPosition(x, y ?? groundHeight(x, z), z), shadow, mat });
}
function flushStatics(scene: THREE.Scene) {
  const groups = new Map<string, { mat: THREE.Material; shadow: boolean; geos: THREE.BufferGeometry[] }>();
  const p = new THREE.Vector3();
  for (const st of statics) {
    p.setFromMatrixPosition(st.m);
    const k = `${Math.floor(p.x / 48)},${Math.floor(p.z / 48)},${st.shadow},${st.mat.uuid}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { mat: st.mat, shadow: st.shadow, geos: [] }));
    const geo = (st.geo.index ? st.geo.toNonIndexed() : st.geo.clone()).applyMatrix4(st.m);
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') geo.deleteAttribute(name);
    g.geos.push(geo);
  }
  for (const g of groups.values()) {
    const m = new THREE.Mesh(mergeGeometries(g.geos)!, g.mat);
    m.castShadow = g.shadow;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    scene.add(m);
  }
  statics.length = 0;
}
/** A prop that needs to change at runtime (hide/show, animate). */
function placeDyn(scene: THREE.Object3D, geo: THREE.BufferGeometry, x: number, z: number, rot = 0, y?: number, shadow = true) {
  const m = new THREE.Mesh(geo, charMat);
  m.position.set(x, y ?? groundHeight(x, z), z);
  m.rotation.y = rot;
  m.castShadow = shadow;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
const cache = new Map<string, THREE.BufferGeometry>();
const baked = (key: string, pieces: () => Piece[]) => {
  let g = cache.get(key);
  if (!g) cache.set(key, (g = bake(pieces())));
  return g;
};

export interface Seat { pos: THREE.Vector3; yaw: number }

export interface Village {
  lanternMat: THREE.MeshLambertMaterial;
  windowMat: THREE.MeshLambertMaterial;
  spots: Record<string, THREE.Vector3>;
  lists: Record<string, THREE.Vector3[]>;
  seats: Seat[];
  campSeats: Seat[];
  doors: Record<string, THREE.Vector3>;
  bell: THREE.Vector3;
  clearings: { x: number; z: number; r: number }[];
  wild: THREE.Vector3[];
  hideSpots: THREE.Vector3[];
  update: (dt: number) => void;
}

const WOOD = '#5b3d26', WOOD2 = '#7a5634', STONE = '#8a8580';

export function buildVillage(scene: THREE.Scene, shore: THREE.Vector3, hill: THREE.Vector3): Village {
  shore = shore.clone();
  const windowMat = new THREE.MeshLambertMaterial({ color: '#2a2a35', emissive: '#ffb347', emissiveIntensity: 0 });
  const lanternMat = new THREE.MeshLambertMaterial({ color: '#3a3a3a', emissive: '#ffbf5e', emissiveIntensity: 0 });
  const updaters: ((dt: number) => void)[] = [];
  const spots: Record<string, THREE.Vector3> = {};
  const lists: Record<string, THREE.Vector3[]> = {};
  const doors: Record<string, THREE.Vector3> = {};
  const seats: Seat[] = [];
  const clearings: Village['clearings'] = [];

  // ---------- Houses ----------
  const winGeo = new THREE.BoxGeometry(0.9, 0.8, 0.12);
  const roofGeo = new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4);
  const roofCols = ['#9c3d2e', '#5a6e8c', '#7a5537', '#4f7348', '#8c5a7a', '#a8763a'];
  let hn = 0;
  const windows: THREE.Matrix4[] = [];
  const houses: ((lx: number, lz: number) => THREE.Vector3)[] = [];
  function house(x: number, z: number, o: { w?: number; d?: number; wall?: string; roof?: string; rot?: number; scale?: number } = {}) {
    const i = hn++;
    const rot = o.rot ?? facing(x, z);
    const s = o.scale ?? 1;
    const w = (o.w ?? 6) * s, d = (o.d ?? 5) * s, h = 3.4 * s;
    const wall = o.wall ?? (i % 2 ? '#e8dcc2' : '#d9c7a4');
    const y0 = groundHeight(x, z) - 0.2;
    place(scene, bake([
      [BOX, wall, 0, h / 2, 0, w, h, d],
      [BOX, WOOD, 0, 1.05 * s, d / 2 + 0.03, 1.2 * s, 2.1 * s, 0.1],
      [BOX, '#3a2a1a', 0.4 * s, 1.0 * s, d / 2 + 0.09, 0.08, 0.08, 0.05],
      [BOX, WOOD, -w / 2 + 0.1, h / 2, d / 2 + 0.02, 0.2, h, 0.08], [BOX, WOOD, w / 2 - 0.1, h / 2, d / 2 + 0.02, 0.2, h, 0.08],
      [BOX, WOOD, 0, h - 0.1, d / 2 + 0.02, w, 0.2, 0.08],
      [BOX, STONE, w * 0.27, h + 1.5 * s, -d * 0.2, 0.7 * s, 1.8 * s, 0.7 * s],
      [BOX, '#6b8f4a', -w * 0.32, 0.25, d / 2 + 0.35, 1.2 * s, 0.4, 0.4],
      [BOX, '#d8607a', -w * 0.32, 0.5, d / 2 + 0.35, 1.0 * s, 0.12, 0.3],
      [roofGeo, o.roof ?? roofCols[i % roofCols.length], 0, h + 1.4 * s, 0, w * 0.8, 2.8 * s, d * 0.82],
    ]), x, z, rot, y0);
    const hm = new THREE.Matrix4().makeRotationY(rot).setPosition(x, y0, z);
    for (const wx of [-w * 0.32, w * 0.32]) {
      windows.push(hm.clone().multiply(new THREE.Matrix4().makeTranslation(wx, 2.0 * s, d / 2 + 0.03)).multiply(new THREE.Matrix4().makeScale(s, s, 1)));
    }
    addBox(x, z, w / 2 + 0.1, d / 2 + 0.1, rot);
    const at = (lx: number, lz: number) => local(x, z, rot, lx, lz);
    if (s === 1 && !o.wall?.startsWith('#f0e2')) houses.push((lx, lz) => at(lx * (w / 6), lz * (d / 5)));
    return { door: local(x, z, rot, 0, d / 2 + 1.0), rot, at: (lx: number, lz: number) => local(x, z, rot, lx, lz) };
  }

  const ring1: [number, number, string][] = [[0.25, 24, 'jory'], [1.1, 27, 'tobin'], [1.9, 24, 'maren'], [2.75, 27, 'ilsa'], [4.45, 27, 'pip'], [5.35, 24, 'fennick']];
  for (const [a, r, who] of ring1) doors[who] = house(Math.cos(a) * r, Math.sin(a) * r).door;
  doors.lotte = doors.pip;
  doors.wren = house(40, 2, { w: 7, d: 5.5, wall: '#e0cfa8', roof: '#8a4a2a' }).door;
  doors.nell = house(-26, 26.3).door;
  doors.bertram = house(2.6, 37, { roof: '#5a6e8c' }).door;
  const bakery = house(-20.1, -28.7, { w: 6.5, wall: '#f0e2c4', roof: '#b0583a' });
  doors.hollis = bakery.door;
  doors.garrick = house(10.5, -35.5, { wall: '#a8825a', roof: '#4f7348' }).door;

  // ---------- Plaza ----------
  place(scene, bake([
    [CYL, STONE, 0, 0.5, 0, 2.7, 1, 2.7], [CYL, '#1d3b4f', 0, 0.92, 0, 2.15, 0.05, 2.15],
    [BOX, WOOD, -1.15, 1.6, 0, 0.18, 2.4, 0.18], [BOX, WOOD, 1.15, 1.6, 0, 0.18, 2.4, 0.18], [BOX, WOOD, 0, 2.6, 0, 2.5, 0.14, 0.14],
    [CYL, '#7d8590', 0, 1.7, 0, 0.35, 0.35, 0.35], [roofGeo, roofCols[0], 0, 3.2, 0, 2.7, 1.1, 2.7],
  ]), 0, 0);
  addCircle(0, 0, 1.5);
  spots.well = V(3, 2.5);
  spots.plaza = V(0, 0);

  const lanternGeo = new THREE.BoxGeometry(0.4, 0.5, 0.4);
  const postGeo = baked('lpost', () => [[CYL, WOOD, 0, 1.5, 0, 0.16, 3, 0.16], [BOX, WOOD, 0, 2.85, 0, 0.5, 0.06, 0.5]]);
  const lantern = (x: number, z: number) => {
    const y = groundHeight(x, z);
    place(scene, postGeo, x, z);
    place(scene, lanternGeo, x, z, 0, y + 3.1, false, lanternMat);
    addCircle(x, z, 0.25);
  };
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    lantern(Math.cos(a) * 13, Math.sin(a) * 13);
  }
  // A few more lanterns down the road and by the pond
  for (const [x, z] of [[-27, -11], [-36, -20], [-33, 2], [20, -10], [-4, 30]]) lantern(x, z);

  // Benches around the well
  const benchGeo = baked('bench', () => [
    [BOX, WOOD2, 0, 0.45, 0, 1.8, 0.1, 0.5], [BOX, WOOD2, 0, 0.8, -0.24, 1.8, 0.4, 0.08],
    [BOX, WOOD, -0.75, 0.22, 0, 0.1, 0.45, 0.45], [BOX, WOOD, 0.75, 0.22, 0, 0.1, 0.45, 0.45],
  ]);
  const bench = (x: number, z: number, rot: number) => {
    place(scene, benchGeo, x, z, rot);
    addBox(x, z, 0.9, 0.28, rot);
    const seat: Seat = { pos: local(x, z, rot, 0, 0.05), yaw: rot };
    seats.push(seat);
    addInteractable({ pos: seat.pos, r: 2, label: () => 'Sit on the bench', act: () => svc.sit(seat.pos, seat.yaw, 'sit') });
    return seat;
  };
  for (const a of [0.6, 2.2, 3.95, 5.5]) { const x = Math.cos(a) * 8.5, z = Math.sin(a) * 8.5; bench(x, z, facing(x, z)); }
  bench(-31.5, 12, Math.atan2(POND.x + 31.5, POND.z - 12));
  bench(-18, 36.5, facing(-18, 36.5) + Math.PI);

  addInteractable({
    pos: V(0, 0), r: 2.8,
    label: () => (state.coins > 0 ? 'Toss a coin into the well' : 'Drink from the well'),
    act: () => {
      if (state.coins > 0) {
        addCoins(-1);
        const wishes = ['You make a wish. Somewhere, a frog sneezes.', 'Plink! The well seems pleased.', 'You wish for adventure. The well echoes it back.', 'You hear a faint "thank you" from very far down.'];
        state.toast(wishes[(Math.random() * wishes.length) | 0]);
      } else state.toast('Cold, clear water. Refreshing!');
      svc.playerAction('pet', 1.2, 'bucket');
    },
  });

  // Bell post
  const bellPos = V(11, -2);
  place(scene, baked('bell', () => [
    [BOX, WOOD, -0.9, 1.5, 0, 0.2, 3, 0.2], [BOX, WOOD, 0.9, 1.5, 0, 0.2, 3, 0.2], [BOX, WOOD, 0, 3.0, 0, 2.2, 0.2, 0.25],
    [CYL, '#c8a040', 0, 2.55, 0, 0.6, 0.6, 0.6], [CYL, '#a8802a', 0, 2.25, 0, 0.75, 0.1, 0.75], [BOX, '#d8c8a0', 0, 1.6, 0, 0.04, 1.2, 0.04],
  ]), bellPos.x, bellPos.z, facing(bellPos.x, bellPos.z));
  addCircle(bellPos.x, bellPos.z, 1.0);
  addInteractable({ pos: bellPos, r: 2.5, label: () => 'Ring the bell', act: () => { svc.ringBell(bellPos); svc.playerAction('reach', 1.0, null); } });

  // Notice board
  const nb = V(-0.8, -9.2);
  const nbRot = facing(nb.x, nb.z);
  place(scene, baked('board', () => [
    [BOX, WOOD, -1, 1, 0, 0.15, 2, 0.15], [BOX, WOOD, 1, 1, 0, 0.15, 2, 0.15], [BOX, WOOD2, 0, 1.55, 0, 2.3, 1.2, 0.1],
    [BOX, '#efe6cf', -0.55, 1.65, 0.06, 0.6, 0.7, 0.02], [BOX, '#f4ecd8', 0.3, 1.5, 0.06, 0.55, 0.5, 0.02], [BOX, '#e8d8b8', 0.65, 1.85, 0.06, 0.4, 0.35, 0.02],
    [BOX, '#9c3d2e', 0, 2.25, 0, 2.5, 0.12, 0.3],
  ]), nb.x, nb.z, nbRot);
  addBox(nb.x, nb.z, 1.15, 0.15, nbRot);
  spots.board = local(nb.x, nb.z, nbRot, 0, 1.3);
  addInteractable({
    pos: spots.board, r: 2.2, label: () => 'Read the notice board',
    act: () => readText('Notice Board', [
      state.quest === 'done' ? 'LANTERN FESTIVAL — every evening in the plaza! Dancing! Questionable music! (— Fennick)' : `LANTERNS OUT. Glowshards lost in the storm. ${SHARDS_NEEDED} needed. Finders please see Elder Maren.`,
      state.sheep !== 'done' ? 'LOST: one sheep, answers to "Clover". Grey-ish. Wanders. Reward. — Wren, at the farm' : 'FOUND: Clover! Thank you, kind stranger. — Wren',
      state.mittens !== 'done' ? 'MISSING CAT!!! Her name is MITTENS she is black and she is my best friend. — Lotte (age 8)' : 'MITTENS IS HOME!!!!! — Lotte',
      'WANTED: Apples (Hollis, bakery). Mushrooms (Moss, in the woods). Firewood (Garrick). Fair prices, mostly.',
      'Ilsa\'s stall buys anything. ANYTHING. Please stop bringing her frogs.',
    ]),
  });

  // Bard corner + crates
  spots.bard = V(-3.2, -4.2);

  // ---------- Market stall (Ilsa) ----------
  const stallA = 3.1;
  const sx = Math.cos(stallA) * 15, sz = Math.sin(stallA) * 15;
  const sRot = facing(sx, sz);
  place(scene, baked('stall', () => [
    [BOX, WOOD, 0, 0.5, 0, 3, 1, 1.2],
    [BOX, WOOD, -1.4, 1.3, -0.5, 0.12, 2.6, 0.12], [BOX, WOOD, 1.4, 1.3, -0.5, 0.12, 2.6, 0.12], [BOX, WOOD, -1.4, 1.3, 0.5, 0.12, 2.6, 0.12], [BOX, WOOD, 1.4, 1.3, 0.5, 0.12, 2.6, 0.12],
    [BOX, '#c0463a', 0, 2.65, 0.2, 3.4, 0.1, 1.8], [BOX, '#f0e0c0', 0, 2.72, 0.2, 1.1, 0.11, 1.8],
    [BOX, '#e0b04a', -1.05, 1.15, 0, 0.35, 0.3, 0.35], [BOX, '#8fbf5a', -0.35, 1.15, 0, 0.35, 0.3, 0.35], [BOX, '#c8742f', 0.35, 1.15, 0, 0.35, 0.3, 0.35], [BOX, '#d9d2c2', 1.05, 1.15, 0, 0.35, 0.3, 0.35],
    [BALL, '#c83a2a', -0.7, 1.12, 0.35, 0.18, 0.18, 0.18], [BALL, '#c83a2a', -0.55, 1.12, 0.4, 0.18, 0.18, 0.18],
  ]), sx, sz, sRot);
  addBox(sx, sz, 1.6, 0.7, sRot);
  spots.stall = local(sx, sz, sRot, 0, -1.6);
  spots.stallSide = local(sx, sz, sRot, 2.3, -0.6);
  const crateGeo = baked('crate', () => [[BOX, '#9b7748', 0, 0.3, 0, 0.6, 0.6, 0.6], [BOX, '#7a5634', 0, 0.3, 0, 0.64, 0.08, 0.64]]);
  const crates = V(-23, -4.5);
  for (const [dx, dz, y] of [[0, 0, 0], [0.7, 0.1, 0], [0.3, 0.05, 0.6], [-0.2, 0.75, 0], [0.5, 0.8, 0]]) place(scene, crateGeo, crates.x + dx, crates.z + dz, rand(0, 1), groundHeight(crates.x, crates.z) + y);
  addCircle(crates.x + 0.3, crates.z + 0.4, 0.9);
  spots.crates = V(crates.x + 1.6, crates.z - 0.4);

  // ---------- Forge (Tobin) ----------
  const fa = 1.5;
  const fx = Math.cos(fa) * 15, fz = Math.sin(fa) * 15;
  place(scene, baked('forge', () => [
    [BOX, STONE, 0, 0.5, 0, 2, 1, 1.6], [BOX, STONE, 0, 1.6, -0.6, 2, 1.2, 0.4], [BOX, STONE, 0.6, 2.8, -0.6, 0.6, 1.6, 0.4],
    [BOX, '#333', 2.0, 0.7, 0.5, 0.8, 0.5, 0.35], [BOX, '#333', 2.0, 0.35, 0.5, 0.35, 0.4, 0.3], [BOX, WOOD, 2.0, 0.1, 0.5, 0.6, 0.2, 0.5],
    [BOX, '#555a60', -1.5, 0.45, 0.6, 0.5, 0.9, 0.5],
  ]), fx, fz);
  const coals = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.15, 1.1), new THREE.MeshBasicMaterial({ color: '#ff7a2a' }));
  coals.position.set(fx, groundHeight(fx, fz) + 1.03, fz);
  scene.add(coals);
  addCircle(fx, fz, 1.2);
  addCircle(fx + 2, fz + 0.5, 0.45);
  spots.forge = V(fx + 2.0, fz - 0.4);
  spots.anvil = V(fx + 2.0, fz + 0.5);
  spots.forgeFire = V(fx, fz);
  addInteractable({ pos: V(fx - 0.3, fz - 1.2), r: 2.0, label: () => 'Warm your hands at the forge', act: () => { svc.playerAction('knead', 1.6, null); state.toast('Toasty. Tobin nods approvingly.'); } });

  // ---------- Bakery oven ----------
  const oven = bakery.at(4.4, 1.4);
  place(scene, baked('oven', () => [
    [BOX, STONE, 0, 0.6, 0, 1.8, 1.2, 1.8], [BALL, '#a89a8a', 0, 1.3, 0, 1.8, 1.4, 1.8], [BOX, '#2a1a10', 0, 0.85, 0.85, 0.6, 0.5, 0.1], [BOX, STONE, 0.5, 2.0, -0.4, 0.3, 0.6, 0.3],
  ]), oven.x, oven.z, bakery.rot);
  const ovenGlow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.05), new THREE.MeshBasicMaterial({ color: '#ff8a3a' }));
  ovenGlow.position.copy(local(oven.x, oven.z, bakery.rot, 0, 0.92)).setY(oven.y + 0.82);
  ovenGlow.rotation.y = bakery.rot;
  scene.add(ovenGlow);
  addCircle(oven.x, oven.z, 1.1);
  spots.oven = local(oven.x, oven.z, bakery.rot, 0, 1.7);
  spots.bakeryTable = bakery.at(-2.2, 3.4);
  place(scene, baked('table', () => [[BOX, WOOD2, 0, 0.8, 0, 1.6, 0.1, 0.8], [BOX, WOOD, -0.7, 0.4, 0, 0.1, 0.8, 0.7], [BOX, WOOD, 0.7, 0.4, 0, 0.1, 0.8, 0.7],
    [BALL, '#c98a3e', -0.4, 0.92, 0, 0.35, 0.2, 0.25], [BALL, '#b8782e', 0.1, 0.92, 0.1, 0.35, 0.2, 0.25], [BALL, '#d89a4e', 0.45, 0.92, -0.1, 0.3, 0.2, 0.22]]),
    spots.bakeryTable.x, spots.bakeryTable.z, bakery.rot);
  addBox(spots.bakeryTable.x, spots.bakeryTable.z, 0.8, 0.4, bakery.rot);
  spots.bakeryTableFront = bakery.at(-2.2, 4.4);
  addInteractable({ pos: spots.oven, r: 2.2, label: () => 'Sniff the bread oven', act: () => state.toast('Mmm. Warm bread, cinnamon, and a hint of apple.') });

  // ---------- Woodcutter yard + campfire ----------
  const block = V(2, -31);
  const stumpGeo = baked('stump', () => [[CYL, '#8a6a44', 0, 0.3, 0, 0.8, 0.6, 0.8], [CYL, '#c9a878', 0, 0.61, 0, 0.7, 0.02, 0.7], [BOX, '#7a5634', 0.15, 0.95, 0, 0.06, 0.7, 0.06], [BOX, '#a3a9ae', 0.15, 0.68, 0.1, 0.05, 0.2, 0.24]]);
  place(scene, stumpGeo, block.x, block.z);
  addCircle(block.x, block.z, 0.45);
  spots.chop = V(block.x, block.z - 1.1);
  // A spare stump for visitors who fancy a go.
  const spare = V(block.x + 4.2, block.z + 1.2);
  place(scene, stumpGeo, spare.x, spare.z, 1.2);
  addCircle(spare.x, spare.z, 0.45);
  const spareFront = V(spare.x, spare.z - 1.1);
  const pile = V(-2, -34);
  const logsGeo = baked('woodpile', () => {
    const p: Piece[] = [];
    for (let row = 0; row < 3; row++) for (let i = 0; i < 5 - row; i++) p.push([CYL_X, i % 2 ? '#7a5634' : '#6b4a2f', 0, 0.2 + row * 0.36, (i - (4 - row) / 2) * 0.4, 2.2, 0.38, 0.38]);
    return p;
  });
  place(scene, logsGeo, pile.x, pile.z, 0.3);
  addBox(pile.x, pile.z, 1.2, 1.1, 0.3);
  spots.woodpile = V(pile.x + 1.6, pile.z + 0.6);
  addInteractable({
    pos: spareFront, r: 2.2, label: () => 'Chop wood',
    act: () => svc.playerAction('chop', 2.2, 'axe', () => {
      give('logs');
      if (state.wood === 'active') state.woodChopped++;
      state.toast(state.wood === 'active' ? `Chopped a log (${Math.min(3, state.woodChopped)}/3 for Garrick)` : 'Chopped a log 🪵');
    }),
  });

  const fire = V(-7, -43);
  spots.campfire = fire;
  place(scene, baked('firepit', () => {
    const p: Piece[] = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; p.push([BOX, '#6d6a66', Math.cos(a) * 0.75, 0.12, Math.sin(a) * 0.75, 0.32, 0.24, 0.3]); }
    p.push([CYL_X, '#3a2a1a', 0, 0.15, 0, 1.0, 0.16, 0.16], [CYL, '#3a2a1a', 0, 0.15, 0, 0.16, 0.16, 1.0]);
    return p;
  }), fire.x, fire.z);
  addCircle(fire.x, fire.z, 0.9);
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffb040', transparent: true, opacity: 0.9 });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 6).translate(0, 0.55, 0), flameMat);
  const flame2 = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 5).translate(0, 0.35, 0), new THREE.MeshBasicMaterial({ color: '#fff0a0' }));
  flame.position.copy(fire).setY(fire.y + 0.15);
  flame2.position.copy(flame.position);
  scene.add(flame, flame2);
  const fireLight = new THREE.PointLight('#ff9a4a', 0, 16, 1.6);
  fireLight.position.copy(fire).setY(fire.y + 1.2);
  scene.add(fireLight);
  const campSeats: Seat[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const x = fire.x + Math.cos(a) * 2.6, z = fire.z + Math.sin(a) * 2.6;
    const rot = Math.atan2(fire.x - x, fire.z - z);
    if (i % 2 === 0) { place(scene, baked('seatlog', () => [[CYL_X, '#6b4a2f', 0, 0.22, 0, 1.6, 0.44, 0.44]]), x, z, rot); }
    const seat: Seat = { pos: local(x, z, rot, 0, 0.0), yaw: rot };
    campSeats.push(seat);
  }
  updaters.push(() => {
    const t = performance.now() / 1000;
    const f = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.06;
    flame.scale.set(f, 1.1 - (f - 1) * 2 + Math.sin(t * 5) * 0.1, f);
    flame2.scale.set(f, f, f);
    fireLight.intensity = (isNight() ? 14 : 3) * f;
  });
  addInteractable({
    pos: fire, r: 3.2, label: () => (isNight() ? 'Rest by the fire until morning' : 'Rest by the fire until evening'),
    act: () => {
      const s = campSeats[0];
      svc.sit(s.pos, s.yaw, 'sitGround');
      svc.setTime(isNight() ? 0.27 : 0.74);
      state.toast(isNight() ? 'You doze by the embers. Morning comes.' : 'You watch the flames until the sky turns orange.');
    },
  });

  // ---------- Farm ----------
  const field = V(30, -14);
  place(scene, baked('field', () => {
    const p: Piece[] = [];
    for (let r = 0; r < 6; r++) {
      p.push([BOX, '#6e5034', 0, 0.05, (r - 2.5) * 1.2, 8, 0.12, 0.7]);
      for (let c = 0; c < 8; c++) if ((r + c) % 3 !== 0 || r < 3) p.push([BOX, r < 3 ? '#6aa83a' : '#d8b84a', (c - 3.5) * 1, 0.25, (r - 2.5) * 1.2, 0.25, r < 3 ? 0.35 : 0.5, 0.25]);
    }
    return p;
  }), field.x, field.z, 0, groundHeight(field.x, field.z), false);
  lists.field = [V(27, -16.5), V(33, -12.5), V(28, -11), V(32.5, -17)];
  spots.field = field;
  place(scene, baked('scarecrow', () => [
    [BOX, WOOD, 0, 1.0, 0, 0.12, 2.0, 0.12], [BOX, WOOD, 0, 1.55, 0, 1.6, 0.1, 0.1], [BOX, '#7a4a8a', 0, 1.45, 0, 0.6, 0.6, 0.3],
    [BOX, '#e0c27a', 0, 2.05, 0, 0.36, 0.36, 0.34], [CYL, '#c8a050', 0, 2.3, 0, 0.8, 0.05, 0.8], [CYL, '#c8a050', 0, 2.45, 0, 0.35, 0.3, 0.35],
    [BOX, '#222', -0.08, 2.1, 0.175, 0.05, 0.05, 0.02], [BOX, '#222', 0.08, 2.1, 0.175, 0.05, 0.05, 0.02], [BOX, '#e0c27a', -0.85, 1.5, 0, 0.12, 0.12, 0.12], [BOX, '#e0c27a', 0.85, 1.5, 0, 0.12, 0.12, 0.12],
  ]), field.x + 0.5, field.z + 0.6, facing(field.x, field.z));
  addCircle(field.x + 0.5, field.z + 0.6, 0.3);
  addInteractable({
    pos: V(field.x + 0.5, field.z + 0.6), r: 2.2, label: () => 'Talk to the scarecrow',
    act: () => svc.dialog('Scarecrow', {
      entry: () => 'a',
      nodes: {
        a: { text: '...', options: [{ text: 'Hello?', next: 'b' }, { text: 'Nice hat.', next: 'c' }, { text: '(Leave)' }] },
        b: { text: '......', options: [{ text: 'Are you... okay?', next: 'd' }, { text: '(Leave)' }] },
        c: { text: '...', options: [{ text: 'I mean it. Very dapper.', next: 'd' }] },
        d: { text: 'A crow lands on its shoulder, looks at you, and leaves. You feel judged.', options: [{ text: '(Leave quietly)' }] },
      },
    }),
  });

  const coop = V(31, 9);
  place(scene, baked('coop', () => [
    [BOX, '#c8a878', 0, 0.9, 0, 2.2, 1.2, 1.8], [BOX, '#8a4a2a', 0, 1.65, 0, 2.5, 0.12, 2.1], [BOX, '#8a4a2a', 0, 1.85, 0, 1.8, 0.3, 1.6],
    [BOX, WOOD, -0.9, 0.15, -0.7, 0.12, 0.3, 0.12], [BOX, WOOD, 0.9, 0.15, -0.7, 0.12, 0.3, 0.12], [BOX, WOOD, -0.9, 0.15, 0.7, 0.12, 0.3, 0.12], [BOX, WOOD, 0.9, 0.15, 0.7, 0.12, 0.3, 0.12],
    [BOX, '#2a1a10', 0, 0.75, -0.91, 0.5, 0.5, 0.02], [BOX, WOOD2, 0, 0.3, -1.4, 0.5, 0.06, 1.0],
  ]), coop.x, coop.z, Math.PI * 0.5 + 0.4);
  addBox(coop.x, coop.z, 1.2, 1.0, Math.PI * 0.5 + 0.4);
  spots.coop = V(28.5, 10.5);
  spots.coopFeed = V(27.8, 8.2);

  // Fences
  const postG = new THREE.BoxGeometry(0.14, 1.1, 0.14).translate(0, 0.55, 0);
  const railG = new THREE.BoxGeometry(1, 0.08, 0.06);
  const fenceMat = new THREE.MeshLambertMaterial({ color: '#8a6a44' });
  function fence(points: THREE.Vector3[], skip: (i: number) => boolean) {
    const posts: THREE.Matrix4[] = [], rails: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      posts.push(m.makeTranslation(a.x, groundHeight(a.x, a.z) - 0.05, a.z).clone());
      if (skip(i)) continue;
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), rot = Math.atan2(-dz, dx);
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, y = groundHeight(mx, mz);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      for (const h of [0.45, 0.85]) rails.push(m.compose(p.set(mx, y + h, mz), q, sc.set(len, 1, 1)).clone());
      addBox(mx, mz, len / 2, 0.1, rot);
    }
    const last = points[points.length - 1];
    posts.push(m.makeTranslation(last.x, groundHeight(last.x, last.z) - 0.05, last.z).clone());
    for (const [geo, list] of [[postG, posts], [railG, rails]] as const) {
      const im = new THREE.InstancedMesh(geo, fenceMat, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.castShadow = true;
      im.computeBoundingSphere();
      scene.add(im);
    }
  }
  const ringPts = (cx: number, cz: number, r: number, n: number) => Array.from({ length: n + 1 }, (_, i) => new THREE.Vector3(cx + Math.cos((i / n) * Math.PI * 2) * r, 0, cz + Math.sin((i / n) * Math.PI * 2) * r));
  const pen = V(43, 18);
  const penPts = ringPts(pen.x, pen.z, 7.5, 24);
  const gateA = Math.atan2(-pen.z, -pen.x); // gate faces the village
  fence(penPts, i => {
    const a = ((i + 0.5) / 24) * Math.PI * 2;
    return Math.abs(Math.atan2(Math.sin(a - gateA), Math.cos(a - gateA))) < 0.2;
  });
  spots.pen = pen;
  spots.penGate = V(pen.x + Math.cos(gateA) * 9, pen.z + Math.sin(gateA) * 9);
  place(scene, baked('trough', () => [[BOX, WOOD2, 0, 0.3, 0, 1.6, 0.4, 0.6], [BOX, '#3a6f93', 0, 0.48, 0, 1.4, 0.05, 0.45]]), pen.x + 3, pen.z - 2, 0.6);
  addBox(pen.x + 3, pen.z - 2, 0.8, 0.3, 0.6);

  const pig = V(34, -26);
  fence([new THREE.Vector3(pig.x - 2.6, 0, pig.z - 2.6), new THREE.Vector3(pig.x + 2.6, 0, pig.z - 2.6), new THREE.Vector3(pig.x + 2.6, 0, pig.z + 2.6), new THREE.Vector3(pig.x - 2.6, 0, pig.z + 2.6), new THREE.Vector3(pig.x - 2.6, 0, pig.z - 2.6)], () => false);
  place(scene, baked('mud', () => [[CYL, '#5a4030', 0, 0.02, 0, 3.6, 0.06, 3.0]]), pig.x, pig.z, 0, undefined, false);
  spots.pigpen = pig;
  spots.pigFence = V(pig.x - 3.4, pig.z);

  const hayGeo = baked('hay', () => [[CYL, '#d8b84a', 0, 0.55, 0, 1.6, 1.1, 1.6], [CYL, '#c8a83a', 0, 1.1, 0, 1.2, 0.2, 1.2]]);
  for (const [x, z] of [[36, 6], [37.5, 7.6], [22, -22]]) {
    place(scene, hayGeo, x, z);
    addCircle(x, z, 0.8);
    addInteractable({
      pos: V(x, z), r: 2.2, label: () => 'Flop into the hay',
      act: () => { svc.playerAction('sitGround', 2.2, null, () => state.toast(['You flop into the hay. Wonderful.', 'Hay in your hair. Worth it.', 'A chicken stares at you, unimpressed.'][(Math.random() * 3) | 0])); },
    });
  }

  // Orchard
  const appleTrees: THREE.Vector3[] = [];
  for (const [x, z] of [[-14, 42], [-20, 40], [-8, 45.5], [-16, 47.5], [-24, 45], [-10, 39.5], [-21.5, 50]]) appleTrees.push(V(x, z));
  const treeGeo = baked('appletree', () => [[CYL, '#6b4a2f', 0, 1.0, 0, 0.36, 2.0, 0.36], [BALL, '#4f8a35', 0, 2.8, 0, 3.0, 2.4, 3.0], [BALL, '#5a9a3a', 0.6, 3.3, 0.3, 1.8, 1.5, 1.8]]);
  const appleGeo = new THREE.IcosahedronGeometry(0.14, 0);
  const appleMat = new THREE.MeshLambertMaterial({ color: '#d8302a' });
  lists.orchard = [];
  for (const t of appleTrees) {
    place(scene, treeGeo, t.x, t.z, rand(0, 6));
    addCircle(t.x, t.z, 0.45);
    clearings.push({ x: t.x, z: t.z, r: 3 });
    const apples: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rand(0, 1);
      const m = new THREE.Mesh(appleGeo, appleMat);
      m.position.set(t.x + Math.cos(a) * 1.35, t.y + 2.2 + rand(0, 1), t.z + Math.sin(a) * 1.35);
      scene.add(m);
      apples.push(m);
    }
    let count = 4, regrow = 0;
    updaters.push(dt => { if (count < 4 && (regrow += dt) > 30) { regrow = 0; apples[count++].visible = true; } });
    lists.orchard.push(V(t.x + 1.4, t.z - 0.6));
    addInteractable({
      pos: t, r: 2.4, label: () => (count > 0 ? 'Shake the apple tree' : null),
      act: () => svc.playerAction('reach', 0.9, null, () => { apples[--count].visible = false; give('apples'); state.toast('Got an apple 🍎'); }),
    });
  }

  // ---------- Laundry (Nell) ----------
  const ll = V(-12, 33.5);
  const lRot = facing(ll.x, ll.z);
  place(scene, baked('laundry', () => {
    const p: Piece[] = [[BOX, WOOD, -2.6, 1.1, 0, 0.12, 2.2, 0.12], [BOX, WOOD, 2.6, 1.1, 0, 0.12, 2.2, 0.12], [BOX, '#e8e0d0', 0, 2.05, 0, 5.2, 0.02, 0.02]];
    const cols = ['#e8e4dc', '#5a7ab8', '#c8553d', '#e8d070', '#8ab87a'];
    for (let i = 0; i < 5; i++) p.push([BOX, cols[i], -1.9 + i * 0.95, 1.65 - (i % 2) * 0.15, 0, 0.7, 0.75 + (i % 2) * 0.3, 0.03]);
    return p;
  }), ll.x, ll.z, lRot);
  addCircle(local(ll.x, ll.z, lRot, -2.6, 0).x, local(ll.x, ll.z, lRot, -2.6, 0).z, 0.15);
  addCircle(local(ll.x, ll.z, lRot, 2.6, 0).x, local(ll.x, ll.z, lRot, 2.6, 0).z, 0.15);
  lists.laundry = [local(ll.x, ll.z, lRot, -1.4, 0.8), local(ll.x, ll.z, lRot, 1.2, 0.8)];
  spots.laundryFace = ll;
  const basket = local(ll.x, ll.z, lRot, -3.2, 0.9);
  place(scene, baked('lbasket', () => [[BOX, '#b58d52', 0, 0.2, 0, 0.6, 0.4, 0.45], [BOX, '#e8e4dc', 0, 0.38, 0, 0.5, 0.08, 0.35]]), basket.x, basket.z, lRot);
  // Nell's runaway sock
  const sockAt = V(-27, 50.5);
  const sock = placeDyn(scene, baked('sock', () => [[BOX, '#c8553d', 0, 0.1, 0, 0.14, 0.2, 0.12], [BOX, '#c8553d', 0, 0.03, 0.1, 0.14, 0.08, 0.2], [BOX, '#f0e8d8', 0, 0.21, 0, 0.15, 0.05, 0.13]]), sockAt.x, sockAt.z, 0.6);
  updaters.push(() => { sock.visible = state.sock === 'active'; });
  addInteractable({ pos: sockAt, r: 2, label: () => (state.sock === 'active' ? 'Pick up the sock' : null), act: () => { state.sock = 'found'; state.toast('Found Nell\'s sock! Smells like... adventure.'); state.changed(); } });

  // ---------- Pond ----------
  const pondEdge = V(POND.x + 6.2, POND.z - 1.5);
  spots.pond = V(POND.x, POND.z);
  spots.pondEdge = pondEdge;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const x = POND.x + Math.cos(a) * (POND.r + 0.8), z = POND.z + Math.sin(a) * (POND.r + 0.8);
    place(scene, baked('reed' + (i % 3), () => [[BOX, '#5a8a3a', 0, 0.5, 0, 0.06, 1.0, 0.06], [BOX, '#6a9a4a', 0.15, 0.4, 0.05, 0.06, 0.8, 0.06], [BOX, '#7a4a2a', 0, 1.0, 0, 0.1, 0.25, 0.1]]), x, z, a, undefined, false);
  }
  for (let i = 0; i < 4; i++) {
    const a = rand(0, 6.28), d = rand(1, POND.r - 1);
    place(scene, baked('lily', () => [[CYL, '#4a8a3a', 0, 0, 0, 0.8, 0.02, 0.8], [BOX, '#f0d0e0', 0.1, 0.06, 0.05, 0.14, 0.1, 0.14]]), POND.x + Math.cos(a) * d, POND.z + Math.sin(a) * d, a, POND.y + 0.02, false);
  }
  addInteractable({
    pos: pondEdge, r: 3, label: () => 'Skip a stone',
    act: () => svc.playerAction('scatter', 1.0, null, () => {
      const n = (Math.random() * 7) | 0;
      state.toast(n === 0 ? 'Plunk. Straight to the bottom.' : n >= 6 ? `${n} skips!! A duck applauds.` : `${n} skip${n > 1 ? 's' : ''}!`);
    }),
  });

  // ---------- Barrels ----------
  const barrelGeo = baked('barrel', () => [[CYL, '#8a5a34', 0, 0.5, 0, 0.8, 1.0, 0.8], [CYL, '#4a4a4a', 0, 0.2, 0, 0.84, 0.06, 0.84], [CYL, '#4a4a4a', 0, 0.8, 0, 0.84, 0.06, 0.84], [CYL, '#6a4a2a', 0, 1.0, 0, 0.7, 0.02, 0.7]]);
  const barrelSpots = houses.map((at, i) => at(i % 2 ? -3.7 : 3.7, 1.7)).map(p => [p.x, p.z]);
  barrelSpots.push([-24.6, -2.6], [fx - 2.3, fz + 1.3]);
  const loot: (() => string)[] = [
    () => { addCoins(2); return 'Found 2 coins 🪙'; },
    () => { addCoins(1); return 'Found a coin 🪙'; },
    () => { give('apples'); return 'Found an apple 🍎'; },
    () => 'Nothing but cobwebs.',
    () => { give('mushrooms'); return 'Found a slightly suspicious mushroom 🍄'; },
    () => { addCoins(3); return 'Found 3 coins 🪙'; },
    () => 'FROG',
    () => 'Just pickled turnips. You put the lid back.',
    () => { give('berries', 2); return 'Found some berries 🫐'; },
    () => 'FROG',
    () => { addCoins(2); return 'Found 2 coins 🪙'; },
    () => 'An old boot. Not your size.',
  ];
  barrelSpots.forEach(([x, z], i) => {
    place(scene, barrelGeo, x, z, rand(0, 6));
    addCircle(x, z, 0.45);
    let searched = false;
    const at = V(x, z);
    addInteractable({
      pos: at, r: 1.9, label: () => (searched ? null : 'Search the barrel'),
      act: () => svc.playerAction('pet', 1.1, null, () => {
        searched = true;
        const msg = loot[i % loot.length]();
        if (msg === 'FROG') { svc.spawnFrog(at); state.toast('A very surprised frog leaps out!'); } else state.toast(msg);
      }),
    });
  });

  // ---------- Dock ----------
  // March outward along rays from the village; take the closest coast that drops into deep water quickly.
  let dir = new THREE.Vector3(shore.x, 0, shore.z).normalize();
  let len = 12, bestR = Infinity;
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    let r = 60;
    while (r < 280 && groundHeight(dx * r, dz * r) > 0.8) r += 1;
    if (r >= 280 || r > bestR) continue;
    let deep = 0;
    while (deep < 22 && groundHeight(dx * (r + deep), dz * (r + deep)) > -1.0) deep += 1;
    if (deep >= 22 || groundNormalY(dx * (r - 4), dz * (r - 4)) < 0.8) continue;
    bestR = r;
    dir = new THREE.Vector3(dx, 0, dz);
    len = Math.max(8, deep + 3);
    shore = V(dx * r, dz * r);
  }
  const dockRot = Math.atan2(dir.x, dir.z);
  const start = shore.clone().addScaledVector(dir, -3);
  const mid = start.clone().addScaledVector(dir, (len + 3) / 2);
  const top = 1.25;
  const dock = new THREE.Group();
  dock.position.set(mid.x, 0, mid.z);
  dock.rotation.y = dockRot;
  const half = (len + 3) / 2;
  const planks: Piece[] = [];
  for (let z = -half; z < half; z += 0.5) planks.push([BOX, (Math.round(z * 2) % 2) ? '#8a6a44' : '#7a5a3a', 0, top - 0.06, z + 0.25, 2.4, 0.12, 0.46]);
  for (let z = -half + 1; z <= half; z += 2.5) for (const x of [-1.15, 1.15]) planks.push([BOX, WOOD, x, top - 2, z, 0.2, 4, 0.2]);
  planks.push([BOX, WOOD, -1.15, top + 0.4, half - 0.1, 0.15, 0.8, 0.15], [BOX, WOOD, 1.15, top + 0.4, half - 0.1, 0.15, 0.8, 0.15]);
  const dm = new THREE.Mesh(bake(planks), charMat);
  dm.castShadow = dm.receiveShadow = true;
  dock.add(dm);
  scene.add(dock);
  addPlatform(mid.x, mid.z, 1.25, half, dockRot, top);
  const endP = (along: number, side = 0) => {
    const p = start.clone().addScaledVector(dir, along);
    p.x += Math.cos(dockRot) * side; p.z -= Math.sin(dockRot) * side;
    p.y = floorHeight(p.x, p.z);
    return p;
  };
  spots.dockEnd = endP(len + 1.2, 0.6);
  spots.dockStart = endP(1);
  spots.dockFace = endP(len + 10, 0.6);
  spots.fishSpot = endP(len + 1.4, -0.6);
  const boat = new THREE.Group();
  const bp = endP(len - 2, 2.6);
  boat.position.set(bp.x, WATER_Y - 0.15, bp.z);
  boat.rotation.y = dockRot + 0.1;
  boat.add(new THREE.Mesh(bake([
    [BOX, '#7a4a2a', 0, 0.3, 0, 1.3, 0.5, 3.0], [BOX, '#5a3a20', 0, 0.56, 0, 1.4, 0.08, 3.1], [BOX, '#2a3a4a', 0, 0.5, 0, 1.0, 0.1, 2.6],
    [BOX, WOOD2, 0, 0.6, 0.3, 1.2, 0.08, 0.35], [BOX, WOOD2, 0.5, 0.62, -0.3, 0.06, 0.06, 1.6],
  ]), charMat));
  scene.add(boat);
  updaters.push(() => { const t = performance.now() / 1000; boat.position.y = WATER_Y - 0.15 + Math.sin(t * 1.3) * 0.05; boat.rotation.z = Math.sin(t * 1.1) * 0.04; });
  addInteractable({
    pos: spots.fishSpot, r: 2.4, label: () => (state.rod ? 'Fish off the dock' : 'Fish off the dock (need a rod)'),
    act: () => {
      if (!state.rod) { state.toast('You need a fishing rod. Odo might have a spare.'); return; }
      const faceTo = spots.dockFace;
      svc.sit(spots.fishSpot, Math.atan2(faceTo.x - spots.fishSpot.x, faceTo.z - spots.fishSpot.z), 'none');
      svc.playerAction('fish', 3 + Math.random() * 3, 'rod', () => {
        const r = Math.random();
        if (r < 0.6) { give('fish'); state.toast(['Caught a fish! 🐟', 'A fat little trout! 🐟', 'Fish on! 🐟'][(Math.random() * 3) | 0]); }
        else if (r < 0.75) { addCoins(1); state.toast('You reel in... a coin? 🪙'); }
        else state.toast(['Nothing bites.', 'It got away!', 'You catch some seaweed. Odo nods sagely.'][(Math.random() * 3) | 0]);
      });
    },
  });

  // ---------- Signposts ----------
  const compass = (from: THREE.Vector3, to: THREE.Vector3) => {
    const a = Math.atan2(to.x - from.x, -(to.z - from.z)); // 0 = north (-z)
    const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    return names[(Math.round(a / (Math.PI / 4)) + 8) % 8];
  };
  const signGeo = baked('sign', () => [[BOX, WOOD, 0, 1, 0, 0.14, 2, 0.14], [BOX, WOOD2, 0.35, 1.7, 0, 1.0, 0.28, 0.06], [BOX, WOOD2, -0.3, 1.3, 0, 0.9, 0.26, 0.06]]);
  const sign = (p: THREE.Vector3, places: [string, THREE.Vector3][]) => {
    place(scene, signGeo, p.x, p.z, rand(0, 6));
    addCircle(p.x, p.z, 0.2);
    addInteractable({ pos: p, r: 2, label: () => 'Read the signpost', act: () => readText('Signpost', [places.map(([n, at]) => `${n} → ${compass(p, at)} (${Math.round(p.distanceTo(at))} paces)`).join('\n')]) });
  };

  // ---------- Herbalist hut (Moss) ----------
  let hut = V(0, 70);
  for (let i = 0, best = -1; i < 400; i++) {
    const a = rand(0, 6.28), r = rand(62, 88);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = groundHeight(x, z);
    if (y < 3 || groundNormalY(x, z) < 0.93) continue;
    const roughness = Math.abs(groundHeight(x + 4, z) - groundHeight(x - 4, z)) + Math.abs(groundHeight(x, z + 4) - groundHeight(x, z - 4));
    const score = 10 - roughness - Math.abs(a - 3.6) * 0.2;
    if (score > best) { best = score; hut = V(x, z); }
  }
  clearings.push({ x: hut.x, z: hut.z, r: 9 });
  const h = house(hut.x, hut.z, { scale: 0.7, wall: '#8a7a5a', roof: '#4a6a3a' });
  doors.moss = h.door;
  spots.hut = h.door;
  const caul = h.at(2.6, 2.8);
  place(scene, baked('cauldron', () => [[BALL, '#2a2a2e', 0, 0.45, 0, 1.0, 0.8, 1.0], [CYL, '#5ac85a', 0, 0.72, 0, 0.75, 0.04, 0.75], [BOX, '#3a2a1a', -0.6, 0.6, 0, 0.1, 1.2, 0.1], [BOX, '#3a2a1a', 0.6, 0.6, 0, 0.1, 1.2, 0.1], [BOX, '#3a2a1a', 0, 1.2, 0, 1.3, 0.08, 0.08]]), caul.x, caul.z, h.rot);
  addCircle(caul.x, caul.z, 0.6);
  spots.cauldron = h.at(2.6, 3.9);
  spots.hutGarden = h.at(-2.5, 3.5);
  addInteractable({ pos: caul, r: 2, label: () => 'Peek into the cauldron', act: () => state.toast(['It smells like socks and thunder.', 'Something in there winks at you.', 'Bubbling green. You decide not to taste it.'][(Math.random() * 3) | 0]) });

  sign(V(-34, -18), [['Thistlewick plaza', V(0, 0)], ["Odo's dock", spots.dockEnd], ["Moss's hut", hut], ['The high hill', hill]]);
  sign(spots.dockStart.clone().addScaledVector(dir, -1.5).add(new THREE.Vector3(Math.cos(dockRot) * 2, 0, -Math.sin(dockRot) * 2)), [['Thistlewick', V(0, 0)], ["Moss's hut", hut], ['The high hill', hill]]);
  const midHut = V(hut.x * 0.62, hut.z * 0.62);
  sign(midHut, [['Thistlewick', V(0, 0)], ["Moss's hut", hut], ["Odo's dock", spots.dockEnd]]);

  // ---------- Hilltop camp (Sela) ----------
  place(scene, baked('tent', () => [[CONE, '#9a8a6a', 0, 1.1, 0, 3.4, 2.2, 3.4], [BOX, '#3a2a1a', 0, 0.5, 1.2, 0.6, 1.0, 0.05], [CYL, '#6b4a2f', 0, 2.3, 0, 0.08, 0.5, 0.08]]), hill.x + 3, hill.z + 2, facing(hill.x, hill.z));
  addCircle(hill.x + 3, hill.z + 2, 1.6);
  clearings.push({ x: hill.x, z: hill.z, r: 7 });

  // ---------- Forage: berries, mushrooms, flowers, chests ----------
  const free = (x: number, z: number, r = 1) => !isWet(x, z) && !isBlocked(x, z, r) && groundNormalY(x, z) > 0.85;
  function scatter(n: number, rMin: number, rMax: number, test: (x: number, z: number) => boolean, center = new THREE.Vector3(), minGap = 4) {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < 3000 && out.length < n; i++) {
      const a = rand(0, 6.28), r = rand(rMin, rMax);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (Math.hypot(x, z) > 270 || !test(x, z)) continue;
      if (out.some(p => Math.hypot(p.x - x, p.z - z) < minGap)) continue;
      out.push(V(x, z));
    }
    return out;
  }

  const bushGeo = baked('bush', () => [[BALL, '#3a6a2e', 0, 0.55, 0, 1.6, 1.1, 1.5], [BALL, '#457a35', 0.4, 0.75, 0.2, 0.9, 0.8, 0.9]]);
  const berryGeo = baked('berries', () => Array.from({ length: 7 }, (_, i): Piece => [BALL, '#3a4ab8', Math.cos(i * 0.9) * 0.68, 0.4 + (i % 3) * 0.22, Math.sin(i * 0.9) * 0.62, 0.13, 0.13, 0.13]));
  lists.bushes = [];
  for (const p of scatter(12, 38, 85, (x, z) => free(x, z, 1.5) && groundHeight(x, z) > 2, undefined, 7)) {
    place(scene, bushGeo, p.x, p.z, rand(0, 6));
    const berries = placeDyn(scene, berryGeo, p.x, p.z, rand(0, 6), undefined, false);
    addCircle(p.x, p.z, 0.6);
    lists.bushes.push(p);
    let t = 0;
    updaters.push(dt => { if (!berries.visible && (t += dt) > 50) { t = 0; berries.visible = true; } });
    addInteractable({ pos: p, r: 2, label: () => (berries.visible ? 'Pick berries' : null), act: () => svc.playerAction('pet', 0.8, null, () => { berries.visible = false; give('berries', 2); state.toast('Picked some berries 🫐'); }) });
  }

  const shroomGeo = baked('shroom', () => [[CYL, '#efe8d8', 0, 0.12, 0, 0.1, 0.24, 0.1], [BALL, '#c8342a', 0, 0.26, 0, 0.32, 0.16, 0.32], [BOX, '#fff', 0.06, 0.33, 0.02, 0.05, 0.02, 0.05], [CYL, '#efe8d8', 0.18, 0.08, 0.1, 0.07, 0.16, 0.07], [BALL, '#b85a2a', 0.18, 0.18, 0.1, 0.2, 0.1, 0.2]]);
  const shroomSpots = [
    ...scatter(8, 4, 13, (x, z) => free(x, z, 0.4), hut, 2.5),
    ...scatter(12, 55, 150, (x, z) => free(x, z, 0.4) && groundHeight(x, z) > 2.5, undefined, 15),
  ];
  for (const p of shroomSpots) {
    const m = placeDyn(scene, shroomGeo, p.x, p.z, rand(0, 6), undefined, false);
    let t = 0;
    updaters.push(dt => { if (!m.visible && (t += dt) > 120) { t = 0; m.visible = true; } });
    addInteractable({ pos: p, r: 1.7, label: () => (m.visible ? 'Pick mushroom' : null), act: () => svc.playerAction('kneel', 0.7, null, () => { m.visible = false; give('mushrooms'); state.toast('Picked a mushroom 🍄'); }) });
  }

  const flowerGeo = baked('flowers', () => {
    const p: Piece[] = [];
    const cols = ['#e85a7a', '#f0d040', '#a87ae8', '#f8f8f0', '#f08a3a'];
    for (let i = 0; i < 8; i++) {
      const a = i * 2.4, r = 0.15 + (i % 3) * 0.2;
      p.push([BOX, '#4a8a3a', Math.cos(a) * r, 0.18, Math.sin(a) * r, 0.03, 0.36, 0.03], [BOX, cols[i % 5], Math.cos(a) * r, 0.38, Math.sin(a) * r, 0.14, 0.08, 0.14]);
    }
    return p;
  });
  for (const p of scatter(16, 16, 95, (x, z) => free(x, z, 0.8) && groundHeight(x, z) > 2 && !(Math.abs(x - 30) < 5 && Math.abs(z + 14) < 4.5), undefined, 6)) {
    clearings.push({ x: p.x, z: p.z, r: 1.2 });
    const m = placeDyn(scene, flowerGeo, p.x, p.z, rand(0, 6), undefined, false);
    let t = 0;
    updaters.push(dt => { if (!m.visible && (t += dt) > 60) { t = 0; m.visible = true; } });
    addInteractable({ pos: p, r: 1.8, label: () => (m.visible ? 'Pick flowers' : null), act: () => svc.playerAction('kneel', 0.7, null, () => { m.visible = false; give('flowers'); state.toast('Picked some flowers 🌼'); }) });
  }

  const chestGeo = baked('chest', () => [[BOX, '#7a4a2a', 0, 0.3, 0, 1.0, 0.6, 0.65], [BOX, '#c8a040', 0, 0.3, 0.33, 0.14, 0.18, 0.02], [BOX, '#3a3a3a', -0.35, 0.3, 0, 0.06, 0.62, 0.67], [BOX, '#3a3a3a', 0.35, 0.3, 0, 0.06, 0.62, 0.67]]);
  const lidGeo = baked('lid', () => [[BOX, '#8a5a34', 0, 0.1, 0.33, 1.04, 0.2, 0.68], [BOX, '#3a3a3a', -0.35, 0.1, 0.33, 0.06, 0.22, 0.7], [BOX, '#3a3a3a', 0.35, 0.1, 0.33, 0.06, 0.22, 0.7]]);
  for (const p of scatter(5, 70, 220, (x, z) => free(x, z, 1) && groundHeight(x, z) > 2 && groundHeight(x, z) < 34, undefined, 60)) {
    const rot = rand(0, 6);
    clearings.push({ x: p.x, z: p.z, r: 2 });
    place(scene, chestGeo, p.x, p.z, rot);
    const lid = placeDyn(scene, lidGeo, p.x, p.z, rot);
    // Hinge at the back edge
    lid.position.copy(local(p.x, p.z, rot, 0, -0.33)).setY(p.y + 0.6);
    addBox(p.x, p.z, 0.5, 0.33, rot);
    let opened = false, ang = 0;
    updaters.push(dt => { if (opened && ang < 1.9) { ang = Math.min(1.9, ang + dt * 4); lid.rotation.set(0, 0, 0); lid.rotateY(rot); lid.rotateX(-ang); } });
    addInteractable({
      pos: p, r: 2, label: () => (opened ? null : 'Open the chest'),
      act: () => svc.playerAction('pet', 0.8, null, () => { opened = true; const n = 6 + ((Math.random() * 6) | 0); addCoins(n); state.toast(`Treasure! ${n} coins 🪙`); }),
    });
  }

  // Wildlife meadows + Pip's hiding spots + lost animals
  const wild = scatter(12, 60, 200, (x, z) => free(x, z, 1) && groundHeight(x, z) > 2 && groundHeight(x, z) < 30, undefined, 30);
  const hideSpots = scatter(12, 45, 85, (x, z) => free(x, z, 1) && groundHeight(x, z) > 2, undefined, 10);
  spots.mittens = scatter(1, 75, 110, (x, z) => free(x, z, 1) && groundHeight(x, z) > 3)[0] ?? V(60, 60);
  spots.clover = scatter(1, 100, 150, (x, z) => free(x, z, 1) && groundHeight(x, z) > 3 && groundHeight(x, z) < 25)[0] ?? V(-90, 40);
  spots.gate = V(Math.cos(3.6) * 34, Math.sin(3.6) * 34);
  lists.patrol = [spots.gate, V(-20, -12), V(-30, 3), V(-16, 18), V(-28, -16)];
  spots.hill = hill;
  spots.hillView = hill.clone().add(new THREE.Vector3(-hill.x, 0, -hill.z).normalize().multiplyScalar(20));
  spots.shore = shore;

  // Cats like sitting on these
  lists.catNaps = [V(-18.5, 1.5), V(1.5, -1.8), doors.maren, V(-4, 7.2), spots.oven, doors.tobin];

  flushStatics(scene);
  const winMesh = new THREE.InstancedMesh(winGeo, windowMat, windows.length);
  windows.forEach((m, i) => winMesh.setMatrixAt(i, m));
  winMesh.computeBoundingSphere();
  scene.add(winMesh);

  clearings.push(
    { x: pen.x, z: pen.z, r: 9 }, { x: field.x, z: field.z, r: 7 }, { x: pig.x, z: pig.z, r: 4 }, { x: fire.x, z: fire.z, r: 6 },
    { x: pile.x, z: pile.z, r: 3 }, { x: POND.x, z: POND.z, r: POND.r + 2 }, { x: sockAt.x, z: sockAt.z, r: 2 },
    ...Array.from({ length: 6 }, (_, i) => { const p = start.clone().addScaledVector(dir, i * 3 - 4); return { x: p.x, z: p.z, r: 3 }; }),
    ...[...lists.bushes, ...shroomSpots].map(p => ({ x: p.x, z: p.z, r: 1.2 })),
  );

  return {
    lanternMat, windowMat, spots, lists, seats, campSeats, doors, bell: bellPos, clearings, wild, hideSpots,
    update: dt => updaters.forEach(u => u(dt)),
  };
}

export const isVillage = (x: number, z: number) => Math.hypot(x, z) < VILLAGE_R + 4;
