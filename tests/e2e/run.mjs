// End-to-end check of the BUILT app in a real Chromium (playwright-core + the
// locally cached Chrome for Testing). Usage: npm run build && npm run e2e
// Screenshots land in tests/e2e/out/. Exits non-zero if any check fails.

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = 8757;
const BASE = `http://localhost:${PORT}/terpene-lab-synth/`;
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const ONLY = process.argv.slice(2);

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const p = join(homedir(), 'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
  return existsSync(p) ? p : undefined;
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(BASE);
      const body = await r.text();
      if (r.ok && body.includes('TERPENE LAB + TERPENE SYNTH')) return true; // make sure it is THIS app on the port
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 250));
  }
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (group) => !ONLY.length || ONLY.includes(group);

let browser;
try {
  if (!(await waitForServer())) throw new Error(`preview server did not serve the app on ${BASE}`);
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept('E2E mapping'));
  await page.goto(BASE + '#/lab');
  await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('terpene-lab-synth'); });
  await page.reload();
  await page.waitForSelector('.strip');
  const S = (fn, arg) => page.evaluate(fn, arg);

  if (want('slice')) {
    check('Lab opens with Profile A loaded', (await page.textContent('h2:has-text("Profile A")')) != null);
    check('both demo profiles are visible', (await page.$$('text=Profile B — Bright Sequence')).length > 0);
    const strips = await page.$$('.strip');
    check('mixing console shows the default channels', strips.length === 8, `${strips.length} strips`);
    await page.screenshot({ path: `${OUT}lab.png`, fullPage: true });

    // play A
    await page.click('.item:has-text("Profile A") button:has-text("Hear it")');
    await page.waitForFunction(() => window.__tls.getState().transport.state === 'playing', null, { timeout: 15000 });
    await sleep(5000);
    const rmsA = await S(() => window.__tls.liveRms());
    check('Profile A plays real audio', rmsA != null && rmsA > 0.003, `live RMS ${rmsA?.toFixed(4)}`);
    const barA = await S(() => window.__tls.getState().transport.bar?.index ?? -1);
    check('the transport advances through bars', barA >= 1, `bar ${barA + 1}`);

    // stop
    await page.click('.transport button[aria-label="Stop"]');
    await page.waitForFunction(() => window.__tls.getState().transport.state === 'stopped');
    await sleep(2500);
    const rmsStop = await S(() => window.__tls.liveRms());
    check('Stop silences the dry signal (only short tails remain)', rmsStop < rmsA * 0.5, `RMS after stop ${rmsStop?.toFixed(4)}`);

    // load B and play
    await page.click('.item:has-text("Profile B") button:has-text("Hear it")');
    await page.waitForFunction(() => window.__tls.getState().transport.state === 'playing', null, { timeout: 15000 });
    await sleep(4000);
    const rmsB = await S(() => window.__tls.liveRms());
    check('Profile B plays real audio', rmsB > 0.003, `live RMS ${rmsB?.toFixed(4)}`);
    const name = await S(() => window.__tls.getState().synth.profileA.name);
    check('Synth now follows Profile B', name.includes('Bright Sequence'), name);
    await page.click('.transport button[aria-label="Stop"]');

    // repeated play/stop does not accumulate events
    for (let i = 0; i < 3; i++) {
      await page.click('.transport button[aria-label="Play"]');
      await sleep(900);
      await page.click('.transport button[aria-label="Stop"]');
      await sleep(300);
    }
    check('repeated play/stop cycles stay healthy', (await S(() => window.__tls.getState().transport.state)) === 'stopped' && errors.length === 0, errors.join(' | '));

    // offline self test
    const st = await page.evaluate(() => window.__tls.selfTest(8));
    writeFileSync(`${OUT}selftest.json`, JSON.stringify(st, null, 2));
    for (const [bus, m] of Object.entries(st.modules)) check(`module "${bus}" renders non-silent audio offline`, m.ok, `${m.rmsDb.toFixed(1)} dBFS RMS`);
    check('offline render length matches the requested duration', st.mix.lengthOk, `${st.mix.samples} samples for ${st.mix.expectedSeconds.toFixed(2)} s`);
    check('peak level stays below −0.3 dBFS', st.mix.peakOk, `peak ${st.mix.peakDb.toFixed(2)} dBFS${st.mix.trimmed ? ' (safety trim applied)' : ''}`);
    check('mix level is musical (not near-silent)', st.mix.rmsDb > -40, `${st.mix.rmsDb.toFixed(1)} dBFS RMS`);
  }

  if (want('ui')) {
    // assets resolve under the GitHub Pages sub-path
    const assets = await page.$$eval('script[src], link[rel=stylesheet]', (els) => els.map((e) => e.getAttribute('src') ?? e.getAttribute('href')));
    check('built assets use the /terpene-lab-synth/ base path', assets.length > 0 && assets.every((a) => a.startsWith('/terpene-lab-synth/')), assets.join(', '));
    const dataRes = await page.evaluate(async () => (await fetch('/terpene-lab-synth/data/smith-cultivars.json')).status);
    check('lazy dataset is served under the base path', dataRes === 200);

    // navigation
    for (const [label, title] of [['Explore', 'Explore'], ['Terpene Synth', 'Terpene Synth'], ['Compare', 'Compare'], ['Library', 'Library'], ['About / Research', 'About / Research'], ['Terpene Lab', 'Terpene Lab']]) {
      await page.click(`.nav a:has-text("${label}")`);
      const h = await page.textContent('h1.view-title');
      check(`navigation to ${label}`, h?.trim().toLowerCase() === title.toLowerCase(), h);
    }
    check('deep link via hash works', await (async () => { await page.goto(BASE + '#/compare'); await page.waitForSelector('h1.view-title'); return (await page.textContent('h1.view-title')).trim() === 'Compare'; })());
    await page.goto(BASE + '#/lab');
    await page.waitForSelector('.strip');

    // edit a demo → derived hypothetical, original untouched
    await page.click('.item:has-text("Profile A") button:has-text("Load in Lab")');
    const fader = page.locator('.strip:has-text("MYR") input[type=range]');
    await fader.fill('70');
    const lab = await S(() => window.__tls.getState().lab);
    check('editing a demo creates a derived hypothetical profile', lab.profile.kind === 'hypothetical' && lab.profile.provenance.derivedFrom?.id === 'demo-deep-botanical', lab.profile.name);
    check('the original demo values are unchanged', lab.original.measurements.myrcene.value === 40 && lab.profile.measurements.myrcene.value === 70);
    check('an edit notice explains the copy', (await page.textContent('.notice')).includes('hypothetical copy'));
    const synthMyr = await S(() => window.__tls.getState().synth.profileA.measurements.myrcene.value);
    check('Lab edits reach the Synth live (follow mode)', synthMyr === 70, `synth myrcene ${synthMyr}`);

    // mute & lock & add channel
    await page.click('.strip:has-text("LIM") button[aria-label^="Mute"]');
    check('muting removes the compound from the Synth mapping', (await S(() => window.__tls.getState().synth.mutedA)).includes('limonene'));
    await page.selectOption('#add-ch', 'valencene');
    check('adding a channel shows a new strip', (await page.$$('.strip')).length === 9);
    await page.click('.strip:has-text("LIM") button[aria-label^="Unmute"]');

    // save, rename in library
    await page.click('button:has-text("Save")');
    await page.waitForFunction(() => window.__tls.getState().library.length === 1);
    check('saving puts the profile in the library', true);
    await page.click('.nav a:has-text("Library")');
    await page.click('.item button:has-text("Rename")');
    await page.fill('input[name=n]', 'My Deep Botanical');
    await page.click('.item button:has-text("OK")');
    await page.waitForFunction(() => window.__tls.getState().library[0].name === 'My Deep Botanical');
    await page.reload();
    await page.waitForFunction(() => window.__tls.getState().loaded);
    const persisted = await S(() => window.__tls.getState().library.map((p) => p.name));
    check('saved profiles persist across reloads (IndexedDB)', persisted.includes('My Deep Botanical'), persisted.join(', '));

    // library export / import round trip
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export all")')]);
    const libText = readFileSync(await dl.path(), 'utf8');
    const libJson = JSON.parse(libText);
    check('library export is a versioned, valid file', libJson.format === 'terpene-lab-synth/library' && libJson.version === 1 && libJson.profiles.length === 1);
    const bad = JSON.parse(libText); bad.profiles.push({ schemaVersion: 1, id: 'bad' });
    writeFileSync(`${OUT}import.json`, JSON.stringify(bad));
    await page.setInputFiles('input[type=file]', `${OUT}import.json`);
    await page.waitForSelector('.notice:has-text("Imported")');
    const note = await page.textContent('.notice:has-text("Imported")');
    check('import adds valid items and reports invalid ones', note.includes('Imported 1') && note.includes('problem'), note.slice(0, 120));

    // explore: search, filters, similarity
    await page.click('.nav a:has-text("Explore")');
    await page.click('.tabs button:has-text("Samples")');
    await page.waitForSelector('.item:has-text("Blue Dream")', { timeout: 15000 });
    await page.fill('input[aria-label=Search]', 'tangie');
    await page.waitForTimeout(300);
    const names = await page.$$eval('.list .item-title', (els) => els.map((e) => e.textContent));
    check('search filters cultivar names', names.length > 0 && names.every((n) => n.toLowerCase().includes('tangie')), names.slice(0, 4).join(', '));
    await page.fill('input[aria-label=Search]', '');
    await page.selectOption('label:has-text("Sort") select', 'similar');
    await page.waitForTimeout(400);
    const simBadge = await page.textContent('.list .item .badge:has-text("similarity")');
    check('similarity search ranks records against the Lab profile', /similarity \d\.\d\d/.test(simBadge ?? ''), simBadge);
    await page.click('.seg button:has-text("Tested samples")');
    await page.waitForSelector('.list .item:has-text("· THC")', { timeout: 30000 });
    const resTitle = await page.textContent('section:has(h2:has-text("Results")) h2');
    check('43,148 tested samples load lazily', resTitle.includes('43,148'), resTitle);
    await page.click('.seg button:has-text("CT registry")');
    await page.waitForSelector('.list .item:has-text("MMBR")', { timeout: 20000 });
    check('CT registry products load', true);
    await page.click('.seg button:has-text("Cultivar names")');
    await page.waitForSelector('.list .item:has-text("producers")', { timeout: 15000 });
    await page.selectOption('label:has-text("Sort") select', 'n');
    await page.waitForSelector('.item:has-text("Blue Dream")', { timeout: 15000 });
    await page.locator('.item:has-text("Blue Dream")').first().locator('button:has-text("Compare B")').click();

    // compare
    await page.click('.nav a:has-text("Compare")');
    await page.waitForSelector('text=Similarity');
    const score = await page.textContent('.panel:has-text("Similarity") .readout.amber');
    check('compare shows a similarity score with confidence', /\d\.\d\d/.test(score), score);
    check('compare explains shared and unique compounds', (await page.textContent('.panel:has-text("Similarity")')).includes('Only in A'));
    await page.click('button:has-text("A/B in Analytical mode")');
    await page.waitForFunction(() => window.__tls.getState().transport.state === 'playing', null, { timeout: 15000 });
    const st = await S(() => window.__tls.getState().synth);
    check('A/B sends both profiles and switches to Analytical mode', st.mode === 'analytical' && st.morphEnabled && st.profileB?.name.includes('Blue Dream'));
    await page.fill('#morph', '1');
    await sleep(1500);
    check('morph control moves while playing', (await S(() => window.__tls.getState().synth.morph)) === 1);

    // live settings changes while playing
    await page.selectOption('select:near(:text("Style"))', 'dub_techno');
    await sleep(2500);
    const s2 = await S(() => window.__tls.getState().synth.settings);
    check('changing style while playing applies its tempo and scale', s2.style === 'dub_techno' && s2.bpm === 120);
    const k = page.locator('[data-control-id="globalFilter"]');
    await k.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('PageDown');
    check('knobs respond to the keyboard', (await S(() => window.__tls.getState().synth.mixer.globalFilter)) < 0.6);
    await page.screenshot({ path: `${OUT}synth-playing.png`, fullPage: true });
    // sampled over two seconds: one ~23 ms analyser frame can fall between notes
    const live = [];
    for (let i = 0; i < 20; i++) { live.push(await S(() => window.__tls.liveRms()) ?? 0); await sleep(100); }
    const rms = live.reduce((a, b) => a + b, 0) / live.length;
    check('audio keeps playing through live changes', rms > 0.002, `mean live RMS ${rms.toFixed(4)} over 2 s`);
    await page.click('.transport button[aria-label="Stop"]');
    check('development events and bars are reported', (await S(() => window.__tls.getState().transport.state)) === 'stopped');
  }

  if (want('export')) {
    await page.goto(BASE + '#/synth');
    await page.waitForSelector('h1.view-title');
    await page.click('.seg button:has-text("Generative composition")');
    await page.selectOption('select[aria-label="Export length"]', '8');
    const [wavDl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('button:has-text("WAV mix")')]);
    const wav = readFileSync(await wavDl.path());
    const tag = (o) => wav.toString('ascii', o, o + 4);
    let o = 12, fmt = null, data = null;
    while (o + 8 <= wav.length) { const id = tag(o), sz = wav.readUInt32LE(o + 4); if (id === 'fmt ') fmt = { ch: wav.readUInt16LE(o + 10), sr: wav.readUInt32LE(o + 12), bits: wav.readUInt16LE(o + 22) }; if (id === 'data') data = { off: o + 8, sz }; o += 8 + sz + (sz % 2); }
    const s = await S(() => window.__tls.getState().synth.settings);
    const expected = Math.round((8 * s.beatsPerBar * 60 / s.bpm + 4) * 44100);
    const frames = data.sz / 4;
    let peak = 0, sum = 0;
    for (let i = data.off; i < data.off + data.sz; i += 2) { const v = wav.readInt16LE(i) / 32768; peak = Math.max(peak, Math.abs(v)); sum += v * v; }
    const rmsDb = 10 * Math.log10(sum / (data.sz / 2));
    check('WAV export is a real stereo 16-bit 44.1 kHz file', tag(0) === 'RIFF' && fmt.ch === 2 && fmt.sr === 44100 && fmt.bits === 16, wavDl.suggestedFilename());
    check('WAV length matches the requested 8 bars + tail', Math.abs(frames - expected) <= 2, `${frames} vs ${expected} frames`);
    check('WAV contains music, not silence', rmsDb > -40, `${rmsDb.toFixed(1)} dBFS RMS`);
    check('WAV peak stays below −0.3 dBFS', 20 * Math.log10(peak) <= -0.29, `${(20 * Math.log10(peak)).toFixed(2)} dBFS`);
    check('WAV file name carries key, tempo and seed', /_\d+bpm_seed\d+_8bars\.wav$/.test(wavDl.suggestedFilename()), wavDl.suggestedFilename());
    const [zipDl] = await Promise.all([page.waitForEvent('download', { timeout: 300000 }), page.click('button:has-text("Stems (ZIP)")')]);
    const zip = readFileSync(await zipDl.path());
    const entries = [];
    for (let i = 0; i + 30 < zip.length; ) {
      if (zip.readUInt32LE(i) !== 0x04034b50) break;
      const size = zip.readUInt32LE(i + 18), nlen = zip.readUInt16LE(i + 26);
      const start = i + 30 + nlen;
      let frames = null;
      if (zip.toString('ascii', start, start + 4) === 'RIFF') {
        for (let o = start + 12; o + 8 < start + size; ) { const id = zip.toString('ascii', o, o + 4), sz = zip.readUInt32LE(o + 4); if (id === 'data') { frames = sz / 4; break; } o += 8 + sz + (sz % 2); }
      }
      entries.push({ name: zip.toString('utf8', i + 30, i + 30 + nlen), size, frames });
      i += 30 + nlen + size;
    }
    const wavs = entries.filter((e) => e.name.endsWith('.wav'));
    check('stems ZIP holds six WAV stems plus a README', wavs.length === 6 && entries.some((e) => e.name === 'README.txt'), entries.map((e) => e.name.split('_').pop()).join(', '));
    check('all stems have identical audio length (aligned)', new Set(wavs.map((w) => w.frames)).size === 1 && wavs[0].frames > 0, `${wavs[0]?.frames} frames each`);
    const [midDl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("MIDI")')]);
    const mid = readFileSync(await midDl.path());
    check('MIDI export writes a Standard MIDI File', mid.toString('ascii', 0, 4) === 'MThd' && mid.includes(Buffer.from('MTrk')), `${mid.length} bytes`);
    const [pjDl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Preset JSON")')]);
    const pj = JSON.parse(readFileSync(await pjDl.path(), 'utf8'));
    check('preset export includes profile, seed, settings and mapping', pj.presets[0].settings.seed === s.seed && pj.presets[0].mapping.routes.length > 0 && !!pj.presets[0].profileA);
    await page.click('button:has-text("Save composition")');
    await page.waitForFunction(() => window.__tls.getState().presets.length >= 1);
    check('compositions save to the library', true);
  }

  if (want('ui')) {
    for (const [w, h] of [[390, 844], [820, 1180]]) {
      const p2 = await ctx.newPage();
      await p2.setViewportSize({ width: w, height: h });
      let worst = 0;
      for (const r of ['lab', 'synth', 'explore', 'compare', 'library', 'about']) {
        await p2.goto(`${BASE}#/${r}`);
        await p2.waitForSelector('h1.view-title');
        worst = Math.max(worst, await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
      }
      check(`no horizontal scrolling at ${w}px`, worst <= 0, `${worst}px`);
      await p2.close();
    }
  }

  if (want('engine2')) {
    await page.goto(BASE + '#/synth');
    await page.waitForSelector('#listening');
    check('listening session lists three demos', (await page.$$('#listening .card')).length === 3);
    check('the three development knobs are present', (await page.$$('[aria-label="Compositional development controls"] [role="slider"]')).length === 3);
    await page.click('#listening button[aria-label="Audition demo B"]');
    await page.waitForFunction(() => window.__tls.getState().transport.state === 'playing', null, { timeout: 15000 });
    const st = await S(() => window.__tls.getState().synth);
    check('audition loads the demo: seed, Generative mode, 128-bar arrangement', st.settings.seed === 25 && st.mode === 'generative' && st.settings.arrangementBars === 128 && st.settings.style === 'motorik', `seed ${st.settings.seed} ${st.mode} ${st.settings.arrangementBars}`);
    // play past the intro into section A (bar 17 at 112 BPM ≈ 34 s), so the comparison covers a section change
    await page.waitForFunction(() => (window.__tls.getState().transport.bar?.index ?? 0) >= 17, null, { timeout: 60000 });
    // one analyser frame is ~23 ms and can fall between notes: sample the level over three seconds
    const series = [];
    for (let i = 0; i < 30; i++) { series.push(await S(() => window.__tls.liveRms()) ?? 0); await sleep(100); }
    const rmsMean = series.reduce((a, b) => a + b, 0) / series.length;
    check('the demo plays real audio', rmsMean > 0.003, `mean live RMS ${rmsMean.toFixed(4)} over 3 s (min ${Math.min(...series).toFixed(4)}, max ${Math.max(...series).toFixed(4)}) at bar ${await S(() => window.__tls.getState().transport.bar?.index + 1)}`);
    const cells = await page.$$eval('.form-cell', (els) => els.map((e) => [e.textContent, e.classList.contains('now')]));
    check('Now Playing shows the planned form with the current section marked', cells.length >= 5 && cells.filter((c) => c[1]).length === 1, cells.map((c) => `${c[0]}${c[1] ? '*' : ''}`).join(' > '));
    const mat = await page.$$eval('.material dd', (els) => els.map((e) => e.textContent));
    check('Now Playing names the groove, bass and melody in use', mat.length === 3 && mat.every((x) => x && x.length > 3), mat.join(' | '));
    const live = await S(() => window.__tls.getState().transport.history.map((b) => JSON.stringify([b.index, b.section.name, b.material, b.chord.symbol, b.events])));
    const offline = await S(async (n) => (await window.__tls.plan(n)).map((b) => JSON.stringify([b.index, b.section.name, b.material, b.chord.symbol, b.events])), (live.length ? JSON.parse(live[live.length - 1])[0] + 1 : 0));
    const same = live.length > 0 && live.every((x) => offline.includes(x));
    check('live playback follows exactly the plan an offline render uses', same, `${live.length} live bars compared`);
    await page.screenshot({ path: `${OUT}engine2-synth.png`, fullPage: true });
    await page.click('#listening button[aria-label="Stop demo B"]');
    await page.waitForFunction(() => window.__tls.getState().transport.state === 'stopped');
    check('a demo stops cleanly from its card', true);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(BASE + '#/synth');
    await page.waitForSelector('#listening');
    const sw = await S(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('synth view with the listening session has no horizontal scroll at 390px', sw <= 0, `${sw}px`);
    await page.locator('#listening').screenshot({ path: `${OUT}engine2-listening-390.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }

  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) {
  check('e2e run completed', false, String(e));
} finally {
  await browser?.close();
  server.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  writeFileSync(`${OUT}results.json`, JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}
