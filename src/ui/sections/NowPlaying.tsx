// What the composer is doing right now: the planned form, section, bar, chord,
// the material in use (groove, bass motif, melodic motif), layers over time,
// and the log of development events.

import { LAYERS } from '../../music/styles';
import { useStore } from '../../store/store';
import { Panel } from '../components/bits';

export function NowPlaying() {
  const bar = useStore((s) => s.transport.bar);
  const history = useStore((s) => s.transport.history);
  const state = useStore((s) => s.transport.state);
  const recent = history.slice(-32);
  const log = history.filter((b) => b.development.length).slice(-14).reverse();
  return (
    <Panel title="Now playing" sub={state === 'playing' ? 'live' : state}>
      {!bar ? (
        <div className="empty small">Press Play. The arrangement, current chord and every development event will appear here as the piece unfolds.</div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 18 }}>
            <div><div className="label">Section</div><div className="readout amber" style={{ fontSize: 18 }}>{bar.section.name}</div></div>
            <div><div className="label">Bar</div><div className="readout" style={{ fontSize: 18 }} aria-live="off">{bar.index + 1}</div></div>
            <div><div className="label">Phrase</div><div className="readout" style={{ fontSize: 18 }}>{bar.phraseBar + 1}/{bar.phraseBars}</div></div>
            <div><div className="label">Chord</div><div className="readout amber" style={{ fontSize: 18 }}>{bar.chord.symbol}</div></div>
            <div><div className="label">Energy</div><div className="readout" style={{ fontSize: 18 }}>{Math.round(bar.section.energy * 100)}</div></div>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 4 }}>Form · {bar.blueprint}{bar.section.cycle > 0 ? ` · cycle ${bar.section.cycle + 1}` : ''}</div>
            <div className="form-strip" role="list" aria-label="Planned sections">
              {bar.form.map((f) => {
                const now = bar.index >= f.start && bar.index < f.start + f.bars;
                return (
                  <span key={f.start} role="listitem" className={`form-cell role-${f.role}${now ? ' now' : ''}`} style={{ flexGrow: f.bars }} title={`${f.label}: bars ${f.start + 1}–${f.start + f.bars}`} aria-current={now ? 'step' : undefined}>
                    {f.label}
                  </span>
                );
              })}
            </div>
          </div>
          <dl className="material small">
            <dt>Groove</dt><dd>{bar.material.groove}</dd>
            <dt>Bass</dt><dd>{bar.material.bass}</dd>
            <dt>Melody</dt><dd>{bar.material.melody}</dd>
          </dl>
          <div className="timeline" aria-label="Layers over the last 32 bars">
            {LAYERS.map((l) => (
              <div className="tl-row" key={l}>
                <span className="label" style={{ fontSize: 10.5 }}>{l}</span>
                <div className="tl-cells">
                  {Array.from({ length: 32 - recent.length }, (_, k) => <i key={`pad-${k}`} style={{ opacity: 0.35 }} />)}
                  {recent.map((b, i) => <i key={b.index} className={`${b.layers[l].on ? 'on' : ''}${i === recent.length - 1 ? ' now' : ''}`} title={`Bar ${b.index + 1}: ${l} ${b.layers[l].on ? 'on' : 'off'}`} />)}
                </div>
              </div>
            ))}
          </div>
          <div>
            <div className="label" style={{ marginBottom: 4 }}>Development events</div>
            <div className="events-log" aria-live="polite">
              {log.length ? log.map((b) => <div key={b.index}><b>bar {b.index + 1}</b><span>{b.development.join(' · ')}</span></div>) : <span className="small muted">Sections change at the boundaries shown above; smaller changes happen at phrase boundaries (every {bar.phraseBars} bars).</span>}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
