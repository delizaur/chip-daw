import { describe, expect, it } from 'vitest';
import { VoicePool, type Voice } from './voice-pool';

class FakeVoice implements Voice {
  pitch = -1;
  active = false;
  releasing = false;
  start(pitch: number) {
    this.pitch = pitch;
    this.active = true;
    this.releasing = false;
  }
  release() {
    if (this.active) this.releasing = true;
  }
  render() {}
}

const pool = (n: number) => new VoicePool(Array.from({ length: n }, () => new FakeVoice()));
const pitches = (p: VoicePool<FakeVoice>) => p.voices.map((v) => v.pitch);

describe('VoicePool', () => {
  it('uses free voices first', () => {
    const p = pool(3);
    p.noteOn(60, 100);
    p.noteOn(64, 100);
    expect(pitches(p)).toEqual([60, 64, -1]);
    expect(p.activeCount).toBe(2);
  });

  it('releases every held voice of a pitch on note-off', () => {
    const p = pool(3);
    p.noteOn(60, 100);
    p.noteOn(60, 100);
    p.noteOn(62, 100);
    p.noteOff(60);
    expect(p.voices.map((v) => v.releasing)).toEqual([true, true, false]);
  });

  it('steals the oldest releasing voice before held ones', () => {
    const p = pool(3);
    p.noteOn(60, 100);
    p.noteOn(62, 100);
    p.noteOn(64, 100);
    p.noteOff(62);
    p.noteOn(67, 100);
    expect(pitches(p)).toEqual([60, 67, 64]);
  });

  it('steals the oldest voice when all are held', () => {
    const p = pool(2);
    p.noteOn(60, 100);
    p.noteOn(62, 100);
    p.noteOn(64, 100);
    expect(pitches(p)).toEqual([64, 62]);
    p.noteOn(65, 100);
    expect(pitches(p)).toEqual([64, 65]);
  });
});
