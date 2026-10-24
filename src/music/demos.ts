// Three listening demonstrations for composition engine 2: the same style
// (Motorik), key (A natural minor), tempo, profile (Profile A — Deep
// Botanical, Generative mode) and default controls, with different seeds. They
// were chosen by searching seeds for three different plans; the expected plan
// of each is pinned in tests/music/demos.test.ts so these notes stay true.

import type { CompositionSettings, EndingKind } from './composer';

export interface ListeningDemo {
  id: string;
  title: string;
  seed: number;
  /** what the plan contains, in a sentence */
  summary: string;
  /** form, as the Now Playing panel names the sections */
  form: string;
  listenFor: string[];
  /** checked by the demo test against the generated plan */
  expect: { blueprint: string; mainGroove: string; mainBass: string; contrastGroove?: string; contrastBass?: string; ending: EndingKind };
}

export const DEMO_SETTINGS: Partial<CompositionSettings> = {
  style: 'motorik', key: 'A', scale: 'natural_minor', bpm: 112, beatsPerBar: 4, swing: 0, arrangementBars: 128, autonomous: true,
};

/** A demo's settings. Its ending is pinned, so the demos keep the endings the owner rated after more endings were added. */
export const demoSettings = (d: ListeningDemo): Partial<CompositionSettings> => ({ ...DEMO_SETTINGS, seed: d.seed, ending: d.expect.ending });

export const LISTENING_DEMOS: ListeningDemo[] = [
  {
    id: 'A', title: 'A · Driving motorik, sparse syncopated bass', seed: 306,
    summary: 'A hypnotic form built on one straight driving groove under a sparse, syncopated bass and a four-bar melodic sentence.',
    form: 'Intro → A → A1 → A2 → Breakdown → A3 → Expansion → Return → Outro',
    listenFor: [
      'The groove arrives alone (drums and drone), then bass, melody and pad land together at bar 17.',
      'The bass leaves gaps: five notes a bar, off the kick, not a wall of eighths.',
      'A1–A3 vary the kick placement and hat accents; the melody keeps its four-bar shape.',
      'Bar 49: the drums fall away, the bass holds long notes and the melody plays at half speed.',
      'Bar 89: the original groove, bass and melody return unchanged.',
      'Bar 113: the outro resolves — the drums leave, then the bass; melody, pad and drone close on the home chord and ring out.',
    ],
    expect: { blueprint: 'Hypnotic evolution', mainGroove: 'Straight driving motorik', mainBass: 'Syncopated bass', ending: 'resolve' },
  },
  {
    id: 'B', title: 'B · Minimal pulse, contrasting B section', seed: 25,
    summary: 'A two-part form: a minimal four-on-the-floor pulse with an eighth-note bass and a melodic riff, against a B section with a different groove, bass and melodic motif on a new chord.',
    form: 'Intro → A → B → A′ → B′ → Outro',
    listenFor: [
      'A (bar 17): soft kick on every beat, no snare, a steady eighth-note bass, a short melodic riff.',
      'B (bar 41): the harmony moves, a straight motorik backbeat appears, the bass turns into long notes with gaps and a skipping arpeggio replaces the riff.',
      'A′ (bar 65): the first section comes back as it was.',
      'B′ (bar 89): the B groove returns with the A riff answered by the B arpeggio.',
      'Outro (bar 105): one layer leaves every four bars until melody, pad and drone close on A minor.',
    ],
    expect: { blueprint: 'Two-part exploration', mainGroove: 'Minimal motorik pulse', mainBass: 'Eighth-note ostinato', contrastGroove: 'Straight driving motorik', contrastBass: 'Sustained notes with gaps', ending: 'resolve' },
  },
  {
    id: 'C', title: 'C · Bass-driven jam with extended development', seed: 140,
    summary: 'A krautrock-jam form led by an eighth-note bass over a four-on-the-floor kick, with a contrasting galloping sequence and an extended improvisation before the original groove returns.',
    form: 'Primary groove → Motif development → Contrasting section → Extended improvisation → Original groove → Ending',
    listenFor: [
      'It starts in the groove: no intro, the bass drives from bar 1.',
      'Bar 25: the groove gets busier and the bass line\'s contour turns.',
      'Bar 41: a sparse kick, a galloping bass (an eighth and two sixteenths) and a rising arpeggio in pairs — a different texture.',
      'Bar 65: a long improvisation where the bass shifts onsets and two motifs answer each other.',
      'Bar 97: the original groove, bass and melody return.',
      'The last two bars: a snare roll, then the whole band lands on one final chord and lets it ring.',
    ],
    expect: { blueprint: 'Krautrock jam', mainGroove: 'Bass-driven motorik', mainBass: 'Eighth-note ostinato', contrastGroove: 'Sparse motorik', contrastBass: 'Galloping sequence', ending: 'button' },
  },
];
