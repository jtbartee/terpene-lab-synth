// Fetches reference chemistry for every compound in compound-manifest.json from
// PubChem PUG REST / PUG View and writes src/chem/compounds.generated.json.
// Raw responses are cached in data/raw/pubchem/ so the build is reproducible
// offline; delete that folder to force a refresh.
//
// Nothing here is invented: if PubChem has no 3D conformer or no odor text for a
// compound, the field is written as null and the UI says so.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSdf } from './lib/sdf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data/raw/pubchem');
mkdirSync(RAW, { recursive: true });
const manifest = JSON.parse(readFileSync(join(ROOT, 'scripts/compound-manifest.json'), 'utf8'));

const REST = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const VIEW = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cached(name, url, { optional = false, text = false } = {}) {
  const file = join(RAW, name);
  if (existsSync(file)) {
    const body = readFileSync(file, 'utf8');
    if (body === '__404__') return null;
    return text ? body : JSON.parse(body);
  }
  await sleep(260); // PubChem asks for no more than 5 requests per second
  const res = await fetch(url);
  if (res.status === 404 && optional) {
    writeFileSync(file, '__404__');
    return null;
  }
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const body = await res.text();
  writeFileSync(file, body);
  return text ? body : JSON.parse(body);
}

const PROPS = 'Title,IUPACName,MolecularFormula,MolecularWeight,ExactMass,InChI,InChIKey,SMILES,ConnectivitySMILES,XLogP,TPSA,HeavyAtomCount,DefinedAtomStereoCount,UndefinedAtomStereoCount,DefinedBondStereoCount';

function stringsFromInfo(info) {
  return (info.Value?.StringWithMarkup ?? []).map((s) => s.String).filter(Boolean);
}

// Collect every Information block under a PUG View heading, with its source.
function viewEntries(view) {
  if (!view?.Record) return [];
  const refs = new Map((view.Record.Reference ?? []).map((r) => [r.ReferenceNumber, r]));
  const out = [];
  const walk = (sec) => {
    for (const s of sec.Section ?? []) walk(s);
    for (const info of sec.Information ?? []) {
      const ref = refs.get(info.ReferenceNumber);
      for (const text of stringsFromInfo(info)) {
        out.push({
          text: text.trim(),
          source: ref?.SourceName ?? 'PubChem',
          sourceUrl: ref?.URL ?? null,
          reference: info.Reference?.[0] ?? null,
        });
      }
    }
  };
  walk(view.Record);
  // de-duplicate identical text from the same source
  const seen = new Set();
  return out.filter((e) => {
    const k = `${e.source}|${e.text.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const JUNK_SYNONYM = /^(\d|[A-Z]{2,}\d|UNII|EINECS|CAS-|NSC|DTXSID|CHEBI|SCHEMBL|ZINC|AKOS|MFCD|HSDB|BRN|FEMA|AI3|CCRIS|InChI|BDBM|Q\d|NCGC|LS-|AS-|DB-|SY|CS-|HY-|BP-|EN300|STL|KS-|AC-|SB|s\d)/;

async function compoundRecord(cid) {
  const props = (await cached(`props-${cid}.json`, `${REST}/compound/cid/${cid}/property/${PROPS}/JSON`)).PropertyTable.Properties[0];
  const syn = await cached(`synonyms-${cid}.json`, `${REST}/compound/cid/${cid}/synonyms/JSON`, { optional: true });
  const synonyms = (syn?.InformationList?.Information?.[0]?.Synonym ?? [])
    .filter((s) => !JUNK_SYNONYM.test(s) && s.length < 48)
    .slice(0, 10);
  const sdf2 = await cached(`2d-${cid}.sdf`, `${REST}/compound/cid/${cid}/SDF?record_type=2d`, { text: true });
  const sdf3 = await cached(`3d-${cid}.sdf`, `${REST}/compound/cid/${cid}/SDF?record_type=3d`, { optional: true, text: true });
  const odorView = await cached(`odor-${cid}.json`, `${VIEW}/data/compound/${cid}/JSON?heading=Odor`, { optional: true });
  const bpView = await cached(`bp-${cid}.json`, `${VIEW}/data/compound/${cid}/JSON?heading=Boiling+Point`, { optional: true });
  const femaView = await cached(`fema-${cid}.json`, `${VIEW}/data/compound/${cid}/JSON?heading=FEMA+Flavor+Profile`, { optional: true });
  return {
    cid,
    title: props.Title,
    iupacName: props.IUPACName ?? null,
    formula: props.MolecularFormula,
    molecularWeight: Number(props.MolecularWeight),
    exactMass: Number(props.ExactMass),
    inchi: props.InChI,
    inchiKey: props.InChIKey,
    smiles: props.SMILES,
    connectivitySmiles: props.ConnectivitySMILES,
    xlogp: props.XLogP ?? null,
    tpsa: props.TPSA ?? null,
    heavyAtoms: props.HeavyAtomCount,
    definedStereocentres: props.DefinedAtomStereoCount,
    undefinedStereocentres: props.UndefinedAtomStereoCount,
    definedDoubleBondStereo: props.DefinedBondStereoCount,
    synonyms,
    structure2d: parseSdf(sdf2),
    // PubChem3D conformers are computed (theoretical) models, not experimental structures.
    structure3d: sdf3 ? parseSdf(sdf3) : null,
    odor: viewEntries(odorView).slice(0, 6),
    // FEMA flavor profiles are flavour-industry descriptors, kept apart from HSDB odor text.
    femaFlavor: viewEntries(femaView).slice(0, 2),
    boilingPoint: viewEntries(bpView).slice(0, 3),
    pubchemUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
  };
}

const compounds = {};
const allCids = new Set();
for (const a of manifest.analytes) [a.referenceCid, ...a.memberCids].forEach((c) => allCids.add(c));
for (const c of manifest.contextCompounds) allCids.add(c.cid);

for (const cid of allCids) {
  process.stdout.write(`CID ${cid} … `);
  compounds[cid] = await compoundRecord(cid);
  const r = compounds[cid];
  console.log(`${r.title} ${r.formula} 2D:${r.structure2d.atoms.length} atoms 3D:${r.structure3d ? 'yes' : 'none'} odor:${r.odor.length} fema:${r.femaFlavor.length}`);
}

const out = {
  generated: new Date().toISOString().slice(0, 10),
  verified: manifest.verified,
  source: 'PubChem PUG REST and PUG View (https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest)',
  analytes: manifest.analytes,
  contextCompounds: manifest.contextCompounds,
  compounds,
};
writeFileSync(join(ROOT, 'src/chem/compounds.generated.json'), JSON.stringify(out));
console.log(`wrote ${Object.keys(compounds).length} compounds`);
