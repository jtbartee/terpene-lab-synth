// Structural and rhythmic analysis of generated bars. Used by the diversity
// tests (tests/music/diversity.test.ts) and the diversity report
// (docs/DIVERSITY_REPORT.md). Every rhythm metric works on onset positions
// only, so two pieces that share a rhythm but differ in pitch or timbre score
// as rhythmically identical. Metric definitions are in docs/TESTING.md.

export interface EventLike { voice: string; beat: number; dur: number; notes: number[] }
export interface BarLike { index: number; beats: number; events: EventLike[]; section?: { name: string; role?: string; bar?: number } }

export const DRUM_GROUP = ['kick', 'snare', 'clap', 'hatC', 'hatO'];

/** The sixteenth-note step of a beat position, tolerant of swing (≤ 0.1 beat) and micro-timing. */
export const stepOf = (beat: number) => Math.floor(beat * 4 + 0.4);

/** A bar's onset pattern for a set of voices: one bit string per voice, "" when none of them play. */
export function barPattern(bar: BarLike, voices: string[]): string {
  const n = bar.beats * 4;
  const rows = voices.map((v) => {
    const bits = new Array(n).fill('.');
    for (const e of bar.events) if (e.voice === v) { const s = stepOf(e.beat); if (s >= 0 && s < n) bits[s] = 'x'; }
    return bits.join('');
  });
  return rows.every((r) => !r.includes('x')) ? '' : rows.join('|');
}

/** The set of distinct non-empty bar patterns (the piece's rhythmic vocabulary). */
export function vocabulary(bars: BarLike[], voices: string[]): Set<string> {
  const out = new Set<string>();
  for (const b of bars) { const p = barPattern(b, voices); if (p) out.add(p); }
  return out;
}

export function jaccardDistance<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return 1 - inter / (a.size + b.size - inter);
}

/**
 * Positional onset histogram: for each voice and step, the fraction of bars
 * (among bars where the group plays) with an onset there.
 */
export function onsetHistogram(bars: BarLike[], voices: string[]): number[] {
  const active = bars.filter((b) => b.events.some((e) => voices.includes(e.voice)));
  if (!active.length) return [];
  const n = active[0].beats * 4;
  const h = new Array(voices.length * n).fill(0);
  for (const b of active) {
    const seen = new Set<number>();
    for (const e of b.events) {
      const vi = voices.indexOf(e.voice);
      if (vi < 0) continue;
      const s = stepOf(e.beat);
      if (s >= 0 && s < n) seen.add(vi * n + s);
    }
    for (const k of seen) h[k]++;
  }
  return h.map((x) => x / active.length);
}

/** Bray–Curtis dissimilarity of two non-negative vectors: 0 identical, 1 nothing in common. */
export function brayCurtis(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) { const x = a[i] ?? 0; const y = b[i] ?? 0; num += Math.abs(x - y); den += x + y; }
  return den ? num / den : 0;
}

/** Histogram of note durations (in sixteenths, capped at 32) for a voice. */
export function durationHistogram(bars: BarLike[], voice: string): number[] {
  const h = new Array(33).fill(0);
  let n = 0;
  for (const b of bars) for (const e of b.events) if (e.voice === voice) { h[Math.min(32, Math.max(0, Math.round(e.dur * 4)))]++; n++; }
  return n ? h.map((x) => x / n) : h;
}

/**
 * Melodic contour as a distribution of interval trigrams. Each interval
 * between consecutive notes of a voice becomes a token (direction × size
 * class: repeat, step ≤ 2, skip ≤ 5, leap); the trigram counts are normalised.
 */
export function contourProfile(bars: BarLike[], voice: string): Map<string, number> {
  const notes: number[] = [];
  for (const b of bars) for (const e of [...b.events].sort((x, y) => x.beat - y.beat)) if (e.voice === voice && e.notes.length) notes.push(e.notes[0]);
  const tok = (d: number) => (d === 0 ? '0' : `${d > 0 ? '+' : '-'}${Math.abs(d) <= 2 ? 's' : Math.abs(d) <= 5 ? 'k' : 'l'}`);
  const toks = notes.slice(1).map((x, i) => tok(x - notes[i]));
  const out = new Map<string, number>();
  for (let i = 0; i + 2 < toks.length; i++) { const k = toks.slice(i, i + 3).join(''); out.set(k, (out.get(k) ?? 0) + 1); }
  const total = [...out.values()].reduce((s, x) => s + x, 0) || 1;
  for (const [k, v] of out) out.set(k, v / total);
  return out;
}

export function mapBrayCurtis(a: Map<string, number>, b: Map<string, number>): number {
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  return brayCurtis(keys.map((k) => a.get(k) ?? 0), keys.map((k) => b.get(k) ?? 0));
}

/** The order of sections, one entry per section. */
export function sectionSequence(bars: BarLike[]): string[] {
  const out: string[] = [];
  for (const b of bars) {
    const name = b.section?.role ? `${b.section.role}` : b.section?.name ?? '';
    if (b.section?.bar === 0 || !out.length) out.push(name);
  }
  return out;
}

/** Normalised Levenshtein distance between two sequences (0 identical, 1 completely different). */
export function editDistance(a: string[], b: string[]): number {
  const m = a.length, n = b.length;
  if (!m && !n) return 0;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n] / Math.max(m, n);
}

/** Mean of a metric over all unordered pairs. */
export function meanPairwise<T>(xs: T[], f: (a: T, b: T) => number): number {
  let s = 0, k = 0;
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) { s += f(xs[i], xs[j]); k++; }
  return k ? s / k : 0;
}

/** Fraction of bars whose pattern for `voices` matches one of the bars in `ref`. */
export function patternReuse(bars: BarLike[], ref: BarLike[], voices: string[]): number {
  const refSet = vocabulary(ref, voices);
  const ps = bars.map((b) => barPattern(b, voices)).filter(Boolean);
  return ps.length ? ps.filter((p) => refSet.has(p)).length / ps.length : 0;
}

/**
 * The bars that carry a piece's identity: its first main section. A piece
 * without section roles (the v0.1 engine) uses bars 16–47, its core after the
 * intro build.
 */
export function identityBars<T extends BarLike>(bars: T[]): T[] {
  const main = bars.filter((b) => b.section?.role === 'main' && (b.section as { cycle?: number }).cycle === 0);
  return main.length ? main : bars.slice(16, 48);
}
