// Melodic material: arpeggio figures and melodic hooks as concrete motifs
// (onset, length, degree, velocity) over a one- to four-bar cycle, plus the
// classical motivic transformations used to develop them — sequence
// (transposition), inversion, retrograde, register change, augmentation,
// fragmentation, rhythmic displacement, extension, rests and embellishment.
//
// Degrees are relative: for an arpeggio, an index into the current chord's
// tones; for a melody, scale steps above the current chord root. A motif
// therefore follows the harmony while keeping its contour and rhythm.

import { chance, hash, intBetween, pick, shuffle, weighted, type Rng } from './rng';
import type { ArpMode } from './styles';
import { tile, type Grid } from './grid';
import { euclid } from './theory';

export type MotifKind = 'arp' | 'melody';
export interface MNote { s: number; len: number; d: number; v: number }
export interface Motif {
  id: string;
  kind: MotifKind;
  label: string;
  ops: MotifOp[];
  bars: number;
  notes: MNote[];
  /** octave shift from the style's register */
  octave: number;
  /** arpeggio pool span in octaves */
  span: number;
  /** add the chord's ninth to an arpeggio pool */
  passing: boolean;
  /** fraction of the gap to the next onset that sounds */
  gate: number;
}

/** Content-derived ids keep plans byte-identical across runs. */
const id = (k: string, notes: MNote[]) => `${k}-${hash(JSON.stringify(notes)).toString(36)}`;

// ------------------------------------------------------------ arpeggio figures

const ARP_RHYTHMS: Record<string, (g: Grid, r: Rng, fill: number) => number[]> = {
  sixteenths: (g) => Array.from({ length: g.n }, (_, i) => i),
  eighths: (g) => g.eighths,
  '3+3+2': (g) => tile([0, 3, 6, 8, 11, 14], g.n),
  gallop: (g) => tile([0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15], g.n),
  pairs: (g) => tile([0, 1, 4, 5, 8, 9, 12, 13], g.n),
  'off-beat': (g) => tile([2, 6, 10, 14, 15], g.n),
  'dotted eighths': (g) => Array.from({ length: Math.ceil(g.n / 3) }, (_, i) => i * 3).filter((s) => s < g.n),
  euclidean: (g, r, fill) => { const e = euclid(Math.max(2, Math.round(g.n * fill)), g.n, intBetween(r, 0, 3)); return e.map((x, i) => (x ? i : -1)).filter((i) => i >= 0); },
  quarters: (g) => g.quarters,
};

const ARP_RHYTHM_WEIGHTS: Record<ArpMode, [string, number][]> = {
  sequence: [['sixteenths', 4], ['3+3+2', 2], ['gallop', 2], ['pairs', 1], ['dotted eighths', 1]],
  evolving: [['eighths', 2], ['3+3+2', 2], ['euclidean', 3], ['gallop', 1], ['pairs', 1], ['off-beat', 1], ['dotted eighths', 1]],
  sparse: [['euclidean', 3], ['off-beat', 1], ['pairs', 1], ['quarters', 1]],
  constellation: [['quarters', 1]],
};

const SHAPES: Record<string, (L: number) => number[]> = {
  rising: (L) => Array.from({ length: L }, (_, i) => i),
  falling: (L) => Array.from({ length: L }, (_, i) => L - 1 - i),
  'rise-and-fall': (L) => { const k = Math.max(2, Math.ceil(L / 2) + 1); const up = Array.from({ length: k }, (_, i) => i); return [...up, ...up.slice(1, -1).reverse()].slice(0, Math.max(L, 3)); },
  pendulum: (L) => Array.from({ length: L }, (_, i) => (i % 2 ? Math.floor(i / 2) + 2 : Math.floor(i / 2))),
  'pedal point': (L) => Array.from({ length: L }, (_, i) => (i % 2 ? 1 + Math.ceil(i / 2) : 0)),
  'broken thirds': (L) => Array.from({ length: L }, (_, i) => Math.floor(i / 2) + (i % 2 ? 2 : 0)),
  'skipping': (L) => Array.from({ length: L }, (_, i) => (i * 2) % (L + (L % 2 ? 0 : 1))),
  'sequenced cell': (L) => Array.from({ length: L }, (_, i) => Math.floor(i / 3) + (i % 3)),
};

