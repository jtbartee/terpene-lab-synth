// TERPENE LAB: chemical explorer and mixing console.

import { useMemo, useState, type ReactNode } from 'react';
import { ANALYTE_COLOR, ANALYTE_IDS, CORE_CHANNELS, analyte } from '../../chem/analytes';
import { DEMO_A, DEMO_B } from '../../chem/demo';
import { deriveHypothetical, duplicateProfile, emptyHypothetical, numericValue, randomHypothetical, relativeComposition, setValue, sliderMax } from '../../chem/profile';
import type { AnalyteId, Profile } from '../../chem/types';
import { UNIT_LABEL, isAbsoluteUnit } from '../../chem/types';
import { mulberry32, randomSeed } from '../../music/rng';
import { targetInfo } from '../../sonify/targets';
import { editLabProfile, openInLab, saveProfile, sendToSynth } from '../../store/actions';
import { getState, navigate, setLab, setState, toast, useStore } from '../../store/store';
import { KindBadge, Notice, Panel, ProfilePicker, SourceLine, StatusText } from '../components/bits';
import { IconCompare, IconCopy, IconDice, IconInfo, IconLock, IconMute, IconPlay, IconPlus, IconReset, IconSave, IconSend, IconSpeaker, IconUnlock, IconClose } from '../components/icons';
import { CompositionStack, FamilyChart, ProfileBars, Radar, StatusTable } from '../viz/charts';
import { MoleculeField } from '../viz/molecules';
import { play } from '../../store/actions';

type VizTab = 'bars' | 'composition' | 'radar' | 'families' | 'molecules' | 'table';

