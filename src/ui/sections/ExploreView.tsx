// EXPLORE: compound library, legally sourced sample/cultivar browser, aroma explorer.

import { useEffect, useMemo, useState } from 'react';
import { ANALYTES, ANALYTE_COLOR, ANALYTE_IDS, CONTEXT_COMPOUNDS, FAMILY_LABEL, analyte, compound, referenceCompound } from '../../chem/analytes';
import { AROMA_CATEGORIES, AROMA_LABEL, analyteAroma, analytesWithCategory, conceptualAroma, type AromaCategory } from '../../chem/aroma';
import {
  cultivarDisplayName, cultivarProfile, ctProfile, loadCtRegistry, loadSmithCultivars, loadSmithSamples, smithSampleProfile,
  type CtRegistry, type SmithCultivars, type SmithSamples,
} from '../../chem/datasets';
import population from '../../chem/population.generated.json';
import { relativeComposition } from '../../chem/profile';
import { confidenceFor, percentileAmongRandomPairs } from '../../chem/similarity';
import { SOURCES } from '../../chem/sources';
import type { AnalyteId, ChemicalFamily, Profile } from '../../chem/types';
import { openInLab, sendToSynth } from '../../store/actions';
import { navigate, setState, toast, useStore } from '../../store/store';
import { KindBadge, Notice, Panel } from '../components/bits';
import { IconSearch } from '../components/icons';

type Tab = 'compounds' | 'samples' | 'aroma';
const POP = population.analytes as unknown as Record<string, { nMeasured: number; fractionPositive: number; quantiles: number[] } | undefined>;

export function ExploreView() {
  const [tab, setTab] = useState<Tab>('compounds');
  return (
    <div className="stack">
      <div className="view-head">
        <div>
          <h1 className="view-title">Explore</h1>
          <p className="view-sub">The compound reference library, real laboratory data from approved open sources, and cited aroma associations.</p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Explore sections">
        <button role="tab" aria-selected={tab === 'compounds'} onClick={() => setTab('compounds')}>Compounds</button>
        <button role="tab" aria-selected={tab === 'samples'} onClick={() => setTab('samples')}>Samples &amp; cultivar names</button>
        <button role="tab" aria-selected={tab === 'aroma'} onClick={() => setTab('aroma')}>Aroma</button>
      </div>
      {tab === 'compounds' && <CompoundsTab />}
      {tab === 'samples' && <SamplesTab />}
      {tab === 'aroma' && <AromaTab />}
    </div>
  );
}

// ------------------------------------------------------------------ compounds

