import type { BoxInstance, Clip, Preset, Tick, Track } from '../model/types';
import { createEffect, createSequencer, createSynth } from './boxes/registry';
import type { BlockContext, EffectRuntime, SequencerRuntime, SynthRuntime } from './boxes/types';
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

/** A sequencer or effect box and its runtime (null for unknown types, which are skipped). */
interface Slot<R> {
  box: BoxInstance;
  runtime: R | null;
}

/**
 * Rebuilds a list of box runtimes, keeping the runtime (and its state, e.g. a reverb tail) of
 * every box that's still there, and updating params of boxes that changed.
 */
function syncSlots<R extends { setParams(params: Record<string, number>): void }>(
  boxes: readonly BoxInstance[],
  previous: readonly Slot<R>[],
  create: (type: string) => R | null,
): Slot<R>[] {
  return boxes.map((box) => {
    const existing = previous.find((s) => s.box.id === box.id && s.box.type === box.type);
    if (existing) {
      if (existing.box !== box) existing.runtime?.setParams(box.params);
      return { box, runtime: existing.runtime };
    }
    const runtime = create(box.type);
    runtime?.setParams(box.params);
    return { box, runtime };
  });
}

/**
 * Audio-thread state for one track: its preset chain (sequencers → synth → effects), gain,
 * buffers, and the clip notes it plays.
 * `sync`, `locate` and the note methods (between blocks) may allocate; `process` must not.
 */
export class TrackRuntime {
  readonly id: string;
  readonly #sampleRate: number;
  readonly #gain: SmoothedValue;
  #synth: SynthRuntime | null = null;
  /** The boxes the runtime was built from. Immer keeps unchanged objects identical. */
  #synthBox: BoxInstance | null = null;
  #preset: Preset | null = null;
  #sequencers: Slot<SequencerRuntime>[] = [];
  #effects: Slot<EffectRuntime>[] = [];
  /** Runtimes that aren't bypassed, in chain order (rebuilt on sync, read in process). */
  #activeSequencers: SequencerRuntime[] = [];
  #activeEffects: EffectRuntime[] = [];
  /** One output event list per active sequencer. */
  #stageEvents: BlockEvents[] = [];

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
    const preset = track.segments[0]?.preset ?? null;
    if (preset === this.#preset) return;
    this.#preset = preset;
    this.#syncSynth(preset?.synth ?? null);

    const sequencerRouting = this.#activeSequencers;
    this.#sequencers = syncSlots(preset?.sequencers ?? [], this.#sequencers, createSequencer);
    this.#effects = syncSlots(preset?.effects ?? [], this.#effects, (type) =>
      createEffect(type, this.#sampleRate),
    );
    this.#activeSequencers = this.#sequencers.flatMap((s) =>
      s.runtime && !s.box.bypassed ? [s.runtime] : [],
    );
    this.#activeEffects = this.#effects.flatMap((s) =>
      s.runtime && !s.box.bypassed ? [s.runtime] : [],
    );
    while (this.#stageEvents.length < this.#activeSequencers.length) {
      this.#stageEvents.push(new BlockEvents());
    }
    // If notes now take a different path (a sequencer added, removed, moved or bypassed),
    // notes started through the old path would never get their note-off: release them.
    const routingChanged =
      sequencerRouting.length !== this.#activeSequencers.length ||
      sequencerRouting.some((s, i) => s !== this.#activeSequencers[i]);
    if (routingChanged) {
      for (const slot of this.#sequencers) slot.runtime?.reset();
      this.#synth?.allNotesOff();
    }
  }

  #syncSynth(box: BoxInstance | null): void {
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
        this.noteOff(pitch);
        this.#playingUntil[pitch] = NOT_PLAYING;
      }
    }
  }

  /** A live note (keyboard, MIDI): through the sequencers if there are any, else to the synth. */
  noteOn(pitch: number, velocity: number): void {
    const first = this.#activeSequencers[0];
    if (first) first.noteOn(pitch, velocity, 0);
    else this.#synth?.noteOn(pitch, velocity);
  }

  noteOff(pitch: number): void {
    const first = this.#activeSequencers[0];
    if (first) first.noteOff(pitch, 0);
    else this.#synth?.noteOff(pitch);
  }

  allNotesOff(): void {
    for (const slot of this.#sequencers) slot.runtime?.reset();
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
    context: BlockContext,
  ) {
    if (this.#left.length < frames) {
      this.#left = new Float32Array(frames);
      this.#right = new Float32Array(frames);
    }
    const left = this.#left;
    const right = this.#right;
    left.fill(0, 0, frames);
    right.fill(0, 0, frames);

    // Notes from clips, then through each sequencer in turn.
    let events = this.#events;
    events.clear();
    if (window) this.#collectEvents(window, frames);
    for (let s = 0; s < this.#activeSequencers.length; s++) {
      const sequencer = this.#activeSequencers[s]!;
      for (let i = 0; i < events.length; i++) {
        if (events.isOn(i)) {
          sequencer.noteOn(events.pitches[i]!, events.velocities[i]!, events.offsets[i]!);
        } else {
          sequencer.noteOff(events.pitches[i]!, events.offsets[i]!);
        }
      }
      const output = this.#stageEvents[s]!;
      output.clear();
      sequencer.render(frames, context, output);
      events = output;
    }

    // The synth, rendered in stretches between note events.
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

    const effects = this.#activeEffects;
    for (let e = 0; e < effects.length; e++) effects[e]!.process(left, right, frames, context);

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
