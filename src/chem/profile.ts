// Profile maths: relative composition, coverage, dominance, derivation and morphing.

import { ANALYTE_IDS, analyte } from './analytes';
import type { AnalyteId, Measurement, MeasurementStatus, Profile, Unit } from './types';
import { NUMERIC_STATUSES, ZERO_LIKE_STATUSES, isAbsoluteUnit } from './types';

/** The number a measurement contributes to composition maths, or null if it has none. */
export function numericValue(m: Measurement | undefined): number | null {
  if (!m) return null;
  if (NUMERIC_STATUSES.has(m.status) && m.value != null) return m.value;
  if (ZERO_LIKE_STATUSES.has(m.status)) return 0;
  return null;
}

/** True when the analyte was looked for (has a number or a zero-like status). */
export function isCovered(m: Measurement | undefined): boolean {
  return numericValue(m) != null;
}

export interface Composition {
  /** analyte -> share of the measured total, 0..1 (only covered analytes appear) */
  shares: Partial<Record<AnalyteId, number>>;
  total: number;
  covered: AnalyteId[];
  missing: AnalyteId[];
  /** analytes whose share is computed from a value at or below a reporting floor */
  floorValues: AnalyteId[];
}

/**
 * Relative composition: each covered analyte as a share of the summed covered
 * values. This is "% of measured terpenes", never % of sample mass. Analytes
 * that were not measured are listed as missing rather than treated as zero.
 */
export function relativeComposition(p: Profile, among: readonly AnalyteId[] = ANALYTE_IDS): Composition {
  const covered: AnalyteId[] = [];
  const missing: AnalyteId[] = [];
  const floorValues: AnalyteId[] = [];
  let total = 0;
  for (const id of among) {
    const m = p.measurements[id];
    const v = numericValue(m);
    if (v == null) { missing.push(id); continue; }
    covered.push(id);
    total += v;
    if (m?.status === 'at_floor') floorValues.push(id);
  }
  const shares: Partial<Record<AnalyteId, number>> = {};
  for (const id of covered) shares[id] = total > 0 ? numericValue(p.measurements[id])! / total : 0;
  return { shares, total, covered, missing, floorValues };
}

