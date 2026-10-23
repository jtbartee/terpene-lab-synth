# Data sources — audit

Last verified: **2026-10-23**. Every source the brief proposed was inspected directly (repository contents, licence files, schemas, sample rows, and value distributions) before any decision was made. Only sources marked **approved** or **conditional** are ingested.

| Source | Decision | Licence | In the app |
|---|---|---|---|
| PubChem | approved | NCBI public data | compound identities, structures, odor/flavour text |
| Smith et al. 2022 dataset | approved | CC0-1.0 | 43,148 flower samples; 1,742 cultivar-name aggregates |
| Connecticut Cannabis Product Registry | conditional | Public Domain | 4,670 flower products |
| Kushy Cannabis Dataset | excluded | MIT (code) | — |
| CI-Strains-Pro | excluded | MIT code / CC BY 4.0 claimed | — |
| Leafly | excluded | proprietary | — |

---

## PubChem

- **URL:** https://pubchem.ncbi.nlm.nih.gov/ · API: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest
- **Publisher:** U.S. National Library of Medicine, NCBI.
- **Licence / limitations:** NCBI public data. Records aggregate contributed sources; text pulled from PUG View keeps its own source name (for example, Hazardous Substances Data Bank, FEMA).
- **Access method:** PUG REST property tables, synonyms, 2D and 3D SDF; PUG View headings `Odor`, `FEMA Flavor Profile` and `Boiling Point`. Script: `scripts/fetch-pubchem.mjs`. Raw responses are committed in `data/raw/pubchem/` so the build is reproducible offline.
- **Fields used:** CID, title, IUPAC name, formula, molecular weight, exact mass, InChI, InChIKey, SMILES, XLogP3, stereo counts, synonyms, 2D layout, PubChem3D computed conformer, odor text, FEMA flavour terms and boiling point text.
- **Coverage:** all 33 compound records (18 analytes plus stereoisomers and two non-terpene context compounds) have 2D and 3D records. Cited aroma text exists for 16 of 18 analytes; α-humulene and α-bisabolol have none, and the app says so rather than inventing descriptors.
- **Scientific limitations:** PubChem3D conformers are computed models, not experimental structures. Odor statements describe pure compounds. FEMA profiles are flavour-industry descriptors, kept separate from HSDB odor text.
- **Redistribution:** yes, with attribution.
- **Decision: approved.**

## Smith et al. 2022 — phytochemical diversity of commercial Cannabis

- **URL:** https://github.com/cjsmith015/phytochemical-diversity-cannabis · paper: https://doi.org/10.1371/journal.pone.0267498
- **Publisher:** Smith CJ, Vergara D, Keegan B, Jikomes N. (Author NJ was employed by Leafly; the paper discloses this.)
- **Licence:** **CC0-1.0** (repository `LICENSE`, checked through the GitHub API).
- **Access method:** `data/preproc_lab_data_pub_20220218.csv` pinned at commit `e71c838e6bacdb3302c9410c595f09f3aea9984f`, downloaded by `scripts/build-smith.mjs`. SHA-256 of the file used: `1850b918bb3a00b903f9e254953bb695012314bd264c419efb68bc482b392182`.
- **Fields:** sample id, lab id, anonymised producer, region, product category, Leafly strain slug / category / popularity, THC:CBD chemotype, total cannabinoids, and 14 terpenes. `tot_ocimene` and `tot_nerolidol_ct` are isomer totals.
- **Measurement methodology:** six U.S. testing labs (AK, CA, FL, MI, OR, WA). Each lab's GC method is summarised in the repository's `summary_of_lab_methods.pdf` (headspace or liquid injection; FID or MS detection). Values were converted by the authors to % weight. Flower only.
- **Usable coverage:** 89,923 samples, of which 43,148 have terpene data; 2,658 strain names, 1,742 with ≥ 3 samples.
- **Audit findings:**
  - Empty cells mean the lab did not measure that terpene. Zeros are reported zeros.
  - Each lab has a **reporting floor**, a large spike at the smallest positive value: 0.01 % w/w for most labs, 0.03 % for lab1, and 0.001–0.002 % for some lab5 analytes. The floors were inferred per lab and analyte (`data/raw/smith/floor-report.txt` after a build). Values at or below a floor are flagged `at_floor` and displayed as "≤ floor".
  - The authors' own preprocessing withheld terpene data that failed plausibility checks: any terpene > 5 %, near-zero variance, or ≥ 10 common terpenes at zero.
