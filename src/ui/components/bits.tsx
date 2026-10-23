// Small shared UI pieces: panels, badges, notices, profile picker.

import type { ReactNode } from 'react';
import { analyte, ANALYTE_COLOR } from '../../chem/analytes';
import { DEMO_PROFILES } from '../../chem/demo';
import { sourceInfo } from '../../chem/sources';
import type { AnalyteId, MeasurementStatus, Profile, ProfileKind } from '../../chem/types';
import { STATUS_LABEL } from '../../chem/types';
import { useStore } from '../../store/store';
import { IconAlert, IconInfo } from './icons';

export function Panel({ title, sub, actions, children, className = '', id }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  const hid = id ? `${id}-title` : undefined;
  return (
    <section className={`panel ${className}`} aria-labelledby={hid} id={id}>
      <div className="panel-head">
        <h2 className="panel-title" id={hid}>{title}{sub && <small>{sub}</small>}</h2>
        {actions && <div className="row tight">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

const KIND_LABEL: Record<ProfileKind, { cls: string; text: string; tip: string }> = {
  lab_sample: { cls: 'measured', text: 'Tested sample', tip: 'One laboratory-tested sample from an approved dataset.' },
  cultivar_aggregate: { cls: 'aggregate', text: 'Name aggregate', tip: 'Statistics across many samples sold under one name — not a definition of a strain.' },
  reported: { cls: 'reported', text: 'Descriptive', tip: 'Ranked or named compounds only; no measured values.' },
  hypothetical: { cls: 'hypothetical', text: 'Hypothetical', tip: 'Created or edited by you. Not a measurement.' },
  demo: { cls: 'demo', text: 'Fictional demo', tip: 'Fictional artistic test profile. Not a measurement, cultivar, aroma or effect.' },
  morph: { cls: 'morph', text: 'Synthetic morph', tip: 'Interpolated between two profiles. Not a sample.' },
};

export function KindBadge({ kind }: { kind: ProfileKind }) {
  const k = KIND_LABEL[kind];
  return <span className={`badge ${k.cls}`} title={k.tip}>{k.text}</span>;
}

export function StatusText({ status }: { status: MeasurementStatus }) {
  return <span className={`status ${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Notice({ kind = 'warn', children }: { kind?: 'warn' | 'info' | 'art' | 'err'; children: ReactNode }) {
  return (
    <div className={`notice ${kind === 'warn' ? '' : kind}`} role={kind === 'err' ? 'alert' : 'note'}>
      {kind === 'warn' || kind === 'err' ? <IconAlert size={16} /> : <IconInfo size={16} />}
      <div>{children}</div>
    </div>
  );
}

export function ArtisticNote() {
  return (
    <Notice kind="art">
      Chemical-to-musical relationships here are <b>artistic design choices</b>. They are not evidence of any psychological, physiological or acoustic property of these compounds, and say nothing about how any product would make someone feel.
    </Notice>
  );
}

export function SourceLine({ p }: { p: Profile }) {
  const src = sourceInfo(p.provenance.sourceId);
  const bits = [src.short, p.provenance.lab, p.provenance.producer, p.provenance.productForm, p.provenance.date].filter(Boolean);
  return (
    <div className="small muted">
      {bits.join(' · ')}
      {p.provenance.derivedFrom && <> · derived from <i>{p.provenance.derivedFrom.name}</i></>}
    </div>
  );
}

export function AnalyteChip({ id, suffix }: { id: AnalyteId; suffix?: string }) {
  return (
    <span className="chip" title={analyte(id).label}>
      <i className="swatch" style={{ background: ANALYTE_COLOR[id], width: 9, height: 9 }} />
      {analyte(id).short}{suffix ? ` ${suffix}` : ''}
    </span>
  );
}

/** Grouped selector of every profile the user can reach without leaving the page. */
export function ProfilePicker({ value, onChange, label, allowNone = false, id }: { value: Profile | null; onChange: (p: Profile | null) => void; label: string; allowNone?: boolean; id?: string }) {
  const library = useStore((s) => s.library);
  const recent = useStore((s) => s.recent);
  const labProfile = useStore((s) => s.lab.profile);
  const groups: { name: string; items: Profile[] }[] = [
    { name: 'Current Lab profile', items: [labProfile] },
    { name: 'Demonstration (fictional)', items: DEMO_PROFILES },
    { name: 'My library', items: library },
    { name: 'Recently loaded data', items: recent },
  ];
  const all = new Map<string, Profile>();
  for (const g of groups) for (const p of g.items) all.set(p.id, p);
  if (value) all.set(value.id, value);
  const seen = new Set<string>();
  return (
    <label className="field">
      <span className="label">{label}</span>
      <select
        id={id}
        className="select"
        value={value?.id ?? ''}
        onChange={(e) => onChange(e.target.value ? all.get(e.target.value) ?? null : null)}
      >
        {allowNone && <option value="">— none —</option>}
        {value && !groups.some((g) => g.items.some((p) => p.id === value.id)) && <option value={value.id}>{value.name}</option>}
        {groups.map((g) => {
          const items = g.items.filter((p) => !seen.has(p.id) && (seen.add(p.id), true));
          return items.length ? (
            <optgroup key={g.name} label={g.name}>
              {items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          ) : null;
        })}
      </select>
    </label>
  );
}

export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
