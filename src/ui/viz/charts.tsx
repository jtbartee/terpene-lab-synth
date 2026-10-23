// Profile charts. Every chart shows real values with units; missing data is
// drawn as missing (hatched, labelled), never as a zero-length bar.

import { ANALYTE_COLOR, ANALYTE_IDS, FAMILY_LABEL, analyte } from '../../chem/analytes';
import { numericValue, relativeComposition } from '../../chem/profile';
import type { AnalyteId, ChemicalFamily, Profile } from '../../chem/types';
import { STATUS_LABEL, UNIT_LABEL, isAbsoluteUnit } from '../../chem/types';
import { formatValue } from '../../chem/units';
import { StatusText } from '../components/bits';

function valueLabel(p: Profile, id: AnalyteId): string {
  const m = p.measurements[id];
  if (!m) return 'not measured';
  switch (m.status) {
    case 'not_detected': return m.flags?.includes('zero_ambiguous') ? 'reported 0' : 'ND';
    case 'below_lod': return '< LOD';
    case 'below_loq': return '< LOQ';
    case 'not_reported': return 'not reported';
    case 'not_measured': return 'not measured';
    case 'rejected': return 'withheld';
    case 'at_floor': return `≤ ${formatValue(m.floor ?? m.value, p.unit)}`;
    default: return formatValue(m.value, p.unit);
  }
}

export function ProfileBars({ profile, analytes, mode, muted = [] }: { profile: Profile; analytes: readonly AnalyteId[]; mode: 'measured' | 'relative'; muted?: readonly AnalyteId[] }) {
  const comp = relativeComposition(profile, analytes.filter((a) => !muted.includes(a)));
  const values = analytes.map((id) => {
    const m = profile.measurements[id];
    const v = numericValue(m);
    return { id, v, q3: m?.stats?.q3 ?? 0 };
  });
  const maxAbs = Math.max(...values.map((x) => Math.max(x.v ?? 0, x.q3)), 1e-9) * 1.08;
  const maxRel = Math.max(...Object.values(comp.shares).map((x) => x ?? 0), 0.01) * 1.08;
  const unitText = mode === 'relative' ? UNIT_LABEL.relative_pct : UNIT_LABEL[profile.unit];
  return (
    <div>
      <div className="row small muted" style={{ marginBottom: 6 }}>
        <span>{mode === 'relative' ? 'Relative composition — each compound as a share of the measured terpenes shown, not % of sample mass.' : `Values in ${unitText}${profile.kind === 'cultivar_aggregate' ? ' · bar = median, whisker = interquartile range' : ''}.`}</span>
      </div>
      <div className="bars" role="list" aria-label={`${mode === 'relative' ? 'Relative composition' : 'Concentrations'} of ${profile.name}`}>
        {values.map(({ id, v }) => {
          const m = profile.measurements[id];
          const isMuted = muted.includes(id);
          const share = comp.shares[id];
          const frac = mode === 'relative' ? (share != null ? share / maxRel : null) : v != null ? v / maxAbs : null;
          const label = mode === 'relative' ? (share != null && !isMuted ? `${(share * 100).toFixed(1)} %` : isMuted ? 'muted' : valueLabel(profile, id)) : valueLabel(profile, id);
          const status = m?.status ?? 'not_measured';
          return (
            <div className="bar-row" role="listitem" key={id} aria-label={`${analyte(id).label}: ${label}${m ? `, ${STATUS_LABEL[status]}` : ''}`}>
              <div className="bar-name" title={analyte(id).label}>
                <i className="swatch" style={{ background: ANALYTE_COLOR[id] }} />
                <span>{analyte(id).label}</span>
              </div>
              <div className="bar-track">
                {frac == null || isMuted ? <div className="bar-missing" /> : <div className="bar-fill" style={{ width: `${Math.max(0.5, frac * 100)}%`, background: ANALYTE_COLOR[id] }} />}
                {mode === 'measured' && m?.stats && !isMuted && (
                  <div className="bar-iqr" style={{ left: `${(m.stats.q1 / maxAbs) * 100}%`, width: `${Math.max(0.5, ((m.stats.q3 - m.stats.q1) / maxAbs) * 100)}%` }} />
                )}
                {mode === 'measured' && m?.floor != null && maxAbs > 0 && <div className="bar-floor" style={{ left: `${(m.floor / maxAbs) * 100}%` }} title={`Lab reporting floor ${m.floor}`} />}
              </div>
              <div className="bar-val">{label}</div>
            </div>
          );
        })}
      </div>
      <Coverage profile={profile} analytes={analytes} />
    </div>
  );
}

