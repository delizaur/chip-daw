# Roadmap

Each phase ends with something usable. Data structures for later features (tempo map, automation) already exist in the model from Phase 0, even when their UI arrives later. See [ARCHITECTURE.md](ARCHITECTURE.md) for the technical design.

## Phase 0: Foundations ✅
- [x] Vite + Svelte 5 + TypeScript (strict) + Vitest + lint/format
- [x] GitHub Pages deploy via GitHub Actions (Vite `base` set to the repo path); needs Pages source set to "GitHub Actions" once
- [x] Project data model types, defaults, `formatVersion` + migration scaffold
- [x] Command system on Immer patches, with undo/redo stack and transactions
- [x] Engine skeleton (pure TS) + AudioWorklet wrapper + main-thread bridge; outputs a test tone
- [x] Design tokens and base control kit: knob, slider, toggle, segmented selector
- [x] App shell with the 5 layout regions

## Phase 1: Make a sound ✅
- [x] Box registry + descriptors
- [x] First synth: NES-style pulse (duty cycle) / triangle / noise, polyphonic voice pool, ADSR
- [x] Live input: computer-keyboard piano + Web MIDI device selector
- [x] Preset editor panel rendering a synth's params from its descriptor
- [x] Engine unit tests rendering to buffers

## Phase 2: Arrange a song ✅
- [x] Transport: play/stop, tick clock, BPM, metronome
- [x] Tracks (count from `DEFAULT_TRACK_COUNT`, currently 8); number keys select a track; mute/solo/volume in the right sidebar
- [x] Record MIDI into clips (engine-stamped, latency-compensated), with overdub mode
- [x] Canvas arrangement view: clips shown as boxes; select, drag, copy/paste, delete, resize
- [x] Piano roll: draw, move, resize and delete notes; velocity; grid snap/quantize
- [x] Undo/redo wired to every edit
- [x] Project import/export (`.chip`) + IndexedDB autosave/restore

## Phase 3: Preset pipeline ✅
- [x] Full box chain: sequencers → synth → effects, added, removed, reordered, replaced and bypassed
- [x] Sequencer: arpeggiator (more note helpers, e.g. chord or note-length, can follow later)
- [x] Effects: bitcrush/sample-rate reduction, filter, delay, reverb
- [x] Left sidebar preset library: folders, copy, rename, delete (IndexedDB), with starter presets
- [x] Assign library presets to tracks (deep copy); preset import/export (`.chippreset`)
- [x] WAV export via offline render in a Worker

## Phase 3C: Clip presets ✅
Recorded clips keep their sound, like the OP-1's tape, but stay editable because they're MIDI. See the terminology in [design-principles.md](design-principles.md#terminology).
- [x] Model: one list of presets per project; tracks and clips point at them by id (format v2, migrated from v1); unused presets are removed
- [x] Recording, new clips, paste and duplicate set or keep the clip preset; editing a shared track preset switches the track to a copy first
- [x] Engine: a live chain per track plus a chain per clip preset (idle chains sleep); overdub and piano roll auditions play through the clip's preset
- [x] Preset editor shows the clip preset when a clip is selected: header with "used by N clips", Make unique, Use track preset, Load to track
- [x] Clip preset names on the timeline
- [x] While the preset editor is open, the clips and tracks an edit would change are highlighted

## Phase 3D: Workflow ✅
- [x] 4-beat count-in (with clicks and a big countdown) before recording from a stop
- [x] The key left of 1 turns the computer keyboard piano off; its letter keys become shortcuts: R record, O overdub, M metronome, arrows select clips, A/D jump between clip edges, Enter opens the piano roll, U/P/T clip preset buttons

## Phase 3E: Loop ✅
- [x] Loop button in the top bar (yellow when on); loop region saved with the project (format 3), first four bars by default
- [x] Start/end markers on the ruler with lines down through all tracks, dragged to set the loop (snapped, undoable)
- [x] Sample-accurate loop playback; recording makes one pass per time around (layered with overdub)

## Phase 4: Time and automation
- [x] Clip automation lanes; draw/edit points (piano roll Lane menu); hold-last-value + chase on seek
- [x] Re-link automation to matching boxes when a clip's preset changes; show unmatched lanes as inactive
- [x] Record automation by moving params while recording (written into the clip under the playhead; a clip is created if none)
- [x] A knob moved while recording owns its param until recording stops (existing automation pauses; what's saved matches what was heard); a yellow line previews the moves in the recording region
- [x] Automated knobs are marked (●) and follow the automation while playing
- [x] Insert/delete bars (select bars by Shift-dragging the ruler): shift all clips, tempo/meter events and the loop after a point, as one undo step
- [x] Tempo lane under the ruler: tempo changes with jumps or linear ramps; time-signature changes (bars, grids, metronome and count-in follow them)

## Phase 5: Sounds and polish
Order: the synth engines first (one at a time: FM, Game Boy, SID), then the rest of Phase 4, then the rest of Phase 5.
- [x] FM synth (Genesis-style, 2 operators), with starter presets
- [x] Game Boy-style wavetable synth ("Wave": 8 preset 4-bit waves with a morph knob), with starter presets
- [x] SID-style synth (Commodore 64: tri/saw/pulse with PWM/noise, ring mod and sync, shared resonant filter), with starter presets
- [ ] Possibly a sampler (needs audio stored in projects and the library)
- [ ] Visual polish pass on the OP-1-inspired look
- [ ] PWA: installable, works offline
- [ ] Performance profiling; move hot DSP to WASM only if needed

## Phase 6: Mobile
- [ ] Responsive/collapsible layout for tablets; touch gesture pass
- [ ] Capacitor builds for Android and iPadOS
- [ ] Native MIDI plugin for iOS (Web MIDI is unavailable in WebKit)
- [ ] Latency tuning on devices

## Later
- Automation editing: select several points (move, delete, copy/paste), switch a point between ramp and step, show automation on clips in the arrangement
- Record automation from a MIDI controller's knobs (map a CC to a param)
- Loop / live-recording workflow (an alternative to the arrangement view)
- MP3 export
- Cloud upload and sharing of projects
