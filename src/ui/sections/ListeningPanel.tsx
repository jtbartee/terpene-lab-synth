// Listening session for composition engine 2: three Motorik pieces that differ
// in form, groove family, bass and melody, with a place to rate each one and
// copy the notes. Feedback stays in this browser (localStorage).

import { useState } from 'react';
import { ENGINE_VERSION } from '../../music/composer';
import { LISTENING_DEMOS, type ListeningDemo } from '../../music/demos';
import { auditionDemo, stop } from '../../store/actions';
import { toast, useStore } from '../../store/store';
import { Panel } from '../components/bits';
import { IconPlay, IconStop } from '../components/icons';

type Feedback = Record<string, { rating: number; notes: string }>;
const KEY = 'tls:listening-feedback';

function loadFeedback(): Feedback {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Feedback; } catch { return {}; }
}
function saveFeedback(f: Feedback) {
  try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* private window: keep it in memory */ }
}

export function ListeningPanel() {
  const [fb, setFb] = useState<Feedback>(loadFeedback);
  const seed = useStore((s) => s.synth.settings.seed);
  const style = useStore((s) => s.synth.settings.style);
  const playing = useStore((s) => s.transport.state === 'playing');
  const bar = useStore((s) => s.transport.bar);
  const update = (id: string, patch: Partial<Feedback[string]>) => {
    const next = { ...fb, [id]: { ...{ rating: 0, notes: '' }, ...fb[id], ...patch } };
    setFb(next);
    saveFeedback(next);
  };

  async function copy() {
    const lines = [`TERPENE SYNTH composition engine ${ENGINE_VERSION} — listening notes`, ''];
    for (const d of LISTENING_DEMOS) {
      const f = fb[d.id];
      lines.push(`${d.title} (seed ${d.seed}): ${f?.rating ? `${f.rating}/5` : 'not rated'}`);
      if (f?.notes) lines.push(`  ${f.notes.replace(/\n/g, '\n  ')}`);
    }
    const text = lines.join('\n');
    try { await navigator.clipboard.writeText(text); toast('Listening notes copied.'); }
    catch { toast('Copy was blocked by the browser; select the notes and copy them by hand.'); }
  }

  return (
    <Panel title="Listening session" sub={`engine ${ENGINE_VERSION} · three Motorik pieces`} id="listening">
      <p className="small muted" style={{ marginTop: 0 }}>
        Same style, key, tempo and profile; only the seed differs. Each piece is 128 bars (about 4½ minutes) and follows its own plan.
        Audition loads Profile A in Generative mode with the default mapping and controls, and starts the piece from bar 1.
      </p>
      <div className="grid cols-3" style={{ gap: 12 }}>
        {LISTENING_DEMOS.map((d) => <DemoCard key={d.id} d={d} active={playing && seed === d.seed && style === 'motorik'} bar={bar?.index} f={fb[d.id]} onChange={(p) => update(d.id, p)} />)}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={copy}>Copy listening notes</button>
        <span className="tiny faint">Ratings and notes are kept in this browser only.</span>
      </div>
    </Panel>
  );
}

function DemoCard({ d, active, bar, f, onChange }: { d: ListeningDemo; active: boolean; bar?: number; f?: Feedback[string]; onChange: (p: Partial<Feedback[string]>) => void }) {
  return (
    <div className="card stack" style={{ gap: 8, cursor: 'default' }}>
      <div className="card-top">
        <b style={{ fontSize: 14 }}>{d.title}</b>
        {active
          ? <button className="btn sm" onClick={() => stop()} aria-label={`Stop demo ${d.id}`}><IconStop /> Stop</button>
          : <button className="btn sm primary" onClick={() => void auditionDemo(d)} aria-label={`Audition demo ${d.id}`}><IconPlay /> Audition</button>}
      </div>
      <p className="small" style={{ margin: 0 }}>{d.summary}</p>
      <p className="tiny faint" style={{ margin: 0 }}>{d.form} · seed {d.seed}{active && bar != null ? ` · now at bar ${bar + 1}` : ''}</p>
      <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
        {d.listenFor.map((x) => <li key={x}>{x}</li>)}
      </ul>
      <div className="row tight" role="radiogroup" aria-label={`Rate demo ${d.id}`}>
        <span className="label" style={{ marginRight: 4 }}>Rating</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className="btn sm" role="radio" aria-checked={f?.rating === n} aria-pressed={f?.rating === n} onClick={() => onChange({ rating: n })}>{n}</button>
        ))}
      </div>
      <textarea className="input" rows={3} placeholder="What worked, what didn't, where (bar numbers help)…" aria-label={`Notes on demo ${d.id}`} value={f?.notes ?? ''} onChange={(e) => onChange({ notes: e.target.value })} />
    </div>
  );
}
