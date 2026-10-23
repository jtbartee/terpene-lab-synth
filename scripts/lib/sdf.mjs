// Minimal V2000 molfile/SDF parser: enough to read PubChem 2D and 3D records.
// Returns atoms with coordinates and bonds with order (1, 2, 3; 4 = aromatic).

export function parseSdf(text) {
  const lines = text.split(/\r?\n/);
  const counts = lines[3];
  const nAtoms = parseInt(counts.slice(0, 3), 10);
  const nBonds = parseInt(counts.slice(3, 6), 10);
  if (!Number.isFinite(nAtoms) || !Number.isFinite(nBonds)) throw new Error('bad SDF counts line');
  const atoms = [];
  for (let i = 0; i < nAtoms; i++) {
    const l = lines[4 + i];
    atoms.push({
      x: round(parseFloat(l.slice(0, 10))),
      y: round(parseFloat(l.slice(10, 20))),
      z: round(parseFloat(l.slice(20, 30))),
      el: l.slice(31, 34).trim(),
    });
  }
  const bonds = [];
  for (let i = 0; i < nBonds; i++) {
    const l = lines[4 + nAtoms + i];
    bonds.push({
      a: parseInt(l.slice(0, 3), 10) - 1,
      b: parseInt(l.slice(3, 6), 10) - 1,
      order: parseInt(l.slice(6, 9), 10),
      stereo: parseInt(l.slice(9, 12), 10) || 0,
    });
  }
  return { atoms, bonds };
}

const round = (v) => Math.round(v * 10000) / 10000;
