import { useEffect } from 'react';
import { STYLES } from '../music/styles';
import { loadPersisted, pause, play, regenerate, stop } from '../store/actions';
import { ROUTES, navigate, useStore } from '../store/store';
import { KindBadge } from './components/bits';
import { BrandMark, IconPause, IconPlay, IconRegen, IconStop } from './components/icons';
import { KnobDefs } from './components/Knob';
import { AboutView } from './sections/AboutView';
import { CompareView } from './sections/CompareView';
import { CompoundDetail } from './sections/CompoundDetail';
import { ExploreView } from './sections/ExploreView';
import { LabView } from './sections/LabView';
import { LibraryView } from './sections/LibraryView';
import { SynthView } from './sections/SynthView';
import { Scope } from './viz/Scope';

export function App() {
  const route = useStore((s) => s.route);
  const toastMsg = useStore((s) => s.toast);
  const busy = useStore((s) => s.transport.busy);

  useEffect(() => { void loadPersisted(); }, []);
  useEffect(() => {
    const title = ROUTES.find((r) => r.id === route)?.label ?? '';
    document.title = `${title} · TERPENE LAB + TERPENE SYNTH`;
    window.scrollTo({ top: 0 });
  }, [route]);

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <KnobDefs />
      <header className="topbar">
        <a className="brand" href="#/lab" onClick={(e) => { e.preventDefault(); navigate('lab'); }} aria-label="TERPENE LAB + TERPENE SYNTH home">
          <BrandMark />
          <span className="brand-name"><b>Terpene Lab</b> + <i>Terpene Synth</i></span>
        </a>
        <nav className="nav" aria-label="Sections">
          {ROUTES.map((r) => (
            <a key={r.id} href={`#/${r.id}`} aria-current={route === r.id ? 'page' : undefined} onClick={(e) => { e.preventDefault(); navigate(r.id); }}>{r.label}</a>
          ))}
        </nav>
      </header>
      <main id="main" className="main" tabIndex={-1}>
        {route === 'explore' && <ExploreView />}
        {route === 'lab' && <LabView />}
        {route === 'synth' && <SynthView />}
        {route === 'compare' && <CompareView />}
        {route === 'library' && <LibraryView />}
        {route === 'about' && <AboutView />}
      </main>
      <Transport />
      <CompoundDetail />
      {toastMsg && <div className="toast" role="status" key={toastMsg.id}>{toastMsg.text}</div>}
      {busy && (
        <div className="busy" role="alertdialog" aria-live="assertive" aria-label={busy}>
          <div className="busy-card"><div className="spinner" /><div>{busy}</div></div>
        </div>
      )}
    </div>
  );
}

function Transport() {
  const t = useStore((s) => s.transport);
  const synth = useStore((s) => s.synth);
  const playing = t.state === 'playing';
  const s = synth.settings;
  return (
    <div className="transport" role="region" aria-label="Transport">
      <button className={`btn ${playing ? '' : 'primary'} play`} onClick={() => (playing ? pause() : play())} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <IconPause /> : <IconPlay />}<span className="t-hide-xs">{playing ? 'Pause' : 'Play'}</span>
      </button>
      <button className="btn icon" onClick={stop} aria-label="Stop" disabled={t.state === 'stopped'}><IconStop /></button>
      <button className="btn icon t-hide-xs" onClick={() => void regenerate()} aria-label="Regenerate" title="Regenerate"><IconRegen /></button>
      <span className={`led ${playing ? 'on' : t.state === 'paused' ? 'amber' : ''}`} aria-hidden="true" />
      <div className="t-info">
        <span className="t-main">
          {synth.profileA ? synth.profileA.name : 'No profile loaded'}
          {synth.morphEnabled && synth.profileB ? ` → ${synth.profileB.name} (${Math.round(synth.morph * 100)} %)` : ''}
        </span>
        <span className="t-sub">
          {STYLES[s.style].label} · {s.key} {s.scale.replace('_', ' ')} · {s.bpm} BPM · seed {s.seed}
          {t.bar ? ` · bar ${t.bar.index + 1} · ${t.bar.section.name} · ${t.bar.chord.symbol}` : ''}
        </span>
      </div>
      <span className="t-hide-sm">{synth.profileA && <KindBadge kind={synth.profileA.kind} />}</span>
      <div className="spacer" />
      <Scope kind="wave" className="t-scope" label="Output waveform" />
      <a className="btn sm t-hide-xs" href="#/synth" onClick={(e) => { e.preventDefault(); navigate('synth'); }}>Synth →</a>
    </div>
  );
}
