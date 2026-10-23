// Web MIDI controller support — a progressive enhancement. Browsers without
// Web MIDI (or users who decline) simply see the feature as unavailable.
// MIDI Learn: arm learning, click a knob, move a hardware control.

import { useSyncExternalStore } from 'react';

type Setter = (x01: number) => void;
export type MidiStatus = 'unsupported' | 'off' | 'requesting' | 'on' | 'denied';

interface LearnState { status: MidiStatus; armed: boolean; selected: string | null; devices: string[]; mappings: Record<string, string>; lastMessage: string | null }

const STORAGE = 'tls:midi-mappings';
const controls = new Map<string, { label: string; set: Setter }>();
const listeners = new Set<() => void>();
let state: LearnState = {
  status: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator ? 'off' : 'unsupported',
  armed: false, selected: null, devices: [], mappings: loadMappings(), lastMessage: null,
};

function loadMappings(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(STORAGE) ?? '{}'); } catch { return {}; }
}
function saveMappings() {
  try { localStorage.setItem(STORAGE, JSON.stringify(state.mappings)); } catch { /* ignore */ }
}
function set(p: Partial<LearnState>) { state = { ...state, ...p }; listeners.forEach((l) => l()); }

function onMessage(e: MIDIMessageEvent) {
  const d = e.data;
  if (!d || d.length < 3) return;
  const status = d[0] & 0xf0;
  if (status !== 0xb0) return; // control change only
  const key = `${(d[0] & 0x0f) + 1}:${d[1]}`;
  const value = d[2] / 127;
  if (state.armed && state.selected) {
    const mappings = { ...state.mappings };
    for (const k of Object.keys(mappings)) if (mappings[k] === state.selected) delete mappings[k];
    mappings[key] = state.selected;
    set({ mappings, selected: null, lastMessage: `CC ${d[1]} (ch ${key.split(':')[0]}) → ${controls.get(state.selected)?.label ?? state.selected}` });
    saveMappings();
    return;
  }
  const id = state.mappings[key];
  if (id) controls.get(id)?.set(value);
  set({ lastMessage: `CC ${d[1]} ch ${key.split(':')[0]} = ${d[2]}` });
}

export const midiLearn = {
  register(id: string, label: string, setter: Setter) {
    controls.set(id, { label, set: setter });
    return () => { if (controls.get(id)?.set === setter) controls.delete(id); };
  },
  async enable() {
    if (state.status === 'unsupported') return;
    set({ status: 'requesting' });
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      const bind = () => {
        const devices: string[] = [];
        access.inputs.forEach((input) => { input.onmidimessage = onMessage; devices.push(input.name ?? 'MIDI input'); });
        set({ devices });
      };
      access.onstatechange = bind;
      bind();
      set({ status: 'on' });
    } catch {
      set({ status: 'denied' });
    }
  },
  arm(on: boolean) { set({ armed: on, selected: null }); },
  armed: () => state.armed,
  select(id: string) { if (state.armed) set({ selected: id }); },
  clear() { set({ mappings: {} }); saveMappings(); },
  label: (id: string) => controls.get(id)?.label ?? id,
  subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); },
  get: () => state,
  useState(): LearnState { return useSyncExternalStore(midiLearn.subscribe, () => state, () => state); },
  useLearning(id?: string): boolean {
    return useSyncExternalStore(midiLearn.subscribe, () => !!id && state.armed && state.selected === id, () => false);
  },
};
