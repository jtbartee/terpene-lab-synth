import { describe, expect, it } from 'vitest';
import { DEMO_A, DEMO_B } from '../../src/chem/demo';
import { Composer, PITCHED_VOICES, generateBars, type BarPlan, type CompositionSettings } from '../../src/music/composer';
import { STYLE_IDS } from '../../src/music/styles';
import { SCALES, inScale, keyPc } from '../../src/music/theory';
import { BUILT_IN_PRESETS, computeControls } from '../../src/sonify/mapping';
import { neutralParams } from '../../src/sonify/targets';

const P = neutralParams();
const strip = (bars: BarPlan[]) => JSON.stringify(bars.map((b) => [b.events, b.chord.symbol, b.development]));
const pitched = (bars: BarPlan[]) => bars.flatMap((b) => b.events.filter((e) => PITCHED_VOICES.has(e.voice)).flatMap((e) => e.notes));

describe('determinism', () => {
  it('the same seed and settings give identical event sequences', () => {
    for (const style of STYLE_IDS) {
      const a = generateBars({ style, seed: 42 }, P, 96);
      const b = generateBars({ style, seed: 42 }, P, 96);
      expect(strip(a)).toBe(strip(b));
    }
  });

  it('different seeds give meaningfully different music', () => {
    for (const style of STYLE_IDS) {
      const a = pitched(generateBars({ style, seed: 1 }, P, 64));
      const b = pitched(generateBars({ style, seed: 2 }, P, 64));
      const n = Math.min(a.length, b.length);
      let diff = Math.abs(a.length - b.length);
      for (let i = 0; i < n; i++) if (a[i] !== b[i]) diff++;
      expect(diff / Math.max(a.length, b.length, 1)).toBeGreaterThan(0.15);
    }
  });

  it('regenerating (reset) restarts the identical piece rather than stacking new events', () => {
    const c = new Composer({ seed: 9 }, P);
    const first = Array.from({ length: 16 }, () => c.nextBar());
    c.reset();
    const again = Array.from({ length: 16 }, () => c.nextBar());
    expect(strip(again)).toBe(strip(first));
    expect(again[0].index).toBe(0);
  });
});

describe('scale and event validity', () => {
  it('every pitched note belongs to the selected scale, for every style and scale', () => {
    for (const style of STYLE_IDS) {
      for (const sc of SCALES) {
        if (sc.id === 'chromatic') continue;
        const bars = generateBars({ style, scale: sc.id, key: 'A', seed: 7 }, P, 48);
        for (const n of pitched(bars)) expect(inScale(n, keyPc('A'), sc.id), `${style}/${sc.id} note ${n}`).toBe(true);
      }
    }
  });

  it('transposing the key transposes the music', () => {
    const a = generateBars({ key: 'A', seed: 5, style: 'berlin' }, P, 16);
    const c = generateBars({ key: 'C', seed: 5, style: 'berlin' }, P, 16);
    // the style suggests a scale, but the user's scale setting (default natural minor) wins
    for (const n of pitched(c)) expect(inScale(n, keyPc('C'), 'natural_minor')).toBe(true);
    expect(a[0].chord.symbol.startsWith('A')).toBe(true);
    expect(c[0].chord.symbol.startsWith('C')).toBe(true);
  });

  it('events have valid times, durations, velocities and pitches in every metre', () => {
    for (const beatsPerBar of [3, 4, 5, 7] as const) {
      for (const style of STYLE_IDS) {
        const bars = generateBars({ style, beatsPerBar, seed: 3, swing: 0.3 }, P, 32);
        for (const b of bars) {
          expect(b.beats).toBe(beatsPerBar);
          for (const e of b.events) {
            expect(e.beat).toBeGreaterThanOrEqual(-0.05);
            expect(e.beat).toBeLessThan(beatsPerBar);
            expect(e.dur).toBeGreaterThan(0);
            expect(e.vel).toBeGreaterThan(0);
            expect(e.vel).toBeLessThanOrEqual(1);
            for (const n of e.notes) { expect(n).toBeGreaterThanOrEqual(21); expect(n).toBeLessThanOrEqual(108); }
          }
        }
      }
    }
  });
});

