# Chemistry model

Code: `src/chem/` (no UI or audio imports). Types: `src/chem/types.ts`.

## Compounds vs analytes

- A **compound** is one PubChem record (CID) with fixed stereochemistry, e.g. (+)-limonene, CID 440917.
- An **analyte** is what a lab reports, e.g. "limonene", which does not resolve enantiomers. Each analyte has a `referenceCid` (usually the stereo-unspecified record) plus `memberCids` (the specific stereoisomers or geometric isomers).
- Isomer totals are explicit analytes: "Ocimene (isomer total)" and "Nerolidol (isomer total)". They are never silently merged with a single compound.

There are 18 analytes: the 16 the brief requires, plus γ- and α-terpinene, which are in the Smith panel. Adding a compound means adding a manifest entry (`scripts/compound-manifest.json`), running `npm run data:pubchem`, and adding the id to the `AnalyteId` union. The UI reads everything from the registry.

## Entities

| Entity | Representation |
|---|---|
| Chemical compound | `CompoundRecord` (generated from PubChem) |
| Cultivar reference | `Profile` with `kind: 'cultivar_aggregate'` — statistics of a *name*, never a definition |
| Laboratory sample | `Profile` with `kind: 'lab_sample'` plus `Provenance` (source, record id, lab, region, producer, product type/form, date) |
| Chemical measurement | `Measurement` (analyte, status, value, unit, floor, flags, aggregate stats) |
| Reported profile | `Profile` with `kind: 'reported'` plus `ranking` (dominant compounds only) |
| Hypothetical profile | `Profile` with `kind: 'hypothetical'`, optionally `provenance.derivedFrom` |
| Synth preset | `SynthPreset` (profile(s), morph, mode, settings incl. seed, mapping, mixer) |

## Measurement status — missing data is never zero

| Status | Has a number? | Composition maths |
|---|---|---|
| `measured` | yes | value |
| `at_floor` | yes (the floor) | value, flagged "≤ floor" |
| `not_detected`, `below_lod`, `below_loq` | no | covered, contributes 0 |
| `measured_zero` | 0 (user-set only) | 0 |
| `hypothetical`, `estimated` | yes | value |
| `not_reported`, `not_measured`, `rejected` | no | **excluded**, listed as missing |

An analyte absent from `measurements` is `not_measured`. The schema rejects a status/value mismatch, for example "not_measured" carrying 0.

Quality flags: `at_reporting_floor`, `implausible_value`, `unit_basis_undocumented`, `zero_ambiguous`, `isomer_sum`, `stereo_unresolved`.

## Units and conversion

`pct_w_w`, `mg_per_g` and `ppm_w_w` are mass fractions and convert into one another: 1 % w/w = 10 mg/g = 10,000 ppm. `relative_pct` and `relative_weight` are shares and **cannot** become mass fractions; `convert()` returns null. Profiles of different product types are flagged as not directly comparable.

## Two views of a profile

- **Measured concentration:** values in their own unit, with floors, IQR whiskers for aggregates, and hatched rows for unmeasured analytes.
- **Relative composition:** each covered analyte ÷ the sum of covered values, labelled "% of measured terpenes". It is not % of sample mass. Coverage (covered / total analytes) is always shown.

## Editing

Editing a lab sample, aggregate or demo creates a derived **hypothetical** copy (`deriveHypothetical`) that records `derivedFrom`. The source object is never mutated; a test asserts this.

## Similarity

Primary score: **1 − Jensen–Shannon distance** (log₂, bounded 0–1). It is computed between the two relative compositions after renormalising each over the analytes *both* profiles cover. Cosine similarity is reported alongside.

Validation (`npm run data:validate-similarity`). There were 5,736 groups of samples sharing a cultivar name and an anonymised producer. 6,000 same-product pairs were compared with 6,000 random pairs; the number below is ROC AUC.

| Shared analytes | JSD (relative) | cosine (relative) | cosine (absolute) | −Euclidean (log abs) | Spearman |
|---|---|---|---|---|---|
| 14 | **0.909** | 0.896 | 0.896 | 0.897 | 0.883 |
| 8 | **0.892** | 0.874 | 0.877 | 0.880 | 0.841 |
| 6 | **0.879** | 0.859 | 0.855 | 0.873 | 0.785 |
| 5 | **0.868** | 0.846 | 0.847 | 0.867 | 0.734 |
| 4 | 0.848 | 0.827 | 0.821 | 0.860 | 0.639 |
| 3 | 0.820 | 0.794 | 0.797 | 0.847 | 0.473 |
| 2 | 0.741 | 0.724 | 0.719 | 0.822 | 0.234 |

Decisions:

- JSD is the primary metric. It is best at ≥ 5 shared analytes and is defined for hypothetical (relative-unit) profiles, which log-Euclidean on absolute values is not.
- Confidence: **high** ≥ 8 shared, **moderate** 5–7, **low** 3–4, **insufficient** < 3 (score shown but marked not meaningful).
- Ranked/descriptive profiles use **rank-biased overlap** (persistence 0.8), labelled *approximate*, because rank methods collapse at low coverage.
- Scores are also placed against the distribution for 20,000 random flower-sample pairs (median 0.53, 90th percentile 0.73), so "0.82" reads as "more similar than ~96 % of random pairs".
- Every comparison returns an explanation: shared and unique analytes, shared character, the largest divergence contributions, confidence, and why absolute differences are or are not shown.

## Randomise

Randomise draws 3–6 analytes from the visible, unlocked channels, with weights 5–60. For absolute-unit profiles the weights are scaled to a total of 1.5 % w/w. The RNG is seeded, so results are reproducible under test.

## Morph

`morphProfiles` interpolates relative compositions and is labelled `kind: 'morph'`: "Synthetic transition… not a measured or predicted chemical sample." An analyte covered on one side only is interpolated against 0 on the other; this is a stated simplification of the synthetic object.
