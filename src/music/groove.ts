// Groove families. Each drum kit has a small library of musically meaningful
// groove archetypes that share the style's identity (motorik keeps its kick on
// one and its driving eighth pulse; dub techno keeps four on the floor) but
// differ in kick placement, backbeat, hat subdivision, ghost notes, accents,
// fills and feel. A composition picks one archetype as its main groove, keeps it
// long enough to establish repetition, and develops it with variation
// operators instead of re-rolling drum hits every bar.
//
// Optional hits ("detail" and "ghost") sit at fixed, seeded positions with a
// fixed threshold, so turning up rhythmic detail fills in the *same* places —
// the groove grows denser without losing its shape.

import { chance, intBetween, pick, shuffle, weighted, type Rng } from './rng';
import type { DrumKit } from './styles';
import { tile, type Grid } from './grid';

export type DrumVoice = 'kick' | 'snare' | 'clap' | 'hatC' | 'hatO';
export const DRUM_VOICES: DrumVoice[] = ['kick', 'snare', 'clap', 'hatC', 'hatO'];
export type HitKind = 'core' | 'detail' | 'ghost';
export interface Hit {
  s: number;
  v: number;
  k: HitKind;
  /** detail/ghost hits play when the matching control reaches this threshold */
  t: number;
  dur?: number;
  /** fixed micro-timing offset in beats (positive = late) */
  micro?: number;
}
export type Lanes = Record<DrumVoice, Hit[]>;
export type FillKind = 'snareRoll' | 'openHat' | 'kickDrop' | 'stutter' | 'tom' | 'clapFlam' | 'none';
export interface PercPattern { k: number; len: number; rot: number }

export interface Groove {
  id: string;
  archetype: string;
  /** e.g. "Syncopated motorik" */
  label: string;
  /** variation operators applied to the archetype, in order */
  ops: GrooveOp[];
  /** a one- or two-bar cycle */
  bars: Lanes[];
  fill: FillKind;
  /** added to the user's swing */
  swing: number;
  /** per-voice lay-back in beats */
  lag: Partial<Record<DrumVoice, number>>;
  perc: PercPattern | null;
  halfTime: boolean;
}

// ------------------------------------------------------------ bar builder

class Bar {
  l: Lanes = { kick: [], snare: [], clap: [], hatC: [], hatO: [] };
  constructor(private n: number, private r: Rng) {}
  add(voice: DrumVoice, s: number, v: number, k: HitKind = 'core', dur?: number, micro?: number) {
    if (s < 0 || s >= this.n || !Number.isInteger(s)) return this;
    const lane = this.l[voice];
    const hit: Hit = { s, v, k, t: k === 'core' ? 0 : Math.round((0.12 + 0.72 * this.r()) * 100) / 100 };
    if (dur != null) hit.dur = dur;
    if (micro) hit.micro = micro;
    const i = lane.findIndex((h) => h.s === s);
    if (i >= 0) lane[i] = hit; else lane.push(hit);
    return this;
  }
  del(voice: DrumVoice, s: number) { this.l[voice] = this.l[voice].filter((h) => h.s !== s); return this; }
  clone() { const b = new Bar(this.n, this.r); b.l = cloneLanes(this.l); return b; }
}

export function cloneLanes(l: Lanes): Lanes {
  return { kick: l.kick.map((h) => ({ ...h })), snare: l.snare.map((h) => ({ ...h })), clap: l.clap.map((h) => ({ ...h })), hatC: l.hatC.map((h) => ({ ...h })), hatO: l.hatO.map((h) => ({ ...h })) };
}

