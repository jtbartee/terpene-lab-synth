// The generative composition engine (2.0).
//
// A Composer is a deterministic state machine: given the same settings,
// parameters and seed it produces the same sequence of bars. Each bar is
// generated just ahead of playback (or all at once for export/MIDI) from
// randomness keyed by (seed, purpose, position), so layers are independent.
//
// Before the first note, the composer plans the piece:
//   • an arrangement blueprint (arrangement.ts) — sections with roles, lengths,
//     energy, transitions and the material each one uses;
//   • a material bank, the piece's musical memory — a main and a contrasting
//     groove (groove.ts), bass motif (bass.ts) and melodic motif (melody.ts),
//     stab rhythms and harmonic loops for "home" and "away".
//
// Hierarchy: steps (16ths) → beats → bars → phrases (4, 8 or 16 bars, seeded)
// → sections → blueprint cycles. At a section start the composer switches
// material and arrangement; at a phrase start inside a section it makes a few
// small decisions whose kind depends on the section (restrained variation in
// an A section, contrast in a B section, removal in a breakdown, restatement in
// a return). Motifs develop by named transformations and return to their
// original form; endless pieces plan new cycles that bring back the original
// material and introduce new related material.

import { neutralParams, type ParamSet } from '../sonify/targets';
import { chance, hash, intBetween, pick, shuffle, stream, weighted, type Rng } from './rng';
import { LAYERS, STYLES, type ChordKind, type Layer, type StyleDef, type StyleId } from './styles';
import {
  chordSymbol, colourChord, euclid, harmonyScale, inScale, keyPc, scaleIntervals, scaleNotesInRange, voiceLead,
  type KeyName, type ScaleId,
} from './theory';
import { clamp01, gridFor, type Grid } from './grid';
import { DRUM_VOICES, grooveLabel, kickDensity, kickSteps, makeGroove, varyGroove, type DrumVoice, type FillKind, type Groove, type GrooveOp } from './groove';
import { bassLabel, makeBass, mutateBass, pickBassOp, BASS_OP_LABEL, type BassMotif } from './bass';
import { makeArp, makeMelody, morphMotif, motifDensity, motifLabel, pickMotifOp, transformMotif, MOTIF_OP_LABEL, type Motif } from './melody';
import {
  blueprintLabel, blueprintSections, chooseBlueprint, choosePhraseBars, fitSections, ROLE_TEXT,
  type PlannedSection, type Role, type SectionSpec,
} from './arrangement';

export type Voice = 'drone' | 'bass' | 'arp' | 'pad' | 'kick' | 'snare' | 'clap' | 'hatC' | 'hatO' | 'perc' | 'click' | 'metal' | 'shimmer';
export type Bus = 'drone' | 'bass' | 'arp' | 'pad' | 'drums' | 'texture';
export const BUSES: Bus[] = ['drone', 'bass', 'arp', 'pad', 'drums', 'texture'];
export const VOICE_BUS: Record<Voice, Bus> = {
  drone: 'drone', bass: 'bass', arp: 'arp', pad: 'pad', kick: 'drums', snare: 'drums', clap: 'drums',
  hatC: 'drums', hatO: 'drums', perc: 'drums', click: 'texture', metal: 'texture', shimmer: 'texture',
};
export const PITCHED_VOICES: ReadonlySet<Voice> = new Set(['drone', 'bass', 'arp', 'pad', 'perc', 'metal', 'shimmer']);

export interface NoteEvent {
  voice: Voice;
  /** position in beats from the start of the bar */
  beat: number;
  /** duration in beats */
  dur: number;
  /** MIDI notes (empty for unpitched drums/clicks) */
  notes: number[];
  /** 0..1 */
  vel: number;
  accent?: boolean;
}

export interface CompositionSettings {
  seed: number;
  key: KeyName;
  scale: ScaleId;
  bpm: number;
  beatsPerBar: 3 | 4 | 5 | 7;
  style: StyleId;
  complexity: number;
  density: number;
  variation: number;
  harmonicMovement: number;
  rhythmIntensity: number;
  droneIntensity: number;
  /** 0 = endless */
  arrangementBars: number;
  autonomous: boolean;
  swing: number;
  /**
   * How far rhythmic identities range: 0 always uses the style's canonical
   * groove and bass rhythm, 1 draws from the whole groove family and gives
   * contrasting sections their own grooves. (Added in engine 2.)
   */
  grooveDiversity?: number;
  /** Contrast between sections and the chance of significant new material. (Engine 2.) */
  structure?: number;
  /** How far a motif may develop before returning to its original identity. (Engine 2.) */
  motifEvolution?: number;
  /**
   * Folded into the seed so each terpene profile gets its own harmony, motifs
   * and grooves from one seed. 0 (or absent) = the seed alone, as in Analytical
   * mode. Derived from the profile by the store, never edited directly.
   */
  variant?: number;
}

export const ENGINE_VERSION = 2;

export const DEFAULT_SETTINGS: CompositionSettings = {
  seed: 20261023, key: 'A', scale: 'natural_minor', bpm: 112, beatsPerBar: 4, style: 'motorik',
  complexity: 0.5, density: 0.55, variation: 0.5, harmonicMovement: 0.4, rhythmIntensity: 0.6,
  droneIntensity: 0.5, arrangementBars: 0, autonomous: true, swing: 0,
  grooveDiversity: 0.5, structure: 0.5, motifEvolution: 0.5,
};

export interface ChordInfo { degree: number; kind: ChordKind; pcs: number[]; rootPc: number; symbol: string }
export interface LayerSnapshot { on: boolean; level: number; timbre: number; filter: number; pan: number }
export interface SectionInfo { index: number; name: string; role: Role; bar: number; bars: number; energy: number; cycle: number }
export interface MaterialInfo { groove: string; bass: string; melody: string; grooveId: string; bassId: string; melodyId: string }
export interface FormEntry { label: string; role: Role; start: number; bars: number }

export interface BarPlan {
  index: number;
  beats: number;
  bpm: number;
  section: SectionInfo;
  phraseBar: number;
  phraseBars: number;
  blueprint: string;
  /** the planned sections of the current cycle (shared between bars) */
  form: FormEntry[];
  material: MaterialInfo;
  chord: ChordInfo;
  padVoicing: number[];
  layers: Record<Layer, LayerSnapshot>;
  events: NoteEvent[];
  development: string[];
  final: boolean;
}

// ---------------------------------------------------------------- internals

interface ProgramChord { degree: number; start: number; bars: number }
interface ChordState extends ChordInfo { startBar: number; bars: number }
interface LayerState { on: boolean; since: number; fading: boolean; level: number; timbre: number; filter: number; pan: number }
type PadMode = 'sustain' | 'stab' | 'swell' | 'pulse';
type Source = 'primary' | 'secondary' | 'other';

/** The piece's musical memory: original material, contrasting material and what has happened. */
interface Memory {
  groove: { original: Groove | null; main: Groove | null; contrast: Groove | null; base: Groove | null; current: Groove | null };
  bass: { original: BassMotif; main: BassMotif; contrast: BassMotif; base: BassMotif | null; current: BassMotif | null; distance: number };
  melody: {
    primary: Motif; developed: Motif; secondary: Motif; secondaryDeveloped: Motif;
    base: Motif | null; current: Motif | null; alt: Motif | null; source: Source; distance: number; restUntil: number;
    morph: { from: Motif; to: Motif; frac: number } | null;
  };
  stabs: { main: number[][]; contrast: number[][]; current: number[][] };
  pad: { main: PadMode; contrast: PadMode; current: PadMode };
  harmony: { center: number; away: number; loopA: ProgramChord[]; loopB: ProgramChord[]; vampA: [number, number]; vampB: [number, number] };
  sectionsVisited: { label: string; role: Role; start: number }[];
  log: string[];
}

const STAB_PATTERNS: Record<'dub' | 'micro', number[][][]> = {
  dub: [[[2], [2, 10]], [[2], [2]], [[3], [11]], [[2, 7], [2]], [[6], [6, 14]], [[2, 10], [2, 10, 14]], [[2], [10]]],
  micro: [[[2, 8, 13]], [[2, 10], [6]], [[3, 7, 11]], [[2, 6], [2, 14]], [[0, 10], [6]]],
};

export class Composer {
  settings: CompositionSettings;
  params: ParamSet;
  style!: StyleDef;
  bar = 0;

  /** settings.seed with the profile variant folded in; every random stream keys on this */
  private seed = 0;
  /** a variant (or arrangement length) change that arrived mid-piece, applied at the next phrase boundary */
  private pendingVariant: number | null = null;
  private pendingReplan = false;
  private grid!: Grid;
  private phraseBars = 8;
  private blueprint = '';
  private plan: PlannedSection[] = [];
  private forms = new Map<number, FormEntry[]>();
  private cycle = 0;
  private sec!: PlannedSection;
  private landing = false;
  private mem!: Memory;
  private program: ProgramChord[] = [];
  private chord!: ChordState;
  private padVoicing: number[] | null = null;
  private padInversion = 0;
  private layers!: Record<Layer, LayerState>;
  private pendingLayers: { layer: Layer; on: boolean }[] = [];
  private energy = 0.4;
  private drumDensity = 0;
  private percLen = 16;
  private percRot = 0;
  private dropUntil = -1;
  private forceArticulation = false;
  /** how a finite piece ends: dissolving to a sustained tonic chord, or the band landing on one final hit */
  private ending: 'none' | 'resolve' | 'button' = 'none';
  private melodyCache: { key: string; notes: number[] } | null = null;

