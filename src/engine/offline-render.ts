/**
 * Renders a whole song offline with the same Engine that plays it live, so an exported file
 * sounds exactly like playback. Pure TS: runs in a Worker (and in tests).
 */
import type { Project } from '../model/types';
import { Engine } from './engine';

const BLOCK = 128;
/** After the last clip ends, keep rendering while effect tails (delay, reverb) still sound... */
const MAX_TAIL_SECONDS = 12;
/** ...until this much continuous near-silence. */
const SILENCE_SECONDS = 0.5;
const SILENCE_LEVEL = 1e-4;

export interface RenderOptions {
  sampleRate: number;
  /** Called with 0..1 now and then. */
  onProgress?: (fraction: number) => void;
}

export interface RenderedAudio {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

/** Song tick where the last clip ends (0 for a song without clips). */
export function songEndTick(project: Project): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) end = Math.max(end, clip.startTick + clip.lengthTicks);
  }
  return end;
}

/**
 * Plays the song from the start until the last clip ends, then on until effect tails fade out
 * (or 12 s). Mute and solo apply, like in playback; the metronome doesn't play.
 */
export function renderSong(
  project: Project,
  { sampleRate, onProgress }: RenderOptions,
): RenderedAudio {
  const endTick = songEndTick(project);
  const engine = new Engine(sampleRate, () => {});
  engine.handle({ type: 'loadProject', project });
  engine.handle({ type: 'play' });

  const chunks: { left: Float32Array; right: Float32Array }[] = [];
  let frames = 0;
  let quietFrames = 0;
  let tailFrames = 0;
  const silenceFrames = SILENCE_SECONDS * sampleRate;
  const maxTailFrames = MAX_TAIL_SECONDS * sampleRate;
  let lastProgress = -1;

  for (;;) {
    const left = new Float32Array(BLOCK);
    const right = new Float32Array(BLOCK);
    engine.process(left, right);
    chunks.push({ left, right });
    frames += BLOCK;

    if (engine.position < endTick) {
      const progress = Math.floor((engine.position / Math.max(1, endTick)) * 100) / 100;
      if (progress !== lastProgress) {
        lastProgress = progress;
        onProgress?.(progress * 0.95);
      }
      continue;
    }
    // The song is over: stop once the tails have faded.
    tailFrames += BLOCK;
    let peak = 0;
    for (let i = 0; i < BLOCK; i++) peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
    quietFrames = peak < SILENCE_LEVEL ? quietFrames + BLOCK : 0;
    if (quietFrames >= silenceFrames || tailFrames >= maxTailFrames) break;
  }

  // Drop the trailing silence that ended the render.
  const keep = Math.max(BLOCK, frames - quietFrames);
  const left = new Float32Array(keep);
  const right = new Float32Array(keep);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= keep) break;
    const count = Math.min(BLOCK, keep - offset);
    left.set(chunk.left.subarray(0, count), offset);
    right.set(chunk.right.subarray(0, count), offset);
    offset += count;
  }
  onProgress?.(1);
  return { left, right, sampleRate };
}