const hats8 = (b: Bar, g: Grid, on: number, off: number, voice: DrumVoice = 'hatC', dur = 0.12) => {
  for (const s of g.eighths) b.add(voice, s, s % 4 === 0 ? on : off, 'core', dur);
};
const detail16 = (b: Bar, g: Grid, r: Rng, count: number, v: number, voice: DrumVoice = 'hatC', dur = 0.08) => {
  for (const s of shuffle(r, g.sixteenths).slice(0, count)) b.add(voice, s, v, 'detail', dur);
};
const ghosts = (b: Bar, g: Grid, r: Rng, count: number, v = 0.28) => {
  const cands = [...new Set(g.backbeats.flatMap((bb) => [bb - 1, bb + 3]).filter((s) => s > 0 && s < g.n))];
  for (const s of shuffle(r, cands).slice(0, count)) b.add('snare', s, v, 'ghost');
};
/** Syncopated sixteenth positions away from beats, backbeats and each other. */
const syncopations = (g: Grid, r: Rng, count: number, avoid: number[] = []) => {
  const out: number[] = [];
  for (const s of shuffle(r, Array.from({ length: g.n }, (_, i) => i).filter((s) => s % 4 >= 2 && !g.backbeats.includes(s)))) {
    if (out.length >= count) break;
    if ([...out, ...avoid].some((o) => Math.abs(o - s) < 2)) continue;
    out.push(s);
  }
  return out.sort((a, b) => a - b);
};

interface Spec { bars: Lanes[]; fill: FillKind; swing?: number; lag?: Partial<Record<DrumVoice, number>>; perc?: PercPattern | null; halfTime?: boolean }
interface Archetype { id: string; label: string; w: number; canonical?: boolean; build: (g: Grid, r: Rng) => Spec }

// ------------------------------------------------------------ families

