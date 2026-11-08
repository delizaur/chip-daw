import { CHIP_SYNTH } from '../../model/boxes/chip-synth';
import { ARPEGGIATOR, BITCRUSH, DELAY, FILTER, REVERB } from '../../model/boxes/effects';
import { Bitcrush } from '../effects/bitcrush';
import { Delay } from '../effects/delay';
import { Filter } from '../effects/filter';
import { Reverb } from '../effects/reverb';
import { Arpeggiator } from './arpeggiator';
import { ChipSynth } from './chip-synth';
import type {
  EffectFactory,
  EffectRuntime,
  SequencerFactory,
  SequencerRuntime,
  SynthFactory,
  SynthRuntime,
} from './types';

/** Engine implementations of synth boxes, keyed by box type. */
export const SYNTH_FACTORIES: Readonly<Record<string, SynthFactory>> = {
  [CHIP_SYNTH.type]: (sampleRate) => new ChipSynth(sampleRate),
};

export const EFFECT_FACTORIES: Readonly<Record<string, EffectFactory>> = {
  [BITCRUSH.type]: (sampleRate) => new Bitcrush(sampleRate),
  [FILTER.type]: (sampleRate) => new Filter(sampleRate),
  [DELAY.type]: (sampleRate) => new Delay(sampleRate),
  [REVERB.type]: (sampleRate) => new Reverb(sampleRate),
};

export const SEQUENCER_FACTORIES: Readonly<Record<string, SequencerFactory>> = {
  [ARPEGGIATOR.type]: () => new Arpeggiator(),
};

/** Creates the runtime for a synth box, or null for an unknown type (it then stays silent). */
export function createSynth(type: string, sampleRate: number): SynthRuntime | null {
  return SYNTH_FACTORIES[type]?.(sampleRate) ?? null;
}

/** Unknown effect types are skipped (the signal passes through). */
export function createEffect(type: string, sampleRate: number): EffectRuntime | null {
  return EFFECT_FACTORIES[type]?.(sampleRate) ?? null;
}

/** Unknown sequencer types are skipped (notes pass through). */
export function createSequencer(type: string): SequencerRuntime | null {
  return SEQUENCER_FACTORIES[type]?.() ?? null;
}
