import * as THREE from 'three';
import { makeRng } from './noise';
import { groundHeight, groundNormalY, nDetail, WORLD_LIMIT } from './terrain';
import { addBox, addCircle } from './colliders';

const rng = makeRng(77);
const rand = (a: number, b: number) => a + rng() * (b - a);

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpE = new THREE.Euler();
const tmpC = new THREE.Color();

type Inst = { m: THREE.Matrix4; c: THREE.Color };
const CHUNK = 200;

/**
 * Split instances into a grid of InstancedMeshes so the frustum (and the shadow camera's
 * frustum) can cull whole chunks instead of always drawing every tree on the island.
 */
function chunked(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, items: Inst[], shadows = true) {
  const groups = new Map<string, Inst[]>();
  const p = new THREE.Vector3();
  for (const it of items) {
    p.setFromMatrixPosition(it.m);
    const k = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(it);
  }
  for (const list of groups.values()) {
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => { m.setMatrixAt(i, it.m); m.setColorAt(i, it.c); });
    m.castShadow = shadows;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    scene.add(m);
  }
}
const inst = (m: THREE.Matrix4, c: THREE.Color): Inst => ({ m: m.clone(), c: c.clone() });

/** Trees and rocks: a handful of InstancedMeshes = a handful of draw calls for thousands of objects. */
export function buildVegetation(scene: THREE.Scene) {
  type T = { x: number; z: number; y: number; s: number; rot: number; kind: 0 | 1 };
  const trees: T[] = [];
  for (let i = 0; i < 9000 && trees.length < 2600; i++) {
    const x = rand(-480, 480), z = rand(-480, 480);
    const r = Math.hypot(x, z);
    if (r < 42 || r > WORLD_LIMIT) continue;
    const y = groundHeight(x, z);
    if (y < 2 || y > 38) continue;
    if (groundNormalY(x, z) < 0.8) continue;
    const density = nDetail.noise(x * 0.008 + 40, z * 0.008);
    if (density < -0.15 && rng() > 0.12) continue;
    const kind = y > 18 || density > 0.35 ? 0 : rng() < 0.5 ? 0 : 1;
    trees.push({ x, z, y, s: rand(0.8, 1.5), rot: rand(0, Math.PI * 2), kind });
  }

  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1.8, 5).translate(0, 0.9, 0);
  const pineGeo = new THREE.ConeGeometry(1.5, 3.8, 6).translate(0, 3.6, 0);
  const leafGeo = new THREE.IcosahedronGeometry(1.7, 0).translate(0, 3.2, 0);
  const trunkMat = new THREE.MeshLambertMaterial({ color: '#6b4a2f' });
  const leafMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });

  const trunks: Inst[] = [], pines: Inst[] = [], leafy: Inst[] = [];
  const trunkC = new THREE.Color('#ffffff');
  trees.forEach(t => {
    tmpQ.setFromEuler(tmpE.set(0, t.rot, 0));
    tmpS.set(t.s, t.s * rand(0.9, 1.2), t.s);
    tmpM.compose(tmpP.set(t.x, t.y - 0.1, t.z), tmpQ, tmpS);
    trunks.push(inst(tmpM, trunkC));
    if (t.kind === 0) pines.push(inst(tmpM, tmpC.setHSL(rand(0.27, 0.33), rand(0.35, 0.5), rand(0.22, 0.3))));
    else leafy.push(inst(tmpM, tmpC.setHSL(rand(0.2, 0.3), rand(0.45, 0.6), rand(0.3, 0.42))));
    addCircle(t.x, t.z, 0.35 * t.s);
  });
  chunked(scene, trunkGeo, trunkMat, trunks);
  chunked(scene, pineGeo, leafMat, pines);
  chunked(scene, leafGeo, leafMat, leafy);

  // Rocks
  const rocks: { x: number; z: number; y: number; sx: number; sy: number; sz: number; r: number }[] = [];
  for (let i = 0; i < 3000 && rocks.length < 500; i++) {
    const x = rand(-480, 480), z = rand(-480, 480);
    const r = Math.hypot(x, z);
    if (r < 30 || r > WORLD_LIMIT) continue;
    const y = groundHeight(x, z);
    if (y < -1) continue;
    const s = rand(0.4, 1) ** 2 * 3 + 0.3;
    rocks.push({ x, z, y, sx: s * rand(0.8, 1.4), sy: s * rand(0.5, 0.9), sz: s * rand(0.8, 1.4), r: rand(0, 6) });
  }
  const rockItems: Inst[] = [];
  rocks.forEach(k => {
    tmpQ.setFromEuler(tmpE.set(rand(-0.3, 0.3), k.r, rand(-0.3, 0.3)));
    tmpM.compose(tmpP.set(k.x, k.y - k.sy * 0.25, k.z), tmpQ, tmpS.set(k.sx, k.sy, k.sz));
    rockItems.push(inst(tmpM, tmpC.setHSL(0.08, 0.05, rand(0.38, 0.55))));
    if (k.sx > 1.1 && k.sz > 1.1) addCircle(k.x, k.z, Math.min(k.sx, k.sz) * 0.8);
  });
  chunked(scene, new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#ffffff' }), rockItems);

  // Flowers / grass tufts: tiny, no shadows, one draw call.
  const tufts: THREE.Vector3[] = [];
  for (let i = 0; i < 8000 && tufts.length < 3000; i++) {
    const x = rand(-300, 300), z = rand(-300, 300);
    const y = groundHeight(x, z);
    if (y < 2 || y > 25 || groundNormalY(x, z) < 0.85 || Math.hypot(x, z) < 14) continue;
    tufts.push(new THREE.Vector3(x, y, z));
  }
  const flowerHues = [0.0, 0.13, 0.75, 0.58];
  const tuftItems = tufts.map(p => inst(
    tmpM.compose(p, tmpQ.identity(), tmpS.setScalar(rand(0.7, 1.4))),
    rng() < 0.3 ? tmpC.setHSL(flowerHues[(rng() * 4) | 0], 0.7, 0.65) : tmpC.setHSL(0.25, 0.55, 0.38),
  ));
  chunked(scene, new THREE.ConeGeometry(0.12, 0.5, 3).translate(0, 0.2, 0), new THREE.MeshLambertMaterial({ color: '#fff' }), tuftItems, false);
}

