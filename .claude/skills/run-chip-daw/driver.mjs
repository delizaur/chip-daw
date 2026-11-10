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
    /**
     * midi <byte> <byte> ...: sends a message from the fake MIDI keyboard (decimal or 0x hex),
     * e.g. "midi 0x90 60 100" (note on C4) and "midi 0x80 60 0" (note off).
     */
    async midi(bytes) {
      await page.evaluate((data) => window.__fakeMidi(data), bytes.map(Number));
    },
    /** text <css selector...>: innerText of the first match. */
    async text(selector) {
      return page.locator(selector.join(' ')).first().innerText();
    },
    /**
     * click-at <css> <x> <y> [shift|alt]: click at a point relative to the element's top-left
     * (for the canvas timeline).
     */
    async 'click-at'([selector, x, y, modifier]) {
      const box = await page.locator(selector).first().boundingBox();
      const key = modifier ? { shift: 'Shift', alt: 'Alt' }[modifier] : undefined;
      if (key) await page.keyboard.down(key);
      await page.mouse.click(box.x + Number(x), box.y + Number(y));
      if (key) await page.keyboard.up(key);
    },
    async 'dblclick-at'([selector, x, y]) {
      const box = await page.locator(selector).first().boundingBox();
      await page.mouse.dblclick(box.x + Number(x), box.y + Number(y));
    },
    /** drag-at <css> <x1> <y1> <x2> <y2>: pointer drag between element-relative points. */
    async 'drag-at'([selector, x1, y1, x2, y2]) {
      const box = await page.locator(selector).first().boundingBox();
      const from = { x: box.x + Number(x1), y: box.y + Number(y1) };
      const to = { x: box.x + Number(x2), y: box.y + Number(y2) };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(
          from.x + ((to.x - from.x) * i) / 10,
          from.y + ((to.y - from.y) * i) / 10,
        );
      }
      await page.mouse.up();
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
    /** meter-max <ms>: highest meter level seen while polling for <ms> (timing-tolerant). */
    async 'meter-max'([ms = '1000']) {
      let max = 0;
      for (let waited = 0; waited < Number(ms); waited += 30) {
        max = Math.max(max, await meter());
        await page.waitForTimeout(30);
      }
      return max;
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
    /**
     * export-file <path>: clicks Export and saves the .chip download to <path>. The native save
     * picker can't be driven headless, so it's disabled first and the app falls back to a download.
     */
    async 'export-file'([path]) {
      await page.evaluate(() => (window.showSaveFilePicker = undefined));
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await (await download).saveAs(resolve(ROOT, path));
      return resolve(ROOT, path);
    },
    /**
     * export-wav <path>: clicks Export WAV and saves the rendered file to <path>. Waits for the
     * render (download fallback, like export-file). Prints the WAV's format and length.
     */
    async 'export-wav'([path]) {
      await page.evaluate(() => (window.showSaveFilePicker = undefined));
      const download = page.waitForEvent('download', { timeout: 60000 });
      await page.getByRole('button', { name: 'Export WAV', exact: true }).click();
      const file = resolve(ROOT, path);
      await (await download).saveAs(file);
      const { readFileSync } = await import('node:fs');
      const wav = readFileSync(file);
      const rate = wav.readUInt32LE(24);
      const bits = wav.readUInt16LE(34);
      const channels = wav.readUInt16LE(22);
      const seconds = wav.readUInt32LE(40) / (rate * channels * (bits / 8));
      return `${wav.toString('ascii', 0, 4)} ${rate} Hz ${bits}-bit ${channels} ch, ${seconds.toFixed(2)} s`;
    },
    /** download <path> <button name...>: clicks a button and saves the file it downloads. */
    async download([path, ...name]) {
      await page.evaluate(() => (window.showSaveFilePicker = undefined));
      const download = page.waitForEvent('download', { timeout: 60000 });
      await page.getByRole('button', { name: name.join(' '), exact: true }).click();
      await (await download).saveAs(resolve(ROOT, path));
      return resolve(ROOT, path);
    },
    /** upload <path> <button name...>: clicks a button that opens a file dialog and picks <path>. */
    async upload([path, ...name]) {
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: name.join(' '), exact: true }).click();
      await (await chooser).setFiles(resolve(ROOT, path));
    },
    /** type <text...>: types into the focused element (e.g. an inline rename box). */
    async type(words) {
      await page.keyboard.type(words.join(' '));
    },
    /** import-file <path>: clicks Import and picks <path> in the file dialog. */
    async 'import-file'([path]) {
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Import', exact: true }).click();
      await (await chooser).setFiles(resolve(ROOT, path));
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
  // textContent: the label is styled uppercase, which innerText would apply.
  const editorText = async (part) =>
    JSON.parse(
      await c.eval([`document.querySelector('.preset-editor .${part}').textContent.trim()`]),
    );
  check((await editorText('kind')) === 'Track 3 preset', 'editor follows the track');
  await c.keydown(['KeyA']);
  check((await c.meter()) > 0.02, 'notes play on the newly selected track');
  await c.keyup(['KeyA']);

  // Preset chain on track 3: add, replace, bypass, move, remove boxes; effects and the arp sound.
  const chain = async () =>
    JSON.parse(
      await c.eval([
        "(() => { const p = chipDaw.session.selectedTrackPreset; return [...p.sequencers, p.synth, ...p.effects].map(b => b.type + (b.bypassed ? '(off)' : '')).join(' '); })()",
      ]),
    );
  await c.select(['Add', 'effect', '|', 'Delay']);
  check((await chain()) === 'synth.chip fx.delay', `"+ Effect" adds a delay (${await chain()})`);
  check((await undoTitle()).startsWith('Undo Add Delay'), 'adding a box is undoable');
  await c.sleep(['600']);
  await c.keydown(['KeyA']);
  await c.sleep(['80']);
  await c.keyup(['KeyA']);
  await c.sleep(['250']); // the dry note has died away (100 ms release); the echo is at 375 ms
  const echo = await c['meter-max'](['400']);
  check(echo > 0.005, `the delay echoes after the note (meter ${echo.toFixed(3)})`);
  await c.select(['Delay', 'type', '|', 'Reverb']);
  check((await chain()) === 'synth.chip fx.reverb', 'the type menu replaces a box');
  await c.click(['button', 'Reverb', 'on']);
  check((await chain()) === 'synth.chip fx.reverb(off)', 'the power button bypasses a box');
  await c.select(['Add', 'effect', '|', 'Filter']);
  await c.click(['button', 'Move', 'Filter', 'left']);
  check((await chain()) === 'synth.chip fx.filter fx.reverb(off)', 'boxes can be moved');
  await c.select(['Add', 'sequencer', '|', 'Arpeggiator']);
  check((await chain()).startsWith('seq.arp synth.chip'), '"+ Sequencer" adds an arpeggiator');
  await c.keydown(['KeyA']);
  const arpLevel = await c['meter-max'](['500']);
  await c.keyup(['KeyA']);
  check(arpLevel > 0.02, `notes play through the arpeggiator (meter ${arpLevel.toFixed(3)})`);
  for (const name of ['Arpeggiator', 'Filter', 'Reverb']) await c.click(['button', 'Remove', name]);
  check((await chain()) === 'synth.chip', 'boxes can be removed');
  // Other synth engines: the synth's type menu swaps it.
  await c.select(['Chip', 'type', '|', 'FM']);
  check((await chain()) === 'synth.fm', `the synth can be swapped for FM (${await chain()})`);
  await c['click-at'](['.timeline-canvas', '2', '10']); // focus off the menu (keys play again)
  await c.sleep(['300']);
  await c.keydown(['KeyA']);
  const fmLevel = await c['meter-max'](['400']);
  await c.keyup(['KeyA']);
  check(fmLevel > 0.02, `the FM synth plays (meter ${fmLevel.toFixed(3)})`);
  await c.select(['FM', 'type', '|', 'Chip']);
  check((await chain()) === 'synth.chip', 'and back to Chip');
  await c.sleep(['600']);

  // Recording, clip editing and playback (track 3 is selected at this point). The timeline
  // canvas has a 24 px ruler, 56 px lanes and 112 px per bar at the default zoom.
  const clips = async () =>
    JSON.parse(
      await c.eval([
        'chipDaw.session.project.tracks.flatMap((t, i) => t.clips.map(c => `${i}:${c.startTick}+${c.lengthTicks}/${c.notes.length}`))',
      ]),
    ).join(' ');
  await c.click(['button', 'Record']);
  await c.click(['button', 'Play']);
  // Recording from a stop counts in 4 beats (2 s at 120 BPM) first.
  await c.sleep(['300']);
  const countIn = JSON.parse(
    await c.eval(['[chipDaw.session.countIn, chipDaw.session.position, chipDaw.session.playing]']),
  );
  check(
    countIn[0] >= 3 && countIn[1] === 0 && countIn[2] === false,
    `Play with Record armed counts in first (${JSON.stringify(countIn)})`,
  );
  check(
    /^[1-4]$/.test(await c.text(['.count-in'])),
    `the count-in shows the beats left (${await c.text(['.count-in'])})`,
  );
  await c.sleep(['1900']);
  check(
    JSON.parse(await c.eval(['chipDaw.session.playing'])) === true,
    'recording starts after the count-in',
  );
  await c.sleep(['200']);
  await c.keydown(['KeyA']);
  await c.sleep(['300']);
  await c.keyup(['KeyA']);
  await c.sleep(['200']);
  await c.click(['button', 'Pause']);
  await c.click(['button', 'Record']);
  let now = await clips();
  // The clip spans exactly the recorded time (~0.7 s ≈ 1300 ticks), not a whole bar.
  const recorded = /^2:0\+(\d+)\/1$/.exec(now);
  const length = Number(recorded?.[1]);
  check(
    !!recorded && length > 600 && length < 3840,
    `recording makes a clip of the recorded length (${now})`,
  );
  check((await undoTitle()).startsWith('Undo Record'), 'the take is one undo step');

  await c['drag-at'](['.timeline-canvas', '20', '164', '132', '220']);
  now = await clips();
  check(
    now === `3:3840+${length}/1`,
    `dragging moves the clip a bar later and a track down (${now})`,
  );
  await c.press(['Control+d']);
  now = await clips();
  check(
    now === `3:3840+${length}/1 3:${3840 + length}+${length}/1`,
    `Ctrl+D duplicates right after it (${now})`,
  );
  await c.press(['Delete']);
  check((await clips()) === `3:3840+${length}/1`, 'Delete removes the selected clip');
  await c.press(['Control+z']);
  check((await clips()).split(' ').length === 2, 'Ctrl+Z restores it');

  await c['click-at'](['.timeline-canvas', '112', '10']); // ruler at bar 2
  await c.press(['Space']);
  const level = await c['meter-max'](['1000']);
  await c.press(['Space']);
  check(level > 0.02, `Space plays the recorded clip back (meter ${level.toFixed(3)})`);

  // Clip presets: a recorded clip keeps its sound. The two clips on track 4 were recorded on
  // track 3, so they share track 3's preset. Summary per preset: "name/wave/effects", for the
  // track 3 preset, the track 4 preset, then each clip on track 4.
  const presets = async () =>
    JSON.parse(
      await c.eval([
        "(() => { const p = chipDaw.session.project; const d = id => { const x = p.presets.find(q => q.id === id); return `${x.name}/${x.synth.params.wave}/${x.effects.map(e => e.type).join('+')}`; }; return [d(p.tracks[2].presetId), d(p.tracks[3].presetId), ...p.tracks[3].clips.map(c => d(c.presetId))].join(' | '); })()",
      ]),
    );
  const editorKind = () => editorText('kind');
  await c.press(['3']);
  check(
    (await editorText('usage')).includes('2 clips'),
    `the track preset says clips use it (${await editorText('usage')})`,
  );
  await c.select(['Add', 'effect', '|', 'Bitcrush']);
  let ps = await presets();
  check(
    ps === 'Init 2/2/fx.bitcrush | Init/2/ | Init/2/ | Init/2/',
    `editing a track preset that clips use makes a copy; the clips keep theirs (${ps})`,
  );
  check(
    (await c.text(['.notice'])).includes('Track 3 now plays a copy'),
    'a notice explains the copy',
  );
  await c['click-at'](['.timeline-canvas', '120', '220']); // first clip on track 4
  check((await editorKind()) === 'Clip preset', 'selecting a clip shows its clip preset');
  check(
    (await editorText('usage')) === 'Used by 2 clips',
    `the clip preset says how many clips use it (${await editorText('usage')})`,
  );
  // What an edit would change is highlighted: both clips (they share the preset), no track.
  const reach = async () =>
    JSON.parse(
      await c.eval([
        "(() => { const r = chipDaw.session.presetReach; const headers = [...document.querySelectorAll('.lane-header.affected .name')].map(e => e.textContent).join(','); return `${r.clipIds.size} clips; ${headers}`; })()",
      ]),
    );
  check(
    (await reach()) === '2 clips; ',
    `both clips sharing the preset are highlighted (${await reach()})`,
  );
  await c.click(['button', 'Make', 'unique']);
  await c.click(['radio', 'Noise']);
  ps = await presets();
  check(
    ps === 'Init 2/2/fx.bitcrush | Init/2/ | Init 3/4/ | Init/2/',
    `Make unique, then editing changes only that clip (${ps})`,
  );
  await c.click(['button', 'Use', 'track', 'preset']);
  ps = await presets();
  check(ps.endsWith('| Init/2/ | Init/2/ | Init/2/'), `Use track preset (${ps})`);
  check(
    (await c.attr(['disabled', 'button', 'Use', 'track', 'preset'])) !== null,
    'Use track preset is disabled once the clip uses it',
  );
  await c.press(['Control+z']);
  await c.click(['button', 'Load', 'to', 'track']);
  ps = await presets();
  check(ps.startsWith('Init 2/2/fx.bitcrush | Init 3/4/ | Init 3/4/'), `Load to track (${ps})`);
  check(
    (await reach()) === '1 clips; Track 4',
    `the track whose preset it now is gets highlighted too (${await reach()})`,
  );
  await c.click(['button', 'Show', 'track', 'preset']);
  check((await editorKind()) === 'Track 4 preset', 'the back button shows the track preset');
  check(
    (await reach()) === '0 clips; Track 4',
    `a track preset edit highlights only its track (${await reach()})`,
  );
  await c.screenshot(['3-arrangement']);

  // Piano roll: double-click an empty lane (track 6, bar 1) to create a clip, then double-click
  // the clip to open it.
  const lane6 = String(24 + 56 * 5 + 28);
  await c['dblclick-at'](['.timeline-canvas', '20', lane6]);
  await c['dblclick-at'](['.timeline-canvas', '20', lane6]);
  check(
    (await c.attr(['aria-selected', 'tab', 'Piano', 'roll'])) === 'true',
    'double-clicking a clip opens the piano roll',
  );
  // The view is fitted to the one-bar clip; compute note coordinates like fitView does.
  const [rollWidth, rollHeight] = JSON.parse(
    await c.eval([
      "(() => { const r = document.querySelector('.piano-roll-canvas').getBoundingClientRect(); return [r.width, r.height]; })()",
    ]),
  );
  const ppt = (rollWidth - 44 - 24) / 3840;
  const top = 66 + Math.floor(Math.floor((rollHeight - 76) / 12) / 2);
  const X = (tick) => String(Math.round(56 + tick * ppt));
  const Y = (pitch) => String(20 + (top - pitch) * 12 + 6);
  const notes = async () =>
    JSON.parse(
      await c.eval([
        'chipDaw.session.editing.clip.notes.map(n => `${n.tick}+${n.durationTicks}:${n.pitch}@${n.velocity}`).join(" ")',
      ]),
    );
  await c['drag-at'](['.piano-roll-canvas', String(Number(X(0)) + 2), Y(60), X(960), Y(60)]);
  await c['click-at'](['.piano-roll-canvas', String(Number(X(960)) + 2), Y(64)]);
  let now2 = await notes();
  check(
    now2 === '0+960:60@100 960+960:64@100',
    `drawing adds notes; drag sets the length (${now2})`,
  );
  check((await undoTitle()).startsWith('Undo Add note'), 'each drawn note is one undo step');
  await c['drag-at']([
    '.piano-roll-canvas',
    String(Number(X(960)) + 20),
    Y(64),
    String(Number(X(960)) + 20),
    Y(67),
  ]);
  now2 = await notes();
  check(now2.endsWith('960+960:67@100'), `dragging a note moves its pitch (${now2})`);
  await c['drag-at']([
    '.piano-roll-canvas',
    String(Number(X(960)) - 2),
    Y(60),
    String(Number(X(1920)) - 2),
    Y(60),
  ]);
  now2 = await notes();
  check(now2.startsWith('0+1920:60'), `dragging a note's end resizes it (${now2})`);
  await c['click-at'](['.piano-roll-canvas', String(Number(X(0)) + 1), String(rollHeight - 14)]);
  now2 = await notes();
  check(/^0\+1920:60@([1-9]|[1-3]\d)\b/.test(now2), `the velocity lane sets velocity (${now2})`);
  await c.press(['Control+a']);
  await c.press(['ArrowUp']);
  now2 = await notes();
  check(now2.includes(':61@') && now2.includes(':68@'), `↑ transposes the selection (${now2})`);
  await c.press(['Delete']);
  check((await notes()) === '', 'Delete removes the selected notes');
  await c.press(['Control+z']);
  check((await notes()).split(' ').length === 2, 'Ctrl+Z brings them back');
  await c['dblclick-at'](['.piano-roll-canvas', String(Number(X(960)) + 20), Y(68)]);
  check((await notes()).split(' ').length === 1, 'double-clicking a note deletes it');
  await c['click-at'](['.timeline-canvas', '2', '10']); // playhead to the start
  await c.sleep(['600']); // let note auditions from the edits above fade
  const idle = await c['meter-max'](['400']);
  check(idle === 0, `nothing sounds while stopped (meter ${idle.toFixed(3)})`);
  await c.press(['Space']);
  const rollLevel = await c['meter-max'](['800']);
  await c.press(['Space']);
  check(rollLevel > 0.005, `drawn notes play back (meter ${rollLevel.toFixed(3)})`);

  // Automation: the Lane menu turns the bottom lane into a param's automation (96 px tall);
  // a click inside the clip adds a point.
  await c.select(['Lane', '|', 'Level']);
  await c['click-at'](['.piano-roll-canvas', X(960), String(rollHeight - 40)]);
  const lanes = JSON.parse(
    await c.eval([
      "chipDaw.session.editing.clip.automation.map(l => `${l.paramId}:${l.points.map(p => p.tick).join(',')}`).join(' ')",
    ]),
  );
  check(lanes === 'level:960', `clicking the Level lane adds an automation point (${lanes})`);
  const marked = JSON.parse(
    await c.eval(["document.querySelector('[aria-label=Lane]').selectedOptions[0].text"]),
  );
  check(marked === '● Level', `the Lane menu marks automated params (${marked})`);
  check((await undoTitle()).startsWith('Undo Add automation point'), 'adding a point is undoable');
  await c.press(['Control+z']);
  await c.select(['Lane', '|', 'Velocity']);
  await c.screenshot(['4-piano-roll']);

  // The key left of 1 turns the keyboard piano off; its letter keys become shortcuts. Now:
  // track 4 has two clips side by side from bar 2, track 6 a clip at bar 1.
  const state = async (expr) => JSON.parse(await c.eval([expr]));
  const selection = () =>
    state(
      '[...chipDaw.session.selectedClipIds].map(id => { const t = chipDaw.session.project.tracks.findIndex(t => t.clips.some(c => c.id === id)); const c = chipDaw.session.project.tracks[t].clips.find(c => c.id === id); return `${t}:${c.startTick}`; }).join(" ")',
    );
  await c['click-at'](['.timeline-canvas', '2', '10']); // playhead to the start, focus off buttons
  await c.press(['Backquote']);
  check(
    (await c.attr(['aria-pressed', 'button', 'Computer', 'keyboard', 'piano'])) === 'false',
    'the key left of 1 turns the keyboard piano off',
  );
  await c.keydown(['KeyS']);
  check((await c.meter()) === 0, 'with the piano off, letter keys play nothing');
  await c.keyup(['KeyS']);
  for (const [key, name] of [
    ['m', 'Metronome'],
    ['o', 'Overdub'],
    ['r', 'Record'],
    ['l', 'Loop'],
  ]) {
    await c.press([key]);
    const on = await c.attr(['aria-pressed', 'button', name]);
    await c.press([key]);
    const off = await c.attr(['aria-pressed', 'button', name]);
    check(on === 'true' && off === 'false', `${key.toUpperCase()} toggles ${name}`);
  }
  await c.press(['Escape']);
  await c.press(['4']);
  await c.press(['ArrowRight']);
  check((await selection()) === '3:3840', 'an arrow selects the clip closest to the playhead');
  await c.press(['ArrowRight']);
  const second = await selection();
  check(/^3:\d+$/.test(second) && second !== '3:3840', `→ selects the next clip (${second})`);
  await c.press(['ArrowLeft']);
  check((await selection()) === '3:3840', '← selects the previous clip');
  await c.press(['ArrowDown']);
  check((await selection()) === '5:0', '↓ selects the nearest clip on a lower track');
  await c.press(['ArrowUp']);
  check((await selection()) === '3:3840', '↑ goes back up');

  const pos = () => state('chipDaw.session.position');
  const secondStart = Number(second.split(':')[1]);
  await c.press(['Home']);
  await c.press(['d']);
  check((await pos()) === 3840, 'D jumps to the start of the next clip');
  await c.press(['d']);
  check(
    (await pos()) === secondStart && (await selection()) === '3:3840',
    'D again jumps to the end of the clip',
  );
  await c.press(['d']);
  check(
    (await pos()) === secondStart && (await selection()) === second,
    'at a clip end, D selects the next clip (it starts right there)',
  );
  await c.press(['a']);
  check(
    (await pos()) === secondStart && (await selection()) === '3:3840',
    'A selects the previous clip (it ends right there)',
  );
  await c.press(['a']);
  check((await pos()) === 3840, 'A again jumps to the start of the clip');

  await c.press(['Enter']);
  check(
    (await c.attr(['aria-selected', 'tab', 'Piano', 'roll'])) === 'true' &&
      (await state('chipDaw.session.editing.clip.startTick')) === 3840,
    'Enter opens the selected clip in the piano roll',
  );
  await c.click(['tab', 'Preset']);
  await c['click-at'](['.timeline-canvas', '120', '220']); // the first clip on track 4
  await c.press(['Backquote']); // clicking moved focus; the piano is still off
  await c.press(['Backquote']);
  const clipPreset = () =>
    state(
      '(() => { const t = chipDaw.session.project.tracks[3]; return [t.clips[0].presetId === t.presetId, chipDaw.session.project.presets.find(p => p.id === t.clips[0].presetId).name]; })()',
    );
  check((await clipPreset())[0] === true, 'the first clip uses the track 4 preset');
  await c.press(['u']);
  let cp = await clipPreset();
  check(cp[0] === false, `U makes the clip preset unique (${cp[1]})`);
  await c.press(['p']);
  check((await clipPreset())[0] === true, 'P uses the track preset again');
  await c.press(['t']);
  check(
    (await c.text(['.notice'])).includes('already the Track 4 preset'),
    'T explains when there is nothing to load',
  );
  await c.press(['ArrowRight']);
  await c.press(['t']);
  cp = await state(
    '(() => { const t = chipDaw.session.project.tracks[3]; return t.presetId === t.clips[1].presetId; })()',
  );
  check(cp === true, 'T loads the clip preset to the track');
  await c.press(['Backquote']);
  await c.keydown(['KeyA']);
  check((await c.meter()) > 0.02, 'the key left of 1 turns the keyboard piano back on');
  await c.keyup(['KeyA']);
  await c.sleep(['400']);

  // Loop: the button shows markers over bars 1-4 on the ruler; dragging the end marker (bar 5,
  // x = 448) to bar 3 (x = 224) makes a two-bar loop that playback keeps jumping back into.
  const loopRegion = () => state('chipDaw.session.project.loop');
  await c.press(['Home']); // also scrolls the timeline back to the start (the x values below)
  await c.click(['button', 'Loop']);
  check(
    (await c.attr(['aria-pressed', 'button', 'Loop'])) === 'true',
    'the Loop button toggles on',
  );
  check(
    JSON.stringify(await loopRegion()) === '{"startTick":0,"endTick":15360}',
    'the loop starts as the first four bars',
  );
  await c['drag-at'](['.timeline-canvas', '448', '10', '224', '10']);
  check(
    JSON.stringify(await loopRegion()) === '{"startTick":0,"endTick":7680}',
    `dragging the end marker moves the loop end (${JSON.stringify(await loopRegion())})`,
  );
  check((await undoTitle()).startsWith('Undo Move loop'), 'a marker drag is one undo step');
  await c.press(['Space']);
  await c.sleep(['4500']); // two bars take 4 s at 120 BPM
  const looped = await pos();
  await c.press(['Space']);
  check(
    looped > 0 && looped < 7680,
    `playback jumps back to the loop start (${Math.round(looped)})`,
  );
  await c.screenshot(['5-loop']);
  await c.click(['button', 'Loop']);
  check(
    (await c.attr(['aria-pressed', 'button', 'Loop'])) === 'false',
    'the Loop button toggles off',
  );

  // Files: export, start a new project, import it back; autosave survives a reload.
  await c['export-file'](['tmp/run-chip-daw/smoke.chip']);
  const exported = JSON.parse(
    (await import('node:fs')).readFileSync(resolve(ROOT, 'tmp/run-chip-daw/smoke.chip'), 'utf8'),
  );
  const exportedClips = exported.tracks.reduce((sum, t) => sum + t.clips.length, 0);
  check(exportedClips === 3, `Export writes the project (${exportedClips} clips)`);
  await c.click(['button', 'New']);
  check((await clips()) === '', 'New starts an empty project');
  await c['import-file'](['tmp/run-chip-daw/smoke.chip']);
  await c.sleep(['300']);
  check((await clips()).split(' ').length === 3, 'Import restores the clips');
  check(
    JSON.parse(await c.eval(['chipDaw.session.project.name'])) === 'smoke',
    'the project is named after the file',
  );
  await c.sleep(['1200']); // autosave runs 0.8 s after the last change
  await c.goto([]);
  await c.sleep(['500']);
  check((await clips()).split(' ').length === 3, 'reloading restores the autosaved project');

  // Preset library (a fresh browser gets the starter presets) and WAV export.
  const trackPreset = async () =>
    JSON.parse(await c.eval(['chipDaw.session.selectedTrackPreset.name']));
  await c.press(['1']);
  await c.click(['button', 'Open', 'Bass']);
  await c.click(['button', 'Triangle', 'bass']);
  await c.click(['button', 'Load', 'to', 'Track', '1']);
  check((await trackPreset()) === 'Triangle bass', 'a library preset loads onto the track');
  check((await undoTitle()).startsWith('Undo Load Triangle bass'), 'loading a preset is undoable');
  await c.click(['button', 'Save', 'Track', '1', 'preset']);
  const libraryNames = async () =>
    JSON.parse(
      await c.eval([
        "[...document.querySelectorAll('.library .preset .label')].map(e => e.textContent).join(', ')",
      ]),
    );
  check(
    (await libraryNames()) === 'FM bass, FM slap bass, Pulse bass, Triangle bass, Triangle bass',
    `the track's preset saves into the library (${await libraryNames()})`,
  );
  await c.click(['button', 'Rename', 'preset']);
  await c.type(['Deep bass']);
  await c.press(['Enter']);
  check((await libraryNames()).includes('Deep bass'), 'library presets can be renamed');
  await c.download(['tmp/run-chip-daw/deep-bass.chippreset', 'Export', 'preset']);
  const presetFile = JSON.parse(
    (await import('node:fs')).readFileSync(
      resolve(ROOT, 'tmp/run-chip-daw/deep-bass.chippreset'),
      'utf8',
    ),
  );
  check(presetFile.preset?.name === 'Deep bass', 'a library preset exports as .chippreset');
  await c.click(['button', 'Delete', 'preset']);
  check(!(await libraryNames()).includes('Deep bass'), 'library presets can be deleted');
  await c.upload(['tmp/run-chip-daw/deep-bass.chippreset', 'Import', 'preset']);
  await c.sleep(['300']);
  check(
    (await libraryNames()).includes('Deep bass'),
    'a .chippreset file imports into the library',
  );
  const wav = await c['export-wav'](['tmp/run-chip-daw/smoke.wav']);
  check(/^RIFF 44100 Hz 16-bit 2 ch, [1-9]/.test(wav), `the song exports as WAV (${wav})`);

  // MIDI, through the driver's fake keyboard.
  await c.select(['MIDI', 'input', '|', 'Enable', 'MIDI…']);
  await c.sleep(['500']);
  const midi = await c.eval(["document.querySelector('.midi-select').selectedOptions[0].text"]);
  check(JSON.parse(midi) === 'MIDI: all inputs', `MIDI can be enabled (${midi})`);
  await c.sleep(['600']); // let earlier sounds fade
  await c.midi(['0x90', '72', '110']);
  const midiLevel = await c['meter-max'](['400']);
  check(midiLevel > 0.02, `a MIDI note plays (meter ${midiLevel.toFixed(3)})`);
  const led = await c.attr(['title', 'img', 'MIDI', 'activity']);
  check(
    led === 'Last MIDI message: Note on C5 vel 110 · ch 1 (Fake MIDI keyboard)',
    `the activity light shows the message (${led})`,
  );
  await c.midi(['0x80', '72', '0']);
  await c.sleep(['500']);
  check((await c['meter-max'](['200'])) === 0, 'MIDI note-off stops it');
  await c.select(['MIDI', 'input', '|', 'MIDI', 'off']);
  await c.midi(['0x90', '72', '110']);
  check((await c['meter-max'](['300'])) === 0, "selecting 'MIDI off' ignores the keyboard");

  await c.theme(['light']);
  await c.screenshot(['6-light']);

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
  // A fake MIDI keyboard replaces Web MIDI: an automated browser doesn't receive messages from
  // real devices (verified with a real keyboard), so tests play through this instead (`midi`).
  await context.addInitScript(() => {
    const input = {
      id: 'fake-keyboard',
      name: 'Fake MIDI keyboard',
      manufacturer: 'chip-daw tests',
      type: 'input',
      state: 'connected',
      connection: 'open',
      onmidimessage: null,
      open: async () => input,
      close: async () => input,
      addEventListener() {},
      removeEventListener() {},
    };
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map(),
      sysexEnabled: false,
      onstatechange: null,
      addEventListener() {},
      removeEventListener() {},
    };
    navigator.requestMIDIAccess = async () => access;
    window.__fakeMidi = (bytes) =>
      input.onmidimessage?.({ data: new Uint8Array(bytes), target: input, currentTarget: input });
  });
  const page = await context.newPage();
  const errors = [];
  page.on(
    'console',
    (m) => ['error', 'warning'].includes(m.type()) && errors.push(`[${m.type()}] ${m.text()}`),
  );
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('dialog', (dialog) => dialog.accept()); // e.g. "Start a new project?"
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
