// Bass motifs, built from independently variable parts: a rhythm (onsets and
// lengths), a pitch sequence (chord tones plus scale steps, resolved against
// the current chord at play time), accents, register, articulation (gate) and
// harmonic behaviour. Archetypes cover ostinatos, sequencer runs, syncopation,
// sustained notes with gaps, root–octave pumps, repeated-note rhythms, melodic
// phrases, off-beat bass and call-and-response. Mutations change rhythm as well
// as pitch, so a bass line can develop without losing its identity.

import { chance, hash, intBetween, pick, shuffle, weighted, type Rng } from './rng';
import type { BassMode } from './styles';
import { tile, type Grid } from './grid';
import { euclid } from './theory';

export type BassArchetype =
  | 'eighths' | 'sixteenths' | 'gallop' | 'syncopated' | 'sustained' | 'rootOctave' | 'repeated' | 'phrase' | 'offbeat' | 'callResponse' | 'drone';

/** ct: chord tone (0 root, 1 third, 2 fifth, 3 seventh); oct: octaves; step: extra scale steps (passing tones) */
export interface BassPitch { ct: 0 | 1 | 2 | 3; oct: number; step: number }
export interface BassNote { s: number; len: number; acc: boolean; p: BassPitch }
export interface BassMotif {
  id: string;
  archetype: BassArchetype;
  label: string;
  ops: BassOp[];
  /** cycle length in bars */
  bars: number;
  notes: BassNote[];
  /** articulation: fraction of each note's length that sounds */
  gate: number;
}

export const BASS_LABEL: Record<BassArchetype, string> = {
  eighths: 'Eighth-note ostinato', sixteenths: 'Sixteenth sequence', gallop: 'Galloping sequence', syncopated: 'Syncopated bass', sustained: 'Sustained notes with gaps',
  rootOctave: 'Root–octave pulse', repeated: 'Repeated-note rhythm', phrase: 'Melodic bass phrase', offbeat: 'Off-beat bass',
  callResponse: 'Call-and-response bass', drone: 'Pedal drone bass',
};

const R: BassPitch = { ct: 0, oct: 0, step: 0 };
const O: BassPitch = { ct: 0, oct: 1, step: 0 };
const F: BassPitch = { ct: 2, oct: 0, step: 0 };
const T: BassPitch = { ct: 1, oct: 0, step: 0 };
const S: BassPitch = { ct: 3, oct: 0, step: 0 };
const LOW: BassPitch = { ct: 0, oct: -1, step: 0 };

function withLens(onsets: number[], cycle: number, lenOf: (gap: number, i: number) => number): { s: number; len: number }[] {
  const sorted = [...new Set(onsets)].filter((s) => s >= 0 && s < cycle).sort((a, b) => a - b);
  return sorted.map((s, i) => {
    const gap = (i + 1 < sorted.length ? sorted[i + 1] : cycle) - s;
    return { s, len: Math.max(1, Math.min(gap, lenOf(gap, i))) };
  });
}

interface Ctx { cx: number; kicks: number[] }

