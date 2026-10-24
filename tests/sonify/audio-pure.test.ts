import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { DEMO_A, DEMO_B } from '../../src/chem/demo';
import { hypotheticalFromWeights } from '../../src/chem/profile';
import { keySignatureBytes, midiBytes, readKeySignature } from '../../src/audio/midi';
import { DEFAULT_MIXER, LIMITS, computeAudioParams, levelToDb } from '../../src/audio/params';
import { decodeWav, encodeWav } from '../../src/audio/wav';
import { crc32, zipStore } from '../../src/audio/zip';
import { generateBars, DEFAULT_SETTINGS } from '../../src/music/composer';
import { STYLES, STYLE_IDS } from '../../src/music/styles';
import { mulberry32 } from '../../src/music/rng';
import { BUILT_IN_PRESETS, applyCurve, computeControls, computeFeatures, lerpParams, populationPercentile } from '../../src/sonify/mapping';
import { TARGETS, neutralParams, type ParamSet } from '../../src/sonify/targets';

describe('mapping engine', () => {
  const preset = BUILT_IN_PRESETS[0];

  it('response curves are monotonic and map [0,1] onto [0,1]', () => {
    for (const c of ['linear', 'exponential', 'logarithmic', 'scurve'] as const) {
      expect(applyCurve(0, c)).toBeCloseTo(0);
      expect(applyCurve(1, c)).toBeCloseTo(1);
      let prev = -1;
      for (let x = 0; x <= 1.0001; x += 0.05) { const y = applyCurve(x, c); expect(y).toBeGreaterThanOrEqual(prev); prev = y; }
      expect(applyCurve(5, c)).toBeCloseTo(1); // clamps out-of-range input
    }
  });

  it('missing analytes disable their routes instead of reading as zero', () => {
    const f = computeFeatures(DEMO_A, 'auto');
    expect(f.terpinolene.value).toBeNull();
    expect(f.terpinolene.basis).toBe('missing');
    const c = computeControls(DEMO_A, preset, 'generative');
    expect(c.targets.arpComplexity.contributions).toEqual([]);
    expect(c.targets.arpComplexity.fallback).toBe(true);
    expect(c.targets.arpComplexity.value).toBeCloseTo(TARGETS.find((t) => t.id === 'arpComplexity')!.neutral);
  });

  it('a muted analyte is excluded from the control vector', () => {
    const muted = computeControls(DEMO_A, preset, 'generative', new Set(['myrcene']));
    expect(muted.features.myrcene.value).toBeNull();
    expect(muted.targets.droneDepth.contributions).toEqual([]);
  });

  it('measured profiles use population percentiles; analytes without population data fall back to share', () => {
    expect(populationPercentile('myrcene', 0)).toBe(0);
    expect(populationPercentile('myrcene', 99)).toBe(1);
    const mid = populationPercentile('myrcene', 0.2636)!;
    expect(mid).toBeGreaterThan(0.35);
    expect(mid).toBeLessThan(0.45);
    const p = { ...DEMO_A, kind: 'lab_sample' as const, unit: 'pct_w_w' as const, measurements: {
      myrcene: { analyte: 'myrcene' as const, status: 'measured' as const, value: 0.8, unit: 'pct_w_w' as const },
      valencene: { analyte: 'valencene' as const, status: 'measured' as const, value: 0.1, unit: 'pct_w_w' as const },
    } };
    const f = computeFeatures(p, 'auto');
    expect(f.myrcene.basis).toBe('percentile');
    expect(f.valencene.basis).toBe('relative');
    expect(f.valencene.note).toMatch(/no population reference/);
  });

  it('every target stays within [0,1] for extreme profiles', () => {
    const extreme = hypotheticalFromWeights('x', Object.fromEntries(['myrcene', 'limonene', 'caryophyllene', 'terpinolene', 'ocimene', 'valencene', 'borneol'].map((k) => [k, 1000])));
    for (const pr of BUILT_IN_PRESETS) {
      for (const mode of ['analytical', 'generative'] as const) {
        const c = computeControls(extreme, pr, mode);
        for (const t of TARGETS) { expect(c.params[t.id]).toBeGreaterThanOrEqual(0); expect(c.params[t.id]).toBeLessThanOrEqual(1); }
      }
    }
  });

  it('A and B differ in the expected directions under the default mapping', () => {
    const a = computeControls(DEMO_A, preset, 'generative').params;
    const b = computeControls(DEMO_B, preset, 'generative').params;
    expect(a.droneDepth).toBeGreaterThan(b.droneDepth);        // myrcene 40 vs 10
    expect(b.filterBrightness).toBeGreaterThan(a.filterBrightness); // limonene 35 vs 15
    expect(a.padEnvelope).toBeGreaterThan(b.padEnvelope);      // linalool only in A
    expect(b.arpComplexity).toBeGreaterThan(a.arpComplexity);  // terpinolene only in B
  });

  it('morph interpolation hits both endpoints', () => {
    const a = computeControls(DEMO_A, preset, 'generative').params;
    const b = computeControls(DEMO_B, preset, 'generative').params;
    expect(lerpParams(a, b, 0)).toEqual(a);
    const end = lerpParams(a, b, 1);
    for (const k of Object.keys(b) as (keyof ParamSet)[]) expect(end[k]).toBeCloseTo(b[k], 12);
  });
});