export function makeArp(g: Grid, r: Rng, o: { mode: ArpMode; cx: number; density: number; octaves: number; exclude?: string }): Motif {
  const rhythmName = weighted(r, ARP_RHYTHM_WEIGHTS[o.mode === 'constellation' ? 'sparse' : o.mode].filter(([n]) => n !== o.exclude));
  const fill = o.mode === 'sparse' ? 0.2 + 0.25 * o.density : 0.35 + 0.4 * o.density;
  let onsets = ARP_RHYTHMS[rhythmName](g, r, fill);
  // rests are part of the figure: fixed gaps, chosen once
  if (onsets.length > 6 && o.mode !== 'sequence') {
    const drop = Math.round(onsets.length * 0.25 * (1 - o.density));
    const drops = new Set(shuffle(r, onsets.slice(1)).slice(0, drop));
    onsets = onsets.filter((s) => !drops.has(s));
  }
  const shapeName = weighted(r, [
    ['rising', 2], ['falling', 1], ['rise-and-fall', 2], ['pendulum', 1 + o.cx], ['pedal point', o.mode === 'sequence' ? 2.5 : 1],
    ['broken thirds', 1 + o.cx], ['skipping', o.cx * 1.5], ['sequenced cell', 0.5 + o.cx],
  ] as const);
  const L = Math.max(3, Math.min(8, intBetween(r, 3, 4 + Math.round(4 * o.cx))));
  const cell = SHAPES[shapeName](L);
  let bars = 4;
  for (const b of [1, 2]) if ((onsets.length * b) % cell.length === 0) { bars = b; break; }
  const notes: MNote[] = [];
  let i = 0;
  for (let b = 0; b < bars; b++) {
    onsets.forEach((s, j) => {
      const next = onsets[j + 1] ?? g.n + onsets[0];
      notes.push({ s: b * g.n + s, len: next - s, d: cell[i % cell.length], v: i % cell.length === 0 ? 0.85 : 0.66 });
      i++;
    });
  }
  return {
    id: id('arp', notes), kind: 'arp', label: `Arpeggio, ${shapeName} over ${rhythmName}`, ops: [], bars, notes,
    octave: 0, span: Math.max(1, Math.min(3, Math.round(o.octaves * (0.6 + 0.8 * o.cx)))),
    passing: o.cx > 0.6 && chance(r, 0.6), gate: 0.5 + 0.4 * r(),
  };
}

// ------------------------------------------------------------ melodic hooks

type Contour = 'arch' | 'descent' | 'ascent' | 'valley' | 'neighbour' | 'leap and fill';

function contourPitches(r: Rng, k: number, c: Contour, start: number): number[] {
  const out = [start];
  for (let i = 1; i < k; i++) {
    const prev = out[i - 1];
    const step = pick(r, [1, 1, 1, 2]);
    const half = i < k / 2;
    switch (c) {
      case 'arch': out.push(prev + (half ? step : -step)); break;
      case 'valley': out.push(prev + (half ? -step : step)); break;
      case 'ascent': out.push(prev + step); break;
      case 'descent': out.push(prev - step); break;
      case 'neighbour': out.push(i % 2 ? start + pick(r, [1, -1]) : start); break;
      case 'leap and fill': out.push(i === 1 ? prev + pick(r, [3, 4, 5]) : prev - 1); break; // a leap, then stepwise motion back (gap-fill)
    }
  }
  return out;
}

function rhythmCell(g: Grid, r: Rng, k: number, sparse: boolean): number[] {
  const first = weighted(r, [[0, 3], [2, 1], [4, 1], [6, 0.6]] as const);
  const cands = Array.from({ length: g.n }, (_, s) => s).filter((s) => s > first);
  const pool = cands.map((s) => [s, s % 8 === 0 ? 3 : s % 4 === 0 ? 2 : s % 2 === 0 ? 1.5 : sparse ? 0.2 : 0.7] as const);
  const chosen = new Set<number>([first]);
  let guard = 0;
  while (chosen.size < k && guard++ < 64) chosen.add(weighted(r, pool));
  return [...chosen].sort((a, b) => a - b);
}

