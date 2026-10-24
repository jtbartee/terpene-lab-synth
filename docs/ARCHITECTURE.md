# Architecture

Static single-page app: React 19 + TypeScript 5.9 + Vite 8, with Tone.js 15 for audio and Tonal 6.4 for music theory. Zod 4 validates schemas, @tonejs/midi writes MIDI, and IBM Plex fonts are bundled. There is no server, account, paid API or secret, and it is hosted on GitHub Pages.

```
src/
  chem/      science engine — types, analyte registry, units, profile maths, similarity,
             aroma, schemas, dataset adapters, demo profiles (no React, no audio)
  music/     composition engine — seeded RNG, theory, styles, Composer; engine 2 adds
             arrangement blueprints, groove families, bass and melody motifs, analysis
             metrics and listening demos (no audio)
  sonify/    mapping engine — targets, features, curves, presets
  audio/     Tone.js engine, sequencer, live player, offline render, WAV/MIDI/ZIP
             encoders, self-test (lazy-loaded after a user gesture)
  store/     app state (useSyncExternalStore), actions, IndexedDB persistence
  ui/        App shell, sections (Explore, Lab, Synth, Compare, Library, About),
             components (Knob, badges, pickers), viz (charts, molecules, scope), MIDI learn
  styles/    one design-token stylesheet
scripts/     reproducible data pipeline (PubChem, Smith et al., CT registry, validation)
data/raw/    pubchem/ committed; large raw CSV/JSON git-ignored and re-downloadable
public/data/ lazy-loaded dataset assets (columnar JSON, gzip ≈ 1 MB / 240 kB / 110 kB)
tests/       vitest unit suites + playwright-core browser e2e
```

**Dependency direction:** `ui → store → (chem, music, sonify, audio)`. Music, chem and sonify never import UI or audio. Audio imports music and sonify types only.

**State:** a single store with small action helpers. Derived synth parameters are memoised per synth-state object (`currentParams`). The live player subscribes to settings, mixer and synth-state slices and applies changes with ramps. "Follow the Lab" mirrors Lab edits into Synth slot A, so every fader move is heard.

**Loading:** the main bundle (≈ 210 kB gzip, including all compound structures) loads first. Tone.js (≈ 65 kB gzip), the renderer and the encoders load on the first Play or Export. Datasets load only when Explore asks for them.

**Routing:** hash routes (`#/lab`, `#/synth`, …) need no server rewrites on GitHub Pages. Vite's `base` is `/terpene-lab-synth/` for build and preview.

**Persistence:** IndexedDB stores `profiles`, `presets`, `mappings` and `kv`, falling back to localStorage and then memory. All imports are validated with Zod; invalid items are reported individually and skipped.

**Accessibility:** semantic landmarks, skip link, visible focus ring, keyboard knobs (`role="slider"` with arrows, PageUp/PageDown, Home/End), native range inputs for faders, labelled canvases, status text alongside colour everywhere, `prefers-reduced-motion` (no auto-rotation or animation) and `prefers-contrast`, and responsive layouts tested at 390, 820 and 1440 px.

**Deployment:** `.github/workflows/deploy.yml` runs `npm ci`, typecheck, unit tests and build, then uploads `dist` to Pages.
