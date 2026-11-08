# Architecture

This document describes how chip-daw is built. For *what* it should be, see [design-principles.md](design-principles.md). For *when* things get built, see [ROADMAP.md](ROADMAP.md).

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) everywhere |
| Build | Vite |
| UI | Svelte 5 (runes) |
| Timeline / piano roll | `<canvas>` rendering; knobs and panels are DOM/SVG |
| Audio | Custom engine running inside a single `AudioWorkletProcessor` |
| State + undo | Immutable project model, mutated through Immer patches |
| Storage | IndexedDB (autosave, preset library); File System Access API for import/export with download/upload fallback |
| MIDI | Web MIDI API (desktop Chromium/Firefox, Android). Native plugin needed later for iPad |
| Mobile | PWA first, Capacitor for Android/iPad builds later |
| Tests | Vitest |
| Hosting | GitHub Pages (static build deployed by GitHub Actions) |

## Key decisions

| Topic | Decision |
|---|---|
| Views | Arrangement view only. A loop/live-recording workflow may come later, but it won't be a clone of Ableton's Session view. |
| Note editing | Recording + a piano roll editor. |
| Presets on tracks | Always **copies**. Editing a library preset never changes tracks, and editing a track's preset never changes the library. A copy remembers which library preset it came from (informational only). |
| Tracks and walls | A track is a sequence of **preset segments**. "One preset per track" is just a track with one segment. A wall is the boundary between two segments. |
| Voices | Synths are polyphonic (each engine declares a max voice count). |
| Undo/redo | Required. Every project mutation is undoable. |
| Audio export | WAV first, MP3 later. |
| Track count | Never hardcoded. New projects get `DEFAULT_TRACK_COUNT` tracks (currently 8, defined once in `src/model/`). After that, a project's `tracks.length` is authoritative: the engine, mixer and UI size themselves from it, so changing the default or allowing per-project counts later needs no structural changes. |
| Time | Everything in the project is stored in **musical ticks**, never seconds. `PPQ = 960`. Seconds only exist inside the engine, derived from the tempo map. |

## Process model

```
 Main thread                                   Audio thread (AudioWorklet)
┌───────────────────────────────┐            ┌──────────────────────────────┐
│ Svelte UI                     │            │ Engine                       │
│ Project store (source of truth)│──patches──▶│  model copy → runtime graph  │
│ Command / undo stack          │──transport─▶│  Transport (tick clock)      │
│ Web MIDI + computer keyboard  │──live notes▶│  N × TrackRuntime            │
│ Persistence (IndexedDB, files)│◀─playhead──│  Mixer → output               │
│                               │◀─meters────│  Recorder (captures notes/    │
│                               │◀─recorded──│   param moves, tick-stamped)  │
└───────────────────────────────┘            └──────────────────────────────┘
```

- The **main thread** owns the project. It is the only place the project is mutated.
- The **engine** keeps its own copy of the project model, kept in sync by the patches the store produces. From that copy it builds a *runtime graph* (voice pools, buffers, effect state) that it actually processes.
- The **engine is the clock authority**. Recording happens in the engine: incoming live notes and parameter changes are stamped with the current tick, compensated for output latency (`AudioContext.outputLatency`), and sent back to the main thread. When recording stops, the main thread commits them as one undoable command.
- Messages go over the worklet's `MessagePort`. The design deliberately does **not** depend on `SharedArrayBuffer`, because GitHub Pages can't send the COOP/COEP headers it requires. If it's ever needed (e.g. for meters), the options are `coi-serviceworker` or moving to Cloudflare Pages/Netlify.

### Message protocol (initial)

UI → engine:
- `loadProject(project)`: full snapshot (on open/import)
- `applyPatches(patches)`: Immer patches after every command, including undo/redo
- `play()` / `pause()` / `seek(tick)`: the transport (pause stops in place)
- `setRecord(armed)`: while armed and playing, live notes are captured into a take
- `setMetronome(enabled)`
- `setLatency(seconds)`: output latency, sent by the bridge once audio runs
- `noteOn(trackId, pitch, velocity, record?)` / `noteOff(trackId, pitch)`: live input (computer keyboard, MIDI); `record: false` for piano roll auditions
- `allNotesOff()`: releases everything (window blur, Escape, MIDI CC 120/123)