const MOTORIK: Archetype[] = [
  {
    id: 'straight', label: 'Straight driving motorik', w: 3, canonical: true,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.groupStarts) a.add('kick', s, 0.95);
      a.add('kick', pick(r, [g.mid - 2, g.mid + 2]), 0.8);
      for (const s of g.backbeats) a.add('snare', s, 0.88);
      hats8(a, g, 0.62, 0.48);
      detail16(a, g, r, 3, 0.3);
      ghosts(a, g, r, 2);
      const b = a.clone().del('hatC', g.n - 2).add('hatO', g.n - 2, 0.5, 'core', 0.4);
      return { bars: [a.l, b.l], fill: pick(r, ['snareRoll', 'openHat', 'kickDrop'] as const) };
    },
  },
  {
    id: 'sparse', label: 'Sparse motorik', w: 1.4,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.groupStarts) a.add('kick', s, 0.86);
      a.add('snare', g.backbeats[g.backbeats.length - 1], 0.72);
      if (g.backbeats.length > 1) a.add('snare', g.backbeats[0], 0.3, 'ghost');
      for (const s of g.offbeats) a.add('hatC', s, 0.46, 'core', 0.12);
      for (const s of g.quarters) a.add('hatC', s, 0.24, 'detail', 0.08);
      const b = a.clone().del('hatC', g.n - 2).add('hatO', g.n - 2, 0.42, 'core', 0.5);
      return { bars: [a.l, b.l], fill: pick(r, ['kickDrop', 'none', 'openHat'] as const) };
    },
  },
  {
    id: 'syncopated', label: 'Syncopated motorik', w: 1.6,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.groupStarts) a.add('kick', s, 0.95);
      const sync = syncopations(g, r, 2, g.groupStarts);
      for (const s of sync) a.add('kick', s, 0.74);
      for (const s of g.backbeats) a.add('snare', s, 0.88);
      ghosts(a, g, r, 2, 0.3);
      // 3+3+2 hat accents over the sixteenth grid
      const acc = new Set(tile([0, 3, 6, 8, 11, 14], g.n));
      for (const s of g.eighths) a.add('hatC', s, acc.has(s) ? 0.6 : 0.4, 'core', 0.1);
      for (const s of acc) if (s % 2) a.add('hatC', s, 0.5, 'core', 0.08);
      detail16(a, g, r, 2, 0.24);
      const b = a.clone();
      const moved = sync[sync.length - 1];
      if (moved != null) { b.del('kick', moved); b.add('kick', Math.min(g.n - 1, moved + 1), 0.7); }
      b.add('hatO', g.n - 2, 0.48, 'core', 0.35);
      return { bars: [a.l, b.l], fill: pick(r, ['stutter', 'snareRoll'] as const) };
    },
  },
  {
    id: 'halftime', label: 'Half-time atmospheric motorik', w: 1,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      a.add('kick', 0, 0.92);
      a.add('kick', pick(r, [g.mid + 2, g.mid + 3]), 0.66);
      if (g.mid > 0) a.add('snare', g.mid, 0.86);
      hats8(a, g, 0.46, 0.34);
      detail16(a, g, r, 2, 0.2);
      const b = a.clone().add('kick', g.n - 2, 0.55);
      return { bars: [a.l, b.l], fill: 'kickDrop', lag: { snare: 0.015 }, halfTime: true };
    },
  },
  {
    id: 'bassDriven', label: 'Bass-driven motorik', w: 1.2,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, s === 0 ? 0.86 : 0.74);
      for (const s of g.backbeats) a.add('snare', s, 0.52);
      for (const s of g.offbeats) a.add('hatC', s, 0.42, 'core', 0.1);
      detail16(a, g, r, 2, 0.18);
      return { bars: [a.l], fill: pick(r, ['openHat', 'none'] as const) };
    },
  },
  {
    id: 'percussive', label: 'Percussion-heavy motorik', w: 1.1,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.groupStarts) a.add('kick', s, 0.95);
      a.add('kick', g.mid - 2, 0.78);
      for (const s of g.backbeats) a.add('snare', s, 0.86);
      a.add('clap', g.backbeats[g.backbeats.length - 1], 0.5);
      for (const s of g.eighths) a.add('hatO', s, s % 4 === 0 ? 0.3 : 0.36, 'core', 0.08); // tambourine
      for (const s of g.sixteenths) a.add('hatO', s, 0.22, 'detail', 0.06);
      return { bars: [a.l], fill: 'tom', perc: { k: pick(r, [5, 7]), len: 16, rot: intBetween(r, 0, 3) } };
    },
  },
  {
    id: 'pulse', label: 'Minimal motorik pulse', w: 0.9,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, s === 0 ? 0.7 : 0.58);
      hats8(a, g, 0.32, 0.28);
      const b = a.clone().add('snare', g.backbeats[g.backbeats.length - 1], 0.62).del('hatC', g.n - 2).add('hatO', g.n - 2, 0.45, 'core', 0.45);
      return { bars: [a.l, b.l], fill: pick(r, ['none', 'openHat'] as const) };
    },
  },
];

