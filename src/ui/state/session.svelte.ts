import { EngineBridge } from '../../audio/bridge';
import { MidiInputs, midiSupported, type MidiDevice, type MidiSelection } from '../../audio/midi';
import { cloneClip, createClip } from '../../model/clips';
import {
  deleteClips,
  placeClips,
  recordTake,
  type ClipPlacement,
  type RecordedNote,
  type ProjectCommand,
} from '../../model/commands';
import { createProject } from '../../model/defaults';
import { History } from '../../model/history';
import { bpmAt, ticksPerBar, ticksPerSecond } from '../../model/time';
import type { Clip, Project, Tick, Track } from '../../model/types';
import { MAX_OCTAVE, MIN_OCTAVE, shiftVelocity } from '../input/computer-keyboard';

export type AudioStatus = 'off' | 'starting' | 'running' | 'error';
export type MidiStatus = 'off' | 'connecting' | 'ready' | 'unsupported' | 'error';
/** Where a live note came from. Each source's held notes are tracked separately. */
export type NoteSource = 'keyboard' | 'midi';

/** A recording pass in progress. */
export interface LiveTake {
  startTick: Tick;
  notes: (RecordedNote & { held: boolean })[];
}

/**
 * App-wide state: the project (through its undo history), the audio engine, live input,
 * and UI state that isn't part of the project (selection, audio status...).
 *
 * Every project change flows History → `project` (for the UI) + patches → engine.
 */
class Session {
  readonly #history = new History<Project>(createProject());
  readonly #engine = new EngineBridge();
  readonly #midi = new MidiInputs(
    (message) => {
      if (message.type === 'noteOn') this.noteOn('midi', message.pitch, message.velocity);
      else if (message.type === 'noteOff') this.noteOff('midi', message.pitch);
      else this.releaseSource('midi');
    },
    (devices) => {
      this.midiDevices = devices;
      this.releaseSource('midi');
    },
  );
  /** "source:pitch" → id of the track the note was sent to, so note-offs reach the same track. */
  readonly #held = new Map<string, string>();

  project = $state.raw<Project>(this.#history.state);
  undoLabel = $state<string | undefined>();
  redoLabel = $state<string | undefined>();

  audioStatus = $state<AudioStatus>('off');
  audioError = $state<string | null>(null);
  masterPeak = $state(0);

  selectedTrackIndex = $state(0);

  keyboardOctave = $state(4);
  keyboardVelocity = $state(100);

  midiStatus = $state<MidiStatus>(midiSupported() ? 'off' : 'unsupported');
  midiError = $state<string | null>(null);
  midiDevices = $state.raw<MidiDevice[]>([]);
  midiSelection = $state<MidiSelection>('all');

  // Transport (mirrors the engine; the engine owns the position while playing).
  playing = $state(false);
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
  #clipboard: { trackOffset: number; clip: Clip }[] = [];

  constructor() {
    this.#history.subscribe(({ state, patches }) => {
      this.project = state;
      this.undoLabel = this.#history.undoLabel;
      this.redoLabel = this.#history.redoLabel;
      if (this.selectedTrackIndex >= state.tracks.length) {
        this.selectedTrackIndex = Math.max(0, state.tracks.length - 1);
      }
      if (patches.length > 0) this.#engine.send({ type: 'applyPatches', patches });
    });
    this.#engine.subscribe((message) => {
      if (message.type === 'meters') {
        this.masterPeak = message.master;
      } else if (message.type === 'transport') {
        this.playing = message.playing;
        this.#setPosition(message.tick);
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

  // --- Project editing -------------------------------------------------------------------

  run(command: ProjectCommand): void {
    this.#history.run(command);
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

  shiftOctave(delta: 1 | -1): void {
    this.keyboardOctave = Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, this.keyboardOctave + delta));
  }

  shiftVelocity(delta: 1 | -1): void {
    this.keyboardVelocity = shiftVelocity(this.keyboardVelocity, delta);
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
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    void this.startAudio();
    this.playing = true;
    this.#positionTime = performance.now();
    this.#engine.send({ type: 'play' });
  }

  pause(): void {
    this.playing = false;
    this.#engine.send({ type: 'pause' });
  }

  seek(tick: Tick): void {
    const target = Math.max(0, tick);
    this.#setPosition(target);
    this.#engine.send({ type: 'seek', tick: target });
  }

  toggleRecord(): void {
    this.recordArmed = !this.recordArmed;
    this.#engine.send({ type: 'setRecord', armed: this.recordArmed });
  }

  toggleOverdub(): void {
    this.overdub = !this.overdub;
  }

  toggleMetronome(): void {
    this.metronome = !this.metronome;
    this.#engine.send({ type: 'setMetronome', enabled: this.metronome });
  }

  // --- Clips ------------------------------------------------------------------------------

  selectClips(ids: Iterable<string>): void {
    this.selectedClipIds = new Set(ids);
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
    }));
  }

  /** Pastes at the playhead, starting on the selected track. */
  paste(): void {
    if (this.#clipboard.length === 0) return;
    const at = this.position;
    const placements = this.#clipboard.flatMap(({ trackOffset, clip }) => {
      const track = this.project.tracks[this.selectedTrackIndex + trackOffset];
      return track ? [{ trackId: track.id, clip: cloneClip(clip, at + clip.startTick) }] : [];
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

  /** Creates an empty one-bar clip (for drawing notes in the piano roll). */
  createEmptyClip(trackIndex: number, startTick: Tick): void {
    const track = this.project.tracks[trackIndex];
    if (!track) return;
    const bar = ticksPerBar(this.project.tempoMap.meters[0]!);
    this.#placeAndSelect([{ trackId: track.id, clip: createClip(startTick, bar) }], 'Add clip');
  }

  #placeAndSelect(placements: ClipPlacement[], label: string): void {
    if (placements.length === 0) return;
    this.run(placeClips(placements, label));
    this.selectedClipIds = new Set(placements.map((p) => p.clip.id));
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
    if (this.audioStatus === 'running' || this.audioStatus === 'starting') return;
    this.audioStatus = 'starting';
    try {
      await this.#engine.start(() => [
        { type: 'loadProject', project: this.#history.state },
        { type: 'setMetronome', enabled: this.metronome },
        { type: 'setRecord', armed: this.recordArmed },
        { type: 'seek', tick: this.position },
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
