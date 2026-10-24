# Testing and known limitations

```bash
npm test            # 134 unit tests (vitest, Node)
npm run build && npm run e2e   # 74 browser checks (playwright-core + cached Chrome for Testing, port 8757)
npm run report:diversity       # regenerates docs/DIVERSITY_REPORT.md (engine 2 vs v0.1)
npm run build && npm run render:demos   # renders the three listening demos to demos/ and prints section levels
node tests/e2e/shots.mjs       # screenshots of every view at 1440 and 390 px (tests/e2e/out/shots)
```

## Unit tests (`tests/`)

**Chemistry (`tests/chem`)**
- All 16 required compounds exist; CID, formula, molecular weight and InChIKey match PubChem.
- Family is consistent with the formula.
- Stereoisomers are distinct records with the same skeleton.
- The 2D atom count matches the formula; the 3D atoms match the 2D atoms.
- Aroma categories come only from cited text.
- Unit conversion is valid only between mass fractions.
- Not-measured is never zero; not-detected is covered at zero; rejected or not-reported carry no number.
- Relative composition sums to 1.
- Editing creates a derived copy and leaves the source untouched.
- Randomise stays in bounds and is reproducible; morph endpoints are correct.
- The schema rejects negatives, out-of-range values, status/value mismatches, unknown analytes and unit mismatches.
- The library file round-trips, newer versions are refused, and bad items are reported individually.
- Similarity is symmetric, scale-invariant and bounded, uses shared analytes only, and follows the confidence thresholds; rank comparison is labelled approximate.
- Adapters keep sources, floors and flags; Smith values are ≤ 5 %; CT zeros are flagged ambiguous.
- Same-product pairs are more similar than random pairs.

**Music (`tests/music`)**
- 12 scales match an independent interval table; diatonic chords are built correctly (including the major V in harmonic minor); chord tones are always in the scale.
- Transposition preserves intervals; voice leading averages ≤ 2 semitones per voice; Euclidean patterns are canonical.
- Identical seeds give identical events (8 styles × 96 bars); different seeds differ by > 15 %; reset replays the same piece.
- Every pitched note is in the scale (8 styles × 11 scales); events are valid in 3/4, 4/4, 5/4 and 7/4.
- Development only at phrase boundaries; static styles change chords only at section boundaries; a krautrock piece holds one chord; the Berlin progression moves.
- Autonomous mode evolves and the frozen mode stays fixed; finite pieces have an intro and outro; the motorik template is checked.
- A style change mid-piece is musical; 1,024 endless bars run cleanly.
- Profiles A and B differ in generative mode and are identical in analytical mode.

**Compositional diversity (`tests/music/diversity.test.ts`, `demos.test.ts`)** — see *Diversity metrics* below.
- For 12 seeds per style (same style, key, scale and profile), drum onset dissimilarity exceeds 0.2 and 3× v0.1; in each piece's main section it exceeds 2× v0.1 *and* v0.1's own within-piece noise floor + 0.08.
- Main-section bass onsets differ by > 0.3 (> 0.15 for Berlin, whose identity is a running sequence), never less than v0.1, with at least 5 distinct main bass rhythms in 12 seeds.
- Bass lengths, melodic rhythm and melodic contour differ (> 0.2–0.25) in five styles; at least 5 of 12 seeds open on a different core drum/bass pattern; section orders differ (normalised edit distance > 0.3) and at least two blueprints appear per style; phrase lengths vary.
- The metric is pitch-blind: a transposed copy scores 0.
- Groove diversity 0 keeps every seed on the canonical groove; 1 yields at least four archetypes.
- Identity: in first-cycle A sections the two most common kick/snare patterns cover ≥ 75 % of bars; return sections reuse ≥ 60 % of A's bass patterns; contrast sections differ from A in at least one major dimension; the primary motif comes back after leaving in ≥ 25 of 40 pieces; endless pieces produce new related material over 640 bars and keep returning to the original groove.
- Style identity: motorik keeps a kick on the downbeat (≥ 90 % of groove bars) and an eighth pulse (≥ 85 %), even at Groove diversity 1; dub techno and microhouse keep four on the floor (≥ 85 %); ambient and drone stay drumless.
- Determinism: identical inputs give byte-identical BarPlans (materials and forms included); analytical mode gives byte-identical plans for different profiles.
- The listening demos' written descriptions match their generated plans.

