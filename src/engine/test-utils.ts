/** Helpers for engine unit tests (renders audio to buffers, no browser needed). */

export const SAMPLE_RATE = 48_000;
export const BLOCK = 128;

/** Renders `seconds` of audio in worklet-sized blocks via `process(left, right, frames)`. */
export function renderBlocks(
  process: (left: Float32Array, right: Float32Array, frames: number) => void,
  seconds: number,
): { left: Float32Array; right: Float32Array } {
  const frames = Math.ceil((seconds * SAMPLE_RATE) / BLOCK) * BLOCK;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let offset = 0; offset < frames; offset += BLOCK) {
    process(left.subarray(offset, offset + BLOCK), right.subarray(offset, offset + BLOCK), BLOCK);
  }
  return { left, right };
}

export function peak(buffer: Float32Array): number {
  let max = 0;
  for (const s of buffer) max = Math.max(max, Math.abs(s));
  return max;
}

export function rms(buffer: Float32Array): number {
  let sum = 0;
  for (const s of buffer) sum += s * s;
  return Math.sqrt(sum / buffer.length);
}

/** Estimates the fundamental from upward zero crossings (good enough for clean periodic waves). */
export function estimateFrequency(buffer: Float32Array): number {
  let crossings = 0;
  let first = -1;
  let last = -1;
  for (let i = 1; i < buffer.length; i++) {
    if (buffer[i - 1]! < 0 && buffer[i]! >= 0) {
      if (first < 0) first = i;
      last = i;
      crossings++;
    }
  }
  return crossings > 1 ? ((crossings - 1) * SAMPLE_RATE) / (last - first) : 0;
}
