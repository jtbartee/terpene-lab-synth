// Rotary knob: vertical drag, wheel, keyboard (arrows, PageUp/Down, Home/End),
// double-click to reset. Exposed to assistive tech as a slider.

import { useEffect, useId, useRef } from 'react';
import { midiLearn } from '../midiLearn';

export interface KnobProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  format?: (v: number) => string;
  size?: number;
  color?: string;
  /** stable id for MIDI learn */
  controlId?: string;
  title?: string;
  disabled?: boolean;
}

export function Knob({ label, value, onChange, min = 0, max = 1, step, defaultValue, format, size = 50, color = 'var(--amber)', controlId, title, disabled }: KnobProps) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ y: number; v: number } | null>(null);
  const id = useId();
  const range = max - min;
  const st = step ?? range / 100;
  const t = Math.max(0, Math.min(1, (value - min) / range));
  const set = (v: number) => onChange(Math.max(min, Math.min(max, Math.round(v / st) * st)));
  const shown = format ? format(value) : `${Math.round(t * 100)}`;
  const learning = midiLearn.useLearning(controlId);

  useEffect(() => {
    if (!controlId) return;
    return midiLearn.register(controlId, label, (x) => set(min + x * range));
  });

  // angles: −135° … +135°
  const a0 = -135, a1 = 135;
  const ang = a0 + (a1 - a0) * t;
  const r = size / 2 - 5;
  const c = size / 2;
  const pt = (deg: number, rad = r) => [c + rad * Math.sin((deg * Math.PI) / 180), c - rad * Math.cos((deg * Math.PI) / 180)];
  const arc = (from: number, to: number) => {
    const [x0, y0] = pt(from);
    const [x1, y1] = pt(to);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const [px, py] = pt(ang, r - 9);

  return (
    <div className={`knob${learning ? ' learning' : ''}`} title={title}>
      <svg
        ref={ref}
        className="knob-dial"
        width={size}
        height={size}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-labelledby={undefined}
        aria-describedby={`${id}-v`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(4))}
        aria-valuetext={shown}
        aria-disabled={disabled || undefined}
        data-control-id={controlId}
        onPointerDown={(e) => {
          if (disabled) return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drag.current = { y: e.clientY, v: value };
          if (controlId && midiLearn.armed()) midiLearn.select(controlId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dy = drag.current.y - e.clientY;
          const fine = e.shiftKey ? 0.25 : 1;
          set(drag.current.v + (dy / 160) * range * fine);
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={() => defaultValue != null && set(defaultValue)}
        onWheel={(e) => {
          if (disabled || document.activeElement !== ref.current) return;
          e.preventDefault();
          set(value - Math.sign(e.deltaY) * st * (e.shiftKey ? 1 : 3));
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          const big = range / 10;
          let v: number | null = null;
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') v = value + st;
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') v = value - st;
          else if (e.key === 'PageUp') v = value + big;
          else if (e.key === 'PageDown') v = value - big;
          else if (e.key === 'Home') v = min;
          else if (e.key === 'End') v = max;
          if (v != null) { e.preventDefault(); set(v); }
        }}
        style={{ opacity: disabled ? 0.4 : 1 }}
      >
        <circle cx={c} cy={c} r={r - 3} fill="url(#knobGrad)" stroke="#0b0d0a" strokeWidth="1" />
        <path d={arc(a0, a1)} stroke="#2c3128" strokeWidth="4" fill="none" strokeLinecap="round" />
        {t > 0.005 && <path d={arc(a0, ang)} stroke={color} strokeWidth="4" fill="none" strokeLinecap="round" />}
        <circle className="knob-ring" cx={c} cy={c} r={r - 3} fill="none" stroke="transparent" strokeWidth="2" />
        <line x1={c} y1={c} x2={px} y2={py} stroke="#efe9d2" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span className="readout" id={`${id}-v`} aria-hidden="true">{shown}</span>
      <span className="label">{label}</span>
    </div>
  );
}

/** Shared SVG gradient definitions (rendered once in the app shell). */
export function KnobDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="knobGrad" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#4a5144" />
          <stop offset="70%" stopColor="#262a23" />
          <stop offset="100%" stopColor="#1a1d18" />
        </radialGradient>
      </defs>
    </svg>
  );
}