export type MelodyForm = 'riff' | 'call and response' | 'sentence' | 'period' | 'constellation';

export function makeMelody(g: Grid, r: Rng, o: { cx: number; density: number; sparse: boolean; slow: boolean; exclude?: MelodyForm }): Motif {
  const form: MelodyForm = o.slow ? 'constellation' : weighted(r, ([
    ['riff', 0.6 + o.density], ['call and response', 2], ['sentence', 0.6 + 1.4 * o.cx], ['period', 1],
  ] as [MelodyForm, number][]).filter(([f]) => f !== o.exclude));
  const contour = weighted(r, [['arch', 2], ['descent', 1.5], ['ascent', 1], ['valley', 1], ['neighbour', 1], ['leap and fill', 0.6 + o.cx]] as const);
  const legato = chance(r, o.slow ? 1 : 0.45);
  const notes: MNote[] = [];
  const put = (bar: number, on: number[], ds: number[], vel = 0.72, longLast = false) => {
    on.forEach((s, i) => {
      const gap = (on[i + 1] ?? g.n) - s;
      const len = i === on.length - 1 && longLast ? g.n - s : legato ? gap : Math.max(1, Math.min(gap, pick(r, [1, 2, 2, 3])));
      notes.push({ s: bar * g.n + s, len, d: ds[i % ds.length], v: i === 0 ? vel + 0.1 : vel });
    });
  };
  if (form === 'constellation') {
    // ambient: a few long tones, a call in the low register, an answer a fifth higher
    for (let b = 0; b < 4; b++) {
      const k = weighted(r, [[0, b === 0 ? 0 : 0.8], [1, 2], [2, 0.6 + o.density]] as const);
      const on = shuffle(r, [0, 4, 6, 8, 10, 12].filter((s) => s < g.n)).slice(0, k).sort((a, b2) => a - b2);
      on.forEach((s) => notes.push({ s: b * g.n + s, len: intBetween(r, 8, 20), d: pick(r, [0, 2, 4, 1, 5]) + (b >= 2 ? 4 : 0), v: 0.55 + 0.2 * r() }));
    }
    if (!notes.length) notes.push({ s: 0, len: 16, d: 2, v: 0.6 });
    return { id: id('mel', notes), kind: 'melody', label: 'Slow constellation phrase', ops: [], bars: 4, notes, octave: 0, span: 1, passing: false, gate: 1 };
  }
  const k = o.sparse ? intBetween(r, 2, 3) : intBetween(r, 3, 3 + Math.round(2 * Math.max(o.cx, o.density)));
  const idea = rhythmCell(g, r, k, o.sparse);
  const start = pick(r, [0, 2, 4]);
  const ideaP = contourPitches(r, idea.length, contour, start);
  let bars = 1;
  switch (form) {
    case 'riff':
      put(0, idea, ideaP);
      break;
    case 'call and response': {
      // the call ends open (not on the root), the answer resolves to it
      const call = [...ideaP]; if (call[call.length - 1] % 7 === 0) call[call.length - 1] += pick(r, [4, 1]);
      put(0, idea, call);
      const respOn = chance(r, 0.5) ? idea : rhythmCell(g, r, Math.max(2, idea.length - 1), o.sparse);
      const resp = contourPitches(r, respOn.length, contour === 'ascent' ? 'descent' : contour === 'descent' ? 'ascent' : contour, call[call.length - 1]);
      resp[resp.length - 1] = 0;
      put(1, respOn, resp, 0.68, true);
      bars = 2;
      break;
    }
    case 'sentence': {
      // basic idea, its repetition (often sequenced), fragmentation, cadence
      const t = pick(r, [0, 1, 2, -1]);
      put(0, idea, ideaP);
      put(1, idea, ideaP.map((d) => d + t));
      const frag = idea.filter((s) => s < g.n / 2);
      const fragP = ideaP.slice(0, Math.max(1, frag.length));
      const f = frag.length ? frag : [idea[0]];
      put(2, [...f, ...f.map((s) => s + g.n / 2)].filter((s) => s < g.n), [...fragP.map((d) => d + 2), ...fragP.map((d) => d + 3)]);
      put(3, [0, pick(r, [4, 6, 8])].filter((s) => s < g.n), [1, 0], 0.7, true);
      bars = 4;
      break;
    }
    case 'period': {
      // antecedent ends on a half cadence (the fifth), consequent on the root
      const cont = rhythmCell(g, r, Math.max(2, idea.length - 1), true);
      const contP = contourPitches(r, cont.length, 'descent', ideaP[ideaP.length - 1] + 1);
      put(0, idea, ideaP);
      put(1, cont, [...contP.slice(0, -1), 4], 0.68, true);
      put(2, idea, ideaP);
      put(3, cont, [...contP.slice(0, -1), 0], 0.68, true);
      bars = 4;
      break;
    }
  }
  return {
    id: id('mel', notes), kind: 'melody', label: `Melodic hook, ${form} (${contour})`, ops: [], bars, notes,
    octave: 0, span: 1, passing: false, gate: legato ? 0.92 : 0.8,
  };
}

