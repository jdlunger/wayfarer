import { input } from './input';

export interface DOption {
  text: string;
  next?: string;
  act?: () => void;
  show?: () => boolean;
}
export interface DNode {
  text: string | (() => string);
  options?: DOption[];
}
export interface DScript {
  entry: () => string;
  nodes: Record<string, DNode>;
}

const $ = (id: string) => document.getElementById(id)!;

/** Keyboard-driven dialogue box with a typewriter effect. */
export class Dialogue {
  private el = $('dialog');
  private nameEl = $('dialog-name');
  private textEl = $('dialog-text');
  private optsEl = $('dialog-options');
  private script: DScript | null = null;
  private full = '';
  private shown = 0;
  private opts: DOption[] = [];
  private sel = 0;
  private onClose: (() => void) | null = null;

  get active() { return this.script !== null; }

  open(name: string, script: DScript, onClose?: () => void) {
    this.script = script;
    this.onClose = onClose ?? null;
    this.nameEl.textContent = name;
    this.el.classList.remove('hidden');
    this.go(script.entry());
  }

  close() {
    this.script = null;
    this.el.classList.add('hidden');
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  private go(id: string | undefined) {
    const node = id ? this.script?.nodes[id] : undefined;
    if (!node) return this.close();
    this.full = typeof node.text === 'function' ? node.text() : node.text;
    this.shown = 0;
    this.textEl.textContent = '';
    this.opts = (node.options ?? [{ text: 'Farewell.' }]).filter(o => !o.show || o.show());
    this.sel = 0;
    this.optsEl.innerHTML = '';
    this.optsEl.style.visibility = 'hidden';
    this.opts.forEach((o, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="n">${i + 1}</span>`;
      li.append(o.text);
      this.optsEl.append(li);
    });
    this.highlight();
  }

  private highlight() {
    [...this.optsEl.children].forEach((li, i) => li.classList.toggle('sel', i === this.sel));
  }

  private choose(i: number) {
    const o = this.opts[i];
    if (!o) return;
    o.act?.();
    this.go(o.next);
  }

  update(dt: number) {
    if (!this.script) return;
    const typing = this.shown < this.full.length;
    if (typing) {
      this.shown = Math.min(this.full.length, this.shown + dt * 55);
      this.textEl.textContent = this.full.slice(0, Math.floor(this.shown));
      if (this.shown >= this.full.length) this.optsEl.style.visibility = 'visible';
    }

    if (input.hit('Escape')) return this.close();
    const confirm = input.hit('Enter') || input.hit('Space') || input.hit('KeyE') || input.hit('NumpadEnter');
    if (typing) {
      if (confirm) {
        this.shown = this.full.length;
        this.textEl.textContent = this.full;
        this.optsEl.style.visibility = 'visible';
      }
      return;
    }
    if (input.hit('ArrowDown') || input.hit('KeyS')) { this.sel = (this.sel + 1) % this.opts.length; this.highlight(); }
    if (input.hit('ArrowUp') || input.hit('KeyW')) { this.sel = (this.sel + this.opts.length - 1) % this.opts.length; this.highlight(); }
    for (let i = 0; i < this.opts.length && i < 9; i++) {
      if (input.hit(`Digit${i + 1}`) || input.hit(`Numpad${i + 1}`)) return this.choose(i);
    }
    if (confirm) this.choose(this.sel);
  }
}
