/**
 * PCM WAV encoding (RIFF, little-endian). Pure TS, so it runs in the render worker and tests.
 */
export type BitDepth = 16 | 24;

/**
 * Encodes stereo float samples (-1..1, clipped) as a WAV file. 16-bit output gets TPDF dither
 * (±1 LSB) so quiet fades don't turn into quantization noise patterns.
 */
export function encodeWav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  bitDepth: BitDepth = 16,
): ArrayBuffer {
  const frames = Math.min(left.length, right.length);
  const channels = 2;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);

  const max = bitDepth === 16 ? 32767 : 8388607;
  const dither = bitDepth === 16;
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of [left, right]) {
      let value = Math.max(-1, Math.min(1, channel[i]!)) * max;
      if (dither) value += Math.random() - Math.random();
      const sample = Math.max(-max - 1, Math.min(max, Math.round(value)));
      if (bitDepth === 16) {
        view.setInt16(offset, sample, true);
      } else {
        view.setUint8(offset, sample & 0xff);
        view.setUint8(offset + 1, (sample >> 8) & 0xff);
        view.setInt8(offset + 2, sample >> 16);
      }
      offset += bytesPerSample;
    }
  }
  return buffer;
}
