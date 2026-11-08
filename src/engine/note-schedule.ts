import type { Clip, Tick } from '../model/types';

/** A note to play from a clip, in absolute song ticks. */
export interface ScheduledNote {
  tick: Tick;
  end: Tick;
  pitch: number;
  velocity: number;
}

/**
 * Flattens a track's clips into note-ons sorted by tick. Notes outside their clip's bounds
 * (hidden by trimming) are skipped, and notes are cut at the clip's end.
 */
export function scheduleNotes(clips: readonly Clip[]): ScheduledNote[] {
  const notes: ScheduledNote[] = [];
  for (const clip of clips) {
    const clipEnd = clip.startTick + clip.lengthTicks;
    for (const note of clip.notes) {
      if (note.tick < 0 || note.tick >= clip.lengthTicks) continue;
      const tick = clip.startTick + note.tick;
      notes.push({
        tick,
        end: Math.min(tick + note.durationTicks, clipEnd),
        pitch: note.pitch,
        velocity: note.velocity,
      });
    }
  }
  return notes.sort((a, b) => a.tick - b.tick);
}

/** Index of the first note at or after `tick`. */
export function firstNoteFrom(notes: readonly ScheduledNote[], tick: Tick): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (notes[mid]!.tick < tick) low = mid + 1;
    else high = mid;
  }
  return low;
}

const NOTE_OFF = 0;
const NOTE_ON = 1;

/**
 * Preallocated per-block event list (note-offs and note-ons with sample offsets), sorted so
 * that at the same offset note-offs come first (a repeated note retriggers cleanly).
 */
export class BlockEvents {
  length = 0;
  readonly offsets: Int32Array;
  readonly kinds: Uint8Array;
  readonly pitches: Uint8Array;
  readonly velocities: Uint8Array;

  constructor(capacity = 512) {
    this.offsets = new Int32Array(capacity);
    this.kinds = new Uint8Array(capacity);
    this.pitches = new Uint8Array(capacity);
    this.velocities = new Uint8Array(capacity);
  }

  clear(): void {
    this.length = 0;
  }

  /** Adds an event, keeping the list sorted. Drops it if the block is absurdly full. */
  add(offset: number, on: boolean, pitch: number, velocity: number): void {
    if (this.length >= this.offsets.length) return;
    const kind = on ? NOTE_ON : NOTE_OFF;
    let i = this.length++;
    while (
      i > 0 &&
      (this.offsets[i - 1]! > offset ||
        (this.offsets[i - 1] === offset && this.kinds[i - 1]! > kind))
    ) {
      this.offsets[i] = this.offsets[i - 1]!;
      this.kinds[i] = this.kinds[i - 1]!;
      this.pitches[i] = this.pitches[i - 1]!;
      this.velocities[i] = this.velocities[i - 1]!;
      i--;
    }
    this.offsets[i] = offset;
    this.kinds[i] = kind;
    this.pitches[i] = pitch;
    this.velocities[i] = velocity;
  }

  isOn(index: number): boolean {
    return this.kinds[index] === NOTE_ON;
  }
}
