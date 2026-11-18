/**
 * Which pitches a preset chain's synth is playing (after its sequencers, so an arpeggiator's
 * notes count), for the key lights in the UI. Allocation-free: updated on the audio thread.
 */
export class NoteLights {
  /** Notes held per pitch. */
  readonly held = new Uint8Array(128);
  /**
   * Pitches struck since the last report: a short hit (a drum) lights up for at least one
   * report even if its note is over before then.
   */
  readonly struck = new Uint8Array(128);

  on(pitch: number): void {
    if (pitch < 0 || pitch > 127) return;
    this.held[pitch] = Math.min(255, this.held[pitch]! + 1);
    this.struck[pitch] = 1;
  }

  off(pitch: number): void {
    if (pitch < 0 || pitch > 127) return;
    this.held[pitch] = Math.max(0, this.held[pitch]! - 1);
  }

  /** Every note released at once (all notes off). */
  release(): void {
    this.held.fill(0);
  }
}

/**
 * The pitches lit across `lights` (held, or struck since the last report), if that differs
 * from `last`, which is then updated; null when nothing changed. Clears the struck marks.
 */
export function litChanges(lights: readonly NoteLights[], last: Uint8Array): number[] | null {
  let changed = false;
  for (let pitch = 0; pitch < 128; pitch++) {
    let lit = 0;
    for (const l of lights) {
      if (l.held[pitch]! > 0 || l.struck[pitch]! > 0) {
        lit = 1;
        break;
      }
    }
    if (lit !== last[pitch]) {
      last[pitch] = lit;
      changed = true;
    }
  }
  for (const l of lights) l.struck.fill(0);
  if (!changed) return null;
  const pitches: number[] = [];
  for (let pitch = 0; pitch < 128; pitch++) if (last[pitch]) pitches.push(pitch);
  return pitches;
}
