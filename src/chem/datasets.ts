// Lazy loaders and adapters for the approved datasets. Large files live in
// public/data and are fetched only when the Explore view asks for them.

import type { AnalyteId, Measurement, Profile, QualityFlag } from './types';

const BASE: string = import.meta.env?.BASE_URL ?? '/';

export interface SmithSamples {
  schema: string;
  sourceId: 'smith2022';
  unit: 'pct_w_w';
  scale: number;
  analytes: AnalyteId[];
  labs: string[];
  regions: string[];
  chemotypes: string[];
  cultivars: string[];
  floors: Record<string, Partial<Record<AnalyteId, number | null>>>;
  rows: {
    id: number[]; lab: number[]; region: number[]; cultivar: number[]; producer: number[];
    chemotype: number[]; thc: number[]; cbd: number[]; values: number[][];
  };
}

export interface CultivarAggregate {
  slug: string;
  n: number;
  producers: number;
  labs: number;
  regions: string[];
  thcMedian: number;
  consistency: number | null;
  stats: Partial<Record<AnalyteId, [number, number, number, number, number]>>;
}
export interface SmithCultivars { schema: string; sourceId: 'smith2022'; unit: 'pct_w_w'; minSamples: number; cultivars: CultivarAggregate[] }

export interface CtRegistry {
  schema: string;
  sourceId: 'ctRegistry';
  fetchedAt: string | null;
  unit: 'pct_w_w';
  scale: number;
  maxPlausible: number;
  analytes: AnalyteId[];
  producers: string[];
  forms: string[];
  rows: { reg: string[]; name: string[]; producer: number[]; form: number[]; date: string[]; thc: number[]; thca: number[]; extended: number[]; values: number[][] };
}

const cache = new Map<string, Promise<unknown>>();
function load<T>(file: string): Promise<T> {
  if (!cache.has(file)) {
    cache.set(file, fetch(`${BASE}data/${file}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${file} (${r.status})`);
      return r.json();
    }).catch((e) => { cache.delete(file); throw e; }));
  }
  return cache.get(file) as Promise<T>;
}

export const loadSmithSamples = () => load<SmithSamples>('smith-samples.json');
export const loadSmithCultivars = () => load<SmithCultivars>('smith-cultivars.json');
export const loadCtRegistry = () => load<CtRegistry>('ct-flower.json');

/** "blue-dream" -> "Blue Dream"; short all-consonant tokens stay upper-case (GSC, OG). */
export function cultivarDisplayName(slug: string): string {
  return slug.split('-').map((w) => {
    if (/^\d/.test(w)) return w;
    if (w.length <= 3 && !/[aeiou]/.test(w)) return w.toUpperCase();
    if (w === 'og') return 'OG';
    return w[0].toUpperCase() + w.slice(1);
  }).join(' ');
}

const ISOMER_SUM: ReadonlySet<AnalyteId> = new Set(['ocimene', 'nerolidol']);
const STEREO_UNRESOLVED: ReadonlySet<AnalyteId> = new Set(['limonene', 'a_pinene', 'b_pinene', 'linalool', 'camphene', 'bisabolol', 'borneol', 'fenchol']);

function baseFlags(id: AnalyteId): QualityFlag[] {
  const f: QualityFlag[] = [];
  if (ISOMER_SUM.has(id)) f.push('isomer_sum');
  if (STEREO_UNRESOLVED.has(id)) f.push('stereo_unresolved');
  return f;
}

