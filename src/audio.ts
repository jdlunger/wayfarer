import * as THREE from 'three';

/**
 * Sound effects, synthesised live with the Web Audio API (no audio files needed,
 * so there's nothing to license). Any sound can be swapped for a recorded clip by
 * listing it in SAMPLES — e.g. a CC0 file dropped into /public/sfx/.
 */

export type SoundName =
  | 'boom' | 'bigBoom' | 'thunder' | 'meteor' | 'cannon' | 'rocket' | 'pop' | 'boing' | 'thud' | 'scream' | 'sting' | 'zap' | 'splash'
  | 'croak' | 'bawk' | 'moo' | 'baa' | 'oink' | 'woof' | 'meow' | 'quack' | 'caw' | 'coo'
  | 'whistle' | 'horn' | 'bell' | 'chuff' | 'clack' | 'brakes';
export type LoopName = 'wind' | 'rumble' | 'hum' | 'disco' | 'hiss' | 'rain';

/** Optional recorded overrides: { boom: 'sfx/explosion.ogg' }. Paths are relative to the site root. */
export const SAMPLES: Partial<Record<SoundName | LoopName, string>> = {};

type Recipe = (c: AudioContext, out: AudioNode, t: number, noise: AudioBuffer) => number;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ---------- Building blocks ----------
function env(c: AudioContext, out: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}
function osc(c: AudioContext, type: OscillatorType, f0: number, t: number, dur: number, out: AudioNode, glide?: [number, number][]) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  for (const [f, at] of glide ?? []) o.frequency.exponentialRampToValueAtTime(f, t + at);
  o.connect(out);
  o.start(t); o.stop(t + dur + 0.05);
  return o;
}
function noiseSrc(c: AudioContext, buf: AudioBuffer, t: number, dur: number, out: AudioNode) {
  const s = c.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.playbackRate.value = rnd(0.9, 1.1);
  s.connect(out);
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  return s;
}
function filter(c: AudioContext, type: BiquadFilterType, f: number, q: number, out: AudioNode) {
  const b = c.createBiquadFilter();
  b.type = type; b.frequency.value = f; b.Q.value = q;
  b.connect(out);
  return b;
}
function vibrato(c: AudioContext, o: OscillatorNode, rate: number, depth: number, t: number, dur: number) {
  const l = c.createOscillator(), g = c.createGain();
  l.frequency.value = rate; g.gain.value = depth;
  l.connect(g); g.connect(o.frequency);
  l.start(t); l.stop(t + dur + 0.05);
}
/** Saw through a couple of formant filters: the basis for every animal voice. */
function voice(c: AudioContext, out: AudioNode, t: number, o: { type?: OscillatorType; f: number; glide: [number, number][]; dur: number; formants: number[]; q?: number; vib?: [number, number]; vol?: number; attack?: number }) {
  const g = env(c, out, t, o.vol ?? 0.5, o.attack ?? 0.02, o.dur);
  const mix = c.createGain();
  mix.gain.value = 1;
  for (const f of o.formants) mix.connect(filter(c, 'bandpass', f, o.q ?? 4, g));
  const s = osc(c, o.type ?? 'sawtooth', o.f, t, o.dur + 0.05, mix, o.glide);
  if (o.vib) vibrato(c, s, o.vib[0], o.vib[1], t, o.dur);
  return o.dur + 0.1;
}

function explosion(c: AudioContext, out: AudioNode, t: number, n: AudioBuffer, size: number) {
  const dur = 0.7 + size * 0.5;
  const g = env(c, out, t, 0.9, 0.005, dur);
  const lp = filter(c, 'lowpass', 2500, 0.7, g);
  lp.frequency.setValueAtTime(2500 + size * 800, t);
  lp.frequency.exponentialRampToValueAtTime(70, t + dur);
  noiseSrc(c, n, t, dur, lp);
  const thump = env(c, out, t, 0.9, 0.005, 0.5 + size * 0.3);
  osc(c, 'sine', 90, t, 0.9 + size * 0.3, thump, [[28, 0.6 + size * 0.3]]);
  return dur + 0.1;
}

