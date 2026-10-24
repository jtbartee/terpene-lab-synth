// Compositional diversity. These tests measure what a listener would call
// "a different piece": drum and bass rhythms, note lengths, melodic rhythm and
// contour, and the order of sections — each compared independently of pitch
// and timbre — across seeds that share style, key, scale and profile. The v0.1
// engine (tests/music/legacy) is measured with the same metrics as a baseline.
// Metric definitions: docs/TESTING.md › "Diversity metrics".

import { describe, expect, it } from 'vitest';
import { DEMO_A, DEMO_B } from '../../src/chem/demo';
import {
  DRUM_GROUP, barPattern, brayCurtis, contourProfile, durationHistogram, editDistance, identityBars, mapBrayCurtis, meanPairwise,
  onsetHistogram, patternReuse, sectionSequence, type BarLike,
} from '../../src/music/analysis';
import { generateBars, type BarPlan } from '../../src/music/composer';
import type { StyleId } from '../../src/music/styles';
import { BUILT_IN_PRESETS, computeControls } from '../../src/sonify/mapping';
import { neutralParams } from '../../src/sonify/targets';
import { generateBars as legacyBars } from './legacy/composer-v1';

const P = neutralParams();
const SEEDS = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010, 1111, 1212];
const BARS = 192;
const RHYTHM_STYLES: StyleId[] = ['motorik', 'krautpop', 'dub_techno', 'berlin', 'microhouse'];

const pieces = (style: StyleId, extra = {}) => SEEDS.map((seed) => generateBars({ style, seed, key: 'A', scale: 'natural_minor', ...extra }, P, BARS));
const legacy = (style: StyleId) => SEEDS.map((seed) => legacyBars({ style, seed, key: 'A', scale: 'natural_minor' }, P, BARS) as unknown as BarLike[]);

const drumDist = (a: BarLike[], b: BarLike[]) => brayCurtis(onsetHistogram(a, DRUM_GROUP), onsetHistogram(b, DRUM_GROUP));
const bassDist = (a: BarLike[], b: BarLike[]) => brayCurtis(onsetHistogram(a, ['bass']), onsetHistogram(b, ['bass']));
const bassDurDist = (a: BarLike[], b: BarLike[]) => brayCurtis(durationHistogram(a, 'bass'), durationHistogram(b, 'bass'));
const melRhythmDist = (a: BarLike[], b: BarLike[]) => brayCurtis(onsetHistogram(a, ['arp']), onsetHistogram(b, ['arp']));
const contourDist = (a: BarLike[], b: BarLike[]) => mapBrayCurtis(contourProfile(a, 'arp'), contourProfile(b, 'arp'));

