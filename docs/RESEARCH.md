# Research notes and evidence limits

Every reference below was checked against PubMed (abstract) or Crossref (metadata) on **2026-10-23**. The claims made from each are limited to what its abstract or full text states. For Smith et al. 2022 and Rice & Koziel 2015, the open-access full texts were read through PubMed Central.

Statements are tagged:

- **[F]** verified fact, with a citation
- **[A]** engineering assumption
- **[D]** artistic design decision

## 1. Cannabis terpenes

- **[F]** Cannabis accumulates a terpene-rich resin in glandular trichomes of the female inflorescence. Nine terpene synthases were identified in the hemp variety Finola; their products make up most of its resin terpenes, including β-myrcene, (E)-β-ocimene, (−)-limonene, (+)-α-pinene, β-caryophyllene and α-humulene (Booth, Page & Bohlmann 2017).
- **[F]** A trichome-specific (−)-limonene synthase and a (+)-α-pinene synthase were characterised from cannabis (Günnewich et al. 2007).
- **[F]** Knowledge of the genomic and biosynthetic systems and of the factors behind variability is "rudimentary", and there is concern about inconsistency between "strains" (Booth & Bohlmann 2019).
- **[F]** Monoterpenes are C10 (hydrocarbons C10H16; the alcohols used here are C10H18O). Sesquiterpenes are C15 (C15H24; alcohols C15H26O). The app's family grouping is checked against each compound's PubChem formula in tests.
- **[F]** Drying did not change the qualitative composition of steam-distilled cannabis volatile oil (Ross & ElSohly 1996).

## 2. How labs measure terpenes

- **[F]** The six labs in Smith et al. extract homogenised flower and quantify terpenes by GC: headspace or liquid injection; FID or MS detection (repository `summary_of_lab_methods.pdf`).
- **[F]** Reported cannabinoid values differ systematically between labs even after controlling for confounds (Jikomes & Zoorob 2018). Inter-lab variation is therefore a real limitation for terpenes too.
- **[A]** The recurring smallest positive value per lab (0.01 or 0.03 % w/w) is read as a reporting floor. It is supported by the distribution (no values between 0 and the floor) and by Smith et al.'s mention of per-lab LLOQs.
- **[F]** Routine GC on achiral columns does not resolve enantiomers. Literature mentions both (−)-limonene (biosynthesis; Günnewich 2007, Booth 2017) and "D-(+)-limonene" (Oswald et al. 2023). The app treats limonene's enantiomeric composition as unknown.

## 3. Strains, chemotypes and chemovars

- **[F]** The THC/CBD chemotype is inherited (de Meijer et al. 2003).
- **[F]** Across six U.S. states, terpene profiles formed recurring clusters — "high caryophyllene–limonene", "high myrcene–pinene", "high terpinolene–myrcene". Commercial Indica/Hybrid/Sativa labels did not align consistently with chemical diversity, and within-name consistency varied widely; "Purple Punch" was consistent, "Tangie" was not (Smith et al. 2022). Total terpenes averaged about 2 % by weight.
- **[F]** Sativa- and Indica-labelled samples were genetically indistinct genome-wide; labels tracked a few terpenes controlled by terpene synthase gene variation (Watts et al. 2021).
- **[F]** Samples sold under the same strain name were often genetically inconsistent between facilities (Schwabe & McGlaughlin 2019).
- **[F]** In 2,662 Nevada samples, three terpene chemovars carried 396 breeder names (Reimann-Philipp et al. 2020).
- **[F]** Classification by chemovar rather than cultivar name has been argued for since Hazekamp & Fischedick 2012, and Hazekamp et al. 2016.
- **App consequences:** cultivar aggregates are labelled as statistics of a name; single samples carry a "can differ substantially" note; indica/sativa labels are not shown.

## 4. Aroma

- **[F]** High concentration does not mean high odour impact. Odour-activity analysis highlighted low-level compounds such as nonanal, decanol and o-cymene (Rice & Koziel 2015).
- **[F]** The "skunk-like" aroma comes from prenylated volatile sulfur compounds, chiefly 3-methyl-2-butene-1-thiol. These increase late in flowering, peak during curing, and drop within a week of storage (Oswald et al. 2021).
- **[F]** Across cultivars with very different aromas, terpene expression was similar. Minor non-terpenoid compounds drove the distinct scents: 3-mercaptohexyl compounds for citrus notes, skatole for "chemical" notes. The authors conclude that the importance of terpenes to cannabis aroma "has been overemphasized" (Oswald et al. 2023).
- **[A]** Only PubChem-cited descriptor text (HSDB odor statements, FEMA flavour profiles) is used per compound. Grouping words into categories is the project's own classification.
- **[D]** The "conceptual aroma" of a mixture splits each compound's share evenly across its categories. It is explicitly not a prediction.

