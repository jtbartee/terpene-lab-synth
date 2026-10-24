// FROZEN COPY of the v0.1 composition engine (commit d75b90a), kept only as the
// baseline that tests/music/diversity.test.ts measures the 2.0 engine against.
// Do not edit or import from the app.

// The generative composition engine.
//
// A Composer is a deterministic state machine: given the same settings,
// parameters and seed it produces the same sequence of bars. Each bar is
// generated just ahead of playback (or all at once for export/MIDI) from
// randomness keyed by (seed, purpose, bar), so layers are independent.
//
// Hierarchy: steps (16ths) → beats → bars → 8-bar phrases → 16-bar sections →
// arrangement arc. Development happens only at phrase boundaries, through a
// weighted event system that never changes every layer at once.

import { neutralParams, type ParamSet } from '../../../src/sonify/targets';
import { chance, hash, intBetween, pick, shuffle, stream, weighted, type Rng } from '../../../src/music/rng';
import { LAYERS, STYLES, type ChordKind, type Layer, type StyleDef, type StyleId } from '../../../src/music/styles';
import {
  METER_GROUPS, chordSymbol, colourChord, euclid, harmonyScale, inScale, keyPc, scaleIntervals, scaleNotesInRange,
  voiceLead, type KeyName, type ScaleId,
} from '../../../src/music/theory';

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
   * Folded into the seed so each terpene profile gets its own harmony, motifs
   * and grooves from one seed. 0 (or absent) = the seed alone, as in Analytical
   * mode. Derived from the profile by the store, never edited directly.
   */
  variant?: number;
}

export const DEFAULT_SETTINGS: CompositionSettings = {
  seed: 20261023, key: 'A', scale: 'natural_minor', bpm: 112, beatsPerBar: 4, style: 'motorik',
  complexity: 0.5, density: 0.55, variation: 0.5, harmonicMovement: 0.4, rhythmIntensity: 0.6,
  droneIntensity: 0.5, arrangementBars: 0, autonomous: true, swing: 0,
};

export interface ChordInfo { degree: number; kind: ChordKind; pcs: number[]; rootPc: number; symbol: string }

export interface LayerSnapshot { on: boolean; level: number; timbre: number; filter: number; pan: number }

export interface BarPlan {
  index: number;
  beats: number;
  bpm: number;
  section: { index: number; name: string; bar: number; energy: number };
  phraseBar: number;
  chord: ChordInfo;
  padVoicing: number[];
  layers: Record<Layer, LayerSnapshot>;
  events: NoteEvent[];
  development: string[];
  final: boolean;
}

// ---------------------------------------------------------------- internals

interface ChordState extends ChordInfo { startBar: number; bars: number }

type BassRel = 'root' | 'third' | 'fifth' | 'seventh' | 'octave' | 'low';
interface BassStep { step: number; rel: BassRel; len: number; accent: boolean }
interface BassMotif { steps: BassStep[] }

type ArpOrder = 'up' | 'down' | 'updown' | 'random' | 'asplayed' | 'pattern';
interface ArpMotif {
  order: ArpOrder;
  pattern: number[];
  rhythm: boolean[];
  division: number;
  octaves: number;
  registerShift: number;
  gate: number;
  passing: boolean;
  response: boolean;
}

interface LayerState { on: boolean; since: number; fading: boolean; level: number; timbre: number; filter: number; pan: number }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export class Composer {
  settings: CompositionSettings;
  params: ParamSet;
  style!: StyleDef;
  bar = 0;

