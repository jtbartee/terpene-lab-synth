// Export: stereo WAV, stems (ZIP), MIDI, profile JSON and full preset JSON.

import { useState } from 'react';
import { buildLibraryFile } from '../../chem/schema';
import { BUSES, generateBars, type CompositionSettings } from '../../music/composer';
import { STYLES } from '../../music/styles';
import { SCALES } from '../../music/theory';
import { composerSettings, currentParams, currentPreset, download, savePreset, slug } from '../../store/actions';
import { getState, setTransport, toast, useStore } from '../../store/store';
import { Panel } from '../components/bits';
import { IconDownload, IconSave } from '../components/icons';

const APP_VERSION = '0.2.0';

function exportSettings(bars: number, shape: boolean): CompositionSettings {
  const s = composerSettings(getState().synth);
  // Short exports would otherwise capture only a sparse intro build, so they use the
  // style's full core arrangement; 32+ bars can be shaped as a complete piece.
  if (bars < 32) return { ...s, autonomous: false, arrangementBars: 0 };
  return { ...s, arrangementBars: shape ? bars : s.arrangementBars };
}

function baseName(s: CompositionSettings) {
  const synth = getState().synth;
  const scaleShort = s.scale.replace('natural_', '').replace('_', '-');
  return `terpene-synth_${slug(synth.profileA?.name ?? 'no-profile')}_${s.style}_${s.key.replace('#', 's')}-${scaleShort}_${s.bpm}bpm_seed${s.seed}`;
}

function comment(s: CompositionSettings, bars: number) {
  const synth = getState().synth;
  const scale = SCALES.find((x) => x.id === s.scale)?.label ?? s.scale;
  return `TERPENE SYNTH ${APP_VERSION} | profile: ${synth.profileA?.name ?? 'none'} (${synth.profileA?.kind ?? '-'})${synth.morphEnabled && synth.profileB ? ` morph ${Math.round(synth.morph * 100)}% to ${synth.profileB.name}` : ''} | style: ${STYLES[s.style].label} | key: ${s.key} ${scale} | ${s.bpm} BPM ${s.beatsPerBar}/4 | ${bars} bars | seed ${s.seed} | mode: ${synth.mode} | mapping: ${synth.mapping.name} | artistic mapping, not a scientific claim`;
}

