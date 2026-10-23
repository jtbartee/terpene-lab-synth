// Profile comparison.
//
// Primary metric (quantified profiles): 1 − Jensen–Shannon distance (log base 2)
// between the two relative compositions, each renormalised over the analytes
// BOTH profiles cover. Bounded 0..1, symmetric, defined when a share is zero.
// Cosine similarity on the same vectors is reported alongside (Smith et al. 2022
// used cosine distance for product consistency).
//
// Choice validated by scripts/validate-similarity.mjs on 43,148 flower samples:
// same-product sample pairs vs random pairs, ROC AUC by number of shared
// analytes (k). JSD scored best at every k for relative profiles:
//   k=14 0.909 · k=8 0.892 · k=6 0.879 · k=5 0.868 · k=4 0.848 · k=3 0.820 · k=2 0.741
// Rank correlation collapsed at low coverage (k=3: 0.473), so ranked profiles
// use a separate, explicitly approximate method.

import { ANALYTE_IDS, analyte } from './analytes';
import population from './population.generated.json';
import { dominantAnalytes, numericValue, relativeComposition } from './profile';
import type { AnalyteId, Profile } from './types';
import { isAbsoluteUnit } from './types';
import { convert } from './units';

export type Confidence = 'high' | 'moderate' | 'low' | 'insufficient';

export const VALIDATION_AUC: Record<number, number> = { 14: 0.909, 10: 0.898, 8: 0.892, 6: 0.879, 5: 0.868, 4: 0.848, 3: 0.82, 2: 0.741 };

export function confidenceFor(sharedCount: number): Confidence {
  if (sharedCount >= 8) return 'high';
  if (sharedCount >= 5) return 'moderate';
  if (sharedCount >= 3) return 'low';
  return 'insufficient';
}

export interface Contribution { analyte: AnalyteId; shareA: number; shareB: number; divergence: number }

export interface SimilarityResult {
  method: 'jensen_shannon' | 'rank_overlap';
  approximate: boolean;
  score: number | null;
  cosine: number | null;
  shared: AnalyteId[];
  onlyA: AnalyteId[];
  onlyB: AnalyteId[];
  coverage: number;
  confidence: Confidence;
  /** Fraction of random flower-sample pairs (Smith et al.) scoring lower. */
  percentileVsRandom: number | null;
  contributions: Contribution[];
  absoluteDiffs: { analyte: AnalyteId; a: number; b: number; diff: number }[] | null;
  explanation: string[];
}

function jsDivergenceTerms(p: number[], q: number[]): number[] {
  return p.map((pi, i) => {
    const qi = q[i];
    const m = (pi + qi) / 2;
    let t = 0;
    if (pi > 0) t += 0.5 * pi * Math.log2(pi / m);
    if (qi > 0) t += 0.5 * qi * Math.log2(qi / m);
    return t;
  });
}

export function jensenShannonSimilarity(p: number[], q: number[]): number {
  const js = jsDivergenceTerms(p, q).reduce((s, v) => s + v, 0);
  return 1 - Math.sqrt(Math.max(0, Math.min(1, js)));
}

export function cosineSimilarity(p: number[], q: number[]): number | null {
  let d = 0, a = 0, b = 0;
  for (let i = 0; i < p.length; i++) { d += p[i] * q[i]; a += p[i] * p[i]; b += q[i] * q[i]; }
  return a > 0 && b > 0 ? d / Math.sqrt(a * b) : null;
}

function normalise(v: number[]): number[] | null {
  const t = v.reduce((s, x) => s + x, 0);
  return t > 0 ? v.map((x) => x / t) : null;
}

export function percentileAmongRandomPairs(score: number): number {
  const q = population.randomPairSimilarity as number[];
  let lo = 0;
  while (lo < q.length - 1 && q[lo + 1] <= score) lo++;
  return lo / (q.length - 1);
}

const fmtPct = (x: number) => `${(x * 100).toFixed(1)} %`;
const label = (id: AnalyteId) => analyte(id).label;

/** Rank-biased overlap (Webber et al. 2010) of two top-k lists, persistence p. */
export function rankBiasedOverlap(a: AnalyteId[], b: AnalyteId[], p = 0.8): number {
  const k = Math.max(a.length, b.length);
  if (!k) return 0;
  let sum = 0;
  for (let d = 1; d <= k; d++) {
    const A = new Set(a.slice(0, d));
    const overlap = b.slice(0, d).filter((x) => A.has(x)).length;
    sum += Math.pow(p, d - 1) * (overlap / d);
  }
  // normalise so identical lists of length k score 1
  let max = 0;
  for (let d = 1; d <= k; d++) max += Math.pow(p, d - 1);
  return sum / max;
}

function rankingOf(p: Profile): AnalyteId[] {
  return p.kind === 'reported' && p.ranking ? p.ranking : dominantAnalytes(p, 5);
}

