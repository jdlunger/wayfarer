import * as THREE from 'three';
import type { Pose, PropKind } from './character';
import type { DScript } from './dialogue';

/** Anything the player can press E on. `pos` may be a live reference (e.g. an NPC's position). */
export interface Interactable {
  pos: THREE.Vector3;
  /** Max reach. */
  r: number;
  /** Prompt text, or null when not currently usable. */
  label: () => string | null;
  act: () => void;
}

export const interactables: Interactable[] = [];
export function addInteractable(i: Interactable): Interactable {
  interactables.push(i);
  return i;
}

/** Hooks into the game loop, filled in by main.ts. */
export const svc = {
  dialog: (_name: string, _script: DScript, _onClose?: () => void) => {},
  /** Lock the player into an animation for `dur` seconds, then call `done`. */
  playerAction: (_pose: Pose, _dur: number, _prop: PropKind | null, _done?: () => void) => {},
  sit: (_pos: THREE.Vector3, _yaw: number, _pose?: Pose) => {},
  ringBell: (_at: THREE.Vector3) => {},
  spawnFrog: (_at: THREE.Vector3) => {},
  setTime: (_t: number) => {},
  /** Burst of floating text above a point (hearts, splashes, ...). */
  pop: (_at: THREE.Vector3, _text: string) => {},
};

/** One-node message box using the dialogue UI (signs, notice boards...). */
export function readText(name: string, pages: string[]) {
  const nodes: DScript['nodes'] = {};
  pages.forEach((text, i) => {
    nodes['p' + i] = { text, options: [{ text: i < pages.length - 1 ? 'Read on' : 'Done', next: i < pages.length - 1 ? 'p' + (i + 1) : undefined }] };
  });
  svc.dialog(name, { entry: () => 'p0', nodes });
}