export function LabView() {
  const lab = useStore((s) => s.lab);
  const mapping = useStore((s) => s.synth.mapping);
  const followLab = useStore((s) => s.synth.followLab);
  const synthA = useStore((s) => s.synth.profileA);
  const [tab, setTab] = useState<VizTab>('bars');
  const [renaming, setRenaming] = useState(false);
  const p = lab.profile;
  const routesFor = useMemo(() => {
    const m = new Map<AnalyteId, string[]>();
    for (const r of mapping.routes) if (r.enabled) m.set(r.analyte, [...(m.get(r.analyte) ?? []), targetInfo(r.target).label]);
    return m;
  }, [mapping]);
  const hidden = ANALYTE_IDS.filter((id) => !lab.visible.includes(id));
  const linked = followLab && synthA?.id === p.id;

  const randomize = () => {
    const pool = lab.visible.filter((id) => !lab.locked.includes(id));
    const r = mulberry32(randomSeed());
    const rnd = randomHypothetical(pool, r, 'Random mixture');
    editLabProfile((cur) => {
      let next: Profile = { ...cur };
      for (const id of pool) next = setValue(next, id, null);
      if (cur.unit === 'relative_weight' || cur.unit === 'relative_pct') {
        for (const [id, m] of Object.entries(rnd.measurements)) next = setValue(next, id as AnalyteId, m!.value);
      } else {
        // absolute units: scale random weights into a plausible flower range (total ≈ 1.5 % w/w)
        const tot = Object.values(rnd.measurements).reduce((s, m) => s + (m!.value ?? 0), 0);
        for (const [id, m] of Object.entries(rnd.measurements)) next = setValue(next, id as AnalyteId, Math.round(((m!.value ?? 0) / tot) * 1.5 * 1000) / 1000);
      }
      return { ...next, name: cur.name.startsWith('Random') ? cur.name : `${cur.name} (randomised)` };
    });
  };

  return (
    <div className="stack">
      <div className="view-head">
        <div>
          <h1 className="view-title">Terpene Lab</h1>
          <p className="view-sub">Explore, edit and compare terpene profiles. Measured data stays untouched — editing it creates a hypothetical copy. Values feed the Synth when you send a profile there.</p>
        </div>
      </div>

      <StartHere />

      <Panel title="Profile" sub={UNIT_LABEL[p.unit]} actions={
        <>
          <button className="btn sm" onClick={() => saveProfile(p).catch(() => {})}><IconSave /> {lab.savedId ? 'Save changes' : 'Save'}</button>
          <button className="btn sm" onClick={() => setRenaming(true)} disabled={p.kind !== 'hypothetical'} title={p.kind !== 'hypothetical' ? 'Only hypothetical profiles can be renamed (edit it first)' : 'Rename'}>Rename</button>
          <button className="btn sm" onClick={() => openInLab(p.kind === 'hypothetical' ? duplicateProfile(p) : deriveHypothetical(p, `${p.name} copy`))}><IconCopy /> Duplicate</button>
          <button className="btn sm" onClick={() => setLab({ profile: lab.original, notice: null })} disabled={lab.original === p}><IconReset /> Reset</button>
          <button className="btn sm" onClick={randomize}><IconDice /> Randomise</button>
          <button className="btn sm" onClick={() => { openInLab(emptyHypothetical()); }}><IconPlus /> New</button>
        </>
      }>
        <div className="grid profile-head">
          <div className="stack" style={{ gap: 6 }}>
            <div className="row">
              {renaming ? (
                <form className="row" onSubmit={(e) => { e.preventDefault(); const v = (new FormData(e.currentTarget).get('name') as string).trim(); if (v) setLab({ profile: { ...p, name: v } }); setRenaming(false); }}>
                  <input name="name" className="input" defaultValue={p.name} autoFocus aria-label="Profile name" style={{ minWidth: 260 }} />
                  <button className="btn sm primary">OK</button>
                  <button type="button" className="btn sm" onClick={() => setRenaming(false)}>Cancel</button>
                </form>
              ) : <h2 style={{ fontSize: 19 }}>{p.name}</h2>}
              <KindBadge kind={p.kind} />
              {linked && <span className="badge measured plain" title="Every change here is heard immediately in the Synth">Live in Synth</span>}
            </div>
            <SourceLine p={p} />
            {p.provenance.note && <p className="small muted" style={{ margin: 0 }}>{p.provenance.note}</p>}
          </div>
          <ProfilePicker label="Load profile" value={p} onChange={(x) => x && openInLab(x)} />
        </div>
        {lab.notice && <div style={{ marginTop: 10 }}><Notice>{lab.notice}</Notice></div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => { sendToSynth(p, 'A', lab.muted); toast(`"${p.name}" is now driving the Synth.`); }}><IconSend /> Send to Synth</button>
          <button className="btn go" onClick={() => { sendToSynth(p, 'A', lab.muted); void play(); }}><IconPlay /> Send &amp; play</button>
          <button className="btn" onClick={() => { sendToSynth(p, 'B'); toast(`"${p.name}" loaded as morph target B.`); }}>Send as morph B</button>
          <button className="btn" onClick={() => { setState((s) => ({ compare: { ...s.compare, a: p } })); navigate('compare'); }}><IconCompare /> Compare</button>
          <button className="btn ghost" onClick={() => navigate('explore')}>Browse real data →</button>
          <div className="spacer" />
          <div className="seg" role="group" aria-label="Display mode">
            <button aria-pressed={lab.view === 'measured'} onClick={() => setLab({ view: 'measured' })}>Measured concentration</button>
            <button aria-pressed={lab.view === 'relative'} onClick={() => setLab({ view: 'relative' })}>Relative composition</button>
          </div>
        </div>
      </Panel>

      <Panel title="Mixing console" sub={`${lab.visible.length} channels`} actions={
        <span className="tiny faint">Mute removes a compound from the mix and the Synth · Lock protects it from Randomise</span>
      }>
        <div className="console" role="group" aria-label="Terpene channels">
          {lab.visible.map((id) => <Strip key={id} id={id} profile={p} view={lab.view} muted={lab.muted.includes(id)} locked={lab.locked.includes(id)} routes={routesFor.get(id) ?? []} />)}
          <div className="strip-add">
            <label className="label" htmlFor="add-ch">Add channel</label>
            <select id="add-ch" className="select" value="" onChange={(e) => e.target.value && setLab({ visible: [...lab.visible, e.target.value as AnalyteId] })}>
              <option value="">Add…</option>
              {hidden.map((id) => <option key={id} value={id}>{analyte(id).label}{CORE_CHANNELS.includes(id) ? '' : ' (extra)'}</option>)}
            </select>
            <button className="btn sm" onClick={() => setLab({ visible: [...ANALYTE_IDS].filter((id) => CORE_CHANNELS.includes(id)) })}>Show all 16</button>
          </div>
        </div>
      </Panel>

      <div className="grid lab-grid">
        <Panel title="Visualise">
          <div className="tabs" role="tablist" aria-label="Visualisations">
            {(['bars', 'composition', 'radar', 'families', 'molecules', 'table'] as VizTab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{{ bars: 'Bars', composition: 'Composition', radar: 'Radar', families: 'Families', molecules: 'Molecules', table: 'Data table' }[t]}</button>
            ))}
          </div>
          <div role="tabpanel">
            {tab === 'bars' && <ProfileBars profile={p} analytes={lab.visible} mode={lab.view} muted={lab.muted} />}
            {tab === 'composition' && <CompositionStack profile={p} muted={lab.muted} />}
            {tab === 'radar' && <Radar profiles={[{ p, color: 'var(--amber)', label: p.name }]} />}
            {tab === 'families' && <FamilyChart profile={p} />}
            {tab === 'molecules' && <MoleculeField profile={p} muted={lab.muted} />}
            {tab === 'table' && <StatusTable profile={p} analytes={ANALYTE_IDS} />}
          </div>
        </Panel>
        <Panel title="Reading this profile">
          <ProfileSummary p={p} muted={lab.muted} />
        </Panel>
      </div>
    </div>
  );
}

