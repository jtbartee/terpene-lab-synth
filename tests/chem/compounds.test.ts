import { describe, expect, it } from 'vitest';
import { ANALYTES, ANALYTE_IDS, CORE_CHANNELS, FAMILY_FORMULA, analyte, compound, referenceCompound } from '../../src/chem/analytes';
import { analyteAroma } from '../../src/chem/aroma';

// Values below were checked against PubChem on 2026-10-23 (PUG REST property tables).
const EXPECTED: Record<string, { cid: number; formula: string; mw: number; inchiKey: string }> = {
  myrcene: { cid: 31253, formula: 'C10H16', mw: 136.23, inchiKey: 'UAHWPYUMFXYFJY-UHFFFAOYSA-N' },
  limonene: { cid: 22311, formula: 'C10H16', mw: 136.23, inchiKey: 'XMGQYMWWDOXHJM-UHFFFAOYSA-N' },
  caryophyllene: { cid: 5281515, formula: 'C15H24', mw: 204.35, inchiKey: 'NPNUFJAVOOONJE-GFUGXAQUSA-N' },
  a_pinene: { cid: 6654, formula: 'C10H16', mw: 136.23, inchiKey: 'GRWFGVWFFZKLTI-UHFFFAOYSA-N' },
  b_pinene: { cid: 14896, formula: 'C10H16', mw: 136.23, inchiKey: 'WTARULDDTDQWMU-UHFFFAOYSA-N' },
  linalool: { cid: 6549, formula: 'C10H18O', mw: 154.25, inchiKey: 'CDOSHBSSFJOMGT-UHFFFAOYSA-N' },
  humulene: { cid: 5281520, formula: 'C15H24', mw: 204.35, inchiKey: 'FAMPSKZZVDUYOS-HRGUGZIWSA-N' },
  terpinolene: { cid: 11463, formula: 'C10H16', mw: 136.23, inchiKey: 'MOYAFQVGZZPNRA-UHFFFAOYSA-N' },
  ocimene: { cid: 18756, formula: 'C10H16', mw: 136.23, inchiKey: 'IHPKGUQCSIINRJ-UHFFFAOYSA-N' },
  nerolidol: { cid: 8888, formula: 'C15H26O', mw: 222.37, inchiKey: 'FQTLCLSUCSAZDY-UHFFFAOYSA-N' },
  bisabolol: { cid: 10586, formula: 'C15H26O', mw: 222.37, inchiKey: 'RGZSQWQPBWRIAQ-UHFFFAOYSA-N' },
  camphene: { cid: 6616, formula: 'C10H16', mw: 136.23, inchiKey: 'CRPUJAZIXJMDBK-UHFFFAOYSA-N' },
  borneol: { cid: 64685, formula: 'C10H18O', mw: 154.25, inchiKey: 'DTGKSKDOIYIVQL-UHFFFAOYSA-N' },
  fenchol: { cid: 15406, formula: 'C10H18O', mw: 154.25, inchiKey: 'IAIHUHQCLTYTSF-UHFFFAOYSA-N' },
  geraniol: { cid: 637566, formula: 'C10H18O', mw: 154.25, inchiKey: 'GLZPCOQZEFWAFX-JXMROGBWSA-N' },
  valencene: { cid: 9855795, formula: 'C15H24', mw: 204.35, inchiKey: 'QEBNYNLSCGVZOH-NFAWXSAZSA-N' },
};

describe('compound reference library', () => {
  it('covers all 16 compounds the brief requires', () => {
    expect(CORE_CHANNELS).toHaveLength(16);
    for (const id of CORE_CHANNELS) expect(ANALYTE_IDS).toContain(id);
  });

  it.each(Object.entries(EXPECTED))('%s has the verified PubChem identity', (id, e) => {
    const a = analyte(id as never);
    expect(a.referenceCid).toBe(e.cid);
    const c = referenceCompound(a.id);
    expect(c.formula).toBe(e.formula);
    expect(c.molecularWeight).toBeCloseTo(e.mw, 2);
    expect(c.inchiKey).toBe(e.inchiKey);
  });

  it('family is consistent with the molecular formula of every compound', () => {
    for (const a of ANALYTES) {
      for (const cid of [a.referenceCid, ...a.memberCids]) expect(compound(cid).formula).toBe(FAMILY_FORMULA[a.family]);
    }
  });

  it('stereoisomers keep distinct records (same skeleton, different stereo layer)', () => {
    for (const a of ANALYTES) {
      const keys = [a.referenceCid, ...a.memberCids].map((c) => compound(c).inchiKey);
      expect(new Set(keys).size).toBe(keys.length);
      const skeletons = new Set(keys.map((k) => k.split('-')[0]));
      expect(skeletons.size).toBe(1);
    }
  });

  it('limonene enantiomers are separate compounds with opposite stereo descriptors', () => {
    const plus = compound(440917);
    const minus = compound(439250);
    expect(plus.inchiKey).not.toBe(minus.inchiKey);
    expect(plus.smiles).toContain('@@');
    expect(minus.smiles).not.toContain('@@');
  });

  it('every compound has a parsed 2D structure whose atom count matches the formula', () => {
    for (const a of ANALYTES) {
      const c = referenceCompound(a.id);
      const counts: Record<string, number> = {};
      for (const at of c.structure2d.atoms) counts[at.el] = (counts[at.el] ?? 0) + 1;
      const formula = Object.entries(counts).sort().map(([el, n]) => `${el}${n}`).join('');
      const expected = (c.formula.match(/[A-Z][a-z]?\d*/g) ?? []).map((t) => (/\d/.test(t) ? t : `${t}1`)).sort().join('');
      expect(formula).toBe(expected);
      for (const b of c.structure2d.bonds) {
        expect(b.a).toBeGreaterThanOrEqual(0);
        expect(b.b).toBeLessThan(c.structure2d.atoms.length);
      }
    }
  });

  it('3D conformers, where present, have the same atoms as the 2D record', () => {
    for (const a of ANALYTES) {
      const c = referenceCompound(a.id);
      if (!c.structure3d) continue;
      expect(c.structure3d.atoms.map((x) => x.el).sort()).toEqual(c.structure2d.atoms.map((x) => x.el).sort());
      expect(c.structure3d.atoms.some((x) => x.z !== 0)).toBe(true);
    }
  });

  it('aroma categories only come from cited text', () => {
    for (const id of ANALYTE_IDS) {
      const a = analyteAroma(id);
      for (const e of a.evidence) {
        expect(e.text.length).toBeGreaterThan(0);
        expect(e.source.length).toBeGreaterThan(0);
      }
      if (!a.hasEvidence) expect(a.categories).toEqual([]);
    }
    expect(analyteAroma('limonene').categories).toContain('citrus');
    expect(analyteAroma('a_pinene').categories).toContain('pine');
    expect(analyteAroma('linalool').categories).toContain('floral');
  });
});