  /** settings.seed with the profile variant folded in; every random stream keys on this */
  private seed = 0;
  /** a variant change that arrived mid-piece, applied at the next phrase boundary */
  private pendingVariant: number | null = null;
  private chord!: ChordState;
  private next!: { degree: number; kind: ChordKind };
  private padVoicing: number[] | null = null;
  private padInversion = 0;
  private bassMotif!: BassMotif;
  private bassOriginal!: BassMotif;
  private arpMotif!: ArpMotif;
  private arpOriginal!: ArpMotif;
  private arpMutated = false;
  private bassMutated = false;
  private arpNote = 0;
  private motifGen = 0;
  private layers!: Record<Layer, LayerState>;
  private introQueue: Layer[] = [];
  private energy = 0.4;
  private drumDensity = 0;
  private percLen = 16;
  private percRot = 0;
  private dropUntil = -1;
  private vampPair: [number, number] = [0, 3];
  private forceArticulation = false;

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
    if (partial.key !== undefined || partial.scale !== undefined) {
      this.chord = this.makeChord(this.chord.degree, this.chord.kind, this.bar, this.chord.bars);
      this.padVoicing = null;
    }
    if (partial.autonomous === false && prev.autonomous) this.fillLayersStatic();
  }

  setParams(params: ParamSet) { this.params = params; }

  private rebuildAt(b: number) {
    this.init();
    this.bar = b;
    // mid-piece, a new style or profile lands in its core arrangement rather than restarting a sparse intro
    if (b > 0) {
      for (const l of LAYERS) this.layers[l].on = false;
      this.fillLayersStatic();
      this.energy = this.energyFor(Math.floor(b / this.style.sectionBars));
    }
  }

  /** After a pause, sustained layers (drone, pad) re-articulate on the next bar. */
  rearticulate() { this.forceArticulation = true; }

  reset() {
    if (this.pendingVariant !== null) { this.settings = { ...this.settings, variant: this.pendingVariant }; this.pendingVariant = null; }
    this.init();
  }

  nextBar(): BarPlan {
    const b = this.bar;
    const s = this.settings;
    const st = this.style;
    const development: string[] = [];

    // fades scheduled last bar complete now
    for (const l of LAYERS) if (this.layers[l].fading) { this.layers[l].fading = false; this.layers[l].on = false; }

    if (b > 0 && b % st.phraseBars === 0 && this.pendingVariant !== null) {
      this.settings = { ...this.settings, variant: this.pendingVariant };
      this.pendingVariant = null;
      this.rebuildAt(b);
      development.push('New profile · the piece re-keys');
    }
    if (b > 0 && b % this.style.phraseBars === 0) this.develop(b, development);
    if (b === this.dropUntil) { this.layers.drums.on = true; this.layers.drums.since = b; development.push('Drums return'); }

    this.advanceHarmony(b, development);

    const chord = this.chord;
    const changedChord = chord.startBar === b;
    if (changedChord || !this.padVoicing) {
      const lo = 50 + Math.round(this.p('upperPads') * 12);
      this.padVoicing = voiceLead(this.padVoicing, chord.pcs, lo, lo + 21, this.padInversion);
    }

    const events: NoteEvent[] = [];
    const L = this.layers;
    const vMul = (l: Layer) => (L[l].fading ? 0.55 : 1) * L[l].level;
    if (L.drone.on) this.genDrone(b, events, vMul('drone'));
    if (L.bass.on) this.genBass(b, events, vMul('bass'));
    if (L.arp.on) this.genArp(b, events, vMul('arp'));
    if (L.pad.on) this.genPad(b, events, vMul('pad'));
    if (L.drums.on) this.genDrums(b, events, vMul('drums'));
    if (L.perc.on) this.genPerc(b, events, vMul('perc'));
    if (L.texture.on) this.genTexture(b, events, vMul('texture'));

    this.forceArticulation = false;
    this.applySwing(events);
    events.sort((x, y) => x.beat - y.beat);

    const secIdx = Math.floor(b / st.sectionBars);
    const plan: BarPlan = {
      index: b,
      beats: s.beatsPerBar,
      bpm: s.bpm,
      section: { index: secIdx, name: this.sectionName(secIdx), bar: b % st.sectionBars, energy: this.energy },
      phraseBar: b % st.phraseBars,
      chord: { degree: chord.degree, kind: chord.kind, pcs: chord.pcs, rootPc: chord.rootPc, symbol: chord.symbol },
      padVoicing: [...this.padVoicing],
      layers: Object.fromEntries(LAYERS.map((l) => [l, { on: L[l].on && !L[l].fading, level: L[l].level, timbre: L[l].timbre, filter: L[l].filter, pan: L[l].pan }])) as Record<Layer, LayerSnapshot>,
      events,
      development,
      final: s.arrangementBars > 0 && b === s.arrangementBars - 1,
    };
    this.bar++;
    return plan;
  }

  // -------------------------------------------------------------- set-up

  private init() {
    const s = this.settings;
    this.style = STYLES[s.style];
    this.seed = s.variant ? hash(s.seed, 'variant', s.variant) : s.seed;
    this.bar = 0;
    this.motifGen = 0;
    this.arpNote = 0;
    this.padVoicing = null;
    this.padInversion = 0;
    this.drumDensity = 0;
    this.dropUntil = -1;
    this.arpMutated = this.bassMutated = false;
    const r = stream(this.seed, 'init', s.style);
    this.vampPair = [0, weighted(r, this.style.harmony.moves[0] ?? [[3, 1]])];
    this.percLen = pick(r, [16, 16, 12, 6]);
    this.percRot = intBetween(r, 0, 3);
    const kind = this.chordKindFor(0, 0);
    const firstBars = this.chordDuration(stream(this.seed, 'harm', 0), 0);
    this.chord = this.makeChord(0, kind, 0, firstBars);
    this.next = this.planNext(0, firstBars);
    this.bassMotif = this.makeBassMotif(stream(this.seed, 'bassMotif', 0));
    this.bassOriginal = this.bassMotif;
    this.arpMotif = this.makeArpMotif(stream(this.seed, 'arpMotif', 0));
    this.arpOriginal = this.arpMotif;
    this.layers = Object.fromEntries(LAYERS.map((l) => [l, { on: false, since: 0, fading: false, level: 1, timbre: 0, filter: 0, pan: 0 }])) as Record<Layer, LayerState>;
    this.energy = this.energyFor(0);
    const intro = this.style.intro.filter((l) => this.affinity(l) > 0.05);
    if (s.autonomous) {
      this.introQueue = [...intro];
      const first = this.introQueue.shift();
      if (first) this.turnOn(first, 0);
      // the piece starts with two layers at ordinary density so it is never a near-silent wait
      if (s.density >= 0.4 && this.introQueue.length) this.turnOn(this.introQueue.shift()!, 0);
      if (s.density > 0.8 && this.introQueue.length) this.turnOn(this.introQueue.shift()!, 0);
    } else {
      this.introQueue = [];
      this.fillLayersStatic();
    }
  }

  /** Non-autonomous mode: the style's core arrangement, fixed. */
  private fillLayersStatic() {
    const threshold = 0.75 - 0.4 * this.settings.density;
    for (const l of LAYERS) if (this.affinity(l) >= threshold) this.turnOn(l, this.bar);
    if (!LAYERS.some((l) => this.layers[l].on)) this.turnOn(this.style.intro[0], this.bar);
    this.introQueue = [];
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

  private stepsPerBar() { return this.settings.beatsPerBar * 4; }

  private tonicPc() { return keyPc(this.settings.key); }

  private mapDegree(deg7: number): number {
    const n = scaleIntervals(harmonyScale(this.settings.scale)).length;
    return n === 7 ? deg7 : Math.round((deg7 * n) / 7) % n;
  }

  private makeChord(degree: number, kind: ChordKind, startBar: number, bars: number): ChordState {
    const pcs = colourChord(this.tonicPc(), this.settings.scale, this.mapDegree(degree), kind);
    return { degree, kind, pcs, rootPc: pcs[0], symbol: chordSymbol(pcs), startBar, bars };
  }

  private chordKindFor(degree: number, section: number): ChordKind {
    return weighted(stream(this.seed, 'kind', degree, section), this.style.harmony.kinds);
  }

  /** Bars a chord lasts, snapped to powers of two so changes land on phrase grid. */
  private chordDuration(r: Rng, startBar: number): number {
    const h = this.style.harmony;
    const st = this.style;
    if (h.mode === 'static' || h.mode === 'drone') {
      // until the next section boundary (or the one after)
      const toSection = st.sectionBars - (startBar % st.sectionBars);
      return toSection + (chance(r, 0.5) ? st.sectionBars : 0);
    }
    const opts: number[] = [];
    for (let v = 1; v <= 32; v *= 2) if (v >= h.barsPerChord[0] && v <= h.barsPerChord[1]) opts.push(v);
    // more harmonic movement → shorter chords
    const idx = Math.min(opts.length - 1, Math.floor((1 - this.settings.harmonicMovement) * opts.length));
    return opts[chance(r, 0.7) ? idx : intBetween(r, 0, opts.length - 1)] ?? 4;
  }

  private planNext(fromBar: number, bars: number): { degree: number; kind: ChordKind } {
    const startNext = fromBar + bars;
    const r = stream(this.seed, 'harmNext', startNext);
    const h = this.style.harmony;
    const cur = this.chord.degree;
    const section = Math.floor(startNext / this.style.sectionBars);
    let degree = cur;
    if (h.mode === 'vamp') {
      if (startNext % this.style.sectionBars === 0 && chance(r, 0.3 * this.settings.harmonicMovement)) {
        this.vampPair = [0, weighted(r, h.moves[0])];
      }
      degree = cur === this.vampPair[0] ? this.vampPair[1] : this.vampPair[0];
    } else {
      const moveP = h.moveChance * (0.3 + 1.2 * this.settings.harmonicMovement);
      const returnP = cur !== 0 ? 0.55 + 0.3 * (1 - this.settings.harmonicMovement) : 0;
      if (cur !== 0 && chance(r, returnP) && h.mode !== 'progression') degree = 0;
      else if (chance(r, moveP)) degree = weighted(r, h.moves[cur] ?? h.moves[0]);
    }
    return { degree, kind: this.chordKindFor(degree, section) };
  }

  private advanceHarmony(b: number, dev: string[]) {
    const c = this.chord;
    if (b < c.startBar + c.bars) return;
    const prevSymbol = c.symbol;
    const bars = this.chordDuration(stream(this.seed, 'harm', b), b);
    this.chord = this.makeChord(this.next.degree, this.next.kind, b, bars);
    this.next = this.planNext(b, bars);
    if (this.chord.symbol !== prevSymbol) dev.push(`Harmony moves ${prevSymbol} → ${this.chord.symbol}`);
  }

  private chordChangesNextBar(b: number): boolean {
    const c = this.chord;
    return b + 1 === c.startBar + c.bars && this.next.degree !== c.degree;
  }

  private nextRootPc(): number {
    return colourChord(this.tonicPc(), this.settings.scale, this.mapDegree(this.next.degree), this.next.kind)[0];
  }

  private snapToScale(m: number): number {
    const sc = this.settings.scale;
    if (inScale(m, this.tonicPc(), sc)) return m;
    for (const d of [-1, 1, -2, 2]) if (inScale(m + d, this.tonicPc(), sc)) return m + d;
    return m;
  }

  private bassRoot(pc: number) { return 33 + ((pc - 9 + 12) % 12); } // A1..G#2

  private energyFor(section: number): number {
    const s = this.settings;
    const r = stream(this.seed, 'energy', section);
    const jitter = (r() - 0.5) * 0.12;
    if (s.arrangementBars > 0) {
      const n = Math.max(1, Math.round(s.arrangementBars / this.style.sectionBars));
      const t = n === 1 ? 0.5 : section / (n - 1);
      let e: number;
      if (section === 0) e = 0.3;
      else if (section >= n - 1) e = 0.25;
      else if (Math.abs(t - 0.55) < 0.5 / n) e = 0.45; // breakdown near the middle
      else e = 0.45 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.15));
      return clamp01(e + jitter);
    }
    const phase = (this.seed % 7) / 7;
    return clamp01(0.58 + 0.27 * Math.sin(2 * Math.PI * (section / 6 + phase)) + jitter);
  }

  private sectionName(i: number): string {
    const s = this.settings;
    const n = s.arrangementBars > 0 ? Math.round(s.arrangementBars / this.style.sectionBars) : 0;
    if (i === 0) return 'Intro';
    if (n && i >= n - 1) return 'Outro';
    if (this.energy < 0.4) return 'Breakdown';
    if (this.energy > 0.82) return 'Peak';
    return `Section ${String.fromCharCode(64 + ((i - 1) % 6) + 1)}`;
  }

  // ---------------------------------------------------------- development

  private develop(b: number, dev: string[]) {
    const s = this.settings;
    const st = this.style;
    const r = stream(this.seed, 'develop', b);
    const isSection = b % st.sectionBars === 0;
    if (isSection) {
      this.energy = this.energyFor(b / st.sectionBars);
      dev.push(`New section · energy ${Math.round(this.energy * 100)}`);
    }
    if (!s.autonomous) return;

    const L = this.layers;
    const changed = new Set<Layer>();
    const active = () => LAYERS.filter((l) => L[l].on && !L[l].fading);
    const finalSection = s.arrangementBars > 0 && b >= s.arrangementBars - st.sectionBars;

    // intro: one new layer per phrase
    if (this.introQueue.length && !finalSection) {
      const l = this.introQueue.shift()!;
      if (this.affinity(l) >= 0.25 || chance(r, this.affinity(l) * 2)) {
        this.turnOn(l, b);
        changed.add(l);
        dev.push(`${cap(l)} enters`);
      }
    }

    const affine = LAYERS.filter((l) => this.affinity(l) > 0.05);
    const desired = finalSection
      ? Math.max(1, active().length - 1)
      : Math.max(1, Math.min(affine.length, Math.round(1 + this.energy * affine.length * (0.55 + 0.6 * s.density))));

    type Ev = { id: string; w: number; layer?: Layer; run: () => string | null };
    const evs: Ev[] = [];
    const dwellOk = (l: Layer) => b - L[l].since >= 2 * st.phraseBars;
    const smooth = this.p('transitionSmoothness');
    const mutP = clamp01(0.5 * s.variation + 0.6 * this.p('melodicMutation'));

    if (!this.introQueue.length || finalSection) {
      if (active().length < desired) {
        const cands = affine.filter((l) => !L[l].on);
        if (cands.length) evs.push({ id: 'add', w: 3, run: () => {
          const l = weighted(r, cands.map((c) => [c, this.affinity(c)] as const));
          if (changed.has(l)) return null;
          this.turnOn(l, b); changed.add(l); return `${cap(l)} enters`;
        } });
      }
      if (active().length > desired) {
        const cands = active().filter((l) => dwellOk(l));
        if (cands.length && active().length > 1) evs.push({ id: 'remove', w: finalSection ? 6 : 3, run: () => {
          const l = weighted(r, cands.map((c) => [c, 1.2 - this.affinity(c)] as const));
          if (changed.has(l)) return null;
          L[l].fading = true; changed.add(l); return `${cap(l)} drops out`;
        } });
      }
    }
    if (L.arp.on && !finalSection) {
      evs.push({ id: 'arpRegister', w: 1, layer: 'arp', run: () => {
        const m = this.arpMotif;
        const dir = m.registerShift >= 1 ? -1 : m.registerShift <= -1 ? 1 : (chance(r, 0.5) ? 1 : -1);
        this.arpMotif = { ...m, registerShift: m.registerShift + dir };
        return `Arpeggio moves ${dir > 0 ? 'up' : 'down'} an octave`;
      } });
      evs.push({ id: 'arpRotate', w: 0.8, layer: 'arp', run: () => {
        const m = this.arpMotif;
        const k = intBetween(r, 1, Math.max(1, m.rhythm.length - 1));
        this.arpMotif = { ...m, rhythm: [...m.rhythm.slice(k), ...m.rhythm.slice(0, k)] };
        return `Arpeggio rhythm rotates by ${k}`;
      } });
      evs.push({ id: 'arpMutate', w: 2.2 * mutP, layer: 'arp', run: () => {
        this.arpMotif = this.mutateArp(this.arpMotif, r);
        this.arpMutated = true;
        return 'Arpeggio motif mutates';
      } });
      if (this.arpMutated) evs.push({ id: 'arpReturn', w: 0.9, layer: 'arp', run: () => {
        this.arpMotif = { ...this.arpOriginal, registerShift: this.arpMotif.registerShift };
        this.arpMutated = false;
        return 'Arpeggio returns to the original motif';
      } });
    }
    if (L.bass.on && !finalSection) {
      evs.push({ id: 'bassMutate', w: 1.2 * mutP, layer: 'bass', run: () => {
        this.bassMotif = this.mutateBass(this.bassMotif, r);
        this.bassMutated = true;
        return 'Bass ostinato varies';
      } });
      if (this.bassMutated) evs.push({ id: 'bassReturn', w: 0.8, layer: 'bass', run: () => {
        this.bassMotif = this.bassOriginal; this.bassMutated = false;
        return 'Bass returns to its original ostinato';
      } });
    }
    if (L.pad.on) evs.push({ id: 'inversion', w: 1, layer: 'pad', run: () => {
      this.padInversion = (this.padInversion + 1) % 3;
      this.padVoicing = voiceLead(this.padVoicing, this.chord.pcs, 50 + Math.round(this.p('upperPads') * 12), 71 + Math.round(this.p('upperPads') * 12), this.padInversion);
      return 'Pad chord changes inversion';
    } });
    const timbreLayers = active().filter((l) => l !== 'perc');
    if (timbreLayers.length) evs.push({ id: 'timbre', w: 1, run: () => {
      const l = pick(r, timbreLayers);
      if (changed.has(l)) return null;
      L[l].timbre = (L[l].timbre + 1) % 3; changed.add(l);
      return `${cap(l)} changes timbre`;
    } });
    const filterLayers = active().filter((l) => l !== 'perc' && l !== 'drums');
    if (filterLayers.length) evs.push({ id: 'filter', w: 1.3, run: () => {
      const l = pick(r, filterLayers);
      if (changed.has(l)) return null;
      const dir = L[l].filter > 0.4 ? -1 : L[l].filter < -0.4 ? 1 : (chance(r, 0.6) ? 1 : -1);
      L[l].filter = Math.max(-0.8, Math.min(0.8, L[l].filter + dir * 0.4)); changed.add(l);
      return `${cap(l)} filter slowly ${dir > 0 ? 'opens' : 'closes'}`;
    } });
    if (L.drums.on) evs.push({ id: 'density', w: 1, layer: 'drums', run: () => {
      const dir = this.drumDensity >= 1 ? -1 : this.drumDensity <= -1 ? 1 : (this.energy > 0.6 ? 1 : -1);
      this.drumDensity += dir;
      return `Rhythmic density ${dir > 0 ? 'increases' : 'thins out'}`;
    } });
    evs.push({ id: 'stereo', w: 0.6, run: () => {
      const l = pick(r, active());
      if (!l || changed.has(l)) return null;
      L[l].pan = Math.round((r() * 2 - 1) * 60) / 100; changed.add(l);
      return `${cap(l)} shifts in the stereo field`;
    } });
    if (!L.perc.on && this.affinity('perc') > 0.2 && !finalSection) evs.push({ id: 'secondary', w: 1, layer: 'perc', run: () => {
      this.turnOn('perc', b);
      this.percLen = pick(r, [16, 12, 6, 10]);
      return `A secondary rhythm enters (${this.percLen === 16 ? 'straight' : `${this.percLen}-step cycle against the bar`})`;
    } });
    if (L.drums.on && this.energy < 0.5 && !isSection && b > st.sectionBars && !finalSection) evs.push({ id: 'drop', w: 0.7, layer: 'drums', run: () => {
      L.drums.on = false; this.dropUntil = b + st.phraseBars;
      return 'Percussion drops out for a phrase';
    } });

    const maxEvents = Math.max(0, 1 + Math.round(s.variation * 2) - Math.round(smooth));
    const count = Math.min(maxEvents, weighted(r, [[0, 1 - s.variation * 0.7], [1, 1.5], [2, s.variation], [3, s.variation * 0.6]] as const));
    // weighted sampling without replacement
    const pool = shuffle(r, evs);
    const order: Ev[] = [];
    while (pool.length) {
      const e = weighted(r, pool.map((x) => [x, x.w] as const));
      order.push(e);
      pool.splice(pool.indexOf(e), 1);
    }
    let n = 0;
    let addRemove = false;
    for (const e of order) {
      if (n >= count) break;
      if ((e.id === 'add' || e.id === 'remove') && addRemove) continue;
      if (e.layer && changed.has(e.layer)) continue;
      const msg = e.run();
      if (!msg) continue;
      if (e.layer) changed.add(e.layer);
      if (e.id === 'add' || e.id === 'remove') addRemove = true;
      dev.push(msg);
      n++;
    }
    // an empty arrangement is not allowed
    if (!active().length) { const l = this.style.intro[0]; this.turnOn(l, b); dev.push(`${cap(l)} enters`); }
  }

  // ---------------------------------------------------------------- motifs

  private makeBassMotif(r: Rng): BassMotif {
    const n = this.stepsPerBar();
    const s = this.settings;
    const steps: BassStep[] = [];
    switch (this.style.bass) {
      case 'motorik': {
        for (let i = 0; i < n; i += 2) {
          const rel: BassRel = i === 0 ? 'root' : weighted(r, [['root', 5.5], ['octave', 2], ['fifth', 1.6], ['third', 0.6 + s.complexity]] as const);
          steps.push({ step: i, rel, len: 2, accent: i % 4 === 0 });
        }
        if (s.complexity > 0.6 && chance(r, 0.5)) steps.push({ step: n - 1, rel: 'fifth', len: 1, accent: false });
        break;
      }
      case 'walking': {
        const rels: BassRel[] = ['root', pick(r, ['fifth', 'third'] as BassRel[]), 'octave', pick(r, ['fifth', 'seventh', 'third'] as BassRel[])];
        for (let i = 0; i < n; i += 4) steps.push({ step: i, rel: rels[(i / 4) % rels.length], len: 3, accent: i === 0 });
        if (s.complexity > 0.5) steps.push({ step: 6, rel: 'root', len: 1, accent: false });
        break;
      }
      case 'dub': {
        steps.push({ step: 0, rel: 'root', len: pick(r, [6, 7]), accent: true });
        steps.push({ step: pick(r, [7, 10, 11]), rel: weighted(r, [['root', 3], ['low', 1], ['fifth', 1]] as const), len: 3, accent: false });
        if (n >= 16 && chance(r, 0.5)) steps.push({ step: 14, rel: 'octave', len: 2, accent: false });
        break;
      }
      case 'sequence': {
        const cellLen = pick(r, [4, 8]);
        const cell: BassRel[] = ['root'];
        for (let i = 1; i < cellLen; i++) cell.push(weighted(r, [['root', 3], ['octave', 3], ['fifth', 2], ['seventh', s.complexity * 1.5], ['third', 0.8]] as const));
        const acc = euclid(5, 16, intBetween(r, 0, 3));
        for (let i = 0; i < n; i++) steps.push({ step: i, rel: cell[i % cellLen], len: 1, accent: acc[i % 16] });
        break;
      }
      case 'drone':
        steps.push({ step: 0, rel: 'root', len: n, accent: true });
        if (s.complexity > 0.55) steps.push({ step: n / 2, rel: 'octave', len: n / 2, accent: false });
        break;
      case 'micro': {
        const k = intBetween(r, 3, 5);
        const pat = euclid(k, 16, intBetween(r, 0, 5));
        for (let i = 0; i < n; i++) if (pat[i % 16]) steps.push({ step: i, rel: weighted(r, [['root', 4], ['fifth', 1], ['octave', 1]] as const), len: 1, accent: i === 0 });
        if (!steps.some((x) => x.step === 0)) steps.unshift({ step: 0, rel: 'root', len: 1, accent: true });
        break;
      }
    }
    return { steps: steps.filter((x) => x.step < n) };
  }

  private mutateBass(m: BassMotif, r: Rng): BassMotif {
    const steps = m.steps.map((x) => ({ ...x }));
    const candidates = steps.filter((x) => x.step !== 0);
    if (!candidates.length) return m;
    const tgt = pick(r, candidates);
    tgt.rel = pick(r, (['root', 'octave', 'fifth', 'third', 'low'] as BassRel[]).filter((x) => x !== tgt.rel));
    return { steps };
  }

  private makeArpMotif(r: Rng): ArpMotif {
    const s = this.settings;
    const cx = clamp01(0.5 * s.complexity + 0.6 * this.p('arpComplexity'));
    const def = this.style.arpDefaults;
    const mode = this.style.arp;
    let division: number = def.division;
    let lengthSlots: number;
    let fill: number;
    let order: ArpOrder;
    if (mode === 'sequence') {
      lengthSlots = pick(r, cx > 0.6 ? [12, 16, 10, 14] : [8, 16]);
      fill = 0.85 + 0.15 * r();
      order = weighted(r, [['up', 2], ['updown', 2], ['pattern', 1 + 2 * cx], ['asplayed', 1]] as const);
    } else if (mode === 'evolving') {
      division = cx > 0.55 && chance(r, 0.35) ? 3 : def.division;
      lengthSlots = pick(r, cx > 0.5 ? [5, 6, 7, 8, 12] : [4, 8, 16]);
      fill = 0.55 + 0.4 * s.density;
      order = weighted(r, [['up', 2], ['updown', 1.5], ['random', cx * 2], ['pattern', 1 + 2 * cx], ['asplayed', 1], ['down', 0.8]] as const);
    } else if (mode === 'sparse') {
      lengthSlots = pick(r, [8, 6, 5]);
      fill = 0.25 + 0.3 * s.density;
      order = weighted(r, [['up', 1], ['asplayed', 1], ['pattern', 1 + cx]] as const);
    } else {
      lengthSlots = 8; fill = 0.3; order = 'pattern';
    }
    const k = Math.max(1, Math.round(lengthSlots * fill));
    const octaves = Math.max(1, Math.min(3, Math.round(def.octaves * (0.6 + 0.8 * cx))));
    const patternLen = intBetween(r, 4, 8);
    const pattern: number[] = [];
    for (let i = 0; i < patternLen; i++) {
      let v = intBetween(r, 0, 2 + octaves * 2);
      if (i > 0 && v === pattern[i - 1]) v = (v + 1) % (3 + octaves * 2);
      pattern.push(v);
    }
    return {
      order, pattern, division,
      rhythm: euclid(k, lengthSlots, intBetween(r, 0, lengthSlots - 1)),
      octaves, registerShift: 0,
      gate: 0.5 + 0.4 * r(),
      passing: cx > 0.6 && chance(r, 0.6),
      response: cx > 0.45 && chance(r, 0.7),
    };
  }

  private mutateArp(m: ArpMotif, r: Rng): ArpMotif {
    const choice = weighted(r, [['note', 3], ['rhythm', 2], ['order', 1]] as const);
    if (choice === 'note' && m.pattern.length) {
      const pattern = [...m.pattern];
      const i = intBetween(r, 0, pattern.length - 1);
      pattern[i] = Math.max(0, pattern[i] + (chance(r, 0.5) ? 1 : -1));
      return { ...m, pattern, order: m.order === 'pattern' ? m.order : 'pattern' };
    }
    if (choice === 'rhythm') {
      const rhythm = [...m.rhythm];
      const i = intBetween(r, 1, Math.max(1, rhythm.length - 1));
      rhythm[i] = !rhythm[i];
      if (!rhythm.some(Boolean)) rhythm[0] = true;
      return { ...m, rhythm };
    }
    const orders: ArpOrder[] = ['up', 'down', 'updown', 'asplayed', 'pattern'];
    return { ...m, order: pick(r, orders.filter((o) => o !== m.order)) };
  }

  // ------------------------------------------------------------ generators

  private genDrone(b: number, ev: NoteEvent[], lv: number) {
    const c = this.chord;
    const n = this.settings.beatsPerBar;
    const st = this.style;
    // re-articulate at chord changes and phrase starts; long notes cross-fade in the voice
    const start = c.startBar === b || b % st.phraseBars === 0 || b === this.layers.drone.since || this.forceArticulation;
    if (!start) return;
    const pedal = st.harmony.mode === 'static' || st.harmony.mode === 'drone' || st.harmony.mode === 'vamp';
    const rootPc = pedal ? this.tonicPc() : c.rootPc;
    const root = this.bassRoot(rootPc) + (this.layers.drone.timbre === 2 ? 12 : 0);
    const barsLeft = Math.min(c.startBar + c.bars - b, st.phraseBars - (b % st.phraseBars));
    // intervals snap to the scale (the whole-tone scale has no perfect fifth)
    const notes = [...new Set(st.droneIntervals.map((i) => this.snapToScale(root + i)))];
    if (st.id === 'drone' && c.kind === 'sus2') notes.push(this.snapToScale(root + 14));
    ev.push({ voice: 'drone', beat: 0, dur: barsLeft * n, notes, vel: 0.7 * lv });
  }

  private genBass(b: number, ev: NoteEvent[], lv: number) {
    const c = this.chord;
    const n = this.stepsPerBar();
    const root = this.bassRoot(c.rootPc);
    const iv = colourChord(this.tonicPc(), this.settings.scale, this.mapDegree(c.degree), 'seventh').map((pc) => (pc - c.rootPc + 12) % 12);
    const art = this.p('rhythmicArticulation');
    const r = stream(this.seed, 'bass', b);
    const changeNext = this.chordChangesNextBar(b);
    const resolve = (rel: BassRel): number => {
      switch (rel) {
        case 'root': return root;
        case 'third': return root + iv[1];
        case 'fifth': return root + iv[2];
        case 'seventh': return root + iv[3];
        case 'octave': return root + 12;
        case 'low': return root - 12 >= 28 ? root - 12 : root;
      }
    };
    const steps = this.bassMotif.steps;
    steps.forEach((st, i) => {
      let note = resolve(st.rel);
      const isLast = i === steps.length - 1;
      // approach the next chord stepwise through the scale on the final note
      if (changeNext && isLast && st.step >= n - 4) note = this.approachNote(note, this.bassRoot(this.nextRootPc()));
      const gate = this.style.bass === 'drone' || this.style.bass === 'dub' ? 0.95 : 0.35 + 0.55 * (1 - art);
      const humanise = 1 - 0.08 * r();
      ev.push({ voice: 'bass', beat: st.step / 4, dur: Math.max(0.1, (st.len / 4) * gate), notes: [note], vel: (st.accent ? 0.9 : 0.72) * humanise * lv, accent: st.accent });
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

  private arpPool(): number[] {
    const m = this.arpMotif;
    const c = this.chord;
    const base = this.style.arpDefaults.register + m.registerShift * 12;
    const lo = Math.max(43, Math.min(84, base));
    const hi = Math.min(100, lo + 12 * m.octaves);
    if (m.order === 'asplayed' && this.padVoicing) {
      const v = this.padVoicing;
      const shift = Math.round((lo - v[0]) / 12) * 12;
      const out: number[] = [];
      for (let o = 0; o < m.octaves; o++) for (const x of v) out.push(x + shift + o * 12);
      return out.filter((x) => x <= hi + 4);
    }
    const pcs = new Set(c.pcs);
    if (m.passing && this.settings.scale !== 'whole_tone') {
      const iv = scaleIntervals(harmonyScale(this.settings.scale));
      const tonic = this.tonicPc();
      const extra = (tonic + iv[(this.mapDegree(c.degree) + 1) % iv.length]) % 12; // the chord's 9th
      pcs.add(extra);
    }
    const out: number[] = [];
    for (let x = lo; x < hi; x++) if (pcs.has(x % 12)) out.push(x);
    return out.length ? out : [lo];
  }

  private sequenceFrom(pool: number[]): number[] {
    const m = this.arpMotif;
    switch (m.order) {
      case 'up': case 'asplayed': return pool;
      case 'down': return [...pool].reverse();
      case 'updown': return pool.length > 2 ? [...pool, ...pool.slice(1, -1).reverse()] : pool;
      case 'random': {
        // constrained: a seeded walk with no repeated notes and leaps of at most an octave
        const r = stream(this.seed, 'arpRandom', this.motifGen, pool.length);
        const seq: number[] = [pool[0]];
        for (let i = 1; i < pool.length * 2; i++) {
          const prev = seq[i - 1];
          const opts = pool.filter((x) => x !== prev && Math.abs(x - prev) <= 12);
          seq.push(opts.length ? pick(r, opts) : prev);
        }
        return seq;
      }
      case 'pattern': return m.pattern.map((i) => pool[Math.min(pool.length - 1, i % pool.length)]);
    }
  }

  private genArp(b: number, ev: NoteEvent[], lv: number) {
    if (this.style.arp === 'constellation') { this.genConstellation(b, ev, lv); return; }
    const m = this.arpMotif;
    const n = this.stepsPerBar();
    const pool = this.arpPool();
    const seq = this.sequenceFrom(pool);
    const art = this.p('rhythmicArticulation');
    const r = stream(this.seed, 'arp', b);
    const response = m.response && b % this.style.phraseBars >= this.style.phraseBars / 2;
    for (let s = 0; s < n; s++) {
      const g = b * n + s; // global step keeps polymetric cycles continuous across bars
      if (g % m.division !== 0) continue;
      const slot = Math.floor(g / m.division);
      if (!m.rhythm[slot % m.rhythm.length]) continue;
      let note = seq[this.arpNote % seq.length];
      if (response) note = pool[Math.min(pool.length - 1, pool.indexOf(note) + 1)] ?? note; // answer phrase lifts by one chord tone
      this.arpNote++;
      const dur = (m.division / 4) * Math.max(0.25, Math.min(1.6, m.gate * (1.25 - 0.6 * art)));
      const accent = slot % m.rhythm.length === 0;
      ev.push({ voice: 'arp', beat: s / 4, dur, notes: [note], vel: (accent ? 0.85 : 0.66) * (1 - 0.1 * r()) * lv, accent });
    }
  }

  /** Ambient: sparse events, call in a low register, response higher. */
  private genConstellation(b: number, ev: NoteEvent[], lv: number) {
    const r = stream(this.seed, 'constellation', b);
    const beats = this.settings.beatsPerBar;
    const density = 0.3 + 0.7 * this.settings.density;
    const count = weighted(r, [[0, 1.2 - density], [1, 1.2], [2, density], [3, density * 0.4]] as const);
    const phraseBar = b % this.style.phraseBars;
    const call = phraseBar < this.style.phraseBars / 2;
    const reg = this.style.arpDefaults.register + (call ? 0 : 7) + this.arpMotif.registerShift * 12;
    const pcs = new Set([...this.chord.pcs]);
    const scaleNotes = scaleNotesInRange(this.tonicPc(), this.settings.scale, reg, reg + 14);
    // chord tones preferred, other scale tones allowed with lower weight
    const opts = scaleNotes.map((m) => [m, pcs.has(m % 12) ? 3 : 1] as const);
    const used = new Set<number>();
    for (let i = 0; i < count; i++) {
      let step = intBetween(r, 0, beats * 2 - 1);
      while (used.has(step)) step = (step + 1) % (beats * 2);
      used.add(step);
      const note = opts.length ? weighted(r, opts) : reg;
      ev.push({ voice: 'arp', beat: step / 2, dur: 1.5 + r() * 4, notes: [note], vel: (0.45 + 0.3 * r()) * lv });
    }
  }

  private genPad(b: number, ev: NoteEvent[], lv: number) {
    const c = this.chord;
    const st = this.style;
    const beats = this.settings.beatsPerBar;
    const v = this.padVoicing!;
    if (st.pad === 'stab') {
      const r = stream(this.seed, 'stab', b);
      const n = this.stepsPerBar();
      const pattern = this.settings.style === 'microhouse' ? euclid(3, 16, 2) : [false, false, true, false, false, false, false, false, false, false, chance(r, 0.4), false, false, false, chance(r, 0.25), false];
      for (let s = 0; s < n; s++) {
        if (!pattern[s % 16]) continue;
        ev.push({ voice: 'pad', beat: s / 4, dur: 0.22 + 0.2 * (1 - this.p('rhythmicArticulation')), notes: v, vel: (s % 16 === 2 ? 0.8 : 0.6) * lv, accent: s % 16 === 2 });
      }
      return;
    }
    const phraseStart = b % st.phraseBars === 0;
    const swellEvery = st.pad === 'swell' ? 2 : st.phraseBars;
    const start = c.startBar === b || phraseStart || b === this.layers.pad.since || (st.pad === 'swell' && b % swellEvery === 0) || this.forceArticulation;
    if (!start) return;
    const untilChord = c.startBar + c.bars - b;
    const untilPhrase = st.phraseBars - (b % st.phraseBars);
    const bars = Math.max(1, Math.min(untilChord, untilPhrase, st.pad === 'swell' ? swellEvery : 99));
    ev.push({ voice: 'pad', beat: 0, dur: bars * beats - 0.05, notes: v, vel: 0.62 * lv });
  }

  private genDrums(b: number, ev: NoteEvent[], lv: number) {
    const s = this.settings;
    const n = this.stepsPerBar();
    const r = stream(this.seed, 'drums', b);
    const kit = this.style.drums;
    const groups = METER_GROUPS[s.beatsPerBar] ?? [s.beatsPerBar];
    const groupStarts: number[] = [];
    let acc = 0;
    for (const g of groups) { groupStarts.push(acc * 4); acc += g; }
    const backbeats: number[] = [];
    acc = 0;
    for (const g of groups) { backbeats.push((acc + (g === 3 ? 2 : 1)) * 4); acc += g; }
    const intensity = clamp01(s.rhythmIntensity * (0.65 + 0.5 * this.energy) + 0.15 * this.drumDensity);
    const detail = clamp01(0.5 * s.density + 0.6 * this.p('rhythmicDetail') + 0.25 * this.drumDensity);
    const ghosts = clamp01(0.4 * s.complexity + 0.6 * this.p('percComplexity'));
    const phraseEnd = b % this.style.phraseBars === this.style.phraseBars - 1;
    const v = (x: number) => Math.min(1, x * (0.6 + 0.4 * intensity) * lv * (1 - 0.07 * r()));
    const hit = (voice: Voice, step: number, vel: number, dur = 0.25) => ev.push({ voice, beat: step / 4, dur, notes: [], vel: v(vel), accent: vel > 0.85 });
    const fill = phraseEnd && chance(r, 0.25 + 0.35 * s.variation) && kit !== 'pulse';

    switch (kit) {
      case 'motorik':
      case 'krautpop': {
        for (const g of groupStarts) hit('kick', g, 0.95);
        // the motorik push: an extra kick on the "and" after the second downbeat
        if (s.beatsPerBar === 4) hit('kick', kit === 'motorik' ? 10 : 6, 0.8);
        for (const bb of backbeats) if (!(fill && bb >= n - 4)) hit('snare', bb, 0.88);
        for (let i = 0; i < n; i += 2) hit('hatC', i, i % 4 === 0 ? 0.62 : 0.48, 0.12);
        for (let i = 1; i < n; i += 2) {
          if (kit === 'krautpop') {
            if (chance(r, 0.35 + 0.5 * detail)) hit('hatO', i, 0.32, 0.08); // tambourine-like sixteenths
          } else if (chance(r, detail * 0.75)) {
            hit('hatC', i, 0.3, 0.08);
          }
        }
        if (ghosts > 0.35) for (const gs of [7, 15]) if (gs < n && chance(r, ghosts * 0.6)) hit('snare', gs, 0.3);
        if (b % 4 === 3 && !fill) hit('hatO', n - 2, 0.5, 0.4);
        break;
      }
      case 'dub': {
        for (let i = 0; i < n; i += 4) hit('kick', i, 0.82);
        for (let i = 2; i < n; i += 4) hit(chance(r, 0.2) ? 'hatO' : 'hatC', i, 0.5, 0.18);
        for (let i = 1; i < n; i += 2) if (i % 4 !== 2 && chance(r, detail * 0.6)) hit('hatC', i, 0.22, 0.06);
        for (const bb of backbeats) if (chance(r, 0.35 + 0.5 * intensity)) hit('clap', bb, 0.45);
        break;
      }
      case 'berlin': {
        hit('kick', 0, 0.85);
        if (intensity > 0.5 && s.beatsPerBar >= 4) hit('kick', groupStarts[1] ?? 8, 0.7);
        for (let i = 0; i < n; i++) if (i % 2 === 0 || chance(r, detail)) hit('hatC', i, i % 4 === 0 ? 0.4 : 0.24, 0.06);
        if (chance(r, 0.35 + 0.4 * intensity)) hit('clap', backbeats[backbeats.length - 1], 0.55);
        break;
      }
      case 'pulse': {
        hit('kick', 0, 0.6, 0.5);
        if (intensity > 0.55) hit('kick', groupStarts[1] ?? 8, 0.4, 0.5);
        if (detail > 0.3) for (let i = 2; i < n; i += 4) hit('hatC', i, 0.16, 0.2);
        break;
      }
      case 'micro': {
        for (let i = 0; i < n; i += 4) hit('kick', i, 0.7, 0.2);
        for (let i = 2; i < n; i += 4) { const jitter = (r() - 0.5) * 0.06; ev.push({ voice: 'hatC', beat: i / 4 + jitter, dur: 0.05, notes: [], vel: v(0.36) }); }
        if (chance(r, 0.5)) hit('clap', backbeats[backbeats.length - 1], 0.35, 0.1);
        break;
      }
      case 'none':
        return;
    }
    if (fill) {
      for (let i = n - 4; i < n; i++) if (i % 2 === 0 || chance(r, 0.5)) hit('snare', i, 0.4 + 0.12 * (i - (n - 4)));
    }
  }

  private genPerc(b: number, ev: NoteEvent[], lv: number) {
    const n = this.stepsPerBar();
    const r = stream(this.seed, 'perc', b);
    const k = Math.max(2, Math.round(this.percLen * (0.18 + 0.3 * this.p('percTransients') + 0.2 * this.p('percComplexity'))));
    const pat = euclid(k, this.percLen, this.percRot);
    const tones = this.chord.pcs.map((pc) => 72 + ((pc - 0 + 12) % 12));
    for (let i = 0; i < n; i++) {
      const g = b * n + i;
      if (!pat[g % this.percLen]) continue;
      ev.push({ voice: 'perc', beat: i / 4, dur: 0.1, notes: [tones[(g >> 1) % tones.length]], vel: (0.35 + 0.25 * r()) * lv });
    }
  }

  private genTexture(b: number, ev: NoteEvent[], lv: number) {
    const s = this.settings;
    const r = stream(this.seed, 'texture', b);
    const beats = s.beatsPerBar;
    const t = this.style.texture;
    const sparkle = this.p('sparkle');
    const clicks = Math.round((t.clicks * (0.5 + s.density)) * 6 * r() + (this.p('percTransients') > 0.6 ? 1 : 0));
    for (let i = 0; i < clicks; i++) ev.push({ voice: 'click', beat: r() * beats, dur: 0.02, notes: [], vel: (0.2 + 0.3 * r()) * lv });
    if (chance(r, t.metal * (0.2 + 0.6 * sparkle))) {
      const notes = scaleNotesInRange(this.tonicPc(), s.scale, 79, 96).filter((m) => this.chord.pcs.includes(m % 12) || chance(r, 0.3));
      if (notes.length) ev.push({ voice: 'metal', beat: Math.floor(r() * beats * 2) / 2, dur: 1.5, notes: [pick(r, notes)], vel: (0.3 + 0.25 * r()) * lv });
    }
    if (b % 2 === 0 && chance(r, t.shimmer * (0.2 + 0.8 * sparkle))) {
      const top = this.chord.pcs.slice(0, 2).map((pc) => 84 + ((pc + 12) % 12));
      ev.push({ voice: 'shimmer', beat: 0, dur: beats * 2 - 0.1, notes: top, vel: 0.35 * lv });
    }
  }

  private applySwing(events: NoteEvent[]) {
    const sw = this.settings.swing;
    if (sw <= 0) return;
    for (const e of events) {
      const step = Math.round(e.beat * 4);
      if (Math.abs(e.beat * 4 - step) < 1e-6 && step % 2 === 1) e.beat += (sw * 0.25) / 1.5;
    }
  }
}

const cap = (l: string) => l[0].toUpperCase() + l.slice(1);

/** Generates `n` bars in one go (export, MIDI, tests). */
export function generateBars(settings: Partial<CompositionSettings>, params: ParamSet, n: number): BarPlan[] {
  const c = new Composer(settings, params);
  const out: BarPlan[] = [];
  for (let i = 0; i < n; i++) out.push(c.nextBar());
  return out;
}

export const barSeconds = (bpm: number, beats: number) => (60 / bpm) * beats;
