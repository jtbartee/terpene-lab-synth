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
import { getState } from './store/store';
import { currentParams, getLivePlayer } from './store/actions';

// Small inspection hook used by the automated browser tests (read-only helpers).
(window as unknown as Record<string, unknown>).__tls = {
  getState,
  player: () => getLivePlayer(),
  selfTest: async (bars = 8) => {
    const { runSelfTest } = await import('./audio/selftest');
    const s = getState().synth;
    return runSelfTest(s.settings, currentParams(s), s.mixer, bars);
  },
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