**Sonification and audio, pure (`tests/sonify`)**
- Curves are monotonic; missing analytes disable routes; muting excludes an analyte; percentile and fallback bases work.
- Targets stay in [0,1]; A and B move in the expected directions; morph endpoints are correct.
- A 2,000-case fuzz of audio parameters stays inside the safety limits.
- dB mapping; WAV encode/decode (16- and 24-bit, INFO metadata, exact length).
- MIDI round trip (tempo, metre, spec-correct key signature, every note at the right tick); ZIP CRC.

## Browser end-to-end (`tests/e2e/run.mjs`)

The suite runs against the **built** app under the GitHub Pages base path, and checks that the preview server identifies as this app before starting.

- **Demo scenario:** both profiles visible; A plays real audio (live RMS); bars advance; Stop silences; B plays; the Synth follows B; repeated play/stop stays healthy.
- **Offline self-test:** each of the 6 modules is non-silent; render length is sample-exact; peak below −0.3 dBFS; mix level is musical.
- **Paths:** assets and lazy data resolve under `/terpene-lab-synth/`; navigation to all six sections; hash deep links.
- **Lab:** editing a demo creates a derived hypothetical copy, the original is unchanged, an edit notice appears, and edits reach the Synth live; mute removes the analyte from the mapping; add channel; save; the library persists across reload (IndexedDB); rename.
- **Library:** export is versioned; import adds valid items and reports invalid ones.
- **Explore:** search; similarity ranking; 43,148 samples lazy-load; CT products load; send to Compare.
- **Compare:** score and confidence; shared and unique compounds; A/B in Analytical mode; morph moves while playing; style change while playing; keyboard knobs; audio continues through live changes.
- **Export:**
  - WAV is a real 16-bit 44.1 kHz stereo file of exact length, contains music and peaks below −0.3 dBFS; its filename carries key, tempo and seed.
  - Stems ZIP holds 6 WAVs plus a README, with identical audio length.
  - MIDI is a valid SMF.
  - The preset contains the profile, seed and mapping; compositions save.
- **Engine 2:** the listening session lists three demos and the three development knobs; Audition loads the demo (seed, Generative mode, 128 bars) and plays real audio; Now Playing shows the planned form with the current section marked and names the groove, bass and melody; live playback over 17+ bars, across a section change, matches the offline plan event for event; a demo stops from its card; no horizontal scroll at 390 px.
- A finished piece rings out after its last bar (sound continues, nothing new plays) and the transport then stops by itself.
- No horizontal scroll at 390 and 820 px; no console errors.

## Defects found and fixed by testing

