import * as THREE from 'three';
import { Character, CharStyle, Pose, PropKind } from './character';
import { DScript, DOption } from './dialogue';
import { floorHeight, isWet, WORLD_LIMIT } from './terrain';
import { resolve } from './colliders';
import { state, SHARDS_NEEDED, take, addCoins, ITEMS, Item, isNight, isFestival } from './state';
import type { Animal, Villager } from './animals';
import type { Village } from './village';

export { state, SHARDS_NEEDED };

export interface Step {
  at: THREE.Vector3;
  /** Point to look at (or a yaw) while doing the step. */
  face?: THREE.Vector3 | number;
  pose?: Pose;
  prop?: PropKind | null;
  dur?: [number, number];
  /** Pick a random spot within this radius of `at`. */
  wander?: number;
  barks?: string[];
  run?: boolean;
  /** Snap exactly onto `at` (benches, seats) instead of stopping nearby. */
  snap?: boolean;
}
export interface Task { steps: Step[]; w?: number; night?: boolean }

export interface NPCDef {
  id: string;
  name: string;
  style: CharStyle;
  home: THREE.Vector3;
  tasks: Task[];
  door?: THREE.Vector3;
  /** Stays out after dark (uses `night` tasks). */
  nightOwl?: boolean;
  social?: boolean;
  dancer?: boolean;
  bard?: boolean;
  barks: string[];
  thanks?: string;
  script: DScript;
}

type Mode = 'task' | 'talk' | 'flee' | 'chat' | 'react' | 'home' | 'tag' | 'dance';

interface Chat { partner: NPC; spot: THREE.Vector3; face: THREE.Vector3; lines: string[]; idx: number; lead: boolean; t: number; wait: number }
interface React { pose: Pose; t: number; face: THREE.Vector3; away?: THREE.Vector3 }
interface Tag { partner: NPC; it: boolean; until: number; center: THREE.Vector3; pause: number }

const rr = (a: [number, number] | undefined, d: number) => (a ? a[0] + Math.random() * (a[1] - a[0]) : d);
const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

export class NPC implements Villager {
  readonly char: Character;
  readonly pos: THREE.Vector3;
  yaw = Math.random() * Math.PI * 2;
  mode: Mode = 'task';
  private task: Task | null = null;
  private lastTask: Task | null = null;
  private stepIdx = 0;
  private phase: 'go' | 'do' = 'go';
  private timer = Math.random() * 3;
  private target = new THREE.Vector3();
  private speed = 0;
  private pose: Pose = 'none';
  private barkTimer = 0;
  private barkCooldown = Math.random() * 10;
  private deflectT = 0;
  private deflectSign = 1;
  private greeted = 0;
  chat: Chat | null = null;
  private react: React | null = null;
  tag: Tag | null = null;
  private danceSpot = new THREE.Vector3();
  chatCd = 10 + Math.random() * 30;
  tagCd = 5;
  /** Pip finished running away and should be moved to a hiding spot. */
  fled = false;
  /** Indoors for the night. */
  atHome = false;
  /** Flying through the air after an explosion/tornado/etc. */
  air: { v: THREE.Vector3; spin: number } | null = null;
  /** Position is driven externally (e.g. by a tractor beam). */
  puppet = false;
  readonly label: HTMLDivElement;
  private bubble: HTMLDivElement;

  constructor(readonly def: NPCDef, scene: THREE.Scene, labels: HTMLElement) {
    this.char = new Character(def.style);
    this.pos = def.home.clone();
    this.pos.y = floorHeight(this.pos.x, this.pos.z);
    scene.add(this.char.root);

    this.label = document.createElement('div');
    this.label.className = 'label';
    this.bubble = document.createElement('div');
    this.bubble.className = 'bubble';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = def.name;
    this.label.append(this.bubble, name);
    labels.append(this.label);
  }

  get first() { return this.def.name.split(' ').pop() === 'Hermit' ? 'Sela' : this.def.name.replace(/^(Elder|Guard|Old) /, '').split(' ')[0]; }

  get available() {
    return this.mode === 'task' && !this.atHome && this.phase === 'do' && this.pose !== 'sit' && this.pose !== 'sitGround' && this.pose !== 'fish';
  }

  bark(text?: string, dur = 3.5) {
    const lines = this.def.barks;
    this.bubble.textContent = text ?? lines[(Math.random() * lines.length) | 0];
    this.label.classList.add('barking');
    this.barkTimer = dur;
    this.barkCooldown = 20 + Math.random() * 20;
  }
  get speaking() { return this.barkTimer > 0; }

  /** Run away from `from` for a few seconds (used by Pip's hide-and-seek). */
  flee(from: THREE.Vector3) {
    this.endSocial();
    this.mode = 'flee';
    this.timer = 2.5;
    this.target.copy(this.pos).sub(from).setY(0).normalize().multiplyScalar(40).add(this.pos);
  }

  /** Get thrown through the air. */
  launch(v: THREE.Vector3) {
    if (this.atHome || this.mode === 'talk' || this.puppet) return;
    this.endSocial();
    this.react = null;
    if (this.mode === 'react') this.mode = 'task';
    if (this.air) { this.air.v.add(v); return; }
    this.air = { v: v.clone(), spin: (Math.random() - 0.5) * 16 };
    this.pos.y += 0.05;
  }