function StartHere() {
  const labId = useStore((s) => s.lab.profile.id);
  return (
    <Panel title="Start here" sub="two fictional demonstration profiles">
      <div className="grid cols-2">
        {[DEMO_A, DEMO_B].map((d) => (
          <div key={d.id} className="item" style={{ borderColor: labId === d.id ? 'var(--amber)' : undefined }}>
            <div>
              <div className="row tight"><span className="item-title">{d.name}</span><KindBadge kind="demo" /></div>
              <div className="item-meta">{Object.entries(d.measurements).map(([k, m]) => `${analyte(k as AnalyteId).short} ${m!.value}`).join(' · ')}</div>
            </div>
            <div className="row tight">
              <button className="btn sm" onClick={() => openInLab(d)}>Load in Lab</button>
              <button className="btn sm go" onClick={() => { openInLab(d); sendToSynth(d, 'A'); void play(); }}><IconPlay /> Hear it</button>
            </div>
          </div>
        ))}
      </div>
      <p className="tiny faint" style={{ marginTop: 8 }}>Fictional artistic test profiles — not laboratory measurements, known cultivars, validated aromas or predicted effects.</p>
    </Panel>
  );
}

function Strip({ id, profile, view, muted, locked, routes }: { id: AnalyteId; profile: Profile; view: 'measured' | 'relative'; muted: boolean; locked: boolean; routes: string[] }) {
  const a = analyte(id);
  const m = profile.measurements[id];
  const v = numericValue(m);
  const max = sliderMax(profile.unit);
  const step = isAbsoluteUnit(profile.unit) ? 0.001 : 1;
  const share = relativeComposition(profile).shares[id];
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (v == null ? '' : String(Number(v.toFixed(isAbsoluteUnit(profile.unit) ? 3 : 1))));
  const setVal = (x: number | null) => editLabProfile((cur) => setValue(cur, id, x == null ? null : Math.max(0, Math.min(max * 10, x))));
  const toggle = (key: 'muted' | 'locked') => {
    const lab = getState().lab;
    const list = lab[key];
    setLab({ [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] } as never);
  };
  return (
    <div className={`strip${muted ? ' muted-ch' : ''}`} aria-label={`${a.label} channel`} role="group">
      <div className="strip-color" style={{ background: ANALYTE_COLOR[id] }} />
      <div className="row tight" style={{ width: '100%', justifyContent: 'space-between' }}>
        <span className="strip-code">{a.short}</span>
        <button className="btn sm ghost icon" onClick={() => setState({ infoAnalyte: id })} aria-label={`About ${a.label}`} title="Compound details"><IconInfo size={14} /></button>
      </div>
      <div className="strip-name">{a.label}</div>
      <input
        type="range"
        className="vfader"
        min={0}
        max={max}
        step={step}
        value={Math.min(max, v ?? 0)}
        onChange={(e) => setVal(Number(e.target.value))}
        aria-label={`${a.label} ${UNIT_LABEL[profile.unit]}`}
        aria-valuetext={v == null ? 'not measured' : `${v} ${UNIT_LABEL[profile.unit]}`}
        disabled={muted}
      />
      <input
        className="input strip-val"
        inputMode="decimal"
        value={shown}
        placeholder="—"
        aria-label={`${a.label} value`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft != null) { const n = draft.trim() === '' ? null : Number(draft); if (n == null || Number.isFinite(n)) setVal(n); setDraft(null); } }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      <div className="tiny readout" aria-hidden="true">{view === 'relative' ? (share != null && !muted ? `${(share * 100).toFixed(1)}%` : '—') : profile.unit === 'relative_weight' ? 'weight' : UNIT_LABEL[profile.unit]}</div>
      <StatusText status={m?.status ?? 'not_measured'} />
      <div className="strip-btns">
        <button className="btn sm" aria-pressed={muted} onClick={() => toggle('muted')} aria-label={`${muted ? 'Unmute' : 'Mute'} ${a.label}`} title={muted ? 'Unmute' : 'Mute (exclude from mix and Synth)'}>{muted ? <IconMute size={14} /> : <IconSpeaker size={14} />}</button>
        <button className="btn sm" aria-pressed={locked} onClick={() => toggle('locked')} aria-label={`${locked ? 'Unlock' : 'Lock'} ${a.label}`} title={locked ? 'Unlock' : 'Lock (Randomise leaves it alone)'}>{locked ? <IconLock size={14} /> : <IconUnlock size={14} />}</button>
        <button className="btn sm" onClick={() => setLab({ visible: getState().lab.visible.filter((x) => x !== id) })} aria-label={`Remove ${a.label} channel`} title="Hide channel"><IconClose size={14} /></button>
      </div>
      <div className="strip-map" title="Artistic mapping in the Synth">{routes.length ? `→ ${routes.join(' · ')}` : 'no mapping'}</div>
    </div>
  );
}

