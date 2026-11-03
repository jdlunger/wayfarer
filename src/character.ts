import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface CharStyle {
  skin: string;
  shirt: string;
  pants: string;
  hair: string;
  hat?: string;
  robe?: boolean;
  beard?: string;
  scale?: number;
}

/** Full-body activity animations layered over (or replacing) the walk cycle. */
export type Pose =
  | 'none' | 'chop' | 'hammer' | 'hoe' | 'sweep' | 'sit' | 'sitGround' | 'fish' | 'wave' | 'carry' | 'dance'
  | 'lute' | 'reach' | 'knead' | 'scatter' | 'look' | 'scared' | 'pet' | 'talk' | 'cheer' | 'read' | 'kneel';

export type PropKind = 'axe' | 'hammer' | 'hoe' | 'broom' | 'rod' | 'lute' | 'crate' | 'logs' | 'basket' | 'bucket' | 'bread';

// Shared geometry: every character reuses the same handful of buffers.
const G = {
  leg: new THREE.BoxGeometry(0.22, 0.85, 0.24).translate(0, -0.42, 0),
  arm: new THREE.BoxGeometry(0.17, 0.7, 0.19).translate(0, -0.32, 0),
  body: new THREE.BoxGeometry(0.62, 0.72, 0.36),
  robe: new THREE.CylinderGeometry(0.3, 0.46, 1.25, 6),
  head: new THREE.BoxGeometry(0.42, 0.42, 0.4),
  hair: new THREE.BoxGeometry(0.46, 0.14, 0.44),
  hairBack: new THREE.BoxGeometry(0.46, 0.3, 0.1),
  eye: new THREE.BoxGeometry(0.07, 0.07, 0.02),
  hatBrim: new THREE.CylinderGeometry(0.42, 0.42, 0.05, 10),
  hatTop: new THREE.CylinderGeometry(0.22, 0.25, 0.3, 10),
  beard: new THREE.BoxGeometry(0.34, 0.2, 0.08),
  shadow: new THREE.CircleGeometry(0.45, 12).rotateX(-Math.PI / 2),
};

export const charMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const shadowMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false });

export type Piece = [geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, sx?: number, sy?: number, sz?: number];

/** Bake several coloured parts into one geometry so each body part is a single draw call. */
export function bake(pieces: Piece[]): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const mixed = pieces.some(p => !p[0].index);
  const geos = pieces.map(([g, color, x, y, z, sx = 1, sy = 1, sz = 1]) => {
    const geo = (mixed && g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m.makeScale(sx, sy, sz).setPosition(x, y, z));
    c.set(color);
    const n = geo.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.deleteAttribute('uv');
    return geo;
  });
  return mergeGeometries(geos)!;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const BALL = new THREE.IcosahedronGeometry(0.5, 0);
const CYL_X = CYL.clone().rotateZ(Math.PI / 2);
const CONE = new THREE.ConeGeometry(0.5, 1, 6);
export const SHAPES = { BOX, CYL, BALL, CONE };