Knob moves during a gesture need no special message: each step is applied to the project immediately and reaches the engine as a normal patch. The transaction only affects how the steps are grouped for undo.

Engine → UI:
- `transport(playing, tick)`: ~30 Hz while playing, and on every transport change. The UI extrapolates between reports for a smooth playhead.
- `meters(masterPeak)` (per-track peaks later)
- `takeStarted(startTick)` and `takeNote(index, note, held)`: a recording pass started, and each note as it's played and released, so the timeline shows the take live.
- `recorded(take)`: when a recording pass ends (pause, seek, or record disarmed), even if empty, so the UI clears its live preview. Param-move recording comes with automation in Phase 4.

Messages sent while audio is still starting are queued if they are notes or transport commands; project patches are dropped because the engine starts from a fresh snapshot.

## Project data model

Sketch. The authoritative version lives in `src/model/types.ts`.

```ts
type Tick = number;               // PPQ = 960

interface Project {
  formatVersion: number;          // for migrations
  name: string;
  masterVolume: number;           // 0..1
  tempoMap: TempoMap;
  tracks: Track[];                // length = DEFAULT_TRACK_COUNT for new projects; never assume a fixed size
}

interface TempoMap {
  tempos: { tick: Tick; bpm: number; ramp: 'step' | 'linear' }[];   // ramp = how to reach the NEXT event
  meters: { tick: Tick; numerator: number; denominator: number; subdivision: number }[];
}

interface Track {
  id: string;
  name: string;
  volume: number;                 // 0..1
  mute: boolean;
  solo: boolean;
  segments: PresetSegment[];      // sorted by startTick; first one starts at 0
  clips: Clip[];
}

interface PresetSegment {         // the area between two walls
  id: string;
  startTick: Tick;                // segment lasts until the next segment's startTick
  preset: Preset;                 // a copy owned by this segment
}

interface Preset {
  id: string;
  name: string;
  libraryOrigin?: string;         // library preset it was copied from, if any
  sequencers: BoxInstance[];      // 0..n, applied in order
  synth: BoxInstance;             // exactly 1
  effects: BoxInstance[];         // 0..n, applied in order
}

interface BoxInstance {
  id: string;
  type: string;                   // registry key, e.g. "synth.pulse", "fx.bitcrush", "seq.arp"
  params: Record<string, number>; // all params are numbers (enums are stepped numbers)
}

interface AutomationLane {
  target: {
    boxId: string;                // box in the active segment's preset
    boxType: string;              // fallback for re-linking, e.g. "fx.bitcrush"
    boxIndex: number;             // nth box of that type in the preset (fallback)
  };
  paramId: string;
  points: { tick: Tick; value: number; curve: 'step' | 'linear' }[];  // relative to clip start
}

interface Clip {
  id: string;
  startTick: Tick;
  lengthTicks: Tick;
  notes: Note[];
  automation: AutomationLane[];   // moves with the clip
}

interface Note {
  id: string;
  tick: Tick;                     // relative to clip start
  durationTicks: Tick;
  pitch: number;                  // MIDI 0..127
  velocity: number;               // 1..127
}
```

Rules:
- **Notes and walls:** a note plays through the preset of the segment it *starts* in, and keeps sounding on that preset until its note-off and release tail end. Clips may cross walls freely.
- **Clips on the same track never overlap.** Dropping or resizing a clip over another trims the one underneath, as in Ableton's arrangement view.
- **Parameter automation lives in clips**, timed relative to the clip start, so moving, copying or inserting time moves automation with the music.
  - *Linking:* a lane targets a box by `boxId`. If the clip is played by a preset without that id (pasted onto another track, or moved across a wall), the lane re-links to the `boxIndex`-th box of the same `boxType`. Lanes with no match are kept but inactive (shown dimmed).
  - *Between clips:* a parameter **holds its last automated value** until the next automation point. At the start of each segment, it resets to that segment's preset value.
  - *Chasing:* on play/seek, the engine finds the most recent automation point before the playhead within the current segment. Playback therefore sounds the same no matter where it starts.
  - *Tempo* is the exception: it is song-level, stored in the `tempos` list (`linear` ramps for tempo automation).
- **Preset library** (folders, presets) is *not* part of the project. It lives in IndexedDB. Assigning a library preset to a track deep-copies it with fresh ids.

