import { applyPatches, enablePatches } from 'immer';
import type { RecordedNote, RecordedTake } from '../model/commands';
import type { Project, Tick } from '../model/types';
import { bpmAt, ticksPerBar, ticksPerBeat, ticksPerSecond } from '../model/time';
import { SmoothedValue, softClip, volumeToGain } from './dsp';
import { Metronome } from './metronome';
import type { EngineToUi, UiToEngine } from './protocol';
import { TrackRuntime, type PlayWindow } from './track';

enablePatches();

/** How often meters and the transport position are reported to the UI. */
const REPORT_RATE_HZ = 30;

interface Take {
  startTick: Tick;
  notes: RecordedNote[];
  /** "trackId:pitch" → index in `notes` of the note still held. */
  held: Map<string, number>;
}

/**
 * The audio engine. Pure TypeScript: no DOM, Web Audio or Node APIs, so it can run inside
 * the AudioWorklet, in a Worker for offline rendering, and in unit tests.
 *
 * Real-time rule: `process` must not allocate. Allocation is only allowed in `handle`,
 * i.e. when the project or transport changes. The one exception is the throttled report
 * messages, since posting a message to the UI allocates anyway.
 */
export class Engine {
  readonly sampleRate: number;
  #project: Project | null = null;
  readonly #emit: (message: EngineToUi) => void;
  #tracks: TrackRuntime[] = [];
  readonly #tracksById = new Map<string, TrackRuntime>();
  readonly #masterGain: SmoothedValue;
  readonly #metronome: Metronome;
  #mixLeft = new Float32Array(128);
  #mixRight = new Float32Array(128);

  // Transport
  #playing = false;
  #position: Tick = 0;
  #recordArmed = false;
  #latencySeconds = 0;
  #take: Take | null = null;
  readonly #window: PlayWindow = { start: 0, end: 0, ticksPerSample: 0 };

  // Reporting
  readonly #reportInterval: number;
  #framesSinceReport = 0;
  #masterPeak = 0;
  #lastReportedPeak = -1;

  constructor(sampleRate: number, emit: (message: EngineToUi) => void) {
    this.sampleRate = sampleRate;
    this.#emit = emit;
    this.#masterGain = new SmoothedValue(0, sampleRate);
    this.#metronome = new Metronome(sampleRate);
    this.#reportInterval = Math.round(sampleRate / REPORT_RATE_HZ);
  }

  get project(): Project | null {
    return this.#project;
  }

  get playing(): boolean {
    return this.#playing;
  }

  get position(): Tick {
    return this.#position;
  }

