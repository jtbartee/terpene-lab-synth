// Compound reference drawer: verified identifiers, structures, cited aroma
// descriptors, presence in the approved data, and the (artistic) mapping.

import { useEffect, useRef } from 'react';
import { COMPOUND_DATA_VERIFIED, FAMILY_LABEL, analyte, compound, referenceCompound } from '../../chem/analytes';
import { analyteAroma, AROMA_LABEL } from '../../chem/aroma';
import population from '../../chem/population.generated.json';
import type { AnalyteId } from '../../chem/types';
import { targetInfo } from '../../sonify/targets';
import { getState, setState, useStore } from '../../store/store';
import { IconClose } from '../components/icons';
import { Molecule3D, Structure2D } from '../viz/molecules';

const POP = population.analytes as unknown as Record<string, { nMeasured: number; fractionPositive: number; quantiles: number[] } | undefined>;

// Verified literature notes (abstracts checked via PubMed, 2026-10-23).
const LIT: Partial<Record<AnalyteId, string[]>> = {
  myrcene: ['Booth et al. 2017 (PLoS ONE 12:e0173911) characterised cannabis terpene synthases whose products include β-myrcene.'],
  limonene: ['Günnewich et al. 2007 (Nat Prod Commun 2:223) and Booth et al. 2017 characterised a cannabis (−)-limonene synthase; Oswald et al. 2023 (ACS Omega 8:39203) refer to D-(+)-limonene. Routine testing does not separate the enantiomers.'],
  caryophyllene: ['Booth et al. 2017 identified sesquiterpene synthases producing β-caryophyllene and α-humulene.', 'Gertsch et al. 2008 (PNAS 105:9099) reported β-caryophyllene binds the CB2 receptor in vitro; Finlay et al. 2020 found at most a weak CB2 interaction. Neither is a claim about effects in people.'],
  humulene: ['Booth et al. 2017 identified a synthase producing α-humulene alongside β-caryophyllene.'],
  a_pinene: ['Günnewich et al. 2007 characterised a cannabis (+)-α-pinene synthase; Booth et al. 2017 list (+)-α-pinene among major Finola terpenes.'],
  ocimene: ['Booth et al. 2017 list (E)-β-ocimene among the major terpenes of the hemp variety Finola.'],
  terpinolene: ['Smith et al. 2022 found a "high terpinolene–myrcene" cluster as one of three common terpene groups in U.S. flower.'],
};

export function CompoundDetail() {
  const id = useStore((s) => s.infoAnalyte);
  const mapping = useStore((s) => s.synth.mapping);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (id && !d.open) d.showModal?.();
    if (!id && d.open) d.close();
  }, [id]);
  const close = () => setState({ infoAnalyte: null });
  return (
    <dialog ref={ref} className="drawer" onClose={() => getState().infoAnalyte && close()} onClick={(e) => { if (e.target === ref.current) close(); }} aria-labelledby="cd-title">
      {id && <CompoundBody id={id} mappingRoutes={mapping.routes.filter((r) => r.analyte === id && r.enabled)} onClose={close} />}
    </dialog>
  );
}

