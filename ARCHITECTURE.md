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
| Presets in projects | Always **copies** of library presets. Editing a library preset never changes a project, and editing a project's preset never changes the library. A copy remembers which library preset it came from (informational only). |
| Track and clip presets | Each track has a **track preset** (played live, used by new recordings) and each clip a **clip preset** (set when it's recorded). Both point into one list of presets per project, so clips can share a preset with each other and with the track. Editing the track preset never changes recorded clips (copy on write). This replaces the "preset walls" of the original design. See [design-principles.md](design-principles.md#terminology). |
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
- `play()` / `pause()` / `seek(tick, seq)`: the transport (pause stops in place). With record armed, `play` counts in first; `pause` cancels a count-in. `seq` numbers the UI's seeks (see `transport`)
- `setRecord(armed)`: while armed and playing, live notes are captured into a take
- `setMetronome(enabled)`
- `setLoop(enabled)`: loop on/off (the region itself is `project.loop`, synced by patches)
- `setLatency(seconds)`: output latency, sent by the bridge once audio runs
- `noteOn(trackId, pitch, velocity, record?, presetId?)` / `noteOff(trackId, pitch)`: live input (computer keyboard, MIDI); `record: false` and the clip's `presetId` for piano roll auditions
- `setOverdub(enabled)`: overdub mode, so overdubbed notes play through the clip they land in
- `allNotesOff()`: releases everything (window blur, Escape, MIDI CC 120/123)

Knob moves during a gesture need no special message: each step is applied to the project immediately and reaches the engine as a normal patch. The transaction only affects how the steps are grouped for undo.

Engine → UI:
- `transport(playing, tick, countIn, seekSeq)`: ~30 Hz while playing or counting in, and on every transport change. The UI extrapolates between reports for a smooth playhead. `countIn` is the count-in beats left (0 when not counting in). `seekSeq` is the last seek handled: the UI ignores the position of reports sent before its latest seek arrived, so quick seeks in a row (A/D, Home) never jump back.
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
  loop: { startTick: Tick; endTick: Tick };  // the loop region (saved; on/off is transport state)
  presets: Preset[];              // every preset a track or clip uses (and no others)
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
  presetId: string;               // the track preset, in project.presets
  clips: Clip[];
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
    boxId: string;                // box in the clip's preset
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
  presetId: string;               // the clip preset, in project.presets (may be shared)
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
- **Presets are shared by reference.** Tracks and clips point at presets by id. `project.presets` holds exactly the presets something points at: commands that drop the last reference to a preset remove it (undo brings it back). Loading a project checks that every reference resolves.
- **Recording** gives a new clip the track preset (shared, not copied). Overdubbing into existing clips keeps the preset of the first clip it merges with. A clip created by double-click also gets the track preset. Copy, paste, duplicate and moving across tracks keep the clip's preset, so a clip sounds the same wherever it goes. The clipboard holds a copy of each preset, in case the original is gone by the time you paste.
- **Copy on write for the track preset.** Any edit to the track preset (a param; a box added, removed, moved, replaced or bypassed; a rename) first checks whether a clip or another track uses the same preset. If so, the track switches to a copy and the edit lands on the copy, so recorded clips keep their sound. The copy keeps the original's box ids (so automation lanes still match it) and gets the next free name ("Bass" → "Bass 2").
- **Editing a clip preset** changes it in place: every clip that shares it changes, and so does the track preset if it's the same one.
- **Clip preset buttons:** *Make unique* gives the selected clips one copy of their preset, shared among them (box ids kept); *Use track preset* points the selected clips at the track preset; *Load to track* points the track preset at the clip's preset.
- **Clips on the same track never overlap.** Dropping or resizing a clip over another trims the one underneath, as in Ableton's arrangement view.
- **Parameter automation lives in clips**, timed relative to the clip start, so moving, copying or inserting time moves automation with the music.
  - *Linking:* a lane targets a box in the clip's own preset by `boxId`. If the clip switches to a preset without that id (*Use track preset* with an unrelated preset), the lane re-links to the `boxIndex`-th box of the same `boxType`. Lanes with no match are kept but inactive (shown dimmed). Copies made by copy on write and *Make unique* keep box ids, so their lanes stay linked.
  - *Between clips:* a parameter **holds its last automated value** until the next automation point on clips sharing that preset; a clip with another preset starts from its own preset's values.
  - *Chasing:* on play/seek, the engine finds the most recent automation point before the playhead. Playback therefore sounds the same no matter where it starts.
  - *Points:* a point's `curve` says how it reaches the next point: `linear` ramps, `step` holds. Ramps are interpolated in the param's own scale (a cutoff sweep on an exponential scale sounds even) and only within a clip: between clips the value holds. Enum params (wave, filter type...) always step. Values are in the param's units, constrained to its range. Code: `src/model/automation.ts` (linking, values), `automation-commands.ts` (editing, recording).
  - *Recording:* while recording (or counting in to record), moving a knob in the preset editor (track or clip preset) doesn't change the preset: the move is heard at once on everything the track plays (an override in its live chain and in every clip chain whose preset has that box) and stamped into the take like a note (latency-compensated); a move during the count-in becomes the recording's starting value. A moved knob *latches*: it owns that param until recording stops (the clip chains pause that param's automation, so existing automation doesn't fight the knob), and every new pass (after the count-in, at each loop jump) starts with its last value. When the take is committed, the moves become points (merged when closer than a 64th) that replace the lane's points from the first move to where recording stopped, so what's saved is what was heard: in the clip the take makes on a track that got notes; otherwise in the clips already under the recorded time (their notes untouched), or a new empty clip spanning the take when there are none. Overdub merges keep the merged clips' automation. When recording stops the sound goes back to the preset, with automation chased again (not at a loop wrap, so a knob held across the loop end doesn't jump).
  - *On the knobs:* params automated in the selected track's clips (those playing with the preset shown in the editor) are marked with a red ● next to their name, and while playing their controls follow the automation at the playhead (computed in the UI from the same curves the engine plays, `session.automationCurves`), so recorded knob moves play back on the knobs. When stopped they show the preset's own value; turning one outside recording edits that value.
  - *Tempo* is the exception: it is song-level, stored in the `tempos` list (`linear` ramps for tempo automation).