function CompoundsTab() {
  const fams: ChemicalFamily[] = ['monoterpene', 'monoterpenoid', 'sesquiterpene', 'sesquiterpenoid'];
  return (
    <div className="stack">
      {fams.map((f) => (
        <Panel key={f} title={FAMILY_LABEL[f]} sub={`${ANALYTES.filter((a) => a.family === f).length} compounds`}>
          <div className="cards">
            {ANALYTES.filter((a) => a.family === f).map((a) => {
              const c = referenceCompound(a.id);
              const pop = POP[a.id];
              const aroma = analyteAroma(a.id);
              return (
                <button key={a.id} className="card" onClick={() => setState({ infoAnalyte: a.id })} aria-label={`${a.label} — open details`}>
                  <div className="card-top">
                    <span style={{ fontWeight: 600 }}><i className="swatch" style={{ background: ANALYTE_COLOR[a.id], marginRight: 6 }} />{a.label}</span>
                    <span className="mono tiny faint">{a.short}</span>
                  </div>
                  <div className="formula">{c.formula} · {c.molecularWeight.toFixed(2)}</div>
                  <div className="tiny muted">{a.subclass} · CID {c.cid}</div>
                  <div className="chips">{aroma.categories.slice(0, 4).map((k) => <span key={k} className="chip">{AROMA_LABEL[k]}</span>)}{!aroma.hasEvidence && <span className="chip faint">no cited aroma</span>}</div>
                  <div className="tiny faint">{pop ? `Detected in ${(pop.fractionPositive * 100).toFixed(0)} % of ${pop.nMeasured.toLocaleString()} flower samples` : 'Not in the Smith et al. common panel'}</div>
                </button>
              );
            })}
          </div>
        </Panel>
      ))}
      <Panel title="Non-terpene aroma contributors" sub="context">
        <div className="cards">
          {CONTEXT_COMPOUNDS.map((c) => {
            const rec = compound(c.cid);
            return (
              <div key={c.id} className="card" style={{ cursor: 'default' }}>
                <div className="card-top"><span style={{ fontWeight: 600 }}>{c.label}</span><span className="badge plain">{c.family}</span></div>
                <div className="formula">{rec.formula} · CID <a href={rec.pubchemUrl} target="_blank" rel="noreferrer">{c.cid}</a></div>
                <p className="small muted" style={{ margin: 0 }}>{c.note}</p>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ samples

type Dataset = 'cultivars' | 'samples' | 'ct';
interface Row { key: string; name: string; sub: string; profile: () => Profile; shares: (number | null)[]; dominant: AnalyteId | null; n?: number; consistency?: number | null; detected: Set<AnalyteId>; region?: string; values: (number | null)[] }

function rowsFromCultivars(d: SmithCultivars): Row[] {
  return d.cultivars.map((c) => {
    const values = ANALYTE_IDS.map((id) => c.stats[id]?.[1] ?? null);
    return {
      key: c.slug, name: cultivarDisplayName(c.slug), sub: `${c.n} samples · ${c.producers} producers · ${c.labs} labs · ${c.regions.join(', ')}`,
      profile: () => cultivarProfile(c), ...derive(values), n: c.n, consistency: c.consistency, values,
      detected: new Set(ANALYTE_IDS.filter((id) => (c.stats[id]?.[4] ?? 0) > 0)),
    };
  });
}
function rowsFromSamples(d: SmithSamples): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < d.rows.id.length; i++) {
    const values = ANALYTE_IDS.map((id) => { const a = d.analytes.indexOf(id); if (a < 0) return null; const v = d.rows.values[a][i]; return v < 0 ? null : v / d.scale; });
    const c = d.rows.cultivar[i];
    const lab = d.labs[d.rows.lab[i]];
    out.push({
      key: String(d.rows.id[i]), name: c >= 0 ? cultivarDisplayName(d.cultivars[c]) : 'Unnamed sample',
      sub: `sample ${d.rows.id[i]} · ${lab} (${d.regions[d.rows.region[i]]}) · THC ${(d.rows.thc[i] / 100).toFixed(1)} %`,
      profile: () => smithSampleProfile(d, i), ...derive(values), values, region: d.regions[d.rows.region[i]],
      detected: new Set(ANALYTE_IDS.filter((id, k) => (values[k] ?? 0) > (d.floors[lab]?.[id] ?? 0))),
    });
  }
  return out;
}
function rowsFromCt(d: CtRegistry): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < d.rows.reg.length; i++) {
    const values = ANALYTE_IDS.map((id) => { const a = d.analytes.indexOf(id); if (a < 0) return null; const v = d.rows.values[a][i]; return v === -2 ? 0 : v < 0 ? null : v / d.scale; });
    out.push({
      key: d.rows.reg[i], name: d.rows.name[i], sub: `${d.rows.reg[i]} · ${d.producers[d.rows.producer[i]]} · ${d.forms[d.rows.form[i]]}${d.rows.date[i] ? ` · ${d.rows.date[i]}` : ''}`,
      profile: () => ctProfile(d, i), ...derive(values), values,
      detected: new Set(ANALYTE_IDS.filter((_, k) => (values[k] ?? 0) > 0)),
    });
  }
  return out;
}
function derive(values: (number | null)[]) {
  const tot = values.reduce<number>((s, v) => s + (v ?? 0), 0);
  const shares = values.map((v) => (v == null ? null : tot > 0 ? v / tot : 0));
  let best = -1, dom: AnalyteId | null = null;
  values.forEach((v, k) => { if (v != null && v > best && v > 0) { best = v; dom = ANALYTE_IDS[k]; } });
  return { shares, dominant: dom };
}

/** Fast Jensen–Shannon similarity on shared analytes (same method as chem/similarity). */
function fastSim(a: (number | null)[], b: (number | null)[]): { score: number | null; shared: number } {
  let ta = 0, tb = 0, shared = 0;
  for (let k = 0; k < a.length; k++) if (a[k] != null && b[k] != null) { ta += a[k]!; tb += b[k]!; shared++; }
  if (shared < 2 || ta <= 0 || tb <= 0) return { score: null, shared };
  let js = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k] == null || b[k] == null) continue;
    const p = a[k]! / ta, q = b[k]! / tb, m = (p + q) / 2;
    if (p > 0) js += 0.5 * p * Math.log2(p / m);
    if (q > 0) js += 0.5 * q * Math.log2(q / m);
  }
  return { score: 1 - Math.sqrt(Math.max(0, Math.min(1, js))), shared };
}