  constructor(settings: Partial<CompositionSettings> = {}, params: ParamSet = neutralParams()) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.params = params;
    this.init();
  }

  // ------------------------------------------------------------ public API

  /** Settings change: musical identity changes take effect from the next bar. */
  setSettings(partial: Partial<CompositionSettings>) {
    const prev = this.settings;
    this.settings = { ...prev, ...partial };
    const rebuild = partial.style !== undefined && partial.style !== prev.style
      || partial.seed !== undefined && partial.seed !== prev.seed
      || partial.beatsPerBar !== undefined && partial.beatsPerBar !== prev.beatsPerBar;
    if (rebuild || 'variant' in partial && this.bar === 0 && (partial.variant ?? 0) !== (prev.variant ?? 0)) {
      this.pendingVariant = null;
      this.rebuildAt(this.bar);
      return;
    }
    if ('variant' in partial) {
      // a new profile mid-piece: finish the current phrase, re-key at the next boundary
      const next = partial.variant ?? 0;
      this.settings = { ...this.settings, variant: prev.variant };
      this.pendingVariant = next === (prev.variant ?? 0) ? null : next;
    }
    if (partial.arrangementBars !== undefined && partial.arrangementBars !== prev.arrangementBars) {
      if (this.bar === 0) { this.rebuildAt(0); return; }
      this.pendingReplan = true;
    }
    if (partial.key !== undefined || partial.scale !== undefined) {
      this.chord = this.makeChord(this.chord.degree, this.chord.startBar, this.chord.bars);
      this.padVoicing = null;
      this.melodyCache = null;
    }
    if (partial.autonomous === false && prev.autonomous) this.fillLayersStatic();
  }

  setParams(params: ParamSet) { this.params = params; }

  /** After a pause, sustained layers (drone, pad) re-articulate on the next bar. */
  rearticulate() { this.forceArticulation = true; }

  reset() {
    if (this.pendingVariant !== null) { this.settings = { ...this.settings, variant: this.pendingVariant }; this.pendingVariant = null; }
    this.pendingReplan = false;
    this.init();
  }

  /** The planned form of the current cycle (for display). */
  get form(): FormEntry[] { return this.forms.get(this.sec?.cycle ?? 0) ?? []; }

  nextBar(): BarPlan {
    let b = this.bar;
    const s = this.settings;
    const development: string[] = [];

    // fades scheduled last bar complete now
    for (const l of LAYERS) if (this.layers[l].fading) { this.layers[l].fading = false; this.layers[l].on = false; }

    if (b > 0 && (this.pendingVariant !== null || this.pendingReplan) && this.isPhraseStart(b)) {
      const variantChanged = this.pendingVariant !== null;
      if (variantChanged) this.settings = { ...this.settings, variant: this.pendingVariant! };
      this.pendingVariant = null;
      this.pendingReplan = false;
      this.rebuildAt(b);
      b = this.bar;
      development.push(variantChanged ? 'New profile · the piece re-keys' : 'New arrangement length · the piece re-plans');
    }

    const sec = this.sectionAt(b);
    // with autonomous evolution off, the fixed arrangement ignores later section starts
    if ((b === sec.start && (s.autonomous || b === 0)) || this.landing) this.enterSection(sec, b, development);
    else if (this.isPhraseStart(b)) this.develop(b, development);
    if (b === this.dropUntil && !this.layers.drums.on) { this.layers.drums.on = true; this.layers.drums.since = b; development.push('Drums return'); }
    const finalBar = s.arrangementBars > 0 && b === s.arrangementBars - 1;
    if (sec.role === 'outro' && this.ending === 'resolve' && s.autonomous && (b - sec.start) % 4 === 0 && !finalBar) this.dissolveStep(b, development);

    this.advanceHarmony(b, development);
    const chord = this.chord;
    if (chord.startBar === b || !this.padVoicing) {
      const lo = 50 + Math.round(this.p('upperPads') * 12);
      this.padVoicing = voiceLead(this.padVoicing, chord.pcs, lo, lo + 21, this.padInversion);
    }

    const events: NoteEvent[] = [];
    const L = this.layers;
    const vMul = (l: Layer) => (L[l].fading ? 0.55 : 1) * L[l].level;
    if (finalBar) this.genEnding(events, vMul);
    else {
      if (L.drone.on) this.genDrone(b, events, vMul('drone'));
      if (L.bass.on) this.genBass(b, events, vMul('bass'));
      if (L.arp.on) this.genMelody(b, events, vMul('arp'));
      if (L.pad.on) this.genPad(b, events, vMul('pad'));
      if (L.drums.on) this.genDrums(b, events, vMul('drums'));
      if (L.perc.on) this.genPerc(b, events, vMul('perc'));
      if (L.texture.on) this.genTexture(b, events, vMul('texture'));
    }
    if (this.isSectionEnd(b) && sec.transition === 'cut' && s.autonomous) {
      // a one-beat hole before the next section: only sustained layers ring through
      const keep: ReadonlySet<Voice> = new Set(['pad', 'drone', 'shimmer', 'click']);
      for (let i = events.length - 1; i >= 0; i--) if (!keep.has(events[i].voice) && events[i].beat >= s.beatsPerBar - 1) events.splice(i, 1);
    }

    this.forceArticulation = false;
    this.applySwing(events);
    events.sort((x, y) => x.beat - y.beat);

    const m = this.mem;
    const plan: BarPlan = {
      index: b,
      beats: s.beatsPerBar,
      bpm: s.bpm,
      section: { index: sec.index, name: sec.label, role: sec.role, bar: b - sec.start, bars: sec.bars, energy: this.energy, cycle: sec.cycle },
      phraseBar: (b - sec.start) % this.phraseBars,
      phraseBars: this.phraseBars,
      blueprint: blueprintLabel(sec.blueprint),
      form: this.forms.get(sec.cycle) ?? [],
      material: {
        groove: grooveLabel(L.drums.on ? m.groove.current : null),
        bass: bassLabel(L.bass.on ? m.bass.current : null),
        melody: L.arp.on && m.melody.restUntil <= b ? this.melodyDescription() : 'no melody',
        grooveId: m.groove.current?.id ?? '-', bassId: m.bass.current?.id ?? '-', melodyId: m.melody.current?.id ?? '-',
      },
      chord: { degree: chord.degree, kind: chord.kind, pcs: chord.pcs, rootPc: chord.rootPc, symbol: chord.symbol },
      padVoicing: [...this.padVoicing],
      layers: Object.fromEntries(LAYERS.map((l) => [l, { on: L[l].on && !L[l].fading, level: L[l].level, timbre: L[l].timbre, filter: L[l].filter, pan: L[l].pan }])) as Record<Layer, LayerSnapshot>,
      events,
      development,
      final: s.arrangementBars > 0 && b === s.arrangementBars - 1,
    };
    if (development.length) { m.log.push(...development.map((d) => `${b + 1}: ${d}`)); if (m.log.length > 400) m.log.splice(0, m.log.length - 400); }
    this.bar = b + 1;
    return plan;
  }

  // -------------------------------------------------------------- set-up

  private ctl(k: 'grooveDiversity' | 'structure' | 'motifEvolution'): number { return clamp01(this.settings[k] ?? 0.5); }

  private init() {
    const s = this.settings;
    this.style = STYLES[s.style];
    this.seed = s.variant ? hash(s.seed, 'variant', s.variant) : s.seed;
    this.grid = gridFor(s.beatsPerBar);
    this.bar = 0;
    this.padVoicing = null;
    this.padInversion = 0;
    this.drumDensity = 0;
    this.dropUntil = -1;
    this.pendingLayers = [];
    this.melodyCache = null;
    this.landing = false;
    const r = stream(this.seed, 'plan', s.style);
    this.phraseBars = choosePhraseBars(s.style, r, s.arrangementBars);
    this.blueprint = chooseBlueprint(s.style, this.ctl('structure'), r);
    this.percLen = pick(r, [16, 16, 12, 6]);
    this.percRot = intBetween(r, 0, 3);
    const buttonP: Record<string, number> = { krautJam: 0.6, additive: 0.4, twoPart: 0.3, hypnotic: 0.3, berlinDev: 0.2 };
    this.ending = s.arrangementBars > 0 ? (chance(stream(this.seed, 'ending', s.style), buttonP[this.blueprint] ?? 0) ? 'button' : 'resolve') : 'none';
    this.buildMemory();
    this.plan = [];
    this.forms = new Map();
    this.cycle = 0;
    this.planCycle(0);
    this.sec = this.plan[0];
    this.layers = Object.fromEntries(LAYERS.map((l) => [l, { on: false, since: 0, fading: false, level: 1, timbre: 0, filter: 0, pan: 0 }])) as Record<Layer, LayerState>;
    this.energy = this.sec.energy[0];
    this.program = [{ degree: this.mem.harmony.center, start: 0, bars: 4 }];
    this.chord = this.makeChord(this.mem.harmony.center, 0, 4);
  }

  /** Builds the material bank: the composition's identity. */
  private buildMemory() {
    const s = this.settings;
    const st = this.style;
    const g = this.grid;
    const div = this.ctl('grooveDiversity');
    const structure = this.ctl('structure');

    const rg = stream(this.seed, 'groove');
    const mainG = makeGroove(st.drums, g, rg, div);
    let contrastG: Groove | null = null;
    if (mainG) {
      contrastG = chance(rg, 0.3 + 0.6 * div) ? makeGroove(st.drums, g, rg, Math.max(div, 0.5), mainG.archetype) : null;
      if (!contrastG) {
        const ops = shuffle(rg, (['half', 'kick', 'accent', 'perc', 'answer', 'openhat'] as GrooveOp[]).filter((o) => !(o === 'half' && mainG.halfTime)));
        contrastG = varyGroove(varyGroove(mainG, ops[0], g, rg), ops[1], g, rg);
      }
    }

    const rb = stream(this.seed, 'bass');
    const cxBass = clamp01(0.7 * s.complexity + 0.3 * this.p('rhythmicDetail'));
    const bassMain = makeBass(st.bass, g, rb, { cx: cxBass, diversity: div, kickDensity: kickDensity(mainG, s.beatsPerBar), kicks: kickSteps(mainG) });
    const bassContrast = chance(rb, 0.35 + 0.55 * structure)
      ? makeBass(st.bass, g, rb, { cx: cxBass, diversity: Math.max(div, 0.5), kickDensity: kickDensity(contrastG, s.beatsPerBar), kicks: kickSteps(contrastG), exclude: bassMain.archetype })
      : mutateBass(mutateBass(bassMain, 'answer', g, rb, cxBass), 'contour', g, rb, cxBass);

    const rm = stream(this.seed, 'melody');
    const primary = this.makePrimary(rm);
    const secondary = this.makeSecondary(rm, primary);

    const rs = stream(this.seed, 'stabs');
    const stabFam = s.style === 'microhouse' ? STAB_PATTERNS.micro : STAB_PATTERNS.dub;
    const stabMain = pick(rs, stabFam);
    const stabContrast = pick(rs, stabFam.filter((p) => p !== stabMain));
    const padContrast: PadMode = st.pad === 'sustain' && chance(rs, 0.25 + 0.6 * structure) ? 'pulse' : st.pad;

    const rh = stream(this.seed, 'harmony');
    const h = st.harmony;
    const away = weighted(rh, h.moves[0] ?? [[3, 1]]);
    const otherAway = weighted(rh, (h.moves[away] ?? h.moves[0]).filter(([d]) => d !== away && d !== 0).concat([[away === 3 ? 5 : 3, 0.5]]));
    this.mem = {
      groove: { original: mainG, main: mainG, contrast: contrastG, base: mainG, current: mainG },
      bass: { original: bassMain, main: bassMain, contrast: bassContrast, base: bassMain, current: bassMain, distance: 0 },
      melody: {
        primary, developed: primary, secondary, secondaryDeveloped: secondary,
        base: primary, current: primary, alt: null, source: 'primary', distance: 0, restUntil: -1, morph: null,
      },
      stabs: { main: stabMain, contrast: stabContrast, current: stabMain },
      pad: { main: st.pad, contrast: padContrast, current: st.pad },
      harmony: {
        center: 0, away,
        loopA: this.makeLoop(rh, 0), loopB: this.makeLoop(rh, away),
        vampA: [0, away], vampB: [away, otherAway],
      },
      sectionsVisited: [],
      log: [],
    };
  }

  private makePrimary(r: Rng): Motif {
    const s = this.settings;
    const st = this.style;
    const cx = this.melodyCx();
    const g = this.grid;
    const arp = () => makeArp(g, r, { mode: st.arp, cx, density: s.density, octaves: st.arpDefaults.octaves });
    switch (st.arp) {
      case 'sequence': return arp();
      case 'evolving': return chance(r, s.style === 'motorik' ? 0.6 : 0.45) ? arp() : makeMelody(g, r, { cx, density: s.density, sparse: false, slow: false });
      case 'sparse': return chance(r, 0.6) ? makeMelody(g, r, { cx, density: s.density, sparse: true, slow: false }) : arp();
      case 'constellation': return makeMelody(g, r, { cx, density: s.density, sparse: true, slow: true });
    }
  }

  /** A contrasting motif: a different kind, density or register from the primary one. */
  private makeSecondary(r: Rng, primary: Motif): Motif {
    const s = this.settings;
    const st = this.style;
    const cx = this.melodyCx();
    const g = this.grid;
    const dense = motifDensity(primary, s.beatsPerBar) > 1.2;
    let m: Motif;
    if (st.arp === 'constellation') {
      m = makeMelody(g, r, { cx, density: s.density, sparse: true, slow: true });
      m = transformMotif(m, chance(r, 0.5) ? 'invert' : 'retrograde', g, r);
    } else if (primary.kind === 'arp') {
      m = makeMelody(g, r, { cx, density: s.density, sparse: dense, slow: false });
    } else if (st.arp === 'sparse') {
      m = chance(r, 0.5) ? makeArp(g, r, { mode: 'sparse', cx, density: s.density, octaves: st.arpDefaults.octaves })
        : makeMelody(g, r, { cx, density: s.density, sparse: true, slow: false, exclude: primary.label.includes('riff') ? 'riff' : 'call and response' });
    } else {
      m = makeArp(g, r, { mode: st.arp, cx, density: s.density, octaves: st.arpDefaults.octaves });
    }
    // a different register, but never shrill: styles that already sit high move the answer down
    const up = st.arpDefaults.register < 62;
    return { ...m, octave: primary.octave !== 0 ? 0 : up ? pick(r, [1, 0, 1]) : pick(r, [0, -1]) };
  }

  private melodyCx() { return clamp01(0.5 * this.settings.complexity + 0.6 * this.p('arpComplexity')); }

  /** A harmonic loop (for "home" or "away") from the style's chord-movement table. */
  private makeLoop(r: Rng, start: number): ProgramChord[] {
    const h = this.style.harmony;
    const hm = this.settings.harmonicMovement;
    const len = h.mode === 'progression' ? intBetween(r, 3, 4) : h.mode === 'field' ? intBetween(r, 2, 3) : 2;
    const loop: ProgramChord[] = [];
    let deg = start;
    let at = 0;
    for (let i = 0; i < len; i++) {
      const bars = this.chordBars(r);
      loop.push({ degree: deg, start: at, bars });
      at += bars;
      const moveP = h.moveChance * (0.4 + 1.2 * hm);
      let next = chance(r, moveP) || h.mode === 'progression' ? weighted(r, h.moves[deg] ?? h.moves[0]) : deg;
      if (next === deg) next = weighted(r, h.moves[deg] ?? h.moves[0]);
      deg = next;
    }
    return loop;
  }

  /** Bars a chord lasts, a power of two inside the style's range; more harmonic movement → shorter. */
  private chordBars(r: Rng): number {
    const h = this.style.harmony;
    const opts: number[] = [];
    for (let v = 1; v <= 32; v *= 2) if (v >= h.barsPerChord[0] && v <= h.barsPerChord[1]) opts.push(v);
    const idx = Math.min(opts.length - 1, Math.floor((1 - this.settings.harmonicMovement) * opts.length));
    return opts[chance(r, 0.7) ? idx : intBetween(r, 0, opts.length - 1)] ?? 4;
  }

  // -------------------------------------------------------------- planning

  private planCycle(k: number) {
    const s = this.settings;
    const structure = this.ctl('structure');
    const start = this.plan.length ? this.plan[this.plan.length - 1].start + this.plan[this.plan.length - 1].bars : 0;
    let specs: SectionSpec[];
    let bp: string;
    if (!s.autonomous) {
      // fixed arrangement: one section on the main material, for as long as the piece lasts
      bp = 'fixed';
      specs = [{ role: 'main', label: 'Main groove', phrases: 1, energy: [0.62, 0.62], groove: 'main', bass: 'main', melody: 'primary', harmony: 'home', dev: 'restrain', transition: 'none', priority: 10 }];
      const bars = s.arrangementBars > 0 ? s.arrangementBars : 1 << 30;
      this.plan.push({ ...specs[0], index: this.plan.length, start, bars, cycle: k, blueprint: bp });
      this.forms.set(k, [{ label: specs[0].label, role: 'main', start, bars }]);
      return;
    }
    const r = stream(this.seed, 'cycle', k);
    const finite = s.arrangementBars > 0;
    if (k === 0) bp = this.blueprint;
    else bp = chooseBlueprint(s.style, structure, r, chance(r, 0.4 + 0.4 * structure) ? this.plan[this.plan.length - 1]?.blueprint : undefined);
    // blueprint lengths are in eight-bar blocks; convert them to this piece's phrases
    specs = blueprintSections(bp, r, structure).map((x) => ({ ...x, phrases: Math.max(1, Math.round((x.phrases * 8) / this.phraseBars)) }));
    if (finite) specs = fitSections(specs, Math.max(2, Math.floor(s.arrangementBars / this.phraseBars)));
    else {
      specs = specs.filter((x) => x.role !== 'outro' && (k === 0 || x.role !== 'intro'));
      if (k > 0 && !specs.some((x) => x.role === 'return')) {
        specs.push({ role: 'return', label: 'Return', phrases: 2, energy: [0.62, 0.62], groove: 'main', bass: 'main', melody: 'primary', harmony: 'home', dev: 'restate', transition: 'none', priority: 9 });
      }
    }
    let at = start;
    const form: FormEntry[] = [];
    specs.forEach((x, i) => {
      let bars = x.phrases * this.phraseBars;
      if (finite && i === specs.length - 1) bars = Math.max(1, s.arrangementBars - at);
      this.plan.push({ ...x, index: this.plan.length, start: at, bars, cycle: k, blueprint: bp });
      form.push({ label: x.label, role: x.role, start: at, bars });
      at += bars;
    });
    this.forms.set(k, form);
    if (k > 0) this.newGeneration(k);
  }

  /** Endless pieces: each new cycle keeps the identity and brings related new material. */
  private newGeneration(k: number) {
    const m = this.mem;
    const g = this.grid;
    const r = stream(this.seed, 'generation', k);
    const evo = this.ctl('motifEvolution');
    const div = this.ctl('grooveDiversity');
    const st = this.style;
    if (m.groove.original) {
      m.groove.main = chance(r, 0.55 - 0.35 * evo) ? m.groove.original : varyGroove(m.groove.original, pick(r, ['kick', 'accent', 'openhat', 'answer', 'perc'] as GrooveOp[]), g, r);
      m.groove.contrast = chance(r, 0.25 + 0.5 * div)
        ? makeGroove(st.drums, g, r, Math.max(div, 0.5), m.groove.original.archetype) ?? m.groove.contrast
        : m.groove.contrast && varyGroove(m.groove.contrast, pick(r, ['kick', 'accent', 'half', 'busy'] as GrooveOp[]), g, r);
    }
    const cx = this.settings.complexity;
    m.bass.main = chance(r, 0.5 - 0.3 * evo) ? m.bass.original : mutateBass(m.bass.original, chance(r, 0.5) ? 'related' : pickBassOp(r, evo), g, r, cx);
    m.bass.contrast = chance(r, 0.5) ? makeBass(st.bass, g, r, { cx, diversity: Math.max(div, 0.5), kickDensity: kickDensity(m.groove.contrast, this.settings.beatsPerBar), kicks: kickSteps(m.groove.contrast), exclude: m.bass.original.archetype })
      : mutateBass(m.bass.contrast, pickBassOp(r, evo), g, r, cx);
    const prevSecondary = m.melody.secondary;
    m.melody.secondary = this.makeSecondary(r, m.melody.primary);
    m.melody.secondaryDeveloped = m.melody.secondary;
    // the developed primary drifts to a related form; a gradual morph links the old secondary to the new one
    m.melody.developed = transformMotif(m.melody.primary, pick(r, ['transpose', 'invert', 'retrograde', 'displace'] as const), g, r);
    if (chance(r, 0.3 + 0.5 * evo)) m.melody.morph = { from: prevSecondary, to: m.melody.secondary, frac: 0 };
    m.stabs.contrast = pick(r, (this.settings.style === 'microhouse' ? STAB_PATTERNS.micro : STAB_PATTERNS.dub).filter((p) => p !== m.stabs.main));
  }

  private sectionAt(b: number): PlannedSection {
    while (b >= this.plan[this.plan.length - 1].start + this.plan[this.plan.length - 1].bars) this.planCycle(++this.cycle);
    if (this.sec && b >= this.sec.start && b < this.sec.start + this.sec.bars) return this.sec;
    for (let i = this.plan.length - 1; i >= 0; i--) if (this.plan[i].start <= b) { this.sec = this.plan[i]; break; }
    return this.sec;
  }

  private isPhraseStart(b: number) {
    const sec = this.sectionAt(b);
    return (b - sec.start) % this.phraseBars === 0;
  }

  private isSectionEnd(b: number) { return b === this.sec.start + this.sec.bars - 1; }

  private rebuildAt(b: number) {
    this.init();
    this.bar = b;
    // mid-piece, a new style or profile lands in its core arrangement rather than restarting a sparse intro
    if (b > 0) {
      this.landing = true;
      this.sectionAt(b);
      this.energy = Math.max(0.55, this.sec.energy[0]);
    }
  }

  // -------------------------------------------------------------- helpers

  private p(id: keyof ParamSet) { return this.params[id] ?? 0.5; }

  /** Style affinity adjusted by user controls and data-driven parameters. */
  private affinity(l: Layer): number {
    const base = this.style.affinity[l];
    if (base <= 0) return 0;
    if (l === 'drone') return clamp01(base * (0.5 + this.settings.droneIntensity));
    if (l === 'perc') return clamp01(base * (0.5 + this.p('percComplexity')) + 0.15 * this.p('percTransients'));
    if (l === 'drums') return clamp01(base * (0.6 + 0.6 * this.settings.rhythmIntensity));
    if (l === 'texture') return clamp01(base * (0.7 + 0.4 * this.p('sparkle')));
    return base;
  }

  private turnOn(l: Layer, b: number) {
    const st = this.layers[l];
    st.on = true; st.fading = false; st.since = b;
  }

  /** Non-autonomous mode (and mid-piece landings): the style's core arrangement. */
  private fillLayersStatic() {
    const threshold = 0.75 - 0.4 * this.settings.density;
    for (const l of LAYERS) if (this.affinity(l) >= threshold) this.turnOn(l, this.bar);
    if (!LAYERS.some((l) => this.layers[l].on)) this.turnOn(this.style.intro[0], this.bar);
    this.pendingLayers = [];
  }

  private tonicPc() { return keyPc(this.settings.key); }

  private mapDegree(deg7: number): number {
    const n = scaleIntervals(harmonyScale(this.settings.scale)).length;
    return n === 7 ? deg7 : Math.round((deg7 * n) / 7) % n;
  }

  /** Chord kinds are fixed per degree for the whole piece, so a chord keeps its colour when it returns. */
  private kindFor(degree: number): ChordKind {
    return weighted(stream(this.seed, 'kind', degree), this.style.harmony.kinds);
  }

  private makeChord(degree: number, startBar: number, bars: number): ChordState {
    const kind = this.kindFor(degree);
    const pcs = colourChord(this.tonicPc(), this.settings.scale, this.mapDegree(degree), kind);
    return { degree, kind, pcs, rootPc: pcs[0], symbol: chordSymbol(pcs), startBar, bars };
  }

  private snapToScale(m: number): number {
    const sc = this.settings.scale;
    if (inScale(m, this.tonicPc(), sc)) return m;
    for (const d of [-1, 1, -2, 2]) if (inScale(m + d, this.tonicPc(), sc)) return m + d;
    return m;
  }

  private bassRoot(pc: number) { return 33 + ((pc - 9 + 12) % 12); } // A1..G#2

  private cap(l: string) { return l[0].toUpperCase() + l.slice(1); }

  // -------------------------------------------------------------- harmony

  /** The chord program of a section. A finite piece's last bar always comes home to the tonic. */
  private buildProgram(sec: PlannedSection): ProgramChord[] {
    const out = this.sectionProgram(sec);
    const total = this.settings.arrangementBars;
    if (total <= 0 || sec.start + sec.bars < total || sec.bars < 2) return out;
    const last = total - 1 - sec.start;
    const head = out.filter((c) => c.start < last).map((c) => ({ ...c, bars: Math.min(c.bars, last - c.start) }));
    return [...head, { degree: this.mem.harmony.center, start: last, bars: 1 }];
  }

  /** The chord program of a section, built from its harmonic behaviour. */
  private sectionProgram(sec: PlannedSection): ProgramChord[] {
    const h = this.style.harmony;
    const hm = this.settings.harmonicMovement;
    const mh = this.mem.harmony;
    const r = stream(this.seed, 'program', sec.index);
    const staticMode = h.mode === 'static' || h.mode === 'drone';
    let goAway = sec.harmony === 'away';
    if (staticMode && goAway) goAway = chance(r, hm * 1.2);
    if (staticMode) {
      let degree = goAway ? mh.away : mh.center;
      if (sec.harmony === 'move' && chance(r, hm * h.moveChance * 1.5)) degree = weighted(r, h.moves[mh.center] ?? h.moves[0]);
      return [{ degree, start: 0, bars: sec.bars }];
    }
    if (h.mode === 'vamp') {
      const pair = goAway ? mh.vampB : mh.vampA;
      const per = this.settings.harmonicMovement > 0.5 ? 1 : 2;
      const out: ProgramChord[] = [];
      for (let at = 0, i = 0; at < sec.bars; at += per, i++) out.push({ degree: pair[i % 2], start: at, bars: Math.min(per, sec.bars - at) });
      return out;
    }
    // progression / field: loop A at home, loop B away, a fresh walk on "move" with a faster harmonic rhythm
    let loop = goAway ? mh.loopB : mh.loopA;
    if (sec.harmony === 'move') loop = this.makeLoop(r, mh.center).map((c) => ({ ...c, bars: Math.max(1, c.bars / 2) }));
    const out: ProgramChord[] = [];
    let at = 0;
    for (let i = 0; at < sec.bars && i < 512; i++) {
      const c = loop[i % loop.length];
      const bars = Math.min(c.bars, sec.bars - at);
      out.push({ degree: c.degree, start: at, bars });
      at += bars;
    }
    return out;
  }

  private advanceHarmony(b: number, dev: string[]) {
    const rel = b - this.sec.start;
    const pc = this.program.find((c) => rel >= c.start && rel < c.start + c.bars);
    if (!pc || pc.start !== rel) return;
    const prev = this.chord.symbol;
    this.chord = this.makeChord(pc.degree, b, pc.bars);
    if (this.chord.symbol !== prev && b > 0) dev.push(`Harmony moves ${prev} → ${this.chord.symbol}`);
  }

  private nextChordRootPc(b: number): number | null {
    const rel = b + 1 - this.sec.start;
    if (rel >= this.sec.bars) return null;
    const pc = this.program.find((c) => c.start === rel);
    if (!pc || pc.degree === this.chord.degree) return null;
    return colourChord(this.tonicPc(), this.settings.scale, this.mapDegree(pc.degree), this.kindFor(pc.degree))[0];
  }

  // -------------------------------------------------------------- sections

  private resolveGroove(ref: SectionSpec['groove'], sec: PlannedSection): Groove | null {
    const m = this.mem.groove;
    const g = this.grid;
    const r = stream(this.seed, 'secGroove', sec.index);
    const main = sec.role === 'return' ? m.original : m.main;
    if (!main) return null;
    const div = this.ctl('grooveDiversity');
    switch (ref) {
      case 'main': return main;
      case 'var': return varyGroove(main, weighted(r, [['kick', 1 + div], ['accent', 1], ['openhat', 1], ['answer', 1], ['busy', 0.8], ['perc', 0.6 + div]] as [GrooveOp, number][]), g, r);
      case 'busy': return varyGroove(main, 'busy', g, r);
      case 'thin': return varyGroove(main, 'thin', g, r);
      case 'half': return varyGroove(main, 'half', g, r);
      case 'contrast': return m.contrast ?? main;
      case 'contrastVar': return varyGroove(m.contrast ?? main, pick(r, ['kick', 'accent', 'busy', 'answer'] as GrooveOp[]), g, r);
      case 'none': return null;
    }
  }

  private resolveBass(ref: SectionSpec['bass'], sec: PlannedSection): BassMotif | null {
    const m = this.mem.bass;
    const g = this.grid;
    const r = stream(this.seed, 'secBass', sec.index);
    const main = sec.role === 'return' ? m.original : m.main;
    const cx = this.settings.complexity;
    switch (ref) {
      case 'main': return main;
      case 'var': return mutateBass(main, pickBassOp(r, this.ctl('motifEvolution')), g, r, cx);
      case 'contrast': return m.contrast;
      case 'contrastVar': return mutateBass(m.contrast, pickBassOp(r, this.ctl('motifEvolution')), g, r, cx);
      case 'sustain': return mutateBass(main, 'sustain', g, r, cx);
      case 'none': return null;
    }
  }

  private setMelody(ref: SectionSpec['melody'], sec: PlannedSection) {
    const m = this.mem.melody;
    const g = this.grid;
    const r = stream(this.seed, 'secMelody', sec.index);
    m.alt = null;
    switch (ref) {
      case 'primary': m.current = m.primary; m.developed = sec.cycle === 0 ? m.primary : m.developed; m.source = 'primary'; m.distance = 0; break;
      case 'primaryDev': m.current = m.developed; m.source = 'primary'; break;
      case 'secondary': m.current = m.secondary; m.secondaryDeveloped = m.secondary; m.source = 'secondary'; m.distance = 0; break;
      case 'secondaryDev': m.current = m.secondaryDeveloped; m.source = 'secondary'; break;
      case 'both': m.current = m.developed; m.alt = m.secondaryDeveloped; m.source = 'primary'; break;
      case 'fragment': m.current = transformMotif(m.primary, 'fragment', g, r); m.source = 'other'; break;
      case 'augment': m.current = transformMotif(m.primary, 'augment', g, r); m.source = 'other'; break;
      case 'none': m.current = null; m.source = 'other'; break;
    }
    m.base = m.current;
    m.restUntil = -1;
  }

  private enterSection(sec: PlannedSection, b: number, dev: string[]) {
    const s = this.settings;
    const m = this.mem;
    const landing = this.landing;
    this.landing = false;
    // a mid-piece landing inside an intro uses the main material instead
    const spec: PlannedSection = landing && (sec.role === 'intro' || sec.groove === 'none' || sec.melody === 'none')
      ? { ...sec, groove: 'main', bass: 'main', melody: 'primary' } : sec;
    const before = { groove: m.groove.current?.id, bass: m.bass.current?.id, melody: m.melody.current?.id };
    m.groove.base = m.groove.current = this.resolveGroove(spec.groove, spec);
    m.bass.base = m.bass.current = this.resolveBass(spec.bass, spec);
    if (spec.bass === 'main' || spec.bass === 'contrast') m.bass.distance = 0;
    this.setMelody(spec.melody, spec);
    const contrasting = spec.role === 'contrast' || spec.groove === 'contrast' || spec.groove === 'contrastVar';
    m.stabs.current = contrasting ? m.stabs.contrast : m.stabs.main;
    m.pad.current = contrasting ? m.pad.contrast : m.pad.main;
    this.drumDensity = spec.role === 'peak' ? 1 : spec.role === 'breakdown' || spec.role === 'outro' ? -1 : 0;
    this.program = this.buildProgram(spec);
    this.energy = clamp01(spec.energy[0]);
    // a breakdown should feel lighter: held bass notes carry more low end than the line they replace
    const light = spec.role === 'breakdown';
    this.layers.bass.level = light ? 0.6 : 1;
    this.layers.drone.level = light ? 0.8 : 1;
    m.sectionsVisited.push({ label: spec.label, role: spec.role, start: b });

    if (b > 0 || sec.cycle > 0) dev.push(`New section: ${spec.label} — ${ROLE_TEXT[spec.role]}`);
    if (landing) {
      for (const l of LAYERS) this.layers[l].on = false;
      this.fillLayersStatic();
      this.applyTargets(spec, b, dev, 99, true);
      return;
    }
    if (!s.autonomous) { this.fillLayersStatic(); return; }
    if (b > 0) {
      if (m.groove.current?.id !== before.groove) dev.push(`Groove: ${grooveLabel(m.groove.current)}`);
      if (m.bass.current?.id !== before.bass) dev.push(`Bass: ${bassLabel(m.bass.current)}`);
      if (m.melody.current?.id !== before.melody) dev.push(`Melody: ${this.melodyDescription()}`);
    }
    const maxNow = spec.role === 'intro' ? (s.density >= 0.4 ? 2 : 1) + (s.density > 0.8 ? 1 : 0)
      : ['breakdown', 'return', 'peak', 'contrast', 'main'].includes(spec.role) ? 4 : 2;
    this.applyTargets(spec, b, dev, maxNow - (this.p('transitionSmoothness') > 0.75 ? 1 : 0), false);
  }

  /** The layers a section wants: those its material implies, its featured layers, then by energy and affinity. */
  private targets(sec: PlannedSection): { want: Set<Layer>; off: Set<Layer> } {
    const s = this.settings;
    const m = this.mem;
    const want = new Set<Layer>();
    const off = new Set<Layer>();
    const aff = (l: Layer) => this.affinity(l) > 0.05;
    if (!m.groove.current) off.add('drums'); else if (aff('drums')) want.add('drums');
    if (!m.bass.current) off.add('bass'); else if (aff('bass')) want.add('bass');
    if (!m.melody.current) off.add('arp'); else if (aff('arp')) want.add('arp');
    if (m.groove.current?.perc && aff('drums')) want.add('perc');
    for (const f of sec.feature ?? []) if (aff(f)) want.add(f);
    // an outro dissolves what is already playing, one layer per phrase, sustained layers last
    if (sec.role === 'outro') for (const l of LAYERS) if (this.layers[l].on && !this.layers[l].fading && !off.has(l)) want.add(l);
    const affine = LAYERS.filter((l) => aff(l));
    const e = (sec.energy[0] + sec.energy[1]) / 2;
    const count = sec.role === 'outro' ? want.size : sec.role === 'peak' ? affine.length : Math.max(1, Math.min(affine.length, Math.round(1 + e * affine.length * (0.55 + 0.6 * s.density))));
    for (const l of [...affine].sort((a, b2) => this.affinity(b2) - this.affinity(a))) {
      if (want.size >= count) break;
      if (!off.has(l)) want.add(l);
    }
    if (sec.role === 'breakdown') { off.add('drums'); want.delete('drums'); if (sec.groove !== 'none' && aff('perc')) want.add('perc'); }
    return { want, off };
  }

  private applyTargets(sec: PlannedSection, b: number, dev: string[], maxNow: number, silent: boolean) {
    const L = this.layers;
    const { want, off } = this.targets(sec);
    const isOn = (l: Layer) => L[l].on && !L[l].fading;
    const order = sec.role === 'intro' ? this.style.intro : LAYERS;
    const forced: { layer: Layer; on: boolean }[] = [];
    const optional: { layer: Layer; on: boolean }[] = [];
    for (const l of order) {
      if (want.has(l) && !isOn(l)) (l === 'drums' || l === 'bass' || l === 'arp' ? forced : optional).push({ layer: l, on: true });
    }
    for (const l of LAYERS) {
      if (isOn(l) && off.has(l)) forced.push({ layer: l, on: false });
      else if (isOn(l) && !want.has(l)) optional.push({ layer: l, on: false });
    }
    const all = sec.role === 'intro' ? [...optional, ...forced].sort((a, z) => order.indexOf(a.layer) - order.indexOf(z.layer)) : [...forced, ...optional];
    // a bar is never empty: something enters before anything leaves
    if (!LAYERS.some(isOn)) all.sort((a, z) => Number(z.on) - Number(a.on));
    const now = all.slice(0, Math.max(1, maxNow));
    this.pendingLayers = all.slice(now.length);
    for (const c of now) this.changeLayer(c, b, silent ? null : dev);
    if (!LAYERS.some(isOn)) { const l = this.style.intro.find((x) => !off.has(x)) ?? this.style.intro[0]; this.turnOn(l, b); if (!silent) dev.push(`${this.cap(l)} enters`); }
  }

  private changeLayer(c: { layer: Layer; on: boolean }, b: number, dev: string[] | null) {
    const st = this.layers[c.layer];
    if (c.on) { if (st.on && !st.fading) return; this.turnOn(c.layer, b); dev?.push(`${this.cap(c.layer)} enters`); }
    else { if (!st.on || st.fading) return; st.fading = true; dev?.push(`${this.cap(c.layer)} drops out`); }
  }

  // ---------------------------------------------------------- development

  /** Phrase-level decisions inside a section. What kind depends on the section's role. */
  private develop(b: number, dev: string[]) {
    const s = this.settings;
    const sec = this.sec;
    const phraseIdx = Math.floor((b - sec.start) / this.phraseBars);
    const progress = (b - sec.start) / Math.max(1, sec.bars);
    this.energy = clamp01(sec.energy[0] + (sec.energy[1] - sec.energy[0]) * progress);
    if (!s.autonomous) return;
    const r = stream(this.seed, 'develop', b);
    const m = this.mem;
    const L = this.layers;
    const g = this.grid;
    const evo = this.ctl('motifEvolution');
    const mut = 0.6 + 0.8 * this.p('melodicMutation');
    const smooth = this.p('transitionSmoothness');
    const active = () => LAYERS.filter((l) => L[l].on && !L[l].fading);
    const changed = new Set<string>();
    let events = 0;

    // staged layer changes left over from the section start come first, one per phrase
    if (this.pendingLayers.length) {
      const c = this.pendingLayers.shift()!;
      this.changeLayer(c, b, dev);
      changed.add(c.layer);
      events++;
    }
    // a resting melody comes back
    if (m.melody.restUntil === b) { dev.push('Melody returns after resting'); changed.add('arp'); }

    const capDist = 1 + Math.round(evo * 5);
    type Ev = { id: string; w: number; tag: string; run: () => string | null };
    const evs: Ev[] = [];
    const mode = sec.dev;
    const W = (x: Partial<Record<string, number>>, id: string) => x[id] ?? 0;
    const table: Record<string, Partial<Record<string, number>>> = {
      restrain: { grooveOp: 0.5, bass: 0.5 * (0.3 + evo), melody: 0.7 * (0.3 + evo), rest: 0.3, inversion: 1, filter: 1.2, timbre: 0.4, stereo: 0.4, stab: 0.5, layer: 0.6 },
      develop: { grooveOp: 1.2, bass: 1.5, melody: 2, secondary: 0.6, rest: 0.4, morph: 1.5, layer: 1, filter: 1, inversion: 0.6, timbre: 0.6, stereo: 0.3, perc: 0.6, stab: 0.8, drop: 0.3 },
      contrast: { melody: 1.4, bass: 1, grooveOp: 1, layer: 1, filter: 1, inversion: 0.8, stab: 0.8, timbre: 0.5, morph: 0.8 },
      strip: { remove: 2.5, filterClose: 1.5, rest: 0.8, inversion: 0.5 },
      build: { busy: 2, filterOpen: 2, add: 2, bass: 0.6 },
      restate: { inversion: 0.8, filter: 0.6 },
      dissolve: { remove: 4, filterClose: 1 },
    };
    // a resolving outro dissolves on its own four-bar schedule; a "button" ending keeps the band to the last hit
    const T = mode === 'dissolve' ? (this.ending === 'button' ? table.restate : { filterClose: 1 }) : table[mode];

    // ---- rhythm
    if (L.drums.on && m.groove.current) {
      if (W(T, 'grooveOp')) evs.push({ id: 'grooveOp', tag: 'drums', w: W(T, 'grooveOp') * (0.6 + this.ctl('grooveDiversity')), run: () => {
        const ops: [GrooveOp, number][] = mode === 'restrain' ? [['accent', 1], ['openhat', 1], ['answer', 0.8]] : [['kick', 1], ['accent', 1], ['openhat', 0.8], ['answer', 1], ['busy', this.energy > 0.6 ? 1 : 0.2], ['thin', this.energy < 0.5 ? 1 : 0.2], ['perc', 0.5]];
        const op = weighted(r, ops);
        m.groove.current = varyGroove(m.groove.current!, op, g, r);
        return `Groove develops: ${grooveLabel(m.groove.current)}`;
      } });
      if (m.groove.current !== m.groove.base && m.groove.current!.ops.length - (m.groove.base?.ops.length ?? 0) >= 2) evs.push({ id: 'grooveBack', tag: 'drums', w: 1.2, run: () => {
        m.groove.current = m.groove.base;
        return 'The groove settles back into its pattern';
      } });
      if (W(T, 'busy')) evs.push({ id: 'busy', tag: 'drums', w: W(T, 'busy'), run: () => {
        this.drumDensity = Math.min(1, this.drumDensity + 1);
        m.groove.current = varyGroove(m.groove.current!, 'busy', g, r);
        return 'Rhythmic density builds';
      } });
      if (W(T, 'drop') && b > sec.start) evs.push({ id: 'drop', tag: 'drums', w: W(T, 'drop'), run: () => {
        L.drums.on = false; this.dropUntil = b + this.phraseBars;
        return 'Percussion drops out for a phrase';
      } });
    }
    // ---- bass
    if (L.bass.on && m.bass.current && W(T, 'bass')) {
      if (m.bass.distance >= capDist && m.bass.base) evs.push({ id: 'bassBack', tag: 'bass', w: 2.5, run: () => {
        m.bass.current = m.bass.base; m.bass.distance = 0;
        return 'Bass returns to its original motif';
      } });
      else evs.push({ id: 'bass', tag: 'bass', w: W(T, 'bass') * mut, run: () => {
        const op = mode === 'build' ? 'pickup' : pickBassOp(r, evo);
        m.bass.current = mutateBass(m.bass.current!, op, g, r, s.complexity);
        m.bass.distance++;
        if (m.bass.base === m.bass.main || m.bass.base === m.bass.original) m.bass.main = m.bass.current;
        return `Bass: ${BASS_OP_LABEL[op]}`;
      } });
    }
    // ---- melody
    if (L.arp.on && m.melody.current && m.melody.restUntil <= b) {
      if (W(T, 'melody')) {
        if (m.melody.distance >= capDist && m.melody.base) evs.push({ id: 'melodyBack', tag: 'arp', w: 3, run: () => {
          m.melody.current = m.melody.source === 'primary' ? m.melody.primary : m.melody.base; m.melody.distance = 0;
          if (m.melody.source === 'primary') m.melody.developed = m.melody.primary;
          return 'The melody returns to its original shape';
        } });
        else evs.push({ id: 'melody', tag: 'arp', w: W(T, 'melody') * mut, run: () => {
          const op = pickMotifOp(r, evo, m.melody.current!);
          m.melody.current = transformMotif(m.melody.current!, op, g, r);
          m.melody.distance++;
          if (m.melody.source === 'primary') m.melody.developed = m.melody.current;
          if (m.melody.source === 'secondary') m.melody.secondaryDeveloped = m.melody.current;
          return `Melody ${MOTIF_OP_LABEL[op]}`;
        } });
      }
      if (W(T, 'rest') && phraseIdx > 0) evs.push({ id: 'rest', tag: 'arp', w: W(T, 'rest'), run: () => {
        m.melody.restUntil = b + this.phraseBars;
        return 'The melody rests for a phrase';
      } });
      if (W(T, 'secondary') && !m.melody.alt) evs.push({ id: 'secondary', tag: 'arp', w: W(T, 'secondary') * (0.5 + this.ctl('structure')), run: () => {
        m.melody.alt = m.melody.source === 'secondary' ? m.melody.developed : m.melody.secondaryDeveloped;
        return 'A second motif answers the first';
      } });
      if (W(T, 'morph') && m.melody.morph) evs.push({ id: 'morph', tag: 'arp', w: W(T, 'morph'), run: () => {
        const mo = m.melody.morph!;
        mo.frac = Math.min(1, mo.frac + 0.25);
        m.melody.current = morphMotif(mo.from, mo.to, mo.frac, g);
        m.melody.source = 'other';
        if (mo.frac >= 1) { m.melody.morph = null; m.melody.current = mo.to; m.melody.source = 'secondary'; return 'The melody completes its transformation into new material'; }
        return `The melody gradually transforms (${Math.round(mo.frac * 100)} %)`;
      } });
    }
    // ---- arrangement
    const affine = LAYERS.filter((l) => this.affinity(l) > 0.05);
    const { want, off } = this.targets(sec);
    const dwellOk = (l: Layer) => b - L[l].since >= 2 * this.phraseBars || mode === 'dissolve' || mode === 'strip';
    const addable = affine.filter((l) => !L[l].on && !off.has(l));
    const removable = active().filter((l) => dwellOk(l) && (mode === 'dissolve' || !want.has(l) || mode === 'strip'));
    if ((W(T, 'layer') || W(T, 'add')) && addable.length) evs.push({ id: 'add', tag: 'layer', w: (W(T, 'layer') + W(T, 'add')) * (this.energy > 0.55 ? 1.2 : 0.6), run: () => {
      const l = weighted(r, addable.map((c) => [c, this.affinity(c) * (want.has(c) ? 2 : 1)] as const));
      if (changed.has(l)) return null;
      this.turnOn(l, b); changed.add(l);
      if (l === 'perc') { this.percLen = pick(r, [16, 12, 6, 10]); return `A secondary rhythm enters (${this.percLen === 16 ? 'straight' : `${this.percLen}-step cycle against the bar`})`; }
      return `${this.cap(l)} enters`;
    } });
    if ((W(T, 'layer') || W(T, 'remove')) && removable.length && active().length > 1) evs.push({ id: 'remove', tag: 'layer', w: (W(T, 'layer') + W(T, 'remove')) * (this.energy < 0.55 ? 1.2 : 0.5), run: () => {
      // dissolving keeps the sustained layers longest
      const l = weighted(r, removable.map((c) => [c, (c === 'pad' || c === 'drone' ? 0.3 : 1.2) - (mode === 'dissolve' ? 0 : 0.5 * this.affinity(c))] as const));
      if (changed.has(l)) return null;
      L[l].fading = true; changed.add(l);
      return `${this.cap(l)} drops out`;
    } });
    // ---- colour
    if (L.pad.on && W(T, 'inversion')) evs.push({ id: 'inversion', tag: 'pad', w: W(T, 'inversion'), run: () => {
      this.padInversion = (this.padInversion + 1) % 3;
      this.padVoicing = voiceLead(this.padVoicing, this.chord.pcs, 50 + Math.round(this.p('upperPads') * 12), 71 + Math.round(this.p('upperPads') * 12), this.padInversion);
      return 'Pad chord changes inversion';
    } });
    if (L.pad.on && W(T, 'stab') && (m.pad.current === 'stab')) evs.push({ id: 'stab', tag: 'pad', w: W(T, 'stab'), run: () => {
      const pat = m.stabs.current.map((bar) => [...bar]);
      const bi = intBetween(r, 0, pat.length - 1);
      const opts = [2, 3, 6, 7, 10, 11, 14].filter((x) => !pat[bi].includes(x) && x < this.grid.n);
      if (chance(r, 0.5) && pat[bi].length > 1) pat[bi].splice(intBetween(r, 0, pat[bi].length - 1), 1);
      else if (opts.length) pat[bi].push(pick(r, opts));
      m.stabs.current = pat.map((x) => x.sort((a, z) => a - z));
      return 'The chord stab rhythm shifts';
    } });
    const timbreLayers = active().filter((l) => l !== 'perc');
    if (W(T, 'timbre') && timbreLayers.length) evs.push({ id: 'timbre', tag: 'timbre', w: W(T, 'timbre'), run: () => {
      const l = pick(r, timbreLayers);
      if (changed.has(l)) return null;
      L[l].timbre = (L[l].timbre + 1) % 3; changed.add(l);
      return `${this.cap(l)} changes timbre`;
    } });
    const filterLayers = active().filter((l) => l !== 'perc' && l !== 'drums');
    const fw = W(T, 'filter') + W(T, 'filterOpen') + W(T, 'filterClose');
    if (fw && filterLayers.length) evs.push({ id: 'filter', tag: 'filter', w: fw, run: () => {
      const l = pick(r, filterLayers);
      if (changed.has(l)) return null;
      const dir = W(T, 'filterOpen') ? 1 : W(T, 'filterClose') ? -1 : L[l].filter > 0.4 ? -1 : L[l].filter < -0.4 ? 1 : (chance(r, 0.6) ? 1 : -1);
      L[l].filter = Math.max(-0.8, Math.min(0.8, L[l].filter + dir * 0.4)); changed.add(l);
      return `${this.cap(l)} filter slowly ${dir > 0 ? 'opens' : 'closes'}`;
    } });
    if (W(T, 'stereo') && active().length) evs.push({ id: 'stereo', tag: 'stereo', w: W(T, 'stereo'), run: () => {
      const l = pick(r, active());
      if (changed.has(l)) return null;
      L[l].pan = Math.round((r() * 2 - 1) * 60) / 100; changed.add(l);
      return `${this.cap(l)} shifts in the stereo field`;
    } });
    if (W(T, 'perc') && !L.perc.on && this.affinity('perc') > 0.2) evs.push({ id: 'perc', tag: 'perc', w: W(T, 'perc'), run: () => {
      this.turnOn('perc', b);
      this.percLen = pick(r, [16, 12, 6, 10]);
      return `A secondary rhythm enters (${this.percLen === 16 ? 'straight' : `${this.percLen}-step cycle against the bar`})`;
    } });

    let count: number;
    const maxEvents = Math.max(0, 1 + Math.round(s.variation * 2) - Math.round(smooth));
    count = Math.min(maxEvents, weighted(r, [[0, 1 - s.variation * 0.7], [1, 1.5], [2, s.variation], [3, s.variation * 0.6]] as const));
    if (mode === 'restate') count = Math.min(count, 1);
    if ((mode === 'dissolve' || mode === 'strip' || mode === 'build') && count < 1) count = 1;
    count = Math.max(0, count - events);
    // never change everything at once: one change per part per phrase
    const pool = shuffle(r, evs);
    const order: Ev[] = [];
    while (pool.length) {
      const e = weighted(r, pool.map((x) => [x, x.w] as const));
      order.push(e);
      pool.splice(pool.indexOf(e), 1);
    }
    let n = 0;
    let layerMoves = 0;
    for (const e of order) {
      if (n >= count) break;
      if (e.tag === 'layer' && (layerMoves || events)) continue;
      if (changed.has(e.tag)) continue;
      const msg = e.run();
      if (!msg) continue;
      changed.add(e.tag);
      if (e.tag === 'layer') layerMoves++;
      dev.push(msg);
      n++;
    }
    if (!active().length) { const l = this.style.intro[0]; this.turnOn(l, b); dev.push(`${this.cap(l)} enters`); }
  }

  private melodyDescription(): string {
    const m = this.mem.melody;
    if (!m.current) return 'no melody';
    const who = m.source === 'primary' ? (m.current === m.primary ? 'primary motif' : 'primary motif, developed') : m.source === 'secondary' ? 'secondary motif' : 'derived from the primary motif';
    return `${motifLabel(m.current)} · ${who}${m.alt ? ' + answering motif' : ''}`;
  }

  // ------------------------------------------------------------ endings

  /**
   * One step of a resolving outro (every four bars): rhythmic layers leave in
   * order — percussion, texture, drums, bass — paced so they are gone before
   * the last bar; the melody stays to state the theme at the close, and a pad
   * or drone is brought in if nothing sustained would carry the final chord.
   */
  private dissolveStep(b: number, dev: string[]) {
    const sec = this.sec;
    const L = this.layers;
    const lastBar = this.settings.arrangementBars - 1;
    const stepsLeft = Math.max(1, Math.ceil((lastBar - b) / 4));
    const order: Layer[] = ['perc', 'texture', 'drums', 'bass'];
    const toGo = order.filter((l) => L[l].on && !L[l].fading);
    const k = Math.min(2, Math.ceil(toGo.length / stepsLeft));
    if (b === sec.start && k) dev.push('The piece begins to resolve');
    for (const l of toGo.slice(0, k)) this.changeLayer({ layer: l, on: false }, b, dev);
    const sustained = (['pad', 'drone'] as Layer[]).filter((l) => this.affinity(l) > 0.05);
    if (!sustained.some((l) => L[l].on && !L[l].fading) && sustained.length) {
      this.turnOn(sustained[0], b);
      dev.push(`${this.cap(sustained[0])} enters to carry the final chord`);
    }
  }

  /** The last bar of a finite piece: everything still playing lands together on the tonic and rings. */
  private genEnding(ev: NoteEvent[], vMul: (l: Layer) => number) {
    const L = this.layers;
    const beats = this.settings.beatsPerBar;
    const c = this.chord;
    const on = (l: Layer) => L[l].on && !L[l].fading;
    if (on('drums')) {
      ev.push({ voice: 'kick', beat: 0, dur: 0.5, notes: [], vel: 0.9 * vMul('drums'), accent: true });
      ev.push({ voice: 'hatO', beat: 0, dur: 1.2, notes: [], vel: 0.5 * vMul('drums') });
      if (this.ending === 'button') ev.push({ voice: 'clap', beat: 0, dur: 0.2, notes: [], vel: 0.6 * vMul('drums') });
    }
    if (on('bass')) ev.push({ voice: 'bass', beat: 0, dur: beats * 0.95, notes: [this.bassRoot(c.rootPc)], vel: 0.85 * vMul('bass'), accent: true });
    if (on('drone')) {
      const root = this.bassRoot(this.tonicPc());
      ev.push({ voice: 'drone', beat: 0, dur: beats, notes: [...new Set(this.style.droneIntervals.map((i) => this.snapToScale(root + i)))], vel: 0.7 * vMul('drone') });
    }
    if (on('pad') && this.padVoicing) ev.push({ voice: 'pad', beat: 0, dur: beats - 0.05, notes: this.padVoicing, vel: 0.62 * vMul('pad') });
    const m = this.mem.melody.current;
    if (on('arp') && m) {
      // the melody's last word: the tonic (or the chord root) in its own register
      const note = m.kind === 'arp' ? this.arpPool(m).find((x) => x % 12 === c.rootPc) ?? this.arpPool(m)[0] : this.melodyPitch(m, 0, true, -1);
      ev.push({ voice: 'arp', beat: 0, dur: beats * 0.9, notes: [note], vel: 0.7 * vMul('arp'), accent: true });
    }
    if (on('texture')) ev.push({ voice: 'shimmer', beat: 0, dur: beats, notes: c.pcs.slice(0, 2).map((pc) => 84 + pc), vel: 0.3 * vMul('texture') });
  }

  // ------------------------------------------------------------ generators

  private genDrone(b: number, ev: NoteEvent[], lv: number) {
    const c = this.chord;
    const n = this.settings.beatsPerBar;
    const st = this.style;
    const pb = this.phraseBars;
    const rel = b - this.sec.start;
    // re-articulate at chord changes and phrase starts; long notes cross-fade in the voice
    const start = c.startBar === b || rel % pb === 0 || b === this.layers.drone.since || this.forceArticulation;
    if (!start) return;
    const pedal = st.harmony.mode === 'static' || st.harmony.mode === 'drone' || st.harmony.mode === 'vamp';
    const rootPc = pedal ? this.tonicPc() : c.rootPc;
    const root = this.bassRoot(rootPc) + (this.layers.drone.timbre === 2 ? 12 : 0);
    const barsLeft = Math.max(1, Math.min(c.startBar + c.bars - b, pb - (rel % pb), this.sec.start + this.sec.bars - b));
    // intervals snap to the scale (the whole-tone scale has no perfect fifth)
    const notes = [...new Set(st.droneIntervals.map((i) => this.snapToScale(root + i)))];
    if (st.id === 'drone' && c.kind === 'sus2') notes.push(this.snapToScale(root + 14));
    ev.push({ voice: 'drone', beat: 0, dur: barsLeft * n, notes, vel: 0.7 * lv });
  }

  private bassPitch(p: { ct: number; oct: number; step: number }, root: number, iv: number[]): number {
    let note = root + iv[Math.min(p.ct, iv.length - 1)] + 12 * p.oct;
    if (p.step) {
      const sc = this.settings.scale === 'chromatic' ? 'natural_minor' : this.settings.scale;
      const list = scaleNotesInRange(this.tonicPc(), sc, note - 16, note + 16);
      const i = list.indexOf(note);
      if (i >= 0) note = list[Math.max(0, Math.min(list.length - 1, i + p.step))];
    }
    while (note < 28) note += 12;
    while (note > 62) note -= 12;
    return note;
  }

  private genBass(b: number, ev: NoteEvent[], lv: number) {
    const m = this.mem.bass.current;
    if (!m) return;
    const c = this.chord;
    const n = this.grid.n;
    const root = this.bassRoot(c.rootPc);
    const iv = colourChord(this.tonicPc(), this.settings.scale, this.mapDegree(c.degree), 'seventh').map((pc) => (pc - c.rootPc + 12) % 12);
    const art = this.p('rhythmicArticulation');
    const r = stream(this.seed, 'bass', b);
    const nextRoot = this.nextChordRootPc(b);
    const pos = ((b - this.sec.start) % m.bars) * n;
    const notes = m.notes.filter((x) => x.s >= pos && x.s < pos + n);
    const gate = Math.max(0.15, Math.min(1, m.gate * (1.25 - 0.5 * art)));
    notes.forEach((x, i) => {
      let note = this.bassPitch(x.p, root, iv);
      // approach the next chord stepwise through the scale on the final note
      if (nextRoot != null && i === notes.length - 1 && x.s - pos >= n - 4) note = this.approachNote(note, this.bassRoot(nextRoot));
      const humanise = 1 - 0.08 * r();
      ev.push({ voice: 'bass', beat: (x.s - pos) / 4, dur: Math.max(0.1, (x.len / 4) * gate), notes: [note], vel: (x.acc ? 0.9 : 0.72) * humanise * lv, accent: x.acc });
    });
  }

  /** Nearest scale tone one step from the target, approached from the current note's side. */
  private approachNote(current: number, target: number): number {
    const notes = scaleNotesInRange(this.tonicPc(), this.settings.scale === 'chromatic' ? 'natural_minor' : this.settings.scale, target - 4, target + 4);
    const below = notes.filter((m) => m < target).pop();
    const above = notes.find((m) => m > target);
    if (below == null) return above ?? target;
    if (above == null) return below;
    return Math.abs(current - below) <= Math.abs(current - above) ? below : above;
  }

  private arpPool(m: Motif): number[] {
    const c = this.chord;
    const base = this.style.arpDefaults.register + m.octave * 12;
    const lo = Math.max(43, Math.min(84, base));
    const hi = Math.min(100, lo + 12 * m.span);
    const pcs = new Set(c.pcs);
    if (m.passing && this.settings.scale !== 'whole_tone') {
      const iv = scaleIntervals(harmonyScale(this.settings.scale));
      pcs.add((this.tonicPc() + iv[(this.mapDegree(c.degree) + 1) % iv.length]) % 12); // the chord's 9th
    }
    const out: number[] = [];
    for (let x = lo; x <= hi; x++) if (pcs.has(x % 12)) out.push(x);
    return out.length ? out : [lo];
  }

  /** Melody pitch: scale steps above the chord root nearest the motif's register; strong beats land on chord tones. */
  private melodyPitch(m: Motif, d: number, strong: boolean, dir: number): number {
    const sc = this.settings.scale === 'chromatic' ? 'natural_minor' : this.settings.scale;
    const key = `${this.settings.key}|${sc}`;
    if (!this.melodyCache || this.melodyCache.key !== key) this.melodyCache = { key, notes: scaleNotesInRange(this.tonicPc(), sc, 40, 100) };
    const list = this.melodyCache.notes;
    const reg = this.style.arpDefaults.register + 12 * m.octave;
    let anchor = 0;
    let best = Infinity;
    list.forEach((x, i) => { if (x % 12 === this.chord.rootPc && Math.abs(x - reg) < best) { best = Math.abs(x - reg); anchor = i; } });
    let i = Math.max(0, Math.min(list.length - 1, anchor + d));
    if (strong && !this.chord.pcs.includes(list[i] % 12)) {
      // snap in the direction the line is moving, so the contour survives the snap
      const s1 = dir >= 0 ? 1 : -1;
      for (const k of [s1, -s1, 2 * s1, -2 * s1]) { const j = i + k; if (j >= 0 && j < list.length && this.chord.pcs.includes(list[j] % 12)) { i = j; break; } }
    }
    let note = list[i];
    while (note > 100) note -= 12;
    while (note < 43) note += 12;
    return note;
  }

  private genMelody(b: number, ev: NoteEvent[], lv: number) {
    const mm = this.mem.melody;
    if (!mm.current || mm.restUntil > b) return;
    const pb = this.phraseBars;
    const rel = b - this.sec.start;
    // two motifs alternate as call and response: the primary in the first half of each phrase, the answer in the second
    const answering = mm.alt && rel % pb >= pb / 2;
    const m = answering ? mm.alt! : mm.current;
    const n = this.grid.n;
    const pos = (((answering ? rel - pb / 2 : rel) % m.bars) + m.bars) % m.bars * n;
    const art = this.p('rhythmicArticulation');
    const r = stream(this.seed, 'arp', b);
    const pool = m.kind === 'arp' ? this.arpPool(m) : null;
    const ct = this.chord.pcs.length;
    m.notes.forEach((x, xi) => {
      if (x.s < pos || x.s >= pos + n) return;
      let note: number;
      if (pool) {
        let idx = x.d;
        while (idx >= pool.length) idx -= ct;
        while (idx < 0) idx += ct;
        note = pool[Math.max(0, Math.min(pool.length - 1, idx))];
      } else {
        const prev = m.notes[(xi + m.notes.length - 1) % m.notes.length];
        note = this.melodyPitch(m, x.d, (x.s % n) % 8 === 0 || x.len >= 6, x.d - prev.d);
      }
      const dur = Math.max(0.06, (x.len / 4) * Math.max(0.2, Math.min(1.2, m.gate * (1.25 - 0.6 * art))));
      ev.push({ voice: 'arp', beat: (x.s - pos) / 4, dur, notes: [note], vel: Math.min(1, x.v * (1 - 0.1 * r()) * lv), accent: x.v >= 0.8 });
    });
  }

  private genPad(b: number, ev: NoteEvent[], lv: number) {
    const c = this.chord;
    const beats = this.settings.beatsPerBar;
    const v = this.padVoicing!;
    const mode = this.mem.pad.current;
    const rel = b - this.sec.start;
    const n = this.grid.n;
    const art = this.p('rhythmicArticulation');
    if (mode === 'stab') {
      const pat = this.mem.stabs.current[rel % this.mem.stabs.current.length];
      for (const s of pat) {
        if (s >= n) continue;
        ev.push({ voice: 'pad', beat: s / 4, dur: 0.22 + 0.2 * (1 - art), notes: v, vel: (s === pat[0] ? 0.8 : 0.6) * lv, accent: s === pat[0] });
      }
      return;
    }
    if (mode === 'pulse') {
      // contrasting texture: short off-beat chord pulses instead of a held chord
      for (const s of this.grid.offbeats) ev.push({ voice: 'pad', beat: s / 4, dur: 0.3 + 0.2 * (1 - art), notes: v, vel: (s % 8 === 2 ? 0.62 : 0.52) * lv });
      return;
    }
    const pb = this.phraseBars;
    const swellEvery = mode === 'swell' ? 2 : pb;
    const start = c.startBar === b || rel % pb === 0 || b === this.layers.pad.since || (mode === 'swell' && rel % swellEvery === 0) || this.forceArticulation;
    if (!start) return;
    const bars = Math.max(1, Math.min(c.startBar + c.bars - b, pb - (rel % pb), mode === 'swell' ? swellEvery : 99, this.sec.start + this.sec.bars - b));
    ev.push({ voice: 'pad', beat: 0, dur: bars * beats - 0.05, notes: v, vel: 0.62 * lv });
  }

  private genDrums(b: number, ev: NoteEvent[], lv: number) {
    const gr = this.mem.groove.current;
    if (!gr) return;
    const s = this.settings;
    const sec = this.sec;
    const n = this.grid.n;
    const rel = b - sec.start;
    const lanes = gr.bars[rel % gr.bars.length];
    const r = stream(this.seed, 'drums', b);
    const intensity = clamp01(s.rhythmIntensity * (0.65 + 0.5 * this.energy) + 0.15 * this.drumDensity);
    const detail = clamp01(0.5 * s.density + 0.6 * this.p('rhythmicDetail') + 0.25 * this.drumDensity);
    const ghosts = clamp01(0.4 * s.complexity + 0.6 * this.p('percComplexity'));
    const v = (x: number) => Math.min(1, x * (0.6 + 0.4 * intensity) * lv * (1 - 0.07 * r()));
    // build sections start from the hats; breakdowns lose the kick
    const building = sec.role === 'build' && rel < sec.bars / 2;
    const noKick = building || sec.role === 'breakdown';
    const sectionEnd = this.isSectionEnd(b) && s.autonomous;
    const intoButton = this.ending === 'button' && b === s.arrangementBars - 2;
    const phraseEnd = (rel + 1) % this.phraseBars === 0;
    let fill: FillKind = 'none';
    let fillFrom = n - 4;
    if (sectionEnd) {
      if (sec.transition === 'fill') fill = gr.fill === 'none' ? 'openHat' : gr.fill;
      else if (sec.transition === 'build') { fill = 'snareRoll'; fillFrom = Math.max(0, n - 8); }
      else if (sec.transition === 'drop') { fill = 'kickDrop'; fillFrom = Math.max(0, n - 8); }
    } else if (intoButton) { fill = 'snareRoll'; fillFrom = Math.max(0, n - 8); }
    else if (phraseEnd && sec.dev !== 'restate' && sec.dev !== 'dissolve' && chance(r, 0.12 + 0.3 * s.variation)) fill = gr.fill;
    const replaced: Record<FillKind, DrumVoice[]> = {
      none: [], snareRoll: ['snare', 'clap', 'hatC'], openHat: [], kickDrop: ['kick', 'snare', 'clap'], stutter: ['hatC'], tom: ['snare', 'clap'], clapFlam: ['clap'],
    };
    for (const voice of DRUM_VOICES) {
      if (noKick && voice === 'kick') continue;
      if (building && (voice === 'snare' || voice === 'clap')) continue;
      for (const h of lanes[voice]) {
        if (h.k === 'detail' && detail < h.t) continue;
        if (h.k === 'ghost' && ghosts < h.t) continue;
        if (h.s >= fillFrom && replaced[fill].includes(voice)) continue;
        if (fill === 'openHat' && voice === 'hatC' && h.s === n - 2) continue;
        const beat = h.s / 4 + (h.micro ?? 0) + (gr.lag[voice] ?? 0);
        ev.push({ voice, beat, dur: h.dur ?? 0.25, notes: [], vel: v(h.v), accent: h.v > 0.85 });
      }
    }
    const hit = (voice: Voice, step: number, vel: number, dur = 0.25, notes: number[] = []) => ev.push({ voice, beat: step / 4, dur, notes, vel: v(vel), accent: vel > 0.85 });
    switch (fill) {
      case 'snareRoll': for (let i = fillFrom; i < n; i++) hit('snare', i, 0.34 + (0.45 * (i - fillFrom)) / Math.max(1, n - fillFrom)); break;
      case 'openHat': hit('hatO', n - 2, 0.55, 0.4); break;
      case 'stutter': for (let i = fillFrom; i < n; i++) hit('hatC', i, 0.26 + 0.07 * (i - fillFrom), 0.05); hit('snare', n - 1, 0.5); break;
      case 'tom': {
        const tones = [...this.chord.pcs].map((pc) => 60 + pc).sort((a, z) => z - a);
        [n - 4, n - 3, n - 2].forEach((st, i) => hit('perc', st, 0.5, 0.1, [tones[i % tones.length]]));
        break;
      }
      case 'clapFlam': hit('clap', n - 2, 0.4, 0.1); hit('clap', n - 1, 0.55, 0.1); break;
      case 'kickDrop': case 'none': break;
    }
  }

  private genPerc(b: number, ev: NoteEvent[], lv: number) {
    const n = this.grid.n;
    const r = stream(this.seed, 'perc', b);
    const gp = this.mem.groove.current?.perc;
    const len = gp?.len ?? this.percLen;
    const k = gp?.k ?? Math.max(2, Math.round(len * (0.18 + 0.3 * this.p('percTransients') + 0.2 * this.p('percComplexity'))));
    const pat = euclid(k, len, gp?.rot ?? this.percRot);
    const tones = this.chord.pcs.map((pc) => 72 + ((pc + 12) % 12));
    for (let i = 0; i < n; i++) {
      const g = b * n + i;
      if (!pat[g % len]) continue;
      ev.push({ voice: 'perc', beat: i / 4, dur: 0.1, notes: [tones[(g >> 1) % tones.length]], vel: (0.35 + 0.25 * r()) * lv });
    }
  }

  private genTexture(b: number, ev: NoteEvent[], lv: number) {
    const s = this.settings;
    const r = stream(this.seed, 'texture', b);
    const beats = s.beatsPerBar;
    const t = this.style.texture;
    const sparkle = this.p('sparkle');
    // exposed in breakdowns, quieter at peaks
    const expose = this.sec.role === 'breakdown' || this.sec.dev === 'strip' ? 1.5 : this.sec.role === 'peak' ? 0.8 : 1;
    const clicks = Math.round((t.clicks * (0.5 + s.density)) * 6 * r() * expose + (this.p('percTransients') > 0.6 ? 1 : 0));
    for (let i = 0; i < clicks; i++) ev.push({ voice: 'click', beat: r() * beats * 0.999, dur: 0.02, notes: [], vel: (0.2 + 0.3 * r()) * lv });
    if (chance(r, Math.min(0.95, t.metal * (0.2 + 0.6 * sparkle) * expose))) {
      const notes = scaleNotesInRange(this.tonicPc(), s.scale, 79, 96).filter((m) => this.chord.pcs.includes(m % 12) || chance(r, 0.3));
      if (notes.length) ev.push({ voice: 'metal', beat: Math.floor(r() * beats * 2) / 2, dur: 1.5, notes: [pick(r, notes)], vel: (0.3 + 0.25 * r()) * lv });
    }
    if ((b - this.sec.start) % 2 === 0 && chance(r, Math.min(0.95, t.shimmer * (0.2 + 0.8 * sparkle) * expose))) {
      const top = this.chord.pcs.slice(0, 2).map((pc) => 84 + ((pc + 12) % 12));
      ev.push({ voice: 'shimmer', beat: 0, dur: beats * 2 - 0.1, notes: top, vel: 0.35 * lv });
    }
  }

  private applySwing(events: NoteEvent[]) {
    const sw = Math.min(0.6, this.settings.swing + (this.layers.drums.on ? this.mem.groove.current?.swing ?? 0 : 0));
    if (sw <= 0) return;
    for (const e of events) {
      const step = Math.round(e.beat * 4);
      if (Math.abs(e.beat * 4 - step) < 0.13 && step % 2 === 1) e.beat += (sw * 0.25) / 1.5;
    }
  }
}

/** Generates `n` bars in one go (export, MIDI, tests). */
export function generateBars(settings: Partial<CompositionSettings>, params: ParamSet, n: number): BarPlan[] {
  const c = new Composer(settings, params);
  const out: BarPlan[] = [];
  for (let i = 0; i < n; i++) out.push(c.nextBar());
  return out;
}

export const barSeconds = (bpm: number, beats: number) => (60 / bpm) * beats;
