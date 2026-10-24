// The synthesizer: six sound modules on six buses, two effect returns and a
// protected master. Built against whatever Tone context is current, so the
// same class renders live and inside Tone.Offline.

import * as Tone from 'tone';
import { BUSES, type Bus, type NoteEvent, type Voice } from '../music/composer';
import type { Layer } from '../music/styles';
import { DEFAULT_MIXER, MIX_KEYS, levelToDb, type AudioParams, type MixKey, type MixerState } from './params';

const LAYER_BUS: Record<Layer, Bus> = { drone: 'drone', bass: 'bass', arp: 'arp', pad: 'pad', drums: 'drums', perc: 'drums', texture: 'texture' };
const NOTE_BEATS: Record<string, number> = { '16n': 0.25, '8n': 0.5, '8n.': 0.75, '4n': 1, '4n.': 1.5, '2n': 2 };
const MONO_VOICES: ReadonlySet<Voice> = new Set(['bass', 'kick', 'snare', 'clap', 'hatC', 'hatO', 'perc', 'click', 'metal']);

interface BusChain {
  layer: Tone.Gain;     // arrangement automation (0..1)
  tone: Tone.Filter;    // per-bus tone filter
  drive: Tone.Distortion | null;
  channel: Tone.Channel;
  reverbSend: Tone.Gain;
  delaySend: Tone.Gain;
  meter: Tone.Meter | null;
}

/** Two alternating drone layers so a new chord cross-fades instead of clicking. */
class DroneLayer {
  readonly oscs: Tone.FatOscillator[] = [];
  readonly gains: Tone.Gain[] = [];
  readonly sub = new Tone.Oscillator({ type: 'sine', frequency: 55 });
  readonly subGain = new Tone.Gain(0.4);
  readonly filter = new Tone.Filter({ type: 'lowpass', frequency: 600, rolloff: -24, Q: 1 });
  readonly lfo = new Tone.LFO({ frequency: 0.05, min: 300, max: 900 });
  readonly env = new Tone.Gain(0);
  readonly panner = new Tone.AutoPanner({ frequency: 0.03, depth: 0.35 });
  notes: number[] = [];
  busyUntil = 0;

  constructor(out: Tone.InputNode) {
    for (let i = 0; i < 5; i++) {
      const o = new Tone.FatOscillator({ type: 'sawtooth', count: 2, spread: 14, frequency: 110 });
      const g = new Tone.Gain(0);
      o.connect(g);
      g.connect(this.filter);
      o.start();
      this.oscs.push(o);
      this.gains.push(g);
    }
    this.sub.connect(this.subGain);
    this.subGain.connect(this.env);
    this.filter.connect(this.env);
    this.lfo.connect(this.filter.frequency);
    this.lfo.start();
    this.sub.start();
    this.env.connect(this.panner);
    this.panner.connect(out);
    this.panner.start();
  }

  dispose() {
    [...this.oscs, ...this.gains, this.sub, this.subGain, this.filter, this.lfo, this.env, this.panner].forEach((n) => n.dispose());
  }
}

export class SynthEngine {
  // −2 dB of headroom into the master chain, so a kick landing on a loud bass note rarely reaches the limiter
  readonly master = new Tone.Gain(0.8);
  private readonly highpass = new Tone.Filter({ type: 'highpass', frequency: 28, rolloff: -24 });
  private readonly globalFilter = new Tone.Filter({ type: 'lowpass', frequency: 20000, rolloff: -12 });
  private readonly compressor = new Tone.Compressor({ threshold: -14, ratio: 2.5, attack: 0.02, release: 0.25, knee: 6 });
  // Tone.Limiter's 10 ms release is shorter than one period of a 55 Hz kick, so the gain moved
  // *inside* each waveform and kicks that hit it crackled. A 150 ms release turns the level down
  // without bending the waveform.
  private readonly limiter = new Tone.Compressor({ threshold: -1.5, ratio: 20, attack: 0.002, release: 0.15, knee: 1 });
  private readonly volume = new Tone.Gain(1);
  readonly waveform: Tone.Analyser | null;
  readonly fft: Tone.Analyser | null;