  private updateAir(dt: number) {
    const a = this.air!;
    a.v.y -= 24 * state.gravity * dt;
    const nx = this.pos.x + a.v.x * dt, nz = this.pos.z + a.v.z * dt;
    if (isWet(nx, nz) || Math.hypot(nx, nz) > WORLD_LIMIT) { a.v.x *= -0.6; a.v.z *= -0.6; }
    else { this.pos.x = nx; this.pos.z = nz; }
    this.pos.y += a.v.y * dt;
    const floor = floorHeight(this.pos.x, this.pos.z);
    const root = this.char.root;
    if (this.pos.y <= floor && a.v.y <= 0) {
      this.pos.y = floor;
      this.air = null;
      root.rotation.x = root.rotation.z = 0;
      this.mode = 'task'; this.phase = 'go'; this.task = null;
      this.startReact('scared', 1.6, this.pos.clone().add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5)), LANDINGS[(Math.random() * LANDINGS.length) | 0]);
    } else {
      root.rotation.x += a.spin * dt;
      root.rotation.z += a.spin * 0.4 * dt;
    }
    root.position.copy(this.pos);
    this.char.animate(dt, 0, true);
    this.char.setGroundOffset(floor - this.pos.y);
  }

  teleport(p: THREE.Vector3) {
    this.pos.set(p.x, floorHeight(p.x, p.z), p.z);
    this.mode = 'task';
    this.task = null;
    this.timer = 2;
  }

  /** Interrupt whatever we're doing to briefly react to something. */
  startReact(pose: Pose, dur: number, face: THREE.Vector3, line?: string, away?: THREE.Vector3) {
    if (this.mode === 'talk' || this.mode === 'flee' || this.atHome) return;
    this.endSocial();
    this.react = { pose, t: dur, face: face.clone(), away: away?.clone() };
    this.mode = 'react';
    if (line) this.bark(line, Math.min(3.5, dur + 0.5));
  }

  petDog(a: Animal) {
    const lines = [`Who's a good dog? ${a.name}'s a good dog!`, `Hello, ${a.name}!`, `${a.name}! Did you steal another sausage?`, 'Aww, come here you.', 'Yes, yes, I love you too.'];
    this.startReact('pet', 2.8, a.pos, lines[(Math.random() * lines.length) | 0]);
  }

  startChat(c: Chat) {
    this.chat = c;
    this.mode = 'chat';
  }
  endSocial() {
    if (this.chat) {
      const p = this.chat.partner;
      this.chat = null;
      if (p.chat) { p.chat = null; p.mode = 'task'; p.phase = 'go'; p.chatCd = 40 + Math.random() * 30; }
      this.chatCd = 40 + Math.random() * 30;
    }
    if (this.tag) {
      const p = this.tag.partner;
      this.tag = null;
      if (p.tag) { p.tag = null; p.mode = 'task'; p.tagCd = 40; }
      this.tagCd = 40;
    }
    if (this.mode === 'chat' || this.mode === 'tag') { this.mode = 'task'; this.phase = 'go'; }
  }

  canSocialize() {
    return this.def.social && this.mode === 'task' && !this.atHome && this.chatCd <= 0 && !(this.def.id === 'pip' && state.pip === 'hiding') && this.pose !== 'fish';
  }

  private wantsHome() {
    if (!this.def.door || this.def.nightOwl || (this.def.id === 'pip' && state.pip === 'hiding')) return false;
    return isNight() && !isFestival();
  }

  /** Dialogue script with a few universal options mixed in. */
  talkScript(): DScript {
    const base = this.def.script;
    const id = base.entry();
    const node = base.nodes[id];
    const opts = node.options ?? [{ text: 'Farewell.' }];
    const extra: DOption[] = [
      { text: 'Here, have some flowers. 🌼', show: () => state.inv.flowers > 0, next: '__flowers', act: () => { take('flowers'); } },
    ];
    const merged = { ...node, options: opts.length > 1 ? [...opts.slice(0, -1), ...extra, ...opts.slice(-1)] : [...opts, ...extra] };
    return {
      entry: () => '__entry',
      nodes: {
        ...base.nodes,
        __entry: merged,
        __flowers: { text: this.def.thanks ?? 'For me? Oh, how lovely. Thank you!', options: [{ text: "You're welcome." }] },
      },
    };
  }

  update(dt: number, player: THREE.Vector3, talkingToMe: boolean) {
    const toPlayer = flat(player, this.pos);
    let desired = this.yaw;
    this.speed = 0;
    this.pose = 'none';
    let snapping = false;

    if (this.barkTimer > 0 && (this.barkTimer -= dt) <= 0) this.label.classList.remove('barking');
    this.barkCooldown -= dt;
    this.chatCd -= dt;
    this.tagCd -= dt;
    this.deflectT -= dt;

    // Night: go indoors / come back out in the morning.
    if (this.atHome) {
      if (this.wantsHome()) { this.char.root.visible = false; this.label.style.display = 'none'; return; }
      this.atHome = false;
      this.char.root.visible = true;
      this.mode = 'task';
      this.task = null;
    }

    if (this.puppet) {
      this.char.root.position.copy(this.pos);
      this.char.root.rotation.x += dt * 3;
      this.char.animate(dt, 0, true);
      return;
    }
    if (this.air) { this.updateAir(dt); return; }

    if (talkingToMe) {
      if (this.mode !== 'talk') this.endSocial();
      this.mode = 'talk';
    } else if (this.mode === 'talk') {
      this.mode = 'task';
      this.phase = 'go';
      this.timer = 1;
    }

    if (this.mode === 'task' || this.mode === 'dance') {
      if (this.wantsHome()) { this.mode = 'home'; this.endSocial(); }
      else if (state.party && (this.def.dancer || this.def.bard) && flat(this.pos, new THREE.Vector3(state.party.x, 0, state.party.z)) < 40) {
        if (this.mode !== 'dance') {
          this.mode = 'dance';
          const a = Math.random() * Math.PI * 2, r = this.def.bard ? 0 : 2.5 + Math.random() * 2.5;
          this.danceSpot.set(state.party.x + Math.cos(a) * r, 0, state.party.z + Math.sin(a) * r);
        }
      } else if (this.mode === 'dance') { this.mode = 'task'; this.phase = 'go'; }
    }

    switch (this.mode) {
      case 'talk':
        desired = Math.atan2(player.x - this.pos.x, player.z - this.pos.z);
        this.pose = 'talk';
        break;

      case 'flee':
        this.timer -= dt;
        this.speed = 7.5;
        desired = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);
        if (this.timer <= 0) { this.mode = 'task'; this.task = null; this.fled = true; }
        break;

      case 'react': {
        const r = this.react!;
        r.t -= dt;
        this.pose = r.pose;
        if (r.away) {
          desired = Math.atan2(this.pos.x - r.away.x, this.pos.z - r.away.z);
          this.speed = 5;
          this.pose = 'none';
        } else desired = Math.atan2(r.face.x - this.pos.x, r.face.z - this.pos.z);
        if (r.t <= 0) { this.react = null; this.mode = 'task'; this.phase = 'go'; }
        break;
      }

      case 'home': {
        const d = this.def.door!;
        if (!this.wantsHome()) { this.mode = 'task'; this.phase = 'go'; break; }
        if (this.walkTo(d, dt, 1.9)) desired = this.yaw;
        else desired = Math.atan2(d.x - this.pos.x, d.z - this.pos.z);
        if (flat(this.pos, d) < 0.6 || (this.timer -= dt) < -40) { this.atHome = true; this.timer = 0; this.char.root.visible = false; }
        break;
      }

      case 'dance': {
        const p = state.party!;
        if (flat(this.pos, this.danceSpot) > 0.5) {
          desired = Math.atan2(this.danceSpot.x - this.pos.x, this.danceSpot.z - this.pos.z);
          this.speed = 2.6;
        } else {
          this.pose = this.def.bard ? 'lute' : 'dance';
          if (this.def.bard) this.char.setProp('lute');
          desired = this.def.bard ? Math.atan2(player.x - this.pos.x, player.z - this.pos.z) : Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
        }
        break;
      }

      case 'chat': {
        const c = this.chat!;
        const arrived = flat(this.pos, c.spot) < 0.5;
        if (!arrived) { desired = Math.atan2(c.spot.x - this.pos.x, c.spot.z - this.pos.z); this.speed = 1.9; }
        else { desired = Math.atan2(c.partner.pos.x - this.pos.x, c.partner.pos.z - this.pos.z); this.pose = this.speaking ? 'talk' : 'none'; }
        if (c.lead) {
          c.wait -= dt;
          const both = arrived && flat(c.partner.pos, c.partner.chat?.spot ?? c.spot) < 0.6;
          if (both || c.wait < 0) {
            c.t -= dt;
            if (c.t <= 0) {
              if (c.idx >= c.lines.length) { this.endSocial(); break; }
              const speaker = c.idx % 2 === 0 ? this : c.partner;
              speaker.bark(c.lines[c.idx], 3.2);
              c.idx++;
              c.t = 3.3;
            }
          }
        }
        break;
      }

      case 'tag': {
        const g = this.tag!;
        const o = g.partner;
        if (state.clock > g.until) { this.endSocial(); break; }
        if (g.it) {
          if (g.pause > 0) { g.pause -= dt; this.pose = 'cheer'; desired = Math.atan2(o.pos.x - this.pos.x, o.pos.z - this.pos.z); break; }
          desired = Math.atan2(o.pos.x - this.pos.x, o.pos.z - this.pos.z);
          this.speed = 4.4;
          if (flat(this.pos, o.pos) < 0.9 && o.tag) {
            g.it = false;
            o.tag.it = true;
            o.tag.pause = 1.8;
            this.bark(["Tag! You're it!", 'Gotcha!', 'Haha! Tag!'][(Math.random() * 3) | 0], 2);
            o.bark(['Nooo!', 'No fair!', "I'll get you!"][(Math.random() * 3) | 0], 2);
          }
        } else {
          const it = o;
          let dx = this.pos.x - it.pos.x, dz = this.pos.z - it.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          dx /= d; dz /= d;
          const cx = g.center.x - this.pos.x, cz = g.center.z - this.pos.z, cd = Math.hypot(cx, cz);
          if (cd > 9) { dx += cx / cd * 1.2; dz += cz / cd * 1.2; }
          desired = Math.atan2(dx, dz) + Math.sin(state.clock * 1.7 + this.pos.x) * 0.5;
          this.speed = it.tag?.pause ? 1.5 : 4.0;
          if (it.tag?.pause && Math.random() < dt * 0.3) this.bark("Can't catch me!", 1.5);
        }
        break;
      }

      case 'task': {
        if (this.def.id === 'pip' && state.pip === 'hiding') { this.pose = 'look'; break; }
        if (!this.task) this.pickTask();
        const step = this.task!.steps[this.stepIdx];
        this.char.setProp(step.prop ?? null);
        if (this.phase === 'go') {
          const near = step.snap ? 1.3 : 0.45;
          if (flat(this.pos, this.target) < near) {
            if (step.snap) this.pos.set(this.target.x, this.pos.y, this.target.z);
            this.phase = 'do';
            this.timer = rr(step.dur, 4);
          } else if (toPlayer < 2.2 && !step.run) {
            // Stop for a moment to let the player pass / say hello.
            desired = Math.atan2(player.x - this.pos.x, player.z - this.pos.z);
            if (state.clock - this.greeted > 30 && this.barkCooldown <= 0) { this.bark(); this.greeted = state.clock; }
          } else {
            desired = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);
            this.speed = step.run ? 4 : 1.8;
            this.timer -= dt;
            if (this.timer < -25) {
              // Hopelessly stuck: quietly skip ahead when nobody's watching, otherwise just do the task here.
              if (toPlayer > 35) this.pos.set(this.target.x, 0, this.target.z);
              this.phase = 'do';
              this.timer = rr(step.dur, 4);
            }
          }
        } else {
          this.pose = step.pose ?? 'none';
          snapping = !!step.snap;
          if (typeof step.face === 'number') desired = step.face;
          else if (step.face) desired = Math.atan2(step.face.x - this.pos.x, step.face.z - this.pos.z);
          const idle = this.pose === 'none' || this.pose === 'look' || this.pose === 'sit';
          if (toPlayer < 3.2 && idle && this.pose !== 'sit') desired = Math.atan2(player.x - this.pos.x, player.z - this.pos.z);
          if (toPlayer < 6 && this.barkCooldown <= 0) this.bark(step.barks && Math.random() < 0.6 ? step.barks[(Math.random() * step.barks.length) | 0] : undefined);
          else if (step.barks && toPlayer < 22 && this.barkCooldown <= 0 && Math.random() < dt * 0.15) this.bark(step.barks[(Math.random() * step.barks.length) | 0], 2.5);
          this.timer -= dt;
          if (this.timer <= 0) {
            this.stepIdx++;
            if (this.stepIdx >= this.task!.steps.length) this.task = null;
            else this.aim(this.task!.steps[this.stepIdx]);
          }
        }
        break;
      }
    }

    // Turn smoothly toward desired yaw (with a sidestep when blocked)
    if (this.deflectT > 0 && this.speed > 0) desired += this.deflectSign * 1.2;
    let dy = desired - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * (this.speed > 3 ? 9 : 6));

    if (this.speed > 0) {
      const step = this.speed * dt;
      const nx = this.pos.x + Math.sin(this.yaw) * step, nz = this.pos.z + Math.cos(this.yaw) * step;
      if (!isWet(nx, nz) || this.mode === 'flee') { this.pos.x = nx; this.pos.z = nz; }
      else if (this.deflectT <= 0) { this.deflectT = 0.8; this.deflectSign = Math.random() < 0.5 ? -1 : 1; }
    }
    if (!snapping && resolve(this.pos, 0.35) && this.speed > 0 && this.deflectT <= -0.3) {
      this.deflectT = 0.7;
      this.deflectSign = Math.random() < 0.5 ? -1 : 1;
    }
    this.pos.y = floorHeight(this.pos.x, this.pos.z);
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.yaw;
    if (this.mode !== 'task' && this.mode !== 'dance') this.char.setProp(null);
    this.char.animate(dt, this.speed, false, false, this.pose);
    this.char.nod(this.mode === 'talk' ? Math.sin(performance.now() * 0.006) * 0.08 : 0);
    this.char.setGroundOffset(0);
  }

  private walkTo(p: THREE.Vector3, _dt: number, speed: number) {
    if (flat(this.pos, p) < 0.5) return true;
    this.speed = speed;
    return false;
  }

  private pickTask() {
    const night = isNight();
    let pool = this.def.tasks.filter(t => (t.night ?? false) === (night && !!this.def.nightOwl));
    if (!pool.length) pool = this.def.tasks;
    if (pool.length > 1) pool = pool.filter(t => t !== this.lastTask);
    const total = pool.reduce((s, t) => s + (t.w ?? 1), 0);
    let r = Math.random() * total;
    let pick = pool[0];
    for (const t of pool) { if ((r -= t.w ?? 1) <= 0) { pick = t; break; } }
    this.task = this.lastTask = pick;
    this.stepIdx = 0;
    this.aim(pick.steps[0]);
  }

  private aim(step: Step) {
    this.phase = 'go';
    this.timer = 0;
    this.target.copy(step.at);
    if (step.wander) {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * step.wander;
        const x = step.at.x + Math.cos(a) * r, z = step.at.z + Math.sin(a) * r;
        if (!isWet(x, z)) { this.target.set(x, 0, z); break; }
      }
    }
  }
}

