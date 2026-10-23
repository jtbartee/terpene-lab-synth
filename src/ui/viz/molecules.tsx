// Molecular structure views built from PubChem coordinates.
//   Structure2D — skeletal formula from the PubChem 2D layout (carbon and its
//                 hydrogens implied, heteroatoms labelled, double bonds offset).
//   Molecule3D  — ball-and-stick view of the PubChem3D computed conformer.
//   MoleculeField — an abstract, explicitly decorative animation.

import { useEffect, useRef, useState } from 'react';
import { ANALYTE_COLOR, referenceCompound, type Structure } from '../../chem/analytes';
import { relativeComposition } from '../../chem/profile';
import type { AnalyteId, Profile } from '../../chem/types';

const CPK: Record<string, string> = { C: '#8d9488', H: '#e8e8e0', O: '#e0573f', N: '#4f7fe0', S: '#e2c43a' };
const RADIUS: Record<string, number> = { C: 0.36, H: 0.22, O: 0.36, N: 0.35, S: 0.45 };

export function Structure2D({ structure, label }: { structure: Structure; label: string }) {
  const heavy = structure.atoms.map((a, i) => ({ ...a, i })).filter((a) => a.el !== 'H');
  const keep = new Set(heavy.map((a) => a.i));
  const bonds = structure.bonds.filter((b) => keep.has(b.a) && keep.has(b.b));
  const xs = heavy.map((a) => a.x), ys = heavy.map((a) => a.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 0.9;
  const w = maxX - minX + 2 * pad, h = maxY - minY + 2 * pad;
  const X = (x: number) => x - minX + pad;
  const Y = (y: number) => maxY - y + pad; // SDF y points up
  const atom = (i: number) => structure.atoms[i];
  return (
    <svg className="mol2d" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`2D skeletal structure of ${label}`} preserveAspectRatio="xMidYMid meet">
      {bonds.map((b, k) => {
        const A = atom(b.a), B = atom(b.b);
        const x1 = X(A.x), y1 = Y(A.y), x2 = X(B.x), y2 = Y(B.y);
        const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const shrinkA = A.el !== 'C' ? 0.28 : 0, shrinkB = B.el !== 'C' ? 0.28 : 0;
        const sx1 = x1 + (dx / len) * shrinkA, sy1 = y1 + (dy / len) * shrinkA;
        const sx2 = x2 - (dx / len) * shrinkB, sy2 = y2 - (dy / len) * shrinkB;
        if (b.stereo === 1 || b.stereo === 6) {
          // wedge (towards viewer) or hashed wedge (away)
          const wv = 0.12;
          if (b.stereo === 1) return <polygon key={k} points={`${sx1},${sy1} ${sx2 + nx * wv},${sy2 + ny * wv} ${sx2 - nx * wv},${sy2 - ny * wv}`} fill="#262a22" />;
          return (
            <g key={k} stroke="#262a22" strokeWidth={0.04}>
              {Array.from({ length: 6 }, (_, j) => {
                const t = (j + 1) / 6;
                const cx = sx1 + (sx2 - sx1) * t, cy = sy1 + (sy2 - sy1) * t;
                return <line key={j} x1={cx + nx * wv * t} y1={cy + ny * wv * t} x2={cx - nx * wv * t} y2={cy - ny * wv * t} />;
              })}
            </g>
          );
        }
        const lines = [<line key="a" x1={sx1} y1={sy1} x2={sx2} y2={sy2} stroke="#262a22" strokeWidth={0.06} strokeLinecap="round" />];
        if (b.order >= 2) {
          const off = 0.13;
          lines.push(<line key="b" x1={sx1 + nx * off + (dx / len) * 0.12} y1={sy1 + ny * off + (dy / len) * 0.12} x2={sx2 + nx * off - (dx / len) * 0.12} y2={sy2 + ny * off - (dy / len) * 0.12} stroke="#262a22" strokeWidth={0.05} strokeLinecap="round" />);
        }
        if (b.order === 3) lines.push(<line key="c" x1={sx1 - nx * 0.13} y1={sy1 - ny * 0.13} x2={sx2 - nx * 0.13} y2={sy2 - ny * 0.13} stroke="#262a22" strokeWidth={0.05} />);
        return <g key={k}>{lines}</g>;
      })}
      {heavy.filter((a) => a.el !== 'C').map((a) => {
        const hs = structure.bonds.filter((b) => (b.a === a.i && atom(b.b).el === 'H') || (b.b === a.i && atom(b.a).el === 'H')).length;
        return (
          <text key={a.i} x={X(a.x)} y={Y(a.y)} textAnchor="middle" dominantBaseline="central" fontSize={0.42} fontWeight={600} fill={a.el === 'O' ? '#b8341d' : a.el === 'S' ? '#8a6d00' : '#2348a8'} fontFamily="IBM Plex Sans, sans-serif">
            {a.el}{hs ? `H${hs > 1 ? hs : ''}` : ''}
          </text>
        );
      })}
    </svg>
  );
}

