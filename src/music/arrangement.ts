// Arrangement blueprints. Before any note is generated, a composition picks a
// structural plan: a sequence of sections, each with its own role, length,
// energy trajectory, material (which groove, bass motif and melodic motif it
// uses), harmonic behaviour, kind of development and transition. Blueprints
// are starting points, not templates: section lengths, optional sections and
// the order of some middle sections vary with the seed, and the Structural
// development control shifts the choice between hypnotic and contrast-rich
// forms. Endless pieces repeat the planning in "cycles" that bring back the
// original material and introduce new related material (see composer.ts).

import { chance, intBetween, weighted, type Rng } from './rng';
import type { StyleId } from './styles';

export type Role = 'intro' | 'main' | 'variation' | 'contrast' | 'breakdown' | 'build' | 'peak' | 'return' | 'outro';
export type GrooveRef = 'main' | 'var' | 'busy' | 'thin' | 'half' | 'contrast' | 'contrastVar' | 'none';
export type BassRef = 'main' | 'var' | 'contrast' | 'contrastVar' | 'sustain' | 'none';
export type MelodyRef = 'primary' | 'primaryDev' | 'secondary' | 'secondaryDev' | 'both' | 'fragment' | 'augment' | 'none';
export type HarmonyRef = 'home' | 'away' | 'move';
export type DevMode = 'restrain' | 'develop' | 'contrast' | 'strip' | 'build' | 'restate' | 'dissolve';
export type Transition = 'fill' | 'drop' | 'build' | 'cut' | 'none';

export interface SectionSpec {
  role: Role;
  label: string;
  /** desired length in eight-bar blocks (converted to the piece's phrase length, scaled to fit finite arrangements) */
  phrases: number;
  energy: [number, number];
  groove: GrooveRef;
  bass: BassRef;
  melody: MelodyRef;
  harmony: HarmonyRef;
  dev: DevMode;
  transition: Transition;
  /** dropped first when a finite arrangement is too short (higher = kept longer) */
  priority: number;
  /** layers this section wants on, beyond those its material implies */
  feature?: ('pad' | 'drone' | 'texture' | 'perc')[];
}

export interface Blueprint { id: string; label: string; sections: SectionSpec[] }
export interface PlannedSection extends SectionSpec { index: number; start: number; bars: number; cycle: number; blueprint: string }

const S = (role: Role, label: string, phrases: number, energy: [number, number], groove: GrooveRef, bass: BassRef, melody: MelodyRef, harmony: HarmonyRef, dev: DevMode, transition: Transition, priority: number, feature?: SectionSpec['feature']): SectionSpec =>
  ({ role, label, phrases, energy, groove, bass, melody, harmony, dev, transition, priority, feature });

type Maker = (r: Rng, structure: number) => SectionSpec[];