const BUILD: Record<BassArchetype, (g: Grid, r: Rng, c: Ctx) => { bars: number; notes: BassNote[]; gate: number }> = {
  eighths: (g, r, c) => {
    const notes = g.eighths.map((s) => ({
      s, len: 2, acc: g.groupStarts.includes(s) || s % 8 === 0,
      p: s === 0 ? R : weighted(r, [[R, 5.5], [O, 2], [F, 1.6], [T, 0.6 + c.cx]] as const),
    }));
    if (c.cx > 0.6 && chance(r, 0.5)) { notes[notes.length - 1].len = 1; notes.push({ s: g.n - 1, len: 1, acc: false, p: F }); }
    return { bars: 1, notes, gate: 0.75 };
  },
  sixteenths: (g, r, c) => {
    const cellLen = pick(r, c.cx > 0.5 ? [3, 5, 6, 7, 8] : [4, 8, 4, 6]);
    const cell: BassPitch[] = [R];
    for (let i = 1; i < cellLen; i++) {
      cell.push(weighted(r, [[R, 3], [O, 3], [F, 2], [S, c.cx * 1.5], [T, 0.8], [{ ct: 0, oct: 0, step: 1 }, c.cx]] as const));
    }
    let bars = 4;
    for (const b of [1, 2]) if ((b * g.n) % cellLen === 0) { bars = b; break; }
    const acc = euclid(pick(r, [3, 5]), 16, intBetween(r, 0, 3));
    // step-sequencer rests and ties: a fixed gate pattern, so the run breathes in the same places every bar
    const gates = chance(r, 0.6) ? euclid(pick(r, [10, 11, 12, 13, 14]), 16, intBetween(r, 0, 15)) : new Array(16).fill(true);
    gates[0] = true;
    const notes: BassNote[] = [];
    for (let i = 0; i < bars * g.n; i++) {
      if (!gates[i % 16]) continue;
      notes.push({ s: i, len: gates[(i + 1) % 16] ? 1 : 2, acc: acc[i % 16], p: cell[i % cellLen] });
    }
    return { bars, notes, gate: 0.55 };
  },
  gallop: (g, r, c) => {
    // an eighth and two sixteenths (or the reverse), the sequencer gallop
    const forward = chance(r, 0.6);
    const on = tile(forward ? [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15] : [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14], g.n);
    const cell: BassPitch[] = [R, weighted(r, [[O, 3], [F, 2], [R, 1]] as const), weighted(r, [[O, 2], [F, 2], [S, c.cx], [T, 0.6]] as const)];
    const notes = withLens(on, g.n, (gap) => gap).map(({ s, len }, i) => ({ s, len, acc: i % 3 === 0, p: cell[i % 3] }));
    return { bars: 1, notes, gate: 0.6 };
  },
  syncopated: (g, r, c) => {
    const templates = [[0, 3, 6, 10, 12], [0, 3, 6, 8, 11, 14], [0, 6, 10, 14], [0, 3, 7, 10], [0, 4, 7, 10, 13], [0, 2, 7, 10, 12, 15]];
    // Euclidean placements (Toussaint) widen the family: E(3,8)-, E(5,16)- and E(7,16)-type lines
    for (const k of [3, 5, 7]) { const rot = intBetween(r, 0, 15); templates.push(euclid(k, 16, rot).map((x, i) => (x ? i : -1)).filter((i) => i >= 0)); }
    // interlock: prefer templates that leave the kick's off-beat placements free
    const kick = new Set(c.kicks.filter((s) => s !== 0));
    const scored = templates.map((t) => [t, 1 / (1 + t.filter((s) => kick.has(s)).length)] as const);
    const on = tile(weighted(r, scored), g.n);
    const notes = withLens(on, g.n, (gap) => pick(r, [1, 2, gap])).map(({ s, len }, i) => ({
      s, len, acc: i === 0,
      p: s === 0 ? R : weighted(r, [[R, 3], [O, 2], [F, 1.5], [LOW, 1], [T, 0.6], [S, 0.4 * c.cx]] as const),
    }));
    notes[intBetween(r, 1, Math.max(1, notes.length - 1))].acc = true;
    return { bars: 1, notes, gate: 0.72 };
  },
  sustained: (g, r) => {
    const second = Math.min(g.n - 3, pick(r, [7, 10, 11]));
    const notes: BassNote[] = [
      { s: 0, len: pick(r, [6, 7]), acc: true, p: R },
      { s: second, len: Math.min(pick(r, [3, 4, 5]), g.n - second), acc: false, p: weighted(r, [[R, 3], [LOW, 1], [F, 1]] as const) },
    ];
    if (g.n >= 16 && second < 12 && chance(r, 0.5)) notes.push({ s: 14, len: 2, acc: false, p: O });
    if (chance(r, 0.45)) {
      // a two-bar cycle: the second bar answers with a different placement
      const s2 = g.n + Math.min(g.n - 3, pick(r, [3, 6, 10]));
      notes.push({ s: g.n, len: pick(r, [3, 6]), acc: true, p: R }, { s: s2, len: 3, acc: false, p: pick(r, [F, O, LOW]) });
      return { bars: 2, notes: notes.filter((x) => x.s < 2 * g.n), gate: 0.95 };
    }
    return { bars: 1, notes, gate: 0.95 };
  },
  rootOctave: (g, r) => {
    const two = chance(r, 0.6);
    const notes: BassNote[] = [];
    for (let b = 0; b < (two ? 2 : 1); b++) {
      for (const s of g.eighths) notes.push({ s: b * g.n + s, len: 2, acc: s % 4 === 0, p: s % 4 === 0 ? R : O });
    }
    if (two) { const last = notes[notes.length - 1]; last.p = pick(r, [F, S, T]); notes[notes.length - 2].p = F; }
    return { bars: two ? 2 : 1, notes, gate: 0.5 };
  },
  repeated: (g, r, c) => {
    const acc = new Set(tile(pick(r, [[0, 3, 6, 8, 11, 14], [0, 3, 6, 9, 12], [0, 6, 12]]), g.n));
    const step = c.cx < 0.4 ? 2 : 1;
    const p = chance(r, 0.8) ? R : LOW;
    const notes: BassNote[] = [];
    for (let s = 0; s < g.n; s += step) notes.push({ s, len: step, acc: acc.has(s), p });
    return { bars: 1, notes, gate: 0.5 };
  },
  phrase: (g, r) => {
    // two bars: quarter-note chord tones joined by passing eighths (a walking line)
    const targets: BassPitch[][] = [
      [R, pick(r, [F, T]), O, F],
      [R, T, F, pick(r, [{ ct: 0, oct: 1, step: -1 }, S, { ct: 2, oct: 0, step: 1 }])],
    ];
    const notes: BassNote[] = [];
    for (let b = 0; b < 2; b++) {
      g.quarters.forEach((q, i) => {
        const p = targets[b][i % 4];
        const passing = i > 0 && chance(r, 0.35);
        if (passing) notes.push({ s: b * g.n + q - 2, len: 2, acc: false, p: { ...p, step: p.step - 1 } });
        notes.push({ s: b * g.n + q, len: passing ? 2 : 4, acc: i === 0, p });
      });
    }
    return { bars: 2, notes: relen(notes, 2 * g.n), gate: 0.82 };
  },
  offbeat: (g, r, c) => {
    const len = pick(r, [1, 2]);
    // the classic house off-beat bass and its relatives: sparse, anticipated, or with an "a" pickup
    const variant = pick(r, [[2, 6, 10, 14], [2, 6, 10, 14], [2, 10], [2, 6, 10, 13], [3, 6, 10, 14], [2, 7, 10, 15], [2, 6, 11, 14]]);
    const notes: BassNote[] = tile(variant, g.n).map((s, i) => ({ s, len, acc: i === 0, p: R }));
    if (notes.length > 2) notes[intBetween(r, 1, notes.length - 1)].p = pick(r, [O, F]);
    if (c.cx > 0.5) { const s = pick(r, g.offbeats) - 1; if (s > 0) notes.push({ s, len: 1, acc: false, p: R }); }
    return { bars: 1, notes: notes.sort((a, b) => a.s - b.s), gate: 0.62 };
  },
  callResponse: (g, r) => {
    const call = pick(r, [[0, 3, 6], [0, 2, 4, 7], [0, 3, 4]]);
    const answer = pick(r, [[8, 11, 14], [6, 10, 12, 14], [10, 12, 15]]).map((s) => s * g.n / 16).map(Math.round);
    const notes: BassNote[] = [];
    const cp = [R, pick(r, [R, LOW]), pick(r, [O, F])];
    call.forEach((s, i) => notes.push({ s, len: i === call.length - 1 ? 3 : Math.max(1, (call[i + 1] ?? s + 2) - s), acc: i === 0, p: cp[i % cp.length] }));
    const ap = [pick(r, [F, O]), pick(r, [O, S]), pick(r, [F, R])];
    answer.forEach((s, i) => notes.push({ s: g.n + s, len: Math.max(1, Math.min(2, (answer[i + 1] ?? g.n) - s)), acc: i === 0, p: ap[i % ap.length] }));
    // the answer leaves bar two's downbeat empty: the space is part of the phrase
    return { bars: 2, notes: relen(notes.filter((x) => x.s < 2 * g.n), 2 * g.n), gate: 0.72 };
  },
  drone: (g, r, c) => {
    const notes: BassNote[] = [{ s: 0, len: g.n, acc: true, p: R }];
    if (c.cx > 0.55) { notes[0].len = g.n / 2; notes.push({ s: g.n / 2, len: g.n / 2, acc: false, p: chance(r, 0.6) ? O : F }); }
    return { bars: 1, notes, gate: 1 };
  },
};

