import * as THREE from 'three';
import { Character } from './character';
import { input } from './input';
import { groundHeight, WATER_Y, WORLD_LIMIT } from './terrain';
import { resolve } from './colliders';

const SWIM_DEPTH = 1.25;   // water deeper than this → swimming
const GRAVITY = 24;
const MAX_SLOPE = 1.25;    // rise/run that can still be walked up

export class Player {
  readonly char = new Character({ skin: '#e9c09a', shirt: '#c8553d', pants: '#2f3e57', hair: '#3a2617', hat: '#4b3a2a' });
  readonly pos = new THREE.Vector3(Math.cos(3.6) * 31, 0, Math.sin(3.6) * 31);
  heading = Math.atan2(-Math.cos(3.6), -Math.sin(3.6)) + 0.25;  // direction the camera/controls face
  private yaw = this.heading; // direction the model faces
  private vy = 0;
  grounded = true;
  swimming = false;
  speedBoost = 1;

  constructor(scene: THREE.Scene) {
    this.pos.y = groundHeight(this.pos.x, this.pos.z);
    scene.add(this.char.root);
  }

  /** Turn to face a point (used when a conversation starts). */
  faceToward(p: THREE.Vector3) {
    this.heading = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    this.yaw = this.heading;
  }

  get forward() { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  update(dt: number, enabled: boolean) {
    let mx = 0, mz = 0, turn = 0;
    if (enabled) {
      if (input.down('KeyW')) mz += 1;
      if (input.down('KeyS')) mz -= 1;
      if (input.down('KeyA')) mx -= 1;
      if (input.down('KeyD')) mx += 1;
      if (input.down('ArrowLeft')) turn += 1;
      if (input.down('ArrowRight')) turn -= 1;
    }
    this.heading += turn * dt * 2.4;

    const running = input.down('ShiftLeft') || input.down('ShiftRight');
    let speed = (running ? 9 * this.speedBoost : 4.5);
    if (mz < 0 && mx === 0) speed *= 0.6;
    if (this.swimming) speed *= 0.5;

    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    // forward = (sh, ch); right = (-ch, sh)
    let dx = sh * mz - ch * mx;
    let dz = ch * mz + sh * mx;
    const len = Math.hypot(dx, dz);
    let groundSpeed = 0;

    if (len > 0) {
      dx /= len; dz /= len;
      const step = speed * dt;
      const nx = this.pos.x + dx * step, nz = this.pos.z + dz * step;
      const hNow = groundHeight(this.pos.x, this.pos.z);
      const hNext = groundHeight(nx, nz);
      // Block steep climbs (but allow going downhill and moving while airborne over ledges)
      const tooSteep = this.grounded && !this.swimming && hNext - hNow > step * MAX_SLOPE && hNext > WATER_Y;
      if (!tooSteep) { this.pos.x = nx; this.pos.z = nz; groundSpeed = speed * (mz < 0 ? -1 : 1); }

      // Face movement direction, but backpedal (keep facing forward) when moving backward.
      const target = mz < 0 ? Math.atan2(-dx, -dz) : Math.atan2(dx, dz);
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 12);
    } else {
      let d = this.heading - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (turn !== 0) this.yaw += d * Math.min(1, dt * 10);
    }

    resolve(this.pos, 0.4);

    // Stay on the island
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > WORLD_LIMIT) { this.pos.x *= WORLD_LIMIT / r; this.pos.z *= WORLD_LIMIT / r; }

    // Vertical movement
    const ground = groundHeight(this.pos.x, this.pos.z);
    this.swimming = ground < WATER_Y - SWIM_DEPTH;
    const floor = this.swimming ? WATER_Y - 1.35 : ground;

    if (this.swimming) {
      this.vy = 0;
      this.pos.y += (floor - this.pos.y) * Math.min(1, dt * 5);
      this.grounded = true;
    } else {
      if (this.grounded && enabled && input.hit('Space')) { this.vy = 8; this.grounded = false; }
      this.vy -= GRAVITY * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= floor) {
        this.pos.y = floor; this.vy = 0; this.grounded = true;
      } else if (this.grounded && this.pos.y - floor < 0.6 && this.vy <= 0) {
        // Snap down small steps when walking downhill
        this.pos.y = floor; this.vy = 0;
      } else {
        this.grounded = false;
      }
    }

    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.yaw;
    this.char.animate(dt, groundSpeed * 0.75, !this.grounded, this.swimming);
    this.char.setGroundOffset(this.swimming ? -10 : ground - this.pos.y);
  }
}
