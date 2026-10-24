// The listening demos' descriptions must match what the engine actually plans.
import { describe, expect, it } from 'vitest';
import { DEMO_A } from '../../src/chem/demo';
import { demoSettings, LISTENING_DEMOS, type ListeningDemo } from '../../src/music/demos';
import { generateBars } from '../../src/music/composer';
import { brayCurtis, onsetHistogram, DRUM_GROUP } from '../../src/music/analysis';
import { BUILT_IN_PRESETS, computeControls } from '../../src/sonify/mapping';
import { profileVariant } from '../../src/store/actions';
import { getState } from '../../src/store/store';

const variant = profileVariant({ ...getState().synth, profileA: DEMO_A, mode: 'generative', mutedA: [] });
const params = computeControls(DEMO_A, BUILT_IN_PRESETS[0], 'generative').params;
const render = (d: ListeningDemo) => generateBars({ ...demoSettings(d), variant }, params, 128);
const base = (s: string) => s.split(' (')[0];

describe('listening demos', () => {
  for (const d of LISTENING_DEMOS) {
    it(`${d.title} plans what its notes describe`, () => {
      const bars = render(d);
      expect(bars[0].blueprint).toBe(d.expect.blueprint);
      expect(bars[0].form.map((f) => f.label).join(' → ')).toBe(d.form);
      const main = bars.find((b) => b.section.role === 'main')!;
      expect(base(bars[main.index + 2].material.groove)).toBe(d.expect.mainGroove);
      expect(base(bars[main.index + 2].material.bass)).toBe(d.expect.mainBass);
      if (d.expect.contrastGroove) {
        const con = bars.find((b) => b.section.role === 'contrast')!;
        expect(base(bars[con.index + 2].material.groove)).toBe(d.expect.contrastGroove);
        expect(base(bars[con.index + 2].material.bass)).toBe(d.expect.contrastBass);
      }
      expect(bars[127].final).toBe(true);
      expect(bars[127].ending).toBe(d.expect.ending);
      // the ending sounds as described: a button lands with the drums, a resolve without them
      expect(bars[127].events.some((e) => e.voice === 'kick')).toBe(d.expect.ending === 'button');
    });
  }

  it('the three demos are rhythmically different pieces', () => {
    const ps = LISTENING_DEMOS.map((d) => render(d));
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const drums = brayCurtis(onsetHistogram(ps[i], DRUM_GROUP), onsetHistogram(ps[j], DRUM_GROUP));
      const bass = brayCurtis(onsetHistogram(ps[i], ['bass']), onsetHistogram(ps[j], ['bass']));
      expect(drums + bass, `${LISTENING_DEMOS[i].id} vs ${LISTENING_DEMOS[j].id}`).toBeGreaterThan(0.3);
    }
  });
});