export function Coverage({ profile, analytes = ANALYTE_IDS }: { profile: Profile; analytes?: readonly AnalyteId[] }) {
  const comp = relativeComposition(profile, analytes);
  return (
    <div>
      <div className="coverage" aria-label="Coverage of compounds">
        {analytes.map((id) => (
          <span key={id} className={comp.covered.includes(id) ? 'covered' : 'missing'} title={`${analyte(id).label}: ${comp.covered.includes(id) ? 'covered' : 'not measured'}`}>
            {analyte(id).short}
          </span>
        ))}
      </div>
      <div className="tiny faint" style={{ marginTop: 4 }}>
        Coverage: {comp.covered.length} of {analytes.length} compounds have a value or a not-detected result{comp.missing.length ? '; struck-through compounds were not measured and are not treated as zero.' : '.'}
        {comp.floorValues.length > 0 && ` ${comp.floorValues.length} value(s) sit at the lab's reporting floor.`}
      </div>
    </div>
  );
}

export function CompositionStack({ profile, muted = [] }: { profile: Profile; muted?: readonly AnalyteId[] }) {
  const comp = relativeComposition(profile, ANALYTE_IDS.filter((a) => !muted.includes(a)));
  const entries = comp.covered.map((id) => [id, comp.shares[id] ?? 0] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <div className="stacked" role="img" aria-label={`Relative composition: ${entries.map(([id, s]) => `${analyte(id).label} ${(s * 100).toFixed(0)}%`).join(', ')}`}>
        {entries.map(([id, s]) => (
          <div key={id} style={{ width: `${s * 100}%`, background: ANALYTE_COLOR[id] }} title={`${analyte(id).label}: ${(s * 100).toFixed(1)} %`}>
            {s > 0.07 ? analyte(id).short : ''}
          </div>
        ))}
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        {entries.map(([id, s]) => <span key={id}><i className="swatch" style={{ background: ANALYTE_COLOR[id] }} />{analyte(id).label} {(s * 100).toFixed(1)} %</span>)}
      </div>
    </div>
  );
}

/** Polar chart of relative shares. Needs ≥ 3 covered analytes to be meaningful. */
export function Radar({ profiles, analytes, size = 300 }: { profiles: { p: Profile; color: string; label: string }[]; analytes?: readonly AnalyteId[]; size?: number }) {
  const ids = (analytes ?? ANALYTE_IDS).filter((id) => profiles.some(({ p }) => relativeComposition(p).covered.includes(id)));
  if (ids.length < 3) return <div className="empty small">A radar chart needs at least three measured compounds.</div>;
  const comps = profiles.map(({ p }) => relativeComposition(p, ids));
  const max = Math.max(...comps.flatMap((c) => Object.values(c.shares).map((x) => x ?? 0)), 0.05);
  const c = size / 2;
  const R = size / 2 - 52;
  const angle = (i: number) => (i / ids.length) * 2 * Math.PI - Math.PI / 2;
  const point = (i: number, v: number) => [c + R * (v / max) * Math.cos(angle(i)), c + R * (v / max) * Math.sin(angle(i))];
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Radar of relative composition for ${profiles.map((x) => x.label).join(' and ')}`}>
        {[0.25, 0.5, 0.75, 1].map((g) => <circle key={g} cx={c} cy={c} r={R * g} className="grid-line" fill="none" />)}
        {ids.map((id, i) => {
          const [x, y] = point(i, max);
          const [lx, ly] = [c + (R + 18) * Math.cos(angle(i)), c + (R + 18) * Math.sin(angle(i))];
          return (
            <g key={id}>
              <line x1={c} y1={c} x2={x} y2={y} className="axis" />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)' }}>{analyte(id).short}</text>
            </g>
          );
        })}
        {profiles.map(({ color, label }, k) => {
          const pts = ids.map((id, i) => {
            const share = comps[k].shares[id];
            return share == null ? null : point(i, share);
          });
          const poly = pts.map((p2, i) => p2 ?? point(i, 0)).map((p2) => p2.join(',')).join(' ');
          return (
            <g key={label}>
              <polygon points={poly} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={2} strokeDasharray={k === 1 ? '5 3' : undefined} />
              {pts.map((p2, i) => p2 ? <circle key={i} cx={p2[0]} cy={p2[1]} r={2.6} fill={color} /> : null)}
            </g>
          );
        })}
        <text x={8} y={size - 8} style={{ fontSize: 10 }} className="faint">ring = {(max * 100).toFixed(0)} % of measured terpenes</text>
      </svg>
      {profiles.length > 1 && (
        <figcaption className="legend">
          {profiles.map(({ color, label }, k) => <span key={label}><i className="swatch" style={{ background: color, borderStyle: k ? 'dashed' : 'solid' }} />{label}{k ? ' (dashed)' : ' (solid)'}</span>)}
        </figcaption>
      )}
    </figure>
  );
}

export function FamilyChart({ profile }: { profile: Profile }) {
  const comp = relativeComposition(profile);
  const fams: ChemicalFamily[] = ['monoterpene', 'monoterpenoid', 'sesquiterpene', 'sesquiterpenoid'];
  const rows = fams.map((f) => {
    const members = comp.covered.filter((id) => analyte(id).family === f);
    return { f, share: members.reduce((s, id) => s + (comp.shares[id] ?? 0), 0), members };
  });
  const pattern: Record<ChemicalFamily, string> = { monoterpene: 'var(--olive)', monoterpenoid: 'var(--teal)', sesquiterpene: 'var(--amber)', sesquiterpenoid: 'var(--violet)' };
  return (
    <div className="bars">
      {rows.map(({ f, share, members }) => (
        <div key={f}>
          <div className="bar-row" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) 70px' }}>
            <div className="bar-name small">{FAMILY_LABEL[f]}</div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${share * 100}%`, background: pattern[f] }} /></div>
            <div className="bar-val">{(share * 100).toFixed(1)} %</div>
          </div>
          <div className="tiny faint" style={{ margin: '2px 0 6px' }}>{members.length ? members.map((id) => analyte(id).label).join(', ') : 'none measured'}</div>
        </div>
      ))}
      <div className="tiny faint">Shares of the measured total. Hydrocarbon vs. oxygenated grouping follows the molecular formula of each compound.</div>
    </div>
  );
}