/** Covered analytes sorted by descending value. */
export function dominantAnalytes(p: Profile, n = 3): AnalyteId[] {
  if (p.kind === 'reported' && p.ranking) return p.ranking.slice(0, n);
  return ANALYTE_IDS
    .map((id) => [id, numericValue(p.measurements[id])] as const)
    .filter((e): e is readonly [AnalyteId, number] => e[1] != null && e[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map((e) => e[0]);
}

export function familyTotals(p: Profile): Record<string, number> {
  const comp = relativeComposition(p);
  const out: Record<string, number> = {};
  for (const id of comp.covered) {
    const f = analyte(id).family;
    out[f] = (out[f] ?? 0) + (comp.shares[id] ?? 0);
  }
  return out;
}

let idCounter = 0;
export function newId(prefix = 'p'): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function nowIso(): string { return new Date().toISOString(); }

/** A new empty hypothetical profile in relative-weight units. */
export function emptyHypothetical(name = 'Untitled mixture'): Profile {
  return {
    schemaVersion: 1,
    id: newId('hyp'),
    kind: 'hypothetical',
    name,
    unit: 'relative_weight',
    measurements: {},
    provenance: { sourceId: 'user', productType: 'unknown', note: 'User-defined hypothetical profile.' },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function hypotheticalFromWeights(name: string, weights: Partial<Record<AnalyteId, number>>, note?: string): Profile {
  const p = emptyHypothetical(name);
  for (const [id, w] of Object.entries(weights) as [AnalyteId, number][]) {
    p.measurements[id] = { analyte: id, status: 'hypothetical', value: w, unit: 'relative_weight' };
  }
  if (note) p.provenance.note = note;
  return p;
}

/**
 * Editing a measured (or demo) profile never touches the original: this returns
 * a derived hypothetical copy that remembers where it came from. Measured values
 * keep their unit but become 'hypothetical'; uncovered analytes stay absent.
 */
export function deriveHypothetical(src: Profile, name?: string): Profile {
  if (src.kind === 'hypothetical') return src;
  const measurements: Partial<Record<AnalyteId, Measurement>> = {};
  for (const id of ANALYTE_IDS) {
    const m = src.measurements[id];
    const v = numericValue(m);
    if (m && v != null) measurements[id] = { analyte: id, status: 'hypothetical', value: v, unit: src.unit };
  }
  return {
    schemaVersion: 1,
    id: newId('hyp'),
    kind: 'hypothetical',
    name: name ?? `${src.name} (edited)`,
    unit: src.unit === 'relative_pct' ? 'relative_weight' : src.unit,
    measurements,
    provenance: {
      sourceId: 'user',
      productType: src.provenance.productType,
      derivedFrom: { id: src.id, name: src.name, kind: src.kind },
      note: `Hypothetical profile derived from "${src.name}". The original data is unchanged.`,
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function setValue(p: Profile, id: AnalyteId, value: number | null): Profile {
  const measurements = { ...p.measurements };
  if (value == null) delete measurements[id];
  else measurements[id] = { analyte: id, status: 'hypothetical', value: Math.max(0, value), unit: p.unit };
  return { ...p, measurements, updatedAt: nowIso() };
}

export function duplicateProfile(p: Profile): Profile {
  return {
    ...structuredClone(p),
    id: newId(p.kind === 'hypothetical' ? 'hyp' : 'dup'),
    name: `${p.name} copy`,
    kind: p.kind === 'lab_sample' || p.kind === 'cultivar_aggregate' || p.kind === 'demo' ? 'hypothetical' : p.kind,
    provenance: p.kind === 'hypothetical' ? { ...p.provenance } : {
      sourceId: 'user', productType: p.provenance.productType,
      derivedFrom: { id: p.id, name: p.name, kind: p.kind },
      note: `Copy of "${p.name}".`,
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    favorite: false,
  };
}

/** Upper bound of a slider for a given unit. */
export function sliderMax(unit: Unit): number {
  if (unit === 'relative_weight' || unit === 'relative_pct') return 100;
  if (unit === 'pct_w_w') return 3;
  if (unit === 'mg_per_g') return 30;
  return 30000;
}

/**
 * Randomises a hypothetical profile within explicit bounds: 3–6 non-zero
 * analytes drawn from `pool`, weights 5–60, then rounded. Uses the supplied RNG
 * so results are reproducible.
 */
export function randomHypothetical(pool: readonly AnalyteId[], rand: () => number, name = 'Random mixture'): Profile {
  const k = 3 + Math.floor(rand() * 4);
  const picks = [...pool].sort(() => rand() - 0.5).slice(0, Math.min(k, pool.length));
  const weights: Partial<Record<AnalyteId, number>> = {};
  for (const id of picks) weights[id] = Math.round(5 + rand() * 55);
  return hypotheticalFromWeights(name, weights, 'Randomised hypothetical profile: 3–6 compounds, weights 5–60 (relative).');
}

/**
 * Interpolates two profiles' relative compositions. The result is a synthetic
 * transition, labelled as such — not a measured or predicted sample.
 */
export function morphProfiles(a: Profile, b: Profile, t: number): Profile {
  const ca = relativeComposition(a);
  const cb = relativeComposition(b);
  const measurements: Partial<Record<AnalyteId, Measurement>> = {};
  for (const id of ANALYTE_IDS) {
    const inA = ca.covered.includes(id);
    const inB = cb.covered.includes(id);
    if (!inA && !inB) continue;
    // an analyte measured on only one side is interpolated against 0 on the other,
    // which is a stated simplification for the synthetic transition
    const v = (1 - t) * (ca.shares[id] ?? 0) + t * (cb.shares[id] ?? 0);
    measurements[id] = { analyte: id, status: 'hypothetical', value: Math.round(v * 10000) / 100, unit: 'relative_pct' };
  }
  return {
    schemaVersion: 1,
    id: `morph-${a.id}-${b.id}`,
    kind: 'morph',
    name: `Morph ${Math.round(t * 100)} % · ${a.name} → ${b.name}`,
    unit: 'relative_pct',
    measurements,
    provenance: {
      sourceId: 'synthetic',
      productType: 'unknown',
      morphOf: { a: a.id, b: b.id, position: t },
      note: 'Synthetic transition between two profiles. Not a measured or predicted chemical sample.',
    },
  };
}

export function statusOf(p: Profile, id: AnalyteId): MeasurementStatus {
  return p.measurements[id]?.status ?? 'not_measured';
}

export const profileIsAbsolute = (p: Profile) => isAbsoluteUnit(p.unit);