const KRAUTPOP: Archetype[] = [
  {
    id: 'tambourine', label: 'Motorik with tambourine', w: 3, canonical: true,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.groupStarts) a.add('kick', s, 0.95);
      a.add('kick', g.mid - 2, 0.8);
      for (const s of g.backbeats) a.add('snare', s, 0.88);
      hats8(a, g, 0.6, 0.46);
      for (const s of g.sixteenths) a.add('hatO', s, 0.32, 'detail', 0.08);
      ghosts(a, g, r, 1);
      return { bars: [a.l], fill: pick(r, ['snareRoll', 'openHat'] as const) };
    },
  },
  {
    id: 'bossa', label: 'Lounge bossa pulse', w: 1.3,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of [...g.groupStarts, ...tile([6, 8, 14], g.n)]) a.add('kick', s, s === 0 ? 0.88 : 0.7);
      hats8(a, g, 0.42, 0.36);
      const b = a.clone();
      for (const s of tile([0, 6, 12], g.n)) a.add('clap', s, 0.34, 'core', 0.05); // son clave, three side
      for (const s of tile([4, 8], g.n)) b.add('clap', s, 0.34, 'core', 0.05);      // two side
      return { bars: [a.l, b.l], fill: 'clapFlam' };
    },
  },
  {
    id: 'disco', label: 'Four-on-the-floor vamp', w: 1.2,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, 0.86);
      for (const s of g.backbeats) a.add('clap', s, 0.66);
      for (const s of g.offbeats) a.add('hatO', s, 0.4, 'core', 0.2);
      detail16(a, g, r, 4, 0.2);
      return { bars: [a.l], fill: pick(r, ['openHat', 'snareRoll'] as const) };
    },
  },
  {
    id: 'shuffle', label: 'Shuffled krautpop', w: 1,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.groupStarts) a.add('kick', s, 0.92);
      a.add('kick', g.mid + 2, 0.7);
      for (const s of g.backbeats) a.add('snare', s, 0.84);
      hats8(a, g, 0.55, 0.42);
      ghosts(a, g, r, 2, 0.26);
      return { bars: [a.l], fill: 'stutter', swing: 0.3 };
    },
  },
  {
    id: 'halftime', label: 'Half-time krautpop', w: 0.8,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      a.add('kick', 0, 0.9);
      for (const s of syncopations(g, r, 2, [0, g.mid])) a.add('kick', s, 0.66);
      if (g.mid > 0) a.add('snare', g.mid, 0.86);
      hats8(a, g, 0.48, 0.36);
      for (const s of g.sixteenths) a.add('hatO', s, 0.24, 'detail', 0.06);
      return { bars: [a.l], fill: 'kickDrop', halfTime: true, lag: { snare: 0.012 } };
    },
  },
];

const DUB: Archetype[] = [
  {
    id: 'classic', label: 'Classic dub techno', w: 3, canonical: true,
    build: (g, r) => {
      // the open "tss" on every off-beat, a soft shaker underneath, claps lagging behind the beat
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, 0.82);
      for (const s of g.offbeats) a.add('hatO', s, 0.42, 'core', 0.22);
      for (const s of g.backbeats) a.add('clap', s, 0.42);
      detail16(a, g, r, 4, 0.2, 'hatC', 0.06);
      return { bars: [a.l], fill: 'none', lag: { clap: 0.02 } };
    },
  },
  {
    id: 'tribal', label: 'Hand-percussion dub', w: 1,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, 0.78);
      for (const s of g.eighths) a.add('hatC', s, s % 4 === 2 ? 0.34 : 0.18, 'core', 0.05);
      for (const s of g.sixteenths) a.add('hatC', s, 0.14, 'detail', 0.04);
      return { bars: [a.l], fill: 'tom', perc: { k: pick(r, [5, 7]), len: 16, rot: intBetween(r, 0, 7) } };
    },
  },
  {
    id: 'deep', label: 'Deep minimal dub', w: 1.5,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, 0.8);
      for (const s of g.offbeats) a.add('hatC', s, 0.42, 'core', 0.14);
      for (const s of g.sixteenths.filter((s) => s % 4 === 3)) a.add('hatC', s, 0.16, 'detail', 0.05);
      const b = a.clone().add('clap', g.backbeats[g.backbeats.length - 1], 0.36);
      return { bars: [a.l, b.l], fill: 'none', lag: { clap: 0.025, hatC: 0.008 } };
    },
  },
  {
    id: 'shuffled', label: 'Shuffled shaker dub', w: 1.2,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, 0.8);
      for (const s of g.offbeats) a.add('hatC', s, 0.45, 'core', 0.1);
      for (const s of g.sixteenths) a.add('hatC', s, 0.18, 'detail', 0.05);
      a.add('clap', g.backbeats[g.backbeats.length - 1], 0.4);
      return { bars: [a.l], fill: 'none', swing: 0.26, lag: { clap: 0.03 } };
    },
  },
  {
    id: 'steppers', label: 'Steppers with rim shots', w: 1.1,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, 0.8);
      for (const s of g.offbeats) a.add('hatC', s, 0.44, 'core', 0.14);
      for (const s of tile(pick(r, [[3, 10], [6, 11], [3, 14]]), g.n)) a.add('clap', s, 0.3, 'core', 0.05);
      detail16(a, g, r, 2, 0.16);
      return { bars: [a.l], fill: 'clapFlam' };
    },
  },
  {
    id: 'stripped', label: 'Stripped kick and hat', w: 0.9,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, 0.76);
      for (const s of g.offbeats) a.add('hatC', s, 0.4, 'core', 0.16);
      return { bars: [a.l], fill: 'none' };
    },
  },
  {
    id: 'rolling', label: 'Rolling 3-3-2 dub', w: 1,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, 0.82);
      const acc = new Set(tile([0, 3, 6, 8, 11, 14], g.n));
      for (let s = 0; s < g.n; s++) {
        if (acc.has(s)) a.add('hatC', s, 0.42, 'core', 0.07);
        else if (s % 2) a.add('hatC', s, 0.18, 'detail', 0.05);
      }
      for (const s of g.backbeats) a.add('clap', s, 0.42);
      return { bars: [a.l], fill: 'none', lag: { clap: 0.015 } };
    },
  },
];