function SamplesTab() {
  const labProfile = useStore((s) => s.lab.profile);
  const [ds, setDs] = useState<Dataset>('cultivars');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [dominant, setDominant] = useState<AnalyteId | ''>('');
  const [hasCompound, setHasCompound] = useState<AnalyteId | ''>('');
  const [region, setRegion] = useState('');
  const [minN, setMinN] = useState(5);
  const [sort, setSort] = useState<string>('n');
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setRows(null); setError(null); setPage(0);
    const p = ds === 'cultivars' ? loadSmithCultivars().then(rowsFromCultivars) : ds === 'samples' ? loadSmithSamples().then(rowsFromSamples) : loadCtRegistry().then(rowsFromCt);
    p.then((r) => alive && setRows(r)).catch((e) => alive && setError(String(e.message ?? e)));
    if (ds !== 'cultivars' && sort === 'n') setSort('name');
    return () => { alive = false; };
  }, [ds, reload]);

  const labValues = useMemo(() => {
    const comp = relativeComposition(labProfile);
    return ANALYTE_IDS.map((id) => (comp.covered.includes(id) ? comp.shares[id] ?? 0 : null));
  }, [labProfile]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    let r = rows.filter((x) =>
      (!needle || x.name.toLowerCase().includes(needle) || x.sub.toLowerCase().includes(needle)) &&
      (!dominant || x.dominant === dominant) &&
      (!hasCompound || x.detected.has(hasCompound)) &&
      (!region || x.region === region) &&
      (ds !== 'cultivars' || (x.n ?? 0) >= minN));
    let sims: Map<string, { score: number | null; shared: number }> | null = null;
    if (sort === 'similar') {
      sims = new Map(r.map((x) => [x.key, fastSim(labValues, x.values)]));
      r = r.filter((x) => (sims!.get(x.key)?.shared ?? 0) >= 5 && sims!.get(x.key)?.score != null);
      r.sort((a, b) => (sims!.get(b.key)!.score! - sims!.get(a.key)!.score!));
    } else if (sort === 'name') r = [...r].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'n') r = [...r].sort((a, b) => (b.n ?? 0) - (a.n ?? 0));
    else if (sort === 'consistency') r = [...r].sort((a, b) => (b.consistency ?? 0) - (a.consistency ?? 0));
    else if (sort.startsWith('val:')) {
      const k = ANALYTE_IDS.indexOf(sort.slice(4) as AnalyteId);
      r = r.filter((x) => x.values[k] != null).sort((a, b) => (b.values[k]! - a.values[k]!));
    }
    return r.map((x) => ({ row: x, sim: sims?.get(x.key) ?? null }));
  }, [rows, q, dominant, hasCompound, region, minN, sort, labValues, ds]);

  const PER = 25;
  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  const shown = filtered.slice(page * PER, page * PER + PER);
  const src = ds === 'ct' ? SOURCES.ctRegistry : SOURCES.smith2022;

  return (
    <div className="stack">
      <Notice kind="info">
        <b>Strain name ≠ tested sample.</b> A <i>tested sample</i> is one laboratory measurement of one batch. A <i>cultivar name</i> here is only a label shared by many samples; its profile is the median of those samples. Products sold under the same name often differ substantially (Smith et al. 2022; Schwabe &amp; McGlaughlin 2019), so no single sample represents a whole commercial strain.
      </Notice>
      <Panel title="Dataset" sub={src.name} actions={<a className="btn sm ghost" href={src.url} target="_blank" rel="noreferrer">Source ↗</a>}>
        <div className="stack" style={{ gap: 10 }}>
          <div className="seg" role="group" aria-label="Dataset">
            <button aria-pressed={ds === 'cultivars'} onClick={() => setDs('cultivars')}>Cultivar names (aggregates)</button>
            <button aria-pressed={ds === 'samples'} onClick={() => setDs('samples')}>Tested samples · Smith et al.</button>
            <button aria-pressed={ds === 'ct'} onClick={() => setDs('ct')}>Products · CT registry</button>
          </div>
          <div className="tiny muted">{src.license} · {src.notes.join(' ')}</div>
          <div className="row">
            <label className="field" style={{ flex: 2, minWidth: 200 }}><span className="label">Search names</span>
              <div className="row tight"><IconSearch /><input className="input" style={{ flex: 1 }} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder={ds === 'ct' ? 'brand or registration number' : 'e.g. blue dream'} aria-label="Search" /></div>
            </label>
            <label className="field"><span className="label">Dominant terpene</span>
              <select className="select" value={dominant} onChange={(e) => { setDominant(e.target.value as AnalyteId | ''); setPage(0); }}><option value="">any</option>{ANALYTE_IDS.map((id) => <option key={id} value={id}>{analyte(id).label}</option>)}</select>
            </label>
            <label className="field"><span className="label">Detected compound</span>
              <select className="select" value={hasCompound} onChange={(e) => { setHasCompound(e.target.value as AnalyteId | ''); setPage(0); }}><option value="">any</option>{ANALYTE_IDS.map((id) => <option key={id} value={id}>{analyte(id).label}</option>)}</select>
            </label>
            {ds === 'samples' && (
              <label className="field"><span className="label">Region</span>
                <select className="select" value={region} onChange={(e) => { setRegion(e.target.value); setPage(0); }}><option value="">all</option>{['AK', 'CA', 'FL', 'MI', 'OR', 'WA'].map((r) => <option key={r}>{r}</option>)}</select>
              </label>
            )}
            {ds === 'cultivars' && (
              <label className="field"><span className="label">Min. samples</span>
                <select className="select" value={minN} onChange={(e) => { setMinN(Number(e.target.value)); setPage(0); }}>{[3, 5, 10, 25, 100].map((n) => <option key={n} value={n}>{n}+</option>)}</select>
              </label>
            )}
            <label className="field"><span className="label">Product type</span>
              <select className="select" value="flower" disabled aria-describedby="pt-note"><option value="flower">Flower only</option></select>
            </label>
            <label className="field"><span className="label">Sort</span>
              <select className="select" value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}>
                <option value="similar">Most similar to the Lab profile</option>
                <option value="name">Name</option>
                {ds === 'cultivars' && <option value="n">Most samples</option>}
                {ds === 'cultivars' && <option value="consistency">Most consistent between samples</option>}
                {ANALYTE_IDS.map((id) => <option key={id} value={`val:${id}`}>Highest {analyte(id).label} ({ds === 'cultivars' ? 'median ' : ''}% w/w)</option>)}
              </select>
            </label>
          </div>
          <p id="pt-note" className="tiny faint" style={{ margin: 0 }}>Only flower records are included: concentrates, vapes and edibles have different, non-comparable concentration scales. All records here are quantified (measured); descriptive profiles exist only if you create them. Sorting by a value compares within this one dataset and unit.</p>
          {sort === 'similar' && <p className="small" style={{ margin: 0 }}>Ranking by Jensen–Shannon similarity of relative composition to <b>{labProfile.name}</b>, requiring at least 5 shared compounds.</p>}
        </div>
      </Panel>

      <Panel title="Results" sub={rows ? `${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()}` : 'loading'}>
        {error && <Notice kind="err">Could not load the dataset: {error} <button className="btn sm" onClick={() => setReload((x) => x + 1)}>Retry</button></Notice>}
        {!rows && !error && <div className="row"><div className="spinner" /> <span className="muted">Loading {ds === 'samples' ? '43,148 samples (≈1 MB)' : 'data'}…</span></div>}
        {rows && !shown.length && <div className="empty">No records match these filters.</div>}
        <div className="list">
          {shown.map(({ row, sim }) => <ResultRow key={row.key} row={row} kind={ds === 'cultivars' ? 'cultivar_aggregate' : 'lab_sample'} sim={sim} />)}
        </div>
        {rows && pages > 1 && (
          <div className="pager">
            <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="small muted">Page {page + 1} of {pages}</span>
            <button className="btn sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </Panel>
    </div>
  );
}

