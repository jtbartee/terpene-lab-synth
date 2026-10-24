// ABOUT / RESEARCH: science, sources, methods, limitations, self-test.

import { useState } from 'react';
import { COMPOUND_DATA_VERIFIED } from '../../chem/analytes';
import { SOURCES } from '../../chem/sources';
import { VALIDATION_AUC } from '../../chem/similarity';
import type { SelfTestResult } from '../../audio/selftest';
import { getState, setTransport } from '../../store/store';
import { composerSettings, currentParams } from '../../store/actions';
import { Panel } from '../components/bits';

const REFS: { key: string; text: string; doi: string }[] = [
  { key: 'Smith 2022', text: 'Smith CJ, Vergara D, Keegan B, Jikomes N. The phytochemical diversity of commercial Cannabis in the United States. PLoS ONE 17(5): e0267498 (2022).', doi: '10.1371/journal.pone.0267498' },
  { key: 'Booth 2017', text: 'Booth JK, Page JE, Bohlmann J. Terpene synthases from Cannabis sativa. PLoS ONE 12(3): e0173911 (2017).', doi: '10.1371/journal.pone.0173911' },
  { key: 'Booth 2019', text: 'Booth JK, Bohlmann J. Terpenes in Cannabis sativa — from plant genome to humans. Plant Science 284: 67–72 (2019).', doi: '10.1016/j.plantsci.2019.03.022' },
  { key: 'Günnewich 2007', text: 'Günnewich N, Page JE, Köllner TG, Degenhardt J, Kutchan TM. Functional expression and characterization of trichome-specific (−)-limonene synthase and (+)-α-pinene synthase from Cannabis sativa. Nat Prod Commun 2(3) (2007).', doi: '10.1177/1934578X0700200301' },
  { key: 'Hazekamp 2012', text: 'Hazekamp A, Fischedick JT. Cannabis — from cultivar to chemovar. Drug Test Anal 4: 660–667 (2012).', doi: '10.1002/dta.407' },
  { key: 'Hazekamp 2016', text: 'Hazekamp A, Tejkalová K, Papadimitriou S. Cannabis: from cultivar to chemovar II — a metabolomics approach to Cannabis classification. Cannabis Cannabinoid Res 1: 202–215 (2016).', doi: '10.1089/can.2016.0017' },
  { key: 'de Meijer 2003', text: 'de Meijer EPM et al. The inheritance of chemical phenotype in Cannabis sativa L. Genetics 163: 335–346 (2003).', doi: '10.1093/genetics/163.1.335' },
  { key: 'Watts 2021', text: 'Watts S, McElroy M, Migicovsky Z, Maassen H, van Velzen R, Myles S. Cannabis labelling is associated with genetic variation in terpene synthase genes. Nature Plants 7: 1330–1334 (2021).', doi: '10.1038/s41477-021-01003-y' },
  { key: 'Schwabe 2019', text: 'Schwabe AL, McGlaughlin ME. Genetic tools weed out misconceptions of strain reliability in Cannabis sativa. J Cannabis Res 1: 3 (2019).', doi: '10.1186/s42238-019-0001-1' },
  { key: 'Reimann-Philipp 2020', text: 'Reimann-Philipp U et al. Cannabis chemovar nomenclature misrepresents chemical and genetic diversity. Cannabis Cannabinoid Res 5: 215–230 (2020).', doi: '10.1089/can.2018.0063' },
  { key: 'Jikomes 2018', text: 'Jikomes N, Zoorob M. The cannabinoid content of legal cannabis in Washington State varies systematically across testing facilities and popular consumer products. Sci Rep 8: 4519 (2018).', doi: '10.1038/s41598-018-22755-2' },
  { key: 'Ross 1996', text: 'Ross SA, ElSohly MA. The volatile oil composition of fresh and air-dried buds of Cannabis sativa. J Nat Prod 59: 49–51 (1996).', doi: '10.1021/np960004a' },
  { key: 'Rice 2015', text: 'Rice S, Koziel JA. Characterizing the smell of marijuana by odor impact of volatile compounds. PLoS ONE 10(12): e0144160 (2015).', doi: '10.1371/journal.pone.0144160' },
  { key: 'Oswald 2021', text: 'Oswald IWH et al. Identification of a new family of prenylated volatile sulfur compounds in cannabis revealed by comprehensive two-dimensional gas chromatography. ACS Omega 6: 31667–31676 (2021).', doi: '10.1021/acsomega.1c04196' },
  { key: 'Oswald 2023', text: 'Oswald IWH et al. Minor, nonterpenoid volatile compounds drive the aroma differences of exotic cannabis. ACS Omega 8: 39203–39216 (2023).', doi: '10.1021/acsomega.3c04496' },
  { key: 'Russo 2011', text: 'Russo EB. Taming THC: potential cannabis synergy and phytocannabinoid-terpenoid entourage effects. Br J Pharmacol 163: 1344–1364 (2011).', doi: '10.1111/j.1476-5381.2011.01238.x' },
  { key: 'Ben-Shabat 1998', text: 'Ben-Shabat S et al. An entourage effect: inactive endogenous fatty acid glycerol esters enhance 2-arachidonoyl-glycerol cannabinoid activity. Eur J Pharmacol 353: 23–31 (1998).', doi: '10.1016/s0014-2999(98)00392-6' },
  { key: 'Santiago 2019', text: 'Santiago M, Sachdev S, Arnold JC, McGregor IS, Connor M. Absence of entourage: terpenoids commonly found in Cannabis sativa do not modulate the functional activity of Δ9-THC at human CB1 and CB2 receptors. Cannabis Cannabinoid Res 4: 165–176 (2019).', doi: '10.1089/can.2019.0016' },
  { key: 'Finlay 2020', text: 'Finlay DB, Sircombe KJ, Nimick M, Jones C, Glass M. Terpenoids from cannabis do not mediate an entourage effect by acting at cannabinoid receptors. Front Pharmacol 11: 359 (2020).', doi: '10.3389/fphar.2020.00359' },
  { key: 'Gertsch 2008', text: 'Gertsch J et al. Beta-caryophyllene is a dietary cannabinoid. PNAS 105: 9099–9104 (2008).', doi: '10.1073/pnas.0803601105' },
  { key: 'Toussaint 2005', text: 'Toussaint G. The Euclidean algorithm generates traditional musical rhythms. Proc. BRIDGES: Mathematical Connections in Art, Music and Science, 47–56 (2005).', doi: '' },
];

