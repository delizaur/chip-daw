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
/** A chain with no held notes sleeps after this long below SILENT_LEVEL. */
const SLEEP_AFTER_SECONDS = 5;
const SILENT_LEVEL = 1e-5;

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
 * One preset's runtime: sequencers → synth → effects, with their own voices, buffers and state
 * (e.g. a reverb tail). Runtimes are matched to boxes by id, so a copy of a preset that keeps
 * box ids (copy on write) keeps them. A chain that has no held notes and has been silent for a
 * while sleeps (skips processing) until its next note.
 * `sync` and the note methods (between blocks) may allocate; `process` must not.
 */
export class PresetChain {
  readonly #sampleRate: number;
  #preset: Preset | null = null;
  #synth: SynthRuntime | null = null;
  /** The box the synth was built from. Immer keeps unchanged objects identical. */
  #synthBox: BoxInstance | null = null;
  #sequencers: Slot<SequencerRuntime>[] = [];
  #effects: Slot<EffectRuntime>[] = [];
  /** Runtimes that aren't bypassed, in chain order (rebuilt on sync, read in process). */
  #activeSequencers: SequencerRuntime[] = [];
  #activeEffects: EffectRuntime[] = [];
  /** One output event list per active sequencer. */
  #stageEvents: BlockEvents[] = [];
  /** Note events for the coming block (filled by the track, consumed by `process`). */
  readonly input = new BlockEvents();
  #left = new Float32Array(128);
  #right = new Float32Array(128);

