import { applyPatches, enablePatches } from 'immer';
import type { RecordedNote, RecordedTake } from '../model/commands';
import { PPQ } from '../model/constants';
import type { Project, Tick } from '../model/types';
import { bpmAt, ticksPerBar, ticksPerBeat, ticksPerSecond } from '../model/time';
import { SmoothedValue, softClip, volumeToGain } from './dsp';
import { Metronome } from './metronome';
import type { EngineToUi, UiToEngine } from './protocol';
import type { BlockContext } from './boxes/types';
import { TrackRuntime, type PlayWindow } from './track';

enablePatches();

/** How often meters and the transport position are reported to the UI. */
const REPORT_RATE_HZ = 30;
/** Most loop jumps handled in one block (a guard; even the shortest loop is ~1800 samples). */
const MAX_WRAPS_PER_BLOCK = 8;
/** Beats counted in (with clicks) before recording starts from a stop. */
export const COUNT_IN_BEATS = 4;
/**
 * Notes played this close before the end of the count-in (a sixteenth) are early hits for the
 * downbeat: they're recorded at the start instead of being dropped.
 */
const EARLY_NOTE_TICKS = PPQ / 4;

interface Take {
  startTick: Tick;
  /** Started by the loop jumping back: notes can't start before it (they'd belong to the last pass). */
  looped?: boolean;
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
  #overdub = false;
  #loopEnabled = false;
  #latencySeconds = 0;
  #take: Take | null = null;
  /** `seq` of the last seek message handled (echoed in transport reports). */
  #seekSeq = 0;
  /** Count-in ticks still to go before playback starts (0 when not counting in). */
  #countIn: Tick = 0;
  /** Length of the current count-in, in ticks. */
  #countInTotal: Tick = 0;
  /** Notes played in the last moment of the count-in, still held ("trackId:pitch" → note). */
  readonly #earlyNotes = new Map<string, { trackId: string; pitch: number; velocity: number }>();
  readonly #window: PlayWindow = { start: 0, end: 0, ticksPerSample: 0 };
  /** Shared with every box each block (mutated, never reallocated). */
  readonly #context: BlockContext = { bpm: 120, clockTick: 0, ticksPerSample: 0, playing: false };
  /** Free-running clock for tempo-synced boxes (arp, delay) while the transport is stopped. */
  #freeTick: Tick = 0;

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
      case 'noteOn': {
        const track = this.#tracksById.get(message.trackId);
        // Overdubbing: you hear the clip you're adding to (the merged clip keeps its preset).
        const presetId =
          message.presetId ??
          (this.#take && this.#overdub ? track?.clipPresetAt(this.#position) : undefined);
        track?.noteOn(message.pitch, message.velocity, presetId);
        if (message.record !== false) {
          this.#recordNoteOn(message.trackId, message.pitch, message.velocity);
          if (this.#countIn > 0 && this.#countIn <= EARLY_NOTE_TICKS && this.#recordArmed) {
            const { trackId, pitch, velocity } = message;
            this.#earlyNotes.set(`${trackId}:${pitch}`, { trackId, pitch, velocity });
          }
        }
        break;
      }
      case 'noteOff':
        this.#tracksById.get(message.trackId)?.noteOff(message.pitch);
        this.#recordNoteOff(message.trackId, message.pitch);
        this.#earlyNotes.delete(`${message.trackId}:${message.pitch}`);
        break;
      case 'allNotesOff':
        for (const track of this.#tracks) track.allNotesOff();
        this.#releaseHeldTakeNotes();
        this.#earlyNotes.clear();
        break;
      case 'play':
        if (this.#playing || this.#countIn > 0) break;
        if (this.#recordArmed && this.#project) {
          // Recording from a stop: count in first (playback starts in `process`).
          this.#countInTotal = COUNT_IN_BEATS * ticksPerBeat(this.#project.tempoMap.meters[0]!);
          this.#countIn = this.#countInTotal;
          this.#reportTransport();
          break;
        }
        this.#startPlaying();
        this.#reportTransport();
        break;
      case 'pause':
        if (this.#countIn > 0) {
          this.#countIn = 0;
          this.#earlyNotes.clear();
          this.#reportTransport();
          break;
        }
        if (!this.#playing) break;
        this.#playing = false;
        for (const track of this.#tracks) track.stopPlayback();
        this.#updateTake();
        this.#reportTransport();
        break;
      case 'seek':
        this.#seekSeq = message.seq ?? this.#seekSeq;
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
      case 'setOverdub':
        this.#overdub = message.enabled;
        break;
      case 'setMetronome':
        this.#metronome.enabled = message.enabled;
        break;
      case 'setLoop':
        this.#loopEnabled = message.enabled;
        break;
      case 'setLatency':
        this.#latencySeconds = Math.max(0, message.seconds);
        break;
    }
  }

  #startPlaying(): void {
    this.#playing = true;
    for (const track of this.#tracks) track.locate(this.#position);
    this.#updateTake();
  }

  /** The count-in is over: playback and recording start, with notes held for the downbeat. */
  #endCountIn(): void {
    this.#countIn = 0;
    this.#startPlaying();
    const take = this.#take;
    if (take) {
      for (const [key, early] of this.#earlyNotes) {
        const note: RecordedNote = { ...early, startTick: take.startTick, endTick: take.startTick };
        const index = take.notes.push(note) - 1;
        take.held.set(key, index);
        this.#emitTakeNote(take, index, true);
      }
    }
    this.#earlyNotes.clear();
    this.#reportTransport();
  }

  /** Brings the runtime graph in line with the project. */
  #sync(): void {
    const project = this.#project;
    if (!project) return;
    this.#masterGain.target = volumeToGain(project.masterVolume);
    const anySolo = project.tracks.some((t) => t.solo);
    const presets = new Map(project.presets.map((p) => [p.id, p]));
    const seen = new Set<string>();
    this.#tracks = project.tracks.map((track) => {
      let runtime = this.#tracksById.get(track.id);
      if (!runtime) {
        runtime = new TrackRuntime(track.id, this.sampleRate);
        this.#tracksById.set(track.id, runtime);
      }
      runtime.sync(track, presets, !track.mute && (!anySolo || track.solo), this.#position);
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
    // In a pass started by the loop, a note heard before its start belongs to the last pass's
    // end; it's recorded at this pass's start instead of stretching the clip before the loop.
    const tick = take.looped
      ? Math.max(take.startTick, this.#heardPosition())
      : this.#heardPosition();
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
    const bpm = this.#bpm();
    const ticksPerSample = ticksPerSecond(bpm) / this.sampleRate;
    const blockTicks = ticksPerSample * frames;

    // Count-in: clicks on its beats; playback starts at the exact sample where it ends.
    let countInClick = -1;
    let countInAccent = false;
    let lead = 0;
    if (this.#countIn > 0 && this.#project) {
      const beat = ticksPerBeat(this.#project.tempoMap.meters[0]!);
      const elapsed = this.#countInTotal - this.#countIn;
      const nextBeat = Math.ceil(elapsed / beat - 1e-9) * beat;
      if (nextBeat < Math.min(elapsed + blockTicks, this.#countInTotal)) {
        countInClick = Math.min(frames - 1, Math.floor((nextBeat - elapsed) / ticksPerSample));
        countInAccent = Math.round(nextBeat) === 0;
      }
      if (this.#countIn <= blockTicks) {
        lead = this.#countIn;
        this.#endCountIn();
      } else {
        this.#countIn -= blockTicks;
      }
    }

    const context = this.#context;
    context.bpm = bpm;
    context.ticksPerSample = ticksPerSample;
    context.playing = this.#playing;

    if (!this.#playing) {
      context.clockTick = this.#freeTick;
      this.#freeTick += blockTicks;
      for (const track of this.#tracks) track.process(mixLeft, mixRight, 0, frames, null, context);
      this.#metronome.process(mixLeft, mixRight, 0, frames, countInClick, countInAccent);
    } else {
      // Playing: the block is rendered in segments, split where the loop jumps back. `lead` is
      // the part of this block still counting in, before the song position.
      const window = this.#window;
      window.ticksPerSample = ticksPerSample;
      let start = this.#position - lead;
      let offset = 0;
      for (let wraps = 0; offset < frames;) {
        let count = frames - offset;
        let end = start + count * ticksPerSample;
        const loop = this.#project?.loop;
        const wrap =
          !!loop &&
          this.#loopEnabled &&
          wraps < MAX_WRAPS_PER_BLOCK &&
          start < loop.endTick &&
          end >= loop.endTick &&
          loop.endTick > loop.startTick;
        if (wrap) {
          count = Math.min(count, Math.max(0, Math.round((loop.endTick - start) / ticksPerSample)));
          end = loop.endTick;
        }
        if (count > 0) {
          window.start = start;
          window.end = end;
          context.clockTick = start;
          for (const track of this.#tracks) {
            track.process(mixLeft, mixRight, offset, count, window, context);
          }
          // The count-in's last click can only fall in the first segment.
          const click = offset === 0 ? countInClick : -1;
          this.#processMetronome(mixLeft, mixRight, offset, count, window, click, countInAccent);
        }
        offset += count;
        if (wrap) {
          wraps++;
          this.#position = loop.endTick;
          this.#loopBack(loop.startTick);
          start = loop.startTick;
        } else {
          start = end;
        }
      }
      this.#position = start;
    }

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

    this.#framesSinceReport += frames;
    if (this.#framesSinceReport >= this.#reportInterval) this.#report();
  }

  /**
   * Metronome for samples `start`..`start + count`, which play `window`. `countInClick` is a
   * count-in click's sample in the block (-1 for none); it wins over a beat in the same span.
   */
  #processMetronome(
    left: Float32Array,
    right: Float32Array,
    start: number,
    count: number,
    window: PlayWindow,
    countInClick: number,
    countInAccent: boolean,
  ) {
    let offset = countInClick;
    let accent = countInAccent;
    if (offset < 0 && this.#metronome.enabled && this.#project) {
      const meter = this.#project.tempoMap.meters[0]!;
      const beat = ticksPerBeat(meter);
      const nextBeat = Math.ceil(window.start / beat - 1e-9) * beat;
      if (nextBeat < window.end) {
        offset =
          start +
          Math.min(count - 1, Math.floor((nextBeat - window.start) / window.ticksPerSample));
        accent = Math.round(nextBeat) % ticksPerBar(meter) === 0;
      }
    }
    this.#metronome.process(left, right, start, count, offset, accent);
  }

  /**
   * The loop end was reached (the position is there): jump back to `tick`. Notes still sounding
   * are released; a recording pass ends here and a new one starts at the loop start, so each
   * time around is its own pass (with overdub they layer up; without, the last one played
   * replaces the others).
   */
  #loopBack(tick: Tick): void {
    const recording = !!this.#take;
    this.#endTake();
    this.#position = tick;
    for (const track of this.#tracks) track.locate(tick);
    if (recording) {
      this.#updateTake();
      if (this.#take) this.#take.looped = true;
    }
  }

  #report(): void {
    // Skip repeated silence so an idle engine doesn't wake the UI 30 times a second.
    if (!(this.#masterPeak === 0 && this.#lastReportedPeak === 0)) {
      this.#emit({ type: 'meters', master: this.#masterPeak });
      this.#lastReportedPeak = this.#masterPeak;
    }
    if (this.#playing || this.#countIn > 0) this.#reportTransport();
    this.#masterPeak = 0;
    this.#framesSinceReport = 0;
  }

  #reportTransport(): void {
    const beat = this.#project ? ticksPerBeat(this.#project.tempoMap.meters[0]!) : PPQ;
    const countIn = this.#countIn > 0 ? Math.ceil(this.#countIn / beat - 1e-9) : 0;
    this.#emit({
      type: 'transport',
      playing: this.#playing,
      tick: this.#position,
      countIn,
      seekSeq: this.#seekSeq,
    });
  }
}