/** Held items. 'hand' props hang off the right hand and extend along the arm (-y). */
const PROPS: Record<PropKind, { slot: 'hand' | 'handL' | 'chest'; build: () => THREE.BufferGeometry }> = {
  hammer: { slot: 'hand', build: () => bake([[CYL, '#7a5634', 0, -0.2, 0, 0.06, 0.55, 0.06], [BOX, '#555a60', 0, -0.45, 0.04, 0.14, 0.14, 0.32]]) },
  axe: { slot: 'hand', build: () => bake([[CYL, '#7a5634', 0, -0.3, 0, 0.06, 0.8, 0.06], [BOX, '#a3a9ae', 0, -0.6, 0.14, 0.05, 0.28, 0.26]]) },
  hoe: { slot: 'hand', build: () => bake([[CYL, '#7a5634', 0, -0.6, 0, 0.05, 1.5, 0.05], [BOX, '#6d7177', 0, -1.33, 0.13, 0.05, 0.1, 0.3]]) },
  broom: { slot: 'hand', build: () => bake([[CYL, '#8a6a44', 0, -0.55, 0, 0.05, 1.4, 0.05], [BOX, '#c9a85a', 0, -1.32, 0, 0.32, 0.36, 0.12]]) },
  rod: {
    slot: 'hand',
    build: () => bake([[CYL, '#8a6a44', 0, -1.1, 0, 0.04, 2.4, 0.04]]).translate(0, 0.1, 0).rotateX(-1.25),
  },
  lute: {
    slot: 'chest',
    build: () => bake([
      [CYL, '#a8743c', 0, 0, 0, 0.42, 0.12, 0.42], [BOX, '#5b3d26', 0, 0, 0.42, 0.08, 0.05, 0.55], [BOX, '#2a1c12', 0, 0.07, 0, 0.1, 0.02, 0.1],
    ]).rotateX(-Math.PI / 2).rotateZ(0.9).translate(0.05, 1.12, 0.3),
  },
  crate: { slot: 'chest', build: () => bake([[BOX, '#9b7748', 0, 1.22, 0.48, 0.6, 0.5, 0.5], [BOX, '#7a5634', 0, 1.22, 0.48, 0.64, 0.08, 0.54]]) },
  logs: {
    slot: 'chest',
    build: () => bake([[CYL_X, '#7a5634', 0, 1.15, 0.42, 0.75, 0.2, 0.2], [CYL_X, '#6b4a2f', 0, 1.15, 0.64, 0.75, 0.2, 0.2], [CYL_X, '#7a5634', 0, 1.33, 0.53, 0.75, 0.2, 0.2]]),
  },
  basket: { slot: 'handL', build: () => bake([[BOX, '#b58d52', 0, -0.12, 0.05, 0.32, 0.22, 0.32], [BOX, '#d9c27a', 0, -0.02, 0.05, 0.26, 0.04, 0.26]]) },
  bucket: { slot: 'hand', build: () => bake([[CYL, '#7d8590', 0, -0.2, 0, 0.3, 0.3, 0.3], [CYL, '#3a6f93', 0, -0.06, 0, 0.26, 0.02, 0.26]]) },
  bread: { slot: 'hand', build: () => bake([[BALL, '#c98a3e', 0, -0.06, 0.08, 0.3, 0.18, 0.2]]) },
};
const propGeo = new Map<PropKind, THREE.BufferGeometry>();

