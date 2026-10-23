// Unit conversion. Only mass-fraction units convert into one another, and only
// when both values share the same basis. Relative units never convert to
// absolute ones — that would require the total, which a share does not carry.

import type { Unit } from './types';

/** Factor to multiply a value in `unit` by to get % w/w. */
const TO_PCT: Partial<Record<Unit, number>> = {
  pct_w_w: 1,
  mg_per_g: 0.1,      // 1 mg/g = 0.1 % w/w (1 g = 1000 mg; % = parts per hundred)
  ppm_w_w: 0.0001,    // 1 ppm (mass) = 0.0001 % w/w
};

export function canConvert(from: Unit, to: Unit): boolean {
  if (from === to) return true;
  return TO_PCT[from] != null && TO_PCT[to] != null;
}

/** Converts `value` or returns null when the conversion is not scientifically valid. */
export function convert(value: number, from: Unit, to: Unit): number | null {
  if (from === to) return value;
  const a = TO_PCT[from];
  const b = TO_PCT[to];
  if (a == null || b == null) return null;
  return (value * a) / b;
}

export function formatValue(value: number | null, unit: Unit, digits?: number): string {
  if (value == null) return '—';
  switch (unit) {
    case 'pct_w_w': return `${value.toFixed(digits ?? (value < 0.1 ? 3 : 2))} %`;
    case 'mg_per_g': return `${value.toFixed(digits ?? 2)} mg/g`;
    case 'ppm_w_w': return `${Math.round(value)} ppm`;
    case 'relative_pct': return `${value.toFixed(digits ?? 1)} %`;
    case 'relative_weight': return value.toFixed(digits ?? 0);
  }
}
