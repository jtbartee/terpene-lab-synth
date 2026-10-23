// Terpene-to-sound mapping engine.
//
// Pipeline (docs/SONIFICATION.md):
//   original measurement (unchanged)
//   → feature in 0..1 (relative share, or percentile vs Smith et al. flower)
//   → response curve
//   → contribution = amount × curve(feature)
//   → target = clamp(neutral + Σ contributions, 0, 1)
//   → audio engine maps 0..1 into a bounded musical range and ramps to it.
//
// These relationships are ARTISTIC design choices. They do not describe any
// psychological, physiological or acoustic property of the chemicals.

import { ANALYTE_IDS, analyte } from '../chem/analytes';
import population from '../chem/population.generated.json';
import { numericValue, relativeComposition } from '../chem/profile';
import type { AnalyteId, Profile } from '../chem/types';
import { isAbsoluteUnit } from '../chem/types';
import { convert } from '../chem/units';
import { TARGETS, type ParamSet, type TargetId } from './targets';

export type Curve = 'linear' | 'exponential' | 'logarithmic' | 'scurve';
export type FeatureBasis = 'auto' | 'relative' | 'percentile';
export type SonificationMode = 'analytical' | 'generative';

export interface Route { analyte: AnalyteId; target: TargetId; amount: number; curve: Curve; enabled: boolean }

export interface MappingPreset {
  id: string;
  name: string;
  basis: FeatureBasis;
  routes: Route[];
  builtIn?: boolean;
}

/** Relative shares are scaled so a 40 % share of the measured total reaches 1.0. */
export const RELATIVE_SATURATION = 0.4;

export function applyCurve(x: number, curve: Curve): number {
  const v = Math.max(0, Math.min(1, x));
  switch (curve) {
    case 'linear': return v;
    case 'exponential': return v * v;
    case 'logarithmic': return Math.log1p(9 * v) / Math.log(10);
    case 'scurve': return v * v * (3 - 2 * v);
  }
}

function r(analyteId: AnalyteId, target: TargetId, amount: number, curve: Curve = 'linear'): Route {
  return { analyte: analyteId, target, amount, curve, enabled: true };
}

/** The brief's default table: a primary (0.7) and secondary (0.4) influence per compound. */
export const DEFAULT_ROUTES: Route[] = [
  r('myrcene', 'droneDepth', 0.7), r('myrcene', 'lowHarmonics', 0.4),
  r('limonene', 'filterBrightness', 0.7), r('limonene', 'upperHarmonics', 0.4),
  r('caryophyllene', 'percComplexity', 0.7), r('caryophyllene', 'saturation', 0.4),
  r('a_pinene', 'pluckArticulation', 0.7), r('a_pinene', 'stereoMotion', 0.4),
  r('b_pinene', 'transientBrightness', 0.7), r('b_pinene', 'rhythmicDetail', 0.4),
  r('linalool', 'padEnvelope', 0.7), r('linalool', 'reverbDiffusion', 0.4),
  r('humulene', 'lowMidTexture', 0.7), r('humulene', 'filterResonance', 0.4),
  r('terpinolene', 'arpComplexity', 0.7), r('terpinolene', 'melodicMutation', 0.4),
  r('ocimene', 'hfModulation', 0.7), r('ocimene', 'sparkle', 0.4),
  r('nerolidol', 'slowModRate', 0.7), r('nerolidol', 'sustainTexture', 0.4),
  r('bisabolol', 'transitionSmoothness', 0.7), r('bisabolol', 'padBlend', 0.4),
  r('camphene', 'percTransients', 0.7), r('camphene', 'brightNoise', 0.4),
  r('borneol', 'resonantAccents', 0.7), r('borneol', 'modTexture', 0.4),
  r('fenchol', 'filterMovement', 0.7), r('fenchol', 'rhythmicArticulation', 0.4),
  r('geraniol', 'upperPads', 0.7), r('geraniol', 'overtones', 0.4),
  r('valencene', 'delayCharacter', 0.7), r('valencene', 'stereoMod', 0.4),
];

export const BUILT_IN_PRESETS: MappingPreset[] = [
  { id: 'brief-default', name: 'Default mapping (project brief)', basis: 'auto', routes: DEFAULT_ROUTES, builtIn: true },
  {
    id: 'primary-only', name: 'Primary influences only', basis: 'auto', builtIn: true,
    routes: DEFAULT_ROUTES.map((x, i) => ({ ...x, enabled: i % 2 === 0 })),
  },
  {
    id: 'timbre-only', name: 'Timbre only (no compositional routes)', basis: 'auto', builtIn: true,
    routes: DEFAULT_ROUTES.map((x) => ({ ...x, enabled: !TARGETS.find((t) => t.id === x.target)!.composition })),
  },
  {
    id: 'gentle-curves', name: 'Gentle (s-curves, reduced depth)', basis: 'auto', builtIn: true,
    routes: DEFAULT_ROUTES.map((x) => ({ ...x, amount: x.amount * 0.6, curve: 'scurve' as Curve })),
  },
  {
    id: 'percentile-wide', name: 'Population percentile (measured data)', basis: 'percentile', builtIn: true,
    routes: DEFAULT_ROUTES.map((x) => ({ ...x, curve: 'logarithmic' as Curve })),
  },
];

