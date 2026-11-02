import * as THREE from 'three';
import { makeRng } from './noise';
import { groundHeight, groundNormalY, nDetail, WORLD_LIMIT, HALF, VILLAGE_R, inPond } from './terrain';
import { addCircle } from './colliders';

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
export function buildVegetation(scene: THREE.Scene, clearings: { x: number; z: number; r: number }[]) {
  type T = { x: number; z: number; y: number; s: number; rot: number; kind: 0 | 1 };
  const trees: T[] = [];
  const E = HALF - 10;
  const clear = (x: number, z: number, pad: number) => clearings.some(c => Math.hypot(x - c.x, z - c.z) < c.r + pad);
  for (let i = 0; i < 9000 && trees.length < 2200; i++) {
    const x = rand(-E, E), z = rand(-E, E);
    const r = Math.hypot(x, z);
    // A few trees dot the village edges; the forest proper starts just outside it.
    if (r > WORLD_LIMIT || (r < VILLAGE_R + 4 && (r < 44 || rng() > 0.15)) || clear(x, z, 2)) continue;
    const y = groundHeight(x, z);
    if (y < 2 || y > 32) continue;
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
  for (let i = 0; i < 3000 && rocks.length < 380; i++) {
    const x = rand(-E, E), z = rand(-E, E);
    const r = Math.hypot(x, z);
    if (r < VILLAGE_R + 2 || r > WORLD_LIMIT || clear(x, z, 1)) continue;
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
  for (let i = 0; i < 9000 && tufts.length < 3500; i++) {
    const x = rand(-200, 200), z = rand(-200, 200);
    const y = groundHeight(x, z);
    if (y < 2 || y > 25 || groundNormalY(x, z) < 0.85 || Math.hypot(x, z) < 14 || inPond(x, z, 0.5)) continue;
    tufts.push(new THREE.Vector3(x, y, z));
  }
  const flowerHues = [0.0, 0.13, 0.75, 0.58];
  const tuftItems = tufts.map(p => inst(
    tmpM.compose(p, tmpQ.identity(), tmpS.setScalar(rand(0.7, 1.4))),
    rng() < 0.3 ? tmpC.setHSL(flowerHues[(rng() * 4) | 0], 0.7, 0.65) : tmpC.setHSL(0.25, 0.55, 0.38),
  ));
  chunked(scene, new THREE.ConeGeometry(0.12, 0.5, 3).translate(0, 0.2, 0), new THREE.MeshLambertMaterial({ color: '#fff' }), tuftItems, false);
}

/** Scan the island for interesting spots (shore, hilltop, hiding places, shard sites). */
export function findSpots() {
  const r2 = makeRng(4242);
  let shore: THREE.Vector3 | null = null;
  let shoreD = Infinity;
  let hill: THREE.Vector3 | null = null;
  let hillScore = -Infinity;
  const shardSites: THREE.Vector3[] = [];

  for (let i = 0; i < 20000; i++) {
    const x = (r2() - 0.5) * (HALF * 1.8), z = (r2() - 0.5) * (HALF * 1.8);
    const r = Math.hypot(x, z);
    if (r > WORLD_LIMIT - 10) continue;
    const y = groundHeight(x, z);
    const ny = groundNormalY(x, z);
    if (y > 0.6 && y < 1.4 && ny > 0.9 && r < shoreD) { shoreD = r; shore = new THREE.Vector3(x, y, z); }
    if (r > 75 && r < 150 && ny > 0.85 && y < 30) {
      const score = y - r * 0.08;
      if (score > hillScore) { hillScore = score; hill = new THREE.Vector3(x, y, z); }
    }
    if (r > 60 && r < 240 && y > 1.5 && y < 38 && ny > 0.8 && shardSites.length < 8) {
      if (shardSites.every(s => s.distanceTo(new THREE.Vector3(x, y, z)) > 65)) shardSites.push(new THREE.Vector3(x, y, z));
    }
  }
  return { shore: shore!, hill: hill!, shardSites };
}

export interface Shard { mesh: THREE.Mesh; beam: THREE.Mesh; pos: THREE.Vector3; taken: boolean; }

export function buildShards(scene: THREE.Scene, sites: THREE.Vector3[]): Shard[] {
  const geo = new THREE.OctahedronGeometry(0.5, 0).scale(1, 1.7, 1);
  const mat = new THREE.MeshLambertMaterial({ color: '#9ff3ff', emissive: '#4fd8ff', emissiveIntensity: 0.9 });
  const beamGeo = new THREE.CylinderGeometry(0.35, 0.8, 60, 8, 1, true).translate(0, 30, 0);
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