export interface Village {
  lanternMat: THREE.MeshLambertMaterial;
  windowMat: THREE.MeshLambertMaterial;
  spots: Record<string, THREE.Vector3>;
}

export function buildVillage(scene: THREE.Scene): Village {
  const plaster = new THREE.MeshLambertMaterial({ color: '#e8dcc2' });
  const plaster2 = new THREE.MeshLambertMaterial({ color: '#d9c7a4' });
  const roofMats = ['#9c3d2e', '#5a6e8c', '#7a5537', '#4f7348'].map(c => new THREE.MeshLambertMaterial({ color: c }));
  const wood = new THREE.MeshLambertMaterial({ color: '#5b3d26' });
  const stone = new THREE.MeshLambertMaterial({ color: '#8a8580' });
  const windowMat = new THREE.MeshLambertMaterial({ color: '#2a2a35', emissive: '#ffb347', emissiveIntensity: 0 });
  const lanternMat = new THREE.MeshLambertMaterial({ color: '#3a3a3a', emissive: '#ffbf5e', emissiveIntensity: 0 });

  const wallGeo = new THREE.BoxGeometry(6, 3.4, 5);
  const roofGeo = new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4);
  const doorGeo = new THREE.BoxGeometry(1.2, 2.1, 0.12);
  const winGeo = new THREE.BoxGeometry(0.9, 0.8, 0.12);
  const chimGeo = new THREE.BoxGeometry(0.7, 1.8, 0.7);

  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  const houseAngles = [0.25, 1.1, 1.9, 2.75, 3.6, 4.45, 5.35];
  houseAngles.forEach((a, i) => {
    if (i === 4) return; // gap: the road out of the village
    const r = 24 + (i % 2) * 3;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const rot = Math.atan2(-x, -z); // front (+z) faces plaza
    const g = new THREE.Group();
    g.position.set(x, groundHeight(x, z) - 0.2, z);
    g.rotation.y = rot;
    add(g, wallGeo, i % 2 ? plaster : plaster2, 0, 1.7, 0);
    const roof = add(g, roofGeo, roofMats[i % roofMats.length], 0, 3.4 + 1.4, 0);
    roof.scale.set(4.8, 2.8, 4.1);
    add(g, doorGeo, wood, 0, 1.05, 2.52, false);
    add(g, winGeo, windowMat, -1.9, 2.0, 2.52, false);
    add(g, winGeo, windowMat, 1.9, 2.0, 2.52, false);
    add(g, chimGeo, stone, 1.6, 4.9, -1, true);
    scene.add(g);
    addBox(x, z, 3.1, 2.6, rot);
  });

  // Well at the centre of the plaza
  const well = new THREE.Group();
  well.position.set(0, groundHeight(0, 0), 0);
  add(well, new THREE.CylinderGeometry(1.3, 1.4, 1, 12), stone, 0, 0.5, 0);
  add(well, new THREE.CylinderGeometry(1.05, 1.05, 0.05, 12), new THREE.MeshLambertMaterial({ color: '#1d3b4f' }), 0, 0.9, 0, false);
  const postGeo = new THREE.BoxGeometry(0.18, 2.4, 0.18);
  add(well, postGeo, wood, -1.15, 1.6, 0);
  add(well, postGeo, wood, 1.15, 1.6, 0);
  add(well, new THREE.ConeGeometry(1.9, 1.1, 4).rotateY(Math.PI / 4), roofMats[0], 0, 3.2, 0);
  scene.add(well);
  addCircle(0, 0, 1.5);

  // Lantern posts around the plaza (dark until the shards are returned)
  const lanternGeo = new THREE.BoxGeometry(0.4, 0.5, 0.4);
  const lpostGeo = new THREE.CylinderGeometry(0.07, 0.09, 3, 5);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const x = Math.cos(a) * 13, z = Math.sin(a) * 13;
    const y = groundHeight(x, z);
    add(scene, lpostGeo, wood, x, y + 1.5, z);
    add(scene, lanternGeo, lanternMat, x, y + 3.1, z);
    addCircle(x, z, 0.25);
  }

  // Market stall (Ilsa)
  const stallA = 3.1;
  const sx = Math.cos(stallA) * 15, sz = Math.sin(stallA) * 15;
  const stall = new THREE.Group();
  stall.position.set(sx, groundHeight(sx, sz), sz);
  stall.rotation.y = Math.atan2(-sx, -sz);
  add(stall, new THREE.BoxGeometry(3, 1, 1.2), wood, 0, 0.5, 0);
  for (const [px, pz] of [[-1.4, -0.5], [1.4, -0.5], [-1.4, 0.5], [1.4, 0.5]]) add(stall, new THREE.BoxGeometry(0.12, 2.6, 0.12), wood, px, 1.3, pz);
  const awning = add(stall, new THREE.BoxGeometry(3.4, 0.1, 1.8), new THREE.MeshLambertMaterial({ color: '#c0463a' }), 0, 2.65, 0.2);
  awning.rotation.x = 0.2;
  for (let i = 0; i < 4; i++) add(stall, new THREE.BoxGeometry(0.35, 0.3, 0.35), new THREE.MeshLambertMaterial({ color: ['#e0b04a', '#8fbf5a', '#c8742f', '#d9d2c2'][i] }), -1.05 + i * 0.7, 1.15, 0, false);
  scene.add(stall);
  addBox(sx, sz, 1.6, 0.7, stall.rotation.y);
  const stallFront = new THREE.Vector3(0, 0, -1.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), stall.rotation.y).add(stall.position);

  // Forge (Tobin): anvil + glowing coals
  const fa = 1.5;
  const fx = Math.cos(fa) * 15, fz = Math.sin(fa) * 15;
  const forge = new THREE.Group();
  forge.position.set(fx, groundHeight(fx, fz), fz);
  add(forge, new THREE.BoxGeometry(2, 1, 1.6), stone, 0, 0.5, 0);
  add(forge, new THREE.BoxGeometry(1.5, 0.15, 1.1), new THREE.MeshBasicMaterial({ color: '#ff7a2a' }), 0, 1.03, 0, false);
  add(forge, new THREE.BoxGeometry(0.8, 0.5, 0.35), new THREE.MeshLambertMaterial({ color: '#333' }), 2.0, 0.7, 0.5);
  scene.add(forge);
  addCircle(fx, fz, 1.2);
  addCircle(fx + 2, fz + 0.5, 0.45);

  return {
    lanternMat,
    windowMat,
    spots: {
      well: new THREE.Vector3(3, 0, 2.5),
      stall: stallFront,
      forge: new THREE.Vector3(fx - 1.2, 0, fz - 2.4),
      gate: new THREE.Vector3(Math.cos(3.6) * 34, 0, Math.sin(3.6) * 34),
    },
  };
}