const BLUEPRINTS: Record<string, { label: string; make: Maker; styles: Partial<Record<StyleId, number>>; contrast: number }> = {
  hypnotic: {
    label: 'Hypnotic evolution', contrast: 0.2,
    styles: { motorik: 3, dub_techno: 2, microhouse: 3, krautpop: 1, berlin: 1, kosmische: 1, drone: 1.2, ambient: 0.5 },
    make: (r) => [
      S('intro', 'Intro', intBetween(r, 1, 2), [0.25, 0.45], 'thin', 'none', 'none', 'home', 'build', 'none', 9),
      S('main', 'A', 2, [0.55, 0.6], 'main', 'main', 'primary', 'home', 'restrain', 'fill', 10),
      S('variation', 'A1', 2, [0.6, 0.68], 'var', 'main', 'primaryDev', 'home', 'develop', 'fill', 5),
      S('variation', 'A2', intBetween(r, 1, 2), [0.65, 0.72], 'var', 'var', 'primaryDev', 'move', 'develop', 'drop', 4),
      S('breakdown', 'Breakdown', 1, [0.3, 0.38], 'none', 'sustain', 'augment', 'home', 'strip', 'build', 7, ['pad', 'texture', 'drone']),
      S('variation', 'A3', 2, [0.6, 0.72], 'var', 'var', 'both', 'home', 'develop', 'fill', 3),
      S('peak', 'Expansion', 2, [0.8, 0.9], 'busy', 'main', 'both', 'home', 'develop', 'fill', 6, ['perc', 'texture']),
      S('return', 'Return', 2, [0.62, 0.62], 'main', 'main', 'primary', 'home', 'restate', 'none', 8),
      S('outro', 'Outro', 2, [0.4, 0.15], 'thin', 'main', 'fragment', 'home', 'dissolve', 'none', 9),
    ],
  },
  twoPart: {
    label: 'Two-part exploration', contrast: 0.8,
    styles: { motorik: 2, krautpop: 3, berlin: 1, microhouse: 1, dub_techno: 1, kosmische: 1, ambient: 1 },
    make: (r) => [
      S('intro', 'Intro', 1, [0.3, 0.45], 'thin', 'none', 'none', 'home', 'build', 'fill', 9),
      S('main', 'A', 2, [0.6, 0.65], 'main', 'main', 'primary', 'home', 'restrain', 'fill', 10),
      S('contrast', 'B', 2, [0.68, 0.75], 'contrast', 'contrast', 'secondary', 'away', 'contrast', 'fill', 9),
      S('return', 'A′', 2, [0.65, 0.7], 'main', 'main', 'primaryDev', 'home', 'restrain', chance(r, 0.5) ? 'drop' : 'fill', 7),
      S('contrast', 'B′', 2, [0.75, 0.85], 'contrastVar', 'contrastVar', 'both', 'away', 'develop', 'fill', 5),
      S('outro', 'Outro', 2, [0.45, 0.15], 'thin', 'main', 'primary', 'home', 'dissolve', 'none', 9),
    ],
  },
  berlinDev: {
    label: 'Berlin-school development', contrast: 0.6,
    styles: { berlin: 4, kosmische: 1.5, motorik: 0.8, krautpop: 0.5 },
    make: (r) => [
      S('intro', 'Sequence introduction', 2, [0.3, 0.45], 'none', 'main', 'primary', 'home', 'build', 'none', 9),
      S('variation', 'Pattern expansion', 2, [0.5, 0.65], 'thin', 'main', 'primaryDev', 'home', 'develop', 'fill', 8),
      S('variation', 'Harmonic transition', intBetween(r, 1, 2), [0.6, 0.7], 'main', 'var', 'primaryDev', 'move', 'develop', 'fill', 6),
      S('contrast', 'Secondary sequence', 2, [0.65, 0.72], 'contrast', 'contrast', 'secondary', 'away', 'contrast', 'build', 8),
      S('peak', 'Layered peak', 2, [0.82, 0.92], 'busy', 'main', 'both', 'home', 'develop', 'cut', 7, ['pad', 'perc']),
      S('outro', 'Resolution', 2, [0.5, 0.15], 'none', 'sustain', 'primary', 'home', 'dissolve', 'none', 9, ['pad', 'drone']),
    ],
  },
  dubJourney: {
    label: 'Dub techno journey', contrast: 0.5,
    styles: { dub_techno: 4, microhouse: 2, kosmische: 0.8 },
    make: (r) => [
      S('intro', 'Atmosphere', intBetween(r, 1, 2), [0.2, 0.35], 'none', 'none', 'none', 'home', 'build', 'none', 9, ['pad', 'texture']),
      S('main', 'Groove establishment', 2, [0.55, 0.62], 'main', 'main', 'fragment', 'home', 'restrain', 'none', 10),
      S('variation', 'Chord development', 2, [0.62, 0.7], 'var', 'main', 'primary', 'away', 'develop', 'drop', 7, ['pad']),
      S('breakdown', 'Percussion breakdown', 1, [0.35, 0.45], 'thin', 'sustain', 'augment', 'home', 'strip', 'build', 8, ['texture', 'perc']),
      S('return', 'Dub return', 2, [0.65, 0.75], 'main', 'main', 'primaryDev', 'home', 'restate', 'none', 9, ['pad']),
      S('outro', 'Dissolution', 2, [0.45, 0.12], 'thin', 'sustain', 'fragment', 'home', 'dissolve', 'none', 9, ['texture']),
    ],
  },
  ambientDrift: {
    label: 'Ambient drift', contrast: 0.4,
    styles: { ambient: 4, drone: 3, kosmische: 3, dub_techno: 0.3 },
    make: (r) => [
      S('intro', 'Sparse introduction', 1, [0.2, 0.3], 'none', 'none', 'none', 'home', 'build', 'none', 9),
      S('main', 'First harmonic field', 2, [0.45, 0.55], 'main', 'main', 'primary', 'home', 'restrain', 'none', 10),
      S('breakdown', 'Texture transformation', intBetween(r, 1, 2), [0.4, 0.45], 'thin', 'sustain', 'fragment', 'move', 'strip', 'none', 6, ['texture', 'drone']),
      S('contrast', 'New harmonic field', 2, [0.55, 0.62], 'contrast', 'contrast', 'secondary', 'away', 'contrast', 'none', 8),
      S('return', 'Return of the theme', 1, [0.5, 0.5], 'main', 'main', 'primary', 'home', 'restate', 'none', 7),
      S('outro', 'Gradual dissolution', 2, [0.4, 0.1], 'none', 'sustain', 'augment', 'home', 'dissolve', 'none', 9, ['pad', 'texture']),
    ],
  },
  krautJam: {
    label: 'Krautrock jam', contrast: 0.7,
    styles: { motorik: 3, krautpop: 2, kosmische: 1, berlin: 1 },
    make: (r) => [
      S('main', 'Primary groove', 2, [0.5, 0.6], 'main', 'main', 'primary', 'home', 'restrain', 'none', 10),
      S('variation', 'Motif development', 2, [0.62, 0.7], 'var', 'var', 'primaryDev', 'home', 'develop', 'fill', 7),
      S('contrast', 'Contrasting section', 2, [0.6, 0.7], 'contrast', 'contrast', 'secondary', 'away', 'contrast', 'drop', 9),
      S('peak', 'Extended improvisation', intBetween(r, 2, 3), [0.75, 0.9], 'busy', 'var', 'both', 'move', 'develop', 'fill', 6, ['perc']),
      S('return', 'Original groove', 2, [0.6, 0.62], 'main', 'main', 'primary', 'home', 'restate', 'none', 9),
      S('outro', 'Ending', 1, [0.4, 0.12], 'thin', 'main', 'fragment', 'home', 'dissolve', 'none', 8),
    ],
  },
  additive: {
    label: 'Additive process', contrast: 0.3,
    styles: { motorik: 1, berlin: 1.5, microhouse: 1, ambient: 0.8, kosmische: 0.8 },
    make: (r) => [
      S('intro', 'Pulse', 1, [0.25, 0.35], 'thin', 'main', 'none', 'home', 'build', 'none', 9),
      S('build', 'Additive build', intBetween(r, 2, 3), [0.4, 0.7], 'main', 'main', 'primaryDev', 'home', 'build', 'fill', 8),
      S('peak', 'Full process', 2, [0.75, 0.85], 'busy', 'var', 'both', 'home', 'develop', 'cut', 7),
      S('breakdown', 'Subtraction', 1, [0.45, 0.35], 'half', 'sustain', 'fragment', 'move', 'strip', 'build', 6),
      S('return', 'Return', 2, [0.6, 0.62], 'main', 'main', 'primary', 'home', 'restate', 'none', 9),
      S('outro', 'Outro', 1, [0.35, 0.12], 'thin', 'main', 'fragment', 'home', 'dissolve', 'none', 8),
    ],
  },
};

