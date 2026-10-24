# Sonification — terpene-to-sound mapping

Code: `src/sonify/` (targets and mapping), `src/audio/params.ts` (target → bounded audio value).

> Every chemical-to-musical relationship here is an **artistic design choice**. None is evidence of a psychological, physiological or acoustic property of a compound. There is no scientific rule that a terpene determines a frequency, tempo or emotion.

## Pipeline

```
original measurement (never modified)
 → feature 0..1      relative share ÷ 0.40, or percentile among 43,148 Smith et al. flower samples
 → response curve    linear | exponential (x²) | logarithmic | s-curve
 → contribution      depth (−1..1) × curve(feature)
 → target 0..1       clamp(neutral + Σ contributions)
 → audio value       bounded range per parameter (params.ts), with hard safety limits
 → smoothing         rampTo over 0.05–6 s (driven by "transition smoothness")
```

**Feature basis** (per mapping preset):

- `auto` — percentile for absolute-unit (% w/w) profiles, relative share for hypothetical weights.
- `relative` — always share of the measured total; a 40 % share = 1.0.
- `percentile` — empirical percentile of the % w/w value among Smith et al. flower samples. Borneol, fenchol, geraniol and valencene have no Smith reference, so they fall back to relative share, with a visible note.

**Missing data:** an analyte that is not measured (or is muted in the Lab) produces no feature. Its routes contribute nothing, and a target whose routes all lack data stays at its **neutral** value, labelled "neutral" in the matrix. Missing is never read as zero.

## Default mapping (brief table)

Primary depth is 0.7 and secondary 0.4, with linear curves.

| Compound | Primary | Secondary |
|---|---|---|
| β-Myrcene | Drone depth | Low-frequency harmonics |
| Limonene | Filter brightness | Upper harmonic energy |
| β-Caryophyllene | Percussive complexity ◆ | Saturation |
| α-Pinene | Pluck articulation | Stereo motion |
| β-Pinene | Transient brightness | Rhythmic detail ◆ |
| Linalool | Pad envelope length | Reverb diffusion |
| α-Humulene | Low-mid texture | Filter resonance |
| Terpinolene | Arpeggiator complexity ◆ | Melodic mutation ◆ |
| Ocimene | High-frequency modulation | Textural sparkle ◆ |
| Nerolidol | Slow modulation (rate) | Sustained texture |
| α-Bisabolol | Transition smoothness ◆ | Pad blending |
| Camphene | Percussive transients ◆ | Bright noise |
| Borneol | Resonant accents | Modulated texture |
| Fenchol | Filter movement | Rhythmic articulation ◆ |
| Geraniol | Upper-register pads ◆ | Harmonic overtones |
| Valencene | Delay character | Stereo modulation |

◆ = compositional target (changes notes, rhythms or arrangement). The other 22 targets are timbral or mix.

Built-in presets: default; primary only; timbre only (no ◆ routes); gentle (s-curves, 60 % depth); population percentile (log curves). Users can edit any route (compound, target, depth −1..1, curve, on/off), add or remove routes, and save presets locally.

## Two modes

- **Analytical sonification:** ◆ targets are held at neutral, and the seed stays locked. Every profile plays the identical reference composition, and only timbre and mix change. A unit test asserts that Profiles A and B produce byte-identical event sequences in this mode while their filter brightness differs.
- **Generative composition:** ◆ targets also shape the composer — density, ghost notes, arpeggio span and order, mutation rate, gate lengths, pad register, arrangement change rate and texture event density. Musicality comes first: data biases weighted decisions inside each style's rules and never overrides scale, metre or phrase structure.

## Safety

`LIMITS` in `params.ts`, enforced by a 2,000-case fuzz test:

- filter cutoffs 80 Hz – 12 kHz; Q ≤ 9
- drive ≤ 0.55
- delay feedback ≤ 0.82, with a soft-clip saturator in the loop normalised by its drive, so small-signal gain is exactly 1 and peaks are bounded at 1/1.4
- reverb decay ≤ 12 s; LFO rate ≤ 9 Hz
- ramps 0.05–6 s
- every send ≤ 1

The master chain is −2 dB input trim → high-pass 28 Hz → compressor (−14 dB, 2.5:1) → limiter (−1.5 dBFS, 2 ms attack, 150 ms release) → composition fader (a fade-out ending; 1 otherwise) → volume. The scopes read after the fader. The limiter's release is deliberately longer than a kick drum's period: Tone.Limiter's default 10 ms release moved the gain inside each 55 Hz kick cycle and crackled (found from owner listening, 0.2.1). Offline renders get a last-resort trim to −0.3 dBFS. In the 8-bar test renders, peaks measured −5 to −10 dBFS, and the trim did not engage.

## Morphing

The controls of A and B are computed separately and interpolated linearly per target. Timbral parameters ramp continuously; the composer reads the interpolated controls at each bar boundary, so pattern changes land on bar lines. The UI labels the interpolated mix as a synthetic transition.

## Example: why A and B sound different (default mapping, generative mode)

- **A (myrcene 40, caryophyllene 20, limonene 15, linalool 15, pinenes 5+5):** drone depth 1.00, low harmonics 0.75, pad envelope 0.71, reverb 0.55, filter brightness 0.66; no terpinolene, so arpeggiator complexity stays neutral (0.35).
- **B (limonene 35, caryophyllene 25, terpinolene 20, myrcene 10, pinenes 5+5):** filter brightness 1.00, arpeggiator complexity 0.70, melodic mutation 0.45, percussive complexity 0.74, drone depth 0.53.
