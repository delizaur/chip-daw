import { EngineBridge } from '../../audio/bridge';
import { MidiInputs, midiSupported, type MidiDevice, type MidiSelection } from '../../audio/midi';
import { describeMidiMessage } from '../../audio/midi-message';
import { cloneClip, createClip } from '../../model/clips';
import {
  canMakeUnique,
  loadClipPresetToTrack,
  makeClipsUnique,
  useTrackPreset,
} from '../../model/clip-preset-commands';
import {
  deleteClips,
  placeClips,
  recordTake,
  setProjectName,
  type ClipPlacement,
  type ProjectCommand,
  type RecordedNote,
} from '../../model/commands';
import { PPQ } from '../../model/constants';
import { createProject } from '../../model/defaults';
import { History } from '../../model/history';
import { createId } from '../../model/ids';
import {
  addNotes,
  deleteNotes,
  updateNotes,
  type ClipAddress,
  type NoteChange,
} from '../../model/note-commands';
import {
  parseProject,
  projectFileName,
  projectNameFromFile,
  serializeProject,
} from '../../model/project-file';
import { findPresetById, presetUsage, type PresetTarget } from '../../model/presets';
import { bpmAt, ticksPerBar, ticksPerSecond } from '../../model/time';
import type { Clip, Note, Preset, Project, Tick, Track } from '../../model/types';
import { Autosaver, loadAutosave } from '../../persistence/autosave';
import {
  chooseSaveTarget,
  openTextFile,
  PROJECT_FILE,
  saveFile,
  WAV_FILE,
} from '../../persistence/files';
import type { RenderReply, RenderRequest } from '../../audio/render.worker';
import { COUNT_IN_BEATS } from '../../engine/engine';
import { songEndTick } from '../../engine/offline-render';
import { adjacentClip, clipEdgeJump, closestClip, type Direction } from '../arrangement/navigation';
import { MAX_OCTAVE, MIN_OCTAVE, shiftVelocity } from '../input/computer-keyboard';

export type AudioStatus = 'off' | 'starting' | 'running' | 'error';
export type MidiStatus = 'off' | 'connecting' | 'ready' | 'unsupported' | 'error';
/** Where a live note came from. Each source's held notes are tracked separately. */
export type NoteSource = 'keyboard' | 'midi';
/** Which editor keyboard shortcuts (delete, copy, arrows...) act on: the last one clicked. */
export type FocusArea = 'arrangement' | 'pianoRoll';

/** A recording pass in progress. */
export interface LiveTake {
  startTick: Tick;
  notes: (RecordedNote & { held: boolean })[];
}

/**
 * What the preset editor shows: the selected track's preset, or the clip preset of the clips
 * selected on that track ('mixed' when they use different presets).
 */
export type PresetView =
  | {
      kind: 'track';
      track: Track;
      trackIndex: number;
      preset: Preset;
      target: PresetTarget;
      /** Clips that use this preset too (editing makes the track switch to a copy). */
      clipCount: number;
    }
  | {
      kind: 'clip';
      track: Track;
      trackIndex: number;
      preset: Preset;
      target: PresetTarget;
      /** The selected clips on this track. */
      clipIds: string[];
      /** Every clip that uses this preset (editing changes all of them). */
      clipCount: number;
      /** Whether it's also the track preset (editing changes that too). */
      isTrackPreset: boolean;
      /** Whether Make unique would do anything. */
      canMakeUnique: boolean;
    }
  | { kind: 'mixed'; track: Track; trackIndex: number; clipIds: string[] };

export interface Notice {
  kind: 'info' | 'error';
  text: string;
}

/** How long auditioned notes (piano roll) sound. */
const PREVIEW_MS = 220;
const NOTICE_MS = 5000;

/**
 * App-wide state: the project (through its undo history), the audio engine, live input,
 * and UI state that isn't part of the project (selection, audio status...).
 *
 * Every project change flows History → `project` (for the UI) + patches → engine, and
 * schedules an autosave.
 */
