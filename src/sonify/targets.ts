// Musical targets that chemical features can drive. Every target is a 0..1
// control; the audio engine and composer translate it into a bounded musical
// range (see src/audio/params.ts and src/music/composer.ts).
//
// `composition: true` targets change notes, rhythms or arrangement. In
// Analytical Sonification mode they are held at their neutral value so every
// profile modulates one fixed reference composition; only timbral targets move.

export type TargetId =
  | 'droneDepth' | 'lowHarmonics' | 'filterBrightness' | 'upperHarmonics' | 'percComplexity' | 'saturation'
  | 'pluckArticulation' | 'stereoMotion' | 'transientBrightness' | 'rhythmicDetail' | 'padEnvelope'
  | 'reverbDiffusion' | 'lowMidTexture' | 'filterResonance' | 'arpComplexity' | 'melodicMutation'
  | 'hfModulation' | 'sparkle' | 'slowModRate' | 'sustainTexture' | 'transitionSmoothness' | 'padBlend'
  | 'percTransients' | 'brightNoise' | 'resonantAccents' | 'modTexture' | 'filterMovement'
  | 'rhythmicArticulation' | 'upperPads' | 'overtones' | 'delayCharacter' | 'stereoMod';

export type TargetGroup = 'drone' | 'bass' | 'arp' | 'pad' | 'drums' | 'texture' | 'fx' | 'global';

export interface TargetInfo {
  id: TargetId;
  label: string;
  group: TargetGroup;
  composition: boolean;
  /** neutral value used when no data drives the target */
  neutral: number;
  /** what the target does, in plain words */
  effect: string;
}

export const TARGETS: TargetInfo[] = [
  { id: 'droneDepth', label: 'Drone depth', group: 'drone', composition: false, neutral: 0.35, effect: 'Drone level and sub-oscillator weight.' },
  { id: 'lowHarmonics', label: 'Low-frequency harmonics', group: 'drone', composition: false, neutral: 0.35, effect: 'Opens the drone filter through its lower partials and thickens detune.' },
  { id: 'filterBrightness', label: 'Filter brightness', group: 'global', composition: false, neutral: 0.4, effect: 'Cutoff of the tone filters on the melodic buses.' },
  { id: 'upperHarmonics', label: 'Upper harmonic energy', group: 'global', composition: false, neutral: 0.35, effect: 'Filter-envelope amount and oscillator brightness on arp and bass.' },
  { id: 'percComplexity', label: 'Percussive complexity', group: 'drums', composition: true, neutral: 0.3, effect: 'Ghost notes and an extra Euclidean percussion line.' },
  { id: 'saturation', label: 'Saturation', group: 'global', composition: false, neutral: 0.2, effect: 'Soft-clip drive on the drum and bass buses.' },
  { id: 'pluckArticulation', label: 'Pluck articulation', group: 'arp', composition: false, neutral: 0.4, effect: 'Shorter, more plucked arpeggiator envelopes.' },
  { id: 'stereoMotion', label: 'Stereo motion', group: 'arp', composition: false, neutral: 0.3, effect: 'Auto-pan depth on the arpeggiator.' },
  { id: 'transientBrightness', label: 'Transient brightness', group: 'drums', composition: false, neutral: 0.35, effect: 'Brighter hi-hat and snare transients.' },
  { id: 'rhythmicDetail', label: 'Rhythmic detail', group: 'drums', composition: true, neutral: 0.3, effect: 'Sixteenth-note hi-hat density.' },
  { id: 'padEnvelope', label: 'Pad envelope length', group: 'pad', composition: false, neutral: 0.45, effect: 'Pad attack and release time.' },
  { id: 'reverbDiffusion', label: 'Reverb diffusion', group: 'fx', composition: false, neutral: 0.4, effect: 'Reverb send and decay.' },
  { id: 'lowMidTexture', label: 'Low-mid texture', group: 'bass', composition: false, neutral: 0.3, effect: 'Bass filter body and low-mid noise grain.' },
  { id: 'filterResonance', label: 'Filter resonance', group: 'global', composition: false, neutral: 0.25, effect: 'Resonance (Q) of the bass and arp filters, capped for safety.' },
  { id: 'arpComplexity', label: 'Arpeggiator complexity', group: 'arp', composition: true, neutral: 0.35, effect: 'Octave span, sequence length and order of the arpeggiator.' },
  { id: 'melodicMutation', label: 'Melodic mutation', group: 'arp', composition: true, neutral: 0.25, effect: 'How often motifs mutate at phrase boundaries.' },
  { id: 'hfModulation', label: 'High-frequency modulation', group: 'texture', composition: false, neutral: 0.3, effect: 'Faster shimmer tremolo and arp vibrato.' },
  { id: 'sparkle', label: 'Textural sparkle', group: 'texture', composition: true, neutral: 0.25, effect: 'Density of shimmer and metallic texture events.' },
  { id: 'slowModRate', label: 'Slow modulation', group: 'global', composition: false, neutral: 0.4, effect: 'Slows the drone and pad LFOs (higher = slower, longer cycles).' },
  { id: 'sustainTexture', label: 'Sustained texture', group: 'texture', composition: false, neutral: 0.3, effect: 'Level of the sustained noise bed.' },
  { id: 'transitionSmoothness', label: 'Transition smoothness', group: 'global', composition: true, neutral: 0.5, effect: 'Longer parameter ramps and fewer simultaneous arrangement changes.' },
  { id: 'padBlend', label: 'Pad blending', group: 'pad', composition: false, neutral: 0.4, effect: 'Pad level and detune spread.' },
  { id: 'percTransients', label: 'Percussive transients', group: 'drums', composition: true, neutral: 0.25, effect: 'Density of rim/click percussion.' },
  { id: 'brightNoise', label: 'Bright noise', group: 'texture', composition: false, neutral: 0.2, effect: 'Level of high, airy noise.' },
  { id: 'resonantAccents', label: 'Resonant accents', group: 'bass', composition: false, neutral: 0.3, effect: 'Filter peak on accented bass and arp notes.' },
  { id: 'modTexture', label: 'Modulated texture', group: 'texture', composition: false, neutral: 0.3, effect: 'LFO sweep depth on the texture band-pass.' },
  { id: 'filterMovement', label: 'Filter movement', group: 'global', composition: false, neutral: 0.3, effect: 'LFO depth on pad and arp filters.' },
  { id: 'rhythmicArticulation', label: 'Rhythmic articulation', group: 'drums', composition: true, neutral: 0.4, effect: 'Gate lengths: higher is tighter and more staccato.' },
  { id: 'upperPads', label: 'Upper-register pads', group: 'pad', composition: true, neutral: 0.35, effect: 'Moves pad voicings up the keyboard.' },
  { id: 'overtones', label: 'Harmonic overtones', group: 'pad', composition: false, neutral: 0.3, effect: 'Adds partials to the pad tone.' },
  { id: 'delayCharacter', label: 'Delay character', group: 'fx', composition: false, neutral: 0.35, effect: 'Delay feedback and send (feedback capped below runaway).' },
  { id: 'stereoMod', label: 'Stereo modulation', group: 'fx', composition: false, neutral: 0.3, effect: 'Chorus depth on pads and delay width.' },
];

export const TARGET_IDS = TARGETS.map((t) => t.id);
const byId = new Map(TARGETS.map((t) => [t.id, t]));
export const targetInfo = (id: TargetId) => byId.get(id)!;

export type ParamSet = Record<TargetId, number>;

export function neutralParams(): ParamSet {
  return Object.fromEntries(TARGETS.map((t) => [t.id, t.neutral])) as ParamSet;
}