function ProfileSummary({ p, muted }: { p: Profile; muted: AnalyteId[] }) {
  const comp = relativeComposition(p, ANALYTE_IDS.filter((a) => !muted.includes(a)));
  const top = comp.covered.map((id) => [id, comp.shares[id] ?? 0] as const).sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, s]) => s > 0);
  return (
    <div className="stack small" style={{ gap: 8 }}>
      <p style={{ margin: 0 }}>
        {top.length ? <>Leading compounds: {top.map(([id, s]) => <b key={id}>{analyte(id).label} ({(s * 100).toFixed(0)} %)</b>).reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, ', ', el] : [el]), [])} of the measured total.</> : 'No compounds have a value yet — move a fader to build a hypothetical mixture.'}
      </p>
      {isAbsoluteUnit(p.unit) && <p style={{ margin: 0 }}>Measured total of the compounds shown: <span className="readout amber">{comp.total.toFixed(3)} % w/w</span>. Smith et al. (2022) report total terpenes averaging about 2 % of flower weight across all measured terpenes.</p>}
      <p style={{ margin: 0 }} className="muted">Coverage {comp.covered.length}/{ANALYTE_IDS.length}. {comp.missing.length ? `${comp.missing.length} compounds were not measured; they are excluded, not counted as zero.` : ''}</p>
      {p.kind === 'cultivar_aggregate' && <Notice kind="info">This is the median of many samples sold under one name. Smith et al. (2022) found that samples sharing a name vary widely and commercial labels align poorly with chemistry.</Notice>}
      {p.kind === 'lab_sample' && <Notice kind="info">One tested sample. Another product with the same name can differ substantially (Smith et al. 2022; Schwabe &amp; McGlaughlin 2019).</Notice>}
      {(p.kind === 'hypothetical' || p.kind === 'demo') && <p className="muted" style={{ margin: 0 }}>Hypothetical values are artistic or exploratory inputs and do not describe any real product.</p>}
    </div>
  );
}
