// Composition styles. Each style is a different rule set — drum kit logic, bass
// mode, arpeggiator mode, pad mode, harmonic model, arrangement affinities —
// not a reverb/tempo preset. Research notes behind each are in
// docs/MUSIC_ENGINE.md. All generated material is original.

import type { ScaleId } from './theory';

export type StyleId =
  | 'motorik' | 'kosmische' | 'dub_techno' | 'berlin' | 'ambient' | 'drone' | 'krautpop' | 'microhouse';

export type Layer = 'drone' | 'bass' | 'arp' | 'pad' | 'drums' | 'perc' | 'texture';
export const LAYERS: Layer[] = ['drone', 'bass', 'arp', 'pad', 'drums', 'perc', 'texture'];

export type ChordKind = 'triad' | 'seventh' | 'add9' | 'sus2' | 'sus4' | 'power' | 'ninth';
export type HarmonyMode = 'static' | 'field' | 'progression' | 'vamp' | 'drone';
export type DrumKit = 'motorik' | 'dub' | 'berlin' | 'pulse' | 'none' | 'krautpop' | 'micro';
export type BassMode = 'motorik' | 'dub' | 'sequence' | 'drone' | 'walking' | 'micro';
export type ArpMode = 'evolving' | 'sequence' | 'constellation' | 'sparse';
export type PadMode = 'sustain' | 'stab' | 'swell';

export interface StyleDef {
  id: StyleId;
  label: string;
  blurb: string;
  influences: string;
  bpm: number;
  bpmRange: [number, number];
  scale: ScaleId;
  swing: number;
  harmony: {
    mode: HarmonyMode;
    /** weighted transitions between 7-degree functions (0 = tonic) */
    moves: Record<number, [number, number][]>;
    barsPerChord: [number, number];
    kinds: [ChordKind, number][];
    /** chance per eligible boundary that harmony moves, scaled by the Harmonic movement control */
    moveChance: number;
  };
  drums: DrumKit;
  bass: BassMode;
  arp: ArpMode;
  pad: PadMode;
  droneIntervals: number[];
  texture: { clicks: number; metal: number; shimmer: number };
  /** how strongly each layer belongs in this style (0 = never) */
  affinity: Record<Layer, number>;
  /** order in which layers enter during the intro */
  intro: Layer[];
  phraseBars: number;
  sectionBars: number;
  fx: { reverbDecay: number; reverbWet: number; delay: '8n' | '8n.' | '4n' | '4n.' | '16n' | '2n'; delayFeedback: number; delaySend: number };
  arpDefaults: { division: 1 | 2 | 3 | 4; octaves: number; register: number };
}

const minorMoves = (o: Partial<Record<number, [number, number][]>>): Record<number, [number, number][]> => ({
  0: [[5, 3], [6, 3], [3, 2], [2, 1]],
  1: [[0, 3], [4, 1]],
  2: [[5, 2], [0, 2], [6, 1]],
  3: [[0, 3], [6, 2], [4, 1]],
  4: [[0, 4], [5, 1]],
  5: [[6, 3], [0, 2], [3, 2]],
  6: [[0, 4], [2, 2], [5, 1]],
  ...o,
});

