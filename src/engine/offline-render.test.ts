import { describe, expect, it } from 'vitest';
import { createBox } from '../model/boxes/registry';
import { addBox } from '../model/chain-commands';
import { createClip } from '../model/clips';
import { placeClips, setTrackMute } from '../model/commands';
import { PPQ } from '../model/constants';
import { createProject } from '../model/defaults';
import { History } from '../model/history';
import { renderSong, songEndTick } from './offline-render';
import { peak, SAMPLE_RATE } from './test-utils';
import { encodeWav } from './wav';

function song(withDelay = false) {
  const h = new History(createProject());
  const trackId = h.state.tracks[0]!.id;
  // Before the clip exists: the clip records with the track preset as it is then.
  if (withDelay) h.run(addBox({ trackId }, createBox('fx.delay')));
  // Two beats of one note (1 s at 120 BPM).
  h.run(
    placeClips([
      {
        trackId,
        clip: createClip(0, 2 * PPQ, h.state.tracks[0]!.presetId, [
          { id: 'n', tick: 0, durationTicks: PPQ, pitch: 60, velocity: 100 },
        ]),
      },
    ]),
  );
  return h;
}

describe('offline render', () => {
  it('finds where the song ends', () => {
    expect(songEndTick(song().state)).toBe(2 * PPQ);
    expect(songEndTick(createProject())).toBe(0);
  });

  it('renders the song plus its release, then trims the silence', () => {
    const { left, right } = renderSong(song().state, { sampleRate: SAMPLE_RATE });
    expect(peak(left.subarray(0, SAMPLE_RATE / 4))).toBeGreaterThan(0.02);
    expect(right).toEqual(left);
    // 1 s of song (the note is silent after 0.6 s), so ≈1 s, not 1 s + 0.5 s of silence.
    expect(left.length / SAMPLE_RATE).toBeGreaterThan(0.95);
    expect(left.length / SAMPLE_RATE).toBeLessThan(1.1);
  });

  it('keeps rendering while effect tails ring after the last clip', () => {
    const dry = renderSong(song().state, { sampleRate: SAMPLE_RATE }).left.length;
    const wet = renderSong(song(true).state, { sampleRate: SAMPLE_RATE }).left.length;
    expect(wet).toBeGreaterThan(dry + SAMPLE_RATE / 2);
  });

  it('respects mute, and reports progress up to 1', () => {
    const h = song();
    h.run(setTrackMute(h.state.tracks[0]!.id, true));
    const progress: number[] = [];
    const { left } = renderSong(h.state, {
      sampleRate: SAMPLE_RATE,
      onProgress: (p) => progress.push(p),
    });
    expect(peak(left)).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1]!)).toBe(true);
  });
});

describe('WAV encoding', () => {
  const header = (buffer: ArrayBuffer) => {
    const view = new DataView(buffer);
    const text = (offset: number) => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
    return {
      riff: text(0),
      wave: text(8),
      fmt: text(12),
      data: text(36),
      format: view.getUint16(20, true),
      channels: view.getUint16(22, true),
      sampleRate: view.getUint32(24, true),
      byteRate: view.getUint32(28, true),
      bits: view.getUint16(34, true),
      dataSize: view.getUint32(40, true),
      riffSize: view.getUint32(4, true),
    };
  };

  it('writes a valid 16-bit stereo header and interleaved samples', () => {
    const left = Float32Array.from([0, 1, -1]);
    const right = Float32Array.from([0.5, -0.5, 2]);
    const buffer = encodeWav(left, right, 44100, 16);
    expect(header(buffer)).toEqual({
      riff: 'RIFF',
      wave: 'WAVE',
      fmt: 'fmt ',
      data: 'data',
      format: 1,
      channels: 2,
      sampleRate: 44100,
      byteRate: 44100 * 4,
      bits: 16,
      dataSize: 12,
      riffSize: 36 + 12,
    });
    const samples = new Int16Array(buffer, 44);
    const expected = [0, 16384, 32767, -16384, -32767, 32767];
    samples.forEach((s, i) => expect(Math.abs(s - expected[i]!)).toBeLessThanOrEqual(1)); // dither
  });

  it('writes 24-bit samples exactly (no dither)', () => {
    const buffer = encodeWav(Float32Array.from([1, -0.5]), Float32Array.from([0, 0.25]), 48000, 24);
    expect(header(buffer)).toMatchObject({ bits: 24, byteRate: 48000 * 6, dataSize: 12 });
    const bytes = new Uint8Array(buffer, 44);
    const read24 = (i: number) => {
      const value = bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16);
      return value & 0x800000 ? value - 0x1000000 : value;
    };
    expect([0, 3, 6, 9].map(read24)).toEqual([8388607, 0, -4194303, 2097152]);
  });
});