describe('audio parameter safety', () => {
  it('fuzzed parameter sets always produce bounded, finite audio values', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 2000; i++) {
      const p = neutralParams();
      for (const k of Object.keys(p) as (keyof ParamSet)[]) p[k] = r();
      const style = STYLES[STYLE_IDS[i % STYLE_IDS.length]];
      const mixer = { ...DEFAULT_MIXER, globalFilter: r(), modDepth: r() };
      const ap = computeAudioParams(p, style, mixer, { arp: { timbre: i % 3, filter: r() * 1.6 - 0.8 }, bass: { timbre: i % 3, filter: r() * 1.6 - 0.8 } });
      const walk = (o: unknown, path: string) => {
        if (typeof o === 'number') { expect(Number.isFinite(o), path).toBe(true); return; }
        if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
      };
      walk(ap, 'ap');
      for (const c of [ap.drone.cutoff, ap.bass.cutoff, ap.arp.cutoff, ap.pad.cutoff]) { expect(c).toBeGreaterThanOrEqual(LIMITS.cutoffMin); expect(c).toBeLessThanOrEqual(LIMITS.cutoffMax); }
      expect(ap.bass.q).toBeLessThanOrEqual(LIMITS.qMax);
      expect(ap.arp.q).toBeLessThanOrEqual(LIMITS.qMax);
      expect(ap.bass.drive).toBeLessThanOrEqual(LIMITS.driveMax);
      expect(ap.drums.drive).toBeLessThanOrEqual(LIMITS.driveMax);
      expect(ap.fx.delayFeedback).toBeLessThanOrEqual(LIMITS.delayFeedbackMax);
      expect(ap.fx.reverbDecay).toBeLessThanOrEqual(LIMITS.reverbDecayMax);
      expect(ap.ramp).toBeGreaterThanOrEqual(LIMITS.rampMin);
      for (const s of Object.values(ap.fx.sends)) { expect(s.reverb).toBeLessThanOrEqual(1); expect(s.delay).toBeLessThanOrEqual(1); }
    }
  });

  it('channel levels map to dB with headroom and true silence at zero', () => {
    expect(levelToDb('drums', 0.8)).toBe(-8);
    expect(levelToDb('drums', 0)).toBe(-Infinity);
    expect(levelToDb('pad', 1)).toBeLessThan(0);
  });
});

