import { describe, expect, it } from 'vitest';
import { DEMO_A, DEMO_B } from '../../src/chem/demo';
import {
  deriveHypothetical, dominantAnalytes, hypotheticalFromWeights, morphProfiles, numericValue,
  randomHypothetical, relativeComposition, setValue,
} from '../../src/chem/profile';
import { buildLibraryFile, parseLibraryFile, validateProfile } from '../../src/chem/schema';
import type { Profile } from '../../src/chem/types';
import { canConvert, convert } from '../../src/chem/units';

function measured(values: Record<string, number | 'nd' | null>): Profile {
  const measurements: Profile['measurements'] = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === null) continue;
    (measurements as Record<string, unknown>)[k] = v === 'nd'
      ? { analyte: k, status: 'not_detected', value: null, unit: 'pct_w_w' }
      : { analyte: k, status: 'measured', value: v, unit: 'pct_w_w' };
  }
  return { schemaVersion: 1, id: 't', kind: 'lab_sample', name: 't', unit: 'pct_w_w', measurements, provenance: { sourceId: 'smith2022', productType: 'flower' } };
}

describe('units', () => {
  it('converts only between mass fractions', () => {
    expect(convert(1, 'pct_w_w', 'mg_per_g')).toBeCloseTo(10);
    expect(convert(5, 'mg_per_g', 'pct_w_w')).toBeCloseTo(0.5);
    expect(convert(10000, 'ppm_w_w', 'pct_w_w')).toBeCloseTo(1);
    expect(convert(40, 'relative_pct', 'pct_w_w')).toBeNull();
    expect(convert(40, 'relative_weight', 'mg_per_g')).toBeNull();
    expect(canConvert('relative_pct', 'pct_w_w')).toBe(false);
  });
});

describe('missing data is never a measured zero', () => {
  it('not-measured analytes are reported as missing, not zero', () => {
    const p = measured({ myrcene: 0.5, limonene: 0.25, caryophyllene: null });
    const c = relativeComposition(p, ['myrcene', 'limonene', 'caryophyllene']);
    expect(c.covered).toEqual(['myrcene', 'limonene']);
    expect(c.missing).toEqual(['caryophyllene']);
    expect(c.shares.caryophyllene).toBeUndefined();
  });

  it('not-detected counts as covered with zero contribution', () => {
    const p = measured({ myrcene: 0.6, limonene: 'nd' });
    expect(numericValue(p.measurements.limonene)).toBe(0);
    const c = relativeComposition(p, ['myrcene', 'limonene']);
    expect(c.covered).toContain('limonene');
    expect(c.shares.myrcene).toBeCloseTo(1);
  });

  it('rejected and not-reported values carry no number', () => {
    expect(numericValue({ analyte: 'myrcene', status: 'rejected', value: null, unit: 'pct_w_w' })).toBeNull();
    expect(numericValue({ analyte: 'myrcene', status: 'not_reported', value: null, unit: 'pct_w_w' })).toBeNull();
  });
});

