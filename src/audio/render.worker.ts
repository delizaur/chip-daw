/**
 * Renders the song to a WAV file off the main thread, with the same engine used for playback.
 * Started by `session.exportWav()` via `new Worker(new URL(...), { type: 'module' })`.
 */
import { renderSong } from '../engine/offline-render';
import { encodeWav, type BitDepth } from '../engine/wav';
import type { Project } from '../model/types';

export interface RenderRequest {
  project: Project;
  sampleRate: number;
  bitDepth: BitDepth;
}

export type RenderReply =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; wav: ArrayBuffer; seconds: number }
  | { type: 'error'; message: string };

const reply = (message: RenderReply, transfer: Transferable[] = []) =>
  postMessage(message, { transfer });

onmessage = (event: MessageEvent<RenderRequest>) => {
  const { project, sampleRate, bitDepth } = event.data;
  try {
    const audio = renderSong(project, {
      sampleRate,
      onProgress: (fraction) => reply({ type: 'progress', fraction }),
    });
    const wav = encodeWav(audio.left, audio.right, sampleRate, bitDepth);
    reply({ type: 'done', wav, seconds: audio.left.length / sampleRate }, [wav]);
  } catch (error) {
    reply({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
