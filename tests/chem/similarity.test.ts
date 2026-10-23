import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cultivarProfile, ctProfile, smithSampleProfile, type CtRegistry, type SmithCultivars, type SmithSamples } from '../../src/chem/datasets';
import { DEMO_A, DEMO_B } from '../../src/chem/demo';
import { hypotheticalFromWeights } from '../../src/chem/profile';
import { compareProfiles, confidenceFor, jensenShannonSimilarity, rankBiasedOverlap } from '../../src/chem/similarity';
import type { Profile } from '../../src/chem/types';
import { SOURCES } from '../../src/chem/sources';

const smith = JSON.parse(readFileSync('public/data/smith-samples.json', 'utf8')) as SmithSamples;
const cultivars = JSON.parse(readFileSync('public/data/smith-cultivars.json', 'utf8')) as SmithCultivars;
const ct = JSON.parse(readFileSync('public/data/ct-flower.json', 'utf8')) as CtRegistry;

describe('similarity metric', () => {
  it('is 1 for identical profiles and symmetric', () => {
    const r = compareProfiles(DEMO_A, DEMO_A);
    expect(r.score).toBeCloseTo(1, 10);
    expect(compareProfiles(DEMO_A, DEMO_B).score).toBeCloseTo(compareProfiles(DEMO_B, DEMO_A).score!, 12);
  });

  it('is scale invariant (relative composition)', () => {
    const doubled = hypotheticalFromWeights('x2', { myrcene: 80, limonene: 30, caryophyllene: 40, linalool: 30, a_pinene: 10, b_pinene: 10 });
    expect(compareProfiles(DEMO_A, doubled).score).toBeCloseTo(1, 10);
  });

  it('is bounded in [0,1] and 0 for disjoint support', () => {
    expect(jensenShannonSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
    expect(jensenShannonSimilarity([0.5, 0.5], [0.5, 0.5])).toBeCloseTo(1, 10);
  });

  it('only compares shared analytes and reports the rest', () => {
    const a = hypotheticalFromWeights('a', { myrcene: 50, limonene: 50, valencene: 30 });
    const b = hypotheticalFromWeights('b', { myrcene: 50, limonene: 50, geraniol: 30 });
    const r = compareProfiles(a, b);
    expect(r.shared).toEqual(['myrcene', 'limonene']);
    expect(r.onlyA).toEqual(['valencene']);
    expect(r.onlyB).toEqual(['geraniol']);
    expect(r.score).toBeCloseTo(1, 10); // identical on what they share…
    expect(r.confidence).toBe('insufficient'); // …but that says very little
    expect(r.coverage).toBeCloseTo(0.5);
  });

  it('confidence follows the validated thresholds', () => {
    expect(confidenceFor(14)).toBe('high');
    expect(confidenceFor(8)).toBe('high');
    expect(confidenceFor(6)).toBe('moderate');
    expect(confidenceFor(3)).toBe('low');
    expect(confidenceFor(2)).toBe('insufficient');
  });

  it('demo A and B are distinguishable and the explanation names the differences', () => {
    const r = compareProfiles(DEMO_A, DEMO_B);
    expect(r.score).toBeLessThan(0.9);
    expect(r.explanation.join(' ')).toMatch(/Terpinolene|Myrcene/);
    expect(r.absoluteDiffs).toBeNull(); // relative units cannot give absolute differences
  });

  it('descriptive profiles get an approximate rank comparison', () => {
    const reported: Profile = { ...DEMO_A, id: 'r', kind: 'reported', ranking: ['myrcene', 'caryophyllene', 'limonene'], measurements: {} };
    const r = compareProfiles(reported, DEMO_A);
    expect(r.method).toBe('rank_overlap');
    expect(r.approximate).toBe(true);
    expect(rankBiasedOverlap(['myrcene', 'limonene'], ['myrcene', 'limonene'])).toBeCloseTo(1);
  });
});

describe('dataset adapters', () => {
  it('Smith samples keep their source, units and floor flags', () => {
    let floorSeen = false;
    let ndSeen = false;
    for (let i = 0; i < 400; i++) {
      const p = smithSampleProfile(smith, i);
      expect(p.provenance.sourceId).toBe('smith2022');
      expect(p.provenance.productType).toBe('flower');
      expect(p.unit).toBe('pct_w_w');
      for (const m of Object.values(p.measurements)) {
        if (m!.status === 'at_floor') { floorSeen = true; expect(m!.flags).toContain('at_reporting_floor'); expect(m!.value!).toBeLessThanOrEqual(m!.floor! + 1e-9); }
        if (m!.status === 'not_detected') { ndSeen = true; expect(m!.value).toBeNull(); }
        if (m!.status === 'measured') expect(m!.value!).toBeGreaterThan(0);
      }
    }
    expect(floorSeen).toBe(true);
    expect(ndSeen).toBe(true);
  });

  it('Smith values are plausible flower terpene levels (≤ 5 % w/w each)', () => {
    for (const col of smith.rows.values) for (const v of col) expect(v / smith.scale).toBeLessThanOrEqual(5);
  });

  it('cultivar aggregates are labelled as aggregates, not strain definitions', () => {
    const c = cultivars.cultivars.find((x) => x.slug === 'blue-dream')!;
    const p = cultivarProfile(c);
    expect(p.kind).toBe('cultivar_aggregate');
    expect(p.provenance.note).toMatch(/not a chemical definition/);
    expect(c.n).toBeGreaterThanOrEqual(3);
    const m = p.measurements.myrcene!;
    expect(m.stats!.q1).toBeLessThanOrEqual(m.value!);
    expect(m.stats!.q3).toBeGreaterThanOrEqual(m.value!);
  });

  it('CT zeros are ambiguous not-detected and every value flags the undocumented unit', () => {
    let zero = 0;
    for (let i = 0; i < ct.rows.reg.length; i++) {
      const p = ctProfile(ct, i);
      for (const m of Object.values(p.measurements)) {
        expect(m!.flags).toContain('unit_basis_undocumented');
        if (m!.status === 'not_detected') { zero++; expect(m!.flags).toContain('zero_ambiguous'); }
        if (m!.status === 'measured') expect(m!.value!).toBeLessThanOrEqual(ct.maxPlausible);
      }
    }
    expect(zero).toBeGreaterThan(0);
  });

  it('every source used by the adapters is registered with a licence', () => {
    for (const id of ['smith2022', 'ctRegistry', 'pubchem', 'demo', 'user', 'synthetic']) {
      expect(SOURCES[id]).toBeDefined();
      expect(SOURCES[id].license.length).toBeGreaterThan(0);
    }
  });

  it('two samples of one product are more similar than random pairs on average', () => {
    // a cheap replication of the validation script, as a regression guard
    const byKey = new Map<string, number[]>();
    for (let i = 0; i < smith.rows.id.length; i++) {
      const k = `${smith.rows.cultivar[i]}|${smith.rows.producer[i]}`;
      if (smith.rows.cultivar[i] < 0 || smith.rows.producer[i] < 0) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(i);
    }
    const groups = [...byKey.values()].filter((g) => g.length >= 2).slice(0, 300);
    const same = groups.map((g) => compareProfiles(smithSampleProfile(smith, g[0]), smithSampleProfile(smith, g[1])).score!);
    const rand = groups.map((g, i) => compareProfiles(smithSampleProfile(smith, g[0]), smithSampleProfile(smith, groups[(i * 7 + 13) % groups.length][1])).score!);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean(same)).toBeGreaterThan(mean(rand) + 0.1);
  });
});
