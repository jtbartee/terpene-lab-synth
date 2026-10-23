// Editable terpene → sound mapping matrix with live target readouts.

import { useState } from 'react';
import { ANALYTE_IDS, analyte } from '../../chem/analytes';
import type { AnalyteId } from '../../chem/types';
import { BUILT_IN_PRESETS, type ControlState, type Curve, type FeatureBasis, type Route } from '../../sonify/mapping';
import { TARGETS, targetInfo, type TargetId } from '../../sonify/targets';
import { deleteMapping, saveMapping } from '../../store/actions';
import { setSynth, useStore } from '../../store/store';
import { Panel } from '../components/bits';
import { IconSave, IconTrash } from '../components/icons';

export function MappingMatrix({ controls }: { controls: ControlState }) {
  const mapping = useStore((s) => s.synth.mapping);
  const mode = useStore((s) => s.synth.mode);
  const userMappings = useStore((s) => s.mappings);
  const [addA, setAddA] = useState<AnalyteId>('myrcene');
  const [addT, setAddT] = useState<TargetId>('droneDepth');
  const [open, setOpen] = useState(() => typeof matchMedia === 'undefined' || !matchMedia('(max-width: 760px)').matches);
  const presets = [...BUILT_IN_PRESETS, ...userMappings];
  const update = (routes: Route[]) => setSynth({ mapping: { ...mapping, id: mapping.builtIn ? `${mapping.id}-edited` : mapping.id, name: mapping.builtIn ? `${mapping.name} (edited)` : mapping.name, builtIn: false, routes } });
  const setRoute = (i: number, patch: Partial<Route>) => update(mapping.routes.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <Panel title="Mapping matrix" sub="terpene → sound (artistic)" actions={
      <>
        <select className="select" aria-label="Mapping preset" value={mapping.id} onChange={(e) => { const m = presets.find((x) => x.id === e.target.value); if (m) setSynth({ mapping: m }); }}>
          {!presets.some((x) => x.id === mapping.id) && <option value={mapping.id}>{mapping.name}</option>}
          {presets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select className="select" aria-label="Feature basis" value={mapping.basis} onChange={(e) => setSynth({ mapping: { ...mapping, basis: e.target.value as FeatureBasis } })} title="How chemical values become 0–1 features">
          <option value="auto">Basis: auto</option>
          <option value="relative">Basis: relative share</option>
          <option value="percentile">Basis: population percentile</option>
        </select>
        <button className="btn sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide matrix' : 'Show matrix'}</button>
        <button className="btn sm" onClick={() => { const n = prompt('Name this mapping', mapping.name.replace(' (edited)', ' variant')); if (n) void saveMapping(n); }}><IconSave /> Save mapping</button>
        {!mapping.builtIn && userMappings.some((m) => m.id === mapping.id) && <button className="btn sm danger" onClick={() => deleteMapping(mapping.id)}><IconTrash /> Delete</button>}
      </>
    }>
      <p className="small muted" style={{ marginTop: 0 }}>
        Pipeline: original measurement (unchanged) → feature 0–1 ({mapping.basis === 'relative' ? 'share of the measured total; 40 % = 1.0' : mapping.basis === 'percentile' ? 'percentile among 43,148 flower samples (Smith et al. 2022); falls back to share where no reference exists' : 'percentile for measured % w/w data, relative share for hypothetical weights'}) → response curve → depth → target (neutral + Σ, clamped 0–1) → bounded, smoothed audio parameter. Missing compounds disable their routes; they are never read as zero.
        {mode === 'analytical' && ' In Analytical mode, routes into compositional targets are held neutral.'}
      </p>
      <div className="grid matrix-grid" hidden={!open}>
        <div className="table-wrap">
          <table className="table matrix">
            <thead><tr><th>On</th><th>Compound</th><th>Feature</th><th>Target</th><th>Depth</th><th>Curve</th><th /></tr></thead>
            <tbody>
              {mapping.routes.map((r, i) => {
                const f = controls.features[r.analyte];
                return (
                  <tr key={`${r.analyte}-${r.target}-${i}`}>
                    <td><input type="checkbox" checked={r.enabled} onChange={(e) => setRoute(i, { enabled: e.target.checked })} aria-label={`Enable ${analyte(r.analyte).label} to ${targetInfo(r.target).label}`} /></td>
                    <td className="small">{analyte(r.analyte).label}</td>
                    <td className="mono tiny" title={f?.note}>{f?.value == null ? <span className="faint">missing</span> : `${(f.value * 100).toFixed(0)}${f.basis === 'percentile' ? ' pct' : ''}`}</td>
                    <td>
                      <select className="select" value={r.target} onChange={(e) => setRoute(i, { target: e.target.value as TargetId })} aria-label="Target">
                        {TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}{t.composition ? ' ◆' : ''}</option>)}
                      </select>
                    </td>
                    <td><input type="range" min={-1} max={1} step={0.05} value={r.amount} onChange={(e) => setRoute(i, { amount: Number(e.target.value) })} aria-label="Depth" /> <span className="mono tiny">{Math.round(r.amount * 100)}</span></td>
                    <td>
                      <select className="select" value={r.curve} onChange={(e) => setRoute(i, { curve: e.target.value as Curve })} aria-label="Response curve">
                        <option value="linear">linear</option><option value="exponential">exponential</option><option value="logarithmic">logarithmic</option><option value="scurve">s-curve</option>
                      </select>
                    </td>
                    <td><button className="btn sm ghost icon" onClick={() => update(mapping.routes.filter((_, k) => k !== i))} aria-label="Remove route"><IconTrash size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 8 }}>
            <select className="select" value={addA} onChange={(e) => setAddA(e.target.value as AnalyteId)} aria-label="New route compound">{ANALYTE_IDS.map((id) => <option key={id} value={id}>{analyte(id).label}</option>)}</select>
            <span className="muted">→</span>
            <select className="select" value={addT} onChange={(e) => setAddT(e.target.value as TargetId)} aria-label="New route target">{TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
            <button className="btn sm" onClick={() => update([...mapping.routes, { analyte: addA, target: addT, amount: 0.5, curve: 'linear', enabled: true }])}>Add route</button>
            <span className="tiny faint">◆ = changes notes/rhythm/arrangement</span>
          </div>
        </div>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Target values now (profile A)</div>
          <div className="table-wrap">
            <table className="table matrix">
              <tbody>
                {TARGETS.map((t) => {
                  const tv = controls.targets[t.id];
                  return (
                    <tr key={t.id} title={t.effect}>
                      <td className="small">{t.label}{t.composition ? ' ◆' : ''}</td>
                      <td style={{ width: '45%' }}><div className="target-bar" aria-hidden="true"><i style={{ width: `${tv.value * 100}%`, opacity: tv.heldByMode ? 0.35 : 1 }} /><b style={{ left: `${t.neutral * 100}%` }} /></div></td>
                      <td className="mono tiny">{Math.round(tv.value * 100)}{tv.heldByMode ? ' held' : tv.fallback ? ' neutral' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="tiny faint">Grey tick = neutral value. "neutral" = no data for any route into this target (labelled fallback). "held" = fixed by Analytical mode.</p>
        </div>
      </div>
    </Panel>
  );
}
