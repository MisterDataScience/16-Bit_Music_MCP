import { createHash } from 'node:crypto';

export const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Independent labelled streams mean changing drums cannot change a melody. */
export function random(seed: number, label: string) {
  let state = Number.parseInt(hash([seed, label]).slice(0, 8), 16) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (probability: number) => next() < probability
  };
}
