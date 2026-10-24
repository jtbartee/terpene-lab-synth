// The sixteenth-note grid of one bar in any supported metre, and the small
// position helpers the groove, bass and melody builders share.

import { METER_GROUPS } from './theory';

export interface Grid {
  beats: number;
  /** sixteenth-note steps per bar */
  n: number;
  /** step of the first beat of each accent group (2+2, 3+2, 2+2+3 …) */
  groupStarts: number[];
  /** backbeat step inside each group (beat 2 of a two-beat group, beat 3 of a three-beat group) */
  backbeats: number[];
  quarters: number[];
  eighths: number[];
  /** the "and" of every beat */
  offbeats: number[];
  /** the "e" and "a" of every beat */
  sixteenths: number[];
  /** a half-bar point used for half-time backbeats */
  mid: number;
}

const gridCache = new Map<number, Grid>();

export function gridFor(beats: number): Grid {
  const hit = gridCache.get(beats);
  if (hit) return hit;
  const n = beats * 4;
  const groups = METER_GROUPS[beats] ?? [beats];
  const groupStarts: number[] = [];
  const backbeats: number[] = [];
  let acc = 0;
  for (const g of groups) {
    groupStarts.push(acc * 4);
    backbeats.push((acc + (g === 3 ? 2 : 1)) * 4);
    acc += g;
  }
  const range = (from: number, step: number) => { const o: number[] = []; for (let s = from; s < n; s += step) o.push(s); return o; };
  const g: Grid = {
    beats, n, groupStarts, backbeats,
    quarters: range(0, 4), eighths: range(0, 2), offbeats: range(2, 4), sixteenths: range(1, 2),
    mid: groupStarts[1] ?? Math.round(n / 8) * 4,
  };
  gridCache.set(beats, g);
  return g;
}

/** Repeats a pattern written for one 4/4 bar (16 steps) across a bar of n steps. */
export function tile(steps16: number[], n: number): number[] {
  const out: number[] = [];
  for (let base = 0; base < n; base += 16) for (const s of steps16) if (base + s < n) out.push(base + s);
  return out;
}

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