export interface Feature {
  analyte: AnalyteId;
  value: number | null;            // 0..1, null when the analyte is missing
  basis: 'relative' | 'percentile' | 'missing';
  note?: string;
}

const POP = population.analytes as unknown as Record<string, { quantiles: number[] } | undefined>;

/** Percentile rank (0..1) of a % w/w value among the Smith et al. flower samples. */
export function populationPercentile(id: AnalyteId, pctWw: number): number | null {
  const q = POP[id]?.quantiles;
  if (!q) return null;
  if (pctWw <= q[0]) return 0;
  if (pctWw >= q[100]) return 1;
  // interpolate within the 101 quantile points
  let i = 0;
  while (i < 100 && q[i + 1] < pctWw) i++;
  const lo = q[i], hi = q[i + 1];
  return (i + (hi > lo ? (pctWw - lo) / (hi - lo) : 0)) / 100;
}

export function computeFeatures(p: Profile, basis: FeatureBasis, disabled: ReadonlySet<AnalyteId> = new Set()): Record<AnalyteId, Feature> {
  const comp = relativeComposition(p, ANALYTE_IDS.filter((id) => !disabled.has(id)));
  const usePercentile = basis === 'percentile' || (basis === 'auto' && isAbsoluteUnit(p.unit));
  const out = {} as Record<AnalyteId, Feature>;
  for (const id of ANALYTE_IDS) {
    if (disabled.has(id) || !comp.covered.includes(id)) {
      out[id] = { analyte: id, value: null, basis: 'missing', note: disabled.has(id) ? 'Muted in the Lab' : 'Not measured — mapping disabled (never read as zero)' };
      continue;
    }
    if (usePercentile && isAbsoluteUnit(p.unit)) {
      const v = convert(numericValue(p.measurements[id]) ?? 0, p.unit, 'pct_w_w');
      const pct = v == null ? null : populationPercentile(id, v);
      if (pct != null) { out[id] = { analyte: id, value: pct, basis: 'percentile' }; continue; }
      out[id] = {
        analyte: id, value: Math.min(1, (comp.shares[id] ?? 0) / RELATIVE_SATURATION), basis: 'relative',
        note: `${analyte(id).label} has no population reference in the Smith et al. data; using its relative share.`,
      };
      continue;
    }
    out[id] = { analyte: id, value: Math.min(1, (comp.shares[id] ?? 0) / RELATIVE_SATURATION), basis: 'relative' };
  }
  return out;
}

export interface TargetValue {
  value: number;
  contributions: { analyte: AnalyteId; delta: number }[];
  /** true when every route into this target lacked data, so the neutral value is used */
  fallback: boolean;
  /** true when held neutral by Analytical mode */
  heldByMode: boolean;
}

export interface ControlState {
  features: Record<AnalyteId, Feature>;
  targets: Record<TargetId, TargetValue>;
  params: ParamSet;
}

export function computeControls(
  p: Profile | null,
  preset: MappingPreset,
  mode: SonificationMode,
  disabled: ReadonlySet<AnalyteId> = new Set(),
): ControlState {
  const features = p ? computeFeatures(p, preset.basis, disabled) : ({} as Record<AnalyteId, Feature>);
  const targets = {} as Record<TargetId, TargetValue>;
  const params = {} as ParamSet;
  for (const t of TARGETS) {
    const routes = preset.routes.filter((x) => x.enabled && x.target === t.id);
    const heldByMode = mode === 'analytical' && t.composition;
    const contributions: { analyte: AnalyteId; delta: number }[] = [];
    let anyData = false;
    if (!heldByMode) {
      for (const route of routes) {
        const f = features[route.analyte];
        if (!f || f.value == null) continue;
        anyData = true;
        const delta = route.amount * applyCurve(f.value, route.curve);
        if (delta !== 0) contributions.push({ analyte: route.analyte, delta });
      }
    }
    const raw = t.neutral + contributions.reduce((s, c) => s + c.delta, 0);
    const value = Math.max(0, Math.min(1, raw));
    targets[t.id] = { value, contributions: contributions.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)), fallback: routes.length > 0 && !anyData && !heldByMode, heldByMode };
    params[t.id] = value;
  }
  return { features, targets, params };
}

/** Linear interpolation of two parameter sets (profile morphing). */
export function lerpParams(a: ParamSet, b: ParamSet, t: number): ParamSet {
  const out = {} as ParamSet;
  for (const k of Object.keys(a) as TargetId[]) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Plain-language summary of the strongest data-driven influences. */
export function explainControls(c: ControlState, n = 5): string[] {
  const rows: { text: string; mag: number }[] = [];
  for (const t of TARGETS) {
    const tv = c.targets[t.id];
    for (const contrib of tv.contributions) {
      rows.push({ text: `${analyte(contrib.analyte).label} → ${t.label} (+${Math.round(contrib.delta * 100)})`, mag: Math.abs(contrib.delta) });
    }
  }
  return rows.sort((a, b) => b.mag - a.mag).slice(0, n).map((r2) => r2.text);
}