- **Preset library** (folders, presets) is *not* part of the project. It lives in IndexedDB (`src/model/library.ts` for the pure operations, `src/ui/state/library.svelte.ts` for the UI state). Loading a library preset onto a track deep-copies it with fresh ids (`instantiatePreset`, which records `libraryOrigin`) and makes it the track preset, as one undoable command (recorded clips keep theirs); saving the preset shown in the editor (track or clip preset) to the library copies it the other way. Folders are one level deep; deleting a folder moves its presets to the top level. Library edits aren't in the project's undo history (deleting a preset asks first). A fresh browser gets starter presets (`src/model/factory-presets.ts`, tested to be valid and in range). A stored library that can't be read is never overwritten.

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
  - `synth.fm` ("FM"): two-operator FM, Genesis-flavoured. A sine modulator at a whole multiple of the note (×½, ×1…×15) with its own envelope (instant attack, Mod decay, Mod sustain; it shares the carrier's release) and self-feedback (averaging its last two outputs, like the YM2612) bends the phase of a sine carrier with the volume ADSR. Amount and Feedback are squared for finer control at the low end; velocity also scales brightness. Sines come from a 4096-point table (`sine` in `oscillators.ts`). 8 voices, level, transpose, fine tune.
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
- **Clip playback:** each track flattens its clips into note-ons sorted by tick (rebuilt when its clips change, resuming from the current position), each tagged with the chain of its clip's preset. Each playing pitch remembers its own end tick and chain, so editing a clip mid-note can't leave a stuck note.
- **Chains per track:** a track runs one *live chain* for its track preset and one *clip chain* per distinct preset its clips use, each with its own sequencers, synth voices and effects (and tails). Chains are created and dropped on sync. A chain with no held notes that has been silent for 5 s sleeps (skips processing) until its next note, so a track with many clip presets costs about as much as the chains actually sounding. Box runtimes are matched by box id, so when copy on write gives the track preset a new id, the live chain keeps its runtimes (a held note or reverb tail survives).
- **Which chain hears live notes:** the live chain, except (a) piano roll auditions, which name the clip's preset and play through its clip chain, and (b) overdub recording, where notes play through the preset of the clip under the playhead on that track (what you're adding to), falling back to the live chain between clips. A note-off always reaches the chain that got the note-on. Notes that started before the play position aren't "chased" (they don't sound until their next start).
- **Recording:** live notes are stamped with the position minus the output latency (what the player was hearing), streamed to the UI as they're played (the timeline draws them live in the red recording region), then sent as a take when the pass ends. The UI turns it into clips with one undoable command: one clip per track, spanning exactly from where recording started to where it stopped (stretched only to fit notes played just before the start). It is not rounded to bars, so stopping mid-bar never replaces material you didn't record over. Without overdub it replaces what was underneath; with overdub it merges with the clips it overlaps.
- **Count-in:** pressing Play with record armed counts in 4 beats first (`COUNT_IN_BEATS`), clicking on each (accent on the first) even with the metronome off; the UI shows the beats left over the timeline. The transport doesn't move during the count-in, and playback and the take start at the exact sample where it ends. Notes played in the last sixteenth of the count-in and still held are early hits for the downbeat: they're recorded at the start. Earlier notes sound but aren't recorded. Arming record while already playing punches in at once, without a count-in.
- **Loop:** with the loop on, playback that reaches `project.loop.endTick` jumps back to its start on the exact sample: the engine renders a block in segments split at the loop end (tracks and the metronome take a sample offset). Notes sounding at the loop end are released there. Starting after the loop end, or turning the loop on past it, plays on without jumping back. While recording, each time around is its own pass: the take ends at the loop end (notes held across it end there) and a new one starts at the loop start, so with overdub the passes layer into one clip, and without it the last pass you played on replaces the earlier ones (a pass with no notes changes nothing). In a pass started by the loop, notes can't start before the loop start. The UI's smooth playhead wraps the same way between engine reports. The region is part of the project (format 3, migrated from 2 as the first four bars), so moving it is undoable and saved; whether the loop is on is transport state, like the metronome.
- **Metronome:** a short square blip on every beat while playing, accented on the downbeat. It's mixed straight into the master, not part of any track.
- **Signal flow per track:** in each chain, notes → sequencers (non-bypassed) → synth voices → effects (non-bypassed); the track's chains are summed → track volume/mute/solo → master bus → master volume → soft clipper. Notes go to a chain's first active sequencer, or straight to its synth when there is none.
- **Automation playback** (`src/engine/automation.ts`): for each clip chain, the lanes of the track's clips with that preset are linked to its boxes and flattened per param into a curve over song time (typed arrays, binary search). Each block, before the chain renders, every curve is evaluated at the block start; a changed value becomes an *override* on the chain: the box's runtime gets its params with the override on top (`setOverride`), while the preset itself is untouched. Before a curve's first point the override is cleared and the preset's value applies. Seeking and loading chase the same way. Curves are rebuilt when the clips or the chain's preset change. Because a box's `setParams` can now run every block, it must not allocate: boxes read params through `paramReader` (a precomputed table) and update their state in place.
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