export function ExportPanel() {
  const settings = useStore((s) => s.synth.settings);
  const busy = useStore((s) => s.transport.busy);
  const [bars, setBars] = useState(32);
  const [shape, setShape] = useState(true);
  const [bits, setBits] = useState<16 | 24>(16);
  const [presetName, setPresetName] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const seconds = bars * settings.beatsPerBar * (60 / settings.bpm);

  async function wav() {
    const s = exportSettings(bars, shape);
    setTransport({ busy: `Rendering ${bars} bars (${Math.round(seconds)} s) offline…` });
    try {
      const [{ renderComposition }, { encodeWav }] = await Promise.all([import('../../audio/render'), import('../../audio/wav')]);
      const synth = getState().synth;
      const r = await renderComposition({ settings: s, params: currentParams(synth), mixer: synth.mixer, bars });
      const bytes = encodeWav(r.buffer, { bitDepth: bits, info: { title: `${synth.profileA?.name ?? 'Terpene Synth'} — ${STYLES[s.style].label}`, comment: comment(s, bars), software: `TERPENE LAB + TERPENE SYNTH ${APP_VERSION}`, genre: 'Electronic' } });
      const name = `${baseName(s)}_${bars}bars.wav`;
      download(name, bytes, 'audio/wav');
      setResult(`${name} — ${r.seconds.toFixed(1)} s stereo ${bits}-bit, peak ${r.peakDb.toFixed(1)} dBFS${r.trimmed ? ' (trimmed to −0.3 dBFS)' : ''}.`);
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`);
    } finally {
      setTransport({ busy: null });
    }
  }

  async function stems() {
    const s = exportSettings(bars, shape);
    try {
      const [{ renderStems }, { encodeWav }, { zipStore }] = await Promise.all([import('../../audio/render'), import('../../audio/wav'), import('../../audio/zip')]);
      const synth = getState().synth;
      const out = await renderStems({ settings: s, params: currentParams(synth), mixer: synth.mixer, bars }, (bus, i) => setTransport({ busy: `Rendering stem ${i + 1} of ${BUSES.length}: ${bus}…` }));
      setTransport({ busy: 'Packing stems…' });
      const files = BUSES.map((b) => ({ name: `${baseName(s)}_${String(BUSES.indexOf(b) + 1).padStart(2, '0')}-${b}.wav`, data: encodeWav(out[b].buffer, { bitDepth: bits, info: { title: `${b} stem`, comment: comment(s, bars) } }) }));
      files.push({ name: 'README.txt', data: new TextEncoder().encode(`${comment(s, bars)}\n\nAll stems start at 0:00 and share the same length; drop them into Ableton Live at bar 1 with the project tempo set to ${s.bpm} BPM.\nEach stem includes its own reverb and delay sends.\n`) });
      const zip = zipStore(files);
      download(`${baseName(s)}_${bars}bars_stems.zip`, zip, 'application/zip');
      setResult(`Stems: ${BUSES.length} aligned WAV files (${(out.drone.seconds).toFixed(1)} s each) in one ZIP.`);
    } catch (e) {
      toast(`Stem export failed: ${(e as Error).message}`);
    } finally {
      setTransport({ busy: null });
    }
  }

  async function midi() {
    const s = exportSettings(bars, shape);
    const { midiBytes } = await import('../../audio/midi');
    const plans = generateBars(s, currentParams(getState().synth), bars);
    download(`${baseName(s)}_${bars}bars.mid`, midiBytes(plans, s), 'audio/midi');
    setResult(`MIDI: ${bars} bars at ${s.bpm} BPM, one track per instrument, drums on channel 10 (General MIDI).`);
  }

  function profileJson() {
    const p = getState().synth.profileA;
    if (!p) return;
    download(`${slug(p.name)}.terpene-profile.json`, buildLibraryFile([p]), 'application/json');
  }

  function presetJson() {
    const pr = currentPreset(presetName || `${getState().synth.profileA?.name ?? 'Composition'} · seed ${settings.seed}`);
    const body = JSON.stringify({ format: 'terpene-lab-synth/library', version: 1, exportedAt: new Date().toISOString(), profiles: [], presets: [pr], mappings: [], app: APP_VERSION }, null, 2);
    download(`${baseName(settings)}.terpene-preset.json`, body, 'application/json');
  }

  return (
    <Panel title="Export" sub="for Ableton Live and other DAWs">
      <div className="stack" style={{ gap: 10 }}>
        <div className="row">
          <label className="field"><span className="label">Length</span>
            <select className="select" aria-label="Export length" value={bars} onChange={(e) => setBars(Number(e.target.value))}>
              {[8, 16, 32, 64, 128].map((b) => <option key={b} value={b}>{b} bars</option>)}
            </select>
          </label>
          <label className="field"><span className="label">Bit depth</span>
            <select className="select" value={bits} onChange={(e) => setBits(Number(e.target.value) as 16 | 24)}><option value={16}>16-bit</option><option value={24}>24-bit</option></select>
          </label>
          <div className="small muted" style={{ alignSelf: 'end' }}>{seconds.toFixed(1)} s + 4 s tail · 44.1 kHz stereo</div>
        </div>
        <label className="check small"><input type="checkbox" checked={shape} disabled={bars < 32} onChange={(e) => setShape(e.target.checked)} /> {bars < 32 ? 'Short exports use the full arrangement throughout (no intro build)' : 'Shape the export as a complete piece (intro → outro over the chosen length)'}</label>
        <div className="row">
          <button className="btn primary" onClick={wav} disabled={!!busy}><IconDownload /> WAV mix</button>
          <button className="btn" onClick={stems} disabled={!!busy}><IconDownload /> Stems (ZIP)</button>
          <button className="btn" onClick={midi} disabled={!!busy}><IconDownload /> MIDI</button>
          <button className="btn" onClick={profileJson}><IconDownload /> Profile JSON</button>
          <button className="btn" onClick={presetJson}><IconDownload /> Preset JSON</button>
        </div>
        {result && <div className="notice info" role="status">{result}</div>}
        <div className="row">
          <input className="input" placeholder="Composition name" value={presetName} onChange={(e) => setPresetName(e.target.value)} aria-label="Composition name" style={{ flex: 1, minWidth: 180 }} />
          <button className="btn" onClick={() => { void savePreset(presetName || `${getState().synth.profileA?.name ?? 'Composition'} · seed ${settings.seed}`); setPresetName(''); }}><IconSave /> Save composition</button>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>Files are rendered in your browser from the same deterministic composition you hear (same profile, settings, mapping and seed). The WAV comment field records key, tempo and seed. There is no Ableton project export — WAV, stems and MIDI import directly.</p>
      </div>
    </Panel>
  );
}
