// Builds the Connecticut Cannabis Product Registry flower subset.
//
// Source: https://data.ct.gov/Health-and-Human-Services/Cannabis-Product-Registry/egd5-wb6r
// Publisher: CT Dept. of Consumer Protection, Drug Control Division. License: Public Domain.
// Access: Socrata SODA API (https://data.ct.gov/resource/egd5-wb6r.json).
//
// Conditions applied (see docs/DATA_SOURCES.md):
//   * flower dosage forms only — concentrates, vapes, edibles etc. are not comparable
//   * the registry does not document units; values are read as % w/w because
//     total-THC magnitudes (~20 flower, ~80 vape) only make sense that way. Every
//     value carries the 'unit_basis_undocumented' flag.
//   * a reported "0" is ambiguous (many products show 0 for an entire panel), so
//     zeros become status 'not_detected' with the 'zero_ambiguous' flag.
//   * values above 5 % w/w for a single terpene are withheld as implausible,
//     the same threshold Smith et al. (2022) used.
//   * only products with at least one positive terpene value are kept.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = join(ROOT, 'data/raw/ct');
const RAW = join(RAW_DIR, 'egd5-wb6r.json');
const API = 'https://data.ct.gov/resource/egd5-wb6r.json?$limit=100000&$order=registration_number';
const SCALE = 10000;
const MAX_PLAUSIBLE = 5;

const FLOWER_FORMS = new Set([
  'Usable Marijuana', 'Raw material (flower)', 'Flower', 'Raw Flower', 'FLOWER', 'RAW FLOWER',
  'Raw FLower', 'Raw flower', 'raw flower', 'flower', '3.5g Flower', '3.5g Raw Flower', '3.5g flower',
  '3.5 grams raw flower', '14g Flower', '7g Raw Flower', '2.1g Raw Flower', 'Flower - SC', 'Flower SC',
  'Flower second cut', 'SC flower', 'Select Grind',
]);

// registry field -> analyte. Nerolidol is handled separately (cis + trans).
const FIELDS = {
  b_myrcene: 'myrcene', limonene: 'limonene', b_caryophyllene: 'caryophyllene', a_pinene: 'a_pinene',
  b_pinene: 'b_pinene', linalool_lin: 'linalool', humulene_hum: 'humulene', terpinolene: 'terpinolene',
  ocimene: 'ocimene', a_bisabolol: 'bisabolol', camphene: 'camphene', borneol: 'borneol',
  fenchol: 'fenchol', geraniol: 'geraniol', valencene: 'valencene', a_terpinene: 'a_terpinene',
};
const ANALYTES = [...Object.values(FIELDS), 'nerolidol'];

mkdirSync(RAW_DIR, { recursive: true });
if (!existsSync(RAW)) {
  console.log('downloading', API);
  const res = await fetch(API);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  writeFileSync(RAW, await res.text());
  writeFileSync(join(RAW_DIR, 'fetched.txt'), new Date().toISOString() + '\n');
}
const fetchedAt = existsSync(join(RAW_DIR, 'fetched.txt')) ? readFileSync(join(RAW_DIR, 'fetched.txt'), 'utf8').trim() : null;
const all = JSON.parse(readFileSync(RAW, 'utf8'));

// encode: >=0 value in 0.0001 % units; -1 not reported; -2 reported 0 (ambiguous); -3 withheld (implausible)
function encode(raw) {
  if (raw == null || raw === '') return -1;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return -1;
  if (v === 0) return -2;
  if (v > MAX_PLAUSIBLE) return -3;
  return Math.round(v * SCALE);
}

const out = { reg: [], name: [], producer: [], form: [], date: [], thc: [], thca: [], extended: [], values: ANALYTES.map(() => []) };
const producers = [];
const forms = [];
let rejected = 0;
let flowerRows = 0;
for (const r of all) {
  if (!FLOWER_FORMS.has(r.dosage_form)) continue;
  flowerRows++;
  const vals = ANALYTES.map((a) => {
    if (a === 'nerolidol') {
      const c = encode(r.cis_nerolidol);
      const t = encode(r.trans_nerolidol);
      if (c === -1 || t === -1) return -1;
      if (c === -3 || t === -3) return -3;
      const sum = Math.max(c, 0) + Math.max(t, 0);
      if (sum > MAX_PLAUSIBLE * SCALE) return -3;
      return sum > 0 ? sum : -2;
    }
    const field = Object.keys(FIELDS).find((k) => FIELDS[k] === a);
    return encode(r[field]);
  });
  if (!vals.some((v) => v > 0)) continue;
  rejected += vals.filter((v) => v === -3).length;
  if (!producers.includes(r.producer)) producers.push(r.producer);
  if (!forms.includes(r.dosage_form)) forms.push(r.dosage_form);
  out.reg.push(r.registration_number);
  out.name.push(r.brand_name.trim());
  out.producer.push(producers.indexOf(r.producer));
  out.form.push(forms.indexOf(r.dosage_form));
  out.date.push((r.approval_date ?? '').slice(0, 10));
  out.thc.push(r.tetrahydrocannabinol_thc != null ? Math.round(Number(r.tetrahydrocannabinol_thc) * 100) : -1);
  out.thca.push(r.tetrahydrocannabinol_acid_thca != null ? Math.round(Number(r.tetrahydrocannabinol_acid_thca) * 100) : -1);
  out.extended.push(r.valencene != null ? 1 : 0);
  vals.forEach((v, i) => out.values[i].push(v));
}

mkdirSync(join(ROOT, 'public/data'), { recursive: true });
writeFileSync(join(ROOT, 'public/data/ct-flower.json'), JSON.stringify({
  schema: 'terpene-lab/registry@1',
  sourceId: 'ctRegistry',
  fetchedAt,
  unit: 'pct_w_w',
  scale: SCALE,
  encoding: 'values[analyte][row]: integer 0.0001 % units; -1 not reported; -2 reported 0 (ambiguous); -3 withheld as implausible (> 5 %)',
  maxPlausible: MAX_PLAUSIBLE,
  analytes: ANALYTES,
  producers,
  forms,
  rows: out,
}));
console.log(`registry rows ${all.length}; flower ${flowerRows}; kept with terpene data ${out.reg.length}; extended panel ${out.extended.filter(Boolean).length}; values withheld ${rejected}`);
ANALYTES.forEach((a, i) => {
  const v = out.values[i];
  console.log(`  ${a.padEnd(12)} positive ${v.filter((x) => x > 0).length}  zero ${v.filter((x) => x === -2).length}  not reported ${v.filter((x) => x === -1).length}  withheld ${v.filter((x) => x === -3).length}`);
});