export function compareProfiles(A: Profile, B: Profile): SimilarityResult {
  const ranked = A.kind === 'reported' || B.kind === 'reported';
  if (ranked) {
    const ra = rankingOf(A), rb = rankingOf(B);
    const score = rankBiasedOverlap(ra, rb);
    const shared = ra.filter((x) => rb.includes(x));
    return {
      method: 'rank_overlap', approximate: true, score, cosine: null, shared,
      onlyA: ra.filter((x) => !rb.includes(x)), onlyB: rb.filter((x) => !ra.includes(x)),
      coverage: shared.length / Math.max(1, new Set([...ra, ...rb]).size),
      confidence: 'low', percentileVsRandom: null, contributions: [], absoluteDiffs: null,
      explanation: [
        'At least one profile is descriptive (ranked dominant compounds only), so this is an approximate rank comparison — rank-biased overlap of the top compounds — not a laboratory-style similarity.',
        shared.length ? `Both rank ${shared.map(label).join(', ')} among their leading compounds.` : 'The two profiles share none of their leading compounds.',
      ],
    };
  }

  const ca = relativeComposition(A);
  const cb = relativeComposition(B);
  const shared = ANALYTE_IDS.filter((id) => ca.covered.includes(id) && cb.covered.includes(id));
  const onlyA = ca.covered.filter((id) => !shared.includes(id));
  const onlyB = cb.covered.filter((id) => !shared.includes(id));
  const union = new Set([...ca.covered, ...cb.covered]).size;
  const coverage = union ? shared.length / union : 0;
  const confidence = confidenceFor(shared.length);

  const rawA = shared.map((id) => numericValue(A.measurements[id]) ?? 0);
  const rawB = shared.map((id) => numericValue(B.measurements[id]) ?? 0);
  const p = normalise(rawA);
  const q = normalise(rawB);

  const explanation: string[] = [];
  let score: number | null = null;
  let cosine: number | null = null;
  let contributions: Contribution[] = [];
  if (p && q && shared.length >= 2) {
    score = jensenShannonSimilarity(p, q);
    cosine = cosineSimilarity(p, q);
    contributions = jsDivergenceTerms(p, q)
      .map((divergence, i) => ({ analyte: shared[i], shareA: p[i], shareB: q[i], divergence }))
      .sort((x, y) => y.divergence - x.divergence);
  }

  explanation.push(
    `Compared on ${shared.length} compound${shared.length === 1 ? '' : 's'} measured in both profiles (${Math.round(coverage * 100)} % of the ${union} covered by either). Each profile was renormalised over those shared compounds before comparing.`,
  );
  if (onlyA.length || onlyB.length) {
    explanation.push(
      `Not compared because only one profile covers them: ${[...onlyA.map((id) => `${label(id)} (A only)`), ...onlyB.map((id) => `${label(id)} (B only)`)].join(', ')}. Missing values are never treated as zero.`,
    );
  }
  if (score != null && p && q) {
    const common = shared
      .map((id, i) => ({ id, m: Math.min(p[i], q[i]), a: p[i], b: q[i] }))
      .sort((x, y) => y.m - x.m)
      .slice(0, 3)
      .filter((e) => e.m > 0.05);
    if (common.length) explanation.push(`Shared character: ${common.map((e) => `${label(e.id)} (${fmtPct(e.a)} vs ${fmtPct(e.b)})`).join(', ')}.`);
    const diffs = contributions.slice(0, 3).filter((c) => c.divergence > 0.002);
    if (diffs.length) explanation.push(`Largest differences: ${diffs.map((c) => `${label(c.analyte)} (${fmtPct(c.shareA)} vs ${fmtPct(c.shareB)})`).join(', ')}.`);
  }
  const auc = VALIDATION_AUC[Math.min(14, Math.max(2, [14, 10, 8, 6, 5, 4, 3, 2].find((k) => shared.length >= k) ?? 2))];
  explanation.push(
    confidence === 'insufficient'
      ? 'Confidence: insufficient — fewer than 3 shared compounds. A score this sparse is not meaningful.'
      : `Confidence: ${confidence}. In validation on 43,148 flower samples, comparisons with this many shared compounds told same-product pairs from random pairs with ROC AUC ≈ ${auc?.toFixed(2)}.`,
  );

  let absoluteDiffs: SimilarityResult['absoluteDiffs'] = null;
  if (isAbsoluteUnit(A.unit) && isAbsoluteUnit(B.unit)) {
    absoluteDiffs = shared.map((id) => {
      const a = convert(numericValue(A.measurements[id]) ?? 0, A.unit, 'pct_w_w') ?? 0;
      const b = convert(numericValue(B.measurements[id]) ?? 0, B.unit, 'pct_w_w') ?? 0;
      return { analyte: id, a, b, diff: b - a };
    });
    const pa = A.provenance.productType, pb = B.provenance.productType;
    if (pa !== pb) explanation.push(`Absolute concentrations are shown but are not directly comparable: product types differ (${pa} vs ${pb}).`);
  } else {
    explanation.push('Absolute concentration differences are not shown because at least one profile uses relative units, which cannot be converted to % by mass.');
  }

  return {
    method: 'jensen_shannon', approximate: false, score, cosine, shared, onlyA, onlyB, coverage, confidence,
    percentileVsRandom: score != null && confidence !== 'insufficient' ? percentileAmongRandomPairs(score) : null,
    contributions, absoluteDiffs, explanation,
  };
}

/** Ranks candidate profiles by similarity to a target (used by "find similar"). */
export function rankBySimilarity(target: Profile, candidates: Profile[], minShared = 5) {
  return candidates
    .map((c) => ({ profile: c, result: compareProfiles(target, c) }))
    .filter((r) => r.result.score != null && r.result.shared.length >= minShared)
    .sort((x, y) => (y.result.score ?? 0) - (x.result.score ?? 0));
}
