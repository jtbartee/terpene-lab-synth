// User actions: library persistence, moving profiles between views, presets,
// and the audio bridge (lazy-loaded player kept in sync with the store).

import { ANALYTE_IDS } from '../chem/analytes';
import { DEMO_A, DEMO_PROFILES } from '../chem/demo';
import { deriveHypothetical, duplicateProfile, newId, nowIso, relativeComposition } from '../chem/profile';
import { buildLibraryFile, parseLibraryFile, validateProfile } from '../chem/schema';
import type { AnalyteId, Profile } from '../chem/types';
import { DEFAULT_SETTINGS, ENGINE_VERSION, type CompositionSettings } from '../music/composer';
import { DEMO_SETTINGS, type ListeningDemo } from '../music/demos';
import { hash, randomSeed } from '../music/rng';
import { STYLES, type StyleId } from '../music/styles';
import { BUILT_IN_PRESETS, computeControls, lerpParams, type MappingPreset } from '../sonify/mapping';
import type { ParamSet } from '../sonify/targets';
import { del, get, getAll, put } from './persistence';
import {
  getState, rememberRecent, setLab, setSettings, setState, setSynth, setTransport, toast, watch,
  type AppState, type SynthPreset,
} from './store';
import type { LivePlayer } from '../audio/player';

// ------------------------------------------------------------- start-up

export async function loadPersisted() {
  try {
    const [profiles, presets, mappings] = await Promise.all([
      getAll<Profile>('profiles'), getAll<SynthPreset>('presets'), getAll<MappingPreset>('mappings'),
    ]);
    const valid = profiles.map((p) => validateProfile(p)).filter((v): v is { ok: true; profile: Profile } => v.ok).map((v) => v.profile);
    const synthSaved = await get<Partial<AppState['synth']>>('kv', 'synth');
    const labSaved = await get<Partial<AppState['lab']>>('kv', 'lab');
    setState((s) => ({
      library: valid.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
      presets: presets.filter((p) => p?.schema === 'terpene-lab-synth/preset@1'),
      mappings: mappings.filter((m) => m && Array.isArray(m.routes)),
      synth: synthSaved?.settings ? { ...s.synth, settings: { ...s.synth.settings, ...synthSaved.settings }, mixer: synthSaved.mixer ?? s.synth.mixer, mode: synthSaved.mode ?? s.synth.mode } : s.synth,
      lab: labSaved?.visible ? { ...s.lab, visible: labSaved.visible.filter((a) => ANALYTE_IDS.includes(a)) } : s.lab,
      loaded: true,
    }));
  } catch {
    setState({ loaded: true });
  }
  // remember a few preferences between visits
  let t: ReturnType<typeof setTimeout> | undefined;
  const save = () => { clearTimeout(t); t = setTimeout(() => {
    const s = getState();
    void put('kv', 'synth', { settings: s.synth.settings, mixer: s.synth.mixer, mode: s.synth.mode });
    void put('kv', 'lab', { visible: s.lab.visible });
  }, 600); };
  watch((s) => s.synth.settings, save);
  watch((s) => s.synth.mixer, save);
  watch((s) => s.lab.visible, save);
}

// ------------------------------------------------------------- profiles

export function openInLab(p: Profile) {
  if (p.kind !== 'hypothetical' && p.kind !== 'demo') rememberRecent(p);
  setLab({ profile: p, original: p, muted: [], locked: [], notice: null, savedId: getState().library.some((x) => x.id === p.id) ? p.id : null });
}

/** Lab edits: the first edit of non-hypothetical data creates a derived copy. */
export function editLabProfile(update: (p: Profile) => Profile) {
  const { lab } = getState();
  let base = lab.profile;
  let notice = lab.notice;
  let savedId = lab.savedId;
  if (base.kind !== 'hypothetical') {
    base = deriveHypothetical(base);
    notice = `You edited "${lab.profile.name}". A hypothetical copy was created; the original ${lab.profile.kind === 'demo' ? 'demo' : 'data'} is unchanged.`;
    savedId = null;
  }
  setLab({ profile: update(base), notice, savedId });
}

export async function saveProfile(p: Profile, name?: string): Promise<Profile> {
  const toSave: Profile = p.kind === 'hypothetical'
    ? { ...p, name: name ?? p.name, updatedAt: nowIso(), createdAt: p.createdAt ?? nowIso() }
    : { ...duplicateProfile(p), name: name ?? p.name, kind: p.kind, provenance: p.provenance, id: p.id, updatedAt: nowIso(), createdAt: nowIso() };
  const v = validateProfile(toSave);
  if (!v.ok) { toast(`Could not save: ${v.error}`); throw new Error(v.error); }
  await put('profiles', toSave.id, toSave);
  setState((s) => ({ library: [toSave, ...s.library.filter((x) => x.id !== toSave.id)] }));
  if (getState().lab.profile.id === toSave.id || getState().lab.profile.id === p.id) setLab({ profile: toSave, savedId: toSave.id });
  toast(`Saved "${toSave.name}" to your library (this device only).`);
  return toSave;
}