- **Project file:** `.chip`, the `Project` as JSON (with `formatVersion`). Loading goes JSON → `migrateProject` (upgrades old formats, rejects newer ones) → `validateProject` (checks the shape and names the broken part, e.g. `tracks[2].clips[0].notes[0].pitch should be a number`). It may become a zip if samples are ever added. Code: `src/model/project-file.ts`, `validate.ts`, `migrations.ts`. Format 2 (Phase 3C) moved presets from per-track segments into `Project.presets` with `presetId` references; format-1 files are migrated on open (every clip gets its track's preset, so they sound as before).
- **Project name:** taken from the file name on import and on export (when the save dialog lets the user rename the file).
- **Preset file:** `.chippreset`, JSON `{ format: "chip-daw-preset", formatVersion: 1, preset }`, validated with the same preset checks as projects. Importing uses the name stored in the file.
- **Autosave:** every project change schedules a save to IndexedDB 0.8 s later (and immediately when the page is hidden or closed). It's stored as the same serialized text as a `.chip` file and goes through the same parse/migrate/validate path on load. On startup it's restored unless the user already started editing. If storage is unavailable (private browsing), the app keeps working and warns once in the console. Code: `src/persistence/autosave.ts`.
- **Import/export:** export uses the File System Access save picker where supported (Chromium), otherwise a download. Import uses a plain `<input type=file>` everywhere. Opening or starting a new project clears undo history, selection and transport state; "New" asks for confirmation when there's work to lose. Code: `src/persistence/files.ts`.
- **Audio export (WAV):** "Export WAV" renders the song in a Worker (`src/audio/render.worker.ts`) with the same `Engine` used for playback (`src/engine/offline-render.ts`), from the start to the end of the last clip, then on until effect tails fade (up to 12 s), trimming the final silence. Mute/solo apply; the metronome doesn't. Encoded as 44.1 kHz 16-bit stereo PCM with TPDF dither (`src/engine/wav.ts`, which also does 24-bit). The save location is asked for *before* rendering (`chooseSaveTarget`), because Chrome only opens its save dialog straight after a click. MP3 later (e.g. a WASM LAME encoder).

## UI

- **Layout:** top bar, left sidebar (preset library), center (track arrangement), right sidebar (track presets, mute/solo/volume), bottom panel (preset editor or piano roll).
- **Canvas** is used for the arrangement timeline, automation lanes and the piano roll. Everything else is Svelte components.
- **Arrangement timeline** (`src/ui/arrangement/`): pure geometry (tick↔pixel, snap grid by zoom, hit-testing) is unit-tested; the canvas draws a ruler, lanes, clips with a note preview, a recording region (with the notes played so far, and a yellow line per knob moved, at its height in the param's range) and the playhead. While dragging, clips are previewed as ghosts and the edit is committed as one command on release. With the loop on, the ruler shows the loop region with a marker at each end, and the markers continue as lines down through every track; dragging a marker (grabbed within 8 px on the ruler, `loopMarkerAt`) moves that end, snapped to the grid (Alt: free), as one undo step, never shorter than a sixteenth. Interactions: click the ruler to seek; click/Shift-click clips to select; drag to move (also across tracks) or drag an edge to resize, with Alt to disable snapping; double-click an empty lane to create a one-bar clip; Shift+wheel scrolls, Ctrl/Cmd+wheel zooms.
- **Preset library panel** (left sidebar, `src/ui/library/`): "Save Track N preset", folders that open and close, double-click a preset to load it onto the selected track (a dot marks the preset the track came from), inline rename, and a toolbar for the selected item: Load, Rename, Duplicate, Export, Delete, and a folder picker. 
- **Preset editor** (bottom panel, `src/ui/editor/`): shows the **clip preset** when clips on the selected track are selected, otherwise the **track preset**. The header says which one it is and how many clips use it, with the preset's editable name, "Save to library" and "Export". For a clip preset it also has *Make unique*, *Use track preset*, *Load to track* and a way back to the track preset. When the selected clips use different presets, a note says so instead of the chain (only *Use track preset* applies). Clips show their preset's name on the timeline, so you can see which ones share. While the Preset tab is open, the arrangement highlights what an edit would change (`session.presetReach`): affected clips are lit exactly like selected ones but without the white outline, and affected track headers get a white-ish tint. For a track preset that's just its track (clips keep their sound); for a clip preset, every clip sharing it and every track whose preset it is.
- **Piano roll** (`src/ui/piano-roll/`, bottom panel tab): edits the clip that's selected on its own (double-click a clip to open it). Canvas with a key column, ruler, note grid and a bottom lane; geometry is unit-tested. The Lane menu in its toolbar picks what the bottom lane shows: Velocity, or any param of the clip's preset (grouped by box, ● marking params with automation in the clip; lanes whose box is gone are listed under "Unlinked" and drawn faded). An automation lane is taller (96 px) and shows the points as a line (ramps, or steps), holding after the last point and with the preset's own value dashed before the first; click to add a point, drag one to move it (snapped to the grid, Alt free), double-click to delete it, "Clear" removes the lane. Click empty space inside the clip to draw a note (drag right to set its length; new notes reuse the last drawn/resized length and the keyboard velocity); drag notes to move them in time and pitch; drag a note's right edge to resize; Shift-click to add to the selection, Shift-drag to select a rectangle; double-click a note to delete it; click or drag across velocity stems to set velocities (all selected notes when dragging a selected one). Grid 1/4–1/32 with Alt to disable snapping; Quantize snaps note starts (the selection, or all notes) to the song grid. Notes sound when drawn, clicked or dragged to a new pitch; these auditions are never recorded (`noteOn` with `record: false`). Each gesture is one undo step: the edit runs as live commands inside a history transaction, so the engine hears changes immediately.
- **Shortcuts** act on the editor clicked last (`session.focusArea`): in the piano roll on notes, otherwise on clips. Space play/pause, Home go to start, Delete/Backspace delete, Ctrl/Cmd+A select all, Ctrl/Cmd+C/V/D copy/paste/duplicate (clips paste at the playhead on the selected track; notes at the playhead if it's inside the clip, else at its start), ↑/↓ transpose selected notes (Shift: an octave), ←/→ move them by the grid, Escape releases notes and clears the selection, Ctrl/Cmd+S export, Ctrl/Cmd+O import. Keymap handlers can return `false` to leave a key alone (so arrows still scroll when there's nothing to nudge).
- **Keyboard piano off: letter shortcuts.** The key left of 1 (`backquote` in the keymap, by physical position: \` on US keyboards, º on Spanish, ^ on German) or the keyboard button in the top bar turns the computer keyboard piano off and on. Off, letter keys are shortcuts: R record, O overdub, M metronome, L loop; arrows select clips (←/→ the previous/next clip on the same track, ↑/↓ the nearest clip on the next track above/below with clips; with no clip selected, the clip closest to the playhead); A/D move the playhead along the selected track's clip edges (`src/ui/arrangement/navigation.ts`): D goes to the end of the current clip, then the start of the next one, selecting it; where one clip ends exactly where the next starts, D there selects the next clip without moving, A mirrors it; Enter opens the selected clip in the piano roll (unless a button has focus); U/P/T are Make unique, Use track preset and Load to track, with a notice when they don't apply. Piano roll arrow keys keep acting on selected notes first. Letter shortcuts go by the character typed (R is record on any layout); the timeline scrolls to show a clip or playhead moved off screen.
- **Base controls** (knob, slider, meter fader, toggle, segmented selector) form a small in-house kit that defines the OP-1-inspired look. Design tokens (colors, radii, type) are CSS custom properties. The theme is **dark by default**; a light theme exists behind `<html data-theme="light">` for a future setting.
- **Input:**
  - Number keys select tracks 1–9 (or fewer if the project has fewer tracks). Tracks beyond 9 are selected by clicking.
  - The computer keyboard is a piano (unless turned off with the key left of 1) using physical key positions: `A W S E D F T G Y H U J K O L P ;` play C to E an octave up, `Z`/`X` shift the octave, `C`/`V` step the velocity, `Escape` releases all notes. Keys with Ctrl/Cmd/Alt, and typing in text fields or selects, are left alone.
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
  persistence/  IndexedDB key-value storage (autosave, library), file save/open helpers
  ui/           Svelte components: layout panels, controls kit, preset editor, computer-keyboard input
```

`model/` and `engine/` must not import from `ui/`, `audio/` or browser APIs. That keeps them testable in Node and portable, for example to a future Rust/WASM or native host.
