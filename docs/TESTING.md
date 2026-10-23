# Testing and known limitations

```bash
npm test            # 104 unit tests (vitest, Node)
npm run build && npm run e2e   # 62 browser checks (playwright-core + cached Chrome for Testing, port 8757)
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
- No horizontal scroll at 390 and 820 px; no console errors.

## Defects found and fixed by testing

- `@tonejs/midi` 2.0.28 writes an invalid key-signature event (list index + 7, every key treated as major). Bytes are patched to spec values; the tests read the raw bytes.
- The whole-tone scale has no perfect fifth, so a drone fifth was out of scale. Drone intervals now snap to the scale.
- Profile A's intro opened with a long-attack drone alone, about 5 s of near-silence. The intro now starts with two layers, and fresh drones fade in within 1.5 s.
- Short exports of sparse-intro styles were near-silent (−53 dBFS). Exports under 32 bars now use the full arrangement.
- A mid-piece style change fell back to a sparse intro. It now lands in the new style's core arrangement.
- The delay's loop saturator had a small-signal gain of 1.58. It is now normalised by drive (gain 1).
- The phone layout collapsed the profile header to one word per line. Grids now stack below 760 px.

## Known limitations

- **No human listening has been done by the developer.** Automated checks confirm that sound exists, at the right length and level, and that events follow the rules. They do not judge musical quality. Use the listening checklist on the About page.
- Audio was tested in headless Chrome for Testing (Chromium 1234) on macOS. Safari, Firefox and mobile devices were not tested on real hardware; layouts were checked at phone width.
- Web MIDI hardware learn was implemented but not exercised with a physical controller (none available to the test run).
- Long offline renders (128 bars plus stems, i.e. 7 renders) can take tens of seconds in the browser.
- Tone.js convolution-reverb regeneration during heavy morphing is throttled to once every 3 s, so large reverb changes land in steps.