describe('structure', () => {
  it('development happens only at phrase boundaries; inside a section at most one layer enters or leaves at once', () => {
    for (const style of STYLE_IDS) {
      const bars = generateBars({ style, seed: 11, variation: 1 }, P, 256);
      for (const b of bars) {
        const arrangement = b.development.filter((d) => !d.startsWith('Harmony') && !d.startsWith('Drums return'));
        if (b.phraseBar !== 0) expect(arrangement, `${style} bar ${b.index}`).toEqual([]);
        const inOut = b.development.filter((d) => /enters|drops out/.test(d) && !d.startsWith('A secondary'));
        // a section start may re-arrange a few layers at once (a breakdown, a return); a phrase inside a section moves one
        expect(inOut.length, `${style} bar ${b.index}`).toBeLessThanOrEqual(b.section.bar === 0 ? 4 : 1);
      }
    }
  });

  it('static-harmony styles change chords only on section boundaries', () => {
    for (const style of ['motorik', 'dub_techno', 'microhouse', 'drone'] as const) {
      const bars = generateBars({ style, seed: 21, harmonicMovement: 1 }, P, 256);
      for (let i = 1; i < bars.length; i++) {
        if (bars[i].chord.symbol !== bars[i - 1].chord.symbol) expect(bars[i].section.bar, `${style} bar ${i}`).toBe(0);
      }
    }
  });

  it('a krautrock piece can stay on one chord for a long time', () => {
    const bars = generateBars({ style: 'motorik', seed: 4, harmonicMovement: 0 }, P, 64);
    const symbols = new Set(bars.map((b) => b.chord.symbol));
    expect(symbols.size).toBeLessThanOrEqual(2);
  });

  it('the Berlin progression actually moves', () => {
    const bars = generateBars({ style: 'berlin', seed: 4, harmonicMovement: 0.8 }, P, 64);
    expect(new Set(bars.map((b) => b.chord.symbol)).size).toBeGreaterThanOrEqual(3);
  });

  it('autonomous evolution changes the arrangement over time; switching it off freezes it', () => {
    const cfg = (b: BarPlan) => Object.entries(b.layers).filter(([, v]) => v.on).map(([k]) => k).join(',');
    const evolving = generateBars({ style: 'motorik', seed: 8, autonomous: true }, P, 256);
    expect(new Set(evolving.map(cfg)).size).toBeGreaterThanOrEqual(4);
    const frozen = generateBars({ style: 'motorik', seed: 8, autonomous: false }, P, 128);
    expect(new Set(frozen.map(cfg)).size).toBe(1);
    expect(frozen.every((b) => b.development.filter((d) => !d.startsWith('Harmony') && !d.startsWith('New section')).length === 0)).toBe(true);
  });

  it('the arrangement is never empty and finite pieces end with an outro', () => {
    const bars = generateBars({ style: 'kosmische', seed: 13, arrangementBars: 128 }, P, 128);
    for (const b of bars) expect(Object.values(b.layers).some((l) => l.on) || b.events.length > 0).toBe(true);
    expect(bars[127].final).toBe(true);
    expect(bars[127].section.role).toBe('outro');
    expect(['intro', 'main']).toContain(bars[0].section.role);
  });

  it('the motorik template has kick on 1 and 3, backbeat on 2 and 4, and steady eighth hats', () => {
    const c = new Composer({ style: 'motorik', seed: 1, autonomous: false, rhythmIntensity: 0.6 }, P);
    const bar = c.nextBar();
    const at = (v: string) => bar.events.filter((e) => e.voice === v).map((e) => e.beat);
    expect(at('kick')).toEqual(expect.arrayContaining([0, 2]));
    expect(at('snare')).toEqual(expect.arrayContaining([1, 3]));
    const hats = at('hatC').filter((x) => Math.abs(x * 2 - Math.round(x * 2)) < 1e-9);
    expect(new Set(hats).size).toBe(8);
  });

  it('a style change mid-piece lands in the new style\'s core arrangement, not a sparse intro', () => {
    const c = new Composer({ style: 'motorik', seed: 3 }, P);
    for (let i = 0; i < 4; i++) c.nextBar();
    c.setSettings({ style: 'dub_techno' });
    const b = c.nextBar();
    const on = Object.entries(b.layers).filter(([, v]) => v.on).map(([k]) => k);
    expect(on).toEqual(expect.arrayContaining(['bass', 'pad', 'drums']));
    expect(b.index).toBe(4);
  });

  it('long endless runs stay healthy', () => {
    const c = new Composer({ style: 'microhouse', seed: 99 }, P);
    let events = 0;
    for (let i = 0; i < 1024; i++) events += c.nextBar().events.length;
    expect(events).toBeGreaterThan(1024 * 4);
  });
});

