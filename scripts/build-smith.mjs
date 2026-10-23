// Builds the Smith et al. (2022) flower dataset assets.
//
// Source: https://github.com/cjsmith015/phytochemical-diversity-cannabis (CC0-1.0),
// file data/preproc_lab_data_pub_20220218.csv at commit e71c838 — the cleaned,
// published dataset behind https://doi.org/10.1371/journal.pone.0267498.
//
// Outputs
//   public/data/smith-samples.json      columnar per-sample data (lazy-loaded)
//   public/data/smith-cultivars.json    per-name aggregates, n >= 3 (lazy-loaded)
//   src/chem/population.generated.json  per-analyte quantiles (bundled; drives
//                                       percentile normalisation in the Synth)
//
// Deliberately excluded: strain_category and strain_popularity, which the
// authors took from Leafly strain pages (see docs/DATA_SOURCES.md).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, quantile, r4 } from './lib/csv.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT = 'e71c838e6bacdb3302c9410c595f09f3aea9984f';
const URL = `https://raw.githubusercontent.com/cjsmith015/phytochemical-diversity-cannabis/${COMMIT}/data/preproc_lab_data_pub_20220218.csv`;
const RAW_DIR = join(ROOT, 'data/raw/smith');
const RAW = join(RAW_DIR, 'preproc_lab_data_pub_20220218.csv');

// Dataset column -> analyte id
const COLUMNS = {
  myrcene: 'myrcene', limonene: 'limonene', caryophyllene: 'caryophyllene', a_pinene: 'a_pinene',
  b_pinene: 'b_pinene', linalool: 'linalool', humulene: 'humulene', terpinolene: 'terpinolene',
  tot_ocimene: 'ocimene', tot_nerolidol_ct: 'nerolidol', bisabolol: 'bisabolol', camphene: 'camphene',
  g_terpinene: 'g_terpinene', a_terpinene: 'a_terpinene',
};
const ANALYTES = Object.values(COLUMNS);
const COLS = Object.keys(COLUMNS);
const SCALE = 10000; // values stored as integer units of 0.0001 % w/w

mkdirSync(RAW_DIR, { recursive: true });
if (!existsSync(RAW)) {
  console.log('downloading', URL);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  writeFileSync(RAW, await res.text());
}

const all = parseCsv(readFileSync(RAW, 'utf8'));
const rows = all.filter((r) => r.has_terps === 'True');
console.log(`rows ${all.length}, with terpene data ${rows.length}`);
if (rows.some((r) => r.product_category !== 'FLOWER')) throw new Error('expected flower-only dataset');

const num = (v) => (v === '' ? null : Number(v));

// ---------- reporting floors ----------
// Each lab writes its below-quantification values at a fixed floor (0.01 or
// 0.03 % w/w for most), which shows up as a large spike at the smallest
// positive value. A floor is accepted when one of the three smallest distinct
// positive values holds at least 3 % of that analyte's positive values.
const labs = [...new Set(rows.map((r) => r.lab_id))].sort();
const floors = {}; // floors[lab][analyte] = number | null
const floorReport = [];
for (const lab of labs) {
  floors[lab] = {};
  const L = rows.filter((r) => r.lab_id === lab);
  COLS.forEach((col, i) => {
    const pos = L.map((r) => num(r[col])).filter((v) => v != null && v > 0);
    const counts = new Map();
    for (const v of pos) counts.set(r4(v), (counts.get(r4(v)) ?? 0) + 1);
    const smallest = [...counts.keys()].sort((a, b) => a - b).slice(0, 3);
    const floor = smallest.find((v) => counts.get(v) >= 0.03 * pos.length) ?? null;
    floors[lab][ANALYTES[i]] = floor;
    floorReport.push(`${lab} ${ANALYTES[i].padEnd(12)} floor=${floor ?? '—'} (${floor ? counts.get(floor) : 0}/${pos.length})`);
  });
}

