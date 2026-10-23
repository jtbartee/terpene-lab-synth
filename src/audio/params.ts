// Maps 0..1 musical targets, style defaults, live controls and per-layer
// arrangement state into concrete, bounded audio values. Pure (no Tone.js),
// so the safety bounds are unit-tested.

import type { Bus } from '../music/composer';
import type { Layer, StyleDef } from '../music/styles';
import type { ParamSet } from '../sonify/targets';

export type Send = 'reverb' | 'delay';
export type MixKey = Bus | Send;
export const MIX_KEYS: MixKey[] = ['drone', 'bass', 'arp', 'pad', 'drums', 'texture', 'reverb', 'delay'];

export interface MixerState {
  levels: Record<MixKey, number>;
  mutes: Record<MixKey, boolean>;
  solo: Bus | null;
  master: number;
  /** 0..1, 1 = fully open */
  globalFilter: number;
  /** 0..1 scales every LFO depth */
  modDepth: number;
}

export const DEFAULT_MIXER: MixerState = {
  levels: { drone: 0.8, bass: 0.8, arp: 0.8, pad: 0.8, drums: 0.8, texture: 0.8, reverb: 0.8, delay: 0.8 },
  mutes: { drone: false, bass: false, arp: false, pad: false, drums: false, texture: false, reverb: false, delay: false },
  solo: null,
  master: 0.8,
  globalFilter: 1,
  modDepth: 0.6,
};

/** Base channel gains (dB) chosen for headroom: the busiest mix peaks around −6 dBFS before the limiter. */
export const BASE_DB: Record<MixKey, number> = {
  drone: -13, bass: -9, arp: -14, pad: -17, drums: -8, texture: -15, reverb: -5, delay: -8,
};

export function levelToDb(key: MixKey, level: number): number {
  if (level <= 0.001) return -Infinity;
  return BASE_DB[key] + 20 * Math.log10(level / 0.8);
}

export interface AudioParams {
  drone: { sub: number; cutoff: number; q: number; lfoRate: number; lfoDepth: number; spread: number; attack: number; release: number; panRate: number };
  bass: { osc: OscType; cutoff: number; q: number; envOctaves: number; decay: number; drive: number; portamento: number };
  arp: { osc: OscType; cutoff: number; q: number; decay: number; release: number; panDepth: number; panRate: number; vibratoRate: number; vibratoDepth: number; lfoDepth: number; lfoRate: number };
  pad: { cutoff: number; q: number; attack: number; release: number; spread: number; chorusDepth: number; lfoRate: number; lfoDepth: number; partials: number[] };
  drums: { drive: number; hatHighpass: number; hatDecay: number; openDecay: number; kickDecay: number; snareNoise: number };
  texture: { bed: number; hiss: number; grain: number; bandCenter: number; bandLfoDepth: number; bandLfoRate: number; tremoloRate: number; tapeDepth: number; clickHighpass: number };
  fx: { reverbDecay: number; delayTime: string; delayFeedback: number; delayCutoff: number; chorusWidth: number; sends: Record<Bus, { reverb: number; delay: number }> };
  master: { filter: number };
  /** seconds used for parameter ramps */
  ramp: number;
}

export type OscType = 'sawtooth' | 'square' | 'triangle';
const OSCS: OscType[] = ['sawtooth', 'square', 'triangle'];

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));
/** exponential sweep for frequencies */
const expLerp = (a: number, b: number, t: number) => a * Math.pow(b / a, Math.max(0, Math.min(1, t)));

/** Hard safety limits. Tests assert every output stays inside these. */
export const LIMITS = {
  cutoffMin: 80, cutoffMax: 12000, qMax: 9, driveMax: 0.55, delayFeedbackMax: 0.82, reverbDecayMax: 12,
  lfoRateMax: 9, rampMin: 0.05, rampMax: 6,
};

