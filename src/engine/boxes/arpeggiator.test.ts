import { describe, expect, it } from 'vitest';
import { ArpMode, ARP_RATES } from '../../model/boxes/effects';
import { PPQ } from '../../model/constants';
import { ticksPerSecond } from '../../model/time';
import { BlockEvents } from '../note-schedule';
import { BLOCK, SAMPLE_RATE } from '../test-utils';
import { Arpeggiator } from './arpeggiator';
import type { BlockContext } from './types';

const SIXTEENTH = ARP_RATES.indexOf('1/16');
const TICKS_PER_SAMPLE = ticksPerSecond(120) / SAMPLE_RATE;
/** Samples per sixteenth at 120 BPM. */
const STEP = PPQ / 4 / TICKS_PER_SAMPLE;

interface Event {
  sample: number;
  on: boolean;
  pitch: number;
  velocity: number;
}

/** Drives an arp block by block, collecting its output with absolute sample positions. */
function harness(params: Record<string, number>, playing = false, startTick = 0) {
  const arp = new Arpeggiator();
  arp.setParams({ mode: ArpMode.Up, rate: SIXTEENTH, octaves: 1, gate: 0.5, ...params });
  const output = new BlockEvents();
  const events: Event[] = [];
  let sample = 0;
  const context: BlockContext = {
    bpm: 120,
    clockTick: startTick,
    ticksPerSample: TICKS_PER_SAMPLE,
    playing,
  };
  const render = (blocks: number) => {
    for (let b = 0; b < blocks; b++) {
      output.clear();
      arp.render(BLOCK, context, output);
      for (let i = 0; i < output.length; i++) {
        events.push({
          sample: sample + output.offsets[i]!,
          on: output.isOn(i),
          pitch: output.pitches[i]!,
          velocity: output.velocities[i]!,
        });
      }
      sample += BLOCK;
      context.clockTick += TICKS_PER_SAMPLE * BLOCK;
    }
  };
  const blocksFor = (seconds: number) => Math.ceil((seconds * SAMPLE_RATE) / BLOCK);
  const ons = () => events.filter((e) => e.on);
  return { arp, events, render, blocksFor, ons };
}

describe('Arpeggiator', () => {
  it('cycles held notes upwards on the grid, starting immediately', () => {
    const h = harness({});
    h.arp.noteOn(64, 100, 0);
    h.arp.noteOn(60, 90, 0);
    h.arp.noteOn(67, 80, 0);
    h.render(h.blocksFor(0.6));
    const ons = h.ons();
    // Pressed together, so the arp starts from the lowest note.
    expect(ons.slice(0, 5).map((e) => e.pitch)).toEqual([60, 64, 67, 60, 64]);
    expect(ons[0]).toMatchObject({ sample: 0, velocity: 90 });
    // Steps are a sixteenth apart (125 ms at 120 BPM).
    for (let i = 2; i < 5; i++) {
      expect(ons[i]!.sample - ons[i - 1]!.sample).toBeCloseTo(STEP, -1);
    }
  });

  it('plays each note for gate × step', () => {
    const h = harness({ gate: 0.25 });
    h.arp.noteOn(60, 100, 0);
    h.render(h.blocksFor(0.5));
    const on = h.events.findIndex((e) => e.on);
    const off = h.events.findIndex((e, i) => i > on && !e.on);
    expect(h.events[off]!.sample - h.events[on]!.sample).toBeCloseTo(STEP * 0.25, -1);
  });

  it('supports down, up-down and played order', () => {
    const pattern = (mode: number, keys: number[]) => {
      const h = harness({ mode });
      for (const key of keys) h.arp.noteOn(key, 100, 0);
      h.render(h.blocksFor(1));
      return h
        .ons()
        .slice(1, 7)
        .map((e) => e.pitch); // skip the immediate first note
    };
    expect(pattern(ArpMode.Down, [60, 64, 67])).toEqual([64, 60, 67, 64, 60, 67]);
    expect(pattern(ArpMode.UpDown, [60, 64, 67])).toEqual([64, 67, 64, 60, 64, 67]);
    expect(pattern(ArpMode.Played, [67, 60, 64])).toEqual([60, 64, 67, 60, 64, 67]);
  });

  it('spans octaves', () => {
    const h = harness({ octaves: 2 });
    h.arp.noteOn(60, 100, 0);
    h.arp.noteOn(64, 100, 0);
    h.render(h.blocksFor(0.6));
    expect(
      h
        .ons()
        .slice(0, 4)
        .map((e) => e.pitch),
    ).toEqual([60, 64, 72, 76]);
  });

  it('stops as soon as every key is released', () => {
    const h = harness({ gate: 1 });
    h.arp.noteOn(60, 100, 0);
    h.render(h.blocksFor(0.3));
    h.arp.noteOff(60, 10);
    h.render(h.blocksFor(0.5));
    const last = h.events.at(-1)!;
    expect(last.on).toBe(false);
    expect(h.events.filter((e) => e.sample > last.sample)).toEqual([]);
    const ons = h.ons().length;
    h.render(h.blocksFor(0.5));
    expect(h.ons().length).toBe(ons);
  });

  it('keeps notes balanced: every note-on gets a note-off', () => {
    const h = harness({ mode: ArpMode.Random, octaves: 3, gate: 0.9 });
    for (const key of [60, 62, 65, 69]) h.arp.noteOn(key, 100, 0);
    h.render(h.blocksFor(1));
    h.arp.noteOff(62, 5);
    h.arp.noteOff(60, 40);
    h.render(h.blocksFor(0.4));
    h.arp.noteOff(65, 0);
    h.arp.noteOff(69, 0);
    h.render(h.blocksFor(0.2));
    let sounding = 0;
    for (const e of h.events) {
      sounding += e.on ? 1 : -1;
      expect(sounding).toBeGreaterThanOrEqual(0);
      expect(sounding).toBeLessThanOrEqual(1);
    }
    expect(sounding).toBe(0);
  });

  it('locks to the song grid while playing', () => {
    // Song position 100 ticks: the first note plays at once, the next on the next sixteenth.
    const h = harness({}, true, 100);
    h.arp.noteOn(60, 100, 0);
    h.render(h.blocksFor(0.3));
    const ons = h.ons();
    expect(ons[0]!.sample).toBe(0);
    expect(ons[1]!.sample).toBeCloseTo((PPQ / 4 - 100) / TICKS_PER_SAMPLE, -1);
  });

  it('forgets everything on reset', () => {
    const h = harness({});
    h.arp.noteOn(60, 100, 0);
    h.render(2);
    h.arp.reset();
    const before = h.ons().length;
    h.render(h.blocksFor(0.5));
    expect(h.ons().length).toBe(before);
  });
});