export function Molecule3D({ structure, label }: { structure: Structure; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ rx: -0.4, ry: 0.6, zoom: 1, dragging: null as null | { x: number; y: number; rx: number; ry: number } });
  const [showH, setShowH] = useState(true);
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [spin, setSpin] = useState(!reduced);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const atoms = structure.atoms;
    const cx = atoms.reduce((s, a) => s + a.x, 0) / atoms.length;
    const cy = atoms.reduce((s, a) => s + a.y, 0) / atoms.length;
    const cz = atoms.reduce((s, a) => s + a.z, 0) / atoms.length;
    const ext = Math.max(...atoms.map((a) => Math.hypot(a.x - cx, a.y - cy, a.z - cz))) || 1;
    let raf = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (spin && !view.current.dragging) view.current.ry += dt * 0.5;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const { rx, ry, zoom } = view.current;
      const scale = (Math.min(W, H) / (2.6 * ext)) * zoom;
      const sinX = Math.sin(rx), cosX = Math.cos(rx), sinY = Math.sin(ry), cosY = Math.cos(ry);
      const proj = atoms.map((a) => {
        const x = a.x - cx, y = a.y - cy, z = a.z - cz;
        const x1 = x * cosY + z * sinY, z1 = -x * sinY + z * cosY;
        const y2 = y * cosX - z1 * sinX, z2 = y * sinX + z1 * cosX;
        const persp = 1 / (1 + z2 / (ext * 6));
        return { sx: W / 2 + x1 * scale * persp, sy: H / 2 - y2 * scale * persp, z: z2, p: persp, el: a.el };
      });
      const visible = (i: number) => showH || atoms[i].el !== 'H';
      const bonds = structure.bonds.filter((b) => visible(b.a) && visible(b.b)).sort((p, q) => (proj[p.a].z + proj[p.b].z) - (proj[q.a].z + proj[q.b].z));
      ctx.lineCap = 'round';
      for (const b of bonds) {
        const A = proj[b.a], B = proj[b.b];
        const depth = 0.55 + 0.45 * (1 - ((A.z + B.z) / 2 + ext) / (2 * ext));
        ctx.strokeStyle = `rgba(200, 204, 190, ${depth.toFixed(2)})`;
        ctx.lineWidth = Math.max(1.2, scale * 0.09);
        if (b.order >= 2) {
          const dx = B.sx - A.sx, dy = B.sy - A.sy, l = Math.hypot(dx, dy) || 1;
          const ox = (-dy / l) * scale * 0.07, oy = (dx / l) * scale * 0.07;
          for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(A.sx + ox * s, A.sy + oy * s); ctx.lineTo(B.sx + ox * s, B.sy + oy * s); ctx.stroke(); }
        } else { ctx.beginPath(); ctx.moveTo(A.sx, A.sy); ctx.lineTo(B.sx, B.sy); ctx.stroke(); }
      }
      const order = proj.map((p, i) => [p, i] as const).filter(([, i]) => visible(i)).sort((p, q) => p[0].z - q[0].z);
      for (const [p] of order) {
        const r = (RADIUS[p.el] ?? 0.35) * scale * p.p;
        const g = ctx.createRadialGradient(p.sx - r * 0.35, p.sy - r * 0.35, r * 0.1, p.sx, p.sy, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.25, CPK[p.el] ?? '#c0c0c0');
        g.addColorStop(1, '#141612');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(1.5, r), 0, Math.PI * 2); ctx.fill();
      }
      if (spin || view.current.dragging) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const redraw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
    (cv as HTMLCanvasElement & { _redraw?: () => void })._redraw = redraw;
    return () => cancelAnimationFrame(raf);
  }, [structure, showH, spin]);

  const redraw = () => (canvas.current as (HTMLCanvasElement & { _redraw?: () => void }) | null)?._redraw?.();
  return (
    <div className="stack" style={{ gap: 6 }}>
      <canvas
        ref={canvas}
        className="mol3d"
        role="img"
        tabIndex={0}
        aria-label={`3D model of ${label}: drag or use arrow keys to rotate, plus and minus to zoom`}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); view.current.dragging = { x: e.clientX, y: e.clientY, rx: view.current.rx, ry: view.current.ry }; redraw(); }}
        onPointerMove={(e) => { const d = view.current.dragging; if (!d) return; view.current.ry = d.ry + (e.clientX - d.x) * 0.01; view.current.rx = d.rx + (e.clientY - d.y) * 0.01; }}
        onPointerUp={() => { view.current.dragging = null; redraw(); }}
        onWheel={(e) => { e.preventDefault(); view.current.zoom = Math.max(0.4, Math.min(3, view.current.zoom * (e.deltaY > 0 ? 0.92 : 1.08))); redraw(); }}
        onKeyDown={(e) => {
          const v = view.current;
          if (e.key === 'ArrowLeft') v.ry -= 0.15; else if (e.key === 'ArrowRight') v.ry += 0.15;
          else if (e.key === 'ArrowUp') v.rx -= 0.15; else if (e.key === 'ArrowDown') v.rx += 0.15;
          else if (e.key === '+' || e.key === '=') v.zoom = Math.min(3, v.zoom * 1.1);
          else if (e.key === '-') v.zoom = Math.max(0.4, v.zoom / 1.1);
          else return;
          e.preventDefault();
          redraw();
        }}
      />
      <div className="row tight small">
        <label className="check"><input type="checkbox" checked={showH} onChange={(e) => setShowH(e.target.checked)} /> Hydrogens</label>
        <label className="check"><input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} /> Auto-rotate</label>
        <span className="tiny faint">Computed conformer (PubChem3D), not an experimental structure.</span>
      </div>
    </div>
  );
}

