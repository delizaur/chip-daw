import { ARPEGGIATOR, ArpMode, arpRateTicks } from '../../model/boxes/effects';
import { paramReader } from '../../model/boxes/registry';
import type { BlockEvents } from '../note-schedule';
import type { BlockContext, SequencerRuntime } from './types';

const read = paramReader(ARPEGGIATOR);

const MAX_HELD = 32;
const MAX_PATTERN = MAX_HELD * 4;
const MAX_INPUT = 256;

/**
 * Arpeggiator: while keys are held, plays them one at a time on a tempo-synced grid.
 *
 * The first key starts a note immediately; later steps land on the grid (the song grid while
 * playing, a free-running one when stopped). Each note lasts `gate` × the step. Releasing every
 * key stops the arp at once. Fixed-size arrays only, so it never allocates while running.
 */
export class Arpeggiator implements SequencerRuntime {
  #mode: number = ArpMode.Up;
  #rateTicks = 240;
  #octaves = 1;
  #gate = 0.5;

  // Held keys, in the order they were pressed.
  readonly #heldPitch = new Int16Array(MAX_HELD);
  readonly #heldVelocity = new Uint8Array(MAX_HELD);
  #heldCount = 0;

  // The notes the arp cycles through (held keys sorted or in played order, over the octaves).
  readonly #pattern = new Int16Array(MAX_PATTERN);
  readonly #patternVelocity = new Uint8Array(MAX_PATTERN);
  #patternLength = 0;
  /** Steps taken since the arp started (indexes the pattern). */
  #steps = 0;

  #running = false;
  #nextStepTick = 0;
  #sounding = -1;
  #offTick = 0;
  /**
   * Sample offset where the arp starts, once every note arriving at that moment is known (so
   * a chord starts from its first note in the pattern, not whichever key came in first); -1 if none.
   */
  #pendingStart = -1;

  // Incoming notes for the coming block, in time order.
  readonly #inOffset = new Int32Array(MAX_INPUT);
  readonly #inOn = new Uint8Array(MAX_INPUT);
  readonly #inPitch = new Uint8Array(MAX_INPUT);
  readonly #inVelocity = new Uint8Array(MAX_INPUT);
  #inCount = 0;

  setParams(params: Readonly<Record<string, number>>): void {
    const mode = Math.round(read(params, 'mode'));
    const octaves = Math.round(read(params, 'octaves'));
    this.#rateTicks = arpRateTicks(read(params, 'rate'));
    this.#gate = read(params, 'gate');
    // The pattern only depends on these (rate and gate can be automated without rebuilding it).
    if (mode !== this.#mode || octaves !== this.#octaves) {
      this.#mode = mode;
      this.#octaves = octaves;
      this.#rebuildPattern();
    }
  }

  noteOn(pitch: number, velocity: number, offset: number): void {
    this.#queue(offset, true, pitch, velocity);
  }

  noteOff(pitch: number, offset: number): void {
    this.#queue(offset, false, pitch, 0);
  }

  reset(): void {
    this.#heldCount = 0;
    this.#patternLength = 0;
    this.#running = false;
    this.#sounding = -1;
    this.#pendingStart = -1;
    this.#inCount = 0;
  }

