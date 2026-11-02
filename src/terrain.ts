import * as THREE from 'three';
import { Simplex2, makeRng, smoothstep, lerp, clamp } from './noise';
import { platformHeight } from './colliders';

/** The island used to be 1000 units across; everything is now packed into a smaller one. */
export const WORLD = 500;
export const SEG = 250;
const S = WORLD / 1000;
export const CELL = WORLD / SEG;
export const HALF = WORLD / 2;
export const VILLAGE_H = 5;
export const WATER_Y = 0;
/** Players/NPCs can't go past this radius (open sea). */
export const WORLD_LIMIT = HALF * 0.92;
/** Flat radius of the village plateau. */
export const VILLAGE_R = 50;
/** Small village pond (its own water surface, slightly below the plateau). */
export const POND = { x: -38, z: 8, r: 5.2, y: VILLAGE_H - 0.3 };
export const inPond = (x: number, z: number, pad = 0) => Math.hypot(x - POND.x, z - POND.z) < POND.r + pad;

const rng = makeRng(20261102);
const nHills = new Simplex2(rng);
const nMount = new Simplex2(rng);
const nMask = new Simplex2(rng);
const nCoast = new Simplex2(rng);
export const nDetail = new Simplex2(rng);

/** Analytic height function. Only used to build the grid; gameplay samples the grid. */
function rawHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const d = r / HALF;
  // Noise is sampled in "old island" units so the landscape keeps its shape, just compressed.
  const ux = x / S, uz = z / S, ur = r / S;
  const coast = 0.8 + 0.13 * nCoast.fbm(ux * 0.0028 + 11, uz * 0.0028 - 7, 3);
  const island = 1 - smoothstep(coast - 0.22, coast, d);

  let h = nHills.fbm(ux * 0.006, uz * 0.006, 4) * 8 + 7;
  const mountainMask =
    smoothstep(0.0, 0.45, nMask.fbm(ux * 0.0022 + 3, uz * 0.0022 + 9, 2)) * smoothstep(90, 210, ur);
  h += nMount.ridged(ux * 0.007, uz * 0.007, 4) * 44 * mountainMask;

  h = h * island - (1 - island) * 16;

  // Flatten a plateau for the village at the origin, with a pond dug into it.
  let base = VILLAGE_H + nDetail.noise(x * 0.05, z * 0.05) * 0.15;
  const pd = Math.hypot(x - POND.x, z - POND.z);
  base -= (1 - smoothstep(POND.r - 3, POND.r + 0.8, pd)) * 1.4;
  const v = smoothstep(VILLAGE_R, VILLAGE_R + 45, r);
  return lerp(base, h, v);
}

const W = SEG + 1;
export const heights = new Float32Array(W * W);
for (let iz = 0; iz < W; iz++) {
  for (let ix = 0; ix < W; ix++) {
    heights[iz * W + ix] = rawHeight(-HALF + ix * CELL, -HALF + iz * CELL);
  }
}

/** Height of the rendered terrain surface (matches mesh triangulation exactly). */
export function groundHeight(x: number, z: number): number {
  const gx = (x + HALF) / CELL;
  const gz = (z + HALF) / CELL;
  if (gx < 0 || gz < 0 || gx >= SEG || gz >= SEG) return -16;
  const ix = gx | 0, iz = gz | 0;
  const fx = gx - ix, fz = gz - iz;
  const ha = heights[iz * W + ix];
  const hb = heights[(iz + 1) * W + ix];
  const hc = heights[(iz + 1) * W + ix + 1];
  const hd = heights[iz * W + ix + 1];
  if (fx + fz <= 1) return ha + (hd - ha) * fx + (hb - ha) * fz;
  return hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
}

/** Height you can stand on: terrain or a platform such as the dock. */
export function floorHeight(x: number, z: number): number {
  return Math.max(groundHeight(x, z), platformHeight(x, z));
}

/** Places land creatures should not walk into. */
export function isWet(x: number, z: number): boolean {
  return floorHeight(x, z) < WATER_Y + 0.35 || inPond(x, z, 0.4);
}

/** Y component of the surface normal (1 = flat, 0 = vertical). */
export function groundNormalY(x: number, z: number): number {
  const e = 1.5;
  const dx = groundHeight(x + e, z) - groundHeight(x - e, z);
  const dz = groundHeight(x, z + e) - groundHeight(x, z - e);
  return 2 * e / Math.hypot(dx, 2 * e, dz);
}