// ---------- columnar sample table ----------
const cultivars = [...new Set(rows.map((r) => r.strain_slug).filter(Boolean))].sort();
const cultivarIndex = new Map(cultivars.map((s, i) => [s, i]));
const regions = [...new Set(rows.map((r) => r.region))].sort();
const chemotypes = [...new Set(rows.map((r) => r.chemotype))].sort();

const table = {
  id: [], lab: [], region: [], cultivar: [], producer: [], chemotype: [], thc: [], cbd: [],
  values: ANALYTES.map(() => []),
};
for (const r of rows) {
  table.id.push(Number(r.u_id));
  table.lab.push(labs.indexOf(r.lab_id));
  table.region.push(regions.indexOf(r.region));
  table.cultivar.push(r.strain_slug ? cultivarIndex.get(r.strain_slug) : -1);
  table.producer.push(r.anon_producer === '' ? -1 : Number(r.anon_producer));
  table.chemotype.push(chemotypes.indexOf(r.chemotype));
  table.thc.push(Math.round(Number(r.tot_thc) * 100));
  table.cbd.push(Math.round(Number(r.tot_cbd) * 100));
  COLS.forEach((col, i) => {
    const v = num(r[col]);
    table.values[i].push(v == null ? -1 : Math.round(v * SCALE));
  });
}

const samplesOut = {
  schema: 'terpene-lab/samples@1',
  sourceId: 'smith2022',
  unit: 'pct_w_w',
  scale: SCALE,
  encoding: 'values[analyte][row]: integer 0.0001 % w/w units; -1 = not measured; 0 = reported 0 (not detected)',
  analytes: ANALYTES,
  labs,
  regions,
  chemotypes,
  cultivars,
  floors,
  rows: table,
};

// ---------- helpers for composition ----------
function sampleVector(i) {
  return ANALYTES.map((_, a) => table.values[a][i]);
}
function relComposition(vec) {
  const nums = vec.map((v) => (v < 0 ? 0 : v));
  const tot = nums.reduce((s, v) => s + v, 0);
  return tot > 0 ? nums.map((v) => v / tot) : null;
}
function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

// ---------- population quantiles (for percentile normalisation) ----------
const population = { sourceId: 'smith2022', unit: 'pct_w_w', n: rows.length, analytes: {} };
ANALYTES.forEach((a, ai) => {
  const vals = table.values[ai].filter((v) => v >= 0).map((v) => v / SCALE).sort((x, y) => x - y);
  const rel = [];
  for (let i = 0; i < rows.length; i++) {
    if (table.values[ai][i] < 0) continue;
    const c = relComposition(sampleVector(i));
    if (c) rel.push(c[ai]);
  }
  rel.sort((x, y) => x - y);
  population.analytes[a] = {
    nMeasured: vals.length,
    fractionPositive: r4(vals.filter((v) => v > 0).length / vals.length),
    // 101 points: p0, p1, ... p100 of the measured values (ND counted as 0)
    quantiles: Array.from({ length: 101 }, (_, p) => r4(quantile(vals, p / 100))),
    relQuantiles: Array.from({ length: 21 }, (_, p) => r4(quantile(rel, p / 20))),
  };
});
const totals = [];
for (let i = 0; i < rows.length; i++) totals.push(sampleVector(i).reduce((s, v) => s + (v > 0 ? v : 0), 0) / SCALE);
totals.sort((a, b) => a - b);
population.totalOfMeasured = { median: r4(quantile(totals, 0.5)), p05: r4(quantile(totals, 0.05)), p95: r4(quantile(totals, 0.95)) };

