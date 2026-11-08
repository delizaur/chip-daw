import { EngineBridge } from '../../audio/bridge';
import { MidiInputs, midiSupported, type MidiDevice, type MidiSelection } from '../../audio/midi';
import type { ProjectCommand } from '../../model/commands';
import { createProject } from '../../model/defaults';
import { History } from '../../model/history';
import type { Project, Track } from '../../model/types';
import { MAX_OCTAVE, MIN_OCTAVE, shiftVelocity } from '../input/computer-keyboard';

export type AudioStatus = 'off' | 'starting' | 'running' | 'error';
export type MidiStatus = 'off' | 'connecting' | 'ready' | 'unsupported' | 'error';
/** Where a live note came from. Each source's held notes are tracked separately. */
export type NoteSource = 'keyboard' | 'midi';

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
      if (message.type === 'meters') this.masterPeak = message.master;
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
      await this.#engine.start(() => this.#history.state);
      this.audioStatus = 'running';
      this.audioError = null;
    } catch (error) {
      this.audioStatus = 'error';
      this.audioError = error instanceof Error ? error.message : String(error);
    }
  }
}

export const session = new Session();
