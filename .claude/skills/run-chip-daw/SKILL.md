---
name: run-chip-daw
description: Build, run, and drive chip-daw (the browser DAW). Use when asked to start or run the app, take a screenshot of its UI, check that audio plays, click through the UI, verify the GitHub Pages build, or run its tests.
---

chip-daw is a Vite + Svelte web app whose audio engine runs in an AudioWorklet. Drive it with
`.claude/skills/run-chip-daw/driver.mjs`: it starts Vite in-process on a free port, opens headless,
**muted** Chrome via `playwright-core`, runs a smoke flow or your commands, saves screenshots, and
shuts everything down. All paths are relative to the repo root.

Verified on Windows 11 with Git Bash, Node 22, and installed Chrome/Edge. Linux/macOS not verified.

## Prerequisites

- Node 22+
- Google Chrome or Microsoft Edge installed (the driver uses the system browser; no
  `playwright install` needed). Any other Chromium: set `CHROME_PATH=/path/to/binary`.

## Setup

```bash
npm install
```

## Run (agent path)

End-to-end smoke check (~25 s). Prints PASS/FAIL lines, exits 1 on any failure:

```bash
node .claude/skills/run-chip-daw/driver.mjs smoke
```

It checks: audio starts on the first click; holding `A` plays a note (meter > 0) and releasing it
goes silent; the preset editor's wave selector and Attack knob change the synth as single undo
steps that Ctrl+Z restores; `X`/`Z` shift the keyboard octave; the master fader raises the meter and
undoes; mute toggles; key `3` selects track 3 and notes then play there; record + play + a held key
makes a clip exactly as long as the recording (one undo step); dragging the clip on the canvas
moves it a bar later and a track down; Ctrl+D duplicates, Delete deletes, Ctrl+Z restores; Space
plays the clip back; double-clicks create a clip and open it in the piano roll, where drawing,
moving, resizing, velocity, select-all + transpose, delete/undo and double-click-delete all work
and the notes play back; Export → New → Import round-trips the project and names it after the
file; a reload restores the autosave; MIDI can be enabled; and no console errors or HTTP ≥400
responses. Screenshots (`1-initial`, `2-note`, `3-arrangement`, `4-piano-roll`, `5-light`) land in
`tmp/run-chip-daw/` (gitignored). **Look at them.**

Same check against the production build served under `/chip-daw/`, exactly as GitHub Pages serves it
(rebuilds `dist/`):

```bash
node .claude/skills/run-chip-daw/driver.mjs smoke --prod
```

Custom flows: pipe commands to `script` mode. Each command's result is printed after `> command`:

```bash
node .claude/skills/run-chip-daw/driver.mjs script <<'EOF'
goto
click button Audio off · click to start
wait-text Audio on
keydown KeyA
meter
keyup KeyA
click radio Noise
drag slider Release 0 -60
attr aria-valuetext slider Release
text .keys
screenshot-element editor .preset-editor
errors
EOF
```

| command | what it does |
|---|---|
| `goto [path]` | load the app (waits for the Tracks panel) |
| `click <role> <name…>` | click by ARIA role + exact accessible name, e.g. `click button Mute Track 2` |
| `press <key>` | keyboard, e.g. `press Control+z`, `press 3` |
| `keydown <key>` / `keyup <key>` | hold / release a key; `keydown KeyA` plays C4 until `keyup KeyA` |
| `select <combobox name…> \| <option…>` | pick a `<select>` option, e.g. `select MIDI input \| Enable MIDI…` |
| `text <css…>` | innerText of the first match, e.g. `text .keys` (keyboard octave/velocity) |
| `click-at <css> <x> <y> [shift\|alt]` | click at a point relative to an element, e.g. `click-at .timeline-canvas 112 10` (ruler, bar 2) |
| `dblclick-at <css> <x> <y>` | double-click at a point (empty lane: creates a one-bar clip) |
| `drag-at <css> <x1> <y1> <x2> <y2>` | pointer drag between element-relative points (move/resize clips) |
| `meter-max <ms>` | highest meter level while polling for `<ms>`; use it to check playback without timing guesses |
| `drag <role> <name…> <dx> <dy>` | pointer drag from the element's center; knobs: negative dy = up = increase |
| `attr <attribute> <role> <name…>` | print an attribute, e.g. `attr aria-valuetext slider Master` |
| `wait-text <text…>` | wait up to 10 s for text to appear |
| `status` | audio status pill text (`Audio off · click to start` / `Audio on`) |
| `meter` | master meter level, linear peak 0..1 (after 300 ms settle) |
| `eval chipDaw.session…` | the app exposes `window.chipDaw = { session }`, e.g. `eval chipDaw.session.project.tracks[0].clips.length` |
| `eval <js…>` | evaluate JS in the page, print JSON |
| `theme dark\|light` | set `<html data-theme>` (dark is the default; waits for transitions) |
| `viewport <w> <h>` | resize |
| `sleep <ms>` | wait |
| `screenshot [name]` | save `tmp/run-chip-daw/<name>.png` |
| `screenshot-element <name> <css…>` | crop to one element, e.g. `screenshot-element fader .meter-fader` |
| `export-file <path>` | click Export and save the `.chip` download to `<path>` (relative to the repo) |
| `import-file <path>` | click Import and choose `<path>` in the file dialog |
| `errors` | console errors/warnings, page errors and HTTP ≥400 so far, or `none` |

