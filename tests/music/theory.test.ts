import { describe, expect, it } from 'vitest';
import {
  SCALES, chordSymbol, colourChord, degreeToMidi, diatonicChord, euclid, keyPc, scaleIntervals, scalePcs,
  totalMovement, transpose, voiceLead, type ScaleId,
} from '../../src/music/theory';

// Independent reference table (standard interval structures), not read from Tonal.
const REFERENCE: Record<ScaleId, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  natural_minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  major_pentatonic: [0, 2, 4, 7, 9],
  minor_pentatonic: [0, 3, 5, 7, 10],
  minor_blues: [0, 3, 5, 6, 7, 10],
  whole_tone: [0, 2, 4, 6, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

describe('scales', () => {
  it('supports all twelve required scales', () => {
    expect(SCALES.map((s) => s.id).sort()).toEqual(Object.keys(REFERENCE).sort());
  });
  it.each(Object.entries(REFERENCE))('%s has the standard interval structure', (id, iv) => {
    expect(scaleIntervals(id as ScaleId)).toEqual(iv);
  });
  it('A natural minor is A B C D E F G', () => {
    expect(scalePcs(keyPc('A'), 'natural_minor')).toEqual([9, 11, 0, 2, 4, 5, 7]);
  });
  it('degrees wrap by octave', () => {
    expect(degreeToMidi(57, 'natural_minor', 7)).toBe(69);
    expect(degreeToMidi(57, 'natural_minor', -1)).toBe(55); // G below A
  });
});

describe('chords', () => {
  const A = keyPc('A');
  it('builds diatonic triads by stacking scale thirds', () => {
    expect(diatonicChord(A, 'natural_minor', 0).pcs).toEqual([9, 0, 4]); // A C E
    expect(diatonicChord(A, 'natural_minor', 0).intervals).toEqual([0, 3, 7]); // minor
    expect(diatonicChord(A, 'natural_minor', 2).intervals).toEqual([0, 4, 7]); // C major
    expect(diatonicChord(A, 'natural_minor', 1).intervals).toEqual([0, 3, 6]); // B diminished
    expect(diatonicChord(A, 'harmonic_minor', 4).pcs).toEqual([4, 8, 11]); // E G# B — the major dominant
  });
  it('builds sevenths, add9 and suspended chords', () => {
    expect(colourChord(A, 'natural_minor', 0, 'seventh')).toEqual([9, 0, 4, 7]); // Am7
    expect(colourChord(A, 'natural_minor', 0, 'add9')).toEqual([9, 0, 4, 11]);
    expect(colourChord(A, 'natural_minor', 0, 'sus2')).toEqual([9, 11, 4]);
    expect(colourChord(A, 'natural_minor', 0, 'sus4')).toEqual([9, 2, 4]);
    expect(colourChord(A, 'natural_minor', 0, 'power')).toEqual([9, 4]);
    expect(chordSymbol([9, 0, 4, 7])).toBe('Am7');
    expect(chordSymbol([0, 4, 7, 11])).toBe('Cmaj7');
  });
  it('chord tones always belong to the scale', () => {
    for (const s of SCALES) {
      if (s.id === 'chromatic') continue;
      const pcs = new Set(scalePcs(A, s.id));
      const n = scaleIntervals(s.id).length;
      for (let d = 0; d < n; d++) {
        for (const kind of ['triad', 'seventh', 'add9', 'sus2', 'sus4', 'power'] as const) {
          for (const pc of colourChord(A, s.id, d, kind)) expect(pcs.has(pc)).toBe(true);
        }
      }
    }
  });
  it('transposition preserves interval relationships', () => {
    const c = [57, 60, 64, 67];
    const t = transpose(c, 5);
    expect(t.map((x, i) => x - c[i])).toEqual([5, 5, 5, 5]);
    expect(t.slice(1).map((x, i) => x - t[i])).toEqual(c.slice(1).map((x, i) => x - c[i]));
  });
});

describe('voice leading', () => {
  it('moves smoothly between common progressions', () => {
    const A = keyPc('A');
    let v = voiceLead(null, colourChord(A, 'natural_minor', 0, 'triad'), 52, 73);
    let total = 0;
    for (const d of [5, 6, 0, 3, 6, 0]) {
      const next = voiceLead(v, colourChord(A, 'natural_minor', d, 'triad'), 52, 73);
      total += totalMovement(v, next);
      for (const n of next) { expect(n).toBeGreaterThanOrEqual(52); expect(n).toBeLessThanOrEqual(73); }
      v = next;
    }
    expect(total / 6).toBeLessThanOrEqual(6); // average ≤ 2 semitones per voice
  });
  it('keeps the chord pitch classes', () => {
    const v = voiceLead([57, 60, 64], [5, 9, 0], 50, 75);
    expect(v.map((x) => x % 12).sort((a, b) => a - b)).toEqual([0, 5, 9]);
  });
});

describe('euclidean rhythms', () => {
  const s = (p: boolean[]) => p.map((x) => (x ? 'x' : '.')).join('');
  it('produces the canonical patterns (Toussaint 2005)', () => {
    expect(s(euclid(3, 8))).toBe('x..x..x.'); // tresillo
    expect(euclid(5, 8).filter(Boolean)).toHaveLength(5);
    expect(s(euclid(4, 16))).toBe('x...x...x...x...');
    expect(s(euclid(0, 4))).toBe('....');
  });
  it('rotates', () => {
    expect(s(euclid(3, 8, 1))).toBe('..x..x.x');
  });
});
