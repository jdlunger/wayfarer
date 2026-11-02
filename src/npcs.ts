import * as THREE from 'three';
import { Character, CharStyle } from './character';
import { DScript } from './dialogue';
import { groundHeight, groundNormalY, WATER_Y } from './terrain';
import { resolve } from './colliders';

export const SHARDS_NEEDED = 5;

/** Global game/quest state. */
export const state = {
  shards: 0,
  quest: 'none' as 'none' | 'active' | 'done',
  mapRevealed: false,
  pip: 'none' as 'none' | 'hiding' | 'found',
  pipHideRequested: false,
  boots: false,
  portrait: false,
  onQuestDone: () => {},
  toast: (_msg: string) => {},
};

export interface NPCDef {
  id: string;
  name: string;
  style: CharStyle;
  home: THREE.Vector3;
  wander: number;
  barks: string[];
  script: DScript;
}

type Mode = 'idle' | 'walk' | 'talk' | 'flee';

export class NPC {
  readonly char: Character;
  readonly pos: THREE.Vector3;
  yaw = Math.random() * Math.PI * 2;
  mode: Mode = 'idle';
  private timer = Math.random() * 3;
  private target = new THREE.Vector3();
  private speed = 0;
  private barkTimer = 0;
  private barkCooldown = 0;
  hidden = false;
  readonly label: HTMLDivElement;
  private bubble: HTMLDivElement;

  constructor(readonly def: NPCDef, scene: THREE.Scene, labels: HTMLElement) {
    this.char = new Character(def.style);
    this.pos = def.home.clone();
    this.pos.y = groundHeight(this.pos.x, this.pos.z);
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

  bark(text?: string) {
    const lines = this.def.barks;
    this.bubble.textContent = text ?? lines[(Math.random() * lines.length) | 0];
    this.label.classList.add('barking');
    this.barkTimer = 3.5;
    this.barkCooldown = 25 + Math.random() * 20;
  }

  /** Run away from `from` for a few seconds (used by Pip's hide-and-seek). */
  flee(from: THREE.Vector3) {
    this.mode = 'flee';
    this.timer = 2.5;
    this.target.copy(this.pos).sub(from).setY(0).normalize().multiplyScalar(40).add(this.pos);
  }

  teleport(p: THREE.Vector3) {
    this.pos.set(p.x, groundHeight(p.x, p.z), p.z);
    this.mode = 'idle';
    this.timer = 2;
  }

  update(dt: number, player: THREE.Vector3, talkingToMe: boolean) {
    const toPlayer = Math.hypot(player.x - this.pos.x, player.z - this.pos.z);
    let desiredYaw = this.yaw;
    this.speed = 0;

    if (this.barkTimer > 0 && (this.barkTimer -= dt) <= 0) this.label.classList.remove('barking');
    this.barkCooldown -= dt;

    if (talkingToMe) {
      this.mode = 'talk';
    } else if (this.mode === 'talk') {
      this.mode = 'idle';
      this.timer = 2;
    }

    if (this.mode === 'flee') {
      this.timer -= dt;
      this.speed = 7.5;
      desiredYaw = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);
      if (this.timer <= 0) { this.mode = 'idle'; this.hidden = true; }
    } else if (this.mode === 'talk' || (toPlayer < 4 && this.mode !== 'walk') || (toPlayer < 2.5)) {
      // Turn toward the player when they're close.
      desiredYaw = Math.atan2(player.x - this.pos.x, player.z - this.pos.z);
      if (this.mode === 'walk') { this.mode = 'idle'; this.timer = 2; }
      if (toPlayer < 6 && this.barkCooldown <= 0 && this.mode !== 'talk') this.bark();
    } else if (this.mode === 'idle') {
      this.timer -= dt;
      if (this.def.wander === 0) desiredYaw = Math.atan2(this.def.home.x, this.def.home.z); // gaze out to sea
      if (this.timer <= 0 && this.def.wander > 0) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * this.def.wander;
        const tx = this.def.home.x + Math.cos(a) * r, tz = this.def.home.z + Math.sin(a) * r;
        if (groundHeight(tx, tz) > WATER_Y + 0.4 && groundNormalY(tx, tz) > 0.8) {
          this.target.set(tx, 0, tz);
          this.mode = 'walk';
          this.timer = 12;
        } else this.timer = 1;
      }
    } else if (this.mode === 'walk') {
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
      this.timer -= dt;
      if (Math.hypot(dx, dz) < 0.5 || this.timer <= 0) {
        this.mode = 'idle';
        this.timer = 3 + Math.random() * 6;
      } else {
        desiredYaw = Math.atan2(dx, dz);
        this.speed = 1.8;
      }
    }