describe('export encoders', () => {
  it('WAV encoding writes a valid stereo PCM file with metadata and exact length', () => {
    const sr = 44100;
    const len = sr * 2;
    const l = new Float32Array(len).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr));
    const rr = new Float32Array(len).map((_, i) => 0.25 * Math.sin((2 * Math.PI * 220 * i) / sr));
    const src = { numberOfChannels: 2, sampleRate: sr, length: len, getChannelData: (c: number) => (c ? rr : l) };
    const bytes = encodeWav(src, { info: { title: 'Test', comment: 'A natural minor, 112 BPM, seed 42' } });
    const d = decodeWav(bytes);
    expect(d.channels).toBe(2);
    expect(d.sampleRate).toBe(sr);
    expect(d.bits).toBe(16);
    expect(d.frames).toBe(len);
    expect(d.info.INAM).toBe('Test');
    expect(d.info.ICMT).toMatch(/112 BPM/);
    // first non-trivial sample matches within dither
    const v = new DataView(bytes.buffer);
    const s = v.getInt16(d.dataOffset + 4 * 100, true) / 32767;
    expect(s).toBeCloseTo(l[100], 3);
    const b24 = decodeWav(encodeWav(src, { bitDepth: 24 }));
    expect(b24.bits).toBe(24);
    expect(b24.frames).toBe(len);
  });

  it('MIDI export round-trips tempo, metre, key and every note at the right tick', () => {
    const settings = { ...DEFAULT_SETTINGS, seed: 5, bpm: 118, style: 'berlin' as const };
    const bars = generateBars(settings, neutralParams(), 48); // Berlin drums enter after the intro
    const bytes = midiBytes(bars, settings);
    const midi = new Midi(bytes);
    expect(Math.round(midi.header.tempos[0].bpm)).toBe(118);
    expect(midi.header.timeSignatures[0].timeSignature).toEqual([4, 4]);
    // A natural minor: no sharps or flats, minor flag set (read from raw bytes — see midi.ts)
    expect(readKeySignature(bytes)).toEqual({ sf: 0, mi: 1 });
    const drums = midi.tracks.find((t) => t.channel === 9);
    expect(drums).toBeDefined();
    const bass = midi.tracks.find((t) => t.name.startsWith('Bass'))!;
    const expectedBass = bars.flatMap((b) => b.events.filter((e) => e.voice === 'bass'));
    expect(bass.notes.length).toBe(expectedBass.length);
    const ppq = midi.header.ppq;
    // the first bar after bar 0 with bass (the arrangement plan decides when the bass enters)
    const barB = bars.find((b) => b.index > 0 && b.events.some((e) => e.voice === 'bass'))!;
    const first = barB.events.find((e) => e.voice === 'bass')!;
    expect(bass.notes.some((n) => n.ticks === Math.round((4 * barB.index + first.beat) * ppq) && n.midi === first.notes[0])).toBe(true);
    for (const t of midi.tracks) for (const n of t.notes) { expect(n.durationTicks).toBeGreaterThan(0); expect(n.velocity).toBeGreaterThan(0); }
  });

  it('key signatures follow the MIDI spec', () => {
    expect(keySignatureBytes('A', 'natural_minor')).toEqual({ sf: 0, mi: 1 });
    expect(keySignatureBytes('C#', 'natural_minor')).toEqual({ sf: 4, mi: 1 }); // E major's 4 sharps
    expect(keySignatureBytes('D', 'major')).toEqual({ sf: 2, mi: 0 });
    expect(keySignatureBytes('F', 'major')).toEqual({ sf: -1, mi: 0 });
    expect(keySignatureBytes('G', 'dorian')).toEqual({ sf: -2, mi: 1 }); // nearest: G minor
  });

  it('ZIP store writes correct CRCs and a parseable directory', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926); // standard check value
    const z = zipStore([{ name: 'a.txt', data: new TextEncoder().encode('hello') }, { name: 'b.bin', data: new Uint8Array([1, 2, 3]) }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const end = z.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
  });
});
