// Seeded randomness. Every musical decision draws from a stream keyed by
// (seed, purpose, position), so changing one layer's behaviour never shifts the
// random choices of another, and the same inputs always give the same music.

export type Rng = () => number;

/** 32-bit string/number hash (cyrb53-style mix folded to 32 bits). */
export function hash(...parts: (string | number)[]): number {
  let h1 = 0xdeadbeef ^ parts.length;
  let h2 = 0x41c6ce57;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ 0x9e37, 2246822507);
    h2 = Math.imul(h2 ^ 0x79b9, 3266489909);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** mulberry32 PRNG — small, fast, good enough for musical choices. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh deterministic stream for a given purpose. */
export const stream = (seed: number, ...key: (string | number)[]): Rng => mulberry32(hash(seed, ...key));

export const chance = (r: Rng, p: number) => r() < p;
export const between = (r: Rng, lo: number, hi: number) => lo + (hi - lo) * r();
export const intBetween = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
export function pick<T>(r: Rng, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)];
}
export function weighted<T>(r: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((s, [, w]) => s + Math.max(0, w), 0);
  if (total <= 0) return items[0][0];
  let x = r() * total;
  for (const [v, w] of items) {
    x -= Math.max(0, w);
    if (x < 0) return v;
  }
  return items[items.length - 1][0];
}
export function shuffle<T>(r: Rng, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 999999) + 1;
}
