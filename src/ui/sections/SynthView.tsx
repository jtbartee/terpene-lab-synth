// TERPENE SYNTH: the generative instrument.

import { useEffect, useMemo, useState } from 'react';
import { morphProfiles } from '../../chem/profile';
import { DEFAULT_MIXER, MIX_KEYS, type MixKey } from '../../audio/params';
import { BUSES, ENDINGS, type Bus, type EndingChoice } from '../../music/composer';
import { STYLES, STYLE_IDS, type StyleId } from '../../music/styles';
import { KEYS, SCALES, type KeyName, type ScaleId } from '../../music/theory';
import { computeControls, explainControls } from '../../sonify/mapping';
import { applyStyle, getLivePlayer, newSeed, pause, play, regenerate, sendToSynth, stop } from '../../store/actions';
import { getState, setMixer, setSettings, setSynth, useStore } from '../../store/store';
import { ArtisticNote, KindBadge, Notice, Panel, ProfilePicker } from '../components/bits';
import { IconDice, IconLock, IconPause, IconPlay, IconRegen, IconStop, IconUnlock } from '../components/icons';
import { Knob } from '../components/Knob';
import { Scope } from '../viz/Scope';
import { ExportPanel } from './ExportPanel';
import { ListeningPanel } from './ListeningPanel';
import { MappingMatrix } from './MappingMatrix';
import { MidiPanel } from './MidiPanel';
import { NowPlaying } from './NowPlaying';

const pct = (v: number) => `${Math.round(v * 100)}`;