const R: Record<SoundName, Recipe> = {
  boom: (c, o, t, n) => explosion(c, o, t, n, 0.6),
  bigBoom: (c, o, t, n) => explosion(c, o, t, n, 2),
  cannon: (c, o, t, n) => explosion(c, o, t, n, 0.2),
  thunder: (c, o, t, n) => {
    // Crack, then a long rolling rumble.
    const crack = env(c, o, t, 0.8, 0.002, 0.25);
    noiseSrc(c, n, t, 0.3, filter(c, 'highpass', 1800, 0.7, crack));
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    let at = t + 0.05;
    for (let i = 0; i < 9; i++) { g.gain.exponentialRampToValueAtTime(rnd(0.3, 0.9) * (1 - i / 10), at); at += rnd(0.2, 0.45); }
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.8);
    g.connect(o);
    const lp = filter(c, 'lowpass', 400, 0.8, g);
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.exponentialRampToValueAtTime(90, at + 0.8);
    noiseSrc(c, n, t, at - t + 1, lp);
    return at - t + 1;
  },
  meteor: (c, o, t) => {
    const g = env(c, o, t, 0.12, 0.3, 1.2);
    osc(c, 'sine', 2200, t, 1.5, g, [[260, 1.5]]);
    return 1.6;
  },
  rocket: (c, o, t, n) => {
    const g = env(c, o, t, 0.25, 0.02, 0.6);
    const bp = filter(c, 'bandpass', 800, 2, g);
    bp.frequency.exponentialRampToValueAtTime(5000, t + 0.6);
    noiseSrc(c, n, t, 0.7, bp);
    return 0.7;
  },
  pop: (c, o, t, n) => {
    const g = env(c, o, t, 0.7, 0.003, 0.35);
    noiseSrc(c, n, t, 0.4, filter(c, 'bandpass', 1400, 0.8, g));
    for (let i = 0; i < 18; i++) {
      const tt = t + 0.12 + Math.random() * 0.9;
      const cg = env(c, o, tt, rnd(0.05, 0.25), 0.001, 0.03);
      noiseSrc(c, n, tt, 0.04, filter(c, 'highpass', 3000, 1, cg));
    }
    return 1.2;
  },
  boing: (c, o, t) => {
    const g = env(c, o, t, 0.35, 0.005, 0.4);
    const s = osc(c, 'triangle', 180, t, 0.45, g, [[620, 0.12], [420, 0.4]]);
    vibrato(c, s, 22, 30, t, 0.45);
    return 0.5;
  },
  thud: (c, o, t, n) => {
    const g = env(c, o, t, 0.6, 0.003, 0.18);
    osc(c, 'sine', 120, t, 0.2, g, [[45, 0.18]]);
    noiseSrc(c, n, t, 0.08, filter(c, 'lowpass', 600, 1, env(c, o, t, 0.3, 0.002, 0.08)));
    return 0.25;
  },
  scream: (c, o, t) => voice(c, o, t, { f: rnd(700, 1000), glide: [[rnd(420, 560), 0.9]], dur: 0.9, formants: [850, 1250, 2600], q: 5, vib: [9, 40], vol: 0.35, attack: 0.04 }),
  sting: (c, o, t, n) => {
    // A dramatic orchestral "DUN-DUN!" (two diminished stabs).
    for (const [dt, base] of [[0, 1], [0.28, 0.94]] as [number, number][]) {
      const g = env(c, o, t + dt, 0.22, 0.01, dt ? 1.4 : 0.25);
      const lp = filter(c, 'lowpass', 1800, 0.8, g);
      for (const f of [110, 130.8, 155.6, 185, 220]) { osc(c, 'sawtooth', f * base, t + dt, 1.6, lp); osc(c, 'sawtooth', f * base * 1.006, t + dt, 1.6, lp); }
      noiseSrc(c, n, t + dt, 0.2, filter(c, 'lowpass', 300, 1, env(c, o, t + dt, 0.6, 0.003, 0.25)));
    }
    return 1.8;
  },
  zap: (c, o, t) => {
    const g = env(c, o, t, 0.25, 0.01, 0.5);
    osc(c, 'square', 1800, t, 0.5, filter(c, 'bandpass', 2000, 3, g), [[120, 0.5]]);
    return 0.55;
  },
  splash: (c, o, t, n) => {
    const g = env(c, o, t, 0.5, 0.01, 0.6);
    const bp = filter(c, 'bandpass', 1200, 0.6, g);
    bp.frequency.exponentialRampToValueAtTime(400, t + 0.6);
    noiseSrc(c, n, t, 0.65, bp);
    return 0.7;
  },

  croak: (c, o, t) => {
    const g = env(c, o, t, 0.4, 0.005, 0.28);
    const am = c.createGain();
    am.gain.setValueAtTime(0, t);
    for (let i = 0; i < 6; i++) { am.gain.setValueAtTime(1, t + i * 0.045); am.gain.setValueAtTime(0.1, t + i * 0.045 + 0.025); }
    am.connect(filter(c, 'bandpass', 700, 3, g));
    osc(c, 'square', rnd(100, 150), t, 0.3, am, [[80, 0.3]]);
    return 0.35;
  },
  bawk: (c, o, t) => voice(c, o, t, { f: 520, glide: [[950, 0.06], [620, 0.28]], dur: 0.32, formants: [1100, 2400], q: 3, vol: 0.4 }),
  moo: (c, o, t) => voice(c, o, t, { f: 105, glide: [[140, 0.35], [95, 1.1]], dur: 1.2, formants: [380, 800], q: 3, vib: [5, 3], vol: 0.6, attack: 0.15 }),
  baa: (c, o, t) => voice(c, o, t, { f: 290, glide: [[270, 0.7]], dur: 0.7, formants: [700, 1300], q: 4, vib: [8, 30], vol: 0.45, attack: 0.05 }),
  oink: (c, o, t) => { voice(c, o, t, { type: 'square', f: 200, glide: [[130, 0.14]], dur: 0.15, formants: [500], q: 6, vol: 0.5 }); return voice(c, o, t + 0.2, { type: 'square', f: 190, glide: [[120, 0.12]], dur: 0.13, formants: [500], q: 6, vol: 0.45 }) + 0.2; },
  woof: (c, o, t) => voice(c, o, t, { f: 360, glide: [[170, 0.14]], dur: 0.16, formants: [600, 1400], q: 2, vol: 0.6, attack: 0.008 }),
  meow: (c, o, t) => voice(c, o, t, { f: 480, glide: [[820, 0.2], [430, 0.6]], dur: 0.6, formants: [900, 1800], q: 5, vol: 0.35, attack: 0.05 }),
  quack: (c, o, t) => voice(c, o, t, { f: 420, glide: [[330, 0.15]], dur: 0.16, formants: [1400, 2600], q: 9, vol: 0.5 }),
  caw: (c, o, t) => voice(c, o, t, { f: 1300, glide: [[800, 0.35]], dur: 0.35, formants: [1800, 3000], q: 5, vib: [30, 60], vol: 0.25 }),
  coo: (c, o, t) => { voice(c, o, t, { type: 'sine', f: 360, glide: [[420, 0.1], [340, 0.3]], dur: 0.3, formants: [400], q: 1, vol: 0.4 }); return 0.4; },

  whistle: (c, o, t, n) => {
    const dur = 1.3;
    const g = env(c, o, t, 0.22, 0.06, dur);
    for (const f of [466, 587, 698]) { const s = osc(c, 'sine', f * 0.97, t, dur + 0.1, g, [[f, 0.1]]); vibrato(c, s, 6, 4, t, dur); }
    noiseSrc(c, n, t, dur, filter(c, 'bandpass', 2400, 4, env(c, o, t, 0.12, 0.05, dur)));
    return dur + 0.2;
  },
  horn: (c, o, t) => {
    const dur = 1.0;
    for (const at of [0, 0.55]) {
      const g = env(c, o, t + at, 0.2, 0.03, at ? dur : 0.35);
      const lp = filter(c, 'lowpass', 1400, 1, g);
      for (const f of [311, 370, 466]) osc(c, 'sawtooth', f, t + at, dur, lp);
    }
    return 1.7;
  },
  bell: (c, o, t) => {
    for (const at of [0, 0.45, 0.9]) {
      for (const [m, v] of [[1, 0.3], [2.76, 0.12], [5.4, 0.05]] as [number, number][]) osc(c, 'sine', 1046 * m, t + at, 1.2, env(c, o, t + at, v, 0.003, 1.1));
    }
    return 2.2;
  },
  chuff: (c, o, t, n) => {
    const g = env(c, o, t, 0.35, 0.01, 0.16);
    noiseSrc(c, n, t, 0.2, filter(c, 'bandpass', rnd(500, 750), 1.2, g));
    return 0.22;
  },
  clack: (c, o, t, n) => {
    for (const at of [0, 0.09]) noiseSrc(c, n, t + at, 0.03, filter(c, 'bandpass', 2600, 2, env(c, o, t + at, 0.3, 0.001, 0.025)));
    return 0.15;
  },
  brakes: (c, o, t, n) => {
    const g = env(c, o, t, 0.12, 0.2, 1.4);
    osc(c, 'sawtooth', 2900, t, 1.6, filter(c, 'bandpass', 3000, 12, g), [[2600, 1.5]]);
    noiseSrc(c, n, t, 1.5, filter(c, 'bandpass', 4000, 3, env(c, o, t, 0.08, 0.2, 1.3)));
    return 1.7;
  },
};