export function smithSampleProfile(d: SmithSamples, row: number): Profile {
  const lab = d.labs[d.rows.lab[row]];
  const measurements: Partial<Record<AnalyteId, Measurement>> = {};
  d.analytes.forEach((id, a) => {
    const raw = d.rows.values[a][row];
    if (raw < 0) return; // not measured by this lab
    const value = raw / d.scale;
    const floor = d.floors[lab]?.[id] ?? undefined;
    const flags = baseFlags(id);
    if (raw === 0) {
      measurements[id] = { analyte: id, status: 'not_detected', value: null, unit: 'pct_w_w', floor: floor ?? undefined, flags };
    } else if (floor != null && value <= floor + 1e-9) {
      measurements[id] = { analyte: id, status: 'at_floor', value, unit: 'pct_w_w', floor, flags: [...flags, 'at_reporting_floor'] };
    } else {
      measurements[id] = { analyte: id, status: 'measured', value, unit: 'pct_w_w', floor: floor ?? undefined, flags };
    }
  });
  const c = d.rows.cultivar[row];
  const name = c >= 0 ? cultivarDisplayName(d.cultivars[c]) : 'Unnamed sample';
  return {
    schemaVersion: 1,
    id: `smith-${d.rows.id[row]}`,
    kind: 'lab_sample',
    name: `${name} · sample ${d.rows.id[row]}`,
    unit: 'pct_w_w',
    measurements,
    provenance: {
      sourceId: 'smith2022',
      sourceRecordId: String(d.rows.id[row]),
      lab: `${lab} (${d.regions[d.rows.region[row]]})`,
      region: d.regions[d.rows.region[row]],
      producer: d.rows.producer[row] >= 0 ? `producer ${d.rows.producer[row]}` : undefined,
      productType: 'flower',
      productForm: 'Flower',
      note: `One tested flower sample sold under the name "${name}". Another sample with the same name can differ substantially.`,
    },
  };
}

export function cultivarProfile(c: CultivarAggregate): Profile {
  const measurements: Partial<Record<AnalyteId, Measurement>> = {};
  for (const [id, s] of Object.entries(c.stats) as [AnalyteId, [number, number, number, number, number]][]) {
    const [n, median, q1, q3, nDetected] = s;
    measurements[id] = {
      analyte: id,
      status: median > 0 ? 'measured' : 'not_detected',
      value: median > 0 ? median : null,
      unit: 'pct_w_w',
      flags: baseFlags(id),
      stats: { n, q1, q3, nDetected },
    };
  }
  const name = cultivarDisplayName(c.slug);
  return {
    schemaVersion: 1,
    id: `cultivar-${c.slug}`,
    kind: 'cultivar_aggregate',
    name: `${name} (median of ${c.n})`,
    unit: 'pct_w_w',
    measurements,
    provenance: {
      sourceId: 'smith2022',
      sourceRecordId: c.slug,
      productType: 'flower',
      productForm: 'Flower',
      note: `Median of ${c.n} flower samples sold as "${name}" by ${c.producers} producer(s), tested by ${c.labs} lab(s). An aggregate of a name, not a chemical definition of a strain.`,
    },
  };
}

export function ctProfile(d: CtRegistry, row: number): Profile {
  const measurements: Partial<Record<AnalyteId, Measurement>> = {};
  d.analytes.forEach((id, a) => {
    const raw = d.rows.values[a][row];
    const flags: QualityFlag[] = [...baseFlags(id), 'unit_basis_undocumented'];
    if (raw === -1) return;
    if (raw === -2) measurements[id] = { analyte: id, status: 'not_detected', value: null, unit: 'pct_w_w', flags: [...flags, 'zero_ambiguous'] };
    else if (raw === -3) measurements[id] = { analyte: id, status: 'rejected', value: null, unit: 'pct_w_w', flags: [...flags, 'implausible_value'] };
    else measurements[id] = { analyte: id, status: 'measured', value: raw / d.scale, unit: 'pct_w_w', flags };
  });
  return {
    schemaVersion: 1,
    id: `ct-${d.rows.reg[row]}`,
    kind: 'lab_sample',
    name: d.rows.name[row],
    unit: 'pct_w_w',
    measurements,
    provenance: {
      sourceId: 'ctRegistry',
      sourceRecordId: d.rows.reg[row],
      producer: d.producers[d.rows.producer[row]],
      productType: 'flower',
      productForm: d.forms[d.rows.form[row]],
      date: d.rows.date[row] || undefined,
      region: 'CT',
      note: 'Registry record for a registered flower product. Units are undocumented by the publisher; zeros are ambiguous.',
    },
  };
}
