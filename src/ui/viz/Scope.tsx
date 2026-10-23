// Oscilloscope and spectrum views of the master output. Drawing is throttled
// to ~30 fps and skipped in hidden tabs so visuals never compete with audio.

import { useEffect, useRef } from 'react';
import { getLivePlayer } from '../../store/actions';

export function Scope({ kind, className = 'scope', label }: { kind: 'wave' | 'fft'; className?: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 33 || document.hidden) return;
      last = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // graticule
      ctx.strokeStyle = 'rgba(159, 229, 126, 0.08)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, (H * i) / 4); ctx.lineTo(W, (H * i) / 4); ctx.stroke(); }
      for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo((W * i) / 8, 0); ctx.lineTo((W * i) / 8, H); ctx.stroke(); }
      const a = getLivePlayer()?.analysers();
      const node = kind === 'wave' ? a?.waveform : a?.fft;
      ctx.strokeStyle = '#9fe57e';
      ctx.shadowColor = 'rgba(159, 229, 126, 0.6)';
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (!node) {
        ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
      } else if (kind === 'wave') {
        const v = node.getValue() as Float32Array;
        for (let i = 0; i < v.length; i++) {
          const x = (i / (v.length - 1)) * W;
          const y = H / 2 - v[i] * (H / 2) * 0.95;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      } else {
        const v = node.getValue() as Float32Array;
        const n = v.length;
        // log-frequency x axis
        for (let i = 1; i < n; i++) {
          const x = (Math.log(i) / Math.log(n)) * W;
          const db = Math.max(-100, Math.min(0, v[i]));
          const y = H - ((db + 100) / 100) * H;
          if (i === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [kind]);
  return <canvas ref={ref} className={className} role="img" aria-label={label} />;
}