// ---------- Loops ----------
type LoopBuild = (c: AudioContext, out: AudioNode, noise: AudioBuffer, disco: AudioBuffer | null) => AudioScheduledSourceNode[];
const LOOPS: Record<LoopName, LoopBuild> = {
  wind: (c, out, n) => {
    const bp = filter(c, 'bandpass', 500, 1.5, out);
    const l = c.createOscillator(), lg = c.createGain();
    l.frequency.value = 0.35; lg.gain.value = 300;
    l.connect(lg); lg.connect(bp.frequency);
    const s = c.createBufferSource(); s.buffer = n; s.loop = true; s.connect(bp);
    const lp = filter(c, 'lowpass', 140, 1, out);
    const s2 = c.createBufferSource(); s2.buffer = n; s2.loop = true; s2.playbackRate.value = 0.7; s2.connect(lp);
    return [s, s2, l];
  },
  rumble: (c, out, n) => {
    const lp = filter(c, 'lowpass', 110, 1, out);
    const s = c.createBufferSource(); s.buffer = n; s.loop = true; s.connect(lp);
    const g = c.createGain(); g.gain.value = 0.5; g.connect(out);
    const o = c.createOscillator(); o.frequency.value = 38; o.connect(g);
    return [s, o];
  },
  hum: (c, out) => {
    const g = c.createGain(); g.gain.value = 0.25; g.connect(out);
    const o1 = c.createOscillator(); o1.frequency.value = 220; o1.connect(g);
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 331; o2.connect(g);
    const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 5; lg.gain.value = 25;
    l.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency);
    const l2 = c.createOscillator(), lg2 = c.createGain(); l2.frequency.value = 0.4; lg2.gain.value = 120;
    l2.connect(lg2); lg2.connect(o1.frequency);
    return [o1, o2, l, l2];
  },
  hiss: (c, out, n) => {
    const s = c.createBufferSource(); s.buffer = n; s.loop = true; s.connect(filter(c, 'highpass', 1500, 0.7, out));
    return [s];
  },
  rain: (c, out, n) => {
    const s = c.createBufferSource(); s.buffer = n; s.loop = true; s.connect(filter(c, 'bandpass', 3500, 0.5, out));
    return [s];
  },
  disco: (c, out, _n, d) => {
    if (!d) return [];
    const s = c.createBufferSource(); s.buffer = d; s.loop = true; s.connect(out);
    return [s];
  },
};