Options: `--prod` (production build), `--url <url>` (drive an already-running server),
`--out <dir>` (screenshot dir), `--scale 2` (high-DPI screenshots for inspecting details).

Useful names: buttons `Audio off · click to start`, `Undo`, `Redo`, `Go to start`, `Play` (its
name becomes `Pause` while playing), `Record`, `Overdub`, `Metronome`, `Zoom in`, `Zoom out`,
`Mute Track N`, `Solo Track N`, `Select Track N`, `New`, `Import`, `Export`, `Quantize`,
`Quantize selected`, `Fit`; tabs `Preset`, `Piano roll`; radios (grid) `1/4`, `1/8`, `1/16`,
`1/32`; spinbutton `Tempo`; sliders `Master`, `Track N volume`, and the synth knobs `Attack`,
`Decay`, `Sustain`, `Release`, `Level`, `Transpose`, `Fine`; radios (wave) `12.5%`, `25%`, `50%`,
`Tri`, `Noise`, `Metal`; combobox `MIDI input`. Piano keys (physical): `KeyA`…`Semicolon` play
C4…E5, `KeyZ`/`KeyX` octave, `KeyC`/`KeyV` velocity, `Escape` releases all notes. Shortcuts:
`Space` play/pause, `Home` go to start, and on whichever editor was clicked last (piano roll →
notes, else clips): `Delete`/`Backspace`, `Control+a`, `Control+c`/`v`/`d`; in the piano roll
`ArrowUp`/`ArrowDown` transpose (Shift: octave), `ArrowLeft`/`ArrowRight` move by the grid.
`Control+s` export, `Control+o` import.

Timeline canvas (`.timeline-canvas`, default zoom): ruler `y` 0–24, track `N` (0-based) lane
centre `y = 24 + 56·N + 28`, `x = 112` px per bar (28 px per beat), so bar `B` (1-based) starts at
`x = 112·(B−1)`. Read clip state with `eval chipDaw.session.project.tracks.flatMap(...)`.

Piano roll canvas (`.piano-roll-canvas`, 1440×300 at the default viewport): it opens fitted to
the clip, so for a clip of `L` ticks with no notes, `x(tick) = 56 + tick·(W − 68)/L` (tick
relative to the clip start) and `y(pitch) = 20 + (top − pitch)·12 + 6` with
`top = 66 + floor(floor((H − 76)/12)/2)` (75 at 300 px), where `W×H` is the canvas size (get it
with `eval document.querySelector('.piano-roll-canvas').getBoundingClientRect()`). The velocity
lane is the bottom 56 px. Read notes with `eval chipDaw.session.editing.clip.notes`.

## Run (human path)

```bash
npm run dev    # http://localhost:5173. Audio starts on the first click.
```

If it was started in the background (not Ctrl+C in a terminal), stopping npm leaves Vite listening.
Kill the listener:

```bash
PID=$(netstat -ano | grep -E ":5173 .*LISTENING" | awk '{print $NF}' | head -1); taskkill //PID $PID //F
```

## Test

```bash
npm test         # Vitest: model, engine + synth (renders audio to buffers), input, UI maths.
npm run check    # svelte-check + tsc for the no-DOM core + vite config
npm run lint     # also enforces that src/model and src/engine never import ui/audio code
```

## Gotchas

- **Audio needs a user gesture.** The app starts audio on the first pointerdown/keydown, so a
  `click` must happen before `meter` shows anything. Headless Chrome runs the AudioWorklet fine.
