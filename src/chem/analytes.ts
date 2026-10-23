// Analyte registry: the lab-reported quantities the app works with, each backed
// by one or more PubChem compound records from compounds.generated.json.

import raw from './compounds.generated.json';
import type { AnalyteId, ChemicalFamily } from './types';

export interface Atom { x: number; y: number; z: number; el: string }
export interface Bond { a: number; b: number; order: number; stereo: number }
export interface Structure { atoms: Atom[]; bonds: Bond[] }
export interface CitedText { text: string; source: string; sourceUrl: string | null; reference: string | null }

export interface CompoundRecord {
  cid: number;
  title: string;
  iupacName: string | null;
  formula: string;
  molecularWeight: number;
  exactMass: number;
  inchi: string;
  inchiKey: string;
  smiles: string;
  connectivitySmiles: string;
  xlogp: number | null;
  tpsa: number | null;
  heavyAtoms: number;
  definedStereocentres: number;
  undefinedStereocentres: number;
  definedDoubleBondStereo: number;
  synonyms: string[];
  structure2d: Structure;
  structure3d: Structure | null;
  odor: CitedText[];
  femaFlavor: CitedText[];
  boilingPoint: CitedText[];
  pubchemUrl: string;
}

export interface AnalyteInfo {
  id: AnalyteId;
  label: string;
  short: string;
  referenceCid: number;
  memberCids: number[];
  family: ChemicalFamily;
  subclass: string;
  stereoNote: string;
  labAliases: string[];
}

export interface ContextCompound { id: string; label: string; cid: number; family: string; note: string }

interface GeneratedFile {
  generated: string;
  verified: string;
  source: string;
  analytes: AnalyteInfo[];
  contextCompounds: ContextCompound[];
  compounds: Record<string, CompoundRecord>;
}

const data = raw as unknown as GeneratedFile;

export const COMPOUND_DATA_VERIFIED = data.verified;
export const COMPOUND_DATA_GENERATED = data.generated;
export const ANALYTES: readonly AnalyteInfo[] = data.analytes;
export const ANALYTE_IDS: readonly AnalyteId[] = data.analytes.map((a) => a.id);
export const CONTEXT_COMPOUNDS: readonly ContextCompound[] = data.contextCompounds;

const byId = new Map(ANALYTES.map((a) => [a.id, a]));
export function analyte(id: AnalyteId): AnalyteInfo {
  const a = byId.get(id);
  if (!a) throw new Error(`unknown analyte ${id}`);
  return a;
}
export const isAnalyteId = (s: string): s is AnalyteId => byId.has(s as AnalyteId);

export function compound(cid: number): CompoundRecord {
  const c = data.compounds[String(cid)];
  if (!c) throw new Error(`no compound record for CID ${cid}`);
  return c;
}

/** The 16 compounds the brief requires, in its order; γ- and α-terpinene follow. */
export const CORE_CHANNELS: readonly AnalyteId[] = [
  'myrcene', 'limonene', 'caryophyllene', 'a_pinene', 'b_pinene', 'linalool', 'humulene', 'terpinolene',
  'ocimene', 'nerolidol', 'bisabolol', 'camphene', 'borneol', 'fenchol', 'geraniol', 'valencene',
];
/** Channels shown by default in the mixing console. */
export const DEFAULT_VISIBLE: readonly AnalyteId[] = [
  'myrcene', 'limonene', 'caryophyllene', 'a_pinene', 'b_pinene', 'linalool', 'humulene', 'terpinolene',
];

export const FAMILY_LABEL: Record<ChemicalFamily, string> = {
  monoterpene: 'Monoterpene hydrocarbons (C10H16)',
  monoterpenoid: 'Oxygenated monoterpenoids (C10H18O)',
  sesquiterpene: 'Sesquiterpene hydrocarbons (C15H24)',
  sesquiterpenoid: 'Oxygenated sesquiterpenoids (C15H26O)',
};

/** Expected molecular formula for each family — checked by tests against PubChem. */
export const FAMILY_FORMULA: Record<ChemicalFamily, string> = {
  monoterpene: 'C10H16',
  monoterpenoid: 'C10H18O',
  sesquiterpene: 'C15H24',
  sesquiterpenoid: 'C15H26O',
};

/**
 * Visual identity per channel. Colour is never the only cue: every channel also
 * has its short code and a family pattern (see ui/viz/patterns).
 */
export const ANALYTE_COLOR: Record<AnalyteId, string> = {
  myrcene: '#7f9a4b', limonene: '#e0b347', caryophyllene: '#c9773c', a_pinene: '#4f9a78',
  b_pinene: '#6fb59a', linalool: '#9a86c9', humulene: '#a5864e', terpinolene: '#5fb4c1',
  ocimene: '#d9a3c0', nerolidol: '#8a9cc9', bisabolol: '#c8b8a0', camphene: '#9ec7a7',
  borneol: '#b3a36a', fenchol: '#79a6b3', geraniol: '#d98c8c', valencene: '#e09a5c',
  g_terpinene: '#a3c46a', a_terpinene: '#c4c46a',
};

export function referenceCompound(id: AnalyteId): CompoundRecord {
  return compound(analyte(id).referenceCid);
}

/** All cited odor text (HSDB etc.) for an analyte's reference and member compounds. */
export function citedOdor(id: AnalyteId): (CitedText & { cid: number })[] {
  const a = analyte(id);
  return [a.referenceCid, ...a.memberCids].flatMap((cid) => compound(cid).odor.map((o) => ({ ...o, cid })));
}
export function citedFlavor(id: AnalyteId): (CitedText & { cid: number })[] {
  const a = analyte(id);
  return [a.referenceCid, ...a.memberCids].flatMap((cid) => compound(cid).femaFlavor.map((o) => ({ ...o, cid })));
}
