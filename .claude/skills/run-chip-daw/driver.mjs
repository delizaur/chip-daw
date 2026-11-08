#!/usr/bin/env node
/**
 * Drives chip-daw in headless Chrome (muted) via playwright-core.
 *
 *   node .claude/skills/run-chip-daw/driver.mjs smoke            # built-in end-to-end check, exits 1 on failure
 *   node .claude/skills/run-chip-daw/driver.mjs script < cmds    # run commands from stdin (see SKILL.md)
 *
 * Options:
 *   --prod         build with BASE_PATH=/chip-daw/ and serve via `vite preview` (GitHub Pages layout)
 *   --url <url>    drive an already-running server instead of starting one
 *   --out <dir>    screenshot directory (default: tmp/run-chip-daw)
 *
 * The dev/preview server runs in-process on a free port and is closed on exit.
 * Browser: $CHROME_PATH, else installed Chrome, else installed Edge.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const mode = args.find((a) => a === 'smoke' || a === 'script') ?? 'smoke';
const OUT = resolve(ROOT, option('--out', 'tmp/run-chip-daw'));
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- server

async function startServer() {
  const given = option('--url');
  if (given) return { url: given, close: async () => {} };
  const vite = await import('vite');
  if (flag('--prod')) {
    process.env.BASE_PATH = '/chip-daw/';
    await vite.build({ root: ROOT, logLevel: 'warn' });
    const server = await vite.preview({ root: ROOT, preview: { port: 0, strictPort: false } });
    const url = server.resolvedUrls.local[0];
    return { url, close: () => server.close() };
  }
  const server = await vite.createServer({ root: ROOT, server: { port: 0 }, logLevel: 'warn' });
  await server.listen();
  return { url: server.resolvedUrls.local[0], close: () => server.close() };
}

// ---------------------------------------------------------------- browser

async function launchBrowser() {
  const base = { headless: true, args: ['--mute-audio'] };
  if (process.env.CHROME_PATH)
    return chromium.launch({ ...base, executablePath: process.env.CHROME_PATH });
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ ...base, channel });
    } catch {
      /* try next */
    }
  }
  throw new Error('No browser found. Install Chrome or Edge, or set CHROME_PATH.');
}

// ---------------------------------------------------------------- commands

function createCommands(page, url, errors) {
  // "<role> <accessible name...>" -> locator, e.g. "button Play test tone", "slider Master"
  const byRole = (words) =>
    page.getByRole(words[0], { name: words.slice(1).join(' '), exact: true });
  const meter = () =>
    page
      .locator('.meter-fill')
      .evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--level')) || 0);

  return {
    async goto([path = '']) {
      await page.goto(new URL(path, url).href);
      await page.getByRole('heading', { name: 'Tracks' }).waitFor();
      return page.url();
    },
    async click(words) {
      await byRole(words).click();
    },
    async press([key]) {
      await page.keyboard.press(key);
    },
    /** drag <role> <name...> <dy>: vertical pointer drag (knobs). Negative dy = up = increase. */
    async drag(words) {
      const dy = Number(words.at(-1));
      const box = await byRole(words.slice(0, -1)).boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(x, y + (dy * i) / 10);
      await page.mouse.up();
    },
    /** attr <attribute> <role> <name...> */
    async attr([attribute, ...words]) {
      return byRole(words).getAttribute(attribute);
    },
    async 'wait-text'(words) {
      await page.getByText(words.join(' ')).first().waitFor({ timeout: 10000 });
    },
    async status() {
      return page.locator('.audio-status').innerText();
    },
    /** Current master meter level (0..1), sampled after 300 ms so it settles. */
    async meter() {
      await page.waitForTimeout(300);
      return meter();
    },
    async eval(words) {
      return JSON.stringify(await page.evaluate(words.join(' ')));
    },
    async theme([scheme]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(300); // let CSS transitions finish before screenshots
    },
    async viewport([w, h]) {
      await page.setViewportSize({ width: Number(w), height: Number(h) });
    },
    async sleep([ms]) {
      await page.waitForTimeout(Number(ms));
    },
    async screenshot([name = 'screenshot']) {
      const path = resolve(OUT, `${name}.png`);
      await page.screenshot({ path });
      return path;
    },
    async errors() {
      return errors.length ? errors.join('\n') : 'none';
    },
  };
}