- **The driver always passes `--mute-audio`.** Without it, a headless run plays notes through the
  machine's real speakers.
- **Read stdin before starting Vite/the browser.** In script mode, stdin arrived empty when read
  after `createServer()`/`chromium.launch()`. The driver reads it first; keep it that way.
- **Fixed ports collide.** Port 5199 was already taken by another program on the dev machine. The
  driver uses port 0 (any free port) and an in-process server, so nothing is left running. Don't
  switch it to `npm run dev &`: on Windows, stopping the npm wrapper leaves Vite listening
  (verified).
- **Git Bash rewrites `/chip-daw/`.** `BASE_PATH=/chip-daw/ npm run build` in Git Bash becomes a
  Windows path (Vite warns `"base" option should start with a slash`). Use `--prod`, which sets it
  in-process, or prefix `MSYS_NO_PATHCONV=1`.
- **Theme screenshots catch transitions.** Toggles animate colors for 80 ms; a screenshot right
  after switching theme shows washed-out grey buttons. The `theme` command waits 300 ms.
- **`drag` on a slider jumps first.** Sliders (track volume) jump to where the pointer lands, so
  `drag slider Track 1 volume 0 0` sets ~50%, and `drag slider Master 200 0` ends at 100%.
  Knobs move relative to the drag. For exact slider
  values, focus with a click and use `press ArrowLeft` / `ArrowRight` (1% steps).
- **Dark is the default theme, regardless of the OS setting.** `emulateMedia({ colorScheme })`
  does nothing; the light theme is `<html data-theme="light">`, which the `theme` command sets.
- **MIDI needs the `midi-sysex` permission in headless Chrome.** Granting only `midi` still
  rejects `requestMIDIAccess()` ("Permission to use Web MIDI API was not granted"), even though the
  app doesn't ask for sysex. The driver grants both. There are no MIDI devices headless, so the
  selector shows `MIDI: no devices`.
- **Closed `<select>` options aren't "visible".** `wait-text` on an option label times out; read
  `document.querySelector('.midi-select').selectedOptions[0].text` with `eval` instead.
- **Piano keys are ignored while a `<select>` or text field has focus** (so typing doesn't play
  notes). After `select …`, click something else before `keydown KeyA`.
- **The timeline is a canvas.** Clips have no DOM elements or accessible names; use the
  `*-at` commands with the coordinates above, then check results through `eval chipDaw.session…`.
- **Clicking an empty lane moves the playhead when stopped.** It's how you place the paste
  position (`click-at canvas 2 10` on the ruler also works). Paste goes to the selected track.
- **Recording records the selected track.** Record arm + Play, then hold keys; the clip appears
  as a red region with live notes while recording, and becomes a clip spanning exactly the
  recorded time when you press Pause (or disarm Record). Its length depends on timing, so check
  it with a range, not an exact tick count. `eval chipDaw.session.liveTake` shows the pass in
  progress.
- **Piano roll auditions ring for ~300 ms.** Clicking or dragging notes plays them (not
  recorded). Wait ~600 ms after editing before checking that the meter is silent.
- **Every run starts with empty storage.** Each driver run is a fresh browser context, so there's
  no autosave from earlier runs. Within one run, `goto` reloads the page and the autosave (written
  0.8 s after the last change) comes back.
- **Dialogs are auto-accepted** by the driver (e.g. "Start a new project?" on `New`).
- **Export needs the download fallback headless.** `export-file` sets
  `window.showSaveFilePicker = undefined` first; the native save picker can't be automated.
- **Screenshots right after a toggle show its color fading** (80 ms transition), e.g. the Play
  button still green with a ▶ icon just after pausing. Not a bug; `sleep 200` before the shot.
- **Reading the meter.** The raw level is `data-level` on `.top-bar .meter-fill` (the engine's
  linear peak over ~33 ms); the bar itself is drawn on a dB scale. One held default-preset note
  reads about 0.04. After the last note ends, the engine reports one 0 and then goes quiet, so
  `meter` returns exactly 0 when idle.

## Troubleshooting

- **`No browser found`**: neither Chrome nor Edge is installed. Install one, or set `CHROME_PATH`.
- **`npx playwright …` → "npx canceled due to missing packages"**: the full `playwright` package
  isn't installed. The driver only needs `playwright-core` (a devDependency) and a system browser.
- **svelte-check: `Could not find a declaration file for module './X.svelte'`**: the component
  has no `<script lang="ts">` block. Add one, even if it's empty.
