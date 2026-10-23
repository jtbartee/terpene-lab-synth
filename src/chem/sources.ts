// Registry of data sources shown in the UI. Mirrors docs/DATA_SOURCES.md.

export interface SourceInfo {
  id: string;
  name: string;
  short: string;
  publisher: string;
  url: string;
  license: string;
  decision: 'approved' | 'conditional' | 'excluded' | 'internal';
  citation?: string;
  doi?: string;
  notes: string[];
}

export const SOURCES: Record<string, SourceInfo> = {
  pubchem: {
    id: 'pubchem', name: 'PubChem', short: 'PubChem', publisher: 'U.S. National Library of Medicine (NCBI)',
    url: 'https://pubchem.ncbi.nlm.nih.gov/', license: 'NCBI public data; individual contributed records cite their own sources',
    decision: 'approved',
    citation: 'Kim S, et al. PubChem 2025 update. Nucleic Acids Res. 2025.',
    notes: ['Identifiers, formulae, masses, 2D layouts and computed 3D conformers (PubChem3D).', 'Odor text from the Hazardous Substances Data Bank (HSDB) and FEMA flavor profiles, each with its source named.'],
  },
  smith2022: {
    id: 'smith2022', name: 'Phytochemical diversity of commercial Cannabis in the US', short: 'Smith et al. 2022',
    publisher: 'Smith CJ, Vergara D, Keegan B, Jikomes N', url: 'https://github.com/cjsmith015/phytochemical-diversity-cannabis',
    license: 'CC0-1.0 (public domain dedication)', decision: 'approved',
    citation: 'Smith CJ, Vergara D, Keegan B, Jikomes N (2022) The phytochemical diversity of commercial Cannabis in the United States. PLoS ONE 17(5): e0267498.',
    doi: '10.1371/journal.pone.0267498',
    notes: [
      'Flower only, six U.S. testing labs (AK, CA, FL, MI, OR, WA); values in % w/w as converted by the authors.',
      '43,148 samples with terpene data; 14 commonly measured terpenes; ocimene and nerolidol are isomer totals.',
      'Each lab has its own method and reporting floor; values at a floor are flagged.',
      'Leafly-derived strain category and popularity fields are deliberately not used.',
    ],
  },
  ctRegistry: {
    id: 'ctRegistry', name: 'Connecticut Cannabis Product Registry', short: 'CT Registry',
    publisher: 'CT Dept. of Consumer Protection, Drug Control Division',
    url: 'https://data.ct.gov/Health-and-Human-Services/Cannabis-Product-Registry/egd5-wb6r',
    license: 'Public Domain', decision: 'conditional',
    notes: [
      'Flower dosage forms only; 4,670 products with terpene values.',
      'Units are not documented by the publisher; read as % w/w from magnitudes and flagged.',
      'A reported 0 may mean "not tested" — such zeros are flagged as ambiguous.',
      'Product names are registry brand names, often internal codes rather than cultivar names.',
    ],
  },
  user: { id: 'user', name: 'Your profiles', short: 'User', publisher: 'You', url: '', license: 'Stored only on this device', decision: 'internal', notes: ['Hypothetical; not a measurement.'] },
  demo: { id: 'demo', name: 'Built-in demonstration profiles', short: 'Demo', publisher: 'This project', url: '', license: 'MIT', decision: 'internal', notes: ['Fictional artistic test profiles. Not laboratory measurements, known cultivars, validated aromas or predicted effects.'] },
  synthetic: { id: 'synthetic', name: 'Synthetic transition', short: 'Morph', publisher: 'This project', url: '', license: 'MIT', decision: 'internal', notes: ['Interpolated between two profiles; not a sample.'] },
};

export function sourceInfo(id: string): SourceInfo {
  return SOURCES[id] ?? { id, name: id, short: id, publisher: 'unknown', url: '', license: 'unknown', decision: 'internal', notes: [] };
}
