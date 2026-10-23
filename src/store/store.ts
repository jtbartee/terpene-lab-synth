// Application state: a small external store read with useSyncExternalStore.
// Scientific data (src/chem), music (src/music) and audio (src/audio) never
// import from here; this layer only wires them to the UI.

import { useSyncExternalStore } from 'react';
import { DEFAULT_VISIBLE } from '../chem/analytes';
import { DEMO_A, DEMO_B } from '../chem/demo';
import type { AnalyteId, Profile } from '../chem/types';
import { DEFAULT_MIXER, type MixerState } from '../audio/params';
import type { BarPlan, CompositionSettings } from '../music/composer';
import { DEFAULT_SETTINGS } from '../music/composer';
import { BUILT_IN_PRESETS, type MappingPreset, type SonificationMode } from '../sonify/mapping';

export type Route = 'explore' | 'lab' | 'synth' | 'compare' | 'library' | 'about';
export const ROUTES: { id: Route; label: string }[] = [
  { id: 'explore', label: 'Explore' },
  { id: 'lab', label: 'Terpene Lab' },
  { id: 'synth', label: 'Terpene Synth' },
  { id: 'compare', label: 'Compare' },
  { id: 'library', label: 'Library' },
  { id: 'about', label: 'About / Research' },
];

export type PlayState = 'stopped' | 'playing' | 'paused';

export interface SynthPreset {
  schema: 'terpene-lab-synth/preset@1';
  id: string;
  name: string;
  createdAt: string;
  profileA: Profile | null;
  profileB: Profile | null;
  morph: number;
  morphEnabled: boolean;
  mode: SonificationMode;
  settings: CompositionSettings;
  mapping: MappingPreset;
  mixer: MixerState;
  favorite?: boolean;
}

export interface LabState {
  profile: Profile;
  /** the profile as first loaded, for Reset */
  original: Profile;
  visible: AnalyteId[];
  muted: AnalyteId[];
  locked: AnalyteId[];
  view: 'measured' | 'relative';
  notice: string | null;
  savedId: string | null;
}

export interface SynthState {
  profileA: Profile | null;
  /** analytes muted in the Lab, excluded from slot A's mapping */
  mutedA: AnalyteId[];
  /** slot A tracks the Lab profile live */
  followLab: boolean;
  profileB: Profile | null;
  morph: number;
  morphEnabled: boolean;
  mode: SonificationMode;
  settings: CompositionSettings;
  seedLocked: boolean;
  mapping: MappingPreset;
  mixer: MixerState;
}

export interface TransportState {
  state: PlayState;
  bar: BarPlan | null;
  history: BarPlan[];
  audioReady: boolean;
  error: string | null;
  busy: string | null;
}

export interface AppState {
  route: Route;
  library: Profile[];
  presets: SynthPreset[];
  mappings: MappingPreset[];
  recent: Profile[];
  lab: LabState;
  synth: SynthState;
  compare: { a: Profile | null; b: Profile | null };
  transport: TransportState;
  infoAnalyte: AnalyteId | null;
  toast: { text: string; id: number } | null;
  loaded: boolean;
}

function routeFromHash(): Route {
  const h = (typeof location !== 'undefined' ? location.hash : '').replace(/^#\/?/, '').split('?')[0];
  return (ROUTES.find((r) => r.id === h)?.id ?? 'lab') as Route;
}

const initial: AppState = {
  route: routeFromHash(),
  library: [],
  presets: [],
  mappings: [],
  recent: [],
  lab: { profile: DEMO_A, original: DEMO_A, visible: [...DEFAULT_VISIBLE], muted: [], locked: [], view: 'measured', notice: null, savedId: null },
  synth: {
    profileA: DEMO_A, mutedA: [], followLab: true, profileB: DEMO_B, morph: 0, morphEnabled: false, mode: 'generative',
    settings: { ...DEFAULT_SETTINGS }, seedLocked: true, mapping: BUILT_IN_PRESETS[0], mixer: DEFAULT_MIXER,
  },
  compare: { a: DEMO_A, b: DEMO_B },
  transport: { state: 'stopped', bar: null, history: [], audioReady: false, error: null, busy: null },
  infoAnalyte: null,
  toast: null,
  loaded: false,
};

let state: AppState = initial;
const listeners = new Set<() => void>();

export function getState(): AppState { return state; }

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(initial));
}

/** Subscribes to a derived slice; calls `fn` when it changes (by reference). */
export function watch<T>(selector: (s: AppState) => T, fn: (v: T, prev: T) => void) {
  let prev = selector(state);
  return subscribe(() => {
    const v = selector(state);
    if (v !== prev) { const p = prev; prev = v; fn(v, p); }
  });
}

// ------------------------------------------------------------ small actions

let toastId = 0;
export function toast(text: string) {
  const id = ++toastId;
  setState({ toast: { text, id } });
  setTimeout(() => { if (state.toast?.id === id) setState({ toast: null }); }, 4200);
}

export function navigate(route: Route) {
  if (typeof location !== 'undefined' && location.hash !== `#/${route}`) location.hash = `#/${route}`;
  setState({ route });
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => setState({ route: routeFromHash() }));
}

export function setLab(patch: Partial<LabState>) {
  setState((s) => ({ lab: { ...s.lab, ...patch } }));
}
export function setSynth(patch: Partial<SynthState>) {
  setState((s) => ({ synth: { ...s.synth, ...patch } }));
}
export function setSettings(patch: Partial<CompositionSettings>) {
  setState((s) => ({ synth: { ...s.synth, settings: { ...s.synth.settings, ...patch } } }));
}
export function setMixer(patch: Partial<MixerState>) {
  setState((s) => ({ synth: { ...s.synth, mixer: { ...s.synth.mixer, ...patch } } }));
}
export function setTransport(patch: Partial<TransportState>) {
  setState((s) => ({ transport: { ...s.transport, ...patch } }));
}

export function rememberRecent(p: Profile) {
  setState((s) => ({ recent: [p, ...s.recent.filter((x) => x.id !== p.id)].slice(0, 20) }));
}