const BERLIN: Archetype[] = [
  {
    id: 'pulse', label: 'Sequencer pulse', w: 3, canonical: true,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      a.add('kick', 0, 0.85);
      if (g.groupStarts[1] != null) a.add('kick', g.groupStarts[1], 0.66);
      for (let s = 0; s < g.n; s++) a.add('hatC', s, s % 4 === 0 ? 0.4 : 0.24, s % 2 ? 'detail' : 'core', 0.06);
      a.add('clap', g.backbeats[g.backbeats.length - 1], 0.55);
      return { bars: [a.l], fill: pick(r, ['snareRoll', 'none'] as const) };
    },
  },
  {
    id: 'euclid', label: 'Euclidean tom pulse', w: 1.4,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      a.add('kick', 0, 0.82);
      hats8(a, g, 0.3, 0.24, 'hatC', 0.06);
      return { bars: [a.l], fill: 'tom', perc: { k: pick(r, [5, 7]), len: 16, rot: intBetween(r, 0, 5) } };
    },
  },
  {
    id: 'driving', label: 'Driving electronic', w: 1.1,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, 0.72);
      for (const s of g.offbeats) a.add('hatC', s, 0.4, 'core', 0.08);
      for (const s of g.backbeats) a.add('snare', s, 0.5);
      detail16(a, g, r, 3, 0.2);
      return { bars: [a.l], fill: pick(r, ['snareRoll', 'stutter'] as const) };
    },
  },
  {
    id: 'threeFour', label: 'Three-against-four accents', w: 1,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      a.add('kick', 0, 0.84);
      a.add('kick', g.mid + 2, 0.62);
      for (let s = 0; s < g.n; s++) {
        if (s % 3 === 0) a.add('hatC', s, 0.42, 'core', 0.06);
        else if (s % 2 === 0) a.add('hatC', s, 0.2, 'detail', 0.05);
      }
      a.add('clap', g.backbeats[g.backbeats.length - 1], 0.5);
      return { bars: [a.l], fill: 'stutter' };
    },
  },
  {
    id: 'minimal', label: 'Minimal shaker', w: 0.8,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.eighths) a.add('hatC', s, s % 4 === 0 ? 0.26 : 0.2, 'core', 0.05);
      for (const s of g.sixteenths) a.add('hatC', s, 0.14, 'detail', 0.04);
      const b = a.clone();
      a.add('kick', 0, 0.78);
      return { bars: [a.l, b.l], fill: 'none' };
    },
  },
];