  readonly buses = {} as Record<Bus, BusChain>;
  private readonly reverb = new Tone.Reverb({ decay: 4, preDelay: 0.03, wet: 1 });
  private readonly reverbReturn = new Tone.Channel({ volume: -5 });
  private readonly delayIn = new Tone.Gain(1);
  private readonly delay = new Tone.Delay({ delayTime: 0.4, maxDelay: 2 });
  private readonly delayLow = new Tone.Filter({ type: 'lowpass', frequency: 3000, rolloff: -12 });
  private readonly delayHigh = new Tone.Filter({ type: 'highpass', frequency: 180, rolloff: -12 });
  // soft clip inside the feedback loop, normalised by the drive (not tanh(drive)) so the
  // small-signal gain is exactly 1 and the feedback control means what it says; peaks
  // are bounded at 1/1.4, so the loop cannot run away
  private readonly delayShaper = new Tone.WaveShaper((x) => Math.tanh(1.4 * x) / 1.4, 1024);
  private readonly delayFeedback = new Tone.Gain(0.4);
  private readonly delayChorus = new Tone.Chorus({ frequency: 0.4, delayTime: 4, depth: 0.5, wet: 0.5 });
  private readonly delayReturn = new Tone.Channel({ volume: -8 });

  private readonly drones: [DroneLayer, DroneLayer];
  private droneIdx = 0;
  private readonly bass: Tone.MonoSynth;
  private readonly arp: Tone.PolySynth;
  private readonly arpFilter = new Tone.Filter({ type: 'lowpass', frequency: 3000, rolloff: -12, Q: 1 });
  private readonly arpLfo = new Tone.LFO({ frequency: 0.1, min: 1500, max: 4500 });
  private readonly arpVibrato = new Tone.Vibrato({ frequency: 5, depth: 0 });
  private readonly arpPanner = new Tone.AutoPanner({ frequency: 0.3, depth: 0.3 });
  private readonly pad: Tone.PolySynth;
  private readonly padFilter = new Tone.Filter({ type: 'lowpass', frequency: 2000, rolloff: -12 });
  private readonly padLfo = new Tone.LFO({ frequency: 0.05, min: 1200, max: 2800 });
  private readonly padChorus = new Tone.Chorus({ frequency: 0.3, delayTime: 3.5, depth: 0.5, wet: 0.45 });
  private readonly padTape = new Tone.Vibrato({ frequency: 0.45, depth: 0.02 });

