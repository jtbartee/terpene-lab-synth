// Standard MIDI File export from the same BarPlans the audio engine plays.
// One track per instrument; drums on channel 10 with General MIDI note numbers.

import { Midi } from '@tonejs/midi';
import type { BarPlan, CompositionSettings, Voice } from '../music/composer';
import { STYLES } from '../music/styles';
import { SCALES } from '../music/theory';

const GM_DRUM: Partial<Record<Voice, number>> = { kick: 36, snare: 38, clap: 39, hatC: 42, hatO: 46, click: 75 };

const TRACKS: { name: string; channel: number; voices: Voice[]; program?: number }[] = [
  { name: 'Drone', channel: 0, voices: ['drone'], program: 89 },     // GM Pad 2 (warm)
  { name: 'Bass', channel: 1, voices: ['bass'], program: 38 },       // Synth Bass 1
  { name: 'Arpeggiator', channel: 2, voices: ['arp'], program: 81 }, // Lead 2 (sawtooth)
  { name: 'Pads & chords', channel: 3, voices: ['pad'], program: 88 },
  { name: 'Tuned percussion', channel: 4, voices: ['perc'], program: 115 },
  { name: 'Texture (tonal)', channel: 5, voices: ['metal', 'shimmer'], program: 98 },
  { name: 'Drums', channel: 9, voices: ['kick', 'snare', 'clap', 'hatC', 'hatO', 'click'] },
];

/** Major/minor key signature that best represents a mode (true mode kept in the track text). */
function keySignatureScale(scale: string): 'major' | 'minor' {
  return ['major', 'mixolydian', 'major_pentatonic', 'whole_tone'].includes(scale) ? 'major' : 'minor';
}

export function buildMidi(bars: BarPlan[], s: CompositionSettings): Midi {
  const midi = new Midi();
  const ppq = midi.header.ppq;
  midi.header.name = `TERPENE SYNTH — ${STYLES[s.style].label}`;
  midi.header.setTempo(s.bpm);
  // a slowing ending becomes tempo changes, one per beat
  for (const bar of bars) {
    if (bar.bpmEnd == null) continue;
    for (let i = 0; i < bar.beats; i++) {
      const bpm = bar.bpm + (bar.bpmEnd - bar.bpm) * ((i + 0.5) / bar.beats);
      midi.header.tempos.push({ ticks: (bar.index * s.beatsPerBar + i) * ppq, bpm: Math.round(bpm * 100) / 100 });
    }
  }
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [s.beatsPerBar, 4], measures: 0 });
  midi.header.keySignatures.push({ ticks: 0, key: s.key, scale: keySignatureScale(s.scale) });
  midi.header.update();
  const scaleLabel = SCALES.find((x) => x.id === s.scale)?.label ?? s.scale;

  for (const def of TRACKS) {
    const track = midi.addTrack();
    track.name = `${def.name} (${s.key} ${scaleLabel})`;
    track.channel = def.channel;
    if (def.program != null) track.instrument.number = def.program;
    for (const bar of bars) {
      const barTick = bar.index * s.beatsPerBar * ppq;
      // a fade-out ending becomes channel volume (CC 7), one step per beat
      if (bar.fade) for (let i = 0; i < bar.beats; i++) track.addCC({ number: 7, ticks: barTick + i * ppq, value: bar.fade[0] + (bar.fade[1] - bar.fade[0]) * (i / bar.beats) });
      for (const e of bar.events) {
        if (!def.voices.includes(e.voice)) continue;
        const ticks = Math.max(0, Math.round(barTick + e.beat * ppq));
        const durationTicks = Math.max(1, Math.round(e.dur * ppq));
        const velocity = Math.max(0.05, Math.min(1, e.vel));
        if (def.channel === 9) {
          const n = GM_DRUM[e.voice];
          if (n != null) track.addNote({ midi: n, ticks, durationTicks: Math.max(1, Math.round(0.1 * ppq)), velocity });
        } else {
          for (const n of e.notes) track.addNote({ midi: n, ticks, durationTicks, velocity });
        }
      }
    }
  }
  midi.tracks = midi.tracks.filter((t) => t.notes.length > 0);
  return midi;
}

// Sharps (+) / flats (−) of each major key by tonic pitch class (circle of fifths).
const MAJOR_SF = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

/** Spec-correct key signature (sf, mi). Minor keys use their relative major's accidentals. */
export function keySignatureBytes(key: string, scale: string): { sf: number; mi: 0 | 1 } {
  const pc = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].indexOf(key);
  const minor = keySignatureScale(scale) === 'minor';
  return { sf: MAJOR_SF[minor ? (pc + 3) % 12 : pc], mi: minor ? 1 : 0 };
}

/**
 * @tonejs/midi 2.0.28 writes the key-signature meta event incorrectly (it stores the
 * key's list index + 7 and treats every key name as major), so the bytes of the
 * FF 59 02 sf mi event are patched here with spec-correct values.
 */
export function midiBytes(bars: BarPlan[], s: CompositionSettings): Uint8Array {
  const bytes = buildMidi(bars, s).toArray();
  const { sf, mi } = keySignatureBytes(s.key, s.scale);
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0x59 && bytes[i + 2] === 0x02) {
      bytes[i + 3] = sf & 0xff;
      bytes[i + 4] = mi;
    }
  }
  return bytes;
}

/** Reads the first key-signature meta event straight from the bytes (tests). */
export function readKeySignature(bytes: Uint8Array): { sf: number; mi: number } | null {
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0x59 && bytes[i + 2] === 0x02) {
      const raw = bytes[i + 3];
      return { sf: raw > 127 ? raw - 256 : raw, mi: bytes[i + 4] };
    }
  }
  return null;
}