export const BLUEPRINT_IDS = Object.keys(BLUEPRINTS);
export const blueprintLabel = (id: string) => BLUEPRINTS[id]?.label ?? id;

/** Weighted choice of a blueprint for a style; Structural development favours contrast-rich forms. */
export function chooseBlueprint(style: StyleId, structure: number, r: Rng, exclude?: string): string {
  const items = BLUEPRINT_IDS.filter((id) => id !== exclude).map((id) => {
    const bp = BLUEPRINTS[id];
    const w = bp.styles[style] ?? 0;
    const tilt = 0.35 + 1.3 * (structure * bp.contrast + (1 - structure) * (1 - bp.contrast));
    return [id, w * tilt] as const;
  }).filter(([, w]) => w > 0);
  return items.length ? weighted(r, items) : 'hypnotic';
}

/** The blueprint's sections, with seeded variation in lengths and optional reordering of the middle. */
export function blueprintSections(id: string, r: Rng, structure: number): SectionSpec[] {
  const bp = BLUEPRINTS[id] ?? BLUEPRINTS.hypnotic;
  const secs = bp.make(r, structure).map((s) => ({ ...s }));
  // low structural development lengthens the main sections (more hypnotic repetition)
  for (const s of secs) if ((s.role === 'main' || s.role === 'return') && chance(r, 0.6 - 0.5 * structure)) s.phrases += 1;
  // high structural development may add a contrast echo before the return
  const ret = secs.findIndex((s) => s.role === 'return');
  if (structure > 0.6 && ret > 0 && secs.some((s) => s.role === 'contrast') && chance(r, structure - 0.4)) {
    secs.splice(ret, 0, S('contrast', 'Contrast echo', 1, [0.6, 0.7], 'contrastVar', 'contrast', 'secondaryDev', 'away', 'contrast', 'fill', 2));
  }
  return secs;
}