## Boxes

Sequencers, synths and effects are all "boxes". Each box type is registered once with a **descriptor** (in `src/model/boxes/`) that both the UI and the engine use:

```ts
interface BoxDescriptor {
  type: string;                   // "synth.chip"; stored in projects, so never rename one
  kind: 'sequencer' | 'synth' | 'effect';
  name: string;
  params: ParamDescriptor[];
}

interface ParamDescriptor {
  id: string;
  name: string;
  min: number; max: number; default: number;
  scale: 'linear' | 'exp';
  step?: number;                  // snap to multiples of this
  steps?: string[];               // enum params: labels, shown as a segmented selector
  unit?: 's' | '%' | 'st' | 'ct'; // display formatting
}
```

- The UI renders the preset editor (bottom panel) from descriptors, so a new box needs no UI code unless it wants a custom view. Enum params become segmented selectors, everything else a knob.
- Adding a box: write its descriptor in `src/model/boxes/`, add it to the registry there, and add the engine implementation to `src/engine/boxes/registry.ts`. Tests fail if any descriptor has no engine implementation, or has an invalid range or default.
- Params missing from a saved box fall back to the descriptor's default, so new params don't need a migration.
- Every param is automatable, because every param is a number with a known range.
- Any sequencer or effect can be **bypassed** (`BoxInstance.bypassed`): it's skipped but keeps its settings. The synth can be replaced but not removed or bypassed.
- Engine-side implementations (`src/engine/boxes/types.ts`), all given a shared `BlockContext` each block (tempo, ticks per sample, and a clock tick: the song position while playing, a free-running clock when stopped, so tempo-synced boxes keep time either way):
  - **Sequencer:** note events in (`noteOn`/`noteOff` with sample offsets, in time order) → note events out (`render` into a preallocated `BlockEvents`). Chained in order; the last one feeds the synth.
  - **Synth:** note events in → stereo audio out. Owns a preallocated voice pool with voice stealing (`VoicePool`: a free voice, else the oldest releasing one, else the oldest).
  - **Effect:** processes the track's stereo buffer in place, every block (so tails like delay and reverb keep ringing after notes end).
- **Boxes so far:**
  - `synth.chip` ("Chip"): NES-style pulse (12.5/25/50% duty, PolyBLEP band-limited), 4-bit stepped triangle, and 15-bit LFSR noise in long ("hiss") and short ("metal", pitched to the note) modes. 8 voices, ADSR (linear attack, exponential decay/release), level, transpose, fine tune.
  - `seq.arp` ("Arpeggiator"): cycles held notes up, down, up-down, randomly or in played order, over 1–4 octaves, at 1/32–1/4 (with triplets), each note lasting gate × step. Notes pressed at the same moment (a chord) are all in before it starts, so it starts from the first note of the pattern; later steps land on the grid (the song grid while playing). Releasing every key stops it at once. Works on live input and clip notes alike; recording captures the keys you play, not the arp's notes.
  - `fx.bitcrush` ("Bitcrush"): bit depth 1–16 plus sample-and-hold rate reduction, with dry/wet mix.
  - `fx.filter` ("Filter"): state-variable low/high/band-pass (Simper/Cytomics SVF), cutoff 30 Hz–18 kHz smoothed per block, resonance.
  - `fx.delay` ("Delay"): tempo-synced (1/32 to 1/2, dotted and triplet), mono or ping-pong, feedback through a low-pass "tone", wet level added to the dry signal. Up to 4 s.
  - `fx.reverb` ("Reverb"): Freeverb (8 damped combs + 4 allpasses per channel, stereo spread), size, damping, width, wet level added to the dry signal.
- **Chain changes and notes:** when the set of active sequencers changes (one added, removed, moved or bypassed), the track releases all its notes and resets its sequencers, so notes started through the old path can't get stuck. Boxes that stay keep their runtime and state (a reverb tail survives a knob change or reorder).

## Engine

- Lives in `src/engine/` as **pure TypeScript with no DOM or Web Audio dependencies**. The worklet is a thin wrapper around it. This means the same engine:
  - plays in real time inside the `AudioWorkletProcessor`,
  - renders offline in a Web Worker for WAV export (sounds exactly like playback),
  - renders to buffers in unit tests under Node.