describe('diversity between compositions (same style, key, scale and profile; different seeds)', () => {
  for (const style of RHYTHM_STYLES) {
    it(`${style}: drum and bass rhythms differ far more than in v0.1, independently of pitch`, () => {
      const v2 = pieces(style);
      const v1 = legacy(style);
      // whole pieces
      expect(meanPairwise(v2, drumDist), 'drum onset dissimilarity').toBeGreaterThan(Math.max(0.2, 3 * meanPairwise(v1, drumDist)));
      expect(meanPairwise(v2, bassDist), 'bass onset dissimilarity').toBeGreaterThan(0.15);
      // identities (each piece's main section): a whole-piece average blurs pieces that contain contrasting sections.
      // v0.1 re-rolled hi-hats every bar, so part of its between-piece distance is noise; its within-piece
      // distance (two windows of the same piece) is that noise floor.
      const i2 = v2.map(identityBars), i1 = v1.map(identityBars);
      const noise = (f: typeof drumDist) => v1.reduce((s, p) => s + f(p.slice(16, 48), p.slice(48, 80)), 0) / v1.length;
      const dr2 = meanPairwise(i2, drumDist);
      expect(dr2, 'main-groove drum dissimilarity vs v0.1').toBeGreaterThan(2 * meanPairwise(i1, drumDist));
      expect(dr2, 'main-groove drum dissimilarity vs the v0.1 noise floor').toBeGreaterThan(noise(drumDist) + 0.08);
      const b2 = meanPairwise(i2, bassDist);
      // a running sequencer line is Berlin's identity, so its onsets necessarily overlap more
      expect(b2, 'main bass onset dissimilarity').toBeGreaterThan(style === 'berlin' ? 0.15 : 0.3);
      expect(b2, 'main bass onset dissimilarity vs v0.1').toBeGreaterThanOrEqual(meanPairwise(i1, bassDist) - 0.05);
      expect(new Set(i2.map((bars) => barPattern(bars[0], ['bass']))).size, 'distinct main bass rhythms').toBeGreaterThanOrEqual(5);
    });
  }

  it('bass note lengths, melodic rhythm and melodic contour vary between seeds', () => {
    for (const style of ['motorik', 'dub_techno', 'krautpop', 'kosmische', 'ambient'] as StyleId[]) {
      const v2 = pieces(style);
      expect(meanPairwise(v2, bassDurDist), `${style} bass durations`).toBeGreaterThan(0.2);
      expect(meanPairwise(v2, melRhythmDist), `${style} melodic rhythm`).toBeGreaterThan(0.25);
      expect(meanPairwise(v2, contourDist), `${style} contour`).toBeGreaterThan(0.25);
    }
  });

  it('the main groove itself differs: most seeds open on a different core drum or bass pattern', () => {
    for (const style of RHYTHM_STYLES) {
      const cores = pieces(style).map((bars) => {
        const main = bars.find((b) => b.section.role === 'main' || b.section.role === 'variation') ?? bars[16];
        return `${barPattern(main, ['kick', 'snare', 'clap'])}/${barPattern(main, ['bass'])}`;
      });
      expect(new Set(cores).size, `${style}: ${cores.length} seeds`).toBeGreaterThanOrEqual(5);
    }
  });

  it('arrangements differ: section orders vary between seeds', () => {
    for (const style of ['motorik', 'krautpop', 'dub_techno', 'berlin', 'kosmische'] as StyleId[]) {
      const seqs = pieces(style).map((bars) => sectionSequence(bars));
      expect(meanPairwise(seqs, editDistance), style).toBeGreaterThan(0.3);
      expect(new Set(pieces(style).map((bars) => bars[0].blueprint)).size, style).toBeGreaterThanOrEqual(2);
    }
  });

  it('two seeds can yield different phrase lengths and blueprints in one style', () => {
    const ps = pieces('motorik');
    expect(new Set(ps.map((b) => b[0].phraseBars)).size).toBeGreaterThanOrEqual(2);
  });

  it('pitch-only changes do not count as rhythmic diversity (the metric is pitch-blind)', () => {
    const a = pieces('motorik')[0];
    const transposed = a.map((b) => ({ ...b, events: b.events.map((e) => ({ ...e, notes: e.notes.map((n) => n + 5) })) }));
    expect(drumDist(a, transposed)).toBe(0);
    expect(bassDist(a, transposed)).toBe(0);
    expect(melRhythmDist(a, transposed)).toBe(0);
  });

  it('Groove diversity 0 keeps every seed on the canonical groove; higher settings widen the family', () => {
    const fam = (d: number) => new Set(pieces('motorik', { grooveDiversity: d }).map((bars) => bars.find((b) => b.material.groove !== 'no drums')?.material.groove.split(' (')[0]));
    expect(fam(0).size).toBe(1);
    expect(fam(1).size).toBeGreaterThanOrEqual(4);
  });
});

