// Live playback controller. Loaded lazily (Tone.js is large) and only after a
// user gesture: the browser will not start audio before one, and neither do we.

import * as Tone from 'tone';
import { Composer, type BarPlan, type CompositionSettings } from '../music/composer';
import { STYLES } from '../music/styles';
import { keyPc } from '../music/theory';
import type { ParamSet } from '../sonify/targets';
import { SynthEngine } from './engine';
import { computeAudioParams, type MixerState } from './params';
import { Sequencer } from './sequencer';

export type PlayState = 'stopped' | 'playing' | 'paused';

/** Seconds a finished piece's last chord rings before the fade. */
const RING_OUT = 3;

export interface PlayerListener {
  onBar?: (plan: BarPlan) => void;
  onState?: (s: PlayState) => void;
  onError?: (msg: string) => void;
}

export class LivePlayer {
  engine: SynthEngine | null = null;
  private composer: Composer;
  private seq: Sequencer | null = null;
  private state: PlayState = 'stopped';
  private settings: CompositionSettings;
  private params: ParamSet;
  private mixer: MixerState;
  private lastLayers: BarPlan['layers'] | null = null;
  private listeners = new Set<PlayerListener>();

  constructor(settings: CompositionSettings, params: ParamSet, mixer: MixerState) {
    this.settings = settings;
    this.params = params;
    this.mixer = mixer;
    this.composer = new Composer(settings, params);
  }

  subscribe(l: PlayerListener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  private emitState(s: PlayState) { this.state = s; this.listeners.forEach((l) => l.onState?.(s)); }
  get playState() { return this.state; }
  get contextState() { return Tone.getContext().state; }

  /** Must be called from a user gesture handler. */
  async ensureAudio() {
    await Tone.start();
    if (!this.engine) {
      const ctx = Tone.getContext();
      ctx.lookAhead = 0.12;
      this.engine = new SynthEngine({ analyse: true, meters: true });
      await this.engine.ready();
      this.applyAll(0.01);
      ctx.rawContext.addEventListener?.('statechange', () => {
        if (ctx.state !== 'running' && this.state === 'playing') this.listeners.forEach((l) => l.onError?.('Audio was interrupted by the browser or device. Press Play to resume.'));
      });
    }
  }

  private applyAll(ramp?: number) {
    if (!this.engine) return;
    const style = STYLES[this.settings.style];
    this.engine.setTempo(this.settings.bpm);
    this.engine.setTonic(keyPc(this.settings.key));
    this.engine.setMixer(this.mixer, 0.05);
    const ap = computeAudioParams(this.params, style, this.mixer, this.lastLayers ?? undefined);
    this.engine.apply(ap, ramp ?? ap.ramp);
  }

  async play() {
    await this.ensureAudio();
    const tr = Tone.getTransport();
    if (this.state === 'playing') return;
    if (this.state === 'paused') this.composer.rearticulate(); // continue from the composer's position
    // from a stop, plan the piece afresh so it reflects the profile and settings chosen since
    else this.composer.reset();
    tr.stop();
    tr.cancel(0);
    tr.position = 0;
    tr.bpm.value = this.settings.bpm;
    tr.timeSignature = this.settings.beatsPerBar;
    this.seq?.clear();
    this.seq = new Sequencer(this.engine!, this.composer, tr, {
      smoothing: () => this.params.transitionSmoothness,
      onBarStart: (plan, time) => {
        Tone.getDraw().schedule(() => this.listeners.forEach((l) => l.onBar?.(plan)), time);
      },
      onBarPlanned: (plan) => {
        this.lastLayers = plan.layers;
        // per-bar timbre/filter drift from the arrangement
        const ap = computeAudioParams(this.params, STYLES[this.settings.style], this.mixer, plan.layers);
        this.engine!.apply(ap, Math.max(ap.ramp, 1.5));
      },
      onEnd: (time) => {
        // a finished piece rings out: the final chord's release and the reverb tail play,
        // then the voices fade gently before the transport stops
        this.engine!.silence(time + RING_OUT, 1.5);
        Tone.getDraw().schedule(() => { if (this.state === 'playing') this.stop(); }, time + RING_OUT + 1.6);
      },
    });
    this.seq.start();
    tr.start('+0.05');
    this.emitState('playing');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.halt();
    this.emitState('paused');
  }

  stop() {
    if (this.state === 'stopped') return;
    this.halt();
    this.composer.reset();
    this.emitState('stopped');
  }

  private halt() {
    const tr = Tone.getTransport();
    this.seq?.clear();
    this.seq = null;
    tr.stop();
    tr.cancel(0);
    this.engine?.silence(Tone.now(), 0.15);
    // undo a fade-out ending once the voices are silent, so the next sound is not muted
    this.engine?.fadeBar(1, 1, Tone.now() + 0.2, 0);
  }

  /** New seed and/or a fresh start of the same piece. Never duplicates events. */
  async regenerate(settings: CompositionSettings) {
    const wasPlaying = this.state === 'playing';
    if (this.state !== 'stopped') this.halt();
    this.settings = settings;
    this.composer = new Composer(settings, this.params);
    this.emitState('stopped');
    this.applyAll();
    if (wasPlaying) await this.play();
  }

  setSettings(settings: CompositionSettings) {
    const prev = this.settings;
    this.settings = settings;
    const changed: Partial<CompositionSettings> = {};
    for (const k of Object.keys(settings) as (keyof CompositionSettings)[]) if (settings[k] !== prev[k]) (changed as Record<string, unknown>)[k] = settings[k];
    this.composer.setSettings(changed);
    const tr = Tone.getTransport();
    if (changed.bpm !== undefined) { tr.bpm.rampTo(settings.bpm, 0.5); this.engine?.setTempo(settings.bpm); }
    if (changed.key !== undefined) this.engine?.setTonic(keyPc(settings.key));
    if (changed.style !== undefined) this.applyAll();
    if (changed.beatsPerBar !== undefined && this.state === 'playing') {
      // the bar grid itself changed: restart cleanly on the new metre
      this.halt();
      this.state = 'stopped';
      void this.play();
    }
  }

  setParams(params: ParamSet) {
    this.params = params;
    this.composer.setParams(params);
    if (this.engine) {
      const ap = computeAudioParams(params, STYLES[this.settings.style], this.mixer, this.lastLayers ?? undefined);
      this.engine.apply(ap);
    }
  }

  setMixer(m: MixerState) {
    this.mixer = m;
    if (this.engine) {
      this.engine.setMixer(m, 0.05);
      const ap = computeAudioParams(this.params, STYLES[this.settings.style], m, this.lastLayers ?? undefined);
      this.engine.apply(ap, 0.2);
    }
  }

  analysers() {
    return { waveform: this.engine?.waveform ?? null, fft: this.engine?.fft ?? null };
  }

  meters() { return this.engine?.meterLevels() ?? null; }

  dispose() {
    this.halt();
    this.engine?.dispose();
    this.engine = null;
  }
}