const LANDINGS = ['OW!', 'My spine!', 'I can fly! ...Could. Past tense.', 'Who threw me?!', 'Ugh.', 'Not again!', 'I landed on a chicken.', '*groans*', 'AAAAAAAAH— oh. Over.', 'Ten out of ten. Would not fly again.'];

// ---------- Society: villagers interacting with each other ----------

interface Convo { lines: string[]; when?: () => boolean; pair?: [string, string] }
const CONVOS: Convo[] = [
  { lines: ['Lovely weather today.', "Is it? I hadn't looked up."] },
  { lines: ['Did you hear? A stranger came up the road.', 'A stranger? Here? Whatever next.', 'Probably wants to buy cheese.'] },
  { lines: ['Morning!', 'Is it still morning?', "It's always morning somewhere."] },
  { lines: ['The lanterns are still dark...', 'Maren says someone will help.', 'I hope so. I keep walking into the well.'], when: () => state.quest !== 'done' },
  { lines: ['Have you seen the lanterns at night? Beautiful.', 'Thistlewick shines again!', 'Bless that traveler.'], when: () => state.quest === 'done' },
  { lines: ['I think the frogs are planning something.', 'Brann, is that you?', '...No.'] },
  { lines: ['How are the apples this year?', 'Crunchy. Suspiciously crunchy.'] },
  { lines: ['Biscuit stole my sandwich again.', "He stole mine yesterday. He's building an empire."] },
  { lines: ['What do you think is up in the mountains?', 'Snow, mostly.', 'Mostly?', "...Let's not talk about it."] },
  { lines: ["Did you hear Fennick's new song?", 'Was that a song? I thought a goose got stuck.'] },
  { lines: ['My back hurts.', 'Mine too.', 'Getting old, are we?', 'Speak for yourself!'] },
  { lines: ['Fancy a slice of pie later?', 'Always.', 'Hollis is out of apples, though.', 'Tragedy.'], when: () => state.pie !== 'done' },
  { lines: ['The stranger brought Hollis apples!', 'Pie for everyone!', 'I had three slices. I regret nothing.'], when: () => state.pie === 'done' },
  { lines: ["Poor Wren, still no sign of Clover.", 'That sheep has always had wanderlust.'], when: () => state.sheep !== 'done' },
  { lines: ['Lotte is still looking for Mittens.', 'That cat climbs everything. She could be anywhere.'], when: () => state.mittens !== 'done' },
  { lines: ['Nice to see you out and about.', 'Somebody has to keep an eye on things.', 'On what things?', 'All the things.'] },
  { lines: ['Did you feel that wind last night?', 'Sela says the island was whispering.', 'Sela says a lot of things.'] },
  { lines: ['Is it me, or are there more chickens than yesterday?', "Don't count them. They don't like being counted."] },
  { lines: ['Another sword, Brann?', "It's for... a friend.", 'You said that last time.', 'I have a lot of friends.'], pair: ['tobin', 'brann'] },
  { lines: ['Elder! Elder! Look what I found!', "That's a rock, Pip.", "It's a SPECIAL rock."], pair: ['pip', 'maren'] },
  { lines: ['Got any apples for me, Wren?', "Ask the orchard, Hollis. I grow cabbages.", 'Cabbage pie, then?', 'Please no.'], pair: ['hollis', 'wren'] },
  { lines: ['Lovely laundry today, Nell.', 'Thank you, Bertram. The red socks are new.', 'Socks! In my day we had... also socks.'], pair: ['bertram', 'nell'] },
  { lines: ['Need more logs for the bakery.', "On it. Don't drop them on your foot this time.", 'That was ONE time.'], pair: ['jory', 'garrick'] },
  { lines: ['Cheese, Tobin? Fresh in today.', "Is it the same cheese as last week?", "...It's matured."], pair: ['ilsa', 'tobin'] },
  { lines: ['Play the one about the frog!', 'Again? Brann will cry.', 'Exactly!'], pair: ['lotte', 'fennick'] },
  { lines: ['Pip, did you hide in my flour sack again?', "No.", 'You are covered in flour.', "...It's a disguise."], pair: ['hollis', 'pip'] },
];

export class Society {
  private t = 3;

  constructor(private npcs: NPC[]) {}

  update(dt: number, animals: Animal[], player: THREE.Vector3) {
    const npcs = this.npcs;
    // Keep villagers from walking through each other.
    for (let i = 0; i < npcs.length; i++) {
      const a = npcs[i];
      if (a.atHome) continue;
      for (let j = i + 1; j < npcs.length; j++) {
        const b = npcs[j];
        if (b.atHome) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.75 && d > 1e-4) {
          const push = (0.75 - d) / 2;
          a.pos.x -= dx / d * push; a.pos.z -= dz / d * push;
          b.pos.x += dx / d * push; b.pos.z += dz / d * push;
        }
      }
    }

    if ((this.t -= dt) <= 0) {
      this.t = 2 + Math.random() * 4;
      this.tryChat(player);
      this.tryTag();
    }

