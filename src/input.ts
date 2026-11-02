const held = new Set<string>();
const pressed = new Set<string>();
const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);

window.addEventListener('keydown', e => {
  if (BLOCK.has(e.code)) e.preventDefault();
  if (!e.repeat) pressed.add(e.code);
  held.add(e.code);
});
window.addEventListener('keyup', e => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

export const input = {
  down: (code: string) => held.has(code),
  /** True only on the frame the key went down. */
  hit: (code: string) => pressed.has(code),
  anyHit: () => pressed.size > 0,
  endFrame: () => pressed.clear(),
};

// Inside an embedded frame the page only receives keys once it has focus, so a click also counts as "press any key".
window.addEventListener('pointerdown', () => { window.focus(); pressed.add('Click'); });