  /** Notes on minus notes off, so a chain holding a note never sleeps. */
  #held = 0;
  #quietFrames = 0;
  #asleep = false;

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate;
  }

  get preset(): Preset | null {
    return this.#preset;
  }

  /** True while the chain skips processing (silent for a while, no held notes). */
  get asleep(): boolean {
    return this.#asleep;
  }

  sync(preset: Preset | null): void {
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
    this.#wake();
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

  #wake(): void {
    this.#asleep = false;
    this.#quietFrames = 0;
  }

  /** A note right now (between blocks): through the sequencers if there are any, else to the synth. */
  noteOn(pitch: number, velocity: number): void {
    this.#held++;
    this.#wake();
    const first = this.#activeSequencers[0];
    if (first) first.noteOn(pitch, velocity, 0);
    else this.#synth?.noteOn(pitch, velocity);
  }

  noteOff(pitch: number): void {
    this.#held = Math.max(0, this.#held - 1);
    const first = this.#activeSequencers[0];
    if (first) first.noteOff(pitch, 0);
    else this.#synth?.noteOff(pitch);
  }

  allNotesOff(): void {
    for (const slot of this.#sequencers) slot.runtime?.reset();
    this.#synth?.allNotesOff();
    this.#held = 0;
  }

  /** Renders `input` (and whatever is still sounding) and adds it to `outLeft`/`outRight`. */
  process(
    outLeft: Float32Array,
    outRight: Float32Array,
    frames: number,
    context: BlockContext,
  ): void {
    let events = this.input;
    if (this.#asleep) {
      if (events.length === 0) return;
      this.#wake();
    }
    for (let i = 0; i < events.length; i++) {
      if (events.isOn(i)) this.#held++;
      else this.#held = Math.max(0, this.#held - 1);
    }

    if (this.#left.length < frames) {
      this.#left = new Float32Array(frames);
      this.#right = new Float32Array(frames);
    }
    const left = this.#left;
    const right = this.#right;
    left.fill(0, 0, frames);
    right.fill(0, 0, frames);

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

    let peak = 0;
    for (let i = 0; i < frames; i++) {
      outLeft[i]! += left[i]!;
      outRight[i]! += right[i]!;
      const magnitude = Math.max(Math.abs(left[i]!), Math.abs(right[i]!));
      if (magnitude > peak) peak = magnitude;
    }
    if (peak >= SILENT_LEVEL || this.#held > 0) {
      this.#quietFrames = 0;
    } else {
      this.#quietFrames += frames;
      if (this.#quietFrames >= SLEEP_AFTER_SECONDS * this.#sampleRate) this.#asleep = true;
    }
  }
}

/**
 * Audio-thread state for one track: a live chain for its track preset (live notes), a chain per
 * distinct clip preset (clip notes), gain, buffers, and the clip notes it plays.
 * `sync`, `locate` and the note methods (between blocks) may allocate; `process` must not.
 */
export class TrackRuntime {
  readonly id: string;
  readonly #sampleRate: number;
  readonly #gain: SmoothedValue;
  /** Plays the track preset: live input (keyboard, MIDI). */
  readonly live: PresetChain;
  /** Clip preset id → chain playing the clips that use it. */
  readonly #clipChains = new Map<string, PresetChain>();
  /** Every chain, for processing. */
  #chains: PresetChain[];

  #clips: readonly Clip[] | null = null;
  #notes: ScheduledNote[] = [];
  /** The chain each scheduled note plays on (parallel to #notes). */
  #noteChains: PresetChain[] = [];
  /** Index of the next note to start. */
  #cursor = 0;
  /** End tick of each pitch started by playback, or NOT_PLAYING, and the chain it plays on. */
  readonly #playingUntil = new Float64Array(128).fill(NOT_PLAYING);
  readonly #playingChain: (PresetChain | null)[] = new Array<PresetChain | null>(128).fill(null);
  /** The chain each live pitch went to, so its note-off reaches the same chain. */
  readonly #liveChain: (PresetChain | null)[] = new Array<PresetChain | null>(128).fill(null);
  #left = new Float32Array(128);
  #right = new Float32Array(128);

  constructor(id: string, sampleRate: number) {
    this.id = id;
    this.#sampleRate = sampleRate;
    this.#gain = new SmoothedValue(0, sampleRate);
    this.live = new PresetChain(sampleRate);
    this.#chains = [this.live];
  }

  /** The chain playing clips with preset `presetId`, if this track has any. */
  clipChain(presetId: string): PresetChain | undefined {
    return this.#clipChains.get(presetId);
  }

  /** Chains for this track's clip presets (for tests and diagnostics). */
  get clipChainCount(): number {
    return this.#clipChains.size;
  }

  /**
   * Updates the runtime from the project. `presets` maps preset ids to presets; `audible`
   * accounts for mute and solo; `position` is the transport position, to resume clip playback
   * from the right note after an edit.
   */
  sync(track: Track, presets: ReadonlyMap<string, Preset>, audible: boolean, position: Tick): void {
    this.#gain.target = audible ? volumeToGain(track.volume) : 0;
    this.live.sync(presets.get(track.presetId) ?? null);

    const used = new Set(track.clips.map((c) => c.presetId));
    let chainsChanged = false;
    for (const [presetId, chain] of this.#clipChains) {
      if (used.has(presetId)) continue;
      this.#forgetChain(chain);
      this.#clipChains.delete(presetId);
      chainsChanged = true;
    }
    for (const presetId of used) {
      let chain = this.#clipChains.get(presetId);
      if (!chain) {
        chain = new PresetChain(this.#sampleRate);
        this.#clipChains.set(presetId, chain);
        chainsChanged = true;
      }
      chain.sync(presets.get(presetId) ?? null);
    }
    if (chainsChanged) this.#chains = [this.live, ...this.#clipChains.values()];

    if (track.clips !== this.#clips) {
      this.#clips = track.clips;
      this.#notes = scheduleNotes(track.clips);
      this.#noteChains = this.#notes.map((n) => this.#clipChains.get(n.presetId)!);
      this.#cursor = firstNoteFrom(this.#notes, position);
    }
  }

  /** A chain is going away: drop references to it from notes in flight. */
  #forgetChain(chain: PresetChain): void {
    for (let pitch = 0; pitch < 128; pitch++) {
      if (this.#playingChain[pitch] === chain) {
        this.#playingChain[pitch] = null;
        this.#playingUntil[pitch] = NOT_PLAYING;
      }
      if (this.#liveChain[pitch] === chain) this.#liveChain[pitch] = this.live;
    }
  }

  /** The preset of the clip at `tick` on this track, if there is one. */
  clipPresetAt(tick: Tick): string | undefined {
    return this.#clips?.find((c) => c.startTick <= tick && tick < c.startTick + c.lengthTicks)
      ?.presetId;
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
        this.#playingChain[pitch]?.noteOff(pitch);
        this.#playingUntil[pitch] = NOT_PLAYING;
        this.#playingChain[pitch] = null;
      }
    }
  }

  /**
   * A live note (keyboard, MIDI, audition). It plays on the track preset, or on the clip chain
   * of `presetId` when given (piano roll auditions, overdubbing into a clip) and this track has
   * one.
   */
  noteOn(pitch: number, velocity: number, presetId?: string): void {
    const chain = (presetId !== undefined && this.#clipChains.get(presetId)) || this.live;
    const previous = this.#liveChain[pitch];
    if (previous && previous !== chain) previous.noteOff(pitch);
    this.#liveChain[pitch] = chain;
    chain.noteOn(pitch, velocity);
  }

  noteOff(pitch: number): void {
    const chain = this.#liveChain[pitch] ?? this.live;
    this.#liveChain[pitch] = null;
    chain.noteOff(pitch);
  }

  allNotesOff(): void {
    for (const chain of this.#chains) chain.allNotesOff();
    this.#playingUntil.fill(NOT_PLAYING);
    this.#playingChain.fill(null);
    this.#liveChain.fill(null);
  }

  /**
   * Renders `frames` samples of the track and adds them, with its gain, to the mix buffers from
   * sample `offset` on (a block can be split, e.g. where the loop jumps back). `window` is the
   * part of the song those samples cover, or null when the transport is stopped (only live
   * notes play).
   */
  process(
    mixLeft: Float32Array,
    mixRight: Float32Array,
    offset: number,
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

    const chains = this.#chains;
    for (let c = 0; c < chains.length; c++) chains[c]!.input.clear();
    if (window) this.#collectEvents(window, frames);
    for (let c = 0; c < chains.length; c++) chains[c]!.process(left, right, frames, context);

    const gain = this.#gain;
    for (let i = 0; i < frames; i++) {
      const g = gain.next();
      mixLeft[offset + i]! += left[i]! * g;
      mixRight[offset + i]! += right[i]! * g;
    }
  }

  /** Clip note-ons and note-offs in this block, into the input of the chain each plays on. */
  #collectEvents(window: PlayWindow, frames: number): void {
    for (let pitch = 0; pitch < 128; pitch++) {
      const until = this.#playingUntil[pitch]!;
      if (until !== NOT_PLAYING && until < window.end) {
        this.#playingChain[pitch]?.input.add(offsetOf(until, window, frames), false, pitch, 0);
        this.#playingUntil[pitch] = NOT_PLAYING;
        this.#playingChain[pitch] = null;
      }
    }

    const notes = this.#notes;
    while (this.#cursor < notes.length && notes[this.#cursor]!.tick < window.end) {
      const index = this.#cursor++;
      const note = notes[index]!;
      if (note.tick < window.start) continue; // already passed (e.g. after an edit)
      const offset = offsetOf(note.tick, window, frames);
      const chain = this.#noteChains[index]!;
      if (this.#playingUntil[note.pitch] !== NOT_PLAYING) {
        this.#playingChain[note.pitch]?.input.add(offset, false, note.pitch, 0);
      }
      chain.input.add(offset, true, note.pitch, note.velocity);
      this.#playingUntil[note.pitch] = note.end;
      this.#playingChain[note.pitch] = chain;
    }
  }
}