- `@tonejs/midi` 2.0.28 writes an invalid key-signature event (list index + 7, every key treated as major). Bytes are patched to spec values; the tests read the raw bytes.
- The whole-tone scale has no perfect fifth, so a drone fifth was out of scale. Drone intervals now snap to the scale.
- Profile A's intro opened with a long-attack drone alone, about 5 s of near-silence. The intro now starts with two layers, and fresh drones fade in within 1.5 s.
- Short exports of sparse-intro styles were near-silent (−53 dBFS). Exports under 32 bars now use the full arrangement.
- A mid-piece style change fell back to a sparse intro. It now lands in the new style's core arrangement.
- The delay's loop saturator had a small-signal gain of 1.58. It is now normalised by drive (gain 1).
- The phone layout collapsed the profile header to one word per line. Grids now stack below 760 px.
- Engine 2: whole-piece rhythm histograms made pieces with contrasting sections look *more* alike than one-motif v0.1 pieces. Each piece's main section is now compared too ("identity bars").
- Engine 2: outros dropped the drone and pad first (the opposite of a dissolve). Outros now keep what is playing and remove one layer per phrase, sustained layers last.
- Engine 2: breakdowns measured as loud as the main sections in the rendered demo (−21.9 vs −21.5 dBFS), because held bass notes carry more low end than the line they replace. Breakdowns now lower bass and drone; the re-rendered breakdown is −25.6 dBFS.
- Engine 2: strong-beat chord-tone snapping always tried the note below first, turning rising lines into repeated notes. It now snaps in the direction the line moves.
- **Owner listening (0.2.1):** speaker crackles on kick hits in all three demos. Measured in the rendered WAVs: every peak reaching the limiter (5, 1 and 14 per piece — "occasional") fell on a beat. Tone.Limiter's 10 ms release is shorter than one 55 Hz kick period, so it distorted the waveform. Fixed with a 150 ms-release limiter and 2 dB more headroom.
- **Owner listening (0.2.1):** demo A ended in a hard stop. Two causes: live playback scheduled the bar *after* the final bar and cut it 50 ms later, and a 16-bar outro still had the full band in its last bar. Now nothing is scheduled after the final bar, finished pieces ring out (3 s, then a 1.5 s fade), outros resolve on a four-bar schedule or end on a "button", and the last bar always comes home to the tonic.
- E2E: single 23 ms analyser snapshots could fall between notes (a demo measured 0.0015 at one instant, 0.081 mean over 3 s). Live-level checks now average over 2–3 s.

## Diversity metrics

All in `src/music/analysis.ts`. Rhythm metrics use onset *positions* only (sixteenth step = ⌊beat × 4 + 0.4⌋, tolerant of swing and micro-timing), so pitch or timbre changes never count as rhythmic diversity.

- **Onset histogram:** for each voice and step, the fraction of bars (where the voice group plays) with an onset there.
- **Bray–Curtis dissimilarity** Σ|a−b| / Σ(a+b) between two pieces' histograms: 0 = the same rhythm, 1 = nothing in common. Used for drums (kick, snare, clap, closed and open hat), bass, melody, and bass note-length histograms (sixteenths, capped at 32).
- **Melodic contour:** consecutive intervals become tokens (direction × repeat / step ≤ 2 / skip ≤ 5 / leap); the distribution of token trigrams is compared with Bray–Curtis.
- **Section order:** the sequence of section roles, compared with normalised Levenshtein distance.
- **Identity bars:** the first main section of a piece (v0.1: bars 16–47), because a whole-piece average blurs pieces that contain contrasting sections.
- **Noise floor:** v0.1 re-rolled hats every bar, so two windows of the same v0.1 piece differ; between-piece distances are required to exceed it.
- **Pattern reuse:** the fraction of a section's bars whose pattern appears in a reference section.

Results per style: [DIVERSITY_REPORT.md](DIVERSITY_REPORT.md).

## Known limitations

- **No human listening has been done by the developer.** Automated checks confirm that sound exists, at the right length and level, and that events follow the rules. They do not judge musical quality. Use the listening checklist on the About page.
- Audio was tested in headless Chrome for Testing (Chromium 1234) on macOS. Safari, Firefox and mobile devices were not tested on real hardware; layouts were checked at phone width.
- Web MIDI hardware learn was implemented but not exercised with a physical controller (none available to the test run).
- Long offline renders take time: a 128-bar WAV took 6–10 minutes in headless Chrome on this machine (the demo renders); stems multiply that by six.
- Composition engine 2 was not listened to by the developer. Its diversity is measured on generated events and its loudness on rendered audio; musical quality is for the owner's ears (Synth → Listening session).
- Tone.js convolution-reverb regeneration during heavy morphing is throttled to once every 3 s, so large reverb changes land in steps.
