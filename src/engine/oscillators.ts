/** Frequency in Hz of a (fractional) MIDI note number. A4 = 69 = 440 Hz. */
export function noteFrequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * PolyBLEP residual: smooths a waveform's discontinuity at phase 0 to reduce aliasing.
 * `t` is the phase (0..1) relative to the discontinuity, `dt` the phase increment per sample.
 */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/**
 * Band-limited pulse wave with duty cycle `duty` (0..1), DC removed so narrow pulses
 * don't shift the mix off-center.
 */
export function pulse(phase: number, dt: number, duty: number): number {
  let value = phase < duty ? 1 : -1;
  value += polyBlep(phase, dt);
  value -= polyBlep((phase + 1 - duty) % 1, dt);
  return value - (2 * duty - 1);
}

/** NES-style triangle: 32 steps over 16 levels (4-bit), centered on zero. */
export function steppedTriangle(phase: number): number {
  const step = Math.floor(phase * 32);
  const level = step < 16 ? 15 - step : step - 16;
  return level / 7.5 - 1;
}

/**
 * Advances a 15-bit LFSR one step, like the NES noise channel.
 * `tap` 1 gives long "hiss" noise; tap 6 gives the short 93-step "metallic" sequence.
 */
export function stepLfsr(register: number, tap: number): number {
  const feedback = (register & 1) ^ ((register >> tap) & 1);
  return (register >> 1) | (feedback << 14);
}