  render(frames: number, context: BlockContext, output: BlockEvents): void {
    const start = context.clockTick;
    const tps = context.ticksPerSample;
    const step = this.#rateTicks;
    // The clock jumped (seek, play/stop): continue on the grid from here instead of catching up.
    if (
      this.#running &&
      (this.#nextStepTick < start - step || this.#nextStepTick > start + tps * frames + 4 * step)
    ) {
      this.#nextStepTick = this.#nextGridTick(start, context.playing);
    }
    if (this.#sounding >= 0 && this.#offTick < start) this.#offTick = start;

    for (let i = 0; ; i++) {
      const until = i < this.#inCount ? this.#inOffset[i]! : frames;
      if (this.#pendingStart >= 0 && until > this.#pendingStart) {
        const offset = this.#pendingStart;
        const tick = start + offset * tps;
        this.#pendingStart = -1;
        this.#playStep(output, offset, tick);
        this.#nextStepTick = this.#nextGridTick(tick, context.playing);
      }
      this.#advance(output, start, tps, until);
      if (i >= this.#inCount) break;
      const offset = this.#inOffset[i]!;
      if (this.#inOn[i]) this.#press(this.#inPitch[i]!, this.#inVelocity[i]!, offset);
      else this.#release(this.#inPitch[i]!, offset, output);
    }
    this.#inCount = 0;
  }

  /** Emits the arp's own note-offs and steps that happen before sample `until`. */
  #advance(output: BlockEvents, start: number, tps: number, until: number): void {
    for (;;) {
      const offTick = this.#sounding >= 0 ? this.#offTick : Infinity;
      const stepTick = this.#running && this.#patternLength > 0 ? this.#nextStepTick : Infinity;
      const tick = Math.min(offTick, stepTick);
      if (tick === Infinity) return;
      const offset = Math.max(0, Math.ceil((tick - start) / tps - 1e-9));
      if (offset >= until) return;
      if (offTick <= stepTick) {
        output.add(offset, false, this.#sounding, 0);
        this.#sounding = -1;
      } else {
        this.#playStep(output, offset, tick);
      }
    }
  }

  #playStep(output: BlockEvents, offset: number, tick: number): void {
    if (this.#patternLength === 0) return;
    if (this.#sounding >= 0) output.add(offset, false, this.#sounding, 0);
    const index = this.#patternIndex();
    const pitch = this.#pattern[index]!;
    output.add(offset, true, pitch, this.#patternVelocity[index]!);
    this.#sounding = pitch;
    this.#offTick = tick + this.#gate * this.#rateTicks;
    this.#nextStepTick = tick + this.#rateTicks;
    this.#steps++;
  }

  #press(pitch: number, velocity: number, offset: number) {
    let found = false;
    for (let i = 0; i < this.#heldCount; i++) {
      if (this.#heldPitch[i] === pitch) {
        this.#heldVelocity[i] = velocity;
        found = true;
      }
    }
    if (!found && this.#heldCount < MAX_HELD) {
      this.#heldPitch[this.#heldCount] = pitch;
      this.#heldVelocity[this.#heldCount] = velocity;
      this.#heldCount++;
    }
    this.#rebuildPattern();
    if (!this.#running) {
      // First key: start right away (after any other keys at this same moment), then follow
      // the grid.
      this.#running = true;
      this.#steps = 0;
      this.#pendingStart = offset;
    }
  }

  #release(pitch: number, offset: number, output: BlockEvents): void {
    let write = 0;
    for (let read = 0; read < this.#heldCount; read++) {
      if (this.#heldPitch[read] === pitch) continue;
      this.#heldPitch[write] = this.#heldPitch[read]!;
      this.#heldVelocity[write] = this.#heldVelocity[read]!;
      write++;
    }
    this.#heldCount = write;
    this.#rebuildPattern();
    if (this.#heldCount === 0) {
      this.#running = false;
      this.#pendingStart = -1;
      if (this.#sounding >= 0) output.add(offset, false, this.#sounding, 0);
      this.#sounding = -1;
    }
  }

  /** Next step after `tick`: on the song grid while playing, one step later when stopped. */
  #nextGridTick(tick: number, playing: boolean): number {
    const step = this.#rateTicks;
    return playing ? (Math.floor(tick / step + 1e-9) + 1) * step : tick + step;
  }

  #patternIndex(): number {
    const n = this.#patternLength;
    const s = this.#steps;
    switch (this.#mode) {
      case ArpMode.Down:
        return n - 1 - (s % n);
      case ArpMode.UpDown: {
        if (n <= 1) return 0;
        const period = 2 * n - 2;
        const position = s % period;
        return position < n ? position : period - position;
      }
      case ArpMode.Random:
        return Math.floor(Math.random() * n);
      default:
        return s % n;
    }
  }

  #rebuildPattern(): void {
    const count = this.#heldCount;
    // Base order: by pitch, or as played.
    const pattern = this.#pattern;
    const velocities = this.#patternVelocity;
    for (let i = 0; i < count; i++) {
      pattern[i] = this.#heldPitch[i]!;
      velocities[i] = this.#heldVelocity[i]!;
    }
    if (this.#mode !== ArpMode.Played) {
      for (let i = 1; i < count; i++) {
        const pitch = pattern[i]!;
        const velocity = velocities[i]!;
        let j = i - 1;
        while (j >= 0 && pattern[j]! > pitch) {
          pattern[j + 1] = pattern[j]!;
          velocities[j + 1] = velocities[j]!;
          j--;
        }
        pattern[j + 1] = pitch;
        velocities[j + 1] = velocity;
      }
    }
    // Repeat over the octaves (skipping notes above the MIDI range).
    let length = count;
    for (let octave = 1; octave < this.#octaves; octave++) {
      for (let i = 0; i < count; i++) {
        const pitch = pattern[i]! + 12 * octave;
        if (pitch > 127 || length >= MAX_PATTERN) continue;
        pattern[length] = pitch;
        velocities[length] = velocities[i]!;
        length++;
      }
    }
    this.#patternLength = length;
  }

  #queue(offset: number, on: boolean, pitch: number, velocity: number): void {
    if (this.#inCount >= MAX_INPUT) return;
    // Keep time order; equal offsets stay in arrival order.
    let i = this.#inCount++;
    while (i > 0 && this.#inOffset[i - 1]! > offset) {
      this.#inOffset[i] = this.#inOffset[i - 1]!;
      this.#inOn[i] = this.#inOn[i - 1]!;
      this.#inPitch[i] = this.#inPitch[i - 1]!;
      this.#inVelocity[i] = this.#inVelocity[i - 1]!;
      i--;
    }
    this.#inOffset[i] = offset;
    this.#inOn[i] = on ? 1 : 0;
    this.#inPitch[i] = pitch;
    this.#inVelocity[i] = velocity;
  }
}