const C = {
  sand: new THREE.Color('#d9c48f'),
  wetSand: new THREE.Color('#a8956a'),
  grass1: new THREE.Color('#5d9a3c'),
  grass2: new THREE.Color('#82ad48'),
  forest: new THREE.Color('#3f7a33'),
  dirt: new THREE.Color('#9b7d55'),
  rock: new THREE.Color('#7d776f'),
  rockDark: new THREE.Color('#5d5852'),
  snow: new THREE.Color('#f2f4f7'),
  seabed: new THREE.Color('#6b8f7a'),
};

export function terrainColor(x: number, z: number, h: number, ny: number, out: THREE.Color): THREE.Color {
  const n = nDetail.noise(x * 0.03, z * 0.03);
  const r = Math.hypot(x, z);
  if (h < -1.5) out.copy(C.seabed);
  else if (h < 0.3) out.copy(C.wetSand);
  else if (h < 1.8 + n * 0.6) out.copy(C.sand);
  else {
    out.copy(C.grass1).lerp(C.grass2, clamp(0.5 + n * 0.8, 0, 1));
    out.lerp(C.forest, smoothstep(0.1, 0.6, nDetail.noise(x * 0.008 + 40, z * 0.008)) * 0.6);
    if (r < 26) out.lerp(C.dirt, smoothstep(26, 14, r) * (0.55 + n * 0.25));
    // Worn paths: the road out of the gate and a ring lane between the houses.
    const ang = Math.atan2(z, x);
    const road = Math.abs(Math.atan2(Math.sin(ang - 3.6 + Math.PI * 2), Math.cos(ang - 3.6))) * r;
    if (r > 12 && r < 75) out.lerp(C.dirt, smoothstep(3.2, 1.2, road) * 0.6);
    out.lerp(C.dirt, smoothstep(2.6, 0.6, Math.abs(r - 31)) * 0.35 * smoothstep(0.4, -0.2, n));
    const pd = Math.hypot(x - POND.x, z - POND.z);
    if (pd < POND.r + 1.4) out.lerp(pd < POND.r ? C.seabed : C.wetSand, 0.8);
  }
  const rockiness = smoothstep(0.82, 0.68, ny);
  if (rockiness > 0) out.lerp(n > 0 ? C.rock : C.rockDark, rockiness);
  const snow = smoothstep(36 + n * 4, 43 + n * 4, h) * smoothstep(0.55, 0.75, ny);
  if (snow > 0) out.lerp(C.snow, snow);
  return out;
}

export function buildTerrainMesh(): THREE.Mesh {
  const pos = new Float32Array(W * W * 3);
  for (let iz = 0; iz < W; iz++) {
    for (let ix = 0; ix < W; ix++) {
      const i = iz * W + ix;
      pos[i * 3] = -HALF + ix * CELL;
      pos[i * 3 + 1] = heights[i];
      pos[i * 3 + 2] = -HALF + iz * CELL;
    }
  }
  const idx = new Uint32Array(SEG * SEG * 6);
  let k = 0;
  for (let iz = 0; iz < SEG; iz++) {
    for (let ix = 0; ix < SEG; ix++) {
      const a = iz * W + ix, b = (iz + 1) * W + ix, c = (iz + 1) * W + ix + 1, d = iz * W + ix + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = d;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  const nrm = geo.getAttribute('normal');
  const col = new Float32Array(W * W * 3);
  const c = new THREE.Color();
  for (let i = 0; i < W * W; i++) {
    terrainColor(pos[i * 3], pos[i * 3 + 2], pos[i * 3 + 1], nrm.getY(i), c);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export function buildWater(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(2400, 2400, 1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhongMaterial({
    color: '#2b6f93', specular: '#bfe3ff', shininess: 90, transparent: true, opacity: 0.82,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = WATER_Y;
  m.receiveShadow = true;
  const pond = new THREE.Mesh(new THREE.CircleGeometry(POND.r + 0.6, 24).rotateX(-Math.PI / 2), mat);
  pond.position.set(POND.x, POND.y, POND.z);
  m.add(pond);
  pond.position.y = POND.y - WATER_Y;
  return m;
}