/** Diverging bars: B − A in relative share (and absolute when comparable). */
export function DiffChart({ a, b, absolute }: { a: Profile; b: Profile; absolute: boolean }) {
  const ca = relativeComposition(a);
  const cb = relativeComposition(b);
  const ids = ANALYTE_IDS.filter((id) => ca.covered.includes(id) || cb.covered.includes(id));
  const rows = ids.map((id) => {
    const both = ca.covered.includes(id) && cb.covered.includes(id);
    let d: number | null = null;
    if (both) {
      if (absolute && isAbsoluteUnit(a.unit) && isAbsoluteUnit(b.unit)) d = (numericValue(b.measurements[id]) ?? 0) - (numericValue(a.measurements[id]) ?? 0);
      else d = (cb.shares[id] ?? 0) - (ca.shares[id] ?? 0);
    }
    return { id, d, both };
  });
  const max = Math.max(...rows.map((r) => Math.abs(r.d ?? 0)), 1e-9);
  const unit = absolute ? UNIT_LABEL[a.unit] : 'percentage points of measured terpenes';
  return (
    <div>
      <div className="small muted" style={{ marginBottom: 6 }}>Difference B − A, in {unit}. Right = more in B, left = more in A.</div>
      <div className="bars">
        {rows.map(({ id, d, both }) => (
          <div className="bar-row" key={id}>
            <div className="bar-name"><i className="swatch" style={{ background: ANALYTE_COLOR[id] }} />{analyte(id).label}</div>
            <div className="bar-track">
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--line-2)' }} />
              {d == null ? <div className="bar-missing" /> : (
                <div className="bar-fill" style={{
                  left: d >= 0 ? '50%' : `${50 - (Math.abs(d) / max) * 50}%`,
                  width: `${Math.max(0.4, (Math.abs(d) / max) * 50)}%`,
                  background: d >= 0 ? 'var(--teal)' : 'var(--amber)',
                }} />
              )}
            </div>
            <div className="bar-val">{d == null ? (both ? '—' : ca.covered.includes(id) ? 'A only' : 'B only') : `${d > 0 ? '+' : ''}${absolute ? d.toFixed(3) : (d * 100).toFixed(1)}`}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatusTable({ profile, analytes }: { profile: Profile; analytes: readonly AnalyteId[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Compound</th><th>Value</th><th>Status</th><th>Flags</th></tr></thead>
        <tbody>
          {analytes.map((id) => {
            const m = profile.measurements[id];
            return (
              <tr key={id}>
                <td>{analyte(id).label}</td>
                <td className="mono">{valueLabel(profile, id)}</td>
                <td><StatusText status={m?.status ?? 'not_measured'} /></td>
                <td className="tiny muted">{m?.flags?.join(', ').replace(/_/g, ' ') ?? ''}{m?.stats ? ` n=${m.stats.n}, detected ${m.stats.nDetected}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
