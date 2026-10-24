// Renders the three listening demos to WAV through the app's own export path
// (Tone.Offline, the same Sequencer as live playback) and prints per-section
// levels measured from the rendered audio. Usage: npm run build && node tests/e2e/render-demos.mjs
// Files land in demos/ (git-ignored). This measures audio; it is not a listening test.

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = 8757;
const BASE = `http://localhost:${PORT}/terpene-lab-synth/`;
const OUT = new URL('../../demos/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const chrome = process.env.CHROME_PATH ?? join(homedir(), 'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  for (let i = 0; ; i++) {
    try { const r = await fetch(BASE); if (r.ok && (await r.text()).includes('TERPENE LAB + TERPENE SYNTH')) break; } catch { /* not up */ }
    if (i > 80) throw new Error('preview server did not start');
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({ executablePath: existsSync(chrome) ? chrome : undefined, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } })).newPage();
  await page.goto(BASE + '#/synth');
  await page.waitForSelector('#listening');
  const report = [];
  for (const id of ['A', 'B', 'C']) {
    await page.click(`#listening button[aria-label="Audition demo ${id}"]`);
    await page.waitForFunction(() => window.__tls.getState().transport.state === 'playing', null, { timeout: 20000 });
    await page.click(`#listening button[aria-label="Stop demo ${id}"]`);
    await page.waitForFunction(() => window.__tls.getState().transport.state === 'stopped');
    await page.selectOption('select[aria-label="Export length"]', '128');
    const t0 = Date.now();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), page.click('button:has-text("WAV mix")')]);
    const file = join(OUT, `demo-${id}_${dl.suggestedFilename()}`);
    copyFileSync(await dl.path(), file);
    const plan = await page.evaluate(async () => (await window.__tls.plan(128)).map((b) => ({ i: b.index, name: b.section.name, bar: b.section.bar, bpm: b.bpm, beats: b.beats })));
    // per-section RMS from the WAV itself
    const wav = readFileSync(file);
    let o = 12, data = null;
    while (o + 8 <= wav.length) { const tag = wav.toString('ascii', o, o + 4), sz = wav.readUInt32LE(o + 4); if (tag === 'data') { data = { off: o + 8, sz }; break; } o += 8 + sz + (sz % 2); }
    const sec = 60 / plan[0].bpm * plan[0].beats;
    const starts = plan.filter((b) => b.bar === 0);
    const rows = starts.map((s, k) => {
      const end = (starts[k + 1]?.i ?? 128);
      const a = data.off + Math.floor(s.i * sec * 44100) * 4, z = data.off + Math.floor(end * sec * 44100) * 4;
      let sum = 0, n = 0;
      for (let p = a; p < z; p += 2) { const v = wav.readInt16LE(p) / 32768; sum += v * v; n++; }
      return `${String(s.i + 1).padStart(3)}–${String(end).padEnd(3)} ${s.name.padEnd(24)} ${(10 * Math.log10(sum / n)).toFixed(1)} dBFS RMS`;
    });
    report.push(`Demo ${id}: ${file.split('/').pop()} (${((Date.now() - t0) / 1000).toFixed(0)} s to render)\n  ${rows.join('\n  ')}`);
    console.log(report[report.length - 1]);
  }
  writeFileSync(join(OUT, 'section-levels.txt'), report.join('\n\n') + '\n');
} finally {
  await browser?.close();
  server.kill();
}
