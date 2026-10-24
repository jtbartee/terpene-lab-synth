# TERPENE LAB + TERPENE SYNTH

**Chemistry becomes data. Data becomes sound. Sound becomes composition.**

A scientific explorer for cannabis terpene chemistry, joined to a generative electronic music instrument that turns terpene profiles into evolving, original compositions. It runs entirely in the browser, with no account and no server.

Live site (after deployment): https://jtbartee.github.io/terpene-lab-synth/

## What it does

- **Explore:** a reference library of 18 terpenes with verified PubChem identities, 2D and interactive 3D structures, and cited aroma descriptors. It also has a browser for real lab data: 43,148 tested flower samples and 1,742 cultivar-name aggregates from Smith et al. (2022, CC0), plus 4,670 Connecticut registry flower products (public domain). Search, filters and similarity search are included.
- **Terpene Lab:** a mixing console for building and editing profiles. Measured data is never changed; editing creates a hypothetical copy. Visualisations, coverage, and a clear split between measured concentration and relative composition.
- **Terpene Synth:** an autonomous composer with drone, bass, arpeggiator, pads, synthesised drums and textures. Eight styles: Motorik, Kosmische, Dub Techno, Berlin Sequence, Ambient, Experimental Drone, Krautpop, Microhouse. A/B profile morphing, live performance controls, a mixer, an editable terpene-to-sound mapping, and optional MIDI controllers.
- **Compare:** a transparent, validated similarity score with confidence and coverage, plus an audible A/B.
- **Library:** profiles, compositions and mappings saved on your device; JSON import and export.
- **Export:** stereo WAV, aligned stems (ZIP), MIDI, profile and preset JSON — ready for Ableton Live.

### New in 0.2.0: composition engine 2

Pieces are now planned before they play: a form (for example *Intro → A → B → A′ → B′ → Outro*, or a krautrock jam that returns to its original groove), a groove from the style's family, a bass motif with its own rhythm, and a melodic hook that develops and comes back. Different seeds in one style now give different rhythms and structures, not just different notes. To hear it, open **Terpene Synth → Listening session** and audition the three Motorik demos (same style, key and profile; different seeds), or run `npm run build && npm run render:demos` to render them to WAV. Details: [docs/COMPOSITION_ENGINE_2.md](docs/COMPOSITION_ENGINE_2.md), numbers: [docs/DIVERSITY_REPORT.md](docs/DIVERSITY_REPORT.md).

**0.2.2: seven endings.** A finite piece (32–256 bars) ends one of seven ways: resolve, final hit, fade-out, slow-down, echo-out, cadence or stop-time. Leave **Synth → Ending** on Auto to let the seed and the form choose, or pick one. See the endings table in [docs/COMPOSITION_ENGINE_2.md](docs/COMPOSITION_ENGINE_2.md#35a-endings-021-seven-kinds-since-022).

Musical mappings are **artistic choices**. Nothing here makes medical, psychological or effect claims.

## Use it locally

You need Node.js 20+ (24 recommended).

```bash
npm install
npm run dev          # http://localhost:5173
```

Or double-click **`Launch TERPENE LAB.command`** (macOS). It builds the app if needed and opens it at `http://localhost:8758/terpene-lab-synth/`.

Quick start: on the Lab page, press **Hear it** on *Profile A — Deep Botanical*, then on *Profile B — Bright Sequence*.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `preview` | develop / production build / serve the build |
| `npm test` | unit tests (chemistry, music, sonification, encoders) |
| `npm run e2e` | browser end-to-end checks against the built app |
| `npm run report:diversity` | regenerate the compositional diversity report |
| `npm run render:demos` | render the three listening demos to `demos/` (after a build) |
| `npm run data:all` | rebuild all data assets (PubChem, Smith et al., CT) |
| `npm run data:validate-similarity` | re-run the similarity metric validation |

## Deployment

`.github/workflows/deploy.yml` typechecks, tests, builds and publishes `dist/` to GitHub Pages on every push to `main`. Vite's `base` is set to `/terpene-lab-synth/`.

## Documentation

- [docs/RESEARCH.md](docs/RESEARCH.md) — science, citations, evidence limits
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) — source audit, licences, decisions
- [docs/CHEMISTRY_MODEL.md](docs/CHEMISTRY_MODEL.md) — measurements, missing data, similarity
- [docs/SONIFICATION.md](docs/SONIFICATION.md) — the mapping pipeline
- [docs/MUSIC_ENGINE.md](docs/MUSIC_ENGINE.md) — theory, generation, scheduling, synthesis
- [docs/COMPOSITION_ENGINE_2.md](docs/COMPOSITION_ENGINE_2.md) — audit, design and research of the 0.2 composition engine
- [docs/DIVERSITY_REPORT.md](docs/DIVERSITY_REPORT.md) — measured diversity, engine 2 vs v0.1
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design
- [docs/TESTING.md](docs/TESTING.md) — tests, defects found, limitations
- [docs/ROADMAP.md](docs/ROADMAP.md) — done and next

## Credits and licences

Code: MIT. Data: PubChem (NCBI); Smith CJ, Vergara D, Keegan B, Jikomes N (2022), CC0; Connecticut Department of Consumer Protection, public domain. Libraries: React, Tone.js, Tonal, Zod, @tonejs/midi (MIT). Fonts: IBM Plex (SIL OFL 1.1).