export function AboutView() {
  const [test, setTest] = useState<SelfTestResult | null>(null);
  const [testErr, setTestErr] = useState<string | null>(null);
  async function runTest() {
    setTransport({ busy: 'Running the audio self-test (seven offline renders)…' });
    setTestErr(null);
    try {
      const { runSelfTest } = await import('../../audio/selftest');
      const s = getState().synth;
      setTest(await runSelfTest(composerSettings(s), currentParams(s), s.mixer, 8));
    } catch (e) { setTestErr(String((e as Error).message ?? e)); } finally { setTransport({ busy: null }); }
  }
  return (
    <div className="stack">
      <div className="view-head">
        <div>
          <h1 className="view-title">About / Research</h1>
          <p className="view-sub">Chemistry becomes data. Data becomes sound. Sound becomes composition. This page explains what is measured, what is assumed, and what is art.</p>
        </div>
      </div>

      <div className="grid cols-2">
        <Panel title="Three kinds of statement">
          <div className="prose small">
            <p><b style={{ color: 'var(--phosphor)' }}>Verified fact</b> — compound identities, formulae and structures (PubChem, verified {COMPOUND_DATA_VERIFIED}); laboratory measurements from approved datasets, shown with their units, floors and gaps; published findings, cited.</p>
            <p><b style={{ color: 'var(--amber)' }}>Engineering assumption</b> — documented processing choices: reading the CT registry's undocumented units as % w/w, treating a lab's reporting floor as "at or below" that value, the similarity metric and its confidence thresholds.</p>
            <p><b style={{ color: 'var(--violet)' }}>Artistic design</b> — every link between a compound and a sound. There is no scientific rule that a terpene determines a pitch, tempo or mood.</p>
            <p>This app makes no medical, psychological or effect claims. Profiles do not predict how any product would make anyone feel.</p>
          </div>
        </Panel>
        <Panel title="Audio self-test">
          <div className="stack small" style={{ gap: 8 }}>
            <p style={{ margin: 0 }}>Renders 8 bars of the current settings offline with each sound module alone, then the full mix, and checks that each module makes sound, that the file length is exact, and that peaks stay below −0.3 dBFS.</p>
            <div><button className="btn" onClick={runTest}>Run audio self-test</button></div>
            {testErr && <p style={{ color: 'var(--danger)' }}>{testErr}</p>}
            {test && (
              <div>
                <p style={{ margin: '0 0 6px' }}><b style={{ color: test.passed ? 'var(--ok)' : 'var(--danger)' }}>{test.passed ? 'PASSED' : 'FAILED'}</b></p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {Object.entries(test.modules).map(([b, m]) => <li key={b}>{b}: {m.rmsDb.toFixed(1)} dBFS RMS {m.ok ? '✓' : '✗ silent'}</li>)}
                  <li>mix: {test.mix.seconds.toFixed(2)} s ({test.mix.samples} samples, expected {Math.round(test.mix.expectedSeconds * 44100)}) {test.mix.lengthOk ? '✓' : '✗'}</li>
                  <li>peak {test.mix.peakDb.toFixed(2)} dBFS {test.mix.peakOk ? '✓' : '✗'} · RMS {test.mix.rmsDb.toFixed(1)} dBFS</li>
                </ul>
              </div>
            )}
            <p className="tiny faint" style={{ margin: 0 }}>A buffer check is not listening. See the listening checklist below.</p>
          </div>
        </Panel>
      </div>

      <Panel title="The science, briefly">
        <div className="prose">
          <h3>Terpenes in cannabis</h3>
          <p>Cannabis accumulates a resin rich in monoterpenes (C10) and sesquiterpenes (C15) in glandular trichomes on the female flower. Booth et al. (2017) identified the terpene synthase genes whose products make up most of the terpenes of one hemp variety — including β-myrcene, (E)-β-ocimene, (−)-limonene, (+)-α-pinene, β-caryophyllene and α-humulene. Booth &amp; Bohlmann (2019) note that the biosynthesis and the factors behind terpene variability remain poorly understood, and that consistency between products sold as the same "strain" is a real concern.</p>
          <h3>What the lab numbers mean</h3>
          <p>Testing labs extract a ground, homogenised flower sample and quantify terpenes by gas chromatography (headspace or liquid injection, with flame-ionisation or mass-spectrometry detection). Methods differ between labs, and Jikomes &amp; Zoorob (2018) documented systematic differences in what different labs report. Each lab also has quantification limits; in the Smith et al. data these appear as large spikes at a single small value (0.01 or 0.03 % w/w), which this app flags rather than presenting as exact measurements. Routine GC does not separate mirror-image forms such as (+)- and (−)-limonene.</p>
          <h3>Strains, chemotypes and chemovars</h3>
          <p>Cannabinoid chemotype — THC-dominant, balanced, CBD-dominant — has a genetic basis (de Meijer et al. 2003). "Indica / sativa / hybrid" labels do not map cleanly onto chemistry: analysing about 90,000 U.S. flower samples (43,000 of them with terpene data), Smith et al. (2022) found terpene profiles cluster into a few recurring groups ("high caryophyllene–limonene", "high myrcene–pinene", "high terpinolene–myrcene"), that commercial labels align poorly with those groups, and that consistency within a strain name varies widely. Genetic work points the same way (Schwabe &amp; McGlaughlin 2019; Watts et al. 2021; Reimann-Philipp et al. 2020). Hazekamp et al. argued for describing cannabis by chemovar rather than cultivar name (2012, 2016).</p>
          <h3>Aroma is not just terpenes</h3>
          <p>Drying changes little in the qualitative volatile composition (Ross &amp; ElSohly 1996), but the most abundant volatiles are not necessarily the most odour-active (Rice &amp; Koziel 2015). The characteristic "skunk" note comes from trace prenylated volatile sulfur compounds such as 3-methyl-2-butene-1-thiol (Oswald et al. 2021), and other non-terpene compounds drive many distinctive aromas (Oswald et al. 2023).</p>
          <h3>The entourage effect: open question</h3>
          <p>The term originated for endocannabinoid lipids (Ben-Shabat et al. 1998) and was extended to plant terpenoids as a hypothesis (Russo 2011). In cell-based receptor studies, common terpenes did not alter THC's activity at CB1 or CB2 (Santiago et al. 2019; Finlay et al. 2020), with at most a weak β-caryophyllene–CB2 interaction (Finlay et al. 2020; see also Gertsch et al. 2008). Whether terpenes modify cannabis effects in people is not established, and nothing in this app assumes it.</p>
        </div>
      </Panel>

      <Panel title="Data sources (audited)">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Source</th><th>Licence</th><th>Decision</th><th>Use</th></tr></thead>
            <tbody>
              {Object.values(SOURCES).filter((s) => s.decision !== 'internal').map((s) => (
                <tr key={s.id}><td><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a><div className="tiny faint">{s.publisher}</div></td><td className="small">{s.license}</td><td><span className={`badge ${s.decision === 'approved' ? 'measured' : 'hypothetical'}`}>{s.decision}</span></td><td className="small">{s.notes.join(' ')}</td></tr>
              ))}
              <tr><td>Kushy Cannabis Dataset</td><td className="small">MIT (code); underlying provenance unknown</td><td><span className="badge warn">excluded</span></td><td className="small">2017 snapshot; terpene field empty in 9,523 of 9,524 strains; effect/ailment fields of unknown origin.</td></tr>
              <tr><td>CI-Strains-Pro</td><td className="small">CC BY 4.0 claimed over scraped third-party pages</td><td><span className="badge warn">excluded</span></td><td className="small">Seed-bank marketing data (cannabinoid ranges, genetics); no terpene measurements; redistribution rights of the underlying pages unclear.</td></tr>
              <tr><td>Leafly</td><td className="small">Proprietary</td><td><span className="badge warn">excluded</span></td><td className="small">Not scraped or redistributed. The Leafly-derived strain category and popularity columns in the Smith et al. repository are deliberately not used.</td></tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid cols-2">
        <Panel title="Methods">
          <div className="prose small">
            <h4>Missing data</h4>
            <p>Every value has a status: measured, at reporting floor, not detected, not reported, not measured, hypothetical, rejected (and others). Only numbers and not-detected results enter composition maths; unmeasured compounds are listed as gaps, never as zero.</p>
            <h4>Relative composition</h4>
            <p>Each covered compound as a share of the summed covered values — "% of measured terpenes", not % of sample mass.</p>
            <h4>Similarity</h4>
            <p>1 − Jensen–Shannon distance (log₂) between relative compositions renormalised over shared compounds, with cosine reported alongside. Tested on 43,148 samples: same-product pairs vs random pairs, ROC AUC {VALIDATION_AUC[14]} with 14 shared compounds, {VALIDATION_AUC[8]} with 8, {VALIDATION_AUC[5]} with 5, {VALIDATION_AUC[3]} with 3. Confidence: high ≥ 8 shared, moderate 5–7, low 3–4, insufficient &lt; 3. Rank-only comparisons (AUC 0.47 at 3 shared) are labelled approximate.</p>
            <h4>Sonification</h4>
            <p>Measurement (unchanged) → feature 0–1 (relative share, or percentile among the Smith et al. flower samples) → response curve → depth → target value → bounded, smoothed audio parameter. Missing compounds disable their routes.</p>
            <h4>Composition</h4>
            <p>Deterministic, seeded and planned before it plays (engine 2): an arrangement blueprint of sections with their own groove, bass motif, melodic motif and harmony; groove families per style; bass and melodic motifs that develop by named transformations (sequence, inversion, retrograde, fragmentation…) and return; phrases of 4, 8 or 16 bars. Scales via Tonal; chords stacked from the scale; voice-led pads; Euclidean rhythms (Toussaint 2005). Three listening demos are on the Synth page.</p>
          </div>
        </Panel>
        <Panel title="Limitations">
          <div className="prose small">
            <ul>
              <li>All lab data is flower only, from six U.S. labs (Smith et al.) and one state registry (CT); methods and reporting floors differ by lab.</li>
              <li>The CT registry does not document units or what a reported 0 means; its values are flagged accordingly.</li>
              <li>Ocimene and nerolidol are isomer totals; several compounds' stereochemistry is unresolved.</li>
              <li>Borneol, fenchol, geraniol and valencene are absent from the Smith et al. common panel and rarely detected in the CT subset, so their percentile normalisation falls back to relative share.</li>
              <li>Cultivar-name aggregates describe names, not genetics.</li>
              <li>Aroma categories group cited words; they do not predict how a mixture smells.</li>
              <li>Automated audio checks confirm signal, length and level — not musical quality. Listening is required.</li>
            </ul>
          </div>
        </Panel>
      </div>

      <Panel title="Listening checklist">
        <ol className="small" style={{ margin: 0, paddingLeft: 20, columns: 2, columnGap: 28 }}>
          <li>Profile A (Deep Botanical): drone and spacious pads lead; percussion restrained.</li>
          <li>Profile B (Bright Sequence): brighter, busier arpeggios; sharper transients.</li>
          <li>Stop: sound ends within a fraction of a second; no hanging notes.</li>
          <li>Play/Stop repeatedly: no doubling, flamming or speeding up.</li>
          <li>Move a Lab fader while "Follow the Lab" is on: the change is heard without clicks.</li>
          <li>Morph A→B slowly: timbre glides; patterns change only on bar lines.</li>
          <li>Let a piece run 5+ minutes: sections change at the boundaries shown in Now Playing; it should develop and return, not loop audibly.</li>
          <li>Try each style: they should differ in groove and harmony, not just effects.</li>
          <li>Same style, different seeds (Synth → Listening session): each piece should have its own groove, bass rhythm, melody and form, and a recognisable main idea that returns.</li>
          <li>Push reverb, delay and modulation to maximum: no runaway feedback or distortion.</li>
          <li>Import an exported WAV and stems into Ableton at the stated tempo: stems line up from bar 1.</li>
        </ol>
      </Panel>

      <Panel title="References">
        <ol className="prose refs" style={{ paddingLeft: 20, margin: 0 }}>
          {REFS.map((r) => <li key={r.key}>{r.text} {r.doi && <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">doi:{r.doi}</a>}</li>)}
        </ol>
        <p className="tiny faint" style={{ marginTop: 10 }}>Bibliographic details were checked against PubMed and Crossref on 2026-10-23. Software: React, Tone.js, Tonal, Zod, @tonejs/midi (MIT); IBM Plex fonts (SIL OFL 1.1). Chemical data © respective sources as listed. Project code: MIT.</p>
      </Panel>
    </div>
  );
}