export async function updateLibraryProfile(p: Profile) {
  const v = validateProfile(p);
  if (!v.ok) { toast(`Could not save: ${v.error}`); return; }
  await put('profiles', p.id, p);
  setState((s) => ({ library: s.library.map((x) => (x.id === p.id ? p : x)) }));
}

export async function deleteLibraryProfile(id: string) {
  await del('profiles', id);
  setState((s) => ({ library: s.library.filter((x) => x.id !== id) }));
  if (getState().lab.savedId === id) setLab({ savedId: null });
}

export async function duplicateLibraryProfile(p: Profile) {
  const copy = duplicateProfile(p);
  await put('profiles', copy.id, copy);
  setState((s) => ({ library: [copy, ...s.library] }));
  toast(`Duplicated as "${copy.name}".`);
}

export function exportLibrary(ids?: string[]): string {
  const s = getState();
  const profiles = ids ? s.library.filter((p) => ids.includes(p.id)) : s.library;
  return buildLibraryFile(profiles, s.presets, s.mappings);
}

export async function importLibrary(text: string): Promise<{ added: number; errors: string[] }> {
  const r = parseLibraryFile(text);
  for (const p of r.profiles) {
    const existing = getState().library.find((x) => x.id === p.id);
    const final = existing ? { ...p, id: newId('imp') } : p;
    await put('profiles', final.id, final);
    setState((s) => ({ library: [final, ...s.library] }));
  }
  let presets = 0;
  for (const raw of r.presets) {
    const pr = raw as SynthPreset;
    if (pr?.schema !== 'terpene-lab-synth/preset@1' || !pr.settings || !pr.mapping) { r.errors.push('A composition preset was skipped (unrecognised format).'); continue; }
    if (pr.profileA && !validateProfile(pr.profileA).ok) { r.errors.push(`Preset "${pr.name}" skipped: invalid profile A.`); continue; }
    const final = { ...pr, id: getState().presets.some((x) => x.id === pr.id) ? newId('pre') : pr.id };
    await put('presets', final.id, final);
    setState((s) => ({ presets: [final, ...s.presets] }));
    presets++;
  }
  return { added: r.profiles.length + presets, errors: r.errors };
}

// ------------------------------------------------------------- synth wiring

export function sendToSynth(p: Profile, slot: 'A' | 'B' = 'A', muted: AnalyteId[] = []) {
  if (p.kind === 'lab_sample' || p.kind === 'cultivar_aggregate') rememberRecent(p);
  if (slot === 'A') setSynth({ profileA: p, mutedA: muted, followLab: getState().lab.profile.id === p.id });
  else setSynth({ profileB: p, morphEnabled: true });
}

export function sendBothToSynth(a: Profile, b: Profile) {
  setSynth({ profileA: a, profileB: b, morphEnabled: true, morph: 0, mutedA: [], followLab: false });
}

// Lab → Synth live link: while slot A follows the Lab, every edit is heard at once.
watch((s) => s.lab, (lab) => {
  const s = getState().synth;
  if (!s.followLab) return;
  if (s.profileA !== lab.profile || s.mutedA !== lab.muted) setSynth({ profileA: lab.profile, mutedA: lab.muted });
});

const paramCache = new WeakMap<object, unknown>();
export function currentParams(s: AppState['synth']): ParamSet {
  const key = s as object;
  const hit = paramCache.get(key) as ParamSet | undefined;
  if (hit) return hit;
  const a = computeControls(s.profileA, s.mapping, s.mode, new Set(s.mutedA)).params;
  let out = a;
  if (s.morphEnabled && s.profileB) {
    const b = computeControls(s.profileB, s.mapping, s.mode).params;
    out = lerpParams(a, b, s.morph);
  }
  paramCache.set(key, out);
  return out;
}

/**
 * Generative mode: profile A's composition picks its own piece (harmony, motifs,
 * grooves) from the seed, so different profiles are different music, not one
 * piece re-voiced. Shares are taken in 5 % steps so a small nudge in the Lab
 * does not reshuffle everything. Analytical mode returns 0: one reference piece.
 */
export function profileVariant(s: AppState['synth']): number {
  const p = s.profileA;
  if (s.mode !== 'generative' || !p) return 0;
  const muted = new Set(s.mutedA);
  const comp = relativeComposition(p, ANALYTE_IDS.filter((id) => !muted.has(id)));
  if (comp.total > 0) return hash(...ANALYTE_IDS.map((id) => (comp.covered.includes(id) ? Math.round((comp.shares[id] ?? 0) * 20) : '-'))) || 1;
  if (p.ranking?.length) return hash('ranking', ...p.ranking.filter((id) => !muted.has(id))) || 1;
  return 0;
}

let composerCache: { settings: CompositionSettings; variant: number; out: CompositionSettings } | null = null;
/** The settings the Composer runs on: the user's settings plus the profile variant. */
export function composerSettings(s: AppState['synth']): CompositionSettings {
  const variant = profileVariant(s);
  if (composerCache && composerCache.settings === s.settings && composerCache.variant === variant) return composerCache.out;
  composerCache = { settings: s.settings, variant, out: { ...s.settings, variant } };
  return composerCache.out;
}

