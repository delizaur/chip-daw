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
 *   --scale <n>    device pixel ratio for screenshots (default: 1; use 2 to inspect details)
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
  // "<role> <accessible name...>" -> locator, e.g. "button Mute Track 2", "slider Master"
  const byRole = (words) =>
    page.getByRole(words[0], { name: words.slice(1).join(' '), exact: true });
  const meter = () =>
    page.locator('.top-bar .meter-fill').evaluate((el) => Number(el.dataset.level) || 0);

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
    /** keydown/keyup <key>: hold and release, e.g. "keydown KeyA" plays C4 until "keyup KeyA". */
    async keydown([key]) {
      await page.keyboard.down(key);
    },
    async keyup([key]) {
      await page.keyboard.up(key);
    },
    /** select <combobox name...> | <option label...>, e.g. "select MIDI input | Enable MIDI…" */
    async select(words) {
      const bar = words.indexOf('|');
      const name = words.slice(0, bar).join(' ');
      const label = words.slice(bar + 1).join(' ');
      await page.getByRole('combobox', { name, exact: true }).selectOption({ label });
    },
    /** text <css selector...>: innerText of the first match. */
    async text(selector) {
      return page.locator(selector.join(' ')).first().innerText();
    },
    /**
     * drag <role> <name...> <dx> <dy>: pointer drag starting at the element's center.
     * Knobs: negative dy (up) increases. Sliders: they jump to the press point first.
     */
    async drag(words) {
      const dx = Number(words.at(-2));
      const dy = Number(words.at(-1));
      const box = await byRole(words.slice(0, -2)).boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y + (dy * i) / 10);
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
    /** theme dark|light: the app is dark by default; light is <html data-theme="light">. */
    async theme([scheme]) {
      await page.evaluate((s) => (document.documentElement.dataset.theme = s), scheme);
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
    /** screenshot-element <name> <css selector...>: crop to one element. */
    async 'screenshot-element'([name, ...selector]) {
      const path = resolve(OUT, `${name}.png`);
      await page.locator(selector.join(' ')).first().screenshot({ path });
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
  const value = (name) => c.attr(['aria-valuetext', 'slider', name]);
  const undoTitle = () => c.attr(['title', 'button', 'Undo']);

  await c.goto([]);
  check((await c.status()).startsWith('Audio off'), 'audio starts off');
  await c.screenshot(['1-initial']);

  await c.click(['button', 'Audio', 'off', '·', 'click', 'to', 'start']);
  await c['wait-text'](['Audio on']);
  check((await c.meter()) === 0, 'silent until a note plays');

  // Computer keyboard: A = C4 on the selected track (track 1).
  await c.keydown(['KeyA']);
  const held = await c.meter();
  check(held > 0.02, `holding A plays a note (meter ${held.toFixed(3)})`);
  await c.screenshot(['2-note']);
  await c.keyup(['KeyA']);
  await c.sleep(['700']);
  check((await c.meter()) === 0, 'releasing A stops the note');

  // Preset editor, rendered from the chip synth's descriptor.
  await c.click(['radio', 'Tri']);
  check((await c.attr(['aria-checked', 'radio', 'Tri'])) === 'true', 'wave switches to triangle');
  check((await undoTitle()).startsWith('Undo Change Wave'), 'wave change is undoable');
  const attack = await value('Attack');
  await c.drag(['slider', 'Attack', '0', '-60']);
  check(
    (await value('Attack')) !== attack,
    `attack knob drag ${attack} -> ${await value('Attack')}`,
  );
  check((await undoTitle()).startsWith('Undo Change Attack'), 'knob drag is one undo step');
  await c.press(['Control+z']);
  check((await value('Attack')) === attack, 'Ctrl+Z restores attack');
  await c.press(['Control+z']);
  check((await c.attr(['aria-checked', 'radio', '50%'])) === 'true', 'Ctrl+Z restores wave');

  // Octave keys.
  await c.press(['KeyX']);
  check((await c.text(['.keys'])).includes('C5'), 'X raises the keyboard octave');
  await c.press(['KeyZ']);
  check((await c.text(['.keys'])).includes('C4'), 'Z lowers it again');

  // Master fader while a note is held.
  await c.keydown(['KeyA']);
  const before = await c.meter();
  await c.drag(['slider', 'Master', '200', '0']);
  check((await value('Master')) === '100%', `master fader drag 80% -> ${await value('Master')}`);
  check((await c.meter()) > before, 'meter rises with master volume');
  await c.keyup(['KeyA']);
  check((await undoTitle()).startsWith('Undo Change master volume'), 'fader drag is one undo step');
  await c.press(['Control+z']);
  check((await value('Master')) === '80%', 'Ctrl+Z restores 80%');

  // Tracks.
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
  check((await c.text(['.preset-editor .track-name'])) === 'Track 3', 'editor follows the track');
  await c.keydown(['KeyA']);
  check((await c.meter()) > 0.02, 'notes play on the newly selected track');
  await c.keyup(['KeyA']);

  // MIDI (permission granted by the driver; there are no devices in a headless browser).
  await c.select(['MIDI', 'input', '|', 'Enable', 'MIDI…']);
  await c.sleep(['1000']);
  const midi = await c.eval(["document.querySelector('.midi-select').selectedOptions[0].text"]);
  check(/^MIDI: (no devices|all inputs)$/.test(JSON.parse(midi)), `MIDI can be enabled (${midi})`);

  await c.screenshot(['3-editor']);
  await c.theme(['light']);
  await c.screenshot(['4-light']);

  const errors = await c.errors();
  check(errors === 'none', `no console errors (${errors})`);
  console.log(`
Screenshots in ${OUT}`);
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: Number(option('--scale', '1')),
  });
  await context.grantPermissions(['midi', 'midi-sysex']);
  const page = await context.newPage();
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