    // Guard Brann has a... thing about frogs.
    const brann = npcs.find(n => n.def.id === 'brann');
    if (brann && brann.mode === 'task' && !brann.atHome && brann.tagCd <= 0) {
      const frog = animals.find(a => a.kind === 'frog' && flat(a.pos, brann.pos) < 3.5);
      if (frog) {
        brann.startReact('scared', 2.2, frog.pos, ['FROG! FROG! FROOOG!', 'Stay back, foul beast!', 'Not the frogs. Anything but the frogs.'][(Math.random() * 3) | 0], frog.pos);
        brann.tagCd = 25;
        frog.bark('Ribbit.');
      }
    }
  }

  private tryChat(player: THREE.Vector3) {
    const free = this.npcs.filter(n => n.canSocialize() && flat(n.pos, player) > 3);
    if (free.length < 2) return;
    const a = free[(Math.random() * free.length) | 0];
    let b: NPC | null = null, bd = 26;
    for (const n of free) {
      if (n === a) continue;
      const d = flat(n.pos, a.pos);
      if (d < bd) { bd = d; b = n; }
    }
    if (!b) return;
    const pairs = CONVOS.filter(c => c.pair && c.pair.includes(a.def.id) && c.pair.includes(b!.def.id) && (!c.when || c.when()));
    let convo: Convo;
    let first = a, second = b;
    if (pairs.length && Math.random() < 0.7) {
      convo = pairs[(Math.random() * pairs.length) | 0];
      if (convo.pair![0] !== a.def.id) { first = b; second = a; }
    } else {
      const general = CONVOS.filter(c => !c.pair && (!c.when || c.when()));
      convo = general[(Math.random() * general.length) | 0];
    }
    const mid = first.pos.clone().add(second.pos).multiplyScalar(0.5);
    const dir = second.pos.clone().sub(first.pos).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
    dir.normalize().multiplyScalar(0.8);
    const spotA = mid.clone().sub(dir), spotB = mid.clone().add(dir);
    const lead: Chat = { partner: second, spot: spotA, face: spotB, lines: convo.lines, idx: 0, lead: true, t: 0.3, wait: 14 };
    first.startChat(lead);
    second.startChat({ partner: first, spot: spotB, face: spotA, lines: convo.lines, idx: 0, lead: false, t: 0, wait: 0 });
  }

  private tryTag() {
    const pip = this.npcs.find(n => n.def.id === 'pip'), lotte = this.npcs.find(n => n.def.id === 'lotte');
    if (!pip || !lotte || isNight() || state.pip === 'hiding') return;
    if (pip.mode !== 'task' || lotte.mode !== 'task' || pip.atHome || lotte.atHome || pip.tagCd > 0 || lotte.tagCd > 0) return;
    if (flat(pip.pos, lotte.pos) > 30 || Math.random() < 0.5) return;
    const center = pip.pos.clone().add(lotte.pos).multiplyScalar(0.5);
    const until = state.clock + 25 + Math.random() * 15;
    pip.tag = { partner: lotte, it: true, until, center, pause: 2 };
    lotte.tag = { partner: pip, it: false, until, center, pause: 0 };
    pip.mode = lotte.mode = 'tag';
    pip.bark("Lotte! Tag! I'm it! Run!", 2.5);
  }

  /** Everyone within earshot looks toward a sound. */
  alarm(at: THREE.Vector3, lines: string[], radius = 50) {
    for (const n of this.npcs) {
      if (n.atHome || flat(n.pos, at) > radius) continue;
      n.startReact('look', 2.5 + Math.random(), at, Math.random() < 0.6 ? lines[(Math.random() * lines.length) | 0] : undefined);
    }
  }
}

// ---------- Cast ----------

const RUMORS = [
  'They say the hermit on the hill talks to clouds. They say the clouds answer.',
  'Odo once caught a fish. Nobody believes him, including Odo.',
  'Some nights you can hear singing from the high peaks. Probably wind. Probably.',
  'Pip claims he can hide anywhere. He hid in my cheese crate once. I sold the crate.',
  'Moss the herbalist brews a tonic that makes your knees springy. Bring her mushrooms.',
  "Biscuit the dog has stolen eleven sausages this month. He's the real power in Thistlewick.",
  'There are treasure chests out in the wilds. Pirates, probably. Or very tidy squirrels.',
];

const STORIES = [
  'When I was a lad, the whole plaza was a duck pond. The ducks ran the council. Efficient bunch.',
  "I once wrestled a goat for my hat. The goat won. Still has the hat, I think. Looks better on him.",
  'The tower on the peaks? My grandmother said it was built by a wizard who hated stairs. So he built it sideways.',
  "See that well? Dropped my spectacles down it in '42. Haven't seen a thing since. Ha!",
];

function sellAll(): string {
  let total = 0;
  const sold: string[] = [];
  for (const k of Object.keys(ITEMS) as Item[]) {
    const n = state.inv[k];
    if (n <= 0) continue;
    total += n * ITEMS[k].price;
    sold.push(`${n} ${ITEMS[k].icon}`);
    state.inv[k] = 0;
  }
  addCoins(total);
  return total ? `${sold.join(', ')} — that's ${total} coins. Pleasure doing business!` : 'You have nothing to sell, friend.';
}

export function makeNPCDefs(v: Village): NPCDef[] {
  return defs(v);
}

