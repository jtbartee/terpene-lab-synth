// LIBRARY: saved profiles, compositions and mappings — stored only on this device.

import { useRef, useState } from 'react';
import { analyte } from '../../chem/analytes';
import { dominantAnalytes } from '../../chem/profile';
import { STYLES } from '../../music/styles';
import {
  deleteLibraryProfile, deleteMapping, deletePreset, download, duplicateLibraryProfile, exportLibrary, importLibrary,
  loadPreset, openInLab, sendToSynth, updateLibraryProfile,
} from '../../store/actions';
import { put } from '../../store/persistence';
import { navigate, setState, setSynth, toast, useStore, type SynthPreset } from '../../store/store';
import { KindBadge, Notice, Panel, SourceLine } from '../components/bits';
import { IconCopy, IconDownload, IconSend, IconStar, IconTrash, IconUpload } from '../components/icons';

export function LibraryView() {
  const library = useStore((s) => s.library);
  const presets = useStore((s) => s.presets);
  const mappings = useStore((s) => s.mappings);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<'all' | 'favorites'>('all');
  const [report, setReport] = useState<{ added: number; errors: string[] } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = library.filter((p) => filter === 'all' || p.favorite);

  async function onImport(f: File | undefined) {
    if (!f) return;
    if (f.size > 20_000_000) { setReport({ added: 0, errors: ['File is larger than 20 MB.'] }); return; }
    const r = await importLibrary(await f.text());
    setReport(r);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="stack">
      <div className="view-head">
        <div>
          <h1 className="view-title">Library</h1>
          <p className="view-sub">Your saved profiles, compositions and mappings. Everything stays in this browser on this device unless you export it. No account is needed.</p>
        </div>
        <div className="row">
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => onImport(e.target.files?.[0])} aria-label="Import library JSON" />
          <button className="btn" onClick={() => fileRef.current?.click()}><IconUpload /> Import JSON</button>
          <button className="btn" onClick={() => download(`terpene-library-${new Date().toISOString().slice(0, 10)}.json`, exportLibrary(), 'application/json')} disabled={!library.length && !presets.length}><IconDownload /> Export all</button>
        </div>
      </div>
      {report && (
        <Notice kind={report.errors.length ? 'warn' : 'info'}>
          Imported {report.added} item(s).{report.errors.length > 0 && <> {report.errors.length} problem(s): <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{report.errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul></>}
        </Notice>
      )}

      <Panel title="Profiles" sub={`${library.length} saved`} actions={
        <>
          <div className="seg" role="group" aria-label="Filter">
            <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
            <button aria-pressed={filter === 'favorites'} onClick={() => setFilter('favorites')}>Favourites</button>
          </div>
          <button className="btn sm" disabled={!selected.length} onClick={() => download(`terpene-profiles-${selected.length}.json`, exportLibrary(selected), 'application/json')}><IconDownload /> Export selected</button>
        </>
      }>
        {!shown.length ? (
          <div className="empty">{library.length ? 'No favourites yet — star a profile to pin it here.' : 'No saved profiles yet. Edit a profile in the Lab and press Save.'}</div>
        ) : (
          <div className="list">
            {shown.map((p) => (
              <div className="item" key={p.id}>
                <div className="stack" style={{ gap: 4 }}>
                  <div className="row tight">
                    <input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))} aria-label={`Select ${p.name}`} />
                    <button className="btn sm ghost icon" aria-pressed={!!p.favorite} onClick={() => updateLibraryProfile({ ...p, favorite: !p.favorite })} aria-label={p.favorite ? 'Remove from favourites' : 'Add to favourites'}><IconStar filled={!!p.favorite} /></button>
                    {renaming === p.id ? (
                      <form className="row tight" onSubmit={(e) => { e.preventDefault(); const v = (new FormData(e.currentTarget).get('n') as string).trim(); if (v) void updateLibraryProfile({ ...p, name: v, updatedAt: new Date().toISOString() }); setRenaming(null); }}>
                        <input name="n" className="input" defaultValue={p.name} autoFocus aria-label="New name" />
                        <button className="btn sm primary">OK</button>
                      </form>
                    ) : <span className="item-title">{p.name}</span>}
                    <KindBadge kind={p.kind} />
                  </div>
                  <SourceLine p={p} />
                  <div className="item-meta">Leading: {dominantAnalytes(p, 3).map((id) => analyte(id).label).join(', ') || '—'} · updated {p.updatedAt?.slice(0, 16).replace('T', ' ') ?? '—'}</div>
                </div>
                <div className="row tight">
                  <button className="btn sm" onClick={() => { openInLab(p); navigate('lab'); }}>Edit in Lab</button>
                  <button className="btn sm" onClick={() => { sendToSynth(p, 'A'); toast(`"${p.name}" is driving the Synth.`); }}><IconSend /> Synth</button>
                  <button className="btn sm" onClick={() => setRenaming(p.id)}>Rename</button>
                  <button className="btn sm" onClick={() => duplicateLibraryProfile(p)}><IconCopy /> Duplicate</button>
                  <button className="btn sm danger" onClick={() => { if (confirm(`Delete "${p.name}" from this device?`)) void deleteLibraryProfile(p.id); }}><IconTrash /> Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Compositions" sub={`${presets.length} saved`}>
        {!presets.length ? <div className="empty">Save a composition from the Synth's Export panel to keep its profile, settings, seed, mapping and mix together.</div> : (
          <div className="list">
            {presets.map((pr) => (
              <div className="item" key={pr.id}>
                <div>
                  <div className="row tight">
                    <button className="btn sm ghost icon" aria-pressed={!!pr.favorite} onClick={async () => { const n: SynthPreset = { ...pr, favorite: !pr.favorite }; await put('presets', n.id, n); setState((s) => ({ presets: s.presets.map((x) => (x.id === n.id ? n : x)) })); }} aria-label="Favourite"><IconStar filled={!!pr.favorite} /></button>
                    <span className="item-title">{pr.name}</span>
                  </div>
                  <div className="item-meta">{pr.profileA?.name ?? 'no profile'}{pr.morphEnabled && pr.profileB ? ` → ${pr.profileB.name} (${Math.round(pr.morph * 100)} %)` : ''} · {STYLES[pr.settings.style]?.label} · {pr.settings.key} · {pr.settings.bpm} BPM · seed {pr.settings.seed} · {pr.mode}</div>
                </div>
                <div className="row tight">
                  <button className="btn sm primary" onClick={() => { loadPreset(pr); navigate('synth'); }}>Load</button>
                  <button className="btn sm" onClick={() => download(`${pr.name.replace(/[^a-z0-9]+/gi, '-')}.terpene-preset.json`, JSON.stringify({ format: 'terpene-lab-synth/library', version: 1, exportedAt: new Date().toISOString(), profiles: [], presets: [pr] }, null, 2), 'application/json')}><IconDownload /> Export</button>
                  <button className="btn sm danger" onClick={() => { if (confirm(`Delete composition "${pr.name}"?`)) void deletePreset(pr.id); }}><IconTrash /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Mappings" sub={`${mappings.length} saved`}>
        {!mappings.length ? <div className="empty">Edited mappings saved from the Synth's mapping matrix appear here.</div> : (
          <div className="list">
            {mappings.map((m) => (
              <div className="item" key={m.id}>
                <div><div className="item-title">{m.name}</div><div className="item-meta">{m.routes.filter((r) => r.enabled).length} active routes · basis {m.basis}</div></div>
                <div className="row tight">
                  <button className="btn sm" onClick={() => { setSynth({ mapping: m }); toast(`Mapping "${m.name}" active.`); }}>Use</button>
                  <button className="btn sm danger" onClick={() => { if (confirm(`Delete mapping "${m.name}"?`)) void deleteMapping(m.id); }}><IconTrash /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
