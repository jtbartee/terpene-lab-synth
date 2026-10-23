// Versioned JSON schemas for profiles and library export/import files.

import { z } from 'zod';
import { ANALYTE_IDS } from './analytes';
import type { AnalyteId, Profile } from './types';

const analyteId = z.enum(ANALYTE_IDS as unknown as [AnalyteId, ...AnalyteId[]]);
const status = z.enum([
  'measured', 'at_floor', 'below_lod', 'below_loq', 'not_detected', 'measured_zero',
  'not_reported', 'not_measured', 'estimated', 'hypothetical', 'rejected',
]);
const unit = z.enum(['pct_w_w', 'mg_per_g', 'ppm_w_w', 'relative_pct', 'relative_weight']);
const flag = z.enum(['at_reporting_floor', 'implausible_value', 'unit_basis_undocumented', 'zero_ambiguous', 'isomer_sum', 'stereo_unresolved']);

/** Upper plausibility bound per unit for a single terpene value. */
export const MAX_VALUE: Record<z.infer<typeof unit>, number> = {
  pct_w_w: 100, mg_per_g: 1000, ppm_w_w: 1_000_000, relative_pct: 100, relative_weight: 1000,
};

export const measurementSchema = z.object({
  analyte: analyteId,
  status,
  value: z.number().finite().nonnegative().nullable(),
  unit,
  floor: z.number().nonnegative().optional(),
  flags: z.array(flag).optional(),
  stats: z.object({ n: z.number().int().nonnegative(), q1: z.number(), q3: z.number(), nDetected: z.number().int().nonnegative() }).optional(),
}).superRefine((m, ctx) => {
  const needsNumber = ['measured', 'at_floor', 'measured_zero', 'estimated', 'hypothetical'].includes(m.status);
  if (needsNumber && m.value == null) ctx.addIssue({ code: 'custom', message: `status ${m.status} requires a numeric value` });
  if (!needsNumber && m.value != null) ctx.addIssue({ code: 'custom', message: `status ${m.status} must not carry a value` });
  if (m.value != null && m.value > MAX_VALUE[m.unit]) ctx.addIssue({ code: 'custom', message: `value ${m.value} exceeds the maximum for ${m.unit}` });
  if (m.status === 'measured_zero' && m.value !== 0) ctx.addIssue({ code: 'custom', message: 'measured_zero must have value 0' });
});

export const profileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(200),
  kind: z.enum(['lab_sample', 'cultivar_aggregate', 'reported', 'hypothetical', 'demo', 'morph']),
  name: z.string().min(1).max(200),
  unit,
  measurements: z.record(z.string(), measurementSchema),
  ranking: z.array(analyteId).optional(),
  provenance: z.object({
    sourceId: z.string(),
    sourceRecordId: z.string().optional(),
    lab: z.string().optional(),
    region: z.string().optional(),
    producer: z.string().optional(),
    productType: z.enum(['flower', 'concentrate', 'vape', 'edible', 'other', 'unknown']),
    productForm: z.string().optional(),
    date: z.string().optional(),
    derivedFrom: z.object({ id: z.string(), name: z.string(), kind: z.string() }).optional(),
    morphOf: z.object({ a: z.string(), b: z.string(), position: z.number() }).optional(),
    note: z.string().optional(),
  }),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  favorite: z.boolean().optional(),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string()).optional(),
}).superRefine((p, ctx) => {
  for (const [key, m] of Object.entries(p.measurements)) {
    if (key !== m.analyte) ctx.addIssue({ code: 'custom', message: `measurement key ${key} does not match analyte ${m.analyte}` });
    if (!ANALYTE_IDS.includes(key as AnalyteId)) ctx.addIssue({ code: 'custom', message: `unknown analyte ${key}` });
    if (m.unit !== p.unit) ctx.addIssue({ code: 'custom', message: `measurement ${key} unit ${m.unit} differs from profile unit ${p.unit}` });
  }
});

export const LIBRARY_FORMAT = 'terpene-lab-synth/library';
export const LIBRARY_VERSION = 1;

export const libraryFileSchema = z.object({
  format: z.literal(LIBRARY_FORMAT),
  version: z.number().int().min(1),
  exportedAt: z.string(),
  profiles: z.array(z.unknown()),
  presets: z.array(z.unknown()).optional(),
  mappings: z.array(z.unknown()).optional(),
});

export interface ValidationOutcome<T> { ok: T[]; errors: string[] }

export function validateProfile(x: unknown): { ok: true; profile: Profile } | { ok: false; error: string } {
  const r = profileSchema.safeParse(x);
  if (r.success) return { ok: true, profile: r.data as unknown as Profile };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.') || 'profile'}: ${i.message}`).join('; ') };
}

/** Parses an exported library file, migrating older versions, and reports per-item errors. */
export function parseLibraryFile(text: string): { profiles: Profile[]; presets: unknown[]; mappings: unknown[]; errors: string[] } {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { profiles: [], presets: [], mappings: [], errors: ['The file is not valid JSON.'] }; }
  // a bare profile is accepted too
  if (json && typeof json === 'object' && 'schemaVersion' in (json as object)) {
    const v = validateProfile(json);
    return v.ok ? { profiles: [v.profile], presets: [], mappings: [], errors: [] } : { profiles: [], presets: [], mappings: [], errors: [v.error] };
  }
  const f = libraryFileSchema.safeParse(json);
  if (!f.success) return { profiles: [], presets: [], mappings: [], errors: ['Not a TERPENE LAB library file (missing format/version).'] };
  if (f.data.version > LIBRARY_VERSION) return { profiles: [], presets: [], mappings: [], errors: [`File version ${f.data.version} is newer than this app supports (${LIBRARY_VERSION}).`] };
  const profiles: Profile[] = [];
  const errors: string[] = [];
  f.data.profiles.forEach((p, i) => {
    const v = validateProfile(p);
    if (v.ok) profiles.push(v.profile);
    else errors.push(`Profile ${i + 1}: ${v.error}`);
  });
  return { profiles, presets: f.data.presets ?? [], mappings: f.data.mappings ?? [], errors };
}

export function buildLibraryFile(profiles: Profile[], presets: unknown[] = [], mappings: unknown[] = []): string {
  return JSON.stringify({ format: LIBRARY_FORMAT, version: LIBRARY_VERSION, exportedAt: new Date().toISOString(), profiles, presets, mappings }, null, 2);
}
