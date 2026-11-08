import type { BoxInstance, Clip, Tick, Track } from '../model/types';
import { createSynth } from './boxes/registry';
import type { SynthRuntime } from './boxes/types';
import { SmoothedValue, volumeToGain } from './dsp';
import { BlockEvents, firstNoteFrom, scheduleNotes, type ScheduledNote } from './note-schedule';

/** The part of the song one block covers while playing. */
export interface PlayWindow {
  /** Tick at the block's first sample. */
  start: Tick;
  /** Tick just after the block's last sample. */
  end: Tick;
  ticksPerSample: number;
}

const NOT_PLAYING = -1;

/** Sample offset of `tick` within a block, clamped to the block. */
function offsetOf(tick: Tick, window: PlayWindow, frames: number): number {
  return Math.min(
    frames - 1,
    Math.max(0, Math.floor((tick - window.start) / window.ticksPerSample)),
  );
}

/**
 * Audio-thread state for one track: its synth, gain, buffers, and the clip notes it plays.
 * `sync` and `locate` (on project or transport changes) may allocate; `process` must not.
 */
export class TrackRuntime {
  readonly id: string;
  readonly #sampleRate: number;
  readonly #gain: SmoothedValue;
  #synth: SynthRuntime | null = null;
  /** The synth box the runtime was built from. Immer keeps unchanged objects identical. */
  #synthBox: BoxInstance | null = null;
  #clips: readonly Clip[] | null = null;
  #notes: ScheduledNote[] = [];
  /** Index of the next note to start. */
  #cursor = 0;
  /** End tick of each pitch started by playback, or NOT_PLAYING. */
  readonly #playingUntil = new Float64Array(128).fill(NOT_PLAYING);
  readonly #events = new BlockEvents();
  #left = new Float32Array(128);
  #right = new Float32Array(128);

  constructor(id: string, sampleRate: number) {
    this.id = id;
    this.#sampleRate = sampleRate;
    this.#gain = new SmoothedValue(0, sampleRate);
  }

  /**
   * Updates the runtime from the project. `audible` accounts for mute and solo; `position` is
   * the transport position, to resume clip playback from the right note after an edit.
   */
  sync(track: Track, audible: boolean, position: Tick): void {
    this.#gain.target = audible ? volumeToGain(track.volume) : 0;

    if (track.clips !== this.#clips) {
      this.#clips = track.clips;
      this.#notes = scheduleNotes(track.clips);
      this.#cursor = firstNoteFrom(this.#notes, position);
    }

    // There's no segment selection by position yet: the preset that sounds is the first one.
    const box = track.segments[0]?.preset.synth ?? null;
    if (box === this.#synthBox) return;
    if (!box) {
      this.#synth = null;
    } else if (!this.#synth || this.#synthBox?.id !== box.id || this.#synthBox.type !== box.type) {
      this.#synth = createSynth(box.type, this.#sampleRate);
      this.#synth?.setParams(box.params);
    } else {
      this.#synth.setParams(box.params);
    }
    this.#synthBox = box;
  }

  /** Jumps clip playback to `tick`, releasing notes started by playback. */
  locate(tick: Tick): void {
    this.stopPlayback();
    this.#cursor = firstNoteFrom(this.#notes, tick);
  }

  /** Releases notes started by playback (live notes keep playing). */
  stopPlayback(): void {
    for (let pitch = 0; pitch < 128; pitch++) {
      if (this.#playingUntil[pitch] !== NOT_PLAYING) {
        this.#synth?.noteOff(pitch);
        this.#playingUntil[pitch] = NOT_PLAYING;
      }
    }
  }

  noteOn(pitch: number, velocity: number): void {
    this.#synth?.noteOn(pitch, velocity);
  }

  noteOff(pitch: number): void {
    this.#synth?.noteOff(pitch);
  }

  allNotesOff(): void {
    this.#synth?.allNotesOff();
    this.#playingUntil.fill(NOT_PLAYING);
  }

  /**
   * Renders the track and adds it, with its gain, to the mix buffers. `window` is null when
   * the transport is stopped (only live notes play).
   */
  process(
    mixLeft: Float32Array,
    mixRight: Float32Array,
    frames: number,
    window: PlayWindow | null,
  ) {
    if (this.#left.length < frames) {
      this.#left = new Float32Array(frames);
      this.#right = new Float32Array(frames);
    }
    const left = this.#left;
    const right = this.#right;
    left.fill(0, 0, frames);
    right.fill(0, 0, frames);

    const events = this.#events;
    events.clear();
    if (window) this.#collectEvents(window, frames);

    const synth = this.#synth;
    let position = 0;
    for (let i = 0; i < events.length; i++) {
      const offset = events.offsets[i]!;
      if (offset > position) {
        synth?.process(left, right, position, offset - position);
        position = offset;
      }
      if (events.isOn(i)) synth?.noteOn(events.pitches[i]!, events.velocities[i]!);
      else synth?.noteOff(events.pitches[i]!);
    }
    if (position < frames) synth?.process(left, right, position, frames - position);

    const gain = this.#gain;
    for (let i = 0; i < frames; i++) {
      const g = gain.next();
      mixLeft[i]! += left[i]! * g;
      mixRight[i]! += right[i]! * g;
    }
  }

  #collectEvents(window: PlayWindow, frames: number): void {
    const events = this.#events;

    for (let pitch = 0; pitch < 128; pitch++) {
      const until = this.#playingUntil[pitch]!;
      if (until !== NOT_PLAYING && until < window.end) {
        events.add(offsetOf(until, window, frames), false, pitch, 0);
        this.#playingUntil[pitch] = NOT_PLAYING;
      }
    }

    const notes = this.#notes;
    while (this.#cursor < notes.length && notes[this.#cursor]!.tick < window.end) {
      const note = notes[this.#cursor++]!;
      if (note.tick < window.start) continue; // already passed (e.g. after an edit)
      const offset = offsetOf(note.tick, window, frames);
      if (this.#playingUntil[note.pitch] !== NOT_PLAYING) events.add(offset, false, note.pitch, 0);
      events.add(offset, true, note.pitch, note.velocity);
      this.#playingUntil[note.pitch] = note.end;
    }
  }
}
