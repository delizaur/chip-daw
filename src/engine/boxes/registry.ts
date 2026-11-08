import { CHIP_SYNTH } from '../../model/boxes/chip-synth';
import { ChipSynth } from './chip-synth';
import type { SynthFactory, SynthRuntime } from './types';

/** Engine implementations of synth boxes, keyed by box type. */
export const SYNTH_FACTORIES: Readonly<Record<string, SynthFactory>> = {
  [CHIP_SYNTH.type]: (sampleRate) => new ChipSynth(sampleRate),
};

/** Creates the runtime for a synth box, or null for an unknown type (it then stays silent). */
export function createSynth(type: string, sampleRate: number): SynthRuntime | null {
  return SYNTH_FACTORIES[type]?.(sampleRate) ?? null;
}