/** Abstract animation: one floating skeleton per compound, sized by relative share. Decorative. */
export function MoleculeField({ profile, muted = [] }: { profile: Profile; muted?: readonly AnalyteId[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const comp = relativeComposition(profile);
    const items = comp.covered.filter((id) => !muted.includes(id) && (comp.shares[id] ?? 0) > 0).map((id, k) => {
      const s = referenceCompound(id).structure2d;
      const heavy = s.atoms.map((a, i) => ({ ...a, i })).filter((a) => a.el !== 'H');
      const mx = heavy.reduce((t, a) => t + a.x, 0) / heavy.length, my = heavy.reduce((t, a) => t + a.y, 0) / heavy.length;
      return { id, share: comp.shares[id] ?? 0, s, heavy: new Set(heavy.map((a) => a.i)), mx, my, phase: k * 1.7, speed: 0.15 + (k % 5) * 0.04 };
    });
    let raf = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const t = reduced ? 0 : (now - start) / 1000;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(12, 14, 11, 1)';
      ctx.fillRect(0, 0, W, H);
      items.forEach((it, k) => {
        const n = items.length;
        const baseX = W * ((k + 0.5) / n);
        const x0 = baseX + Math.sin(t * it.speed + it.phase) * W * 0.06;
        const y0 = H / 2 + Math.cos(t * it.speed * 1.3 + it.phase) * H * 0.22;
        const sc = 9 + 30 * Math.sqrt(it.share);
        const rot = t * it.speed * 0.6 + it.phase;
        const cr = Math.cos(rot), sr = Math.sin(rot);
        ctx.strokeStyle = ANALYTE_COLOR[it.id];
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (const b of it.s.bonds) {
          if (!it.heavy.has(b.a) || !it.heavy.has(b.b)) continue;
          const A = it.s.atoms[b.a], B = it.s.atoms[b.b];
          const ax = (A.x - it.mx) * sc, ay = (A.y - it.my) * sc, bx = (B.x - it.mx) * sc, by = (B.y - it.my) * sc;
          ctx.moveTo(x0 + ax * cr - ay * sr, y0 - (ax * sr + ay * cr));
          ctx.lineTo(x0 + bx * cr - by * sr, y0 - (bx * sr + by * cr));
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [profile, muted, reduced]);
  return (
    <figure style={{ margin: 0 }}>
      <canvas ref={canvas} className="field-canvas" role="img" aria-label="Abstract animated visualisation of the compounds in this profile" />
      <figcaption className="tiny faint" style={{ marginTop: 4 }}>Abstract visualisation: each skeleton is a compound's real 2D structure, drawn larger for a larger relative share. Positions and motion are decorative and carry no data.</figcaption>
    </figure>
  );
}
