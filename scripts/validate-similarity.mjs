// Empirical check of candidate profile-similarity metrics on the Smith et al. data.
//
// Ground truth: two samples with the same cultivar name from the same anonymised
// producer are almost always the same product line, so a good metric should rank
// those pairs above random pairs of samples. We report ROC AUC (probability a
// same-product pair outscores a random pair) for each metric, then repeat with
// only k randomly chosen shared analytes to see how fast each metric degrades as
// coverage falls. The results set the coverage/confidence thresholds used by
// src/chem/similarity.ts and are recorded in docs/CHEMISTRY_MODEL.md.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const d = JSON.parse(readFileSync(join(ROOT, 'public/data/smith-samples.json'), 'utf8'));
const N = d.rows.id.length;
const A = d.analytes.length;

let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const vec = (i) => d.analytes.map((_, a) => d.rows.values[a][i] / d.scale); // -1/scale => missing

function restrict(v, idx) { return idx.map((k) => v[k]); }
function usable(a, b) { return a.every((x) => x >= 0) && b.every((x) => x >= 0); }
function rel(v) { const t = v.reduce((s, x) => s + x, 0); return t > 0 ? v.map((x) => x / t) : null; }

const metrics = {
  'cosine (relative composition)': (a, b) => {
    const p = rel(a), q = rel(b); if (!p || !q) return null;
    let dd = 0, na = 0, nb = 0;
    for (let i = 0; i < p.length; i++) { dd += p[i] * q[i]; na += p[i] ** 2; nb += q[i] ** 2; }
    return dd / Math.sqrt(na * nb);
  },
  '1 - Jensen-Shannon distance (relative)': (a, b) => {
    const p = rel(a), q = rel(b); if (!p || !q) return null;
    let js = 0;
    for (let i = 0; i < p.length; i++) {
      const m = (p[i] + q[i]) / 2;
      if (p[i] > 0) js += 0.5 * p[i] * Math.log2(p[i] / m);
      if (q[i] > 0) js += 0.5 * q[i] * Math.log2(q[i] / m);
    }
    return 1 - Math.sqrt(Math.max(0, js));
  },
  'cosine (absolute % w/w)': (a, b) => {
    let dd = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dd += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
    return na && nb ? dd / Math.sqrt(na * nb) : null;
  },
  '-Euclidean (log10 absolute)': (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (Math.log10(a[i] + 0.005) - Math.log10(b[i] + 0.005)) ** 2;
    return -Math.sqrt(s);
  },
  'Spearman rank correlation': (a, b) => {
    const rank = (v) => { const o = v.map((x, i) => [x, i]).sort((x, y) => x[0] - y[0]); const r = []; o.forEach(([, i], k) => (r[i] = k)); return r; };
    const ra = rank(a), rb = rank(b); const n = a.length;
    let s = 0; for (let i = 0; i < n; i++) s += (ra[i] - rb[i]) ** 2;
    return 1 - (6 * s) / (n * (n * n - 1));
  },
};

// build same-product groups
const groups = new Map();
for (let i = 0; i < N; i++) {
  const c = d.rows.cultivar[i], p = d.rows.producer[i];
  if (c < 0 || p < 0) continue;
  const k = `${c}|${p}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(i);
}
const multi = [...groups.values()].filter((g) => g.length >= 2);
const PAIRS = 6000;
const samePairs = [];
while (samePairs.length < PAIRS) {
  const g = multi[Math.floor(rand() * multi.length)];
  const i = g[Math.floor(rand() * g.length)], j = g[Math.floor(rand() * g.length)];
  if (i !== j) samePairs.push([i, j]);
}
const randPairs = [];
while (randPairs.length < PAIRS) {
  const i = Math.floor(rand() * N), j = Math.floor(rand() * N);
  if (i !== j) randPairs.push([i, j]);
}

function auc(pos, neg) {
  const all = [...pos.map((s) => [s, 1]), ...neg.map((s) => [s, 0])].sort((a, b) => a[0] - b[0]);
  let rankSum = 0;
  all.forEach(([, lab], k) => { if (lab) rankSum += k + 1; });
  const np = pos.length, nn = neg.length;
  return (rankSum - (np * (np + 1)) / 2) / (np * nn);
}

function evaluate(k) {
  const res = {};
  for (const [name, fn] of Object.entries(metrics)) {
    const score = (pairs) => pairs.map(([i, j]) => {
      const idx = k === A ? [...Array(A).keys()] : [...Array(A).keys()].sort(() => rand() - 0.5).slice(0, k);
      const a = restrict(vec(i), idx), b = restrict(vec(j), idx);
      return usable(a, b) ? fn(a, b) : null;
    }).filter((s) => s != null && Number.isFinite(s));
    res[name] = auc(score(samePairs), score(randPairs));
  }
  return res;
}

console.log(`same-product groups with >=2 samples: ${multi.length}; pairs per class: ${PAIRS}\n`);
for (const k of [A, 10, 8, 6, 5, 4, 3, 2]) {
  const r = evaluate(k);
  console.log(`k=${String(k).padStart(2)} shared analytes  ` + Object.entries(r).map(([n, v]) => `${n}: ${v.toFixed(3)}`).join('  |  '));
}