const FAMILY: Record<BassMode, [BassArchetype, number][]> = {
  motorik: [['eighths', 3], ['rootOctave', 2], ['syncopated', 1.5], ['repeated', 1.5], ['gallop', 0.8], ['sustained', 0.8], ['callResponse', 1], ['phrase', 0.7]],
  dub: [['sustained', 3], ['offbeat', 1.5], ['syncopated', 1.5], ['callResponse', 1]],
  sequence: [['sixteenths', 3], ['gallop', 2], ['repeated', 1.3], ['eighths', 1.2], ['rootOctave', 0.8], ['callResponse', 0.8]],
  drone: [['drone', 3], ['sustained', 1.2], ['phrase', 0.5]],
  walking: [['phrase', 3], ['rootOctave', 1.5], ['syncopated', 1.5], ['callResponse', 1.5], ['eighths', 1]],
  micro: [['syncopated', 3], ['offbeat', 2.5], ['callResponse', 1.2], ['repeated', 0.4]],
};

function finish(a: BassArchetype, built: { bars: number; notes: BassNote[]; gate: number }, n: number): BassMotif {
  const notes = relen(built.notes, built.bars * n);
  return { id: `${a}-${hash(JSON.stringify(notes)).toString(36)}`, archetype: a, label: BASS_LABEL[a], ops: [], ...built, notes };
}

