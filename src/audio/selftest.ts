// Audio self-test: renders the current composition offline with each sound
// module soloed and reports its level, then checks the full mix for peak level
// and length. Used by the in-app "Audio self-test" and by the browser e2e run.
// A buffer check is not a substitute for listening.

import { BUSES, type Bus, type CompositionSettings } from '../music/composer';
import type { ParamSet } from '../sonify/targets';
import type { MixerState } from './params';
import { compositionSeconds, renderComposition, rmsDb } from './render';

export interface SelfTestResult {
  modules: Record<Bus, { rmsDb: number; ok: boolean }>;
  mix: { seconds: number; expectedSeconds: number; samples: number; peakDb: number; rmsDb: number; trimmed: boolean; lengthOk: boolean; peakOk: boolean };
  passed: boolean;
}

export async function runSelfTest(settings: CompositionSettings, params: ParamSet, mixer: MixerState, bars = 16): Promise<SelfTestResult> {
  // a dense, fully-arranged configuration so every module plays
  const s: CompositionSettings = { ...settings, autonomous: false, density: 1, droneIntensity: 1, arrangementBars: 0 };
  const sampleRate = 44100;
  const modules = {} as SelfTestResult['modules'];
  for (const b of BUSES) {
    const r = await renderComposition({ settings: s, params, mixer: { ...mixer, mutes: { ...mixer.mutes, [b]: false }, levels: { ...mixer.levels, [b]: Math.max(0.6, mixer.levels[b]) } }, bars, solo: b, tailSeconds: 1, sampleRate });
    const level = rmsDb(r.buffer);
    modules[b] = { rmsDb: level, ok: level > -70 };
  }
  const full = await renderComposition({ settings: s, params, mixer, bars, tailSeconds: 4, sampleRate });
  const expectedSeconds = compositionSeconds(s, bars) + 4;
  const samples = full.buffer.length;
  const lengthOk = Math.abs(samples - Math.round(expectedSeconds * sampleRate)) <= 2;
  let peak = 0;
  for (let c = 0; c < full.buffer.numberOfChannels; c++) for (const v of full.buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  const peakDb = 20 * Math.log10(peak || 1e-9);
  const mix = { seconds: full.seconds, expectedSeconds, samples, peakDb, rmsDb: rmsDb(full.buffer), trimmed: full.trimmed, lengthOk, peakOk: peakDb <= -0.29 };
  return { modules, mix, passed: Object.values(modules).every((m) => m.ok) && lengthOk && mix.peakOk && mix.rmsDb > -40 };
}
