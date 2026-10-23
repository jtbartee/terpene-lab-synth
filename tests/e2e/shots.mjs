// Screenshots of every view at desktop and phone widths (for visual review).
// Usage: npm run build && node tests/e2e/shots.mjs [desktop|phone]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = 8757;
const BASE = `http://localhost:${PORT}/terpene-lab-synth/`;
const OUT = new URL('./out/shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const exe = join(homedir(), 'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { const r = await fetch(BASE); if (r.ok && (await r.text()).includes('TERPENE LAB')) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
const browser = await chromium.launch({ executablePath: existsSync(exe) ? exe : undefined, headless: true });
const which = process.argv[2];
const sizes = [['desktop', 1440, 1000], ['phone', 390, 844]].filter(([n]) => !which || n === which);
try {
  for (const [name, w, h] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    for (const route of ['lab', 'synth', 'explore', 'compare', 'library', 'about']) {
      await page.goto(`${BASE}#/${route}`);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}${name}-${route}.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      console.log(`${name} ${route}: horizontal overflow ${overflow}px`);
    }
    // explore tabs
    await page.goto(`${BASE}#/explore`);
    for (const tab of ['Samples', 'Aroma']) {
      await page.click(`.tabs button:has-text("${tab}")`);
      await page.waitForTimeout(tab === 'Samples' ? 2500 : 500);
      await page.screenshot({ path: `${OUT}${name}-explore-${tab.toLowerCase()}.png`, fullPage: true });
    }
    // compound drawer
    await page.click('.tabs button:has-text("Compounds")');
    await page.click('.card:has-text("Linalool")');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}${name}-drawer.png` });
    console.log(name, 'errors:', errors.length ? errors : 'none');
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