/**
 * Fits a blueprint into a finite number of phrases: drops the lowest-priority
 * sections until every remaining one gets at least a phrase, then shares the
 * phrases out in proportion to the sections' desired lengths. The first
 * section stays an intro (or main) and the last becomes the outro.
 */
export function fitSections(secs: SectionSpec[], totalPhrases: number): SectionSpec[] {
  let keep = secs.map((s, i) => ({ s, i }));
  while (keep.length > Math.max(2, totalPhrases)) {
    const victim = keep.slice(1, -1).sort((a, b) => a.s.priority - b.s.priority)[0];
    if (!victim) break;
    keep = keep.filter((k) => k !== victim);
  }
  const out = keep.map((k) => ({ ...k.s }));
  if (out[out.length - 1].role !== 'outro') out[out.length - 1] = { ...out[out.length - 1], role: 'outro', label: 'Outro', dev: 'dissolve', energy: [out[out.length - 1].energy[0], 0.15] };
  const want = out.reduce((s, x) => s + x.phrases, 0);
  const scaled = out.map((x) => Math.max(1, Math.floor((x.phrases * totalPhrases) / want)));
  let sum = scaled.reduce((a, b) => a + b, 0);
  // hand leftover phrases to the most important sections, take surplus from the least
  const byPri = out.map((x, i) => ({ i, p: x.priority })).sort((a, b) => b.p - a.p);
  for (let k = 0; sum < totalPhrases; k++) { scaled[byPri[k % byPri.length].i]++; sum++; }
  while (sum > totalPhrases) {
    const victim = [...byPri].reverse().find(({ i }) => scaled[i] > 1);
    if (!victim) break;
    scaled[victim.i]--; sum--;
  }
  return out.map((x, i) => ({ ...x, phrases: scaled[i] }));
}

/** Phrase length options per style (bars), weighted. Hypnotic styles can breathe in 16-bar phrases. */
export const PHRASE_OPTIONS: Record<StyleId, [number, number][]> = {
  motorik: [[8, 4], [16, 1], [4, 0.6]],
  kosmische: [[8, 2], [16, 2]],
  dub_techno: [[8, 3], [16, 2]],
  berlin: [[8, 3], [4, 1], [16, 0.6]],
  ambient: [[8, 2], [16, 1]],
  drone: [[16, 1], [8, 1]],
  krautpop: [[8, 3], [4, 2]],
  microhouse: [[8, 3], [16, 1], [4, 0.5]],
};

export function choosePhraseBars(style: StyleId, r: Rng, finiteBars: number): number {
  let p = weighted(r, PHRASE_OPTIONS[style]);
  // a finite piece needs at least four phrases to have a shape
  while (finiteBars > 0 && p > 4 && finiteBars / p < 4) p /= 2;
  return p;
}

export const ROLE_TEXT: Record<Role, string> = {
  intro: 'layers enter', main: 'the main groove and motif', variation: 'a variation of the main material', contrast: 'contrasting material',
  breakdown: 'the rhythm falls away', build: 'tension builds', peak: 'everything together', return: 'the original groove returns', outro: 'the piece dissolves',
};