function defs(v: Village): NPCDef[] {
  const s = state;
  const S = v.spots, L = v.lists, D = v.doors;
  const seat = (i: number, dur: [number, number], barks?: string[]): Step => ({ at: v.seats[i].pos, face: v.seats[i].yaw, pose: 'sit', snap: true, dur, barks });
  const camp = (i: number, pose: Pose, prop?: PropKind): Task => ({ night: true, steps: [{ at: v.campSeats[i].pos, face: S.campfire, pose, prop, snap: true, dur: [30, 60] }] });
  let sale = '', bought = '';

  return [
    {
      id: 'maren', name: 'Elder Maren', home: S.well, door: D.maren, social: true, dancer: true,
      style: { skin: '#e2b896', shirt: '#6a4c8c', pants: '#4a3560', hair: '#e8e8e8', robe: true },
      barks: ['The lanterns have been dark three nights now...', 'Welcome, traveler.', 'Mind the well, it is deeper than it looks.'],
      thanks: 'Flowers! It has been years since anyone gave me flowers. You have a kind heart.',
      tasks: [
        { w: 3, steps: [{ at: S.well, wander: 2, dur: [8, 14] }] },
        { w: 2, steps: [seat(1, [15, 25])] },
        { w: 1, steps: [{ at: S.board, face: S.plaza.clone().add(new THREE.Vector3(-0.8, 0, -12)), pose: 'read', dur: [5, 8] }] },
        { w: 1, steps: [{ at: S.plaza, wander: 11, pose: 'look', dur: [4, 7] }] },
      ],
      script: {
        entry: () => s.quest === 'none' ? 'intro' : s.quest === 'done' ? 'after' : s.shards >= SHARDS_NEEDED ? 'turnin' : 'progress',
        nodes: {
          intro: {
            text: 'Ah, a traveler! Welcome to Thistlewick. Forgive the gloom. A storm three nights ago scattered our glowshards across the isle, and without them the lanterns stay dark.',
            options: [
              { text: 'I can help find them.', next: 'accept', act: () => { s.quest = 'active'; s.toast('New quest: The Dark Lanterns'); } },
              { text: 'What are glowshards?', next: 'what' },
              { text: 'Good luck with that.' },
            ],
          },
          what: {
            text: 'Crystals that drink in sunlight and give it back at night. They hum faintly, and where one has fallen you will see a pale beam rising into the sky.',
            options: [
              { text: "I'll find them.", next: 'accept', act: () => { s.quest = 'active'; s.toast('New quest: The Dark Lanterns'); } },
              { text: 'Maybe later.' },
            ],
          },
          accept: {
            text: `Bless you. ${SHARDS_NEEDED} should be enough to relight the plaza. Sela the hermit sees much from her hill — she may know where they fell. And do meet the others; Thistlewick is small, but never dull.`,
            options: [{ text: "I'll be back." }],
          },
          progress: {
            text: () => `You carry ${s.shards} of ${SHARDS_NEEDED}. Keep looking — follow the pale beams.`,
            options: [{ text: 'Any advice?', next: 'advice' }, { text: "I'll keep at it." }],
          },
          advice: {
            text: 'Climb high and look about you; the beams show best at dusk. And do talk to Sela, up in the hills. Look for her on your map.',
            options: [{ text: 'Thank you.' }],
          },
          turnin: {
            text: 'Is that...? Yes! I can feel them humming from here.',
            options: [{ text: `Here — ${SHARDS_NEEDED} glowshards.`, next: 'thanks', act: () => { s.shards -= SHARDS_NEEDED; s.quest = 'done'; s.onQuestDone(); } }],
          },
          thanks: {
            text: 'Watch the plaza when night falls, friend — Fennick has promised a festival. Thistlewick owes you. Tobin wanted to meet whoever helped — you will find him at the forge.',
            options: [{ text: 'Glad to help.' }],
          },
          after: {
            text: 'The lanterns burn bright thanks to you. Every evening now we dance in the plaza. Stay as long as you like.',
            options: [{ text: 'Thank you, Elder.' }],
          },
        },
      },
    },
    {
      id: 'tobin', name: 'Tobin the Smith', home: S.forge, door: D.tobin, social: true,
      style: { skin: '#c68e64', shirt: '#7a4b2a', pants: '#3b3330', hair: '#2b1d14', beard: '#2b1d14', scale: 1.08 },
      barks: ['*clang* *clang*', 'Hot work, this.', 'Need a hinge? I have hinges.'],
      thanks: "Flowers? For me? I'll... put them somewhere they won't catch fire.",
      tasks: [
        { w: 4, steps: [{ at: S.forge, face: S.anvil, pose: 'hammer', prop: 'hammer', dur: [12, 20], barks: ['*clang*', '*clang* *clang*', '*CLANG*'] }] },
        { w: 1, steps: [{ at: S.forgeFire.clone().add(new THREE.Vector3(0, 0, -1.4)), face: S.forgeFire, pose: 'knead', dur: [4, 7] }] },
        { w: 1, steps: [{ at: S.forge, wander: 5, dur: [3, 6] }] },
      ],
      script: {
        entry: () => (s.quest === 'done' && !s.boots ? 'reward' : 'hi'),
        nodes: {
          hi: {
            text: "*clang* Oh! Didn't see you there. Name's Tobin. I make nails, hinges, and the occasional sword nobody needs.",
            options: [
              { text: 'Why make swords nobody needs?', next: 'swords' },
              { text: 'Seen any glowshards?', next: 'shards', show: () => s.quest === 'active' },
              { text: 'See you around.' },
            ],
          },
          swords: { text: 'Practice! And Brann keeps buying them. I think he has a collection. I think he talks to it.', options: [{ text: 'Ha. Bye, Tobin.' }] },
          shards: { text: 'Saw a few streak over the forge during the storm. Flew far — past the hills, some of them right out to the shore.', options: [{ text: 'Thanks.' }] },
          reward: {
            text: "So you're the one who lit the lanterns! Here — boots I've been working on. Lighter than they look. You'll run like the wind.",
            options: [{ text: 'Thank you!', act: () => { s.boots = true; s.toast('Received: Featherstep Boots (faster running)'); } }],
          },
        },
      },
    },
    {
      id: 'pip', name: 'Pip', home: S.well.clone().add(new THREE.Vector3(-6, 0, -5)), door: D.pip, social: true, dancer: true,
      style: { skin: '#f0c8a0', shirt: '#3f8fc0', pants: '#6b5a3a', hair: '#d0742a', scale: 0.72 },
      barks: ["Tag! You're it!", "Bet you can't find me!", "I'm not bored. You're bored."],
      thanks: "Flowers? Ew. ...Can I give them to Lotte? Don't tell her they're from me.",
      tasks: [
        { w: 3, steps: [{ at: S.plaza, wander: 10, dur: [2, 5] }, { at: S.plaza, wander: 10, run: true, dur: [1, 3] }] },
        { w: 1, steps: [{ at: S.pondEdge, face: S.pond, pose: 'sitGround', dur: [8, 14] }] },
        { w: 1, steps: [{ at: S.coop, wander: 3, run: true, dur: [2, 4], barks: ['CHICKENS!', 'Bawk bawk! Haha!'] }] },
      ],
      script: {
        entry: () => (s.pip === 'none' ? 'hi' : s.pip === 'hiding' ? 'found' : 'after'),
        nodes: {
          hi: {
            text: "Hey! Wanna play hide-and-seek? I'm REALLY good. Like, the best.",
            options: [
              { text: 'Sure, go hide.', next: 'go', act: () => { s.pipHideRequested = true; } },
              { text: 'Not now, Pip.' },
            ],
          },
          go: { text: "Count to... uh, however long! No peeking! I'll be somewhere outside the village!", options: [{ text: '(Start counting)' }] },
          found: {
            text: "Aww, you found me! Okay, okay, you're good. Here — I found this shiny rock while I was hiding.",
            options: [{ text: 'A glowshard!', act: () => { s.pip = 'found'; s.shards++; s.toast('Received a glowshard from Pip'); } }],
          },
          after: { text: 'Best. Seeker. Ever. Wanna know a secret? Brann is scared of frogs. Like, REALLY scared.', options: [{ text: "I'll keep it quiet." }] },
        },
      },
    },
    {
      id: 'lotte', name: 'Lotte', home: S.plaza.clone().add(new THREE.Vector3(5, 0, -6)), door: D.lotte, social: true, dancer: true,
      style: { skin: '#e8b890', shirt: '#d8607a', pants: '#5a4a6a', hair: '#e8c060', scale: 0.7, robe: true },
      barks: ['Mittens? Mittens!', 'Have you seen my cat?', 'I can do a cartwheel. Almost.'],
      thanks: "FLOWERS! I'm gonna put them in my hair! And Mittens's hair!",
      tasks: [
        { w: 3, steps: [{ at: S.plaza, wander: 11, dur: [3, 6] }] },
        { w: 1, steps: [{ at: S.pondEdge, face: S.pond, pose: 'sitGround', dur: [8, 14], barks: ['Hello duckies!', 'Quack!'] }] },
        { w: 1, steps: [{ at: S.plaza, wander: 6, pose: 'dance', dur: [4, 6] }] },
      ],
      script: {
        entry: () => (s.mittens === 'done' ? 'after' : s.mittens === 'active' ? 'waiting' : 'hi'),
        nodes: {
          hi: {
            text: "Hi! I'm Lotte. Have you seen my cat Mittens? She's black with white paws and she ran away in the storm and I miss her SO much.",
            options: [
              { text: "I'll look for her.", next: 'yay', act: () => { s.mittens = 'active'; s.toast('New task: Find Mittens'); } },
              { text: 'Where did you last see her?', next: 'where' },
              { text: "Sorry, I haven't." },
            ],
          },
          where: { text: "She chased a butterfly out past the houses. Mittens loves high, quiet places. And bugs. And me.", options: [{ text: "I'll find her.", next: 'yay', act: () => { s.mittens = 'active'; s.toast('New task: Find Mittens'); } }] },
          yay: { text: "Really?! If you pet her she'll follow you. Bring her back to me, okay? Promise?", options: [{ text: 'Promise.' }] },
          waiting: { text: "Did you find Mittens yet? She's out past the village somewhere. Pet her and she'll follow you home!", options: [{ text: 'Still looking.' }] },
          after: {
            text: () => (s.canDance ? "Mittens says thank you! Wanna dance? Press G! Everybody dances in Thistlewick!" : 'Mittens is home!'),
            options: [{ text: 'Thanks, Lotte.' }],
          },
        },
      },
    },
    {
      id: 'ilsa', name: 'Ilsa the Merchant', home: S.stall, door: D.ilsa, social: true, dancer: true,
      style: { skin: '#a9714b', shirt: '#2f7a5c', pants: '#523b2a', hair: '#151010', hat: '#c0463a' },
      barks: ['Finest wares on the isle!', 'Cheese! Rope! Questionable art!', 'Everything must go. Especially the portrait.'],
      thanks: 'Flowers! I could sell these... no. No, I will keep them. Thank you.',
      tasks: [
        { w: 5, steps: [{ at: S.stall, face: S.plaza, dur: [12, 22], barks: ['Fresh cheese!', 'Rope! Get your rope!', 'I buy anything! Almost anything!', 'Mushrooms? Berries? Fish? I buy it all!'] }] },
        { w: 1, steps: [{ at: S.stall, face: S.plaza, pose: 'wave', dur: [2, 3], barks: ['Over here, friend!', 'Best prices on the isle!'] }] },
        { w: 1, steps: [{ at: S.crates, pose: 'pet', dur: [1.5, 2] }, { at: S.stallSide, prop: 'crate', pose: 'pet', dur: [1.5, 2] }] },
      ],
      script: {
        entry: () => 'hi',
        nodes: {
          hi: {
            text: () => `Finest wares on the isle! ...Only wares on the isle, but still.${s.coins ? ` You've got ${s.coins} coins burning a hole in your pocket, I see.` : ''}`,
            options: [
              { text: "I'd like to sell my goods.", next: 'sold', show: () => (Object.keys(ITEMS) as Item[]).some(k => s.inv[k] > 0), act: () => { sale = sellAll(); } },
              { text: 'What do you sell?', next: 'sell' },
              { text: 'Heard any rumors?', next: 'rumor' },
              { text: 'Just browsing.' },
            ],
          },
          sold: { text: () => sale, options: [{ text: 'What do you sell?', next: 'sell' }, { text: 'Thanks, Ilsa.' }] },
          sell: {
            text: 'Cheese, rope, a fishing rod, a VERY fancy hat, and a portrait of my cousin. Make an offer.',
            options: [
              { text: 'The fancy hat (12 🪙)', show: () => !s.fancyHat, next: 'bought', act: () => {
                if (s.coins >= 12) { addCoins(-12); s.fancyHat = true; bought = 'It suits you! Wear it with pride. Or at least with a straight face.'; s.toast('Bought: The Very Fancy Hat'); s.changed(); }
                else bought = `That's 12 coins, friend. You have ${s.coins}. Sell me some berries, mushrooms, fish...`;
              } },
              { text: 'A fishing rod (5 🪙)', show: () => !s.rod, next: 'bought', act: () => {
                if (s.coins >= 5) { addCoins(-5); s.rod = true; bought = "There you go. The dock is past the trees, toward the sea. Odo's always there."; s.toast('Bought: Fishing Rod'); }
                else bought = `Five coins. You have ${s.coins}. Barrels sometimes have loose change, you know. Not that I'd look.`;
              } },
              { text: "I'll take the portrait.", next: 'portrait', show: () => !s.portrait },
              { text: 'Maybe later.' },
            ],
          },
          bought: { text: () => bought, options: [{ text: 'Anything else?', next: 'sell' }, { text: 'Thanks.' }] },
          portrait: {
            text: 'Ha! Nobody ever does. Keep it — free of charge. Please.',
            options: [{ text: '...Thanks?', act: () => { s.portrait = true; s.toast("Received: Portrait of Ilsa's Cousin"); } }],
          },
          rumor: { text: () => RUMORS[(Math.random() * RUMORS.length) | 0], options: [{ text: 'Another?', next: 'rumor' }, { text: 'Interesting.' }] },
        },
      },
    },
    {
      id: 'brann', name: 'Guard Brann', home: S.gate, nightOwl: true, social: true,
      style: { skin: '#d9a77f', shirt: '#7d8590', pants: '#3b4250', hair: '#6b4a2a', hat: '#5a616b', beard: '#6b4a2a' },
      barks: ['All quiet.', "Halt! ...Oh, it's you.", 'Did something just croak?'],
      thanks: 'Flowers? On duty? ...I will allow it. Just this once.',
      tasks: [
        { w: 3, steps: L.patrol.map(p => ({ at: p, pose: 'look' as Pose, dur: [3, 6] as [number, number] })) },
        { w: 2, steps: [{ at: S.gate, face: S.gate.clone().multiplyScalar(2), dur: [10, 16] }] },
        { night: true, steps: L.patrol.map(p => ({ at: p, pose: 'look' as Pose, dur: [4, 8] as [number, number] })) },
        { night: true, steps: [{ at: S.campfire.clone().add(new THREE.Vector3(3.5, 0, 1.5)), face: S.campfire, dur: [15, 25] }] },
      ],
      script: {
        entry: () => 'hi',
        nodes: {
          hi: {
            text: "Halt! ...Oh, you're harmless. Welcome to Thistlewick.",
            options: [
              { text: 'Any tips for a newcomer?', next: 'tips' },
              { text: 'Who lives here?', next: 'who' },
              { text: 'Carry on.' },
            ],
          },
          tips: { text: "Deep water slows you down, cliffs can't be climbed, and never trust a frog.", options: [{ text: 'Frogs?', next: 'frogs' }, { text: 'Noted.' }] },
          frogs: { text: '...We do not talk about the frogs.', options: [{ text: 'Okay then.' }] },
          who: {
            text: "Elder Maren is by the well. Tobin's at his forge, Ilsa runs the stall, Hollis bakes, Wren farms out east, Garrick chops wood down south, Nell does everyone's laundry, and old Bertram feeds the pigeons. Odo fishes off the dock, Moss brews things in the woods, and Sela lives up on the hill.",
            options: [{ text: 'That is a lot of people.', next: 'who2' }],
          },
          who2: { text: "Don't forget the kids. Pip and Lotte. They're... a lot. And Fennick. He sings. Constantly.", options: [{ text: 'Thanks, Brann.' }] },
        },
      },
    },
    {
      id: 'wren', name: 'Wren the Farmer', home: S.field, door: D.wren, social: true, dancer: true,
      style: { skin: '#d8a070', shirt: '#7a9a4a', pants: '#5a4a3a', hair: '#a8582a', hat: '#d8c27a' },
      barks: ['Come on, you cabbages. Grow.', 'Mind the chickens!', 'Have you seen a sheep wandering about?'],
      thanks: "Oh, wildflowers! The sheep will try to eat these. I'll hide them.",
      tasks: [
        ...L.field.map((p): Task => ({ w: 1, steps: [{ at: p, face: S.field, pose: 'hoe', prop: 'hoe', dur: [8, 14], barks: ['Hup.', 'Weeds, weeds, weeds...'] }] })),
        { w: 2, steps: [{ at: S.coopFeed, face: S.coop, pose: 'scatter', prop: 'basket', dur: [8, 12], barks: ['Here chick chick chick!', 'Come on, girls!', 'Breakfast!'] }] },
        { w: 1, steps: [{ at: S.penGate, face: S.pen, pose: 'look', dur: [4, 7], barks: ['Five... six... still no Clover.'] }] },
        { w: 1, steps: [{ at: S.pigFence, face: S.pigpen, pose: 'scatter', prop: 'bucket', dur: [5, 8], barks: ['Soooo-ey!', 'Dinner, piggies!'] }] },
      ],
      script: {
        entry: () => (s.sheep === 'done' ? 'after' : s.sheep === 'active' ? 'waiting' : 'hi'),
        nodes: {
          hi: {
            text: "Oh! Hello there. Sorry, I'm a bit frazzled — one of my sheep, Clover, wandered off in the storm. She's out in the hills somewhere.",
            options: [
              { text: "I'll find her.", next: 'thanks', act: () => { s.sheep = 'active'; s.toast('New task: Find Clover the sheep'); } },
              { text: 'What does she look like?', next: 'look' },
              { text: 'Good luck.' },
            ],
          },
          look: { text: "Grey-ish, fluffy, answers to Clover. Well — she doesn't answer. But she'll follow anyone who gives her a scratch.", options: [{ text: "I'll find her.", next: 'thanks', act: () => { s.sheep = 'active'; s.toast('New task: Find Clover the sheep'); } }, { text: 'Hm. Maybe later.' }] },
          thanks: { text: "Bless you! Give her a pat and she'll follow. Bring her back to the pen, just east of here.", options: [{ text: 'Will do.' }] },
          waiting: { text: 'Any sign of Clover? Pet her and lead her back to the pen gate.', options: [{ text: 'Still looking.' }] },
          after: { text: "Clover's been eating nonstop since she got back. Thank you, truly.", options: [{ text: 'Can I help on the farm?', next: 'farm' }, { text: 'Glad she is home.' }] },
          farm: { text: 'Feed the chickens if you have berries — they adore them. The pigs go mad for mushrooms, and the cows love apples. And the sheep? Flowers. Fancy sheep.', options: [{ text: 'Got it.' }] },
        },
      },
    },
    {
      id: 'hollis', name: 'Hollis the Baker', home: S.oven, door: D.hollis, social: true, dancer: true,
      style: { skin: '#e8b898', shirt: '#f0ece0', pants: '#6a5a4a', hair: '#7a5a3a', hat: '#f8f8f4', scale: 1.05 },
      barks: ['Fresh bread! Well, fresh-ish.', 'Mind the oven, it bites.', '*hums while kneading*'],
      thanks: "Flowers! I'll candy the petals. Or put them in a vase. Probably candy them.",
      tasks: [
        { w: 3, steps: [{ at: S.bakeryTableFront, face: S.bakeryTable, pose: 'knead', dur: [10, 16], barks: ['Knead, knead, knead...', 'Rise, my beauties.'] }] },
        { w: 2, steps: [{ at: S.oven, face: S.oven.clone().add(S.oven.clone().sub(S.bakeryTableFront).setY(0).normalize().multiplyScalar(-0.1)), pose: 'pet', dur: [3, 5], barks: ['Ooh, nearly done.', 'Hot hot hot!'] }] },
        { w: 1, steps: [{ at: S.bakeryTableFront, pose: 'pet', dur: [1, 1.5] }, { at: S.stallSide, prop: 'bread', pose: 'pet', dur: [2, 3], barks: ['Fresh loaves, Ilsa!'] }] },
      ],
      script: {
        entry: () => (s.pie === 'done' ? 'after' : s.pie === 'active' ? (s.inv.apples >= 3 ? 'turnin' : 'waiting') : 'hi'),
        nodes: {
          hi: {
            text: "Welcome to the bakery! Well, the oven. The bakery is mostly the oven. I'd make my famous apple pie, if only I had apples...",
            options: [
              { text: 'I could fetch some.', next: 'ok', act: () => { s.pie = 'active'; s.toast('New task: Bring Hollis 3 apples'); } },
              { text: "What's so famous about it?", next: 'famous' },
              { text: 'Smells great. Bye!' },
            ],
          },
          famous: { text: 'Once a seagull stole a whole slice and flew in circles for an hour, singing. True story. Ask Odo.', options: [{ text: "I'll get you apples.", next: 'ok', act: () => { s.pie = 'active'; s.toast('New task: Bring Hollis 3 apples'); } }, { text: 'Hm.' }] },
          ok: { text: 'Three apples should do it. The orchard is just north of the plaza — give the trees a good shake!', options: [{ text: 'On it.' }] },
          waiting: { text: () => `Three apples, please! You have ${s.inv.apples}. The orchard's north of the plaza.`, options: [{ text: 'Back soon.' }] },
          turnin: {
            text: 'Apples! Lovely, crunchy apples!',
            options: [{ text: 'Here you go. (Give 3 🍎)', next: 'paid', act: () => { take('apples', 3); addCoins(6); s.pie = 'done'; s.toast('Hollis pays you 6 coins (and a slice of pie)'); } }],
          },
          paid: { text: "Here — six coins, and the first slice is yours. Don't tell Biscuit.", options: [{ text: 'Mmm. Thank you!' }] },
          after: { text: 'The pie was a triumph. Even Brann had seconds. And thirds. And then he hid the rest.', options: [{ text: 'Ha!' }] },
        },
      },
    },
    {
      id: 'garrick', name: 'Garrick the Woodcutter', home: S.chop, door: D.garrick, nightOwl: true, social: true, dancer: true,
      style: { skin: '#c8906a', shirt: '#9a3a2a', pants: '#3a3a4a', hair: '#3a2a1a', beard: '#3a2a1a', scale: 1.12 },
      barks: ['Hup!', 'Timber! ...well, kindling.', 'Good, honest wood.'],
      thanks: 'Flowers, eh? Smell nicer than sawdust. Thanks.',
      tasks: [
        { w: 4, steps: [{ at: S.chop, face: S.chop.clone().add(new THREE.Vector3(0, 0, 1.1)), pose: 'chop', prop: 'axe', dur: [10, 18], barks: ['Hup!', '*thwack*', 'One more...'] }] },
        { w: 2, steps: [{ at: S.chop, pose: 'pet', dur: [1, 1.5] }, { at: S.woodpile, prop: 'logs', pose: 'pet', dur: [1.5, 2] }] },
        camp(0, 'sitGround'),
      ],
      script: {
        entry: () => (s.wood === 'done' ? 'after' : s.wood === 'active' ? (s.woodChopped >= 3 ? 'turnin' : 'waiting') : 'hi'),
        nodes: {
          hi: {
            text: "Garrick. I cut wood. Everyone's wood. The bakery alone burns a forest a week. My back is not what it was.",
            options: [
              { text: 'Want a hand?', next: 'help', act: () => { s.wood = 'active'; s.woodChopped = 0; s.toast('New task: Chop 3 logs for Garrick'); } },
              { text: 'What about the campfire?', next: 'fire' },
              { text: 'Take care of that back.' },
            ],
          },
          help: { text: "Ha! Alright. Use the stump there — chop three logs and I'll pay you. Keep the logs, Ilsa buys them.", options: [{ text: 'Deal.' }] },
          fire: { text: 'We gather there when the sun goes down. Fennick plays, Jory tells lies, Brann pretends not to be scared of the dark. Rest a while, if you like.', options: [{ text: 'Sounds nice.' }] },
          waiting: { text: () => `${s.woodChopped} of 3. Put your back into it! Not literally. Ask me how I know.`, options: [{ text: 'Back to it.' }] },
          turnin: { text: 'Not bad at all! Here, five coins. You ever want a job, the axe is yours.', options: [{ text: 'Thanks, Garrick!', act: () => { addCoins(5); s.wood = 'done'; s.toast('Garrick pays you 5 coins'); } }] },
          after: { text: 'My back thanks you. The rest of me also thanks you.', options: [{ text: 'Any time.' }] },
        },
      },
    },
    {
      id: 'fennick', name: 'Fennick the Bard', home: S.bard, door: D.fennick, nightOwl: true, social: true, bard: true,
      style: { skin: '#e0b090', shirt: '#3a5a9a', pants: '#8a3a3a', hair: '#e8d070', hat: '#3a7a4a' },
      barks: ['♪ La la laaa ♪', '♪ Oh, the lanterns of Thistlewick... ♪', '♪ Hey nonny nonny ♪'],
      thanks: '♪ A gift of flowers, oh my heart! ♪ ...I will write a song about this. A long one.',
      tasks: [
        { w: 4, steps: [{ at: S.bard, face: S.plaza, pose: 'lute', prop: 'lute', dur: [15, 25], barks: ['♪ La la laaa ♪', '♪ Oh, the lanterns of Thistlewick, so dark, so very dark... ♪', '♪ Hey nonny nonny ♪', '♪ A frog went a-courtin\'... ♪'] }] },
        { w: 1, steps: [{ at: S.plaza, wander: 12, dur: [3, 6] }] },
        camp(2, 'lute', 'lute'),
      ],
      script: {
        entry: () => 'hi',
        nodes: {
          hi: {
            text: "Fennick, bard of Thistlewick! Hear my songs, weep at my lyrics, tip generously. Requests?",
            options: [
              { text: 'Play us something lively!', act: () => { s.party = { x: S.bard.x, z: S.bard.z, until: s.clock + 25 }; s.toast('Fennick strikes up a jig — everyone nearby starts dancing!'); } },
              { text: 'Tell me about the island.', next: 'lore' },
              { text: 'Maybe later.' },
            ],
          },
          lore: { text: 'Ah! Thistlewick: twenty souls, two hundred chickens, one very stressed guard. To the south, Garrick\'s fire. To the north, the orchard. Out east, the farm. And beyond — the wild hills!', options: [{ text: 'Play something!', act: () => { s.party = { x: S.bard.x, z: S.bard.z, until: s.clock + 25 }; s.toast('Fennick strikes up a jig — everyone nearby starts dancing!'); } }, { text: 'Thanks.' }] },
        },
      },
    },
    {
      id: 'bertram', name: 'Old Bertram', home: v.seats[3].pos, door: D.bertram, social: true,
      style: { skin: '#e0b898', shirt: '#7a6a5a', pants: '#4a4a4a', hair: '#f0f0f0', beard: '#f0f0f0', hat: '#5a4a3a', scale: 0.95 },
      barks: ['Here, little ones.', 'Back in my day, pigeons were bigger.', 'Eh? Speak up!'],
      thanks: "Flowers! My late wife loved these. You've made an old man very happy.",
      tasks: [
        { w: 4, steps: [seat(3, [30, 50], ['Here, little ones.', 'Coo, coo.', 'Back in my day, pigeons were bigger.'])] },
        { w: 1, steps: [{ at: S.plaza, wander: 10, dur: [4, 8] }] },
        { w: 1, steps: [seat(2, [20, 30])] },
      ],
      script: {
        entry: () => 'hi',
        nodes: {
          hi: {
            text: "Eh? Oh, a young one! Sit, sit. The pigeons don't mind. Want to hear a story?",
            options: [{ text: 'Sure, tell me one.', next: 'story' }, { text: 'Maybe another time.' }],
          },
          story: { text: () => STORIES[(Math.random() * STORIES.length) | 0], options: [{ text: 'Another!', next: 'story' }, { text: 'Thank you, Bertram.' }] },
        },
      },
    },
    {
      id: 'nell', name: 'Nell the Washerwoman', home: L.laundry[0], door: D.nell, social: true, dancer: true,
      style: { skin: '#d8a888', shirt: '#5a8ab8', pants: '#e8e0d0', hair: '#5a3a2a', robe: true },
      barks: ['Nothing a good scrub won\'t fix.', 'Mind the wet sheets!', 'Who keeps getting mud on these?'],
      thanks: 'Oh, how pretty! They smell better than the soap, and that is saying something.',
      tasks: [
        ...L.laundry.map((p): Task => ({ w: 2, steps: [{ at: p, face: S.laundryFace, pose: 'reach', dur: [8, 12] }] })),
        { w: 2, steps: [{ at: D.nell, wander: 3, pose: 'sweep', prop: 'broom', dur: [10, 15] }] },
        { w: 1, steps: [{ at: S.plaza, wander: 9, pose: 'sweep', prop: 'broom', dur: [8, 12], barks: ['Who tracked mud through the plaza?!'] }] },
      ],
      script: {
        entry: () => (s.sock === 'done' ? 'after' : s.sock === 'found' ? 'turnin' : s.sock === 'active' ? 'waiting' : 'hi'),
        nodes: {
          hi: {
            text: "Hello, dear. Mind the sheets. The storm blew my best red sock clean off the line. One sock! What use is one sock?",
            options: [
              { text: "I'll keep an eye out.", next: 'where', act: () => { s.sock = 'active'; s.toast('New task: Find Nell\'s red sock'); } },
              { text: 'Tragic.' },
            ],
          },
          where: { text: 'The wind was blowing north-west, past the orchard. Knowing my luck it is somewhere ridiculous.', options: [{ text: "I'll find it." }] },
          waiting: { text: 'Any sign of my sock? North-west, past the orchard, I reckon.', options: [{ text: 'Still looking.' }] },
          turnin: { text: 'My SOCK! Oh, you wonderful thing. Here — three coins, and you may tell everyone you are a hero.', options: [{ text: "I'm a hero.", act: () => { addCoins(3); s.sock = 'done'; s.toast('Nell pays you 3 coins'); s.changed(); } }] },
          after: { text: 'Both socks, together again. As nature intended.', options: [{ text: 'Beautiful.' }] },
        },
      },
    },
    {
      id: 'jory', name: 'Jory the Porter', home: S.crates, door: D.jory, nightOwl: true, social: true, dancer: true,
      style: { skin: '#8a5a3a', shirt: '#c8a050', pants: '#4a3a2a', hair: '#1a1210', scale: 1.02 },
      barks: ["Can't stop, crates to carry!", 'Mind your back!', 'Heavy, heavy, heavy...'],
      thanks: 'Flowers? I usually carry other people\'s things. This is nice.',
      tasks: [
        { w: 2, steps: [{ at: S.crates, pose: 'pet', dur: [1, 2] }, { at: S.forge.clone().add(new THREE.Vector3(-1.5, 0, -1.5)), prop: 'crate', pose: 'pet', dur: [1, 2], barks: ['Iron for you, Tobin!'] }] },
        { w: 2, steps: [{ at: S.woodpile, pose: 'pet', dur: [1, 2] }, { at: S.oven, prop: 'logs', pose: 'pet', dur: [1, 2], barks: ['Firewood, Hollis!'] }] },
        { w: 1, steps: [{ at: S.crates, pose: 'pet', dur: [1, 2] }, { at: S.stallSide, prop: 'crate', pose: 'pet', dur: [1, 2] }] },
        { w: 1, steps: [seat(0, [10, 16])] },
        camp(4, 'sitGround'),
      ],
      script: {
        entry: () => 'hi',
        nodes: {
          hi: {
            text: "Jory! Porter, carrier, haver of strong opinions about crates. Can't stop long — these won't carry themselves.",
            options: [{ text: 'What are you carrying?', next: 'what' }, { text: 'Need a hand?', next: 'hand' }, { text: 'Carry on!' }],
          },
          what: { text: "Iron for Tobin, flour for Hollis, logs for everyone. Mostly logs. It's always logs.", options: [{ text: 'Sounds tiring.' }] },
          hand: { text: "Kind of you! Tell you what — if you find anything worth selling, Ilsa pays fair. Barrels around the village sometimes have odds and ends. Don't tell anyone I told you.", options: [{ text: 'My lips are sealed.' }] },
        },
      },
    },
    {
      id: 'moss', name: 'Moss the Herbalist', home: S.hutGarden, door: D.moss, social: true,
      style: { skin: '#c8a888', shirt: '#4a6a3a', pants: '#5a4a3a', hair: '#8a9a6a', robe: true, hat: '#3a5a2a' },
      barks: ['Bubble, bubble...', 'A pinch of moss... a dash of moss...', 'Ooh, a toadstool!'],
      thanks: 'Flowers! Marvellous. Into the cauldron they go! ...Oh. You meant as a gift. Even better.',
      tasks: [
        { w: 3, steps: [{ at: S.hutGarden, wander: 8, pose: 'kneel', dur: [5, 9] }] },
        { w: 2, steps: [{ at: S.cauldron, face: S.cauldron.clone().add(S.cauldron.clone().sub(S.hut).setY(0).normalize().multiplyScalar(-1.1)), pose: 'knead', dur: [8, 12], barks: ['Bubble, bubble...', 'Needs more newt.'] }] },
      ],
      script: {
        entry: () => (s.herbs === 'done' ? 'after' : s.herbs === 'active' ? (s.inv.mushrooms >= 4 ? 'turnin' : 'waiting') : 'hi'),
        nodes: {
          hi: {
            text: "A visitor! How rare. I'm Moss. I brew. Tonics, tinctures, the occasional explosion. I'm short on mushrooms for my Springheel Tonic.",
            options: [
              { text: 'I can gather some.', next: 'ok', act: () => { s.herbs = 'active'; s.toast('New task: Bring Moss 4 mushrooms'); } },
              { text: 'What does the tonic do?', next: 'what' },
              { text: 'Good luck with the explosions.' },
            ],
          },
          what: { text: "Makes your knees springy! You'll jump like a frog. A tall, confident frog.", options: [{ text: "I'll find mushrooms.", next: 'ok', act: () => { s.herbs = 'active'; s.toast('New task: Bring Moss 4 mushrooms'); } }] },
          ok: { text: 'Four red-capped ones. They grow around my hut and here and there in the woods. Look low!', options: [{ text: 'Will do.' }] },
          waiting: { text: () => `${s.inv.mushrooms} of 4 mushrooms. They like shade. And being found.`, options: [{ text: 'Back soon.' }] },
          turnin: {
            text: 'Splendid specimens! Give me a moment... *bubble* *fizz* *BANG* ...There!',
            options: [{ text: 'Here. (Give 4 🍄)', act: () => { take('mushrooms', 4); s.tonic = true; s.herbs = 'done'; s.toast('Received: Springheel Tonic (jump much higher!)'); } }],
          },
          after: { text: 'How are the knees? Springy? Excellent. Side effects may include confidence.', options: [{ text: 'Very springy.' }] },
        },
      },
    },
    {
      id: 'odo', name: 'Odo the Fisher', home: S.dockEnd, nightOwl: true,
      style: { skin: '#e0b090', shirt: '#b8a24a', pants: '#3c4f5e', hair: '#888', hat: '#d8c27a', beard: '#9a9a9a' },
      barks: ['Shh. Fish.', 'Any minute now...', '*yawn*'],
      thanks: 'Flowers. On a dock. Well I never. Thank you.',
      tasks: [
        { w: 5, steps: [{ at: S.dockEnd, face: S.dockFace, pose: 'fish', prop: 'rod', dur: [30, 60], barks: ['Shh.', 'Bite, you beauty...'] }] },
        { w: 1, steps: [{ at: S.dockEnd, face: S.dockFace, pose: 'sitGround', dur: [15, 25] }] },
        { night: true, steps: [{ at: S.dockEnd, face: S.dockFace, pose: 'fish', prop: 'rod', dur: [30, 60] }] },
      ],
      script: {
        entry: () => 'hi',
        nodes: {
          hi: {
            text: "Shh... you'll scare the fish. ...There's never any fish.",
            options: [
              { text: 'Then why fish?', next: 'why' },
              { text: 'Got a spare rod?', next: 'rod', show: () => !s.rod, act: () => { s.rod = true; s.toast('Received: Odo\'s spare fishing rod'); } },
              { text: 'Seen anything odd lately?', next: 'news', show: () => s.quest === 'active' },
              { text: 'Good luck.' },
            ],
          },
          why: { text: "Because it's quiet. A man needs a quiet place to think about nothing.", options: [{ text: 'Fair enough.' }] },
          rod: { text: "Here. It's seen better days. So have I. Fish off the end of the dock — Captain the cat will want a share.", options: [{ text: 'Thanks, Odo.' }] },
          news: { text: 'Night of the storm, lights went flying every which way. One came down beyond the trees, made the whole wood glow blue. Pretty.', options: [{ text: 'Thanks, Odo.' }] },
        },
      },
    },
    {
      id: 'sela', name: 'Sela the Hermit', home: S.hill, nightOwl: true,
      style: { skin: '#d8b090', shirt: '#4d6b5a', pants: '#3a3a2a', hair: '#cfcfcf', robe: true },
      barks: ['The wind is restless today.', 'Few climb this high.', 'Hm.'],
      thanks: 'Mountain flowers would have been better. But these will do. Thank you.',
      tasks: [
        { w: 2, steps: [{ at: S.hill, wander: 4, face: S.hillView, pose: 'look', dur: [10, 20] }] },
        { w: 1, steps: [{ at: S.hill, face: S.hillView, pose: 'sitGround', dur: [15, 30] }] },
        { night: true, steps: [{ at: S.hill, face: S.hillView, pose: 'sitGround', dur: [30, 60] }] },
      ],
      script: {
        entry: () => (s.quest === 'active' && !s.mapRevealed ? 'help' : 'hi'),
        nodes: {
          hi: {
            text: "Few climb this high. The wind told me you're a curious one.",
            options: [{ text: 'What do you do up here?', next: 'watch' }, { text: 'Goodbye.' }],
          },
          watch: {
            text: 'I watch. The clouds, the tides, the little lives below. The isle remembers things people forget.',
            options: [{ text: 'Like what?', next: 'lore' }, { text: 'I should go.' }],
          },
          lore: {
            text: 'Before the village there was a tower on the high peaks. The stones are gone now, but on clear nights the shards still sing to each other up there.',
            options: [{ text: 'Thank you, Sela.' }],
          },
          help: {
            text: 'You seek the fallen shards. I watched them fall — every one. Give me your map.',
            options: [{ text: '(Hand over your map)', next: 'marked', act: () => { s.mapRevealed = true; s.toast('Shard locations marked on your map'); } }],
          },
          marked: { text: 'There. I have marked where they lie. Go on — night comes whether you hurry or not.', options: [{ text: 'Thank you!' }] },
        },
      },
    },
  ];
}