/** Render a short four-on-the-floor loop once, offline. */
async function renderDisco(sr: number): Promise<AudioBuffer> {
  const bpm = 124, beat = 60 / bpm, bars = 2, len = beat * 4 * bars;
  const c = new OfflineAudioContext(1, Math.ceil(len * sr), sr);
  const nb = c.createBuffer(1, sr, sr);
  const d = nb.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const bass = [55, 55, 82.4, 55, 73.4, 55, 98, 82.4];
  const chord = [[220, 277, 330], [196, 247, 294]];
  for (let b = 0; b < 4 * bars; b++) {
    const t = b * beat;
    const kick = c.createGain(); kick.connect(c.destination);
    kick.gain.setValueAtTime(0.9, t); kick.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    const ko = c.createOscillator(); ko.frequency.setValueAtTime(140, t); ko.frequency.exponentialRampToValueAtTime(40, t + 0.25); ko.connect(kick); ko.start(t); ko.stop(t + 0.32);
    // off-beat open hat
    const ht = t + beat / 2;
    const hg = c.createGain(); hg.gain.setValueAtTime(0.18, ht); hg.gain.exponentialRampToValueAtTime(0.001, ht + 0.12);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000; hp.connect(hg); hg.connect(c.destination);
    const hs = c.createBufferSource(); hs.buffer = nb; hs.connect(hp); hs.start(ht); hs.stop(ht + 0.15);
    // octave bass
    for (const [k, off] of [[0, 0], [1, beat / 2]] as [number, number][]) {
      const f = bass[(b * 2 + k) % bass.length] * (k ? 2 : 1);
      const bg = c.createGain(); bg.gain.setValueAtTime(0.25, t + off); bg.gain.exponentialRampToValueAtTime(0.001, t + off + beat * 0.45);
      const bl = c.createBiquadFilter(); bl.type = 'lowpass'; bl.frequency.value = 700; bl.connect(bg); bg.connect(c.destination);
      const bo = c.createOscillator(); bo.type = 'sawtooth'; bo.frequency.value = f; bo.connect(bl); bo.start(t + off); bo.stop(t + off + beat * 0.5);
    }
    // stabby chords on the "and" of 2 and 4
    if (b % 2 === 1) {
      const ct = t + beat / 2;
      const cg = c.createGain(); cg.gain.setValueAtTime(0.08, ct); cg.gain.exponentialRampToValueAtTime(0.001, ct + 0.25); cg.connect(c.destination);
      for (const f of chord[Math.floor(b / 4) % 2]) { const co = c.createOscillator(); co.type = 'square'; co.frequency.value = f; co.connect(cg); co.start(ct); co.stop(ct + 0.3); }
    }
  }
  return c.startRendering();
}

