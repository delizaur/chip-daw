import { describe, expect, it } from 'vitest';
import { CHIP_SYNTH } from './chip-synth';
import {
  boxDescriptorsOfKind,
  constrainParam,
  createBox,
  getBoxDescriptor,
  paramValue,
} from './registry';

describe('box registry', () => {
  it('finds descriptors by type and kind', () => {
    expect(getBoxDescriptor('synth.chip')).toBe(CHIP_SYNTH);
    expect(getBoxDescriptor('nope')).toBeUndefined();
    expect(boxDescriptorsOfKind('synth')).toContain(CHIP_SYNTH);
  });

  it('creates boxes with default params', () => {
    const box = createBox('synth.chip');
    expect(box.type).toBe('synth.chip');
    for (const p of CHIP_SYNTH.params) expect(box.params[p.id]).toBe(p.default);
    expect(() => createBox('nope')).toThrow(/Unknown box/);
  });

  it('has valid param descriptors', () => {
    for (const d of [...boxDescriptorsOfKind('synth')]) {
      const ids = d.params.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const p of d.params) {
        expect(p.min).toBeLessThan(p.max);
        expect(p.default).toBeGreaterThanOrEqual(p.min);
        expect(p.default).toBeLessThanOrEqual(p.max);
        if (p.scale === 'exp') expect(p.min).toBeGreaterThan(0);
        if (p.steps) {
          expect(p.step).toBeDefined();
          expect(p.steps).toHaveLength(Math.round((p.max - p.min) / p.step!) + 1);
        }
      }
    }
  });

  it('constrains values to range and step', () => {
    const wave = CHIP_SYNTH.params.find((p) => p.id === 'wave')!;
    expect(constrainParam(wave, 2.4)).toBe(2);
    expect(constrainParam(wave, 99)).toBe(5);
    const sustain = CHIP_SYNTH.params.find((p) => p.id === 'sustain')!;
    expect(constrainParam(sustain, -1)).toBe(0);
    expect(constrainParam(sustain, 0.33)).toBe(0.33);
  });

  it('falls back to defaults for missing params', () => {
    const level = CHIP_SYNTH.params.find((p) => p.id === 'level')!;
    expect(paramValue({ id: 'x', type: 'synth.chip', params: {} }, level)).toBe(level.default);
  });
});