const PULSE: Archetype[] = [
  {
    id: 'heartbeat', label: 'Heartbeat pulse', w: 3, canonical: true,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      a.add('kick', 0, 0.6, 'core', 0.5);
      a.add('kick', 3, 0.4, 'core', 0.5);
      return { bars: [a.l], fill: 'none' };
    },
  },
  {
    id: 'slow', label: 'Slow half-bar pulse', w: 1.3,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      a.add('kick', 0, 0.6, 'core', 0.5);
      if (g.mid > 0) a.add('kick', g.mid, 0.4, 'core', 0.5);
      for (const s of g.offbeats) a.add('hatC', s, 0.16, 'detail', 0.2);
      return { bars: [a.l], fill: 'none' };
    },
  },
  {
    id: 'brushes', label: 'Brushed sixteenths', w: 1.1,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (let s = 0; s < g.n; s++) a.add('hatC', s, s % 4 === 0 ? 0.2 : 0.12, s % 2 ? 'detail' : 'core', 0.12);
      const b = a.clone();
      a.add('kick', 0, 0.5, 'core', 0.5);
      return { bars: [a.l, b.l], fill: 'none' };
    },
  },
  {
    id: 'tom', label: 'Distant tom pulse', w: 1,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      a.add('kick', 0, 0.55, 'core', 0.5);
      return { bars: [a.l], fill: 'tom', perc: { k: 3, len: 8, rot: intBetween(r, 0, 2) } };
    },
  },
];

const MICRO: Archetype[] = [
  {
    id: 'click', label: 'Clicky microhouse', w: 3, canonical: true,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, 0.7, 'core', 0.2);
      for (const s of g.offbeats) a.add('hatC', s, 0.36, 'core', 0.05, Math.round((r() - 0.5) * 60) / 1000);
      const b = a.clone().add('clap', g.backbeats[g.backbeats.length - 1], 0.35, 'core', 0.1);
      return { bars: [a.l, b.l], fill: 'none' };
    },
  },
  {
    id: 'shuffle', label: 'Shuffled microhouse', w: 1.4,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, 0.7, 'core', 0.2);
      for (const s of g.offbeats) a.add('hatC', s, 0.36, 'core', 0.05);
      for (const s of g.sixteenths) a.add('hatC', s, 0.16, 'detail', 0.04);
      for (const s of g.backbeats) a.add('clap', s, 0.32, 'core', 0.1);
      return { bars: [a.l], fill: 'none', swing: 0.22 };
    },
  },
  {
    id: 'skippy', label: 'Skippy kick', w: 1.2,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, 0.7, 'core', 0.2);
      a.add('kick', pick(r, [g.mid + 3, g.mid - 1]), 0.5, 'core', 0.15);
      for (const s of g.offbeats) a.add('hatC', s, 0.34, 'core', 0.05);
      a.add('clap', g.n - 2, 0.3, 'core', 0.1);
      return { bars: [a.l], fill: 'none' };
    },
  },
  {
    id: 'minimal', label: 'Bare minimal', w: 1,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, 0.65, 'core', 0.2);
      for (const s of g.offbeats) a.add('hatC', s, 0.28, 'core', 0.05);
      return { bars: [a.l], fill: 'none' };
    },
  },
  {
    id: 'akufen', label: 'Cut-up off-grid clicks', w: 1,
    build: (g, r) => {
      const a = new Bar(g.n, r);
      for (const s of g.quarters) a.add('kick', s, 0.68, 'core', 0.2);
      for (const s of g.offbeats) a.add('hatC', s, 0.32, 'core', 0.05);
      for (const s of shuffle(r, g.sixteenths).slice(0, 2)) a.add('clap', s, 0.3, 'core', 0.05);
      for (const s of shuffle(r, g.sixteenths).slice(0, 4)) a.add('hatC', s, 0.15, 'detail', 0.04);
      return { bars: [a.l], fill: 'clapFlam' };
    },
  },
];

export const GROOVE_FAMILIES: Record<DrumKit, Archetype[]> = {
  motorik: MOTORIK, krautpop: KRAUTPOP, dub: DUB, berlin: BERLIN, pulse: PULSE, micro: MICRO, none: [],
};