  handle(message: UiToEngine): void {
    switch (message.type) {
      case 'loadProject':
        this.#project = message.project;
        this.#sync();
        break;
      case 'applyPatches':
        if (!this.#project) break;
        this.#project = applyPatches(this.#project, message.patches);
        this.#sync();
        break;
      case 'noteOn':
        this.#tracksById.get(message.trackId)?.noteOn(message.pitch, message.velocity);
        if (message.record !== false) {
          this.#recordNoteOn(message.trackId, message.pitch, message.velocity);
        }
        break;
      case 'noteOff':
        this.#tracksById.get(message.trackId)?.noteOff(message.pitch);
        this.#recordNoteOff(message.trackId, message.pitch);
        break;
      case 'allNotesOff':
        for (const track of this.#tracks) track.allNotesOff();
        this.#releaseHeldTakeNotes();
        break;
      case 'play':
        if (this.#playing) break;
        this.#playing = true;
        for (const track of this.#tracks) track.locate(this.#position);
        this.#updateTake();
        this.#reportTransport();
        break;
      case 'pause':
        if (!this.#playing) break;
        this.#playing = false;
        for (const track of this.#tracks) track.stopPlayback();
        this.#updateTake();
        this.#reportTransport();
        break;
      case 'seek':
        this.#endTake();
        this.#position = Math.max(0, message.tick);
        for (const track of this.#tracks) track.locate(this.#position);
        this.#updateTake();
        this.#reportTransport();
        break;
      case 'setRecord':
        this.#recordArmed = message.armed;
        this.#updateTake();
        break;
      case 'setMetronome':
        this.#metronome.enabled = message.enabled;
        break;
      case 'setLatency':
        this.#latencySeconds = Math.max(0, message.seconds);
        break;
    }
  }

  /** Brings the runtime graph in line with the project. */
  #sync(): void {
    const project = this.#project;
    if (!project) return;
    this.#masterGain.target = volumeToGain(project.masterVolume);
    const anySolo = project.tracks.some((t) => t.solo);
    const seen = new Set<string>();
    this.#tracks = project.tracks.map((track) => {
      let runtime = this.#tracksById.get(track.id);
      if (!runtime) {
        runtime = new TrackRuntime(track.id, this.sampleRate);
        this.#tracksById.set(track.id, runtime);
      }
      runtime.sync(track, !track.mute && (!anySolo || track.solo), this.#position);
      seen.add(track.id);
      return runtime;
    });
    for (const id of this.#tracksById.keys()) if (!seen.has(id)) this.#tracksById.delete(id);
  }

  // --- Recording ---------------------------------------------------------------------------

  /** Starts or ends the take so it runs exactly while armed and playing. */
  #updateTake(): void {
    const recording = this.#recordArmed && this.#playing;
    if (recording && !this.#take) {
      this.#take = { startTick: this.#position, notes: [], held: new Map() };
      this.#emit({ type: 'takeStarted', startTick: this.#position });
    } else if (!recording) {
      this.#endTake();
    }
  }

  /** Ends the take and sends it to the UI (also when empty, so the UI can clear its preview). */
  #endTake(): void {
    const take = this.#take;
    if (!take) return;
    for (const index of take.held.values()) take.notes[index]!.endTick = this.#position;
    this.#take = null;
    const finished: RecordedTake = {
      startTick: take.startTick,
      endTick: this.#position,
      notes: take.notes,
    };
    this.#emit({ type: 'recorded', take: finished });
  }

  /** Sends a recorded note to the UI so it appears while recording. */
  #emitTakeNote(take: Take, index: number, held: boolean): void {
    this.#emit({ type: 'takeNote', index, note: { ...take.notes[index]! }, held });
  }

  #releaseHeldTakeNotes(): void {
    const take = this.#take;
    if (!take) return;
    for (const index of take.held.values()) {
      take.notes[index]!.endTick = Math.max(take.notes[index]!.startTick, this.#heardPosition());
      this.#emitTakeNote(take, index, false);
    }
    take.held.clear();
  }

  /** Where the player heard the music when they played: now, minus output latency. */
  #heardPosition(): Tick {
    const latency = this.#latencySeconds * ticksPerSecond(this.#bpm());
    return Math.max(0, this.#position - latency);
  }

  #recordNoteOn(trackId: string, pitch: number, velocity: number): void {
    const take = this.#take;
    if (!take) return;
    const key = `${trackId}:${pitch}`;
    const tick = this.#heardPosition();
    const previous = take.held.get(key);
    if (previous !== undefined) {
      take.notes[previous]!.endTick = tick;
      this.#emitTakeNote(take, previous, false);
    }
    const note: RecordedNote = { trackId, pitch, velocity, startTick: tick, endTick: tick };
    const index = take.notes.push(note) - 1;
    take.held.set(key, index);
    this.#emitTakeNote(take, index, true);
  }

  #recordNoteOff(trackId: string, pitch: number): void {
    const take = this.#take;
    const key = `${trackId}:${pitch}`;
    const index = take?.held.get(key);
    if (!take || index === undefined) return;
    const note = take.notes[index]!;
    note.endTick = Math.max(note.startTick, this.#heardPosition());
    take.held.delete(key);
    this.#emitTakeNote(take, index, false);
  }

  // --- Rendering ---------------------------------------------------------------------------

  #bpm(): number {
    return this.#project ? bpmAt(this.#project.tempoMap, this.#position) : 120;
  }

  /** Renders one block of stereo audio. `left` and `right` may be the same buffer. */
  process(left: Float32Array, right: Float32Array): void {
    const frames = left.length;
    if (this.#mixLeft.length < frames) {
      this.#mixLeft = new Float32Array(frames);
      this.#mixRight = new Float32Array(frames);
    }
    const mixLeft = this.#mixLeft;
    const mixRight = this.#mixRight;
    mixLeft.fill(0, 0, frames);
    mixRight.fill(0, 0, frames);

    // The tempo is read once per block (a tempo change lands at most 128 samples late).
    let window: PlayWindow | null = null;
    if (this.#playing) {
      window = this.#window;
      window.ticksPerSample = ticksPerSecond(this.#bpm()) / this.sampleRate;
      window.start = this.#position;
      window.end = this.#position + window.ticksPerSample * frames;
    }

    for (const track of this.#tracks) track.process(mixLeft, mixRight, frames, window);
    this.#processMetronome(mixLeft, mixRight, frames, window);

    let peak = this.#masterPeak;
    for (let i = 0; i < frames; i++) {
      const gain = this.#masterGain.next();
      const l = softClip(mixLeft[i]! * gain);
      const r = softClip(mixRight[i]! * gain);
      left[i] = l;
      right[i] = r;
      const magnitude = Math.max(Math.abs(l), Math.abs(r));
      if (magnitude > peak) peak = magnitude;
    }
    this.#masterPeak = peak;
    if (window) this.#position = window.end;

    this.#framesSinceReport += frames;
    if (this.#framesSinceReport >= this.#reportInterval) this.#report();
  }

  #processMetronome(
    left: Float32Array,
    right: Float32Array,
    frames: number,
    window: PlayWindow | null,
  ) {
    let offset = -1;
    let accent = false;
    if (window && this.#metronome.enabled && this.#project) {
      const meter = this.#project.tempoMap.meters[0]!;
      const beat = ticksPerBeat(meter);
      const nextBeat = Math.ceil(window.start / beat - 1e-9) * beat;
      if (nextBeat < window.end) {
        offset = Math.min(
          frames - 1,
          Math.floor((nextBeat - window.start) / window.ticksPerSample),
        );
        accent = Math.round(nextBeat) % ticksPerBar(meter) === 0;
      }
    }
    this.#metronome.process(left, right, frames, offset, accent);
  }

  #report(): void {
    // Skip repeated silence so an idle engine doesn't wake the UI 30 times a second.
    if (!(this.#masterPeak === 0 && this.#lastReportedPeak === 0)) {
      this.#emit({ type: 'meters', master: this.#masterPeak });
      this.#lastReportedPeak = this.#masterPeak;
    }
    if (this.#playing) this.#reportTransport();
    this.#masterPeak = 0;
    this.#framesSinceReport = 0;
  }

  #reportTransport(): void {
    this.#emit({ type: 'transport', playing: this.#playing, tick: this.#position });
  }
}