// ------------------------------------------------------------ transformation

export type MotifOp = 'transpose' | 'invert' | 'retrograde' | 'register' | 'augment' | 'fragment' | 'displace' | 'extend' | 'rests' | 'embellish' | 'rhythm';
export const MOTIF_OP_LABEL: Record<MotifOp, string> = {
  transpose: 'sequenced to a new step', invert: 'inverted', retrograde: 'played in retrograde', register: 'moved to a new register',
  augment: 'augmented (twice as slow)', fragment: 'fragmented', displace: 'rhythmically displaced', extend: 'extended',
  rests: 'opened up with rests', embellish: 'embellished with passing notes', rhythm: 'rhythm varied',
};

const SMALL: MotifOp[] = ['rhythm', 'rests', 'embellish', 'displace', 'register'];
const LARGE: MotifOp[] = ['transpose', 'invert', 'retrograde', 'fragment', 'extend'];

export function pickMotifOp(r: Rng, evolution: number, m: Motif): MotifOp {
  const items = [...SMALL.map((o) => [o, 1.3 - evolution] as const), ...LARGE.map((o) => [o, 0.2 + 1.2 * evolution] as const)]
    .filter(([o]) => !(o === 'register' && Math.abs(m.octave) >= 1 && m.ops.includes('register')))
    .filter(([o]) => !(o === 'extend' && m.bars >= 4));
  return weighted(r, items);
}

const sortNotes = (ns: MNote[]) => ns.sort((a, b) => a.s - b.s);