/**
 * Picks a bass archetype for the style (weighted by its musical prior, the
 * Groove diversity control, and how the drum groove leaves room: a
 * four-on-the-floor kick favours off-beat and syncopated bass, a sparse kick
 * favours driving ostinatos) and builds it.
 */
export function makeBass(mode: BassMode, g: Grid, r: Rng, o: { cx: number; diversity: number; kickDensity: number; kicks: number[]; exclude?: BassArchetype }): BassMotif {
  const fam = FAMILY[mode].filter(([a]) => a !== o.exclude);
  const canonical = FAMILY[mode][0][0];
  const items = fam.map(([a, w]) => {
    let fit = 1;
    if (o.kickDensity >= 0.9) fit = a === 'offbeat' ? 1.6 : a === 'syncopated' ? 1.3 : a === 'eighths' ? 0.8 : 1;
    else if (o.kickDensity > 0 && o.kickDensity < 0.55) fit = a === 'eighths' || a === 'repeated' ? 1.3 : a === 'sixteenths' ? 1.2 : 1;
    const prior = Math.pow(w, 1 - o.diversity) * fit;
    return [a, a === canonical ? prior : prior * Math.min(1, o.diversity * 2)] as const;
  });
  const a = items.some(([, w]) => w > 0) ? weighted(r, items) : fam[0]?.[0] ?? canonical;
  return finish(a, BUILD[a](g, r, { cx: o.cx, kicks: o.kicks }), g.n);
}

export function bassByArchetype(a: BassArchetype, g: Grid, r: Rng, cx = 0.5, kicks: number[] = []): BassMotif {
  return finish(a, BUILD[a](g, r, { cx, kicks }), g.n);
}

// ------------------------------------------------------------ mutation

export type BassOp = 'shift' | 'length' | 'rest' | 'pickup' | 'accent' | 'answer' | 'tail' | 'contour' | 'related' | 'sustain';
export const BASS_OP_LABEL: Record<BassOp, string> = {
  shift: 'an onset shifts', length: 'a note length changes', rest: 'a rest opens up', pickup: 'a pickup note is added',
  accent: 'the accent moves', answer: 'a two-bar rhythmic answer', tail: 'the phrase ending is replaced', contour: 'the contour turns',
  related: 'a new related motif', sustain: 'held notes',
};

const SMALL: BassOp[] = ['shift', 'length', 'rest', 'pickup', 'accent'];
const LARGE: BassOp[] = ['answer', 'tail', 'contour', 'related'];

/** Chooses a mutation: small ones dominate at low motif evolution, large ones grow with it. */
export function pickBassOp(r: Rng, evolution: number): BassOp {
  return weighted(r, [...SMALL.map((o) => [o, 1.4 - evolution] as const), ...LARGE.map((o) => [o, 0.2 + evolution] as const)]);
}

function relen(notes: BassNote[], cycle: number): BassNote[] {
  const sorted = [...notes].sort((a, b) => a.s - b.s);
  return sorted.map((x, i) => ({ ...x, len: Math.max(1, Math.min(x.len, (i + 1 < sorted.length ? sorted[i + 1].s : cycle) - x.s)) }));
}