  private readonly kick = new Tone.MembraneSynth({ pitchDecay: 0.045, octaves: 5, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.05 } });
  private readonly snareNoise = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.03 } });
  private readonly snareHp = new Tone.Filter({ type: 'highpass', frequency: 1400 });
  private readonly snareBody = new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.02 } });
  private readonly clap = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.08 } });
  private readonly clapBp = new Tone.Filter({ type: 'bandpass', frequency: 1300, Q: 1.2 });
  private readonly hatC = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 } });
  private readonly hatO = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.05 } });
  private readonly hatHp = new Tone.Filter({ type: 'highpass', frequency: 7000 });
  private readonly perc = new Tone.FMSynth({ harmonicity: 3.01, modulationIndex: 6, envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 }, modulationEnvelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 } });

  private readonly bedNoise = new Tone.Noise('pink');
  private readonly bedFilter = new Tone.Filter({ type: 'bandpass', frequency: 1200, Q: 1.1 });
  private readonly bedLfo = new Tone.LFO({ frequency: 0.07, min: 600, max: 2400 });
  private readonly bedGain = new Tone.Gain(0);
  private readonly hissNoise = new Tone.Noise('white');
  private readonly hissFilter = new Tone.Filter({ type: 'highpass', frequency: 7500 });
  private readonly hissGain = new Tone.Gain(0);
  private readonly grainNoise = new Tone.Noise('brown');
  private readonly grainFilter = new Tone.Filter({ type: 'bandpass', frequency: 280, Q: 1.5 });
  private readonly grainGain = new Tone.Gain(0);
  private readonly click = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.0005, decay: 0.006, sustain: 0, release: 0.004 } });
  private readonly clickHp = new Tone.Filter({ type: 'highpass', frequency: 3000 });
  private readonly metal = new Tone.FMSynth({ harmonicity: 5.07, modulationIndex: 11, envelope: { attack: 0.001, decay: 1.4, sustain: 0, release: 0.6 }, modulationEnvelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.3 } });
  private readonly shimmer: Tone.PolySynth;
  private readonly tremolo = new Tone.Tremolo({ frequency: 3, depth: 0.35 });
  private readonly textureTape = new Tone.Vibrato({ frequency: 0.3, depth: 0.03 });

  private params: AudioParams | null = null;
  private bpm = 112;
  private kickHz = 55;
  private reverbDecay = 4;
  private lastReverbGen = -Infinity;
  private lastTime = new Map<Voice, number>();
  private lastOpenHat = -Infinity;

  constructor(opts: { analyse?: boolean; meters?: boolean } = {}) {
    // master chain
    this.master.chain(this.highpass, this.globalFilter, this.compressor, this.limiter, this.volume, Tone.getDestination());
    this.waveform = opts.analyse ? new Tone.Analyser('waveform', 1024) : null;
    this.fft = opts.analyse ? new Tone.Analyser('fft', 512) : null;
    if (this.waveform) this.limiter.connect(this.waveform);
    if (this.fft) this.limiter.connect(this.fft);

    // effect returns
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.master);
    this.delayIn.connect(this.delay);
    this.delay.chain(this.delayHigh, this.delayLow, this.delayShaper, this.delayFeedback, this.delay);
    this.delayLow.connect(this.delayChorus);
    this.delayChorus.start();
    this.delayChorus.connect(this.delayReturn);
    this.delayReturn.connect(this.master);

    // buses
    for (const b of BUSES) {
      const layer = new Tone.Gain(0);
      const tone = new Tone.Filter({ type: 'lowpass', frequency: 12000, rolloff: -12 });
      const drive = b === 'bass' || b === 'drums' ? new Tone.Distortion({ distortion: 0.15, wet: 0.2, oversample: '2x' }) : null;
      const channel = new Tone.Channel({ volume: levelToDb(b, 0.8) });
      const reverbSend = new Tone.Gain(0.2);
      const delaySend = new Tone.Gain(0.1);
      if (drive) layer.chain(tone, drive, channel); else layer.chain(tone, channel);
      channel.connect(this.master);
      channel.connect(reverbSend);
      channel.connect(delaySend);
      reverbSend.connect(this.reverb);
      delaySend.connect(this.delayIn);
      const meter = opts.meters ? new Tone.Meter({ smoothing: 0.85 }) : null;
      if (meter) channel.connect(meter);
      this.buses[b] = { layer, tone, drive, channel, reverbSend, delaySend, meter };
    }

    // drone
    this.drones = [new DroneLayer(this.buses.drone.layer), new DroneLayer(this.buses.drone.layer)];

    // bass
    this.bass = new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { type: 'lowpass', rolloff: -24, Q: 2 },
      envelope: { attack: 0.004, decay: 0.25, sustain: 0.55, release: 0.12 },
      filterEnvelope: { attack: 0.004, decay: 0.22, sustain: 0.25, release: 0.15, baseFrequency: 180, octaves: 2.5 },
    });
    this.bass.connect(this.buses.bass.layer);

    // arp
    this.arp = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.003, decay: 0.2, sustain: 0.1, release: 0.3 } });
    this.arp.maxPolyphony = 10;
    this.arp.chain(this.arpFilter, this.arpVibrato, this.arpPanner, this.buses.arp.layer);
    this.arpLfo.connect(this.arpFilter.frequency);
    this.arpLfo.start();
    this.arpPanner.start();

    // pad
    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatcustom', partials: [1, 0.4, 0.2, 0.1], count: 3, spread: 20 } as never,
      envelope: { attack: 1.5, decay: 0.5, sustain: 0.85, release: 3 },
    });
    this.pad.maxPolyphony = 14;
    this.pad.chain(this.padFilter, this.padChorus, this.padTape, this.buses.pad.layer);
    this.padLfo.connect(this.padFilter.frequency);
    this.padLfo.start();
    this.padChorus.start();

    // drums
    const d = this.buses.drums.layer;
    this.kick.connect(d);
    this.snareNoise.chain(this.snareHp, d);
    this.snareBody.connect(d);
    this.clap.chain(this.clapBp, d);
    this.hatC.connect(this.hatHp);
    this.hatO.connect(this.hatHp);
    this.hatHp.connect(d);
    this.perc.connect(d);
    this.kick.volume.value = 2;
    this.snareNoise.volume.value = -6;
    this.snareBody.volume.value = -8;
    this.clap.volume.value = -4;
    this.hatC.volume.value = -14;
    this.hatO.volume.value = -16;
    this.perc.volume.value = -12;

    // texture
    const tx = this.buses.texture.layer;
    this.bedNoise.chain(this.bedFilter, this.bedGain, this.textureTape);
    this.bedLfo.connect(this.bedFilter.frequency);
    this.bedLfo.start();
    this.hissNoise.chain(this.hissFilter, this.hissGain, this.textureTape);
    this.grainNoise.chain(this.grainFilter, this.grainGain, this.textureTape);
    this.textureTape.connect(tx);
    this.bedNoise.start();
    this.hissNoise.start();
    this.grainNoise.start();
    this.click.chain(this.clickHp, tx);
    this.click.volume.value = -10;
    this.metal.connect(tx);
    this.metal.volume.value = -16;
    this.shimmer = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sine' }, envelope: { attack: 1.8, decay: 0.5, sustain: 0.7, release: 3.5 } });
    this.shimmer.maxPolyphony = 6;
    this.shimmer.volume.value = -14;
    this.shimmer.chain(this.tremolo, tx);
    this.tremolo.start();

    this.setMixer(DEFAULT_MIXER, 0);
  }

  /** Resolves when the reverb impulse response exists. */
  async ready(): Promise<void> {
    await this.reverb.ready;
  }

  setTempo(bpm: number) {
    this.bpm = bpm;
    if (this.params) this.applyDelayTime(this.params, 0.2);
  }

  setTonic(pc: number) {
    const m = 31 + ((pc - 7 + 24) % 12); // tonic between G1 and F#2 (49–92 Hz)
    this.kickHz = Tone.mtof(m as Tone.Unit.MidiNote) as number;
  }

  private applyDelayTime(ap: AudioParams, ramp: number) {
    const beats = NOTE_BEATS[ap.fx.delayTime] ?? 0.75;
    this.delay.delayTime.rampTo(Math.min(1.9, (beats * 60) / this.bpm), ramp);
  }

  apply(ap: AudioParams, ramp = ap.ramp) {
    this.params = ap;
    const r = Math.max(0.02, ramp);
    // drone
    for (const dl of this.drones) {
      const c = ap.drone.cutoff;
      dl.lfo.min = c * (1 - 0.45 * ap.drone.lfoDepth);
      dl.lfo.max = c * (1 + 1.2 * ap.drone.lfoDepth);
      dl.lfo.frequency.rampTo(ap.drone.lfoRate, r);
      dl.filter.Q.rampTo(ap.drone.q, r);
      dl.subGain.gain.rampTo(ap.drone.sub, r);
      dl.panner.frequency.rampTo(ap.drone.panRate, r);
      for (const o of dl.oscs) o.spread = ap.drone.spread;
    }
    // bass
    this.bass.set({
      oscillator: { type: ap.bass.osc },
      filter: { Q: ap.bass.q },
      filterEnvelope: { baseFrequency: ap.bass.cutoff, octaves: ap.bass.envOctaves },
      envelope: { decay: ap.bass.decay },
      portamento: ap.bass.portamento,
    });
    this.setDrive(this.buses.bass.drive, ap.bass.drive, r);
    // arp
    this.arp.set({ oscillator: { type: ap.arp.osc }, envelope: { decay: ap.arp.decay, release: ap.arp.release } });
    this.arpFilter.Q.rampTo(ap.arp.q, r);
    this.arpLfo.min = ap.arp.cutoff * (1 - 0.5 * ap.arp.lfoDepth);
    this.arpLfo.max = ap.arp.cutoff * (1 + 1.2 * ap.arp.lfoDepth);
    this.arpLfo.frequency.rampTo(ap.arp.lfoRate, r);
    this.arpVibrato.frequency.rampTo(ap.arp.vibratoRate, r);
    this.arpVibrato.depth.rampTo(ap.arp.vibratoDepth, r);
    this.arpPanner.depth.rampTo(ap.arp.panDepth, r);
    this.arpPanner.frequency.rampTo(ap.arp.panRate, r);
    // pad
    this.pad.set({ envelope: { attack: ap.pad.attack, release: ap.pad.release }, oscillator: { partials: ap.pad.partials, spread: ap.pad.spread } as never });
    this.padFilter.Q.rampTo(ap.pad.q, r);
    this.padLfo.min = ap.pad.cutoff * (1 - 0.45 * ap.pad.lfoDepth);
    this.padLfo.max = ap.pad.cutoff * (1 + 1.1 * ap.pad.lfoDepth);
    this.padLfo.frequency.rampTo(ap.pad.lfoRate, r);
    this.padChorus.depth = ap.pad.chorusDepth;
    this.padTape.depth.rampTo(ap.texture.tapeDepth * 0.6, r);
    // drums
    this.setDrive(this.buses.drums.drive, ap.drums.drive, r);
    this.hatHp.frequency.rampTo(ap.drums.hatHighpass, r);
    this.hatC.envelope.decay = ap.drums.hatDecay;
    this.hatO.envelope.decay = ap.drums.openDecay;
    this.kick.envelope.decay = ap.drums.kickDecay;
    this.snareNoise.volume.rampTo(-6 + 20 * Math.log10(ap.drums.snareNoise), r);
    // texture
    this.bedGain.gain.rampTo(ap.texture.bed, r);
    this.hissGain.gain.rampTo(ap.texture.hiss, r);
    this.grainGain.gain.rampTo(ap.texture.grain, r);
    this.bedLfo.min = ap.texture.bandCenter * (1 - 0.6 * ap.texture.bandLfoDepth);
    this.bedLfo.max = ap.texture.bandCenter * (1 + 1.4 * ap.texture.bandLfoDepth);
    this.bedLfo.frequency.rampTo(ap.texture.bandLfoRate, r);
    this.tremolo.frequency.rampTo(ap.texture.tremoloRate, r);
    this.textureTape.depth.rampTo(ap.texture.tapeDepth, r);
    this.clickHp.frequency.rampTo(ap.texture.clickHighpass, r);
    // fx
    this.delayFeedback.gain.rampTo(ap.fx.delayFeedback, r);
    this.delayLow.frequency.rampTo(ap.fx.delayCutoff, r);
    this.delayChorus.depth = ap.fx.chorusWidth;
    this.applyDelayTime(ap, r);
    for (const b of BUSES) {
      this.buses[b].reverbSend.gain.rampTo(ap.fx.sends[b].reverb, r);
      this.buses[b].delaySend.gain.rampTo(ap.fx.sends[b].delay, r);
    }
    // the convolution IR is regenerated only for meaningful changes, at most every 3 s
    const now = Tone.now();
    if (Math.abs(ap.fx.reverbDecay - this.reverbDecay) > 0.6 && now - this.lastReverbGen > 3) {
      this.reverbDecay = ap.fx.reverbDecay;
      this.lastReverbGen = now;
      this.reverb.decay = ap.fx.reverbDecay;
    }
    this.globalFilter.frequency.rampTo(ap.master.filter, r);
  }

  /** Sets the reverb decay immediately (used before offline rendering). */
  async setReverbDecay(decay: number) {
    this.reverbDecay = decay;
    this.reverb.decay = decay;
    await this.reverb.ready;
  }

  private setDrive(d: Tone.Distortion | null, amount: number, r: number) {
    if (!d) return;
    d.distortion = amount;
    d.wet.rampTo(Math.min(0.6, 0.1 + amount), r);
  }

  setMixer(m: MixerState, ramp = 0.1) {
    for (const key of MIX_KEYS) {
      const ch = key === 'reverb' ? this.reverbReturn : key === 'delay' ? this.delayReturn : this.buses[key as Bus].channel;
      const soloMuted = m.solo != null && key !== m.solo && key !== 'reverb' && key !== 'delay';
      const muted = m.mutes[key] || soloMuted || m.levels[key] <= 0.001;
      ch.mute = muted;
      if (!muted) ch.volume.rampTo(levelToDb(key as MixKey, m.levels[key]), Math.max(0.02, ramp));
    }
    this.volume.gain.rampTo(Math.pow(m.master, 2), Math.max(0.02, ramp));
    this.globalFilter.frequency.rampTo(20000 * Math.pow(300 / 20000, 1 - m.globalFilter), Math.max(0.02, ramp));
  }

  /** Arrangement automation at a bar boundary: layer gains, filter drift, pan. */
  applyLayers(layers: Record<Layer, { on: boolean; level: number; pan: number }>, time: number, barSeconds: number, smooth: number) {
    const busOn: Partial<Record<Bus, number>> = {};
    for (const l of Object.keys(layers) as Layer[]) {
      const b = LAYER_BUS[l];
      const v = layers[l].on ? layers[l].level : 0;
      busOn[b] = Math.max(busOn[b] ?? 0, v);
    }
    for (const b of BUSES) {
      const g = this.buses[b].layer.gain;
      const target = busOn[b] ?? 0;
      const ramp = b === 'drums' ? Math.min(barSeconds * 0.25, 0.4) : barSeconds * (0.5 + smooth);
      g.cancelScheduledValues(time);
      g.setValueAtTime(g.getValueAtTime(time), time);
      g.linearRampToValueAtTime(target, time + ramp);
    }
    for (const l of ['drone', 'bass', 'arp', 'pad', 'texture'] as Layer[]) {
      this.buses[LAYER_BUS[l]].channel.pan.linearRampToValueAtTime(layers[l].pan, time + barSeconds);
    }
  }

  /** Plays one note event at audio time `t`. */
  trigger(e: NoteEvent, t: number, spb: number) {
    let time = t;
    if (MONO_VOICES.has(e.voice)) {
      const last = this.lastTime.get(e.voice) ?? -Infinity;
      if (time <= last + 0.0015) time = last + 0.002; // sources require strictly increasing start times
      this.lastTime.set(e.voice, time);
    }
    const dur = Math.max(0.02, e.dur * spb);
    const v = Math.max(0.01, Math.min(1, e.vel));
    const hz = (m: number) => Tone.mtof(m as Tone.Unit.MidiNote) as number;
    switch (e.voice) {
      case 'drone': this.triggerDrone(e.notes, time, dur, v); break;
      case 'bass': this.bass.triggerAttackRelease(hz(e.notes[0]), dur, time, v); break;
      case 'arp': this.arp.triggerAttackRelease(e.notes.map(hz), dur, time, v); break;
      case 'pad': this.pad.triggerAttackRelease(e.notes.map(hz), dur, time, v * 0.8); break;
      case 'kick': this.kick.triggerAttackRelease(this.kickHz, 0.3, time, v); break;
      case 'snare':
        this.snareNoise.triggerAttackRelease(0.14, time, v);
        this.snareBody.triggerAttackRelease(185, 0.08, time, v * 0.7);
        break;
      case 'clap':
        this.clap.triggerAttackRelease(0.01, time, v * 0.8);
        this.clap.triggerAttackRelease(0.01, time + 0.011, v * 0.7);
        this.clap.triggerAttackRelease(0.05, time + 0.022, v);
        this.lastTime.set('clap', time + 0.022);
        break;
      case 'hatC':
        if (time - this.lastOpenHat < 0.6) this.hatO.triggerRelease(time); // choke the open hat
        this.hatC.triggerAttackRelease(0.03, time, v);
        break;
      case 'hatO':
        this.hatO.triggerAttackRelease(Math.min(dur, 0.4), time, v);
        this.lastOpenHat = time;
        break;
      case 'perc': this.perc.triggerAttackRelease(hz(e.notes[0] ?? 76), 0.08, time, v); break;
      case 'click': this.click.triggerAttackRelease(0.004, time, v); break;
      case 'metal': this.metal.triggerAttackRelease(hz(e.notes[0]), Math.min(dur, 2), time, v); break;
      case 'shimmer': this.shimmer.triggerAttackRelease(e.notes.map(hz), dur, time, v); break;
    }
  }

  private triggerDrone(notes: number[], t: number, dur: number, vel: number) {
    const ap = this.params;
    const fresh = this.drones.every((d) => d.busyUntil <= t);
    // a drone starting from silence fades in quickly; profile-driven long attacks apply to changes
    const attack = fresh ? Math.min(1.5, ap?.drone.attack ?? 3) : ap?.drone.attack ?? 3;
    const release = ap?.drone.release ?? 4;
    const level = 0.5 * vel;
    const cur = this.drones[this.droneIdx];
    const same = cur.notes.length === notes.length && cur.notes.every((n, i) => n === notes[i]) && t < cur.busyUntil;
    if (same) {
      // re-articulation of the same drone: just extend it
      cur.env.gain.cancelAndHoldAtTime(t);
      cur.env.gain.linearRampToValueAtTime(level, t + 0.5);
      cur.env.gain.setValueAtTime(level, t + dur);
      cur.env.gain.linearRampToValueAtTime(0, t + dur + release);
      cur.busyUntil = t + dur + release;
      return;
    }
    // fade the current layer out, bring the other one in
    if (cur.busyUntil > t) {
      cur.env.gain.cancelAndHoldAtTime(t);
      cur.env.gain.linearRampToValueAtTime(0, t + release * 0.8);
      cur.busyUntil = t + release * 0.8;
    }
    this.droneIdx = 1 - this.droneIdx;
    const nxt = this.drones[this.droneIdx];
    let start = t;
    if (nxt.busyUntil > t) {
      nxt.env.gain.cancelAndHoldAtTime(t);
      nxt.env.gain.linearRampToValueAtTime(0, t + 0.06);
      start = t + 0.07;
    }
    nxt.notes = [...notes];
    const norm = 1 / Math.sqrt(Math.max(1, notes.length));
    nxt.oscs.forEach((o, i) => {
      if (i < notes.length) {
        o.frequency.setValueAtTime(Tone.mtof(notes[i] as Tone.Unit.MidiNote) as number, start);
        nxt.gains[i].gain.setValueAtTime(norm * (i === 0 ? 1 : 0.8), start);
      } else nxt.gains[i].gain.setValueAtTime(0, start);
    });
    nxt.sub.frequency.setValueAtTime(Tone.mtof((notes[0] >= 40 ? notes[0] - 12 : notes[0]) as Tone.Unit.MidiNote) as number, start);
    nxt.env.gain.cancelScheduledValues(start);
    nxt.env.gain.setValueAtTime(0, start);
    nxt.env.gain.linearRampToValueAtTime(level, start + attack);
    nxt.env.gain.setValueAtTime(level, start + Math.max(attack, dur));
    nxt.env.gain.linearRampToValueAtTime(0, start + Math.max(attack, dur) + release);
    nxt.busyUntil = start + Math.max(attack, dur) + release;
  }

  /** Silences everything quickly and cancels pending automation (stop / panic). */
  silence(time = Tone.now(), fade = 0.12) {
    for (const b of BUSES) {
      const g = this.buses[b].layer.gain;
      g.cancelScheduledValues(time);
      g.setValueAtTime(g.getValueAtTime(time), time);
      g.linearRampToValueAtTime(0, time + fade);
    }
    for (const d of this.drones) {
      d.env.gain.cancelScheduledValues(time);
      d.env.gain.setValueAtTime(d.env.gain.getValueAtTime(time), time);
      d.env.gain.linearRampToValueAtTime(0, time + fade);
      d.busyUntil = 0;
      d.notes = [];
    }
    this.arp.releaseAll(time);
    this.pad.releaseAll(time);
    this.shimmer.releaseAll(time);
    this.bass.triggerRelease(time);
    this.lastTime.clear();
  }

  meterLevels(): Record<Bus, number> {
    const out = {} as Record<Bus, number>;
    for (const b of BUSES) {
      const m = this.buses[b].meter;
      const v = m ? m.getValue() : -Infinity;
      out[b] = typeof v === 'number' ? v : Math.max(...(v as number[]));
    }
    return out;
  }

  dispose() {
    this.silence(Tone.now(), 0.01);
    const nodes: { dispose(): unknown }[] = [
      this.master, this.highpass, this.globalFilter, this.compressor, this.limiter, this.volume,
      this.reverb, this.reverbReturn, this.delayIn, this.delay, this.delayLow, this.delayHigh, this.delayShaper,
      this.delayFeedback, this.delayChorus, this.delayReturn, this.bass, this.arp, this.arpFilter, this.arpLfo,
      this.arpVibrato, this.arpPanner, this.pad, this.padFilter, this.padLfo, this.padChorus, this.padTape,
      this.kick, this.snareNoise, this.snareHp, this.snareBody, this.clap, this.clapBp, this.hatC, this.hatO, this.hatHp,
      this.perc, this.bedNoise, this.bedFilter, this.bedLfo, this.bedGain, this.hissNoise, this.hissFilter, this.hissGain,
      this.grainNoise, this.grainFilter, this.grainGain, this.click, this.clickHp, this.metal, this.shimmer, this.tremolo, this.textureTape,
    ];
    if (this.waveform) nodes.push(this.waveform);
    if (this.fft) nodes.push(this.fft);
    for (const b of BUSES) {
      const c = this.buses[b];
      nodes.push(c.layer, c.tone, c.channel, c.reverbSend, c.delaySend);
      if (c.drive) nodes.push(c.drive);
      if (c.meter) nodes.push(c.meter);
    }
    this.drones.forEach((d) => d.dispose());
    nodes.forEach((n) => n.dispose());
  }
}