- **Scientific limitations:** inter-lab method differences (see Jikomes & Zoorob 2018); producer-assigned names; flower only; no dry/wet basis distinction stated beyond "% weight".
- **Deliberately excluded fields:** `strain_category` and `strain_popularity`, which the authors took from Leafly strain pages. Strain names (slugs) are kept as plain names.
- **Redistribution:** yes (CC0).
- **Decision: approved.**

## Connecticut Cannabis Product Registry

- **URL:** https://data.ct.gov/Health-and-Human-Services/Cannabis-Product-Registry/egd5-wb6r
- **Publisher:** CT Department of Consumer Protection, Drug Control Division.
- **Licence:** Public Domain (dataset metadata `licenseId: PUBLIC_DOMAIN`).
- **Access method:** Socrata SODA API (`https://data.ct.gov/resource/egd5-wb6r.json`); script `scripts/build-ct.mjs`. The registry updates daily, so the snapshot fetch time is stored in the output file.
- **Fields:** brand name, dosage form, producer, approval date, registration number, cannabinoids, 8 core terpenes (about 19,000 rows) and an extended panel of about 40 terpenes (about 3,000 rows), market, chemotype.
- **Usable coverage:** 36,721 products; 16,812 in flower dosage forms; **4,670** flower products with at least one positive terpene value; 711 with the extended panel.
- **Audit findings and conditions:**
  - Dosage forms are free text (hundreds of variants, many mislabelled concentrate descriptions). Only an explicit list of flower forms is kept.
  - **Units are not documented.** Magnitudes (total THC ≈ 20 for flower, ≈ 80 for vapes) imply % w/w; every value carries `unit_basis_undocumented`.
  - **Zeros are ambiguous:** many products show 0 for an entire panel, so 0 may mean "not tested". Zeros become `not_detected` plus `zero_ambiguous`.
  - Data-entry errors exist (for example trans-nerolidol 33 %, caryophyllene 19 %). Values > 5 % are withheld as `rejected`, using Smith et al.'s threshold; 2 values were withheld.
  - Product names are brand or registry codes, rarely cultivar names, so this source is not used for name aggregates.
  - Borneol is never above 0, geraniol is positive in 9 products, valencene in 25 and fenchol in 37.
- **Redistribution:** yes (public domain).
- **Decision: conditional** — flower forms only, with the flags above.

## Kushy Cannabis Dataset

- **URL:** https://github.com/kushyapp/cannabis-dataset
- **Licence:** MIT (repository). The original sources of the data are not documented.
- **Age:** a single snapshot, 2017-11-14.
- **Inspection:** of 9,524 strains, the `terpenes` field is filled in **1**. `thc` is filled in 764. `effects`, `ailment` and `flavor` (about 1,000 each) are user-reported or marketing descriptions of unknown origin.
- **Decision: excluded** — no usable terpene data, unclear provenance, and medical/effect fields this project must not present.

## CI-Strains-Pro

- **URL:** https://github.com/Shannon-Goddard/ci-strains-pro
- **Licence:** MIT for code, CC BY 4.0 claimed for data.
- **Inspection:** 21,282 strains built by scraping 21,706 seed-bank and retailer HTML pages, then AI-validated. Fields are cannabinoid ranges, genetics, flowering times, yields and lineage. **No terpene measurements.**
- **Provenance concern:** the CC BY claim covers data extracted from third-party marketing pages whose own terms were not shown to permit redistribution.
- **Decision: excluded.**

## Leafly

Used only as a background research reference. Not scraped, not reverse-engineered, not redistributed. No Leafly descriptions are reproduced, and the Leafly-derived columns inside the Smith et al. repository are not used. The adapter architecture (`src/chem/datasets.ts`) can take an appropriately licensed feed in future.

---

## How to update the data

```bash
npm run data:pubchem   # refresh compound records (delete data/raw/pubchem to force re-download)
npm run data:smith     # rebuild Smith et al. assets from the pinned commit
npm run data:ct        # delete data/raw/ct first to fetch a fresh CT snapshot
npm run data:validate-similarity
npm test               # identity, unit and adapter tests must still pass
```
