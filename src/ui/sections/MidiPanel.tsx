// Hardware MIDI controller panel (Web MIDI, optional).

import { midiLearn } from '../midiLearn';
import { Panel } from '../components/bits';
import { IconMidi } from '../components/icons';

export function MidiPanel() {
  const st = midiLearn.useState();
  const mappings = Object.entries(st.mappings);
  return (
    <Panel title="MIDI controller" sub="optional">
      {st.status === 'unsupported' ? (
        <p className="small muted">This browser does not support Web MIDI. Everything else works without it; Chrome and Edge on desktop support hardware controllers.</p>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row">
            {st.status !== 'on' && <button className="btn" onClick={() => midiLearn.enable()} disabled={st.status === 'requesting'}><IconMidi /> {st.status === 'denied' ? 'Try again' : 'Enable MIDI'}</button>}
            {st.status === 'on' && <span className="badge measured">MIDI on</span>}
            {st.status === 'on' && <button className="btn" aria-pressed={st.armed} onClick={() => midiLearn.arm(!st.armed)}>{st.armed ? 'Learning… (click a knob, move a control)' : 'MIDI learn'}</button>}
            {mappings.length > 0 && <button className="btn sm ghost" onClick={() => midiLearn.clear()}>Clear mappings</button>}
          </div>
          {st.status === 'denied' && <p className="small" style={{ color: 'var(--danger)' }}>MIDI access was declined or unavailable.</p>}
          {st.status === 'on' && <p className="small muted" style={{ margin: 0 }}>Devices: {st.devices.length ? st.devices.join(', ') : 'none connected (plug one in — it is picked up automatically)'}</p>}
          {st.armed && st.selected && <p className="small" style={{ margin: 0 }}>Waiting for a control change for <b>{midiLearn.label(st.selected)}</b>…</p>}
          {mappings.length > 0 && (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {mappings.map(([cc, id]) => <li key={cc}>CC {cc.split(':')[1]} (channel {cc.split(':')[0]}) → {midiLearn.label(id)}</li>)}
            </ul>
          )}
          {st.lastMessage && <p className="tiny faint" style={{ margin: 0 }}>Last message: {st.lastMessage}</p>}
        </div>
      )}
    </Panel>
  );
}
