// Offline rendering: the whole graph and every event are created inside
// Tone.Offline's context, so the file contains the real composition (not a
// recording of silence). Stems re-render the same deterministic piece with one
// bus soloed, so they line up sample-for-sample.

import * as Tone from 'tone';
import { BUSES, Composer, type Bus, type CompositionSettings } from '../music/composer';
import { STYLES } from '../music/styles';
import { keyPc } from '../music/theory';
import type { ParamSet } from '../sonify/targets';
import { SynthEngine } from './engine';
import { computeAudioParams, type MixerState } from './params';
import { Sequencer } from './sequencer';

export interface RenderOptions {
  settings: CompositionSettings;
  params: ParamSet;
  mixer: MixerState;
  bars: number;
  solo?: Bus | null;
  tailSeconds?: number;
  sampleRate?: number;
}

export interface RenderResult {
  buffer: AudioBuffer;
  /** peak before the safety trim, in dBFS */
  peakDb: number;
  /** true when the final buffer was scaled down to keep peaks below −0.3 dBFS */
  trimmed: boolean;
  seconds: number;
}

export function compositionSeconds(settings: CompositionSettings, bars: number) {
  return bars * settings.beatsPerBar * (60 / settings.bpm);
}

export async function renderComposition(o: RenderOptions): Promise<RenderResult> {
  const tail = o.tailSeconds ?? 4;
  const music = compositionSeconds(o.settings, o.bars);
  const total = music + tail;
  const sampleRate = o.sampleRate ?? 44100;
  const style = STYLES[o.settings.style];

  const tone = await Tone.Offline(async (ctx) => {
    const transport = ctx.transport;
    transport.bpm.value = o.settings.bpm;
    transport.timeSignature = o.settings.beatsPerBar;
    const engine = new SynthEngine({});
    engine.setTempo(o.settings.bpm);
    engine.setTonic(keyPc(o.settings.key));
    engine.setMixer({ ...o.mixer, solo: o.solo ?? null }, 0.001);
    const ap = computeAudioParams(o.params, style, o.mixer);
    engine.apply(ap, 0.01);
    await engine.setReverbDecay(ap.fx.reverbDecay);
    const composer = new Composer(o.settings, o.params);
    const seq = new Sequencer(engine, composer, transport, {
      maxBars: o.bars,
      smoothing: () => o.params.transitionSmoothness,
      onBarPlanned: (plan) => {
        const a = computeAudioParams(o.params, style, o.mixer, plan.layers);
        a.fx.reverbDecay = ap.fx.reverbDecay; // keep the IR fixed during the render
        engine.apply(a, Math.max(a.ramp, 1.5));
      },
      // dry voices fade over 1.5 s at the end; reverb and delay tails ring into the tail
      onEnd: (time) => engine.silence(time, 1.5),
    });
    seq.start();
    transport.start(0);
  }, total, 2, sampleRate);

  const buffer = tone.get() as AudioBuffer;
  // a short fade at the very end so the file never stops on a non-zero sample
  const fade = Math.min(buffer.length, Math.floor(sampleRate * 0.5));
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < fade; i++) d[buffer.length - fade + i] *= 1 - i / fade;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  }
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  // the master limiter sits at −1 dBFS; this is a last-resort guard against overshoot
  const ceiling = Math.pow(10, -0.3 / 20);
  let trimmed = false;
  if (peak > ceiling) {
    const g = ceiling / peak;
    for (let c = 0; c < buffer.numberOfChannels; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
    trimmed = true;
  }
  return { buffer, peakDb, trimmed, seconds: total };
}

export async function renderStems(o: Omit<RenderOptions, 'solo'>, onProgress?: (bus: Bus, i: number) => void): Promise<Record<Bus, RenderResult>> {
  const out = {} as Record<Bus, RenderResult>;
  let i = 0;
  for (const b of BUSES) {
    onProgress?.(b, i++);
    out[b] = await renderComposition({ ...o, solo: b });
  }
  return out;
}

/** RMS level (dBFS) of one bus rendered alone — used by the audio self-test. */
export function rmsDb(buf: AudioBuffer, from = 0, to = buf.length): number {
  let sum = 0;
  let n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = from; i < to; i++) { sum += d[i] * d[i]; n++; }
  }
  return n ? 10 * Math.log10(sum / n + 1e-20) : -Infinity;
}
