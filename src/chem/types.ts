// Core chemistry data model shared by the Lab, the Synth and the dataset adapters.
// Nothing in src/chem imports React or audio code.

/** Identifier of a lab-reported analyte (see compound-manifest.json). */
export type AnalyteId =
  | 'myrcene' | 'limonene' | 'caryophyllene' | 'a_pinene' | 'b_pinene' | 'linalool'
  | 'humulene' | 'terpinolene' | 'ocimene' | 'nerolidol' | 'bisabolol' | 'camphene'
  | 'borneol' | 'fenchol' | 'geraniol' | 'valencene' | 'g_terpinene' | 'a_terpinene';

export type ChemicalFamily = 'monoterpene' | 'monoterpenoid' | 'sesquiterpene' | 'sesquiterpenoid';

/**
 * Every value carries a status. Missing data is never silently a zero.
 * The first eight follow the project brief; `at_floor` and `rejected` describe
 * patterns found while auditing the real datasets (see docs/CHEMISTRY_MODEL.md).
 */
export type MeasurementStatus =
  | 'measured'        // verified numeric measurement above the reporting floor
  | 'at_floor'        // numeric value equal to the lab's apparent reporting floor (likely ≤ LOQ)
  | 'below_lod'       // source explicitly says below detection limit
  | 'below_loq'       // source explicitly says below quantification limit
  | 'not_detected'    // source reported 0 / ND (interpreted as below its detection limit)
  | 'measured_zero'   // an explicit, meaningful zero (only ever user-set)
  | 'not_reported'    // analyte was in the panel but no value was given
  | 'not_measured'    // analyte was not in the panel at all
  | 'estimated'       // value derived by estimation (never shown as a measurement)
  | 'hypothetical'    // user-defined value
  | 'rejected';       // failed a documented plausibility check; value withheld

/** Units. Absolute units are mass fractions; relative units are shares of a total. */
export type Unit = 'pct_w_w' | 'mg_per_g' | 'ppm_w_w' | 'relative_pct' | 'relative_weight';

export type QualityFlag =
  | 'at_reporting_floor'       // value equals the lab's reporting floor
  | 'implausible_value'        // exceeded a documented plausibility threshold
  | 'unit_basis_undocumented'  // the publisher does not document unit or dry/wet basis
  | 'zero_ambiguous'           // a zero that may mean "not tested" rather than "not detected"
  | 'isomer_sum'               // the value sums several isomers
  | 'stereo_unresolved';       // enantiomers were not separated

export interface Measurement {
  analyte: AnalyteId;
  status: MeasurementStatus;
  /** Value in `unit`. Null whenever the status carries no number. */
  value: number | null;
  unit: Unit;
  /** The lab's reporting floor, where one could be inferred. */
  floor?: number;
  flags?: QualityFlag[];
  /** Aggregate statistics when this measurement summarises many samples. */
  stats?: { n: number; q1: number; q3: number; nDetected: number };
}

export type ProfileKind =
  | 'lab_sample'         // one tested sample from an approved dataset
  | 'cultivar_aggregate' // statistics across many samples sharing a name
  | 'reported'           // non-quantitative (ranked/dominant terpenes only)
  | 'hypothetical'       // user-made, or derived from data by editing
  | 'demo'               // fictional built-in example
  | 'morph';             // synthetic interpolation between two profiles

export type ProductType = 'flower' | 'concentrate' | 'vape' | 'edible' | 'other' | 'unknown';

export interface Provenance {
  sourceId: string;          // key into the source registry (e.g. 'smith2022', 'ctRegistry')
  sourceRecordId?: string;
  lab?: string;
  region?: string;
  producer?: string;
  productType: ProductType;
  productForm?: string;      // the source's original product description
  date?: string;
  derivedFrom?: { id: string; name: string; kind: ProfileKind };
  morphOf?: { a: string; b: string; position: number };
  note?: string;
}

export interface Profile {
  schemaVersion: 1;
  id: string;
  kind: ProfileKind;
  name: string;
  unit: Unit;
  /** Analytes absent from this map were not measured. */
  measurements: Partial<Record<AnalyteId, Measurement>>;
  /** For `reported` profiles: analytes in descending order of reported prominence. */
  ranking?: AnalyteId[];
  provenance: Provenance;
  createdAt?: string;
  updatedAt?: string;
  favorite?: boolean;
  notes?: string;
  tags?: string[];
}

/** Statuses that carry a usable number for composition maths. */
export const NUMERIC_STATUSES: ReadonlySet<MeasurementStatus> = new Set([
  'measured', 'at_floor', 'measured_zero', 'estimated', 'hypothetical',
]);

/** Statuses meaning "looked for, essentially none found" (contributes 0, still covered). */
export const ZERO_LIKE_STATUSES: ReadonlySet<MeasurementStatus> = new Set([
  'not_detected', 'below_lod', 'below_loq',
]);

export const STATUS_LABEL: Record<MeasurementStatus, string> = {
  measured: 'Measured',
  at_floor: 'At reporting floor',
  below_lod: 'Below detection limit',
  below_loq: 'Below quantification limit',
  not_detected: 'Not detected (reported 0)',
  measured_zero: 'Zero (set)',
  not_reported: 'Not reported',
  not_measured: 'Not measured',
  estimated: 'Estimated',
  hypothetical: 'Hypothetical',
  rejected: 'Rejected (failed QC)',
};

export const UNIT_LABEL: Record<Unit, string> = {
  pct_w_w: '% w/w',
  mg_per_g: 'mg/g',
  ppm_w_w: 'ppm',
  relative_pct: '% of measured terpenes',
  relative_weight: 'relative weight',
};

export const isAbsoluteUnit = (u: Unit) => u === 'pct_w_w' || u === 'mg_per_g' || u === 'ppm_w_w';