    // Turn smoothly toward desired yaw
    let dy = desiredYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * 6);

    if (this.speed > 0) {
      const step = this.speed * dt;
      const nx = this.pos.x + Math.sin(this.yaw) * step, nz = this.pos.z + Math.cos(this.yaw) * step;
      if (groundHeight(nx, nz) > WATER_Y + 0.3) { this.pos.x = nx; this.pos.z = nz; }
      else if (this.mode === 'walk') { this.mode = 'idle'; this.timer = 1; }
      if (resolve(this.pos, 0.35) && this.mode === 'walk' && Math.random() < dt * 2) { this.mode = 'idle'; this.timer = 1; }
    }
    this.pos.y = groundHeight(this.pos.x, this.pos.z);
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.yaw;
    this.char.animate(dt, this.speed, false);
    this.char.nod(this.mode === 'talk' ? Math.sin(performance.now() * 0.006) * 0.08 : 0);
    this.char.setGroundOffset(0);
  }
}

const RUMORS = [
  'They say the hermit on the hill talks to clouds. They say the clouds answer.',
  'Odo once caught a fish. Nobody believes him, including Odo.',
  'Some nights you can hear singing from the high peaks. Probably wind. Probably.',
  'Pip claims he can hide anywhere. He hid in my cheese crate once. I sold the crate.',
];