function mesh(geo: THREE.BufferGeometry, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, charMat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** Blocky low-poly humanoid with procedural walk + activity animation. Faces +Z. */
export class Character {
  readonly root = new THREE.Group();
  private model = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private head: THREE.Mesh;
  private blob: THREE.Mesh;
  private phase = Math.random() * 10;
  private t = Math.random() * 10;
  private headX = 0;
  private prop: THREE.Mesh | null = null;
  private propKind: PropKind | null = null;

  constructor(private style: CharStyle) {
    const s = style.scale ?? 1;
    this.model.scale.setScalar(s);
    this.root.add(this.model);

    const { skin, shirt, pants } = style;
    this.legL.position.set(-0.13, 0.88, 0);
    this.legR.position.set(0.13, 0.88, 0);
    const legGeo = bake([[G.leg, pants, 0, 0, 0]]);
    mesh(legGeo, this.legL);
    mesh(legGeo, this.legR);
    this.model.add(this.legL, this.legR);

    mesh(bake([style.robe ? [G.robe, shirt, 0, 1.0, 0] : [G.body, shirt, 0, 1.24, 0]]), this.model);

    this.armL.position.set(-0.41, 1.56, 0);
    this.armR.position.set(0.41, 1.56, 0);
    const armGeo = bake([[G.arm, shirt, 0, 0, 0], [G.arm, skin, 0, -0.62, 0, 0.9, 0.12, 0.9]]);
    mesh(armGeo, this.armL);
    mesh(armGeo, this.armR);
    this.model.add(this.armL, this.armR);

    this.head = mesh(this.headGeo(), this.model, 0, 1.82, 0);

    // Cheap blob shadow — keeps characters grounded when real shadows are off.
    this.blob = new THREE.Mesh(G.shadow, shadowMat);
    this.blob.renderOrder = 1;
    this.root.add(this.blob);
  }

  private headGeo() {
    const { skin, hair, hat, beard } = this.style;
    const parts: Piece[] = [
      [G.head, skin, 0, 0, 0],
      [G.hair, hair, 0, 0.24, 0],
      [G.hairBack, hair, 0, 0.08, -0.2],
      [G.eye, '#1d1a18', -0.09, 0.03, 0.205],
      [G.eye, '#1d1a18', 0.09, 0.03, 0.205],
    ];
    if (beard) parts.push([G.beard, beard, 0, -0.14, 0.2]);
    if (hat) parts.push([G.hatBrim, hat, 0, 0.26, 0], [G.hatTop, hat, 0, 0.42, 0]);
    return bake(parts);
  }

  /** Change hair/hat/beard colours (rebuilds only the head). */
  restyle(patch: Partial<CharStyle>) {
    Object.assign(this.style, patch);
    this.head.geometry.dispose();
    this.head.geometry = this.headGeo();
  }

  setProp(kind: PropKind | null) {
    if (kind === this.propKind) return;
    this.propKind = kind;
    if (this.prop) this.prop.removeFromParent();
    this.prop = null;
    if (!kind) return;
    const def = PROPS[kind];
    let geo = propGeo.get(kind);
    if (!geo) propGeo.set(kind, (geo = def.build()));
    const parent = def.slot === 'chest' ? this.model : def.slot === 'hand' ? this.armR : this.armL;
    this.prop = mesh(geo, parent, 0, def.slot === 'chest' ? 0 : -0.66, 0);
  }

  private blobOn = true;
  setBlobVisible(v: boolean) { this.blobOn = v; }

  /**
   * @param speed signed ground speed (negative = walking backward)
   * @param airborne true while jumping/falling
   */
  animate(dt: number, speed: number, airborne: boolean, swimming = false, pose: Pose = 'none') {
    this.t += dt;
    const t = this.t;
    const moving = Math.abs(speed) > 0.2;
    this.phase += dt * speed * 1.9;
    const amp = moving ? Math.min(0.9, 0.35 + Math.abs(speed) * 0.07) : 0;
    const target = Math.sin(this.phase) * amp;
    const k = 1 - Math.exp(-dt * 14);

    let legL = target, legR = -target, armL = -target * 0.8, armR = target * 0.8;
    let zl = 0, zr = 0, lean = 0, bodyY = 0, spin = 0, headX = 0;
    let bob = moving && !airborne ? Math.abs(Math.cos(this.phase)) * 0.06 : Math.sin(t * 2) * 0.01;

    if (airborne) { legL = -0.5; legR = 0.3; armL = -2.6; armR = -2.6; zl = zr = 0.2; }
    else if (swimming) { legL = target * 0.5; legR = -target * 0.5; armL = -1.4 + Math.sin(t * 4) * 0.6; armR = -1.4 - Math.sin(t * 4) * 0.6; zl = zr = 0.4; }
    else if (pose === 'carry' || (moving && (this.propKind === 'crate' || this.propKind === 'logs'))) {
      armL = armR = -1.25; zl = zr = -0.15;
    } else if (!moving && pose !== 'none') {
      const s = Math.sin;
      switch (pose) {
        case 'chop': {
          const ph = (t * 0.85) % 1;
          armL = armR = ph < 0.65 ? lerp(-0.5, -2.9, ph / 0.65) : lerp(-2.9, -0.5, (ph - 0.65) / 0.35);
          zl = zr = -0.18; lean = ph > 0.65 ? 0.25 : 0;
          break;
        }
        case 'hammer': armR = -1.5 + s(t * 7) * 0.9; armL = -0.7; lean = 0.15; headX = 0.25; break;
        case 'hoe': armL = armR = -0.9 + s(t * 3) * 0.45; zl = zr = -0.2; lean = 0.25 + s(t * 3) * 0.08; headX = 0.2; break;
        case 'sweep': armL = armR = -0.7; zl = zr = -0.25; spin = s(t * 2.6) * 0.35; lean = 0.15; break;
        case 'sit': legL = legR = -1.5; bodyY = -0.42; armL = armR = -0.35; bob = 0; break;
        case 'sitGround': legL = -1.45; legR = -1.3; bodyY = -0.82; armL = armR = -0.2; zl = zr = 0.25; bob = 0; break;
        case 'kneel': legL = -1.5; legR = 0.1; bodyY = -0.45; armL = armR = -0.9; lean = 0.25; headX = 0.35; break;
        case 'fish': armL = armR = -0.95 + s(t * 1.3) * 0.05; zl = zr = -0.28; break;
        case 'wave': armR = -2.9; zr = 0.3 + s(t * 9) * 0.35; break;
        case 'dance':
          armL = -2.6 + s(t * 6) * 0.5; armR = -2.6 - s(t * 6) * 0.5; zl = zr = 0.45;
          legL = s(t * 6) * 0.35; legR = -legL; bodyY = Math.abs(s(t * 6)) * 0.12; spin = s(t * 2.2) * 0.7;
          break;
        case 'lute': armL = -1.25; zl = 0.25; armR = -0.75 + s(t * 13) * 0.15; zr = -0.45; headX = 0.15; break;
        case 'reach': armL = armR = -2.8 + s(t * 2) * 0.15; zl = zr = 0.1; headX = -0.2; break;
        case 'knead': armL = -1.0 + s(t * 5) * 0.25; armR = -1.0 - s(t * 5) * 0.25; zl = zr = -0.2; lean = 0.2; headX = 0.3; break;
        case 'scatter': armL = -0.8; armR = -1.0 + s(t * 3) * 0.7; zr = 0.35 + s(t * 3) * 0.3; break;
        case 'look': armR = -2.5; zr = -0.65; headX = -0.15; this.head.rotation.y = s(t * 0.4) * 0.5; break;
        case 'scared': armL = -2.8 + s(t * 20) * 0.2; armR = -2.8 - s(t * 20) * 0.2; zl = zr = 0.4; bodyY = Math.abs(s(t * 14)) * 0.08; break;
        case 'pet': lean = 0.55; armR = -1.0 + s(t * 6) * 0.15; armL = -0.4; headX = 0.4; legL = legR = -0.25; bodyY = -0.1; break;
        case 'talk': armR = -0.5 + s(t * 2.3) * 0.35; armL = -0.2 + s(t * 1.7 + 1) * 0.25; zr = 0.12; break;
        case 'cheer': armL = armR = -2.9 + s(t * 8) * 0.3; zl = zr = 0.35; bodyY = Math.abs(s(t * 8)) * 0.15; break;
        case 'read': armL = armR = -1.3; zl = zr = -0.35; headX = 0.25; break;
      }
    }

    this.legL.rotation.x += (legL - this.legL.rotation.x) * k;
    this.legR.rotation.x += (legR - this.legR.rotation.x) * k;
    this.armL.rotation.x += (armL - this.armL.rotation.x) * k;
    this.armR.rotation.x += (armR - this.armR.rotation.x) * k;
    this.armL.rotation.z += (-zl - this.armL.rotation.z) * k;
    this.armR.rotation.z += (zr - this.armR.rotation.z) * k;
    this.model.rotation.x += (lean - this.model.rotation.x) * k;
    this.model.rotation.y += (spin - this.model.rotation.y) * k;
    this.headX += (headX - this.headX) * k;

    this.model.position.y += (bob + bodyY - this.model.position.y) * Math.min(1, k * 2);
    this.head.rotation.x = this.headX;
    if (pose !== 'look') this.head.rotation.y *= 1 - k;
    this.head.rotation.z = moving ? 0 : Math.sin(t * 0.7) * 0.04;
  }

  /** Small nod used while talking. */
  nod(amount: number) { this.head.rotation.x = this.headX + amount; }

  /** Place the blob shadow on the ground beneath the character (in root-local space). */
  setGroundOffset(dy: number) {
    this.blob.position.y = dy + 0.03;
    this.blob.visible = this.blobOn && dy > -3;
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const _c = new THREE.Vector3();
/**
 * Place an object whose origin is at its feet so that it spins around its middle
 * (height `cy` above the feet) instead of around its toes.
 */
export function placeTumbling(obj: THREE.Object3D, feet: THREE.Vector3, yaw: number, rx: number, rz: number, cy: number) {
  obj.rotation.set(rx, yaw, rz);
  _c.set(0, cy, 0).applyEuler(obj.rotation);
  obj.position.set(feet.x, feet.y + cy, feet.z).sub(_c);
}
