# Music engine — theory, generation and scheduling

Code: `src/music/` (pure TypeScript, no audio), `src/audio/` (Tone.js).

## Theory (`theory.ts`)

- **Scales** come from Tonal 6.4.3 and are checked in tests against an independent interval table. They are major, natural minor, harmonic minor, melodic minor (ascending), Dorian, Phrygian, Mixolydian, major and minor pentatonic, minor blues, whole-tone (experimental) and chromatic (experimental).
  - Tonal 6.5.0 was rejected because its package.json points `main`/`types` at files the package does not contain.
  - Chromatic harmony borrows natural-minor chords on the tonic so the music keeps a centre; this is documented in the UI.
  - The whole-tone scale has no perfect fifth, so drone intervals snap to the nearest scale tone.
- **Chords:** stacked from every other scale tone, giving thirds in seven-note scales and quartal-type stacks in pentatonic ones. Kinds are triad, seventh, ninth, add9, sus2, sus4 and power. A test verifies that every chord tone lies in the scale for every scale, degree and kind.
- **Voice leading:** candidates are every inversion at every octave within a register; the pad takes the candidate with minimum total voice movement. Tests require an average of ≤ 2 semitones per voice across a progression.
- **Euclidean rhythms:** onset at step i when (i·k) mod n < k. E(3,8) = x..x..x. (Toussaint 2005).
- **Metres:** 3/4, 4/4, 5/4 and 7/4, with accent groupings 3 | 2+2 | 3+2 | 2+2+3.

## Determinism (`rng.ts`)

Every musical decision draws from `stream(seed, purpose, position)`, a mulberry32 stream keyed by a hash. Purposes include harmony, bass, drums, arp, perc, texture, develop, energy, motifs and constellation. Layers are therefore independent: changing drum density never shifts which arpeggio notes are chosen. The same profile, settings, mapping and seed give byte-identical events; a test covers all 8 styles over 96 bars.

## Hierarchy

steps (16ths) → beats → **bars** → **8-bar phrases** → **16-bar sections** → arrangement arc.

- **Harmony** changes only at bar starts. Static and drone styles change only at section boundaries (tested), and a krautrock piece can sit on one chord for 64+ bars. Chord durations are powers of two, so changes stay on the phrase grid.
- **Development** happens only at phrase boundaries. Candidate events are weighted:
  - introduce a layer, or remove one (minimum dwell of two phrases)
  - arpeggio up or down an octave, rhythm rotation, motif mutation, return to the original motif
  - bass ostinato variation or return
  - pad inversion change; timbre change; slow filter open or close
  - rhythmic density up or down; stereo shift
  - a secondary polymetric percussion line (6-, 10-, 12- or 16-step cycle against the bar)
  - percussion drop-out for one phrase

  0–3 events are sampled without replacement, scaled by *variation* and reduced by *transition smoothness*. At most one layer enters or leaves per boundary, a layer is never changed twice at once, and the arrangement is never empty.
- **Intro:** layers enter one per phrase in the style's order, starting with two at ordinary density.
- **Energy arc:** finite pieces run intro → rise → breakdown near the middle → peak → outro. Endless pieces follow a slow seeded wave. Energy sets how many layers are wanted.
- **Autonomous evolution off:** the style's core arrangement is fixed; harmony still follows the style.
- **Style change mid-piece:** the new style starts in its core arrangement, not a sparse intro.

## Layers

| Layer | Behaviour |
|---|---|
| Drone | Root + scale-snapped intervals; re-articulated at chord changes and phrase starts; two alternating voices cross-fade |
| Bass | Per-style ostinato motif (motorik 8ths, dub sub, Berlin 16th sequence, walking, drone, micro stabs); root/third/fifth/seventh/octave; stepwise scale approach note before chord changes |
| Arpeggiator | Pool of chord tones (+9th at high complexity) over 1–3 octaves. Orders: up, down, up/down, constrained random, as-played (pad voicing), stored pattern. Euclidean rhythm over 4–16 slots. Divisions 16th / 8th / dotted 8th (polymetric) / quarter. Gate, rotation, register, mutation, call-and-response in the second half of a phrase. "Constellation" mode: sparse call/response notes for ambient |
| Pads | Voice-led sustained chords (capped at phrase length), swells every two bars, or dub/micro off-beat stabs |
| Drums | Per-style kit logic, swing, velocity humanisation, restrained fills at phrase ends |
| Perc | Euclidean tuned percussion, possibly in a different cycle length from the bar |
| Texture | Seeded clicks, rare metallic pings on scale tones, shimmer on chord tones; continuous noise beds in the engine |