/** Scan the island for interesting spots (shore, hilltop, hiding places, shard sites). */
export function findSpots() {
  const r2 = makeRng(4242);
  let shore: THREE.Vector3 | null = null;
  let shoreD = Infinity;
  let hill: THREE.Vector3 | null = null;
  let hillScore = -Infinity;
  const shardSites: THREE.Vector3[] = [];
  const hideSpots: THREE.Vector3[] = [];

  for (let i = 0; i < 20000; i++) {
    const x = (r2() - 0.5) * 900, z = (r2() - 0.5) * 900;
    const r = Math.hypot(x, z);
    if (r > WORLD_LIMIT - 10) continue;
    const y = groundHeight(x, z);
    const ny = groundNormalY(x, z);
    if (y > 0.6 && y < 1.4 && ny > 0.9 && r < shoreD) { shoreD = r; shore = new THREE.Vector3(x, y, z); }
    if (r > 120 && r < 260 && ny > 0.85 && y < 34) {
      const score = y - r * 0.05;
      if (score > hillScore) { hillScore = score; hill = new THREE.Vector3(x, y, z); }
    }
    if (r > 55 && r < 110 && y > 2 && ny > 0.85 && hideSpots.length < 12) hideSpots.push(new THREE.Vector3(x, y, z));
    if (r > 70 && r < 400 && y > 1.5 && y < 45 && ny > 0.8 && shardSites.length < 8) {
      if (shardSites.every(s => s.distanceTo(new THREE.Vector3(x, y, z)) > 110)) shardSites.push(new THREE.Vector3(x, y, z));
    }
  }
  return { shore: shore!, hill: hill!, shardSites, hideSpots };
}

export interface Shard { mesh: THREE.Mesh; beam: THREE.Mesh; pos: THREE.Vector3; taken: boolean; }

export function buildShards(scene: THREE.Scene, sites: THREE.Vector3[]): Shard[] {
  const geo = new THREE.OctahedronGeometry(0.5, 0).scale(1, 1.7, 1);
  const mat = new THREE.MeshLambertMaterial({ color: '#9ff3ff', emissive: '#4fd8ff', emissiveIntensity: 0.9 });
  const beamGeo = new THREE.CylinderGeometry(0.35, 0.8, 70, 8, 1, true).translate(0, 35, 0);
  const beamMat = new THREE.MeshBasicMaterial({
    color: '#8ff0ff', transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
  });
  return sites.map(p => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(p).setY(groundHeight(p.x, p.z) + 1.2);
    mesh.castShadow = true;
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.copy(mesh.position);
    scene.add(mesh, beam);
    return { mesh, beam, pos: mesh.position, taken: false };
  });
}
