export const SHARDS_NEEDED = 5;

export type Item = 'apples' | 'berries' | 'mushrooms' | 'fish' | 'flowers' | 'logs';
export const ITEMS: Record<Item, { icon: string; one: string; many: string; price: number }> = {
  apples: { icon: '🍎', one: 'an apple', many: 'apples', price: 1 },
  berries: { icon: '🫐', one: 'some berries', many: 'berries', price: 1 },
  mushrooms: { icon: '🍄', one: 'a mushroom', many: 'mushrooms', price: 2 },
  fish: { icon: '🐟', one: 'a fish', many: 'fish', price: 3 },
  flowers: { icon: '🌼', one: 'a bunch of flowers', many: 'flowers', price: 1 },
  logs: { icon: '🪵', one: 'a log', many: 'logs', price: 1 },
};

type Q = 'none' | 'active' | 'done';

/** Global game/quest state. */
export const state = {
  shards: 0,
  quest: 'none' as Q,
  mapRevealed: false,
  pip: 'none' as 'none' | 'hiding' | 'found',
  pipHideRequested: false,
  boots: false,
  portrait: false,

  coins: 0,
  inv: { apples: 0, berries: 0, mushrooms: 0, fish: 0, flowers: 0, logs: 0 } as Record<Item, number>,
  rod: false,
  fancyHat: false,
  tonic: false,
  canDance: false,

  sheep: 'none' as Q,
  mittens: 'none' as Q,
  pie: 'none' as Q,
  herbs: 'none' as Q,
  wood: 'none' as Q,
  woodChopped: 0,
  sock: 'none' as 'none' | 'active' | 'found' | 'done',

  /** 0..1 day cycle: 0.25 sunrise, 0.5 noon, 0.75 sunset. */
  time: 0.3,
  /** A bard performance or festival everyone nearby joins. */
  party: null as null | { x: number; z: number; until: number },
  clock: 0,
  /** Gravity multiplier (the chaos director messes with this). */
  gravity: 1,

  onQuestDone: () => {},
  toast: (_msg: string) => {},
  changed: () => {},
};

export const isNight = () => state.time > 0.8 || state.time < 0.23;
/** Lantern festival in the plaza once the quest is done. */
export const isFestival = () => state.quest === 'done' && state.time > 0.74 && state.time < 0.86;

export function give(item: Item, n = 1) {
  state.inv[item] += n;
  state.changed();
}
export function take(item: Item, n = 1): boolean {
  if (state.inv[item] < n) return false;
  state.inv[item] -= n;
  state.changed();
  return true;
}
export function addCoins(n: number) {
  state.coins += n;
  state.changed();
}
