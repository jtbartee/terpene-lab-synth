# Roadmap

## Done (v0.1.0, 2026-10-23)

- **Phase 1 — foundation:** source audit (6 sources: 3 approved/conditional, 3 excluded); 21 references verified; 18-analyte registry from PubChem (33 compound records, 2D and 3D); status-aware data model; schemas; reproducible pipelines; similarity metric validated on 43,148 samples.
- **Phase 2 — Lab:** mixing console (mute, lock, info, mapping indicator, add/remove channels); measured vs relative views; bars, composition, radar, families, abstract molecule field, data table; save/load/rename/duplicate/reset/randomise; derived hypothetical copies; Explore (compounds, three datasets, aroma); Compare; Library with JSON import/export.
- **Phase 3 — Synth:** six sound modules, mixer with sends, protected master, transport, theory-aware sequencing, motorik engine.
- **Phase 4 — Sonification:** 32 targets, editable mapping matrix, 5 presets, two feature bases, analytical and generative modes, deterministic seeds.
- **Phase 5 — Autonomous composition:** phrase-aware weighted development, motif mutation and return, energy arcs, 8 styles, profile morphing.
- **Phase 6 — Production:** WAV (16/24-bit with metadata), composition presets, responsive layout, audio self-test, documentation.
- **Phase 7 — Advanced:** stems (ZIP), MIDI export (spec-correct key signature), Web MIDI learn, extra compounds (γ- and α-terpinene) and a fourth chemical family view.

## Done (v0.2.0, 2026-10-23) — composition engine 2

- Audit of why v0.1 pieces sounded alike (fixed drum templates, fixed bass rhythms, pitch-only mutation, sections without material). See [COMPOSITION_ENGINE_2.md](COMPOSITION_ENGINE_2.md).
- Arrangement blueprints (7), groove families (6 kits, 33 archetypes) with variation operators, 11 bass archetypes with rhythmic mutation, melodic hooks and arpeggio figures with motivic transformation, section-aware development, musical memory with returns, endless cycles of related material.
- Controls: Groove diversity, Structure, Motif evolution. Now Playing shows the form and the material in use.
- Diversity metrics and tests against the v0.1 baseline; three listening demos with a feedback form; demo renderer.

## Next

- **Owner listening pass of engine 2** (Synth → Listening session) and tuning of archetype weights, section lengths and thresholds from it.

- Human listening pass and tuning of style weights from it.
- Real-device testing on Safari/iOS and Android Chrome; hardware MIDI controller test.
- Per-lab normalisation option for comparisons across labs (to reduce inter-lab bias).
- Cannabinoid profile view (data is present in both datasets) and the THC:CBD chemotype filter.
- More compounds from the CT extended panel (guaiol, caryophyllene oxide, eucalyptol, terpineol), added through the manifest.
- Accessible table alternative to the radar for screen-reader users comparing many compounds.
- Optional AudioWorklet-based saturation and tape models for richer analogue character.
- Shareable URLs that encode profile, settings, mapping and seed.
- More styles (e.g. kosmische sequencer pop, dub ambient), each with its own rules.
- An adapter for a properly licensed strain-information feed, should one become available.