function ResultRow({ row, kind, sim }: { row: Row; kind: 'cultivar_aggregate' | 'lab_sample'; sim: { score: number | null; shared: number } | null }) {
  const entries = row.shares.map((s, k) => [ANALYTE_IDS[k], s] as const).filter(([, s]) => s != null && s > 0) as [AnalyteId, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const load = (fn: (p: Profile) => void) => { const p = row.profile(); fn(p); return p; };
  return (
    <div className="item">
      <div className="stack" style={{ gap: 4 }}>
        <div className="row tight"><span className="item-title">{row.name}</span><KindBadge kind={kind} />
          {sim?.score != null && <span className="badge plain" title="Jensen–Shannon similarity of relative composition">similarity {sim.score.toFixed(2)} · {confidenceFor(sim.shared)} ({sim.shared} shared) · beats {Math.round(percentileAmongRandomPairs(sim.score) * 100)} % of random pairs</span>}
          {row.consistency != null && <span className="badge plain" title="Mean pairwise cosine similarity between samples sharing this name">consistency {row.consistency.toFixed(2)}</span>}
        </div>
        <div className="item-meta">{row.sub}</div>
        <div className="stacked" style={{ height: 12 }} aria-hidden="true">
          {entries.map(([id, s]) => <div key={id} style={{ width: `${s * 100}%`, background: ANALYTE_COLOR[id] }} />)}
        </div>
        <div className="chips">{entries.slice(0, 4).map(([id, s]) => <span key={id} className="chip">{analyte(id).short} {(s * 100).toFixed(0)}%</span>)}</div>
      </div>
      <div className="row tight">
        <button className="btn sm" onClick={() => { load(openInLab); navigate('lab'); }}>Open in Lab</button>
        <button className="btn sm" onClick={() => { const p = load((x) => sendToSynth(x, 'A')); toast(`"${p.name}" is now driving the Synth.`); }}>To Synth</button>
        <button className="btn sm" onClick={() => { const p = row.profile(); setState((s) => ({ compare: { ...s.compare, a: p }, recent: [p, ...s.recent].slice(0, 20) })); toast('Set as Compare A.'); }}>Compare A</button>
        <button className="btn sm" onClick={() => { const p = row.profile(); setState((s) => ({ compare: { ...s.compare, b: p }, recent: [p, ...s.recent].slice(0, 20) })); toast('Set as Compare B.'); }}>Compare B</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ aroma

function AromaTab() {
  const labProfile = useStore((s) => s.lab.profile);
  const [cat, setCat] = useState<AromaCategory>('citrus');
  const concept = useMemo(() => conceptualAroma(labProfile), [labProfile]);
  const maxW = Math.max(...Object.values(concept.weights), 0.01);
  const members = analytesWithCategory(cat);
  return (
    <div className="stack">
      <Notice kind="info">
        Aroma associations below come only from cited descriptor text for each <b>pure compound</b> (PubChem: HSDB odor statements and FEMA flavour profiles). Commercial strain flavour marketing is not used. Grouping words into categories is this project's own classification.
      </Notice>
      <div className="grid cols-2">
        <Panel title="Aroma categories">
          <div className="chips" role="group" aria-label="Aroma category" style={{ marginBottom: 12 }}>
            {AROMA_CATEGORIES.map((c) => (
              <button key={c} className="btn sm" aria-pressed={cat === c} onClick={() => setCat(c)}>{AROMA_LABEL[c]} <span className="faint">{analytesWithCategory(c).length}</span></button>
            ))}
          </div>
          {members.length ? (
            <div className="list">
              {members.map((id) => {
                const a = analyteAroma(id);
                return (
                  <div key={id} className="item" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
                    <div className="row tight"><button className="btn sm ghost" onClick={() => setState({ infoAnalyte: id })}><i className="swatch" style={{ background: ANALYTE_COLOR[id] }} /> {analyte(id).label}</button></div>
                    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                      {a.evidence.filter((e) => e.category === cat).map((e) => <li key={e.source + e.text}>"{e.text}" <span className="cite">— {e.source}</span></li>)}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : <div className="empty small">No compound in the library has a cited descriptor in this category.</div>}
          <p className="tiny faint" style={{ marginTop: 8 }}>No cited descriptor: {ANALYTE_IDS.filter((id) => !analyteAroma(id).hasEvidence).map((id) => analyte(id).label).join(', ')}.</p>
        </Panel>
        <Panel title="Conceptual aroma of the Lab profile" sub={labProfile.name}>
          <Notice>This is a <b>conceptual</b> profile, not a prediction. Perceived aroma of a mixture is not a linear sum of its components, and much of cannabis's characteristic smell comes from trace non-terpene compounds such as volatile sulfur compounds (Oswald et al. 2021, 2023).</Notice>
          <div className="bars" style={{ marginTop: 12 }}>
            {AROMA_CATEGORIES.map((c) => (
              <div className="bar-row" key={c} style={{ gridTemplateColumns: '120px minmax(0, 1fr) 60px' }}>
                <div className="bar-name small">{AROMA_LABEL[c]}</div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(concept.weights[c] / maxW) * 100}%`, background: 'var(--olive)' }} /></div>
                <div className="bar-val">{(concept.weights[c] * 100).toFixed(0)}</div>
              </div>
            ))}
          </div>
          <p className="tiny faint" style={{ marginTop: 8 }}>Each compound's relative share is split evenly across its cited categories. {concept.undocumentedShare > 0.005 && `${(concept.undocumentedShare * 100).toFixed(0)} % of the profile has no cited descriptor and is left out.`}</p>
        </Panel>
      </div>
    </div>
  );
}

