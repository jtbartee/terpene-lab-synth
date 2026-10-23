// COMPARE: chemical A/B comparison with transparent similarity, plus audible A/B.

import { useMemo } from 'react';
import { ANALYTE_IDS, analyte } from '../../chem/analytes';
import { compareProfiles } from '../../chem/similarity';
import { sourceInfo } from '../../chem/sources';
import type { Profile } from '../../chem/types';
import { UNIT_LABEL, isAbsoluteUnit } from '../../chem/types';
import { formatValue } from '../../chem/units';
import { openInLab, play, sendBothToSynth, sendToSynth } from '../../store/actions';
import { navigate, setState, setSynth, toast, useStore } from '../../store/store';
import { AnalyteChip, KindBadge, Notice, Panel, ProfilePicker, SourceLine } from '../components/bits';
import { IconPlay, IconSend } from '../components/icons';
import { CompositionStack, Coverage, DiffChart, Radar } from '../viz/charts';

export function CompareView() {
  const { a, b } = useStore((s) => s.compare);
  const r = useMemo(() => (a && b ? compareProfiles(a, b) : null), [a, b]);
  const comparableAbs = !!a && !!b && isAbsoluteUnit(a.unit) && isAbsoluteUnit(b.unit) && a.provenance.productType === b.provenance.productType;
  const set = (slot: 'a' | 'b', p: Profile | null) => setState((s) => ({ compare: { ...s.compare, [slot]: p } }));

  return (
    <div className="stack">
      <div className="view-head">
        <div>
          <h1 className="view-title">Compare</h1>
          <p className="view-sub">Two profiles side by side: shared and unique compounds, differences, a transparent similarity score with its coverage, and an audible A/B in the Synth.</p>
        </div>
      </div>
      <div className="grid cols-2">
        {(['a', 'b'] as const).map((slot) => {
          const p = slot === 'a' ? a : b;
          return (
            <Panel key={slot} title={`Profile ${slot.toUpperCase()}`} actions={p && <KindBadge kind={p.kind} />}>
              <div className="stack" style={{ gap: 10 }}>
                <ProfilePicker label={`Choose profile ${slot.toUpperCase()}`} value={p} onChange={(x) => set(slot, x)} allowNone />
                {p ? (
                  <>
                    <SourceLine p={p} />
                    <CompositionStack profile={p} />
                    <Coverage profile={p} />
                    <div className="row tight">
                      <button className="btn sm" onClick={() => { openInLab(p); navigate('lab'); }}>Open in Lab</button>
                      <button className="btn sm" onClick={() => { sendToSynth(p, 'A'); toast(`"${p.name}" is driving the Synth.`); }}><IconSend /> Send to Synth</button>
                    </div>
                  </>
                ) : <div className="empty small">Pick a profile, or send one here from Explore or the Lab.</div>}
              </div>
            </Panel>
          );
        })}
      </div>

      {a && b && r && (
        <>
          <Panel title="Similarity" sub={r.method === 'jensen_shannon' ? 'Jensen–Shannon, relative composition' : 'approximate rank comparison'}>
            <div className="grid cols-2">
              <div className="stack" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 22 }}>
                  <div><div className="label">Score</div><div className="readout amber" style={{ fontSize: 30 }}>{r.score == null ? '—' : r.score.toFixed(2)}</div></div>
                  <div><div className="label">Confidence</div><div className="readout" style={{ fontSize: 20 }}>{r.confidence}</div></div>
                  <div><div className="label">Shared compounds</div><div className="readout" style={{ fontSize: 20 }}>{r.shared.length}</div></div>
                  <div><div className="label">Coverage</div><div className="readout" style={{ fontSize: 20 }}>{Math.round(r.coverage * 100)} %</div></div>
                  {r.cosine != null && <div><div className="label">Cosine</div><div className="readout" style={{ fontSize: 20 }}>{r.cosine.toFixed(2)}</div></div>}
                </div>
                {r.percentileVsRandom != null && <p className="small" style={{ margin: 0 }}>More similar than <b>{Math.round(r.percentileVsRandom * 100)} %</b> of random pairs of flower samples in Smith et al. (2022).</p>}
                {r.approximate && <Notice>Approximate: at least one profile only lists dominant compounds, so no laboratory-style precision is implied.</Notice>}
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.explanation.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
              <div>
                <div className="label" style={{ marginBottom: 6 }}>Compounds</div>
                <div className="small" style={{ marginBottom: 4 }}>Shared: <span className="chips" style={{ display: 'inline-flex' }}>{r.shared.map((id) => <AnalyteChip key={id} id={id} />)}</span></div>
                <div className="small" style={{ marginBottom: 4 }}>Only in A: {r.onlyA.length ? <span className="chips" style={{ display: 'inline-flex' }}>{r.onlyA.map((id) => <AnalyteChip key={id} id={id} />)}</span> : 'none'}</div>
                <div className="small">Only in B: {r.onlyB.length ? <span className="chips" style={{ display: 'inline-flex' }}>{r.onlyB.map((id) => <AnalyteChip key={id} id={id} />)}</span> : 'none'}</div>
                <p className="tiny faint">"Only in" means the other profile did not measure it (or it was not part of that mixture) — not that it is absent from the plant.</p>
              </div>
            </div>
          </Panel>

          <div className="grid cols-2">
            <Panel title="Relative composition overlay">
              <Radar profiles={[{ p: a, color: 'var(--amber)', label: `A: ${a.name}` }, { p: b, color: 'var(--teal)', label: `B: ${b.name}` }]} />
            </Panel>
            <Panel title="Differences" sub={comparableAbs ? 'absolute available' : 'relative only'}>
              <DiffChart a={a} b={b} absolute={false} />
              {comparableAbs && (
                <>
                  <hr className="divider" />
                  <DiffChart a={a} b={b} absolute />
                </>
              )}
            </Panel>
          </div>

          {r.absoluteDiffs && (
            <Panel title="Measured concentrations" sub={UNIT_LABEL.pct_w_w}>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Compound</th><th>A</th><th>B</th><th>B − A</th></tr></thead>
                  <tbody>
                    {r.absoluteDiffs.map((d) => <tr key={d.analyte}><td>{analyte(d.analyte).label}</td><td className="mono">{formatValue(d.a, 'pct_w_w')}</td><td className="mono">{formatValue(d.b, 'pct_w_w')}</td><td className="mono">{d.diff > 0 ? '+' : ''}{d.diff.toFixed(3)}</td></tr>)}
                  </tbody>
                </table>
              </div>
              {!comparableAbs && <p className="small" style={{ color: 'var(--danger)' }}>Product types differ, so these concentrations are not directly comparable.</p>}
            </Panel>
          )}

          <Panel title="Data availability & attribution">
            <div className="grid cols-2">
              {[a, b].map((p, k) => (
                <div key={k} className="small">
                  <b>{k ? 'B' : 'A'}: {p.name}</b>
                  <div className="muted">{sourceInfo(p.provenance.sourceId).name} — {sourceInfo(p.provenance.sourceId).license}</div>
                  <div className="muted">{ANALYTE_IDS.filter((id) => p.measurements[id]).length} compounds with a value or result · unit {UNIT_LABEL[p.unit]}</div>
                  {p.provenance.note && <div className="faint tiny">{p.provenance.note}</div>}
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Hear the difference">
            <div className="row">
              <button className="btn primary" onClick={() => { setSynth({ mode: 'analytical', seedLocked: true }); sendBothToSynth(a, b); void play(); toast('Analytical mode: one fixed composition, timbre morphs from A to B. Move the morph control in the Synth.'); navigate('synth'); }}><IconPlay /> A/B in Analytical mode</button>
              <button className="btn" onClick={() => { sendToSynth(a, 'A'); void play(); }}>Play A</button>
              <button className="btn" onClick={() => { sendToSynth(b, 'A'); void play(); }}>Play B</button>
              <button className="btn" onClick={() => { sendBothToSynth(a, b); toast('Both loaded: A in slot A, B as morph target.'); navigate('synth'); }}>Send both to Synth</button>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>Analytical mode keeps key, tempo, arrangement and seed fixed, so what changes between A and B is only the data-driven timbre and mix.</p>
          </Panel>
        </>
      )}
    </div>
  );
}