// Reference distribution of the primary similarity score (1 − Jensen–Shannon
// distance on relative composition) for random pairs of flower samples, so the
// UI can say "more similar than X % of random pairs" instead of a bare number.
{
  const rand = lcgGlobal(777);
  const scores = [];
  while (scores.length < 20000) {
    const i = Math.floor(rand() * rows.length), j = Math.floor(rand() * rows.length);
    if (i === j) continue;
    const vi = sampleVector(i), vj = sampleVector(j);
    const shared = vi.map((v, k) => v >= 0 && vj[k] >= 0);
    const p = relComposition(vi.filter((_, k) => shared[k])), q = relComposition(vj.filter((_, k) => shared[k]));
    if (!p || !q) continue;
    let js = 0;
    for (let k = 0; k < p.length; k++) {
      const m = (p[k] + q[k]) / 2;
      if (p[k] > 0) js += 0.5 * p[k] * Math.log2(p[k] / m);
      if (q[k] > 0) js += 0.5 * q[k] * Math.log2(q[k] / m);
    }
    scores.push(1 - Math.sqrt(Math.max(0, js)));
  }
  scores.sort((a, b) => a - b);
  population.randomPairSimilarity = Array.from({ length: 101 }, (_, p) => r4(quantile(scores, p / 100)));
}
function lcgGlobal(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

// ---------- cultivar aggregates ----------
const byCultivar = new Map();
for (let i = 0; i < rows.length; i++) {
  const c = table.cultivar[i];
  if (c < 0) continue;
  if (!byCultivar.has(c)) byCultivar.set(c, []);
  byCultivar.get(c).push(i);
}
// deterministic pseudo-random subsample for consistency scores
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

const cultivarOut = [];
for (const [c, idx] of [...byCultivar.entries()].sort((a, b) => a[0] - b[0])) {
  if (idx.length < 3) continue;
  const stats = {};
  ANALYTES.forEach((a, ai) => {
    const vals = idx.map((i) => table.values[ai][i]).filter((v) => v >= 0).map((v) => v / SCALE).sort((x, y) => x - y);
    if (!vals.length) return;
    const nDetected = idx.filter((i) => {
      const v = table.values[ai][i];
      const fl = floors[labs[table.lab[i]]][a];
      return v > 0 && (fl == null || v / SCALE > fl);
    }).length;
    stats[a] = [vals.length, r4(quantile(vals, 0.5)), r4(quantile(vals, 0.25)), r4(quantile(vals, 0.75)), nDetected];
  });
  // within-name consistency: mean pairwise cosine similarity of relative composition
  const rand = lcg(c + 1);
  const pick = idx.length <= 60 ? idx : [...idx].sort(() => rand() - 0.5).slice(0, 60);
  const comps = pick.map((i) => relComposition(sampleVector(i))).filter(Boolean);
  let sum = 0, n = 0;
  for (let i = 0; i < comps.length; i++) for (let j = i + 1; j < comps.length; j++) { sum += cosine(comps[i], comps[j]); n++; }
  const producers = new Set(idx.map((i) => table.producer[i]).filter((p) => p >= 0));
  const labSet = new Set(idx.map((i) => table.lab[i]));
  const regionSet = new Set(idx.map((i) => regions[table.region[i]]));
  const thc = idx.map((i) => table.thc[i] / 100).sort((x, y) => x - y);
  cultivarOut.push({
    slug: cultivars[c],
    n: idx.length,
    producers: producers.size,
    labs: labSet.size,
    regions: [...regionSet].sort(),
    thcMedian: r4(quantile(thc, 0.5)),
    consistency: n ? r4(sum / n) : null,
    stats, // analyte -> [nMeasured, median, q1, q3, nDetected]
  });
}

// ---------- write ----------
mkdirSync(join(ROOT, 'public/data'), { recursive: true });
writeFileSync(join(ROOT, 'public/data/smith-samples.json'), JSON.stringify(samplesOut));
writeFileSync(join(ROOT, 'public/data/smith-cultivars.json'), JSON.stringify({
  schema: 'terpene-lab/cultivars@1', sourceId: 'smith2022', unit: 'pct_w_w', minSamples: 3,
  statsFields: ['nMeasured', 'median', 'q1', 'q3', 'nDetected'], cultivars: cultivarOut,
}));
writeFileSync(join(ROOT, 'src/chem/population.generated.json'), JSON.stringify(population));
writeFileSync(join(RAW_DIR, 'floor-report.txt'), floorReport.join('\n') + '\n');

console.log(floorReport.join('\n'));
console.log(`samples ${rows.length}, cultivars total ${cultivars.length}, aggregated (n>=3) ${cultivarOut.length}`);
console.log('population total-of-measured', population.totalOfMeasured);