function CompoundBody({ id, mappingRoutes, onClose }: { id: AnalyteId; mappingRoutes: { target: string; amount: number }[]; onClose: () => void }) {
  const a = analyte(id);
  const c = referenceCompound(id);
  const aroma = analyteAroma(id);
  const pop = POP[id];
  return (
    <div className="drawer-inner">
      <div className="drawer-head">
        <div>
          <div className="label">{FAMILY_LABEL[a.family]} · {a.subclass}</div>
          <h2 id="cd-title" style={{ fontSize: 24, marginTop: 4 }}>{a.label}</h2>
          <div className="formula" style={{ marginTop: 4 }}>{c.formula} · {c.molecularWeight.toFixed(2)} g/mol</div>
        </div>
        <button className="btn icon" onClick={onClose} aria-label="Close compound details"><IconClose /></button>
      </div>

      <div className="grid cols-2">
        <div>
          <div className="label" style={{ marginBottom: 4 }}>2D structure</div>
          <Structure2D structure={c.structure2d} label={a.label} />
        </div>
        <div>
          <div className="label" style={{ marginBottom: 4 }}>3D model</div>
          {c.structure3d ? <Molecule3D structure={c.structure3d} label={a.label} /> : <div className="empty small">PubChem has no 3D conformer for this record, so none is drawn.</div>}
        </div>
      </div>

      <section>
        <h3 className="label" style={{ marginBottom: 6 }}>Chemical reference</h3>
        <dl className="kv">
          <dt>PubChem CID</dt><dd><a href={c.pubchemUrl} target="_blank" rel="noreferrer">{c.cid}</a> ({c.title})</dd>
          <dt>IUPAC name</dt><dd>{c.iupacName ?? '—'}</dd>
          <dt>InChIKey</dt><dd className="mono">{c.inchiKey}</dd>
          <dt>SMILES</dt><dd className="mono">{c.smiles}</dd>
          <dt>Exact mass</dt><dd>{c.exactMass.toFixed(4)} Da</dd>
          <dt>XLogP3 (computed)</dt><dd>{c.xlogp ?? '—'}</dd>
          <dt>Stereo</dt><dd>{c.definedStereocentres} defined / {c.undefinedStereocentres} undefined stereocentres; {c.definedDoubleBondStereo} defined double-bond geometries</dd>
          <dt>Synonyms</dt><dd>{c.synonyms.slice(0, 8).join(' · ')}</dd>
          {c.boilingPoint[0] && <><dt>Boiling point</dt><dd>{c.boilingPoint[0].text} <span className="cite">({c.boilingPoint[0].source})</span></dd></>}
        </dl>
        <p className="small" style={{ marginTop: 10 }}>{a.stereoNote}</p>
        {a.memberCids.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Related stereoisomer / isomer</th><th>CID</th><th>InChIKey</th></tr></thead>
              <tbody>
                {a.memberCids.map((cid) => { const m = compound(cid); return <tr key={cid}><td>{m.title}</td><td><a href={m.pubchemUrl} target="_blank" rel="noreferrer">{cid}</a></td><td className="mono tiny">{m.inchiKey}</td></tr>; })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="label" style={{ marginBottom: 6 }}>Aroma associations (cited)</h3>
        {!aroma.hasEvidence ? (
          <p className="small muted">No odor or flavour descriptor is available for this compound in the cited sources (PubChem HSDB odor statements and FEMA flavour profiles). None is invented here.</p>
        ) : (
          <>
            <div className="chips" style={{ marginBottom: 8 }}>{aroma.categories.map((k) => <span key={k} className="chip">{AROMA_LABEL[k]}</span>)}</div>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {[...new Map([...aroma.evidence, ...aroma.unclassified.map((u) => ({ ...u, category: null }))].map((e) => [`${e.source}|${e.text}`, e])).values()].map((e) => (
                <li key={`${e.source}|${e.text}`}>"{e.text}" <span className="cite">— {e.source}</span></li>
              ))}
            </ul>
            <p className="tiny faint" style={{ marginTop: 6 }}>Descriptors describe the pure compound. Category chips are this project's grouping of those words. Perceived aroma of a mixture is not a sum of its parts.</p>
          </>
        )}
      </section>

      <section>
        <h3 className="label" style={{ marginBottom: 6 }}>Presence in cannabis (approved data)</h3>
        {pop ? (
          <p className="small">Measured in {pop.nMeasured.toLocaleString()} flower samples in Smith et al. 2022; reported above zero in {(pop.fractionPositive * 100).toFixed(0)} % of them. Median {pop.quantiles[50].toFixed(3)} % w/w; 90th percentile {pop.quantiles[90].toFixed(3)} % w/w (values at a lab's reporting floor included as reported).</p>
        ) : (
          <p className="small">Not among the 14 terpenes measured consistently in Smith et al. 2022. The Connecticut registry reports it for a minority of flower products with an extended panel (see Explore).</p>
        )}
        {(LIT[id] ?? []).map((t) => <p key={t} className="small">{t}</p>)}
      </section>

      <section>
        <h3 className="label" style={{ marginBottom: 6 }}>Musical mapping (artistic)</h3>
        {mappingRoutes.length ? (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {mappingRoutes.map((r) => <li key={r.target}>{targetInfo(r.target as never).label} — depth {Math.round(r.amount * 100)}</li>)}
          </ul>
        ) : <p className="small muted">No active mapping routes for this compound.</p>}
        <p className="tiny faint">An artistic design choice, editable in the Synth. Not a property of the chemical.</p>
      </section>
      <p className="tiny faint">Reference data verified against PubChem on {COMPOUND_DATA_VERIFIED}.</p>
    </div>
  );
}