describe('profiles drive the music', () => {
  const base: Partial<CompositionSettings> = { style: 'motorik', seed: 777 };
  const preset = BUILT_IN_PRESETS[0];

  it('generative mode: profile A and B produce different compositions', () => {
    const pa = computeControls(DEMO_A, preset, 'generative').params;
    const pb = computeControls(DEMO_B, preset, 'generative').params;
    expect(strip(generateBars(base, pa, 64))).not.toBe(strip(generateBars(base, pb, 64)));
    // B is terpinolene-rich → more complex arpeggiation; A has none
    expect(pb.arpComplexity).toBeGreaterThan(pa.arpComplexity);
    expect(pa.droneDepth).toBeGreaterThan(pb.droneDepth);
  });

  it('analytical mode: different profiles modulate one identical reference composition', () => {
    const pa = computeControls(DEMO_A, preset, 'analytical').params;
    const pb = computeControls(DEMO_B, preset, 'analytical').params;
    expect(strip(generateBars(base, pa, 64))).toBe(strip(generateBars(base, pb, 64)));
    expect(pa.filterBrightness).not.toBe(pb.filterBrightness); // …while timbre still differs
  });

  // pitches of the melodic layers and the chord path: the piece's identity, not its density
  const identity = (bars: BarPlan[]) => JSON.stringify(bars.map((b) => [
    b.chord.symbol,
    b.events.filter((e) => e.voice === 'arp' || e.voice === 'bass').map((e) => [e.voice, e.notes, e.beat]),
  ]));

  it('a profile variant gives the same seed different harmony and motifs; 0 is the seed alone', () => {
    expect(strip(generateBars({ ...base, variant: 0 }, P, 64))).toBe(strip(generateBars(base, P, 64)));
    const a = identity(generateBars({ ...base, variant: 11 }, P, 64));
    expect(identity(generateBars({ ...base, variant: 11 }, P, 64))).toBe(a);
    expect(identity(generateBars({ ...base, variant: 12 }, P, 64))).not.toBe(a);
    for (const style of STYLE_IDS) {
      const x = pitched(generateBars({ style, seed: 5, variant: 1 }, P, 64));
      const y = pitched(generateBars({ style, seed: 5, variant: 2 }, P, 64));
      const n = Math.min(x.length, y.length);
      let diff = Math.abs(x.length - y.length);
      for (let i = 0; i < n; i++) if (x[i] !== y[i]) diff++;
      expect(diff / Math.max(x.length, y.length, 1)).toBeGreaterThan(0.15);
    }
  });

  it('a new profile mid-piece finishes the phrase, then re-keys on the boundary', () => {
    const c = new Composer({ ...base, variant: 1 }, P);
    const before = Array.from({ length: 3 }, () => c.nextBar());
    const pb = before[0].phraseBars; // the phrase length is part of the plan (4, 8 or 16 bars)
    c.setSettings({ variant: 2 });
    const rest = Array.from({ length: pb + 8 }, () => c.nextBar()); // bars 3..
    const ref1 = generateBars({ ...base, variant: 1 }, P, pb);
    expect(strip([...before, ...rest.slice(0, pb - 3)])).toBe(strip(ref1)); // the rest of the phrase is untouched
    const at = rest[pb - 3];
    expect(at.index).toBe(pb);
    expect(at.development).toContain('New profile · the piece re-keys');
    expect(rest.slice(pb - 3).some((b) => b.events.length > 0)).toBe(true);
    // reverting before the boundary cancels the change
    const d = new Composer({ ...base, variant: 1 }, P);
    for (let i = 0; i < 3; i++) d.nextBar();
    d.setSettings({ variant: 2 });
    d.setSettings({ variant: 1 });
    const dRest = Array.from({ length: 13 }, () => d.nextBar());
    expect(strip(dRest)).toBe(strip(generateBars({ ...base, variant: 1 }, P, 16).slice(3)));
  });

  it('reset plans from the current parameters, not the ones in force when it was built', () => {
    const pa = computeControls(DEMO_A, preset, 'generative').params;
    const busy = { ...pa, percComplexity: 1, percTransients: 1, sparkle: 1 };
    const c = new Composer({ style: 'dub_techno', seed: 9 }, { ...pa, percComplexity: 0, percTransients: 0, sparkle: 0 });
    c.setParams(busy);
    c.reset();
    const got = Array.from({ length: 32 }, () => c.nextBar());
    expect(strip(got)).toBe(strip(generateBars({ style: 'dub_techno', seed: 9 }, busy, 32)));
  });
});
