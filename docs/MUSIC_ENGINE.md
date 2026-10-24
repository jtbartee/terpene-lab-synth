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

## Hierarchy (engine 2)

steps (16ths) → beats → bars → **phrases** (4, 8 or 16 bars, seeded per piece) → **sections** (planned by a blueprint) → **cycles** (endless pieces).

The full design, the audit of v0.1 and the research behind it are in [COMPOSITION_ENGINE_2.md](COMPOSITION_ENGINE_2.md). In short:

- **The piece is planned first.** A blueprint gives sections with roles (intro, main, variation, contrast, breakdown, build, peak, return, outro), lengths, energy, material, harmonic behaviour, a development mode and a transition. Finite arrangements are fitted to their length; endless pieces plan new cycles.
- **A material bank is the piece's memory:** a main and a contrasting groove (`groove.ts`), bass motif (`bass.ts`) and melodic motif (`melody.ts`); stab rhythms; pad modes; harmonic loops for home and away. It also tracks developed forms, the distance from the originals and section history.
- **Harmony** follows the section: static and drone styles hold one chord per section (the home chord, or an away chord with probability set by Harmonic movement); progression and field styles cycle a home loop, an away loop or a fresh, faster walk; vamps alternate a home or away pair. Chord kinds are fixed per degree, so a chord keeps its colour when it returns.
- **Development:** sections switch material and arrangement at their start. Phrases inside a section make 0–3 decisions whose kind depends on the section (restrain, develop, contrast, strip, build, restate, dissolve). Motifs that drift too far return to their original form. At most one layer enters or leaves per phrase inside a section.
- **Autonomous evolution off:** one main section with the style's core arrangement; harmony still follows the style.
- **Style or profile change mid-piece:** the new plan lands in its main material and core arrangement, not a sparse intro.

## Layers

| Layer | Behaviour |
|---|---|
| Drone | Root + scale-snapped intervals; re-articulated at chord changes and phrase starts; two alternating voices cross-fade; lowered in breakdowns |
| Bass | A motif from the style's bass family (11 archetypes) chosen to interlock with the kick; rhythm, lengths, accents, articulation and pitches vary independently; mutations change rhythm as well as pitch; stepwise approach into chord changes |
| Melody (arp voice) | An arpeggio figure (rhythm × contour cell, possibly phasing) or a melodic hook (riff, call and response, sentence, period, constellation); motivic transformations; rests; a second motif can answer the first |
| Pads | Voice-led sustained chords, swells, stab rhythms (main and contrasting), or off-beat chord pulses in contrasting sections |
| Drums | A groove from the kit's family: a 1–2-bar cycle with fixed detail and ghost positions, feel (swing, lay-back), fills, section transitions |
| Perc | Euclidean tuned percussion from the groove or the piece, possibly in a cycle against the bar |
| Texture | Seeded clicks, metallic pings and shimmer, more exposed in breakdowns |

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