// ------------------------------------------------------------ public API

function finish(a: Archetype, spec: Spec): Groove {
  return {
    id: a.id, archetype: a.id, label: a.label, ops: [], bars: spec.bars, fill: spec.fill,
    swing: spec.swing ?? 0, lag: spec.lag ?? {}, perc: spec.perc ?? null, halfTime: spec.halfTime ?? false,
  };
}

/**
 * Picks and builds a groove. Groove diversity 0 always uses the style's
 * canonical archetype; 0.5 weighs every archetype by its musical prior; 1
 * flattens the priors so rarer grooves come up as often as the canonical one.
 */
export function makeGroove(kit: DrumKit, g: Grid, r: Rng, diversity: number, exclude?: string): Groove | null {
  const fam = GROOVE_FAMILIES[kit].filter((a) => a.id !== exclude);
  if (!fam.length) return null;
  const items = fam.map((a) => {
    const prior = Math.pow(a.w, 1 - diversity);
    return [a, a.canonical ? prior : prior * Math.min(1, diversity * 2)] as const;
  });
  const a = items.some(([, w]) => w > 0) ? weighted(r, items) : fam[0];
  return finish(a, a.build(g, r));
}

export function grooveByArchetype(kit: DrumKit, id: string, g: Grid, r: Rng): Groove | null {
  const a = GROOVE_FAMILIES[kit].find((x) => x.id === id);
  return a ? finish(a, a.build(g, r)) : null;
}

export type GrooveOp = 'thin' | 'busy' | 'accent' | 'kick' | 'openhat' | 'half' | 'perc' | 'answer';
export const GROOVE_OP_LABEL: Record<GrooveOp, string> = {
  thin: 'thinned', busy: 'busier', accent: 'accents displaced', kick: 'new kick placement', openhat: 'open hat moves',
  half: 'half-time', perc: 'with a percussion line', answer: 'two-bar answer',
};

const isTamb = (h: Hit) => (h.dur ?? 0) < 0.15;