export const STYLES: Record<StyleId, StyleDef> = {
  motorik: {
    id: 'motorik', label: 'Motorik Minimalism',
    blurb: 'A steady motorik pulse (kick on one and three with a push into three, backbeat on two and four, even eighth hats), a repeating bass ostinato, slow harmonic change and an arpeggiator that evolves at phrase boundaries.',
    influences: 'Neu!, Harmonia, Can, Stereolab, Cavern of Anti-Matter',
    bpm: 112, bpmRange: [100, 140], scale: 'natural_minor', swing: 0,
    harmony: { mode: 'static', moves: minorMoves({}), barsPerChord: [16, 32], kinds: [['triad', 3], ['power', 2], ['sus2', 1]], moveChance: 0.35 },
    drums: 'motorik', bass: 'motorik', arp: 'evolving', pad: 'sustain',
    droneIntervals: [0, 7, 12],
    texture: { clicks: 0.2, metal: 0.15, shimmer: 0.3 },
    affinity: { drone: 0.6, bass: 1, arp: 0.9, pad: 0.55, drums: 1, perc: 0.4, texture: 0.6 },
    intro: ['drone', 'drums', 'bass', 'arp', 'pad', 'texture'],
    phraseBars: 8, sectionBars: 16,
    fx: { reverbDecay: 3.5, reverbWet: 0.25, delay: '8n.', delayFeedback: 0.35, delaySend: 0.2 },
    arpDefaults: { division: 1, octaves: 2, register: 57 },
  },
  kosmische: {
    id: 'kosmische', label: 'Kosmische Drift',
    blurb: 'Long drone passages and slow harmonic fields, a soft heartbeat pulse at most, sparse arpeggios dissolving into long delays.',
    influences: 'Cluster, Tangerine Dream (early), Harmonia, Popol Vuh',
    bpm: 84, bpmRange: [60, 100], scale: 'dorian', swing: 0,
    harmony: { mode: 'field', moves: minorMoves({ 0: [[5, 2], [3, 3], [2, 2], [6, 2]] }), barsPerChord: [8, 16], kinds: [['add9', 3], ['sus2', 2], ['seventh', 2]], moveChance: 0.6 },
    drums: 'pulse', bass: 'drone', arp: 'sparse', pad: 'swell',
    droneIntervals: [0, 7, 12, 19],
    texture: { clicks: 0.1, metal: 0.3, shimmer: 0.7 },
    affinity: { drone: 1, bass: 0.45, arp: 0.6, pad: 0.9, drums: 0.3, perc: 0.1, texture: 0.85 },
    intro: ['drone', 'texture', 'pad', 'arp', 'bass', 'drums'],
    phraseBars: 8, sectionBars: 16,
    fx: { reverbDecay: 8, reverbWet: 0.45, delay: '4n.', delayFeedback: 0.5, delaySend: 0.35 },
    arpDefaults: { division: 2, octaves: 2, register: 62 },
  },
  dub_techno: {
    id: 'dub_techno', label: 'Dub Techno',
    blurb: 'Warm minor-seventh chord stabs thrown into filtered feedback delay, deep sub bass, understated four-on-the-floor percussion, one chord for a long time.',
    influences: 'Basic Channel, Deepchord, Pole, Monolake (early)',
    bpm: 120, bpmRange: [112, 128], scale: 'natural_minor', swing: 0.08,
    harmony: { mode: 'static', moves: minorMoves({ 0: [[3, 3], [6, 2], [5, 1]] }), barsPerChord: [16, 32], kinds: [['seventh', 3], ['ninth', 2]], moveChance: 0.25 },
    drums: 'dub', bass: 'dub', arp: 'sparse', pad: 'stab',
    droneIntervals: [0, 12],
    texture: { clicks: 0.45, metal: 0.1, shimmer: 0.2 },
    affinity: { drone: 0.35, bass: 1, arp: 0.25, pad: 1, drums: 1, perc: 0.6, texture: 0.8 },
    intro: ['texture', 'pad', 'drums', 'bass', 'perc', 'drone'],
    phraseBars: 8, sectionBars: 16,
    fx: { reverbDecay: 5, reverbWet: 0.3, delay: '4n.', delayFeedback: 0.62, delaySend: 0.55 },
    arpDefaults: { division: 2, octaves: 1, register: 64 },
  },
  berlin: {
    id: 'berlin', label: 'Berlin Sequence',
    blurb: 'Repeating multi-octave sixteenth-note sequences over a moving progression, evolving filters, light percussion and analogue-style modulation.',
    influences: 'Tangerine Dream (mid-70s), Klaus Schulze, Redshift',
    bpm: 118, bpmRange: [100, 132], scale: 'harmonic_minor', swing: 0,
    harmony: { mode: 'progression', moves: minorMoves({ 0: [[5, 4], [3, 3], [6, 2]], 5: [[6, 4], [3, 2], [4, 1]], 6: [[0, 3], [4, 2], [2, 1]], 3: [[6, 3], [4, 3]], 4: [[0, 5]] }), barsPerChord: [4, 8], kinds: [['triad', 3], ['seventh', 2]], moveChance: 0.85 },
    drums: 'berlin', bass: 'sequence', arp: 'sequence', pad: 'sustain',
    droneIntervals: [0, 7],
    texture: { clicks: 0.15, metal: 0.2, shimmer: 0.35 },
    affinity: { drone: 0.5, bass: 1, arp: 1, pad: 0.7, drums: 0.6, perc: 0.45, texture: 0.5 },
    intro: ['bass', 'drone', 'arp', 'pad', 'drums', 'texture'],
    phraseBars: 8, sectionBars: 16,
    fx: { reverbDecay: 4.5, reverbWet: 0.3, delay: '8n.', delayFeedback: 0.4, delaySend: 0.25 },
    arpDefaults: { division: 1, octaves: 3, register: 52 },
  },
  ambient: {
    id: 'ambient', label: 'Ambient Constellation',
    blurb: 'Sparse melodic events with call and response across registers, slowly shifting harmonic fields, extensive space and decay, no drums.',
    influences: 'Brian Eno (Ambient series), Harold Budd, Boards of Canada (ambient interludes)',
    bpm: 72, bpmRange: [56, 92], scale: 'major_pentatonic', swing: 0,
    harmony: { mode: 'field', moves: minorMoves({ 0: [[2, 3], [5, 3], [3, 2]], 2: [[5, 3], [0, 2]], 5: [[3, 3], [0, 2]] }), barsPerChord: [4, 8], kinds: [['add9', 3], ['sus2', 3], ['seventh', 1]], moveChance: 0.7 },
    drums: 'none', bass: 'drone', arp: 'constellation', pad: 'swell',
    droneIntervals: [0, 7, 12],
    texture: { clicks: 0.05, metal: 0.45, shimmer: 0.8 },
    affinity: { drone: 0.7, bass: 0.35, arp: 1, pad: 0.9, drums: 0, perc: 0, texture: 0.9 },
    intro: ['pad', 'arp', 'texture', 'drone', 'bass'],
    phraseBars: 8, sectionBars: 16,
    fx: { reverbDecay: 9, reverbWet: 0.55, delay: '2n', delayFeedback: 0.45, delaySend: 0.4 },
    arpDefaults: { division: 4, octaves: 2, register: 67 },
  },
  drone: {
    id: 'drone', label: 'Experimental Drone',
    blurb: 'Sustained tonal masses with beating partials, deliberately restricted harmony (root, fifth, the occasional added tone), slow textural events.',
    influences: 'Éliane Radigue, Phill Niblock, Stars of the Lid, Tony Conrad',
    bpm: 60, bpmRange: [40, 80], scale: 'phrygian', swing: 0,
    harmony: { mode: 'drone', moves: { 0: [[5, 1], [3, 1], [1, 1]], 1: [[0, 1]], 3: [[0, 1]], 5: [[0, 1]] }, barsPerChord: [16, 32], kinds: [['power', 4], ['sus2', 1]], moveChance: 0.15 },
    drums: 'none', bass: 'drone', arp: 'sparse', pad: 'swell',
    droneIntervals: [0, 7, 12, 24],
    texture: { clicks: 0.25, metal: 0.4, shimmer: 0.5 },
    affinity: { drone: 1, bass: 0.6, arp: 0.2, pad: 0.75, drums: 0, perc: 0.15, texture: 1 },
    intro: ['drone', 'texture', 'pad', 'bass', 'arp'],
    phraseBars: 8, sectionBars: 16,
    fx: { reverbDecay: 10, reverbWet: 0.5, delay: '2n', delayFeedback: 0.3, delaySend: 0.15 },
    arpDefaults: { division: 4, octaves: 1, register: 60 },
  },
  krautpop: {
    id: 'krautpop', label: 'Krautpop Vamp',
    blurb: 'A two-chord seventh-chord vamp over a motorik groove with tambourine-like sixteenths and a busy, melodic arpeggio.',
    influences: 'Stereolab, Broadcast, Cavern of Anti-Matter',
    bpm: 128, bpmRange: [112, 144], scale: 'dorian', swing: 0.04,
    harmony: { mode: 'vamp', moves: { 0: [[3, 3], [6, 2], [5, 1]], 3: [[0, 1]], 6: [[0, 1]], 5: [[0, 1]] }, barsPerChord: [1, 2], kinds: [['seventh', 4], ['add9', 1]], moveChance: 1 },
    drums: 'krautpop', bass: 'walking', arp: 'evolving', pad: 'sustain',
    droneIntervals: [0, 12],
    texture: { clicks: 0.1, metal: 0.2, shimmer: 0.25 },
    affinity: { drone: 0.3, bass: 1, arp: 0.95, pad: 0.8, drums: 1, perc: 0.55, texture: 0.4 },
    intro: ['drums', 'bass', 'pad', 'arp', 'perc', 'texture'],
    phraseBars: 8, sectionBars: 16,
    fx: { reverbDecay: 2.8, reverbWet: 0.22, delay: '8n', delayFeedback: 0.3, delaySend: 0.15 },
    arpDefaults: { division: 1, octaves: 2, register: 60 },
  },
  microhouse: {
    id: 'microhouse', label: 'Microhouse Clicks',
    blurb: 'Soft four-on-the-floor kick, dense Euclidean clicks and crackle, short syncopated sub stabs and filtered chord fragments.',
    influences: 'Jan Jelinek, Pole, Vladislav Delay, Akufen',
    bpm: 122, bpmRange: [114, 128], scale: 'minor_pentatonic', swing: 0.12,
    harmony: { mode: 'static', moves: minorMoves({ 0: [[3, 3], [6, 2]] }), barsPerChord: [16, 32], kinds: [['seventh', 3], ['ninth', 2]], moveChance: 0.3 },
    drums: 'micro', bass: 'micro', arp: 'sparse', pad: 'stab',
    droneIntervals: [0, 12],
    texture: { clicks: 0.9, metal: 0.25, shimmer: 0.15 },
    affinity: { drone: 0.25, bass: 1, arp: 0.35, pad: 0.75, drums: 1, perc: 0.9, texture: 0.9 },
    intro: ['texture', 'drums', 'perc', 'bass', 'pad', 'arp'],
    phraseBars: 8, sectionBars: 16,
    fx: { reverbDecay: 2.5, reverbWet: 0.2, delay: '8n.', delayFeedback: 0.45, delaySend: 0.3 },
    arpDefaults: { division: 2, octaves: 1, register: 64 },
  },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];
