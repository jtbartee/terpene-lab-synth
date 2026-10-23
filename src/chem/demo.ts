// Built-in demonstration profiles. These are FICTIONAL artistic test profiles:
// they do not represent laboratory measurements, known cultivars, validated
// aromas or predicted effects. Values are relative weights (they need not sum
// to 100; the app always works with shares of the total).

import type { AnalyteId, Measurement, Profile } from './types';

const DEMO_NOTE = 'Fictional artistic test profile. Not a laboratory measurement, a known cultivar, a validated aroma or a predicted effect.';

function demo(id: string, name: string, weights: Partial<Record<AnalyteId, number>>, note = DEMO_NOTE): Profile {
  const measurements: Partial<Record<AnalyteId, Measurement>> = {};
  for (const [a, w] of Object.entries(weights) as [AnalyteId, number][]) {
    measurements[a] = { analyte: a, status: 'hypothetical', value: w, unit: 'relative_weight' };
  }
  return {
    schemaVersion: 1, id, kind: 'demo', name, unit: 'relative_weight', measurements,
    provenance: { sourceId: 'demo', productType: 'unknown', note },
    tags: ['demo'],
  };
}

// The brief specifies "Pinene: 10 %" without saying which isomer. α- and
// β-pinene are different compounds (and β-pinene is the larger of the two in
// about two-thirds of the Smith et al. samples), so the 10 is split equally.
export const DEMO_A = demo('demo-deep-botanical', 'Profile A — Deep Botanical', {
  myrcene: 40, limonene: 15, caryophyllene: 20, linalool: 15, a_pinene: 5, b_pinene: 5,
});

export const DEMO_B = demo('demo-bright-sequence', 'Profile B — Bright Sequence', {
  myrcene: 10, limonene: 35, caryophyllene: 25, terpinolene: 20, a_pinene: 5, b_pinene: 5,
});

export const DEMO_EXTRA: Profile[] = [
  demo('demo-resin-dusk', 'Resin Dusk (demo)', { caryophyllene: 34, humulene: 22, myrcene: 18, nerolidol: 10, bisabolol: 8, valencene: 8 }),
  demo('demo-cold-pine', 'Cold Pine (demo)', { a_pinene: 30, b_pinene: 22, camphene: 12, borneol: 10, fenchol: 10, myrcene: 16 }),
  demo('demo-petal-static', 'Petal Static (demo)', { linalool: 30, geraniol: 18, ocimene: 22, limonene: 18, bisabolol: 12 }),
];

export const DEMO_PROFILES: Profile[] = [DEMO_A, DEMO_B, ...DEMO_EXTRA];