/** A related groove: one operator applied to every bar of the cycle. */
export function varyGroove(gr: Groove, op: GrooveOp, g: Grid, r: Rng): Groove {
  let bars = gr.bars.map(cloneLanes);
  let perc = gr.perc;
  let halfTime = gr.halfTime;
  const anchors = new Set(g.groupStarts);
  switch (op) {
    case 'thin':
      for (const l of bars) {
        for (const v of ['hatC', 'hatO', 'snare', 'clap'] as DrumVoice[]) l[v] = l[v].filter((h) => h.k === 'core' && !(v === 'hatO' && isTamb(h) && h.s % 4 !== 0));
        if (l.kick.length > anchors.size + 1) l.kick = l.kick.filter((h) => anchors.has(h.s) || h.v >= 0.85);
        if (l.hatC.length > g.eighths.length / 2) l.hatC = l.hatC.filter((h) => h.s % 2 === 0);
      }
      break;
    case 'busy':
      for (const l of bars) {
        for (const v of DRUM_VOICES) for (const h of l[v]) if (h.k === 'detail') { h.k = 'core'; h.t = 0; }
        for (const s of shuffle(r, g.sixteenths).slice(0, 2)) if (!l.hatC.some((h) => h.s === s)) l.hatC.push({ s, v: 0.24, k: 'core', t: 0, dur: 0.06 });
        const gs = g.backbeats.map((bb) => bb + 3).filter((s) => s < g.n && !l.snare.some((h) => h.s === s));
        if (gs.length) l.snare.push({ s: pick(r, gs), v: 0.3, k: 'core', t: 0 });
      }
      break;
    case 'accent':
      for (const l of bars) {
        const hats = [...l.hatC].sort((a, b) => a.s - b.s);
        if (hats.length < 3) continue;
        const vels = hats.map((h) => h.v);
        hats.forEach((h, i) => { h.v = vels[(i + vels.length - 1) % vels.length]; });
      }
      break;
    case 'kick': {
      const l0 = bars[0];
      const extra = l0.kick.filter((h) => !anchors.has(h.s) && !g.quarters.includes(h.s));
      if (extra.length && chance(r, 0.6)) {
        const h = pick(r, extra);
        const to = Math.max(1, Math.min(g.n - 1, h.s + pick(r, [-2, 2, 1])));
        for (const l of bars) { l.kick = l.kick.filter((k) => k.s !== h.s && k.s !== to); l.kick.push({ ...h, s: to }); }
      } else {
        const s = syncopations(g, r, 1, l0.kick.map((k) => k.s))[0];
        if (s != null) for (const l of bars) l.kick.push({ s, v: 0.68, k: 'core', t: 0 });
      }
      break;
    }
    case 'openhat': {
      for (const l of bars) l.hatO = l.hatO.filter((h) => isTamb(h));
      const last = bars.length === 1 ? (bars = [bars[0], cloneLanes(bars[0])])[1] : bars[bars.length - 1];
      const s = pick(r, g.offbeats.filter((x) => x !== g.n - 2).concat([g.n - 2]));
      last.hatC = last.hatC.filter((h) => h.s !== s);
      last.hatO.push({ s, v: 0.46, k: 'core', t: 0, dur: 0.35 });
      break;
    }
    case 'half':
      halfTime = true;
      for (const l of bars) {
        l.snare = l.snare.filter((h) => h.k !== 'core' || !g.backbeats.includes(h.s));
        l.clap = l.clap.filter((h) => !g.backbeats.includes(h.s));
        if (g.mid > 0) l.snare.push({ s: g.mid, v: 0.84, k: 'core', t: 0 });
        const keep = l.kick.filter((h) => h.s === 0);
        const other = l.kick.filter((h) => h.s !== 0 && h.s !== g.mid).sort((a, b) => b.v - a.v)[0];
        l.kick = other ? [...keep, { ...other, v: Math.min(other.v, 0.7) }] : keep;
      }
      break;
    case 'perc':
      perc = { k: pick(r, [3, 5, 7]), len: pick(r, [16, 12, 10, 6]), rot: intBetween(r, 0, 5) };
      break;
    case 'answer': {
      if (bars.length === 1) bars = [bars[0], cloneLanes(bars[0])];
      const last = bars[bars.length - 1];
      if (chance(r, 0.5)) last.kick.push({ s: g.n - 1, v: 0.58, k: 'core', t: 0 });
      else for (const s of [g.n - 3, g.n - 1]) if (!last.hatC.some((h) => h.s === s)) last.hatC.push({ s, v: 0.34, k: 'core', t: 0, dur: 0.05 });
      break;
    }
  }
  for (const l of bars) for (const v of DRUM_VOICES) l[v].sort((a, b) => a.s - b.s);
  return { ...gr, id: `${gr.id}+${op}`, ops: [...gr.ops, op], bars, perc, halfTime };
}

export function grooveLabel(gr: Groove | null): string {
  if (!gr) return 'no drums';
  return gr.ops.length ? `${gr.label} (${[...new Set(gr.ops)].map((o) => GROOVE_OP_LABEL[o]).join(', ')})` : gr.label;
}

/** Mean core kicks per beat across the cycle: used to interlock the bass with the kick. */
export function kickDensity(gr: Groove | null, beats: number): number {
  if (!gr) return 0;
  const k = gr.bars.reduce((s, l) => s + l.kick.filter((h) => h.k === 'core').length, 0) / gr.bars.length;
  return k / beats;
}

/** Steps (in the first bar) where the groove has a core kick. */
export function kickSteps(gr: Groove | null): number[] {
  return gr ? gr.bars[0].kick.filter((h) => h.k === 'core').map((h) => h.s) : [];
}
