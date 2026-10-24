import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans-condensed/400.css';
import '@fontsource/ibm-plex-sans-condensed/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './styles/global.css';
import { App } from './ui/App';
import { getState, setSettings } from './store/store';
import { composerSettings, currentParams, getLivePlayer } from './store/actions';

// Small inspection hook used by the automated browser tests (read-only helpers).
(window as unknown as Record<string, unknown>).__tls = {
  getState,
  setSettings,
  player: () => getLivePlayer(),
  selfTest: async (bars = 8) => {
    const { runSelfTest } = await import('./audio/selftest');
    const s = getState().synth;
    return runSelfTest(composerSettings(s), currentParams(s), s.mixer, bars);
  },
  /** the plan the current settings produce offline (bar summaries), to compare with live playback */
  plan: async (n: number) => {
    const { generateBars } = await import('./music/composer');
    const s = getState().synth;
    return generateBars(composerSettings(s), currentParams(s), n);
  },
  /** the live Transport tempo (a slowing ending ramps it) */
  tempo: async () => (await import('tone')).getTransport().bpm.value,
  liveRms: () => {
    const w = getLivePlayer()?.analysers().waveform;
    if (!w) return null;
    const v = w.getValue() as Float32Array;
    let sum = 0;
    for (const x of v) sum += x * x;
    return Math.sqrt(sum / v.length);
  },
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