- **Transport:** advances a tick position each block. The tempo is read once per block, so a tempo change lands at most 128 samples late (linear tempo ramps arrive with Phase 4). Note events inside a block are applied at their exact sample offset: each track renders its synth in stretches between events.
- **Clip playback:** each track flattens its clips into note-ons sorted by tick (rebuilt when its clips change, resuming from the current position). Each playing pitch remembers its own end tick, so editing a clip mid-note can't leave a stuck note. Notes that started before the play position aren't "chased" (they don't sound until their next start).
- **Recording:** live notes are stamped with the position minus the output latency (what the player was hearing), streamed to the UI as they're played (the timeline draws them live in the red recording region), then sent as a take when the pass ends. The UI turns it into clips with one undoable command: one clip per track, spanning exactly from where recording started to where it stopped (stretched only to fit notes played just before the start). It is not rounded to bars, so stopping mid-bar never replaces material you didn't record over. Without overdub it replaces what was underneath; with overdub it merges with the clips it overlaps.
- **Metronome:** a short square blip on every beat while playing, accented on the downbeat. It's mixed straight into the master, not part of any track.
- **Signal flow per track:** clip notes and live notes → sequencer chain (non-bypassed) → synth voices → effect chain (non-bypassed) → track volume/mute/solo → master bus → master volume → soft clipper. Live notes go to the first active sequencer, or straight to the synth when there is none.
- **Real-time rules:**
  - No allocation inside `process()`: voices, buffers and event queues are preallocated.
  - Allocation is allowed only when the structure changes (box added, project loaded), never per block.
  - Parameter changes are smoothed to avoid zipper noise.
  - No `async`, no `console.log` and no exceptions on the hot path.

## State, commands and undo

- The project is an immutable object held in a Svelte `$state.raw` store.
- Every mutation is a **command** run through Immer's `produceWithPatches`, which yields `patches` and `inversePatches`.
  - The undo stack stores `{ label, patches, inversePatches }`.
  - Undo and redo apply the stored patches.
  - The same patches are sent to the engine, so **one mechanism handles both undo and engine sync**.
- **Continuous gestures** (dragging a knob, moving a clip) are grouped: `begin(label)` / `commit()` merges them into one undo step (`cancel()` reverts it). Each step still applies and reaches the engine immediately, so you hear the change during the drag. Repeated changes to the same value inside a transaction are collapsed, so a long drag stores one patch, not hundreds.
- Some state is not undoable: transport state, selection, open panels, zoom.

## Persistence

- **Project file:** `.chip`, the `Project` as JSON (with `formatVersion`). Loading goes JSON → `migrateProject` (upgrades old formats, rejects newer ones) → `validateProject` (checks the shape and names the broken part, e.g. `tracks[2].clips[0].notes[0].pitch should be a number`). It may become a zip if samples are ever added. Code: `src/model/project-file.ts`, `validate.ts`, `migrations.ts`.
- **Project name:** taken from the file name on import and on export (when the save dialog lets the user rename the file).
- **Preset file:** `.chippreset`, JSON containing a single `Preset`.
- **Autosave:** every project change schedules a save to IndexedDB 0.8 s later (and immediately when the page is hidden or closed). It's stored as the same serialized text as a `.chip` file and goes through the same parse/migrate/validate path on load. On startup it's restored unless the user already started editing. If storage is unavailable (private browsing), the app keeps working and warns once in the console. Code: `src/persistence/autosave.ts`.
- **Import/export:** export uses the File System Access save picker where supported (Chromium), otherwise a download. Import uses a plain `<input type=file>` everywhere. Opening or starting a new project clears undo history, selection and transport state; "New" asks for confirmation when there's work to lose. Code: `src/persistence/files.ts`.
- **Audio export:** offline render in a Worker → 16/24-bit WAV encoder. MP3 later (e.g. a WASM LAME encoder).

## UI

- **Layout:** top bar, left sidebar (preset library), center (track arrangement), right sidebar (track presets, mute/solo/volume), bottom panel (preset editor or piano roll).
- **Canvas** is used for the arrangement timeline, automation lanes and the piano roll. Everything else is Svelte components.
- **Arrangement timeline** (`src/ui/arrangement/`): pure geometry (tick↔pixel, snap grid by zoom, hit-testing) is unit-tested; the canvas draws a ruler, lanes, clips with a note preview, a recording region and the playhead. While dragging, clips are previewed as ghosts and the edit is committed as one command on release. Interactions: click the ruler to seek; click/Shift-click clips to select; drag to move (also across tracks) or drag an edge to resize, with Alt to disable snapping; double-click an empty lane to create a one-bar clip; Shift+wheel scrolls, Ctrl/Cmd+wheel zooms.
- **Piano roll** (`src/ui/piano-roll/`, bottom panel tab): edits the clip that's selected on its own (double-click a clip to open it). Canvas with a key column, ruler, note grid and a velocity lane; geometry is unit-tested. Click empty space inside the clip to draw a note (drag right to set its length; new notes reuse the last drawn/resized length and the keyboard velocity); drag notes to move them in time and pitch; drag a note's right edge to resize; Shift-click to add to the selection, Shift-drag to select a rectangle; double-click a note to delete it; click or drag across velocity stems to set velocities (all selected notes when dragging a selected one). Grid 1/4–1/32 with Alt to disable snapping; Quantize snaps note starts (the selection, or all notes) to the song grid. Notes sound when drawn, clicked or dragged to a new pitch; these auditions are never recorded (`noteOn` with `record: false`). Each gesture is one undo step: the edit runs as live commands inside a history transaction, so the engine hears changes immediately.
- **Shortcuts** act on the editor clicked last (`session.focusArea`): in the piano roll on notes, otherwise on clips. Space play/pause, Home go to start, Delete/Backspace delete, Ctrl/Cmd+A select all, Ctrl/Cmd+C/V/D copy/paste/duplicate (clips paste at the playhead on the selected track; notes at the playhead if it's inside the clip, else at its start), ↑/↓ transpose selected notes (Shift: an octave), ←/→ move them by the grid, Escape releases notes and clears the selection, Ctrl/Cmd+S export, Ctrl/Cmd+O import. Keymap handlers can return `false` to leave a key alone (so arrows still scroll when there's nothing to nudge).
- **Base controls** (knob, slider, meter fader, toggle, segmented selector) form a small in-house kit that defines the OP-1-inspired look. Design tokens (colors, radii, type) are CSS custom properties. The theme is **dark by default**; a light theme exists behind `<html data-theme="light">` for a future setting.
- **Input:**
  - Number keys select tracks 1–9 (or fewer if the project has fewer tracks). Tracks beyond 9 are selected by clicking.
  - The computer keyboard is a piano using physical key positions: `A W S E D F T G Y H U J K O L P ;` play C to E an octave up, `Z`/`X` shift the octave, `C`/`V` step the velocity, `Escape` releases all notes. Keys with Ctrl/Cmd/Alt, and typing in text fields or selects, are left alone.
  - Live notes (keyboard and MIDI) play on the **selected track**. Each held note remembers its track, so its note-off reaches the same track even if the selection changes.
  - MIDI: the top bar's selector requests Web MIDI access only when the user picks "Enable MIDI…" (browsers may prompt). It listens on all channels, to all inputs or one. Picking an option also starts audio, because browsers only start audio after a click or key press and MIDI notes don't count; if notes arrive while audio is off, a notice says to click. An activity light next to the selector blinks on every incoming message (except clock/active sensing) and its tooltip shows the last one, so users can see whether their device gets through.
  - Shortcuts are handled by one central keymap, not scattered listeners.
- **Touch:**
  - No interaction depends on hover.
  - Hit targets are at least 40 px.
  - Pointer Events are used throughout, so mouse and touch share one code path.
  - Panels can collapse for tablet layouts.

## Source layout

```
src/
  model/        types, defaults, migrations, commands, boxes/ (descriptors + registry) (pure TS)
  engine/       tracks, mixer, envelopes, oscillators, boxes/ (synth implementations, voice pool) (pure TS)
  audio/        worklet entry, main-thread engine bridge, Web MIDI input
  persistence/  IndexedDB autosave, .chip file save/open (WAV encoder in Phase 3)
  ui/           Svelte components: layout panels, controls kit, preset editor, computer-keyboard input
```

`model/` and `engine/` must not import from `ui/`, `audio/` or browser APIs. That keeps them testable in Node and portable, for example to a future Rust/WASM or native host.
