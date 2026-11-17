import { describe, expect, it } from 'vitest';
import type { ParamDescriptor } from '../../model/boxes/types';
import { formatParam } from './format';

const param = (extra: Partial<ParamDescriptor>): ParamDescriptor => ({
  id: 'x',
  name: 'X',
  min: 0,
  max: 1,
  default: 0,
  scale: 'linear',
  ...extra,
});

describe('formatParam', () => {
  it('formats times in ms below a second', () => {
    const time = param({ unit: 's', min: 0.001, max: 4 });
    expect(formatParam(time, 0.002)).toBe('2 ms');
    expect(formatParam(time, 0.25)).toBe('250 ms');
    expect(formatParam(time, 1.5)).toBe('1.50 s');
  });

  it('formats percents, semitones and cents', () => {
    expect(formatParam(param({ unit: '%' }), 0.6)).toBe('60%');
    expect(formatParam(param({ unit: 'st', min: -24, max: 24 }), 7)).toBe('+7 st');
    expect(formatParam(param({ unit: 'st', min: -24, max: 24 }), -12)).toBe('-12 st');
    expect(formatParam(param({ unit: 'ct', min: -100, max: 100 }), 0)).toBe('0 ct');
  });

  it('formats frequencies', () => {
    const hz = param({ unit: 'Hz', min: 20, max: 20000 });
    expect(formatParam(hz, 440.4)).toBe('440 Hz');
    expect(formatParam(hz, 2000)).toBe('2.00 kHz');
    expect(formatParam(hz, 12500)).toBe('12.5 kHz');
    expect(formatParam(hz, 2.5)).toBe('2.5 Hz'); // slow rates (an LFO's) keep a decimal
  });

  it('uses step labels for enum params', () => {
    const wave = param({ min: 0, max: 2, step: 1, steps: ['A', 'B', 'C'] });
    expect(formatParam(wave, 1)).toBe('B');
  });

  it('falls back to plain numbers', () => {
    expect(formatParam(param({}), 0.123)).toBe('0.12');
    expect(formatParam(param({ max: 10, step: 1 }), 3)).toBe('3');
  });
});