export function applyStyle(style: StyleId) {
  const st = STYLES[style];
  setSettings({ style, bpm: st.bpm, scale: st.scale, swing: st.swing });
}

export function newSeed() {
  setSettings({ seed: randomSeed() });
}

let player: LivePlayer | null = null;
let playerLoading: Promise<LivePlayer> | null = null;

async function getPlayer(): Promise<LivePlayer> {
  if (player) return player;
  playerLoading ??= import('../audio/player').then(({ LivePlayer }) => {
    const s = getState().synth;
    const p = new LivePlayer(composerSettings(s), currentParams(s), s.mixer);
    p.subscribe({
      onBar: (plan) => setState((st) => ({ transport: { ...st.transport, bar: plan, history: [...st.transport.history, plan].slice(-64) } })),
      onState: (state) => setTransport({ state }),
      onError: (error) => setTransport({ error }),
    });
    watch((st) => composerSettings(st.synth), (v) => p.setSettings(v));
    watch((st) => st.synth.mixer, (v) => p.setMixer(v));
    watch((st) => st.synth, (v) => p.setParams(currentParams(v)));
    player = p;
    return p;
  });
  return playerLoading;
}

export function getLivePlayer() { return player; }

export async function play() {
  setTransport({ busy: 'Starting audio…', error: null });
  try {
    const p = await getPlayer();
    await p.play();
    setTransport({ audioReady: true, busy: null });
  } catch (e) {
    setTransport({ busy: null, error: `Audio could not start: ${(e as Error).message}` });
  }
}

export function pause() { player?.pause(); }

export function stop() {
  player?.stop();
  setTransport({ bar: null, history: [] });
}

/** Loads a listening demo (Profile A, Generative mode, default mapping, its seed) and plays it from the top. */
export async function auditionDemo(d: ListeningDemo) {
  stop();
  setSynth({
    profileA: DEMO_A, mutedA: [], followLab: false, morphEnabled: false, mode: 'generative', mapping: BUILT_IN_PRESETS[0], seedLocked: true,
    settings: { ...DEFAULT_SETTINGS, ...DEMO_SETTINGS, seed: d.seed },
  });
  await play();
}

export async function regenerate() {
  const s = getState().synth;
  if (!s.seedLocked) setSettings({ seed: randomSeed() });
  setTransport({ history: [], bar: null });
  if (player) await player.regenerate(composerSettings(getState().synth));
}

// ------------------------------------------------------------- presets

export function currentPreset(name: string): SynthPreset {
  const s = getState().synth;
  return {
    schema: 'terpene-lab-synth/preset@1', id: newId('pre'), name, createdAt: nowIso(),
    profileA: s.profileA, profileB: s.profileB, morph: s.morph, morphEnabled: s.morphEnabled, mode: s.mode,
    settings: s.settings, mapping: s.mapping, mixer: s.mixer, engine: ENGINE_VERSION,
  };
}

export async function savePreset(name: string) {
  const pr = currentPreset(name);
  await put('presets', pr.id, pr);
  setState((s) => ({ presets: [pr, ...s.presets] }));
  toast(`Saved composition "${name}".`);
}

export function loadPreset(pr: SynthPreset) {
  setSynth({
    profileA: pr.profileA, profileB: pr.profileB, morph: pr.morph, morphEnabled: pr.morphEnabled, mode: pr.mode,
    // presets saved before engine 2 lack the newer controls: they take the defaults
    settings: { ...DEFAULT_SETTINGS, ...pr.settings } as CompositionSettings, mapping: pr.mapping, mixer: pr.mixer, seedLocked: true, followLab: false, mutedA: [],
  });
  toast((pr.engine ?? 1) < ENGINE_VERSION
    ? `Loaded "${pr.name}". It was saved with composition engine ${pr.engine ?? 1}; engine ${ENGINE_VERSION} composes a different piece from the same settings.`
    : `Loaded "${pr.name}". Press Play to hear it.`);
}

export async function deletePreset(id: string) {
  await del('presets', id);
  setState((s) => ({ presets: s.presets.filter((p) => p.id !== id) }));
}

export async function saveMapping(name: string) {
  const m: MappingPreset = { ...getState().synth.mapping, id: newId('map'), name, builtIn: false };
  await put('mappings', m.id, m);
  setState((s) => ({ mappings: [m, ...s.mappings] }));
  setSynth({ mapping: m });
  toast(`Saved mapping "${name}".`);
}

export async function deleteMapping(id: string) {
  await del('mappings', id);
  setState((s) => ({ mappings: s.mappings.filter((m) => m.id !== id) }));
  if (getState().synth.mapping.id === id) setSynth({ mapping: BUILT_IN_PRESETS[0] });
}

export function allProfiles(s: AppState): Profile[] {
  const seen = new Set<string>();
  const out: Profile[] = [];
  for (const p of [s.lab.profile, ...DEMO_PROFILES, ...s.library, ...s.recent]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

// ------------------------------------------------------------- downloads

export function download(name: string, data: Uint8Array | string, type: string) {
  const blob = new Blob([typeof data === 'string' ? data : (data as BlobPart)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'profile';
}
