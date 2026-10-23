// Music theory: scales (via Tonal), diatonic chord construction, voice leading,
// Euclidean rhythms.

import { Chord, Interval, Note, Scale } from 'tonal';

export type ScaleId =
  | 'major' | 'natural_minor' | 'harmonic_minor' | 'melodic_minor' | 'dorian' | 'phrygian'
  | 'mixolydian' | 'major_pentatonic' | 'minor_pentatonic' | 'minor_blues' | 'whole_tone' | 'chromatic';

export interface ScaleInfo { id: ScaleId; label: string; tonalName: string; experimental: boolean; note?: string }

export const SCALES: ScaleInfo[] = [
  { id: 'natural_minor', label: 'Natural minor (Aeolian)', tonalName: 'minor', experimental: false },
  { id: 'major', label: 'Major (Ionian)', tonalName: 'major', experimental: false },
  { id: 'harmonic_minor', label: 'Harmonic minor', tonalName: 'harmonic minor', experimental: false },
  { id: 'melodic_minor', label: 'Melodic minor (ascending)', tonalName: 'melodic minor', experimental: false },
  { id: 'dorian', label: 'Dorian', tonalName: 'dorian', experimental: false },
  { id: 'phrygian', label: 'Phrygian', tonalName: 'phrygian', experimental: false },
  { id: 'mixolydian', label: 'Mixolydian', tonalName: 'mixolydian', experimental: false },
  { id: 'major_pentatonic', label: 'Major pentatonic', tonalName: 'major pentatonic', experimental: false },
  { id: 'minor_pentatonic', label: 'Minor pentatonic', tonalName: 'minor pentatonic', experimental: false },
  { id: 'minor_blues', label: 'Minor blues', tonalName: 'minor blues', experimental: false },
  { id: 'whole_tone', label: 'Whole-tone (experimental)', tonalName: 'whole tone', experimental: true, note: 'Symmetric scale with no perfect fifth above the tonic; chords built from it are augmented.' },
  { id: 'chromatic', label: 'Chromatic (experimental)', tonalName: 'chromatic', experimental: true, note: 'Every pitch class is allowed. Harmony falls back to natural-minor chords on the tonic so the music still has a centre.' },
];

export const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export type KeyName = (typeof KEYS)[number];
export const keyPc = (k: KeyName) => KEYS.indexOf(k);

const intervalCache = new Map<ScaleId, number[]>();
/** Semitone offsets of a scale from its tonic, ascending, within one octave. */
export function scaleIntervals(id: ScaleId): number[] {
  const hit = intervalCache.get(id);
  if (hit) return hit;
  const info = SCALES.find((s) => s.id === id);
  if (!info) throw new Error(`unknown scale ${id}`);
  const s = Scale.get(`C ${info.tonalName}`);
  if (s.empty) throw new Error(`Tonal has no scale "${info.tonalName}"`);
  const iv = s.intervals.map((i) => Interval.semitones(i) ?? 0);
  intervalCache.set(id, iv);
  return iv;
}

/** Pitch classes (0–11) of a scale on a tonic. */
export function scalePcs(tonicPc: number, id: ScaleId): number[] {
  return scaleIntervals(id).map((i) => (tonicPc + i) % 12);
}

export function inScale(midi: number, tonicPc: number, id: ScaleId): boolean {
  return scalePcs(tonicPc, id).includes(((midi % 12) + 12) % 12);
}

/** All scale notes between lo and hi (inclusive), ascending. */
export function scaleNotesInRange(tonicPc: number, id: ScaleId, lo: number, hi: number): number[] {
  const pcs = new Set(scalePcs(tonicPc, id));
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.has(((m % 12) + 12) % 12)) out.push(m);
  return out;
}

/**
 * MIDI note of a scale degree (0-based, may be negative or exceed the scale
 * length — it wraps by octaves) relative to the tonic at `tonicMidi`.
 */
export function degreeToMidi(tonicMidi: number, id: ScaleId, degree: number): number {
  const iv = scaleIntervals(id);
  const n = iv.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return tonicMidi + oct * 12 + iv[idx];
}

/** The scale used for harmony. Chromatic harmony borrows natural minor (documented). */
export function harmonyScale(id: ScaleId): ScaleId {
  return id === 'chromatic' ? 'natural_minor' : id;
}

/**
 * Diatonic chord on a scale degree by stacking every other scale tone
 * ("thirds" in a seven-note scale; quartal-type stacks in pentatonic scales).
 * Returns pitch classes from the root upward, plus semitone intervals.
 */
export function diatonicChord(tonicPc: number, scale: ScaleId, degree: number, size = 3): { pcs: number[]; intervals: number[]; rootPc: number } {
  const hs = harmonyScale(scale);
  const iv = scaleIntervals(hs);
  const n = iv.length;
  const steps: number[] = [];
  for (let k = 0; k < size; k++) steps.push(degree + 2 * k);
  const semis = steps.map((s) => {
    const oct = Math.floor(s / n);
    return iv[((s % n) + n) % n] + 12 * oct;
  });
  const root = semis[0];
  return {
    rootPc: (tonicPc + root) % 12,
    pcs: semis.map((s) => (tonicPc + s) % 12),
    intervals: semis.map((s) => s - root),
  };
}