export function SynthView() {
  const synth = useStore((s) => s.synth);
  const transport = useStore((s) => s.transport);
  const s = synth.settings;
  const style = STYLES[s.style];
  const controlsA = useMemo(() => computeControls(synth.profileA, synth.mapping, synth.mode, new Set(synth.mutedA)), [synth.profileA, synth.mapping, synth.mode, synth.mutedA]);
  const influences = useMemo(() => explainControls(controlsA, 5), [controlsA]);
  const playing = transport.state === 'playing';
  const morphProfile = useMemo(() => (synth.morphEnabled && synth.profileA && synth.profileB ? morphProfiles(synth.profileA, synth.profileB, synth.morph) : null), [synth.morphEnabled, synth.profileA, synth.profileB, synth.morph]);

  return (
    <div className="stack">
      <div className="view-head">
        <div>
          <h1 className="view-title">Terpene Synth</h1>
          <p className="view-sub">A generative instrument: a terpene profile drives timbre and (in Generative mode) the composition itself. Same profile + settings + mapping + seed = the same piece, every time.</p>
        </div>
        <div className="row">
          <button className={`btn ${playing ? '' : 'primary'} play`} onClick={() => (playing ? pause() : play())} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <><IconPause /> Pause</> : <><IconPlay /> Play</>}</button>
          <button className="btn" onClick={stop} disabled={transport.state === 'stopped'}><IconStop /> Stop</button>
          <button className="btn" onClick={() => { newSeed(); void regenerate(); }} title="New seed, new piece"><IconDice /> Generate new</button>
          <button className="btn" onClick={() => void regenerate()} title={synth.seedLocked ? 'Restart the same piece from bar 1' : 'Restart with a fresh seed'}><IconRegen /> Regenerate</button>
        </div>
      </div>
      {transport.error && <Notice kind="err">{transport.error}</Notice>}

      <div className="grid synth-grid">
        <Panel title="Profile A" sub="drives the sound" actions={synth.profileA && <KindBadge kind={synth.profileA.kind} />}>
          <div className="stack" style={{ gap: 10 }}>
            <ProfilePicker label="Profile" value={synth.profileA} onChange={(p) => p && sendToSynth(p, 'A')} />
            <label className="check"><input type="checkbox" checked={synth.followLab} onChange={(e) => setSynth({ followLab: e.target.checked })} /> Follow the Lab (hear edits live)</label>
            <div>
              <div className="label" style={{ marginBottom: 4 }}>Strongest data-driven influences</div>
              {influences.length ? <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{influences.map((t) => <li key={t}>{t}</li>)}</ul> : <p className="small muted">No mapped compounds in this profile — every target sits at its neutral value.</p>}
            </div>
          </div>
        </Panel>
        <Panel title="Profile morph" sub="A ⟷ B" actions={<label className="check small"><input type="checkbox" checked={synth.morphEnabled} onChange={(e) => setSynth({ morphEnabled: e.target.checked })} /> Enable</label>}>
          <div className="stack" style={{ gap: 10 }}>
            <ProfilePicker label="Profile B" value={synth.profileB} onChange={(p) => setSynth({ profileB: p })} allowNone />
            <div className="field">
              <label className="label" htmlFor="morph">Morph position: {pct(synth.morph)} % toward B</label>
              <input id="morph" type="range" className="hslider" min={0} max={1} step={0.01} value={synth.morph} disabled={!synth.morphEnabled || !synth.profileB} onChange={(e) => setSynth({ morph: Number(e.target.value) })} />
              <div className="row small muted"><span>A: {synth.profileA?.name ?? '—'}</span><span className="spacer" /><span>B: {synth.profileB?.name ?? '—'}</span></div>
            </div>
            {morphProfile && <p className="tiny faint" style={{ margin: 0 }}>The interpolated mix is a <b>synthetic transition</b>, not a measured or predicted sample. Control values cross-fade smoothly; pattern changes land on bar boundaries.</p>}
          </div>
        </Panel>
      </div>

      <Panel title="Mode">
        <div className="row">
          <div className="seg" role="group" aria-label="Sonification mode">
            <button aria-pressed={synth.mode === 'analytical'} onClick={() => setSynth({ mode: 'analytical', seedLocked: true })}>Analytical sonification</button>
            <button aria-pressed={synth.mode === 'generative'} onClick={() => setSynth({ mode: 'generative' })}>Generative composition</button>
          </div>
          <p className="small muted" style={{ margin: 0, flex: 1, minWidth: 260 }}>
            {synth.mode === 'analytical'
              ? 'Key, tempo, arrangement and seed stay fixed; profiles change only timbre and mix. Switch profiles to hear the chemical differences against one reference composition.'
              : 'Each profile composes its own piece from the seed: harmony, motifs and grooves follow its terpene mix, and it also shapes density, complexity, rhythm, mutation and arrangement. Musicality comes first; the data is a guide, not a score.'}
          </p>
        </div>
      </Panel>

      <div className="grid synth-grid">
        <Panel title="Composition" sub={style.label}>
          <div className="stack" style={{ gap: 12 }}>
            <div className="grid cols-2" style={{ gap: 10 }}>
              <label className="field"><span className="label">Style</span>
                <select className="select" value={s.style} onChange={(e) => applyStyle(e.target.value as StyleId)}>
                  {STYLE_IDS.map((id) => <option key={id} value={id}>{STYLES[id].label}</option>)}
                </select>
              </label>
              <div className="field"><span className="label">Seed</span>
                <div className="row tight">
                  <input className="input num" style={{ width: 110 }} inputMode="numeric" value={s.seed} aria-label="Seed" onChange={(e) => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n) && n > 0) setSettings({ seed: n }); }} />
                  <button className="btn icon" aria-pressed={synth.seedLocked} onClick={() => setSynth({ seedLocked: !synth.seedLocked })} aria-label={synth.seedLocked ? 'Unlock seed' : 'Lock seed'} title={synth.seedLocked ? 'Seed locked: Regenerate replays the same piece' : 'Seed unlocked: Regenerate picks a new seed'}>{synth.seedLocked ? <IconLock /> : <IconUnlock />}</button>
                  <button className="btn icon" onClick={newSeed} aria-label="New random seed" title="New random seed"><IconDice /></button>
                </div>
              </div>
              <label className="field"><span className="label">Key</span>
                <select className="select" value={s.key} onChange={(e) => setSettings({ key: e.target.value as KeyName })}>{KEYS.map((k) => <option key={k}>{k}</option>)}</select>
              </label>
              <label className="field"><span className="label">Scale</span>
                <select className="select" value={s.scale} onChange={(e) => setSettings({ scale: e.target.value as ScaleId })}>{SCALES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
              </label>
              <label className="field"><span className="label">Tempo (BPM)</span>
                <input className="input num" type="number" min={40} max={180} value={s.bpm} onChange={(e) => { const n = Number(e.target.value); if (n >= 40 && n <= 180) setSettings({ bpm: n }); }} />
              </label>
              <label className="field"><span className="label">Time signature</span>
                <select className="select" value={s.beatsPerBar} onChange={(e) => setSettings({ beatsPerBar: Number(e.target.value) as 3 | 4 | 5 | 7 })}>
                  {[4, 3, 5, 7].map((b) => <option key={b} value={b}>{b}/4</option>)}
                </select>
              </label>
              <label className="field"><span className="label">Arrangement length</span>
                <select className="select" value={s.arrangementBars} onChange={(e) => setSettings({ arrangementBars: Number(e.target.value) })}>
                  <option value={0}>Endless (continuously evolving)</option>
                  {[32, 64, 128, 256].map((b) => <option key={b} value={b}>{b} bars</option>)}
                </select>
              </label>
              <label className="field"><span className="label">Ending</span>
                <select id="ending-select" className="select" value={s.ending ?? 'auto'} disabled={s.arrangementBars === 0} title={s.arrangementBars === 0 ? 'An endless piece never ends: choose an arrangement length first' : ENDINGS.find((x) => x.id === s.ending)?.text ?? 'The seed and the form choose the ending'} onChange={(e) => setSettings({ ending: e.target.value as EndingChoice })}>
                  <option value="auto">Auto (the piece chooses)</option>
                  {ENDINGS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </label>
              <label className="check" style={{ alignSelf: 'end', minHeight: 36 }}><input type="checkbox" checked={s.autonomous} onChange={(e) => setSettings({ autonomous: e.target.checked })} /> Autonomous evolution</label>
            </div>
            {SCALES.find((x) => x.id === s.scale)?.note && <p className="tiny faint" style={{ margin: 0 }}>{SCALES.find((x) => x.id === s.scale)!.note}</p>}
            {s.arrangementBars > 0 && <p className="tiny faint" style={{ margin: 0 }}>Ending: {ENDINGS.find((x) => x.id === s.ending)?.text ?? 'chosen by the seed and the form — resolve, final hit, fade-out, slow-down, echo-out, cadence or stop-time.'}</p>}
            <p className="small muted" style={{ margin: 0 }}>{style.blurb} <span className="faint">Research references: {style.influences}.</span></p>
            <div className="knob-row" aria-label="Composition controls">
              <Knob label="Complexity" value={s.complexity} onChange={(v) => setSettings({ complexity: v })} defaultValue={0.5} format={pct} controlId="complexity" title="Detail inside the patterns: ghost notes, sixteenths, motif length, arpeggio span" />
              <Knob label="Density" value={s.density} onChange={(v) => setSettings({ density: v })} defaultValue={0.55} format={pct} controlId="density" title="How many layers play and how many notes they play" />
              <Knob label="Variation" value={s.variation} onChange={(v) => setSettings({ variation: v })} defaultValue={0.5} format={pct} controlId="variation" title="How many small changes happen at each phrase boundary" />
              <Knob label="Harmonic movement" value={s.harmonicMovement} onChange={(v) => setSettings({ harmonicMovement: v })} defaultValue={0.4} format={pct} controlId="harmonic" />
              <Knob label="Rhythm intensity" value={s.rhythmIntensity} onChange={(v) => setSettings({ rhythmIntensity: v })} defaultValue={0.6} format={pct} controlId="rhythmIntensity" />
              <Knob label="Drone intensity" value={s.droneIntensity} onChange={(v) => setSettings({ droneIntensity: v })} defaultValue={0.5} format={pct} controlId="droneIntensity" />
              <Knob label="Swing" value={s.swing} onChange={(v) => setSettings({ swing: v })} defaultValue={0} max={0.6} format={(v) => `${Math.round(v * 100)}`} controlId="swing" />
            </div>
            <div className="knob-row" aria-label="Compositional development controls">
              <Knob label="Groove diversity" value={s.grooveDiversity ?? 0.5} onChange={(v) => setSettings({ grooveDiversity: v })} defaultValue={0.5} format={pct} controlId="grooveDiversity" color="var(--teal)" title="How far rhythmic identities range: 0 keeps the style's signature groove and bass rhythm; higher draws from the whole groove family and gives contrasting sections their own grooves" />
              <Knob label="Structure" value={s.structure ?? 0.5} onChange={(v) => setSettings({ structure: v })} defaultValue={0.5} format={pct} controlId="structure" color="var(--teal)" title="Structural development: low favours long hypnotic forms; high favours contrasting sections and new material" />
              <Knob label="Motif evolution" value={s.motifEvolution ?? 0.5} onChange={(v) => setSettings({ motifEvolution: v })} defaultValue={0.5} format={pct} controlId="motifEvolution" color="var(--teal)" title="How far a motif develops before it returns to its original form" />
              <p className="tiny faint" style={{ margin: 0, flex: '1 1 220px', alignSelf: 'center' }}>These three shape the plan of the next piece (press Stop then Play, or Regenerate). While playing they steer the ongoing development.</p>
            </div>
          </div>
        </Panel>

        <Panel title="Live performance" sub="responds while playing">
          <div className="knob-row">
            <Knob label="Master volume" value={synth.mixer.master} onChange={(v) => setMixer({ master: v })} defaultValue={DEFAULT_MIXER.master} format={pct} controlId="master" color="var(--phosphor)" />
            <Knob label="Global filter" value={synth.mixer.globalFilter} onChange={(v) => setMixer({ globalFilter: v })} defaultValue={1} format={pct} controlId="globalFilter" color="var(--phosphor)" />
            <LevelKnob k="drone" label="Drone amount" />
            <LevelKnob k="bass" label="Bass amount" />
            <LevelKnob k="drums" label="Rhythm amount" />
            <LevelKnob k="arp" label="Melody amount" />
            <LevelKnob k="reverb" label="Reverb" />
            <LevelKnob k="delay" label="Delay" />
            <Knob label="Modulation depth" value={synth.mixer.modDepth} onChange={(v) => setMixer({ modDepth: v })} defaultValue={0.6} format={pct} controlId="modDepth" color="var(--violet)" />
            <Knob label="Variation amount" value={s.variation} onChange={(v) => setSettings({ variation: v })} defaultValue={0.5} format={pct} controlId="variationLive" color="var(--violet)" />
            <Knob label="Morph position" value={synth.morph} onChange={(v) => setSynth({ morph: v, morphEnabled: synth.profileB ? true : synth.morphEnabled })} defaultValue={0} format={pct} controlId="morph" color="#e59ac0" disabled={!synth.profileB} />
          </div>
          <hr className="divider" />
          <Mixer />
        </Panel>
      </div>

      <div className="grid synth-grid">
        <Panel title="Output" sub="master">
          <div className="stack" style={{ gap: 8 }}>
            <Scope kind="wave" label="Oscilloscope of the master output" />
            <Scope kind="fft" label="Spectrum of the master output" />
            <p className="tiny faint" style={{ margin: 0 }}>Master chain: sub high-pass (28 Hz) → gentle compressor → limiter at −1.5 dBFS with a slow release (no crackle on kicks). Delay feedback is capped and soft-clipped.</p>
          </div>
        </Panel>
        <NowPlaying />
      </div>

      <ListeningPanel />

      <MappingMatrix controls={controlsA} />
      <div className="grid synth-grid">
        <ExportPanel />
        <MidiPanel />
      </div>
      <ArtisticNote />
    </div>
  );
}

