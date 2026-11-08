import { describe, expect, it } from 'vitest';
import { Envelope, envelopeShape } from './envelope';

const SR = 1000;

function run(envelope: Envelope, shape: ReturnType<typeof envelopeShape>, samples: number) {
  let level = 0;
  for (let i = 0; i < samples; i++) level = envelope.next(shape);
  return level;
}

describe('Envelope', () => {
  it('is idle and silent until triggered', () => {
    const env = new Envelope();
    expect(env.active).toBe(false);
    expect(run(env, envelopeShape(0.01, 0.1, 0.5, 0.1, SR), 10)).toBe(0);
  });

  it('attacks linearly to 1 in the attack time, then decays to sustain', () => {
    const shape = envelopeShape(0.1, 0.1, 0.5, 0.1, SR); // 100 samples of attack
    const env = new Envelope();
    env.trigger();
    expect(run(env, shape, 50)).toBeCloseTo(0.5, 5);
    expect(run(env, shape, 50)).toBeCloseTo(1, 5);
    expect(run(env, shape, 1000)).toBeCloseTo(0.5, 3);
    expect(env.active).toBe(true);
  });

  it('decays by 60 dB over the decay time', () => {
    const shape = envelopeShape(0.001, 0.2, 0, 0.1, SR);
    const env = new Envelope();
    env.trigger();
    run(env, shape, 1); // attack completes in one sample
    expect(run(env, shape, 200)).toBeCloseTo(0.001, 4);
  });

  it('releases to silence and becomes idle', () => {
    const shape = envelopeShape(0.001, 0.1, 0.8, 0.05, SR);
    const env = new Envelope();
    env.trigger();
    run(env, shape, 500);
    env.release();
    expect(env.releasing).toBe(true);
    run(env, shape, 200);
    expect(env.active).toBe(false);
    expect(env.level).toBe(0);
  });

  it('retriggers from the current level (no jump to 0)', () => {
    const shape = envelopeShape(0.1, 0.1, 0.5, 1, SR);
    const env = new Envelope();
    env.trigger();
    run(env, shape, 500);
    env.release();
    const before = run(env, shape, 10);
    env.trigger();
    expect(env.next(shape)).toBeGreaterThan(before);
  });
});