export function makeNPCDefs(spots: Record<string, THREE.Vector3>): NPCDef[] {
  const s = state;
  return [
    {
      id: 'maren', name: 'Elder Maren', home: spots.well, wander: 5,
      style: { skin: '#e2b896', shirt: '#6a4c8c', pants: '#4a3560', hair: '#e8e8e8', robe: true },
      barks: ['The lanterns have been dark three nights now...', 'Welcome, traveler.', 'Mind the well, it is deeper than it looks.'],
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
            text: `Bless you. ${SHARDS_NEEDED} should be enough to relight the plaza. Sela the hermit sees much from her hill — she may know where they fell.`,
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
            text: 'Watch the plaza when night falls, friend. Thistlewick owes you. Tobin wanted to meet whoever helped — you will find him at the forge.',
            options: [{ text: 'Glad to help.' }],
          },
          after: {
            text: 'The lanterns burn bright thanks to you. Stay as long as you like.',
            options: [{ text: 'Thank you, Elder.' }],
          },
        },
      },
    },
    {
      id: 'tobin', name: 'Tobin the Smith', home: spots.forge, wander: 2,
      style: { skin: '#c68e64', shirt: '#7a4b2a', pants: '#3b3330', hair: '#2b1d14', beard: '#2b1d14', scale: 1.08 },
      barks: ['*clang* *clang*', 'Hot work, this.', 'Need a hinge? I have hinges.'],
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
      id: 'pip', name: 'Pip', home: spots.well.clone().add(new THREE.Vector3(-6, 0, -5)), wander: 12,
      style: { skin: '#f0c8a0', shirt: '#3f8fc0', pants: '#6b5a3a', hair: '#d0742a', scale: 0.72 },
      barks: ['Tag! You\'re it!', 'Bet you can\'t find me!', 'I\'m not bored. You\'re bored.'],
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
          go: { text: 'Count to... uh, however long! No peeking! I\'ll be somewhere outside the village!', options: [{ text: '(Start counting)' }] },
          found: {
            text: 'Aww, you found me! Okay, okay, you\'re good. Here — I found this shiny rock while I was hiding.',
            options: [{ text: 'A glowshard!', act: () => { s.pip = 'found'; s.shards++; s.toast('Received a glowshard from Pip'); } }],
          },
          after: { text: 'Best. Seeker. Ever. Wanna know a secret? Brann is scared of frogs.', options: [{ text: "I'll keep it quiet." }] },
        },
      },
    },
    {
      id: 'ilsa', name: 'Ilsa the Merchant', home: spots.stall, wander: 1.5,
      style: { skin: '#a9714b', shirt: '#2f7a5c', pants: '#523b2a', hair: '#151010', hat: '#c0463a' },
      barks: ['Finest wares on the isle!', 'Cheese! Rope! Questionable art!', 'Everything must go. Especially the portrait.'],
      script: {
        entry: () => 'hi',
        nodes: {
          hi: {
            text: 'Finest wares on the isle! ...Only wares on the isle, but still.',
            options: [
              { text: 'What do you sell?', next: 'sell' },
              { text: 'Heard any rumors?', next: 'rumor' },
              { text: 'Just browsing.' },
            ],
          },
          sell: {
            text: 'Cheese, rope, a lute missing two strings, and a portrait of my cousin. Make an offer.',
            options: [
              { text: "I'll take the portrait.", next: 'portrait', show: () => !s.portrait },
              { text: 'Maybe later.' },
            ],
          },
          portrait: {
            text: 'Ha! Nobody ever does. Keep it — free of charge. Please.',
            options: [{ text: '...Thanks?', act: () => { s.portrait = true; s.toast('Received: Portrait of Ilsa\'s Cousin'); } }],
          },
          rumor: { text: () => RUMORS[(Math.random() * RUMORS.length) | 0], options: [{ text: 'Another?', next: 'rumor' }, { text: 'Interesting.' }] },
        },
      },
    },
    {
      id: 'brann', name: 'Guard Brann', home: spots.gate, wander: 8,
      style: { skin: '#d9a77f', shirt: '#7d8590', pants: '#3b4250', hair: '#6b4a2a', hat: '#5a616b', beard: '#6b4a2a' },
      barks: ['All quiet.', 'Halt! ...Oh, it\'s you.', 'Did something just croak?'],
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
            text: "Elder Maren is by the well. Tobin's at his forge and Ilsa runs the stall. Odo fishes down on the shore, and old Sela lives alone up in the hills.",
            options: [{ text: 'Thanks.' }],
          },
        },
      },
    },
  ];
}

export function makeOutskirtsDefs(shore: THREE.Vector3, hill: THREE.Vector3): NPCDef[] {
  const s = state;
  return [
    {
      id: 'odo', name: 'Odo the Fisher', home: shore, wander: 0,
      style: { skin: '#e0b090', shirt: '#b8a24a', pants: '#3c4f5e', hair: '#888', hat: '#d8c27a', beard: '#9a9a9a' },
      barks: ['Shh. Fish.', 'Any minute now...', '*yawn*'],
      script: {
        entry: () => 'hi',
        nodes: {
          hi: {
            text: "Shh... you'll scare the fish. ...There's never any fish.",
            options: [
              { text: 'Then why fish?', next: 'why' },
              { text: 'Seen anything odd lately?', next: 'news', show: () => s.quest === 'active' },
              { text: 'Good luck.' },
            ],
          },
          why: { text: "Because it's quiet. A man needs a quiet place to think about nothing.", options: [{ text: 'Fair enough.' }] },
          news: { text: 'Night of the storm, lights went flying every which way. One came down beyond the trees, made the whole wood glow blue. Pretty.', options: [{ text: 'Thanks, Odo.' }] },
        },
      },
    },
    {
      id: 'sela', name: 'Sela the Hermit', home: hill, wander: 6,
      style: { skin: '#d8b090', shirt: '#4d6b5a', pants: '#3a3a2a', hair: '#cfcfcf', robe: true },
      barks: ['The wind is restless today.', 'Few climb this high.', 'Hm.'],
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