export function computeAudioParams(
  p: ParamSet,
  style: StyleDef,
  mixer: MixerState,
  layers?: Partial<Record<Layer, { timbre: number; filter: number }>>,
): AudioParams {
  const md = mixer.modDepth;
  const timbre = (l: Layer) => layers?.[l]?.timbre ?? 0;
  const drift = (l: Layer) => Math.pow(2, 1.5 * (layers?.[l]?.filter ?? 0));
  const bright = p.filterBrightness;
  const slow = p.slowModRate; // higher = slower
  const res = p.filterResonance;
  const send = (rv: number, dl: number) => ({ reverb: Math.min(1, rv), delay: Math.min(1, dl) });
  const reverbAmt = lerp(0.15, 1, p.reverbDiffusion) * (style.fx.reverbWet / 0.3);
  const delayAmt = lerp(0.3, 1.2, p.delayCharacter) * style.fx.delaySend;

  const out: AudioParams = {
    drone: {
      sub: lerp(0.1, 0.8, p.droneDepth),
      cutoff: clampHz(expLerp(180, 1600, 0.6 * p.lowHarmonics + 0.3 * bright) * drift('drone')),
      q: lerp(0.5, 3, res * 0.6),
      lfoRate: lerp(0.18, 0.015, slow),
      lfoDepth: lerp(0.1, 0.9, md),
      spread: lerp(6, 28, p.lowHarmonics),
      attack: lerp(2, 6, p.padEnvelope),
      release: lerp(2.5, 7, p.padEnvelope),
      panRate: lerp(0.08, 0.01, slow),
    },
    bass: {
      osc: OSCS[timbre('bass') % 3],
      cutoff: clampHz(expLerp(150, 1400, 0.5 * p.lowMidTexture + 0.35 * bright) * drift('bass')),
      q: Math.min(LIMITS.qMax, lerp(1, 7, 0.6 * res + 0.4 * p.resonantAccents)),
      envOctaves: lerp(1, 4.2, 0.6 * p.upperHarmonics + 0.4 * p.resonantAccents),
      decay: lerp(0.12, 0.5, 1 - p.rhythmicArticulation),
      drive: Math.min(LIMITS.driveMax, lerp(0.02, 0.5, p.saturation)),
      portamento: style.bass === 'sequence' || style.bass === 'micro' ? 0 : lerp(0, 0.06, p.transitionSmoothness),
    },
    arp: {
      osc: (['triangle', 'square', 'sawtooth'] as OscType[])[timbre('arp') % 3],
      cutoff: clampHz(expLerp(600, 7000, 0.7 * bright + 0.3 * p.upperHarmonics) * drift('arp')),
      q: Math.min(LIMITS.qMax, lerp(0.8, 6, res)),
      decay: lerp(0.5, 0.06, p.pluckArticulation),
      release: lerp(0.8, 0.12, p.pluckArticulation),
      panDepth: lerp(0, 0.9, p.stereoMotion) * (0.4 + 0.6 * md),
      panRate: lerp(0.1, 1.2, p.stereoMotion),
      vibratoRate: lerp(3, 7.5, p.hfModulation),
      vibratoDepth: lerp(0, 0.12, p.hfModulation) * md,
      lfoDepth: lerp(0, 0.85, p.filterMovement) * md,
      lfoRate: lerp(0.25, 0.04, slow),
    },
    pad: {
      cutoff: clampHz(expLerp(500, 5000, 0.6 * bright + 0.3 * p.overtones) * drift('pad')),
      q: lerp(0.5, 2.5, res * 0.5),
      attack: lerp(0.4, 4.5, p.padEnvelope),
      release: lerp(0.8, 6, p.padEnvelope),
      spread: lerp(8, 40, p.padBlend),
      chorusDepth: lerp(0.1, 0.9, p.stereoMod) * md,
      lfoRate: lerp(0.15, 0.02, slow),
      lfoDepth: lerp(0.05, 0.8, p.filterMovement) * md,
      partials: [1, lerp(0.25, 0.6, p.overtones), lerp(0.1, 0.45, p.overtones), lerp(0.04, 0.3, p.overtones), lerp(0, 0.2, p.overtones), lerp(0, 0.12, p.overtones)],
    },
    drums: {
      drive: Math.min(LIMITS.driveMax, lerp(0.02, 0.45, p.saturation)),
      hatHighpass: lerp(5200, 10000, p.transientBrightness),
      hatDecay: lerp(0.07, 0.03, p.rhythmicArticulation),
      openDecay: lerp(0.45, 0.2, p.rhythmicArticulation),
      kickDecay: lerp(0.55, 0.28, p.rhythmicArticulation),
      snareNoise: lerp(0.5, 1, p.transientBrightness),
    },
    texture: {
      bed: lerp(0, 0.35, p.sustainTexture),
      hiss: lerp(0, 0.12, p.brightNoise),
      grain: lerp(0, 0.25, p.lowMidTexture),
      bandCenter: expLerp(400, 3200, 0.5 * bright + 0.5 * p.modTexture),
      bandLfoDepth: lerp(0.1, 1, p.modTexture) * md,
      bandLfoRate: lerp(0.2, 0.02, slow),
      tremoloRate: lerp(0.5, LIMITS.lfoRateMax, p.hfModulation),
      tapeDepth: lerp(0.005, 0.06, 0.5 * md + 0.5 * p.stereoMod),
      clickHighpass: lerp(1500, 7000, p.transientBrightness),
    },
    fx: {
      reverbDecay: Math.min(LIMITS.reverbDecayMax, style.fx.reverbDecay * lerp(0.7, 1.35, p.reverbDiffusion)),
      delayTime: style.fx.delay,
      delayFeedback: Math.min(LIMITS.delayFeedbackMax, style.fx.delayFeedback * lerp(0.75, 1.3, p.delayCharacter)),
      delayCutoff: expLerp(1200, 5000, 1 - p.delayCharacter * 0.6),
      chorusWidth: lerp(0.2, 1, p.stereoMod),
      sends: {
        drone: send(0.35 * reverbAmt, 0.05 * delayAmt),
        bass: send(0.05 * reverbAmt, 0.04 * delayAmt),
        arp: send(0.4 * reverbAmt, 0.7 * delayAmt),
        pad: send(0.55 * reverbAmt, (style.pad === 'stab' ? 1.1 : 0.35) * delayAmt),
        drums: send(0.12 * reverbAmt, (style.drums === 'dub' ? 0.25 : 0.06) * delayAmt),
        texture: send(0.5 * reverbAmt, 0.3 * delayAmt),
      },
    },
    master: { filter: expLerp(300, 20000, mixer.globalFilter) },
    ramp: Math.max(LIMITS.rampMin, Math.min(LIMITS.rampMax, lerp(0.08, 2.5, p.transitionSmoothness))),
  };
  return out;
}

function clampHz(f: number) {
  return Math.max(LIMITS.cutoffMin, Math.min(LIMITS.cutoffMax, f));
}