class Session {
  readonly #history = new History<Project>(createProject());
  readonly #engine = new EngineBridge();
  readonly #autosaver = new Autosaver(() => serializeProject(this.#history.state));
  readonly #midi = new MidiInputs(
    (message) => {
      if (message.type === 'noteOn') {
        // Browsers only start audio after a click or key press; MIDI doesn't count.
        if (this.audioStatus !== 'running') {
          this.showNotice(
            'MIDI notes are arriving, but audio is off. Click anywhere to start audio.',
          );
        }
        this.noteOn('midi', message.pitch, message.velocity);
      } else if (message.type === 'noteOff') this.noteOff('midi', message.pitch);
      else this.releaseSource('midi');
    },
    (devices) => {
      this.midiDevices = devices;
      this.releaseSource('midi');
    },
    (data, input) => {
      this.midiActivity++;
      this.midiLastMessage = `${describeMidiMessage(data)} (${input.name ?? 'MIDI input'})`;
    },
  );
  /** "source:pitch" → id of the track the note was sent to, so note-offs reach the same track. */
  readonly #held = new Map<string, string>();

  project = $state.raw<Project>(this.#history.state);
  undoLabel = $state<string | undefined>();
  redoLabel = $state<string | undefined>();
  notice = $state.raw<Notice | null>(null);
  #noticeTimer: ReturnType<typeof setTimeout> | null = null;

  audioStatus = $state<AudioStatus>('off');
  audioError = $state<string | null>(null);
  masterPeak = $state(0);

  selectedTrackIndex = $state(0);
  focusArea = $state<FocusArea>('arrangement');

  /**
   * Whether the computer keyboard plays notes. Off, its letter keys become shortcuts (record,
   * overdub, metronome, clip navigation...). Toggled with the key left of 1.
   */
  keyboardPiano = $state(true);
  keyboardOctave = $state(4);
  keyboardVelocity = $state(100);

  midiStatus = $state<MidiStatus>(midiSupported() ? 'off' : 'unsupported');
  midiError = $state<string | null>(null);
  midiDevices = $state.raw<MidiDevice[]>([]);
  midiSelection = $state<MidiSelection>('all');
  /** Count of incoming MIDI messages (drives the activity light) and the latest one, described. */
  midiActivity = $state(0);
  midiLastMessage = $state<string | null>(null);

  // Transport (mirrors the engine; the engine owns the position while playing).
  playing = $state(false);
  /** Numbers seeks, to ignore engine positions reported before the latest seek arrived. */
  #seekSeq = 0;
  /** Count-in beats left before recording starts (0 when not counting in). */
  countIn = $state(0);
  recordArmed = $state(false);
  overdub = $state(false);
  metronome = $state(false);
  /** Last position reported by (or sent to) the engine. See `playheadAt` for a smooth value. */
  position = $state<Tick>(0);
  #positionTime = 0;
  /**
   * The recording pass in progress, as reported live by the engine (null when not recording).
   * Held notes are still growing: draw them up to the playhead.
   */
  liveTake = $state.raw<LiveTake | null>(null);

  // Clip selection and clipboard (not undoable).
  selectedClipIds = $state.raw<ReadonlySet<string>>(new Set());
  /** Copied clips, each with its preset (in case the original is gone when pasting). */
  #clipboard: { trackOffset: number; clip: Clip; preset: Preset | undefined }[] = [];

  // Bottom panel and piano roll.
  bottomTab = $state<'preset' | 'pianoRoll'>('preset');
  /** The clip shown in the piano roll (follows a single selected clip). */
  editingClip = $state.raw<ClipAddress | null>(null);
  selectedNoteIds = $state.raw<ReadonlySet<string>>(new Set());
  /** Piano roll snap grid in ticks. */
  pianoRollGrid = $state<Tick>(PPQ / 4);
  /** Notes copied in the piano roll, ticks relative to the first one. */
  #noteClipboard: Note[] = [];

  constructor() {
    this.#history.subscribe(({ state, patches }) => {
      this.project = state;
      this.undoLabel = this.#history.undoLabel;
      this.redoLabel = this.#history.redoLabel;
      if (this.selectedTrackIndex >= state.tracks.length) {
        this.selectedTrackIndex = Math.max(0, state.tracks.length - 1);
      }
      if (patches.length > 0) {
        this.#engine.send({ type: 'applyPatches', patches });
        this.#autosaver.schedule();
      }
    });
    this.#engine.subscribe((message) => {
      if (message.type === 'error') {
        console.error('Audio engine error:', message.message);
        this.audioStatus = 'error';
        this.audioError = message.message.split('\n')[0] ?? message.message;
        this.showNotice(
          `The audio engine hit an error: ${this.audioError}. Reloading the page usually fixes it.`,
          'error',
        );
      } else if (message.type === 'meters') {
        this.masterPeak = message.master;
      } else if (message.type === 'transport') {
        this.playing = message.playing;
        this.countIn = message.countIn;
        // A report from before the engine got our latest seek would move the playhead back.
        if (message.seekSeq >= this.#seekSeq) this.#setPosition(message.tick);
      } else if (message.type === 'takeStarted') {
        this.liveTake = { startTick: message.startTick, notes: [] };
      } else if (message.type === 'takeNote') {
        const notes = [...(this.liveTake?.notes ?? [])];
        notes[message.index] = { ...message.note, held: message.held };
        this.liveTake = { startTick: this.liveTake?.startTick ?? message.note.startTick, notes };
      } else if (message.type === 'recorded') {
        this.liveTake = null;
        if (message.take.notes.length > 0) this.run(recordTake(message.take, this.overdub));
      }
    });
  }

  get selectedTrack(): Track | undefined {
    return this.project.tracks[this.selectedTrackIndex];
  }

  /** The selected track's track preset. */
  get selectedTrackPreset(): Preset | undefined {
    const track = this.selectedTrack;
    return track ? findPresetById(this.project, track.presetId) : undefined;
  }

  /** What the preset editor shows (see PresetView). */
  get presetView(): PresetView | null {
    const project = this.project;
    const track = this.selectedTrack;
    if (!track) return null;
    const trackIndex = this.selectedTrackIndex;
    const clips = track.clips.filter((c) => this.selectedClipIds.has(c.id));
    if (clips.length === 0) {
      const preset = findPresetById(project, track.presetId);
      if (!preset) return null;
      const clipCount = presetUsage(project, preset.id).clipIds.length;
      return { kind: 'track', track, trackIndex, preset, target: { trackId: track.id }, clipCount };
    }
    const clipIds = clips.map((c) => c.id);
    const presetIds = new Set(clips.map((c) => c.presetId));
    const preset = presetIds.size === 1 ? findPresetById(project, clips[0]!.presetId) : undefined;
    if (!preset) return { kind: 'mixed', track, trackIndex, clipIds };
    return {
      kind: 'clip',
      track,
      trackIndex,
      preset,
      target: { presetId: preset.id },
      clipIds,
      clipCount: presetUsage(project, preset.id).clipIds.length,
      isTrackPreset: track.presetId === preset.id,
      canMakeUnique: canMakeUnique(project, clipIds),
    };
  }

  // --- Project editing -------------------------------------------------------------------

  run(command: ProjectCommand): void {
    this.#history.run(command);
  }

  /**
   * Runs a preset edit (box param, chain change, rename). If it made a track switch to a copy
   * of its preset (copy on write, because clips use it), says so: the name changes under you.
   */
  runPresetEdit(command: ProjectCommand): void {
    const before = new Map(this.project.tracks.map((t) => [t.id, t.presetId]));
    this.run(command);
    for (const track of this.project.tracks) {
      const old = before.get(track.id);
      if (!old || old === track.presetId) continue;
      const original = findPresetById(this.project, old);
      const copy = findPresetById(this.project, track.presetId);
      if (original && copy) {
        this.showNotice(
          `${track.name} now plays a copy, "${copy.name}". Recorded clips keep "${original.name}".`,
        );
      }
    }
  }

  /** Groups the following `run` calls into one undo step, e.g. for a knob drag. */
  begin(label: string): void {
    this.#history.begin(label);
  }

  commit(): void {
    this.#history.commit();
  }

  undo(): void {
    this.#history.undo();
  }

  redo(): void {
    this.#history.redo();
  }

  showNotice(text: string, kind: Notice['kind'] = 'info'): void {
    this.notice = { kind, text };
    if (this.#noticeTimer !== null) clearTimeout(this.#noticeTimer);
    this.#noticeTimer = setTimeout(() => (this.notice = null), NOTICE_MS);
  }

  // --- UI state ---------------------------------------------------------------------------

  selectTrack(index: number): void {
    if (index >= 0 && index < this.project.tracks.length) this.selectedTrackIndex = index;
  }

  // --- Live notes -------------------------------------------------------------------------

  /** Plays a note on the selected track. */
  noteOn(source: NoteSource, pitch: number, velocity: number): void {
    const track = this.selectedTrack;
    if (!track) return;
    const key = `${source}:${pitch}`;
    const previous = this.#held.get(key);
    if (previous) this.#engine.send({ type: 'noteOff', trackId: previous, pitch });
    this.#held.set(key, track.id);
    this.#engine.send({ type: 'noteOn', trackId: track.id, pitch, velocity });
  }

  noteOff(source: NoteSource, pitch: number): void {
    const key = `${source}:${pitch}`;
    const trackId = this.#held.get(key);
    if (!trackId) return;
    this.#held.delete(key);
    this.#engine.send({ type: 'noteOff', trackId, pitch });
  }

  /** Releases every note held by one input source. */
  releaseSource(source: NoteSource): void {
    for (const key of [...this.#held.keys()]) {
      if (key.startsWith(`${source}:`)) this.noteOff(source, Number(key.slice(source.length + 1)));
    }
  }

  /** Panic: releases every note on every track. */
  allNotesOff(): void {
    this.#held.clear();
    this.#engine.send({ type: 'allNotesOff' });
  }

  /** Turns the computer keyboard piano on or off (off: letter keys are shortcuts). */
  toggleKeyboardPiano(): void {
    this.keyboardPiano = !this.keyboardPiano;
    this.releaseSource('keyboard');
    this.showNotice(
      this.keyboardPiano
        ? 'Computer keyboard plays notes.'
        : 'Computer keyboard shortcuts: R record, O overdub, M metronome, arrows select clips, A/D clip edges, Enter piano roll, U/P/T clip preset buttons.',
    );
  }

  shiftOctave(delta: 1 | -1): void {
    this.keyboardOctave = Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, this.keyboardOctave + delta));
  }

  shiftVelocity(delta: 1 | -1): void {
    this.keyboardVelocity = shiftVelocity(this.keyboardVelocity, delta);
  }

  /**
   * Auditions a note briefly on a track (piano roll clicks), through a clip preset when given.
   * Not recorded.
   */
  previewNote(trackId: string, pitch: number, velocity = 100, presetId?: string): void {
    void this.startAudio();
    this.#engine.send({ type: 'noteOn', trackId, pitch, velocity, record: false, presetId });
    setTimeout(() => this.#engine.send({ type: 'noteOff', trackId, pitch }), PREVIEW_MS);
  }

  // --- Transport --------------------------------------------------------------------------

  /** Smooth playhead for drawing: the last reported position, advanced by elapsed time. */
  playheadAt(now: number = performance.now()): Tick {
    if (!this.playing) return this.position;
    const bpm = bpmAt(this.project.tempoMap, this.position);
    return this.position + ((now - this.#positionTime) / 1000) * ticksPerSecond(bpm);
  }

  #setPosition(tick: Tick): void {
    this.position = tick;
    this.#positionTime = performance.now();
  }

  togglePlay(): void {
    if (this.playing || this.countIn > 0) this.pause();
    else this.play();
  }

  /** Starts playback; with Record armed, the engine counts in first. */
  play(): void {
    void this.startAudio();
    if (this.recordArmed) {
      this.countIn = COUNT_IN_BEATS; // the engine reports the real count as it goes
    } else {
      this.playing = true;
      this.#positionTime = performance.now();
    }
    this.#engine.send({ type: 'play' });
  }

  /** Pauses playback, or cancels a count-in. */
  pause(): void {
    this.playing = false;
    this.countIn = 0;
    this.#engine.send({ type: 'pause' });
  }

  seek(tick: Tick): void {
    const target = Math.max(0, tick);
    this.#setPosition(target);
    this.#engine.send({ type: 'seek', tick: target, seq: ++this.#seekSeq });
  }

  toggleRecord(): void {
    this.recordArmed = !this.recordArmed;
    this.#engine.send({ type: 'setRecord', armed: this.recordArmed });
  }

  toggleOverdub(): void {
    this.overdub = !this.overdub;
    this.#engine.send({ type: 'setOverdub', enabled: this.overdub });
  }

  toggleMetronome(): void {
    this.metronome = !this.metronome;
    this.#engine.send({ type: 'setMetronome', enabled: this.metronome });
  }

  // --- Clips ------------------------------------------------------------------------------

  /** Selects clips. A single selected clip also becomes the piano roll's clip. */
  selectClips(ids: Iterable<string>): void {
    this.selectedClipIds = new Set(ids);
    if (this.selectedClipIds.size !== 1) return;
    const [id] = this.selectedClipIds;
    const track = this.project.tracks.find((t) => t.clips.some((c) => c.id === id));
    if (track && id !== this.editingClip?.clipId) {
      this.editingClip = { trackId: track.id, clipId: id! };
      this.selectedNoteIds = new Set();
    }
  }

  /** Clips in selection order of tracks, with their track index. */
  #selectedClips(): { trackIndex: number; clip: Clip }[] {
    const ids = this.selectedClipIds;
    return this.project.tracks.flatMap((track, trackIndex) =>
      track.clips.filter((c) => ids.has(c.id)).map((clip) => ({ trackIndex, clip })),
    );
  }

  deleteSelectedClips(): void {
    if (this.selectedClipIds.size === 0) return;
    this.run(deleteClips(this.selectedClipIds));
    this.selectedClipIds = new Set();
  }

  copySelectedClips(): void {
    const selected = this.#selectedClips();
    if (selected.length === 0) return;
    const firstTrack = Math.min(...selected.map((s) => s.trackIndex));
    const firstTick = Math.min(...selected.map((s) => s.clip.startTick));
    this.#clipboard = selected.map(({ trackIndex, clip }) => ({
      trackOffset: trackIndex - firstTrack,
      clip: { ...clip, startTick: clip.startTick - firstTick },
      preset: findPresetById(this.project, clip.presetId),
    }));
  }

  /** Pastes clips at the playhead, starting on the selected track. */
  pasteClips(): void {
    if (this.#clipboard.length === 0) return;
    const at = this.position;
    const placements = this.#clipboard.flatMap(({ trackOffset, clip, preset }) => {
      const track = this.project.tracks[this.selectedTrackIndex + trackOffset];
      if (!track) return [];
      return [{ trackId: track.id, clip: cloneClip(clip, at + clip.startTick), preset }];
    });
    this.#placeAndSelect(placements, 'Paste');
  }

  /** Copies the selection right after itself. */
  duplicateSelectedClips(): void {
    const selected = this.#selectedClips();
    if (selected.length === 0) return;
    const start = Math.min(...selected.map((s) => s.clip.startTick));
    const end = Math.max(...selected.map((s) => s.clip.startTick + s.clip.lengthTicks));
    const placements = selected.map(({ trackIndex, clip }) => ({
      trackId: this.project.tracks[trackIndex]!.id,
      clip: cloneClip(clip, clip.startTick + (end - start)),
    }));
    this.#placeAndSelect(placements, 'Duplicate');
  }

  /** Creates an empty one-bar clip with the track preset (for drawing notes in the piano roll). */
  createEmptyClip(trackIndex: number, startTick: Tick): void {
    const track = this.project.tracks[trackIndex];
    if (!track) return;
    const bar = ticksPerBar(this.project.tempoMap.meters[0]!);
    const clip = createClip(startTick, bar, track.presetId);
    this.#placeAndSelect([{ trackId: track.id, clip }], 'Add clip');
  }

  // --- Keyboard navigation ---------------------------------------------------------------

  /** The clip keyboard navigation starts from: a selected clip, on the selected track first. */
  #anchorClip(): { trackIndex: number; clipId: string } | null {
    const ids = this.selectedClipIds;
    if (ids.size === 0) return null;
    const tracks = this.project.tracks;
    const order = [this.selectedTrackIndex, ...tracks.keys()];
    for (const trackIndex of order) {
      const clip = tracks[trackIndex]?.clips.find((c) => ids.has(c.id));
      if (clip) return { trackIndex, clipId: clip.id };
    }
    return null;
  }

  #selectClipAt(trackIndex: number, clipId: string): void {
    this.selectTrack(trackIndex);
    this.selectClips([clipId]);
    this.focusArea = 'arrangement';
  }

  /**
   * Arrow keys: select the neighbouring clip of the selected one, or with none selected the
   * clip closest to the playhead. Returns false when there's nowhere to go.
   */
  selectAdjacentClip(direction: Direction): boolean {
    const tracks = this.project.tracks;
    const anchor = this.#anchorClip();
    const target = anchor
      ? adjacentClip(tracks, anchor, direction)
      : closestClip(tracks, this.selectedTrackIndex, this.position);
    if (!target) return false;
    this.#selectClipAt(target.trackIndex, target.clipId);
    return true;
  }

  /**
   * A (-1) / D (+1): moves the playhead to the previous/next clip edge on the selected track,
   * selecting that clip (so pressing again walks from clip to clip).
   */
  jumpToClipEdge(direction: 1 | -1): void {
    const track = this.selectedTrack;
    if (!track) return;
    const selected = track.clips.find((c) => this.selectedClipIds.has(c.id))?.id;
    const jump = clipEdgeJump(track, this.position, direction, selected);
    if (!jump) return;
    this.seek(jump.tick);
    this.#selectClipAt(this.selectedTrackIndex, jump.clipId);
  }

  /** Enter: opens the selected clip in the piano roll. */
  openSelectedClip(): void {
    const anchor = this.#anchorClip();
    if (anchor) this.openPianoRoll(anchor.trackIndex, anchor.clipId);
    else this.showNotice('Select a clip to open it in the piano roll.');
  }

  // --- Clip presets -----------------------------------------------------------------------

  /** Clips selected on the selected track (the ones the clip preset buttons act on). */
  #presetClipIds(): string[] {
    const view = this.presetView;
    return view && view.kind !== 'track' ? view.clipIds : [];
  }

  makeSelectedClipsUnique(): void {
    const ids = this.#presetClipIds();
    if (ids.length > 0 && canMakeUnique(this.project, ids)) this.run(makeClipsUnique(ids));
  }

  useTrackPresetForSelectedClips(): void {
    const ids = this.#presetClipIds();
    if (ids.length > 0) this.run(useTrackPreset(ids));
  }

  /** Makes the selected clips' preset the track preset (when they share one). */
  loadSelectedClipPresetToTrack(): void {
    const view = this.presetView;
    if (view?.kind === 'clip' && !view.isTrackPreset) {
      this.run(loadClipPresetToTrack(view.clipIds[0]!));
    }
  }

  /**
   * The U / P / T shortcuts: the clip preset buttons, saying why when they can't apply (the
   * buttons are disabled in those cases instead).
   */
  clipPresetShortcut(action: 'unique' | 'useTrack' | 'loadToTrack'): void {
    const view = this.presetView;
    if (!view || view.kind === 'track') {
      this.showNotice('Select a clip on this track first.');
    } else if (action === 'useTrack') {
      if (view.kind === 'clip' && view.isTrackPreset) {
        this.showNotice('The clip already uses the track preset.');
      } else this.useTrackPresetForSelectedClips();
    } else if (view.kind === 'mixed') {
      this.showNotice('The selected clips use different presets. Select one clip.');
    } else if (action === 'unique') {
      if (view.canMakeUnique) this.makeSelectedClipsUnique();
      else this.showNotice('Nothing else uses this preset: it is already unique.');
    } else if (view.isTrackPreset) {
      this.showNotice(`This is already the ${view.track.name} preset.`);
    } else {
      this.loadSelectedClipPresetToTrack();
    }
  }

  /** Shows the track preset in the editor (deselects the clips). */
  showTrackPreset(): void {
    this.selectedClipIds = new Set();
  }

  #placeAndSelect(placements: ClipPlacement[], label: string): void {
    if (placements.length === 0) return;
    this.run(placeClips(placements, label));
    this.selectClips(placements.map((p) => p.clip.id));
  }

  // --- Piano roll -------------------------------------------------------------------------

  /** The piano roll's clip and its track, or null if there is none (or it was deleted). */
  get editing(): { track: Track; trackIndex: number; clip: Clip } | null {
    const address = this.editingClip;
    if (!address) return null;
    const trackIndex = this.project.tracks.findIndex((t) => t.id === address.trackId);
    const track = this.project.tracks[trackIndex];
    const clip = track?.clips.find((c) => c.id === address.clipId);
    return track && clip ? { track, trackIndex, clip } : null;
  }

  openPianoRoll(trackIndex: number, clipId: string): void {
    this.selectTrack(trackIndex);
    this.selectClips([clipId]);
    this.bottomTab = 'pianoRoll';
    this.focusArea = 'pianoRoll';
  }

  selectNotes(ids: Iterable<string>): void {
    this.selectedNoteIds = new Set(ids);
  }

  #selectedNotes(): Note[] {
    const clip = this.editing?.clip;
    return clip ? clip.notes.filter((n) => this.selectedNoteIds.has(n.id)) : [];
  }

  /**
   * Arrow keys in the piano roll: transpose (semitones) or move (grid steps) the selection.
   * Returns false when there's nothing to nudge, so the key keeps its default behaviour.
   */
  nudgeNotes(semitones: number, steps: number): boolean {
    const editing = this.editing;
    if (!this.#notesFocused() || !editing) return false;
    const notes = this.#selectedNotes();
    if (notes.length === 0) return false;
    const dt = steps * this.pianoRollGrid;
    const changes: NoteChange[] = notes.map((n) => ({
      id: n.id,
      pitch: n.pitch + semitones,
      tick: Math.min(editing.clip.lengthTicks - 1, Math.max(0, n.tick + dt)),
    }));
    this.run(updateNotes(this.editingClip!, changes, semitones ? 'Transpose' : 'Move notes'));
    if (semitones && notes.length === 1) {
      const pitch = Math.min(127, Math.max(0, notes[0]!.pitch + semitones));
      this.previewNote(editing.track.id, pitch, 100, editing.clip.presetId);
    }
    return true;
  }

  // --- Commands that act on the focused editor (notes in the piano roll, else clips) ---

  #notesFocused(): boolean {
    return this.focusArea === 'pianoRoll' && this.bottomTab === 'pianoRoll' && !!this.editing;
  }

  deleteSelection(): void {
    if (this.#notesFocused()) {
      if (this.selectedNoteIds.size === 0) return;
      this.run(deleteNotes(this.editingClip!, this.selectedNoteIds));
      this.selectedNoteIds = new Set();
    } else {
      this.deleteSelectedClips();
    }
  }

  copySelection(): void {
    if (!this.#notesFocused()) return this.copySelectedClips();
    const notes = this.#selectedNotes();
    if (notes.length === 0) return;
    const first = Math.min(...notes.map((n) => n.tick));
    this.#noteClipboard = notes.map((n) => ({ ...n, tick: n.tick - first }));
  }

  /** In the piano roll: pastes notes at the playhead (or the clip start if it's outside). */
  paste(): void {
    const editing = this.editing;
    if (!this.#notesFocused() || !editing) return this.pasteClips();
    if (this.#noteClipboard.length === 0) return;
    const { clip } = editing;
    const inside =
      this.position >= clip.startTick && this.position < clip.startTick + clip.lengthTicks;
    const at = inside ? this.position - clip.startTick : 0;
    this.#addNotesAndSelect(
      this.#noteClipboard.map((n) => ({ ...n, id: createId(), tick: at + n.tick })),
      'Paste notes',
    );
  }

  duplicateSelection(): void {
    if (!this.#notesFocused()) return this.duplicateSelectedClips();
    const notes = this.#selectedNotes();
    if (notes.length === 0) return;
    const start = Math.min(...notes.map((n) => n.tick));
    const end = Math.max(...notes.map((n) => n.tick + n.durationTicks));
    this.#addNotesAndSelect(
      notes.map((n) => ({ ...n, id: createId(), tick: n.tick + (end - start) })),
      'Duplicate notes',
    );
  }

  selectAll(): void {
    if (this.#notesFocused()) {
      this.selectNotes(this.editing!.clip.notes.map((n) => n.id));
    } else {
      this.selectClips(this.project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
    }
  }

  clearSelection(): void {
    if (this.#notesFocused()) this.selectedNoteIds = new Set();
    else this.selectedClipIds = new Set();
  }

  #addNotesAndSelect(notes: Note[], label: string): void {
    if (!this.editingClip || notes.length === 0) return;
    this.run(addNotes(this.editingClip, notes, label));
    this.selectedNoteIds = new Set(notes.map((n) => n.id));
  }

  // --- Files ------------------------------------------------------------------------------

  /** Replaces the project (open, new, restore): clears undo, selection and transport state. */
  #loadProject(project: Project): void {
    this.pause();
    this.seek(0);
    this.allNotesOff();
    this.liveTake = null;
    this.selectedClipIds = new Set();
    this.selectedNoteIds = new Set();
    this.editingClip = null;
    this.bottomTab = 'preset';
    this.selectedTrackIndex = 0;
    this.#history.reset(project);
    this.undoLabel = undefined;
    this.redoLabel = undefined;
    void this.#autosaver.flush();
  }

  newProject(): void {
    const hasWork = this.#history.canUndo || this.project.tracks.some((t) => t.clips.length > 0);
    if (hasWork && !confirm('Start a new project? Export this one first if you want to keep it.')) {
      return;
    }
    this.#loadProject(createProject());
    this.showNotice('New project');
  }

  async importProject(): Promise<void> {
    try {
      const file = await openTextFile(PROJECT_FILE);
      if (!file) return;
      const project = parseProject(file.text);
      this.#loadProject({ ...project, name: projectNameFromFile(file.name) });
      this.showNotice(`Opened ${file.name}`);
    } catch (error) {
      this.showNotice(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async exportProject(): Promise<void> {
    try {
      const name = await saveFile(
        serializeProject(this.project),
        projectFileName(this.project),
        PROJECT_FILE,
      );
      if (!name) return;
      const newName = projectNameFromFile(name);
      if (newName !== this.project.name) this.run(setProjectName(newName));
      this.showNotice(`Saved ${name}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.showNotice(`Couldn't save: ${reason}`, 'error');
    }
  }

  /** True while a WAV export is rendering. */
  exportingWav = $state(false);

  /**
   * Renders the song (from the start to the end of the last clip, plus effect tails) to a
   * 44.1 kHz / 16-bit WAV file in a background worker. Asks where to save first, because the
   * save dialog only opens straight after a click.
   */
  async exportWav(): Promise<void> {
    if (this.exportingWav) return;
    const project = this.project;
    if (songEndTick(project) === 0) {
      this.showNotice('Nothing to export yet: the song has no clips.', 'error');
      return;
    }
    try {
      const target = await chooseSaveTarget(`${project.name}.wav`, WAV_FILE);
      if (!target) return;
      this.exportingWav = true;
      this.showNotice('Rendering WAV… 0%');
      const { wav, seconds } = await new Promise<{ wav: ArrayBuffer; seconds: number }>(
        (resolve, reject) => {
          const worker = new Worker(new URL('../../audio/render.worker.ts', import.meta.url), {
            type: 'module',
          });
          worker.onmessage = (event: MessageEvent<RenderReply>) => {
            const message = event.data;
            if (message.type === 'progress') {
              this.showNotice(`Rendering WAV… ${Math.round(message.fraction * 100)}%`);
              return;
            }
            worker.terminate();
            if (message.type === 'done') resolve(message);
            else reject(new Error(message.message));
          };
          worker.onerror = (event) => {
            worker.terminate();
            reject(new Error(event.message || 'The render worker failed'));
          };
          const request: RenderRequest = { project, sampleRate: 44100, bitDepth: 16 };
          worker.postMessage(request);
        },
      );
      await target.write(new Blob([wav], { type: WAV_FILE.mime }));
      this.showNotice(`Saved ${target.name} (${seconds.toFixed(1)} s)`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.showNotice(`Couldn't export WAV: ${reason}`, 'error');
    } finally {
      this.exportingWav = false;
    }
  }

  /** Restores the autosaved project on startup, unless the user already started editing. */
  async restoreAutosave(): Promise<void> {
    let text: string | null;
    try {
      text = await loadAutosave();
    } catch {
      return; // storage unavailable: start fresh
    }
    if (!text || this.#history.canUndo) return;
    try {
      this.#loadProject(parseProject(text));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.showNotice(`Couldn't restore the autosaved project: ${reason}`, 'error');
    }
  }

  /** Saves immediately (e.g. when the page is being hidden or closed). */
  flushAutosave(): Promise<void> {
    return this.#autosaver.flush();
  }

  // --- MIDI -------------------------------------------------------------------------------

  /** Requests MIDI access (may show a browser permission prompt). Call from a user action. */
  async enableMidi(): Promise<void> {
    if (this.midiStatus === 'connecting' || this.midiStatus === 'unsupported') return;
    this.midiStatus = 'connecting';
    try {
      this.midiDevices = await this.#midi.enable();
      this.#midi.select(this.midiSelection === 'none' ? 'all' : this.midiSelection);
      if (this.midiSelection === 'none') this.midiSelection = 'all';
      this.midiStatus = 'ready';
      this.midiError = null;
    } catch (error) {
      this.midiStatus = 'error';
      this.midiError = error instanceof Error ? error.message : String(error);
    }
  }

  selectMidi(selection: MidiSelection): void {
    this.releaseSource('midi');
    this.midiSelection = selection;
    this.#midi.select(selection);
  }

  // --- Audio ------------------------------------------------------------------------------

  /** Starts audio. Must be called from a user gesture (click, key press). */
  async startAudio(): Promise<void> {
    // While 'starting', calling again is deliberate: the bridge reuses the pending start, and a
    // context waiting for a user gesture gets resumed by this (newer) gesture.
    if (this.audioStatus === 'running') return;
    this.audioStatus = 'starting';
    try {
      await this.#engine.start(() => [
        { type: 'loadProject', project: this.#history.state },
        { type: 'setMetronome', enabled: this.metronome },
        { type: 'setRecord', armed: this.recordArmed },
        { type: 'setOverdub', enabled: this.overdub },
        { type: 'seek', tick: this.position, seq: ++this.#seekSeq },
      ]);
      this.audioStatus = 'running';
      this.audioError = null;
    } catch (error) {
      this.audioStatus = 'error';
      this.audioError = error instanceof Error ? error.message : String(error);
    }
  }
}

export const session = new Session();

// In development, a code change to the session or anything it imports (model, engine, audio
// bridge) reloads the page instead of hot-swapping modules: hot-swapping would leave the old
// audio engine running next to a fresh session (stale playhead, double audio). The autosave is
// flushed on `pagehide`, so the project survives the reload.
if (import.meta.hot) {
  import.meta.hot.accept(() => location.reload());
}