export function transformMotif(m: Motif, op: MotifOp, g: Grid, r: Rng): Motif {
  const cycle = m.bars * g.n;
  let notes = m.notes.map((x) => ({ ...x }));
  let bars = m.bars;
  let octave = m.octave;
  const ds = notes.map((x) => x.d);
  switch (op) {
    case 'transpose': {
      const t = pick(r, m.kind === 'arp' ? [1, -1, 2] : [1, 2, -1, -2, 3]);
      notes.forEach((x) => { x.d += t; });
      break;
    }
    case 'invert': {
      const pivot = notes[0]?.d ?? 0;
      const lo = Math.min(...ds);
      notes.forEach((x) => { x.d = m.kind === 'arp' ? Math.max(...ds) - (x.d - lo) : 2 * pivot - x.d; });
      break;
    }
    case 'retrograde': {
      const rev = [...ds].reverse();
      notes.forEach((x, i) => { x.d = rev[i]; });
      break;
    }
    case 'register':
      octave = octave >= 1 ? 0 : octave <= -1 ? 0 : pick(r, [1, -1]);
      break;
    case 'augment':
      if (bars <= 2) { notes.forEach((x) => { x.s *= 2; x.len *= 2; }); bars *= 2; }
      else notes = notes.filter((x) => x.s % 4 === 0).map((x) => ({ ...x, len: x.len * 2 }));
      break;
    case 'fragment': {
      const firstBar = notes.filter((x) => x.s < g.n / 2 || (bars === 1 && x.s < g.n / 2));
      const frag = firstBar.length ? firstBar : notes.slice(0, 2);
      notes = [];
      for (let b = 0; b < bars; b++) for (const x of frag) notes.push({ ...x, s: b * g.n + (x.s % (g.n / 2)) + (b % 2 ? g.n / 2 : 0) });
      break;
    }
    case 'displace': {
      const by = pick(r, [2, 4, -2]);
      notes.forEach((x) => { x.s = ((x.s + by) % cycle + cycle) % cycle; });
      break;
    }
    case 'extend': {
      const last = notes.filter((x) => x.s >= (bars - 1) * g.n);
      for (const x of last) notes.push({ ...x, s: x.s + g.n, d: x.d + 1 });
      bars += 1;
      break;
    }
    case 'rests': {
      if (notes.length > 3) {
        const drop = new Set(shuffle(r, notes.slice(1)).slice(0, Math.min(2, Math.floor(notes.length / 4) || 1)));
        notes = notes.filter((x) => !drop.has(x));
      }
      break;
    }
    case 'embellish': {
      sortNotes(notes);
      const add: MNote[] = [];
      for (let i = 0; i + 1 < notes.length; i++) {
        const a = notes[i], b = notes[i + 1];
        if (Math.abs(b.d - a.d) >= 2 && b.s - a.s >= 2 && add.length < 2) {
          a.len = Math.max(1, Math.floor((b.s - a.s) / 2));
          add.push({ s: a.s + a.len, len: b.s - a.s - a.len, d: a.d + Math.sign(b.d - a.d), v: a.v * 0.85 });
        }
      }
      notes.push(...add);
      break;
    }
    case 'rhythm': {
      const x = pick(r, notes.slice(1).length ? notes.slice(1) : notes);
      const to = x.s + pick(r, [-1, 1, 2, -2]);
      if (to > 0 && to < cycle && !notes.some((y) => y.s === to)) x.s = to;
      else if (x.len >= 2) { const half = Math.floor(x.len / 2); notes.push({ ...x, s: x.s + half, len: x.len - half, v: x.v * 0.85 }); x.len = half; }
      break;
    }
  }
  sortNotes(notes);
  notes = notes.filter((x, i) => x.s >= 0 && x.s < bars * g.n && notes.findIndex((y) => y.s === x.s) === i);
  if (!notes.length) notes = m.notes.map((x) => ({ ...x }));
  return { ...m, id: `${m.id}+${op}`, ops: [...m.ops, op], notes, bars, octave };
}

/**
 * Gradual transformation: the first `frac` of the cycle comes from `to`, the
 * rest from `from`. Raising frac phrase by phrase morphs one motif into another.
 */
export function morphMotif(from: Motif, to: Motif, frac: number, g: Grid): Motif {
  const bars = Math.max(from.bars, to.bars);
  const cycle = bars * g.n;
  const cut = Math.round(frac * cycle);
  const expand = (m: Motif) => { const out: MNote[] = []; for (let b = 0; b < bars; b += m.bars) for (const x of m.notes) if (x.s + b * g.n < cycle) out.push({ ...x, s: x.s + b * g.n }); return out; };
  const notes = [...expand(to).filter((x) => x.s < cut), ...expand(from).filter((x) => x.s >= cut)];
  return { ...from, id: `${from.id}>${to.id}@${frac.toFixed(2)}`, kind: frac >= 0.5 ? to.kind : from.kind, label: frac >= 1 ? to.label : `${from.label} → ${to.label}`, bars, notes: sortNotes(notes), span: to.span, passing: to.passing };
}

export function motifLabel(m: Motif | null): string {
  if (!m) return 'no melody';
  const ops = [...new Set(m.ops)];
  return ops.length ? `${m.label} — ${ops.slice(-2).map((o) => MOTIF_OP_LABEL[o]).join(', ')}` : m.label;
}

/** Notes per beat: used to make secondary motifs contrast with the primary one. */
export function motifDensity(m: Motif, beats: number): number {
  return m.notes.length / (m.bars * beats);
}