/** Adds a colour tone (scale step above the root) e.g. add9 = 1 step, sus4 replaces the 3rd. */
export function colourChord(tonicPc: number, scale: ScaleId, degree: number, kind: 'triad' | 'seventh' | 'add9' | 'sus2' | 'sus4' | 'power' | 'ninth'): number[] {
  const hs = harmonyScale(scale);
  const iv = scaleIntervals(hs);
  const n = iv.length;
  const at = (s: number) => {
    const oct = Math.floor(s / n);
    return (tonicPc + iv[((s % n) + n) % n] + 12 * oct) % 12;
  };
  switch (kind) {
    case 'triad': return [at(degree), at(degree + 2), at(degree + 4)];
    case 'seventh': return [at(degree), at(degree + 2), at(degree + 4), at(degree + 6)];
    case 'ninth': return [at(degree), at(degree + 2), at(degree + 4), at(degree + 6), at(degree + 8)];
    case 'add9': return [at(degree), at(degree + 2), at(degree + 4), at(degree + 1)];
    case 'sus2': return [at(degree), at(degree + 1), at(degree + 4)];
    case 'sus4': return [at(degree), at(degree + 3), at(degree + 4)];
    case 'power': return [at(degree), at(degree + 4)];
  }
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const pcName = (pc: number) => NAMES[((pc % 12) + 12) % 12];
export const midiName = (m: number) => Note.fromMidi(m);

/** Best-effort chord symbol for display (Tonal detection, root-first). */
export function chordSymbol(pcs: number[]): string {
  if (pcs.length === 2) return `${pcName(pcs[0])}5`;
  const names = pcs.map(pcName);
  const detected = Chord.detect(names);
  const rooted = detected.find((d) => d.startsWith(names[0]) && !d.includes('/'));
  return rooted ?? detected[0] ?? names.join('-');
}

/**
 * Voice leading: places chord pitch classes into a register so the total
 * movement from the previous voicing is minimal. Candidates are every
 * inversion of the close-position chord at every octave whose notes fit in
 * [lo, hi]; voices are compared after sorting.
 */
export function voiceLead(prev: number[] | null, pcs: number[], lo: number, hi: number, inversionBias = 0): number[] {
  const candidates: number[][] = [];
  const k = pcs.length;
  for (let inv = 0; inv < k; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    for (let base = lo - 12; base <= hi; base++) {
      if (((base % 12) + 12) % 12 !== order[0]) continue;
      const v: number[] = [base];
      for (let j = 1; j < k; j++) {
        let m = v[j - 1] + 1;
        while (((m % 12) + 12) % 12 !== order[j]) m++;
        v.push(m);
      }
      if (v[0] >= lo && v[v.length - 1] <= hi) candidates.push(v);
    }
  }
  if (!candidates.length) {
    // fall back: root position from lo
    const v = [lo + ((pcs[0] - lo) % 12 + 12) % 12];
    for (let j = 1; j < k; j++) { let m = v[j - 1] + 1; while (((m % 12) + 12) % 12 !== pcs[j]) m++; v.push(m); }
    return v;
  }
  if (!prev || !prev.length) {
    const centre = (lo + hi) / 2;
    return candidates.sort((a, b) => Math.abs(mean(a) - centre) - Math.abs(mean(b) - centre))[Math.min(candidates.length - 1, Math.max(0, inversionBias))];
  }
  const ps = [...prev].sort((a, b) => a - b);
  const cost = (v: number[]) => {
    let c = 0;
    for (let i = 0; i < v.length; i++) c += Math.abs(v[i] - (ps[Math.min(i, ps.length - 1)] ?? v[i]));
    return c + Math.abs(v.length - ps.length) * 2;
  };
  const sorted = candidates.map((v) => [cost(v), v] as const).sort((a, b) => a[0] - b[0]);
  return [...sorted[Math.min(sorted.length - 1, Math.max(0, inversionBias))][1]];
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

export function totalMovement(a: number[], b: number[]): number {
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  let c = 0;
  for (let i = 0; i < Math.min(x.length, y.length); i++) c += Math.abs(x[i] - y[i]);
  return c;
}

/**
 * Euclidean rhythm E(k, n): k onsets spread as evenly as possible over n steps
 * (Bjorklund's algorithm as described by Toussaint 2005), rotated by `rotate`.
 */
export function euclid(k: number, n: number, rotate = 0): boolean[] {
  if (n <= 0) return [];
  const kk = Math.max(0, Math.min(k, n));
  // onset where (i·k) mod n < k: E(3,8) = x..x..x. (tresillo), step 0 always an onset
  const base: boolean[] = [];
  for (let i = 0; i < n; i++) base.push((i * kk) % n < kk);
  const r = ((rotate % n) + n) % n;
  return [...base.slice(r), ...base.slice(0, r)];
}

export function transpose(notes: number[], semis: number): number[] {
  return notes.map((n) => n + semis);
}

/** Groupings of beats used for accent placement in each supported metre. */
export const METER_GROUPS: Record<number, number[]> = { 3: [3], 4: [2, 2], 5: [3, 2], 7: [2, 2, 3] };