async function run(line, commands) {
  const [name, ...words] = line.trim().split(/\s+/);
  if (!name || name.startsWith('#')) return;
  const command = commands[name];
  if (!command)
    throw new Error(`Unknown command "${name}". Known: ${Object.keys(commands).join(', ')}`);
  const result = await command(words);
  console.log(`> ${line.trim()}${result !== undefined ? `\n${result}` : ''}`);
}

// ---------------------------------------------------------------- smoke

async function smoke(c) {
  const failures = [];
  const check = (ok, message) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`);
    if (!ok) failures.push(message);
  };

  await c.goto([]);
  check((await c.status()).startsWith('Audio off'), 'audio starts off');
  await c.screenshot(['1-initial']);

  await c.click(['button', 'Play', 'test', 'tone']);
  await c['wait-text'](['Audio on']);
  const level = await c.meter();
  // square wave 0.25 × volumeToGain(0.8)=0.64 → tanh(0.16) ≈ 0.1586
  check(Math.abs(level - 0.1586) < 0.01, `meter shows test tone (${level.toFixed(4)} ≈ 0.1586)`);

  await c.drag(['slider', 'Master', '-40']);
  const raised = await c.attr(['aria-valuetext', 'slider', 'Master']);
  check(raised === '100%', `master knob drag 80% -> ${raised}`);
  check((await c.meter()) > level + 0.05, 'meter rises with master volume');
  check(
    (await c.attr(['title', 'button', 'Undo'])).startsWith('Undo Change master volume'),
    'drag is one undo step',
  );
  await c.press(['Control+z']);
  check((await c.attr(['aria-valuetext', 'slider', 'Master'])) === '80%', 'Ctrl+Z restores 80%');

  await c.click(['button', 'Mute', 'Track', '2']);
  check(
    (await c.attr(['aria-pressed', 'button', 'Mute', 'Track', '2'])) === 'true',
    'mute toggles',
  );
  await c.press(['3']);
  check(
    (await c.attr(['aria-pressed', 'button', 'Select', 'Track', '3'])) === 'true',
    'key 3 selects track 3',
  );
  await c.screenshot(['2-playing']);

  await c.theme(['dark']);
  await c.screenshot(['3-dark']);

  const errors = await c.errors();
  check(errors === 'none', `no console errors (${errors})`);
  console.log(`\nScreenshots in ${OUT}`);
  return failures.length === 0;
}

// ---------------------------------------------------------------- main

// Read the script BEFORE starting Vite/the browser: once they are up, stdin arrives empty.
let script = '';
if (mode === 'script') for await (const chunk of process.stdin) script += chunk;

const server = await startServer();
const browser = await launchBrowser();
let ok = true;
try {
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const errors = [];
  page.on(
    'console',
    (m) => ['error', 'warning'].includes(m.type()) && errors.push(`[${m.type()}] ${m.text()}`),
  );
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('response', (r) => r.status() >= 400 && errors.push(`[http ${r.status()}] ${r.url()}`));
  const commands = createCommands(page, server.url, errors);
  console.log(`serving ${server.url} (${flag('--prod') ? 'production build' : 'dev'})`);

  if (mode === 'smoke') {
    ok = await smoke(commands);
  } else {
    for (const line of script.split(/\r?\n/)) await run(line, commands);
  }
} catch (error) {
  console.error(error);
  ok = false;
} finally {
  await browser.close();
  await server.close();
}
process.exit(ok ? 0 : 1);