## Styles (different rules, not presets)

| Style | Harmony | Drums | Bass | Arp | Pads |
|---|---|---|---|---|---|
| Motorik Minimalism | static, 16–32-bar chords | kick 1 & 3 plus push into 3, snare 2 & 4, even 8th hats | motorik 8ths | evolving | sustain |
| Kosmische Drift | slow field, add9/sus2 | soft heartbeat | drone | sparse | swell |
| Dub Techno | static minor 7th/9th | four-on-the-floor, off-beat hats, soft claps | dub sub | sparse | **stabs into dub delay** |
| Berlin Sequence | progression (4–8 bars), harmonic-minor V | light kick, shaker 16ths | 16th sequencer | 16th multi-octave sequence | sustain |
| Ambient Constellation | shifting field | none | drone | constellation | swell |
| Experimental Drone | root/fifth, rare modal shift | none | drone | sparse | swell |
| Krautpop Vamp | two-chord seventh vamp | motorik + tambourine 16ths | walking | evolving | sustain |
| Microhouse Clicks | static minor 7th | soft four-on-the-floor, jittered hats | Euclidean micro stabs | sparse | stabs |

Research references are named in the UI for each style (for example Neu!, Harmonia, Can, Stereolab, Tangerine Dream, Basic Channel, Deepchord, Pole, Jan Jelinek, Eno, Radigue). These are traits the rules emulate; no recordings, samples or melodies are copied. The defaults follow the brief: A natural minor, 112 BPM, 4/4, Motorik, autonomous and endless.

## Scheduling (`audio/sequencer.ts`)

- Bars are generated **one bar ahead**, and every note is placed with `Transport.scheduleOnce` at an exact tick. Stop and pause cancel all pending callbacks; nothing is left playing. Regenerate builds a fresh Composer and Sequencer, so callbacks never accumulate (e2e: repeated play/stop cycles).
- Audio-clock timing comes from Tone's look-ahead scheduler; the worker clock keeps background tabs on time. UI updates are scheduled via `Tone.Draw`.
- Monophonic sources get strictly increasing start times (Tone sources require it).
- Arrangement automation (layer gains, filter drift, pan) is applied at bar starts with ramps.
- **Live playback and offline export use the same Sequencer class**, so an export is the piece you heard.

## Audio engine (`audio/engine.ts`)

Six buses (drone, bass, arp, pad, drums, texture). Each bus is layer gain → tone filter → (drive on bass and drums) → channel (volume, pan, mute) → master, with reverb and delay sends.

- **Drone:** five fat-saw oscillators + sine sub → 24 dB low-pass with slow LFO → auto-pan, in two cross-fading layers.
- **Bass:** MonoSynth with selectable waveform, filter envelope and portamento.
- **Arp:** PolySynth → filter (LFO) → vibrato → auto-panner.
- **Pads:** PolySynth of fat custom partials → filter (LFO) → chorus → tape vibrato.
- **Drums:** synthesised — membrane kick tuned to the tonic, noise + body snare, three-burst clap, closed/open hats with choke, FM tuned percussion.
- **Texture:** pink-noise bed with band-pass LFO, hiss, brown low-mid grain, clicks, FM metallic pings, tremolo shimmer, tape vibrato.
- **FX:** convolution reverb (IR regenerated at most every 3 s); dub delay with high-pass, low-pass and a normalised tanh saturator inside the feedback loop, then chorus.

The master chain is described in `SONIFICATION.md`.