describe('identity within a composition', () => {
  const sectionBars = (bars: BarPlan[], role: string) => bars.filter((b) => b.section.role === role && b.section.cycle === 0);

  it('the groove is established: in A sections most bars repeat a small set of drum patterns', () => {
    for (const style of RHYTHM_STYLES) {
      for (const bars of pieces(style)) {
        // the first cycle: later endless cycles deliberately use a related main groove
        const a = bars.filter((b) => b.section.role === 'main' && b.section.cycle === 0 && b.layers.drums.on);
        if (a.length < 8) continue;
        const counts = new Map<string, number>();
        for (const b of a) { const p = barPattern(b, ['kick', 'snare', 'clap']); counts.set(p, (counts.get(p) ?? 0) + 1); }
        const top2 = [...counts.values()].sort((x, y) => y - x).slice(0, 2).reduce((s, x) => s + x, 0);
        expect(top2 / a.length, `${style}: ${a[0].material.groove}`).toBeGreaterThanOrEqual(0.75);
      }
    }
  });

  it('a return section brings back the original bass rhythm; a contrast section differs from it', () => {
    let checked = 0;
    for (const style of ['motorik', 'krautpop', 'berlin', 'dub_techno'] as StyleId[]) {
      for (const bars of pieces(style, { structure: 0.8 })) {
        const main = sectionBars(bars, 'main');
        const ret = sectionBars(bars, 'return');
        const con = sectionBars(bars, 'contrast');
        if (!main.length || !ret.length || !con.length) continue;
        checked++;
        expect(patternReuse(ret, main, ['bass']), `${style} return reuses A`).toBeGreaterThanOrEqual(0.6);
        const contrastDims = [
          bassDist(con, main) > 0.2,
          drumDist(con, main) > 0.15,
          melRhythmDist(con, main) > 0.2,
          con[0].chord.symbol !== main[0].chord.symbol,
        ].filter(Boolean).length;
        expect(contrastDims, `${style}: B differs from A in a major dimension`).toBeGreaterThanOrEqual(1);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(6);
  });

  it('the primary motif returns after developing or disappearing', () => {
    let returns = 0;
    for (const style of ['motorik', 'krautpop', 'kosmische', 'ambient', 'berlin'] as StyleId[]) {
      for (const bars of pieces(style)) {
        const ids = bars.map((b) => (b.layers.arp.on ? b.material.melodyId : '-'));
        const first = ids.find((x) => x !== '-');
        const away = ids.findIndex((x, i) => i > 0 && x !== first);
        if (first && away > 0 && ids.slice(away).includes(first)) returns++;
      }
    }
    expect(returns).toBeGreaterThanOrEqual(25); // of 40 pieces
  });

  it('endless pieces keep producing related new material rather than looping a few mutations', () => {
    const bars = generateBars({ style: 'motorik', seed: 4242 }, P, 640);
    const motifs = new Set(bars.map((b) => b.material.melodyId));
    const grooves = new Set(bars.map((b) => b.material.grooveId));
    expect(bars[bars.length - 1].section.cycle).toBeGreaterThanOrEqual(2);
    expect(motifs.size).toBeGreaterThanOrEqual(6);
    expect(grooves.size).toBeGreaterThanOrEqual(6);
    // …and the original groove keeps coming back
    const firstMain = bars.find((b) => b.section.role === 'main')!;
    const later = bars.filter((b) => b.section.cycle >= 1 && b.section.role === 'return');
    expect(later.length).toBeGreaterThan(0);
    expect(patternReuse(later, [firstMain], ['kick', 'snare'])).toBeGreaterThan(0.5);
  });
});

describe('style identity is preserved', () => {
  const nonBreak = (bars: BarPlan[]) => bars.filter((b) => b.layers.drums.on && !['breakdown', 'build', 'intro', 'outro'].includes(b.section.role));
  it('motorik keeps a kick on the downbeat and a driving eighth-note pulse', () => {
    for (const bars of pieces('motorik', { grooveDiversity: 1 })) {
      const dr = nonBreak(bars);
      const kick1 = dr.filter((b) => b.events.some((e) => e.voice === 'kick' && e.beat < 0.05)).length / dr.length;
      expect(kick1).toBeGreaterThanOrEqual(0.9);
      // an eighth pulse: hats, tambourine, bass or kick cover most eighth positions
      const covered = dr.filter((b) => {
        const steps = new Set(b.events.filter((e) => ['hatC', 'hatO', 'bass', 'kick'].includes(e.voice)).map((e) => Math.floor(e.beat * 2 + 0.2)));
        return steps.size >= 6;
      }).length / dr.length;
      expect(covered).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('dub techno and microhouse keep four on the floor', () => {
    for (const style of ['dub_techno', 'microhouse'] as StyleId[]) {
      for (const bars of pieces(style, { grooveDiversity: 1 })) {
        const dr = nonBreak(bars);
        const four = dr.filter((b) => [0, 1, 2, 3].every((q) => b.events.some((e) => e.voice === 'kick' && Math.abs(e.beat - q) < 0.05))).length / dr.length;
        expect(four, style).toBeGreaterThanOrEqual(0.85);
      }
    }
  });

  it('ambient and drone stay drumless', () => {
    for (const style of ['ambient', 'drone'] as StyleId[]) {
      for (const bars of pieces(style)) expect(bars.some((b) => b.events.some((e) => DRUM_GROUP.includes(e.voice)))).toBe(false);
    }
  });
});

describe('determinism and the analytical comparison', () => {
  it('identical seeds and inputs give byte-identical plans, materials and forms', () => {
    for (const style of RHYTHM_STYLES) {
      const a = generateBars({ style, seed: 77 }, P, 160);
      const b = generateBars({ style, seed: 77 }, P, 160);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('analytical mode: two profiles share the identical structure, grooves and motifs', () => {
    const preset = BUILT_IN_PRESETS[0];
    const pa = computeControls(DEMO_A, preset, 'analytical').params;
    const pb = computeControls(DEMO_B, preset, 'analytical').params;
    for (const style of ['motorik', 'dub_techno', 'ambient'] as StyleId[]) {
      const a = generateBars({ style, seed: 31337 }, pa, 128);
      const b = generateBars({ style, seed: 31337 }, pb, 128);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('generative mode: different profiles get different structures from one seed', () => {
    const preset = BUILT_IN_PRESETS[0];
    const pa = computeControls(DEMO_A, preset, 'generative').params;
    const pb = computeControls(DEMO_B, preset, 'generative').params;
    // the store folds a per-profile variant into the seed; here the variants are 1 and 2
    const a = generateBars({ style: 'motorik', seed: 31337, variant: 1 }, pa, 128);
    const b = generateBars({ style: 'motorik', seed: 31337, variant: 2 }, pb, 128);
    expect(drumDist(a, b) + bassDist(a, b) + editDistance(sectionSequence(a), sectionSequence(b))).toBeGreaterThan(0.3);
  });
});