## 5. The entourage effect

- **[F]** The term was coined for endogenous fatty-acid glycerol esters enhancing 2-AG activity (Ben-Shabat et al. 1998). It was later proposed for phytocannabinoid–terpenoid interactions as a hypothesis (Russo 2011).
- **[F]** Six common terpenoids neither activated CB1 or CB2 nor changed Δ9-THC signalling in vitro (Santiago et al. 2019). Five terpenes showed no direct CB1/CB2 interactions apart from a possible weak β-caryophyllene–CB2 interaction (Finlay et al. 2020). β-Caryophyllene was reported as a selective CB2 ligand (Gertsch et al. 2008).
- **App position:** no claim of synergy, effect or therapeutic action is made anywhere.

## 6. Environmental and cultivation influences

- **[F]** Volatile sulfur compound levels change with flowering stage, curing and storage (Oswald et al. 2021). Booth & Bohlmann (2019) identify variability factors as poorly understood.
- **[F]** Reimann-Philipp et al. (2020) found genotypes did not correlate with chemotypes in their limited genotyping, and suggested environment may contribute significantly.
- **Limitation:** none of the approved datasets record cultivation conditions, harvest or test timing relative to curing, or storage. The app cannot attribute differences to environment.

## 7. Music research (design references)

- **[F]** Euclidean distributions of k onsets in n steps reproduce many traditional rhythms; E(3,8) is the tresillo (Toussaint 2005). The app's `euclid()` is tested against these.
- **[D]** Style rules are design interpretations of widely documented traits. Motorik: a steady kick on 1 and 3 with snare on 2 and 4 under even eighths (Neu!/Klaus Dinger). Berlin school: sequencer ostinatos (Tangerine Dream, Klaus Schulze). Dub techno: chord stabs into filtered feedback delay (Basic Channel). Ambient (Eno). Process and drone music (Radigue, Niblock). No recordings or melodies are reproduced; see `MUSIC_ENGINE.md`.

## References

1. Smith CJ, Vergara D, Keegan B, Jikomes N. *PLoS ONE* 17(5): e0267498 (2022). doi:10.1371/journal.pone.0267498
2. Booth JK, Page JE, Bohlmann J. *PLoS ONE* 12(3): e0173911 (2017). doi:10.1371/journal.pone.0173911
3. Booth JK, Bohlmann J. *Plant Science* 284: 67–72 (2019). doi:10.1016/j.plantsci.2019.03.022
4. Günnewich N et al. *Nat Prod Commun* 2(3) (2007). doi:10.1177/1934578X0700200301
5. Hazekamp A, Fischedick JT. *Drug Test Anal* 4: 660–667 (2012). doi:10.1002/dta.407
6. Hazekamp A, Tejkalová K, Papadimitriou S. *Cannabis Cannabinoid Res* 1: 202–215 (2016). doi:10.1089/can.2016.0017
7. de Meijer EPM et al. *Genetics* 163: 335–346 (2003). doi:10.1093/genetics/163.1.335
8. Watts S et al. *Nature Plants* 7: 1330–1334 (2021). doi:10.1038/s41477-021-01003-y
9. Schwabe AL, McGlaughlin ME. *J Cannabis Res* 1: 3 (2019). doi:10.1186/s42238-019-0001-1
10. Reimann-Philipp U et al. *Cannabis Cannabinoid Res* 5: 215–230 (2020). doi:10.1089/can.2018.0063
11. Jikomes N, Zoorob M. *Sci Rep* 8: 4519 (2018). doi:10.1038/s41598-018-22755-2
12. Ross SA, ElSohly MA. *J Nat Prod* 59: 49–51 (1996). doi:10.1021/np960004a
13. Rice S, Koziel JA. *PLoS ONE* 10(12): e0144160 (2015). doi:10.1371/journal.pone.0144160
14. Oswald IWH et al. *ACS Omega* 6: 31667–31676 (2021). doi:10.1021/acsomega.1c04196
15. Oswald IWH et al. *ACS Omega* 8: 39203–39216 (2023). doi:10.1021/acsomega.3c04496
16. Russo EB. *Br J Pharmacol* 163: 1344–1364 (2011). doi:10.1111/j.1476-5381.2011.01238.x
17. Ben-Shabat S et al. *Eur J Pharmacol* 353: 23–31 (1998). doi:10.1016/s0014-2999(98)00392-6
18. Santiago M et al. *Cannabis Cannabinoid Res* 4: 165–176 (2019). doi:10.1089/can.2019.0016
19. Finlay DB et al. *Front Pharmacol* 11: 359 (2020). doi:10.3389/fphar.2020.00359
20. Gertsch J et al. *PNAS* 105: 9099–9104 (2008). doi:10.1073/pnas.0803601105
21. Toussaint G. Proc. BRIDGES 2005, 47–56.
