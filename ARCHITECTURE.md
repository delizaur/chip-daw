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
- `transport(play | stop | seek(tick) | setRecord(on, overdub))`
- `liveNote(trackIndex, on/off, pitch, velocity)`

Knob moves during a gesture need no special message: each step is applied to the project immediately and reaches the engine as a normal patch. The transaction only affects how the steps are grouped for undo.

Engine → UI:
- `playhead(tick)`: throttled to ~60 Hz
- `meters(trackPeaks[], masterPeak)`
- `recorded(notes[], paramPoints[])`: when recording stops

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

Sequencers, synths and effects are all "boxes". Each box type is registered once with a **descriptor** that both the UI and the engine use:

```ts
interface BoxDescriptor {
  type: string;                   // "synth.pulse"
  kind: 'sequencer' | 'synth' | 'effect';
  name: string;
  params: ParamDescriptor[];
}

interface ParamDescriptor {
  id: string;
  name: string;
  min: number; max: number; default: number;
  scale: 'linear' | 'exp';
  steps?: string[];               // stepped/enum params, e.g. duty cycle 12.5/25/50/75%
  unit?: string;
}
```

- The UI renders the preset editor (bottom panel) from descriptors, so a new box needs no UI code unless it wants a custom view.
- Every param is automatable, because every param is a number with a known range.
- Engine-side implementations:
  - **Sequencer:** note events in → note events out. Has access to transport info (tempo, tick), so an arp can emit notes in the future.
  - **Synth:** note events in → stereo audio out. Owns a preallocated voice pool with voice stealing.
  - **Effect:** processes a stereo buffer in place.

## Engine

- Lives in `src/engine/` as **pure TypeScript with no DOM or Web Audio dependencies**. The worklet is a thin wrapper around it. This means the same engine:
  - plays in real time inside the `AudioWorkletProcessor`,
  - renders offline in a Web Worker for WAV export (sounds exactly like playback),
  - renders to buffers in unit tests under Node.
- **Transport:** advances a tick position per sample by integrating the tempo map, so tempo ramps are exact. Events inside a 128-sample block are applied at their exact sample offset.
- **Signal flow per track:** active segment(s) → sequencer chain → synth voices → effect chain → track volume/mute/solo → master bus → master volume → soft clipper.
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

- **Project file:** `.chip`, JSON with `formatVersion`. A `migrations` list upgrades old files on load. It may become a zip if samples are ever added.
- **Preset file:** `.chippreset`, JSON containing a single `Preset`.
- **Autosave:** the current project is saved to IndexedDB (debounced) and restored on reload.
- **Import/export:** File System Access API where supported (Chromium), with an `<a download>` / `<input type=file>` fallback elsewhere.
- **Audio export:** offline render in a Worker → 16/24-bit WAV encoder. MP3 later (e.g. a WASM LAME encoder).

## UI

- **Layout:** top bar, left sidebar (preset library), center (track arrangement), right sidebar (track presets, mute/solo/volume), bottom panel (preset editor or piano roll).
- **Canvas** is used for the arrangement timeline, automation lanes and the piano roll. Everything else is Svelte components.
- **Base controls** (knob, slider, toggle, segmented selector) form a small in-house kit that defines the OP-1-inspired look. Design tokens (colors, radii, type) are CSS custom properties.
- **Input:**
  - Number keys select tracks 1–9 (or fewer if the project has fewer tracks). Tracks beyond 9 are selected by clicking.
  - A computer-keyboard piano row plays notes.
  - Shortcuts are handled by one central keymap, not scattered listeners.
- **Touch:**
  - No interaction depends on hover.
  - Hit targets are at least 40 px.
  - Pointer Events are used throughout, so mouse and touch share one code path.
  - Panels can collapse for tablet layouts.

## Source layout

```
src/
  model/        types, defaults, migrations, commands (pure TS)
  engine/       transport, mixer, voice allocation, boxes/{sequencers,synths,effects}, offline render (pure TS)
  audio/        worklet entry, main-thread engine bridge, MIDI + keyboard input
  persistence/  IndexedDB, file import/export, WAV encoder
  ui/           Svelte components: layout panels, controls kit, canvas views
```

`model/` and `engine/` must not import from `ui/`, `audio/` or browser APIs. That keeps them testable in Node and portable, for example to a future Rust/WASM or native host.