function LevelKnob({ k, label }: { k: MixKey; label: string }) {
  const level = useStore((s) => s.synth.mixer.levels[k]);
  return <Knob label={label} value={level} onChange={(v) => setMixer({ levels: { ...getState().synth.mixer.levels, [k]: v } })} defaultValue={0.8} format={pct} controlId={`level-${k}`} color="var(--teal)" />;
}

const MIX_LABEL: Record<MixKey, string> = { drone: 'Drone', bass: 'Bass', arp: 'Arp', pad: 'Pads', drums: 'Drums', texture: 'Texture', reverb: 'Reverb rtn', delay: 'Delay rtn' };

function Mixer() {
  const mixer = useStore((s) => s.synth.mixer);
  const [meters, setMeters] = useState<Record<Bus, number> | null>(null);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) setMeters(getLivePlayer()?.meters() ?? null); }, 120);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="mixer" role="group" aria-label="Mixer">
      {MIX_KEYS.map((k) => {
        const isBus = (BUSES as string[]).includes(k);
        const db = isBus && meters ? meters[k as Bus] : -Infinity;
        const h = Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 60) / 60)) : 0;
        return (
          <div className="mix-ch" key={k}>
            <span className="label" style={{ fontSize: 10.5 }}>{MIX_LABEL[k]}</span>
            <div className="row tight" style={{ alignItems: 'flex-end' }}>
              <input type="range" className="vfader" min={0} max={1} step={0.01} value={mixer.levels[k]} aria-label={`${MIX_LABEL[k]} level`} onChange={(e) => setMixer({ levels: { ...mixer.levels, [k]: Number(e.target.value) } })} />
              {isBus && <div className="meter" aria-hidden="true"><i style={{ height: `${h * 100}%` }} /></div>}
            </div>
            <span className="readout tiny">{Math.round(mixer.levels[k] * 100)}</span>
            <div className="row tight">
              <button className="btn sm" aria-pressed={mixer.mutes[k]} onClick={() => setMixer({ mutes: { ...mixer.mutes, [k]: !mixer.mutes[k] } })} aria-label={`Mute ${MIX_LABEL[k]}`}>M</button>
              {isBus && <button className="btn sm" aria-pressed={mixer.solo === k} onClick={() => setMixer({ solo: mixer.solo === k ? null : (k as Bus) })} aria-label={`Solo ${MIX_LABEL[k]}`}>S</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
