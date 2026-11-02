/** Static 2D colliders (infinite height) in a uniform spatial hash. */
export type Collider =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'box'; x: number; z: number; hx: number; hz: number; cos: number; sin: number };

const CELL = 16;
const cells = new Map<number, Collider[]>();
const key = (ix: number, iz: number) => (ix + 1000) * 4096 + (iz + 1000);

export function addCircle(x: number, z: number, r: number) {
  insert({ kind: 'circle', x, z, r }, x, z, r);
}

/** Box with half extents hx/hz, rotated by `rot` around Y (same convention as Object3D.rotation.y). */
export function addBox(x: number, z: number, hx: number, hz: number, rot: number) {
  insert({ kind: 'box', x, z, hx, hz, cos: Math.cos(rot), sin: Math.sin(rot) }, x, z, Math.hypot(hx, hz));
}

function insert(c: Collider, x: number, z: number, r: number) {
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const k = key(ix, iz);
      let list = cells.get(k);
      if (!list) cells.set(k, (list = []));
      list.push(c);
    }
  }
}

/** Pushes the point (p.x, p.z) out of any collider it overlaps. Returns true on contact. */
export function resolve(p: { x: number; z: number }, radius: number): boolean {
  const list = cells.get(key(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
  if (!list) return false;
  let hit = false;
  for (const c of list) {
    if (c.kind === 'circle') {
      const dx = p.x - c.x, dz = p.z - c.z;
      const min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 1e-4;
        p.x = c.x + (dx / d) * min;
        p.z = c.z + (dz / d) * min;
        hit = true;
      }
    } else {
      const wx = p.x - c.x, wz = p.z - c.z;
      let lx = wx * c.cos - wz * c.sin;
      let lz = wx * c.sin + wz * c.cos;
      const cx = Math.max(-c.hx, Math.min(c.hx, lx));
      const cz = Math.max(-c.hz, Math.min(c.hz, lz));
      let dx = lx - cx, dz = lz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        lx = cx + (dx / d) * radius;
        lz = cz + (dz / d) * radius;
      } else {
        // Centre is inside the box: exit along the shallowest axis.
        const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
        if (px < pz) lx = Math.sign(lx || 1) * (c.hx + radius);
        else lz = Math.sign(lz || 1) * (c.hz + radius);
      }
      p.x = c.x + lx * c.cos + lz * c.sin;
      p.z = c.z - lx * c.sin + lz * c.cos;
      hit = true;
    }
  }
  return hit;
}