export interface LoopHandle { setPos(p: THREE.Vector3 | null): void; setVolume(v: number): void; stop(): void }

interface Live { gain: GainNode; pan: StereoPannerNode; pos: THREE.Vector3 | null; vol: number; range: number; srcs: AudioScheduledSourceNode[]; dead: boolean }

class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private disco: AudioBuffer | null = null;
  private samples = new Map<string, AudioBuffer>();
  private listener = new THREE.Vector3();
  private right = new THREE.Vector3(1, 0, 0);
  private loops: Live[] = [];
  private last = new Map<string, number>();
  private voices = 0;
  muted = false;

  constructor() {
    const start = () => this.init();
    window.addEventListener('keydown', start);
    window.addEventListener('pointerdown', start);
  }

  private init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const c = (this.ctx = new AudioContext());
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    comp.connect(c.destination);
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp);
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    void renderDisco(c.sampleRate).then(b => (this.disco = b));
    for (const [k, url] of Object.entries(SAMPLES)) {
      if (url) fetch(url).then(r => r.arrayBuffer()).then(a => c.decodeAudioData(a)).then(b => this.samples.set(k, b)).catch(() => {});
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /** Call once per frame with the camera. */
  setListener(cam: THREE.Camera) {
    this.listener.copy(cam.position);
    this.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    if (!this.ctx) return;
    for (const l of [...this.loops]) {
      if (l.dead) { this.loops.splice(this.loops.indexOf(l), 1); continue; }
      const [g, p] = this.spatial(l.pos, l.range);
      l.gain.gain.setTargetAtTime(g * l.vol, this.ctx.currentTime, 0.1);
      l.pan.pan.setTargetAtTime(p, this.ctx.currentTime, 0.1);
    }
  }

  private spatial(pos: THREE.Vector3 | null, range: number): [number, number] {
    if (!pos) return [1, 0];
    const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, dz = pos.z - this.listener.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > range) return [0, 0];
    const g = Math.min(1, 1 / (1 + Math.max(0, d - 5) / (range * 0.12))) * (1 - d / range);
    const pan = d > 0.5 ? Math.max(-0.85, Math.min(0.85, (dx * this.right.x + dy * this.right.y + dz * this.right.z) / d)) : 0;
    return [g, pan];
  }

  /**
   * Fire-and-forget sound. `pos` null = not spatial. `range` = audible distance.
   * `gap` throttles repeats of the same sound (seconds).
   */
  play(name: SoundName, pos: THREE.Vector3 | null = null, o: { vol?: number; range?: number; gap?: number; rate?: number; delay?: number } = {}) {
    const c = this.ctx;
    if (!c || this.muted || c.state !== 'running') return;
    const now = c.currentTime;
    if (o.gap && now - (this.last.get(name) ?? -9) < o.gap) return;
    if (this.voices > 40) return;
    const [g, pan] = this.spatial(pos, o.range ?? 120);
    if (g * (o.vol ?? 1) < 0.01) return;
    this.last.set(name, now);
    const gain = c.createGain();
    gain.gain.value = g * (o.vol ?? 1);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    gain.connect(p); p.connect(this.master);
    const t = now + 0.01 + (o.delay ?? 0);
    let dur: number;
    const sample = this.samples.get(name);
    if (sample) {
      const s = c.createBufferSource();
      s.buffer = sample;
      s.playbackRate.value = o.rate ?? rnd(0.95, 1.05);
      s.connect(gain); s.start(t);
      dur = sample.duration / s.playbackRate.value;
    } else dur = R[name](c, gain, t, this.noise);
    this.voices++;
    setTimeout(() => { this.voices--; p.disconnect(); }, (dur + (o.delay ?? 0)) * 1000 + 200);
  }

  /** Continuous sound until stop() (tornado wind, UFO hum, disco...). */
  loop(name: LoopName, pos: THREE.Vector3 | null, o: { vol?: number; range?: number } = {}): LoopHandle {
    const c = this.ctx;
    const live: Live | null = c ? (() => {
      const gain = c.createGain();
      gain.gain.value = 0;
      const pan = c.createStereoPanner();
      gain.connect(pan); pan.connect(this.master);
      const sample = this.samples.get(name);
      let srcs: AudioScheduledSourceNode[];
      if (sample) { const s = c.createBufferSource(); s.buffer = sample; s.loop = true; s.connect(gain); srcs = [s]; }
      else srcs = LOOPS[name](c, gain, this.noise, this.disco);
      srcs.forEach(s => s.start());
      const l: Live = { gain, pan, pos: pos?.clone() ?? null, vol: o.vol ?? 1, range: o.range ?? 150, srcs, dead: false };
      this.loops.push(l);
      return l;
    })() : null;
    return {
      setPos: p => { if (live) live.pos = p ? (live.pos ?? new THREE.Vector3()).copy(p) : null; },
      setVolume: v => { if (live) live.vol = v; },
      stop: () => {
        if (!live || live.dead || !c) return;
        live.dead = true;
        live.gain.gain.setTargetAtTime(0, c.currentTime, 0.3);
        setTimeout(() => { live.srcs.forEach(s => { try { s.stop(); } catch { /* already stopped */ } }); live.pan.disconnect(); }, 1500);
      },
    };
  }
}

export const sfx = new Sfx();