export function mutateBass(m: BassMotif, op: BassOp, g: Grid, r: Rng, cx = 0.5): BassMotif {
  const cycle = m.bars * g.n;
  let notes = m.notes.map((x) => ({ ...x, p: { ...x.p } }));
  let bars = m.bars;
  const taken = (s: number) => notes.some((x) => x.s === s);
  const movable = () => notes.filter((x) => x.s % g.n !== 0);
  switch (op) {
    case 'shift': {
      const c = movable();
      if (!c.length) return mutateBass(m, 'pickup', g, r, cx);
      const x = pick(r, c);
      const to = x.s + pick(r, [-2, -1, 1, 2]);
      if (to > 0 && to < cycle && !taken(to) && to % g.n !== 0) x.s = to;
      else return mutateBass(m, 'length', g, r, cx);
      break;
    }
    case 'length': {
      const x = pick(r, notes);
      x.len = x.len > 1 && chance(r, 0.5) ? Math.max(1, Math.floor(x.len / 2)) : x.len * 2;
      break;
    }
    case 'rest': {
      const c = movable();
      if (notes.length <= 2 || !c.length) return mutateBass(m, 'accent', g, r, cx);
      const x = pick(r, c);
      notes = notes.filter((y) => y !== x);
      break;
    }
    case 'pickup': {
      const downs = Array.from({ length: bars }, (_, b) => (b + 1) * g.n - 1).concat(g.quarters.map((q) => q - 1).filter((s) => s > 0));
      const free = downs.filter((s) => !taken(s));
      if (!free.length) return mutateBass(m, 'shift', g, r, cx);
      notes.push({ s: pick(r, free), len: 1, acc: false, p: pick(r, [O, F, { ct: 0, oct: 0, step: -1 }]) });
      break;
    }
    case 'accent': {
      const accs = notes.map((x) => x.acc);
      const k = pick(r, [1, 2]);
      notes.forEach((x, i) => { x.acc = accs[(i + accs.length - k) % accs.length]; });
      notes[0].acc = true;
      break;
    }
    case 'answer': {
      if (bars === 1) { notes = [...notes, ...notes.map((x) => ({ ...x, s: x.s + g.n, p: { ...x.p } }))]; bars = 2; }
      const half = (bars - 1) * g.n + g.n / 2;
      notes = notes.filter((x) => x.s < half);
      const on = pick(r, [[0, 3, 6], [2, 4, 6], [0, 2, 5], [1, 4]]).map((s) => half + Math.round((s * g.n) / 16));
      for (const s of on) if (s < bars * g.n) notes.push({ s, len: 2, acc: false, p: pick(r, [O, F, T, { ct: 2, oct: 0, step: 1 }]) });
      break;
    }
    case 'tail': {
      const from = cycle - 4;
      notes = notes.filter((x) => x.s < from);
      for (const s of shuffle(r, [0, 1, 2, 3]).slice(0, intBetween(r, 1, 3)).map((d) => from + d)) notes.push({ s, len: 1, acc: false, p: pick(r, [O, F, S, R, LOW]) });
      break;
    }
    case 'contour': {
      if (chance(r, 0.5)) {
        // pitch retrograde: the same rhythm with the pitch sequence reversed (root stays on the downbeat)
        const ps = notes.slice(1).map((x) => x.p).reverse();
        notes.slice(1).forEach((x, i) => { x.p = ps[i]; });
      } else {
        // inversion around the root: notes above it move below it and vice versa
        for (const x of notes.slice(1)) {
          if (x.p.ct === 0) x.p.oct = -x.p.oct;
          else x.p.oct = x.p.oct >= 0 ? -1 : 0;
          x.p.step = -x.p.step;
        }
      }
      break;
    }
    case 'related': {
      const fresh = BUILD[m.archetype](g, r, { cx, kicks: [] });
      const span = Math.max(bars, fresh.bars) * g.n;
      const keep = notes.filter((x) => x.s % g.n < g.n / 2);
      const add = fresh.notes.filter((x) => x.s % g.n >= g.n / 2 && x.s < span);
      bars = Math.max(bars, fresh.bars);
      const extended: BassNote[] = [];
      for (let b = 0; b < bars; b += m.bars) for (const x of keep) if (x.s + b * g.n < bars * g.n) extended.push({ ...x, s: x.s + b * g.n });
      notes = [...extended.filter((x) => x.s < bars * g.n), ...add];
      notes = notes.filter((x, i) => notes.findIndex((y) => y.s === x.s) === i);
      break;
    }
    case 'sustain': {
      const keep = notes.filter((x) => x.s % g.n === 0 || x.s % g.n === g.mid);
      notes = (keep.length ? keep : [notes[0]]).map((x) => ({ ...x, len: g.n }));
      return { ...m, id: `${m.id}+${op}`, ops: [...m.ops, op], notes: relen(notes, cycle), gate: 0.95 };
    }
  }
  if (!notes.some((x) => x.s === 0)) notes.push({ s: 0, len: 2, acc: true, p: R });
  return { ...m, id: `${m.id}+${op}`, ops: [...m.ops, op], bars, notes: relen(notes, bars * g.n) };
}

export function bassLabel(m: BassMotif | null): string {
  if (!m) return 'no bass';
  const ops = [...new Set(m.ops)];
  return ops.length ? `${m.label} (${ops.map((o) => BASS_OP_LABEL[o]).slice(-2).join(', ')})` : m.label;
}