describe('relative composition', () => {
  it('shares sum to 1 and match the demo weights', () => {
    const c = relativeComposition(DEMO_A);
    const sum = Object.values(c.shares).reduce((s, v) => s + (v ?? 0), 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(c.shares.myrcene).toBeCloseTo(0.4);
    expect(c.shares.limonene).toBeCloseTo(0.15);
  });

  it('dominant analytes are ordered', () => {
    expect(dominantAnalytes(DEMO_A, 3)).toEqual(['myrcene', 'caryophyllene', 'limonene']);
    expect(dominantAnalytes(DEMO_B, 2)).toEqual(['limonene', 'caryophyllene']);
  });
});

describe('derived hypothetical profiles', () => {
  it('editing a measured profile leaves the source untouched', () => {
    const src = measured({ myrcene: 0.5, limonene: 0.2 });
    const frozen = JSON.stringify(src);
    const hyp = setValue(deriveHypothetical(src), 'myrcene', 0.9);
    expect(JSON.stringify(src)).toBe(frozen);
    expect(hyp.kind).toBe('hypothetical');
    expect(hyp.provenance.derivedFrom?.id).toBe('t');
    expect(hyp.measurements.myrcene?.status).toBe('hypothetical');
    expect(hyp.measurements.myrcene?.value).toBe(0.9);
    expect(hyp.unit).toBe('pct_w_w');
  });

  it('randomised profiles stay inside the documented bounds and are reproducible', () => {
    const mk = () => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
    const a = randomHypothetical(['myrcene', 'limonene', 'linalool', 'humulene', 'camphene', 'borneol'], mk());
    const b = randomHypothetical(['myrcene', 'limonene', 'linalool', 'humulene', 'camphene', 'borneol'], mk());
    expect(a.measurements).toEqual(b.measurements);
    const vals = Object.values(a.measurements).map((m) => m!.value!);
    expect(vals.length).toBeGreaterThanOrEqual(3);
    expect(vals.length).toBeLessThanOrEqual(6);
    for (const v of vals) { expect(v).toBeGreaterThanOrEqual(5); expect(v).toBeLessThanOrEqual(60); }
  });

  it('morph endpoints reproduce each profile composition and are labelled synthetic', () => {
    const m0 = morphProfiles(DEMO_A, DEMO_B, 0);
    const m1 = morphProfiles(DEMO_A, DEMO_B, 1);
    expect(m0.measurements.myrcene?.value).toBeCloseTo(40);
    expect(m1.measurements.limonene?.value).toBeCloseTo(35);
    expect(m0.kind).toBe('morph');
    expect(m0.provenance.note).toMatch(/not a measured/i);
  });
});

describe('schema validation', () => {
  it('accepts the demo profiles', () => {
    expect(validateProfile(DEMO_A).ok).toBe(true);
    expect(validateProfile(hypotheticalFromWeights('x', { myrcene: 3 })).ok).toBe(true);
  });

  it('rejects impossible values', () => {
    const bad = structuredClone(DEMO_A);
    bad.measurements.myrcene!.value = -1;
    expect(validateProfile(bad).ok).toBe(false);
    const over = measured({ myrcene: 120 });
    expect(validateProfile(over).ok).toBe(false);
  });

  it('rejects a status/value mismatch (missing data dressed as a number)', () => {
    const p = measured({ myrcene: 0.5 });
    p.measurements.myrcene = { analyte: 'myrcene', status: 'not_measured', value: 0, unit: 'pct_w_w' };
    expect(validateProfile(p).ok).toBe(false);
  });

  it('rejects unknown analytes and unit mismatches', () => {
    const p = measured({ myrcene: 0.5 }) as unknown as { measurements: Record<string, unknown> };
    p.measurements.unobtainium = { analyte: 'unobtainium', status: 'measured', value: 1, unit: 'pct_w_w' };
    expect(validateProfile(p).ok).toBe(false);
    const q = measured({ myrcene: 0.5 });
    q.measurements.myrcene!.unit = 'mg_per_g';
    expect(validateProfile(q).ok).toBe(false);
  });

  it('round-trips a library file and reports bad items individually', () => {
    const file = buildLibraryFile([DEMO_A, DEMO_B]);
    const back = parseLibraryFile(file);
    expect(back.errors).toEqual([]);
    expect(back.profiles.map((p) => p.id)).toEqual([DEMO_A.id, DEMO_B.id]);
    const tampered = JSON.parse(file);
    tampered.profiles.push({ schemaVersion: 1, id: 'x' });
    const r = parseLibraryFile(JSON.stringify(tampered));
    expect(r.profiles).toHaveLength(2);
    expect(r.errors).toHaveLength(1);
  });

  it('refuses newer schema versions and non-JSON input', () => {
    expect(parseLibraryFile('not json').errors[0]).toMatch(/not valid JSON/);
    const file = JSON.parse(buildLibraryFile([DEMO_A]));
    file.version = 99;
    expect(parseLibraryFile(JSON.stringify(file)).errors[0]).toMatch(/newer/);
  });
});
