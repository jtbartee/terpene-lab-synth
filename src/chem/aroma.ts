// Aroma explorer model.
//
// Evidence: only cited descriptor text from PubChem (HSDB odor statements and
// FEMA flavor profiles). The category assignment — which descriptor words
// count as "citrus", "pine" and so on — is this project's own classification,
// shown as such in the UI, with the triggering words listed.
//
// The mixture view is a CONCEPTUAL profile: perceived aroma of a mixture is not
// a linear sum of its components, and much of cannabis aroma comes from
// non-terpene trace compounds (Oswald et al. 2021, 2023).

import { ANALYTE_IDS, citedFlavor, citedOdor } from './analytes';
import { relativeComposition } from './profile';
import type { AnalyteId, Profile } from './types';

export const AROMA_CATEGORIES = [
  'citrus', 'floral', 'herbal', 'woody', 'earthy', 'pine', 'peppery', 'fruity', 'sweet', 'resinous', 'musky', 'camphoraceous',
] as const;
export type AromaCategory = (typeof AROMA_CATEGORIES)[number];

export const AROMA_LABEL: Record<AromaCategory, string> = {
  citrus: 'Citrus', floral: 'Floral', herbal: 'Herbal', woody: 'Woody', earthy: 'Earthy', pine: 'Pine',
  peppery: 'Peppery / spice', fruity: 'Fruity', sweet: 'Sweet', resinous: 'Resinous', musky: 'Musky', camphoraceous: 'Camphoraceous',
};

/** Keyword → category rules. Applied to whole words of the cited text. */
const RULES: [RegExp, AromaCategory][] = [
  [/\b(lemon|citrus|orange|bergamot|lime|lemon-like)\b/i, 'citrus'],
  [/\b(floral|flower|rose|lavender|geranium)\b/i, 'floral'],
  [/\b(herb|herbal|herbaceous|green|mint|minty|coriander)\b/i, 'herbal'],
  [/\b(wood|woody|cedarwood)\b/i, 'woody'],
  [/\b(must|musty|earthy|earth)\b/i, 'earthy'],
  [/\b(pine|piney|fir|turpentine)\b/i, 'pine'],
  [/\b(spice|spicy|pepper|peppery)\b/i, 'peppery'],
  [/\b(fruit|fruity|peach|passion)\b/i, 'fruity'],
  [/\b(sweet|balsamic)\b/i, 'sweet'],
  [/\b(resin|resinous|balsamic|polish)\b/i, 'resinous'],
  [/\b(musk|musky)\b/i, 'musky'],
  [/\b(camphor|camphoraceous|camphor-like|mothball|cooling)\b/i, 'camphoraceous'],
];

export interface AromaEvidence {
  category: AromaCategory;
  text: string;
  source: string;
  sourceUrl: string | null;
}

export interface AnalyteAroma {
  analyte: AnalyteId;
  categories: AromaCategory[];
  evidence: AromaEvidence[];
  /** Cited text that matched no category (shown verbatim). */
  unclassified: { text: string; source: string }[];
  hasEvidence: boolean;
}

function classify(text: string): AromaCategory[] {
  return [...new Set(RULES.filter(([re]) => re.test(text)).map(([, c]) => c))];
}

const cache = new Map<AnalyteId, AnalyteAroma>();
export function analyteAroma(id: AnalyteId): AnalyteAroma {
  const hit = cache.get(id);
  if (hit) return hit;
  const texts = [
    ...citedOdor(id).map((o) => ({ text: o.text, source: `${o.source} (odor)`, sourceUrl: o.sourceUrl })),
    // FEMA profiles are comma lists; each term is classified separately
    ...citedFlavor(id).flatMap((f) => f.text.split(',').map((t) => ({ text: t.trim(), source: 'FEMA flavor profile', sourceUrl: f.sourceUrl }))),
  ].filter((t) => t.text);
  const evidence: AromaEvidence[] = [];
  const unclassified: { text: string; source: string }[] = [];
  for (const t of texts) {
    const cats = classify(t.text);
    if (!cats.length) unclassified.push({ text: t.text, source: t.source });
    for (const c of cats) evidence.push({ category: c, text: t.text, source: t.source, sourceUrl: t.sourceUrl });
  }
  const out: AnalyteAroma = {
    analyte: id,
    categories: [...new Set(evidence.map((e) => e.category))],
    evidence,
    unclassified,
    hasEvidence: texts.length > 0,
  };
  cache.set(id, out);
  return out;
}

export interface ConceptualAroma {
  weights: Record<AromaCategory, number>;
  /** share of the profile (by relative composition) with no cited descriptor */
  undocumentedShare: number;
  contributors: Record<AromaCategory, AnalyteId[]>;
}

/**
 * Conceptual aroma profile of a mixture: each covered analyte's relative share
 * is split evenly over its evidenced categories. Explicitly not a prediction.
 */
export function conceptualAroma(p: Profile): ConceptualAroma {
  const comp = relativeComposition(p);
  const weights = Object.fromEntries(AROMA_CATEGORIES.map((c) => [c, 0])) as Record<AromaCategory, number>;
  const contributors = Object.fromEntries(AROMA_CATEGORIES.map((c) => [c, [] as AnalyteId[]])) as Record<AromaCategory, AnalyteId[]>;
  let undocumented = 0;
  for (const id of comp.covered) {
    const share = comp.shares[id] ?? 0;
    if (share <= 0) continue;
    const a = analyteAroma(id);
    if (!a.categories.length) { undocumented += share; continue; }
    for (const c of a.categories) {
      weights[c] += share / a.categories.length;
      contributors[c].push(id);
    }
  }
  return { weights, undocumentedShare: undocumented, contributors };
}

export function analytesWithCategory(c: AromaCategory): AnalyteId[] {
  return ANALYTE_IDS.filter((id) => analyteAroma(id).categories.includes(c));
}
