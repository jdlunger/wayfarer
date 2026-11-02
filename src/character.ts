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

const charMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const shadowMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false });

type Piece = [geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, sx?: number, sy?: number, sz?: number];

/** Bake several coloured parts into one geometry so each body part is a single draw call. */
function bake(pieces: Piece[]): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const geos = pieces.map(([g, color, x, y, z, sx = 1, sy = 1, sz = 1]) => {
    const geo = g.clone().applyMatrix4(m.makeScale(sx, sy, sz).setPosition(x, y, z));
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

function mesh(geo: THREE.BufferGeometry, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, charMat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** Blocky low-poly humanoid with procedural walk animation. Faces +Z. */
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

  constructor(style: CharStyle) {
    const s = style.scale ?? 1;
    this.model.scale.setScalar(s);
    this.root.add(this.model);

    const { skin, shirt, pants, hair } = style;
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

    const headParts: Piece[] = [
      [G.head, skin, 0, 0, 0],
      [G.hair, hair, 0, 0.24, 0],
      [G.hairBack, hair, 0, 0.08, -0.2],
      [G.eye, '#1d1a18', -0.09, 0.03, 0.205],
      [G.eye, '#1d1a18', 0.09, 0.03, 0.205],
    ];
    if (style.beard) headParts.push([G.beard, style.beard, 0, -0.14, 0.2]);
    if (style.hat) headParts.push([G.hatBrim, style.hat, 0, 0.26, 0], [G.hatTop, style.hat, 0, 0.42, 0]);
    this.head = mesh(bake(headParts), this.model, 0, 1.82, 0);

    // Cheap blob shadow — keeps characters grounded when real shadows are off.
    this.blob = new THREE.Mesh(G.shadow, shadowMat);
    this.blob.renderOrder = 1;
    this.root.add(this.blob);
  }

  private blobOn = true;
  setBlobVisible(v: boolean) { this.blobOn = v; }

  /**
   * @param speed signed ground speed (negative = walking backward)
   * @param airborne true while jumping/falling
   */
  animate(dt: number, speed: number, airborne: boolean, swimming = false) {
    this.t += dt;
    const moving = Math.abs(speed) > 0.2;
    this.phase += dt * speed * 1.9;
    const amp = moving ? Math.min(0.9, 0.35 + Math.abs(speed) * 0.07) : 0;
    const target = Math.sin(this.phase) * amp;
    const k = 1 - Math.exp(-dt * 14);

    let legL = target, legR = -target, armL = -target * 0.8, armR = target * 0.8, armZ = 0;
    if (airborne) { legL = -0.5; legR = 0.3; armL = -2.6; armR = -2.6; armZ = 0.2; }
    if (swimming) { legL = target * 0.5; legR = -target * 0.5; armL = -1.4 + Math.sin(this.t * 4) * 0.6; armR = -1.4 - Math.sin(this.t * 4) * 0.6; armZ = 0.4; }

    this.legL.rotation.x += (legL - this.legL.rotation.x) * k;
    this.legR.rotation.x += (legR - this.legR.rotation.x) * k;
    this.armL.rotation.x += (armL - this.armL.rotation.x) * k;
    this.armR.rotation.x += (armR - this.armR.rotation.x) * k;
    this.armL.rotation.z += (-armZ - this.armL.rotation.z) * k;
    this.armR.rotation.z += (armZ - this.armR.rotation.z) * k;

    // Bob while walking, breathe while idle
    const bob = moving && !airborne ? Math.abs(Math.cos(this.phase)) * 0.06 : Math.sin(this.t * 2) * 0.01;
    this.model.position.y = bob;
    this.head.rotation.z = moving ? 0 : Math.sin(this.t * 0.7) * 0.04;
  }

  /** Small nod used while talking. */
  nod(amount: number) { this.head.rotation.x = amount; }

  /** Place the blob shadow on the ground beneath the character (in root-local space). */
  setGroundOffset(dy: number) {
    this.blob.position.y = dy + 0.03;
    this.blob.visible = this.blobOn && dy > -3;
  }
}
