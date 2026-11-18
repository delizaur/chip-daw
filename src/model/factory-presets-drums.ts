/**
 * Starter kits for the drum synth: classic drum machines and a few characters. Part of
 * `factoryLibrary`.
 */
import { createBox } from './boxes/registry';
import { createId } from './ids';
import type { LibraryPreset } from './library';
import type { BoxInstance } from './types';

function box(type: string, params: Record<string, number> = {}): BoxInstance {
  const created = createBox(type);
  return { ...created, params: { ...created.params, ...params } };
}

export function drumPresets(drums: string): LibraryPreset[] {
  const kit = (
    name: string,
    params: Record<string, number>,
    effects: BoxInstance[] = [],
  ): LibraryPreset => ({
    folderId: drums,
    preset: {
      id: createId(),
      name,
      sequencers: [],
      synth: box('synth.drums', params),
      effects,
    },
  });

  return [
    // Long, booming kick, soft snare, sizzly hats.
    kit('808 kit', {
      kickTune: 45,
      kickDecay: 1.2,
      kickPunch: 0.35,
      kickDrive: 0.1,
      snareTune: 180,
      snareDecay: 0.18,
      snareSnappy: 0.5,
      snareTone: 3500,
      hatClosed: 0.04,
      hatOpen: 0.5,
      hatTone: 0.45,
      tomTune: 95,
      tomDecay: 0.5,
    }),
    // Short, punchy and driven kick; bright snare; tight hats.
    kit('909 kit', {
      kickTune: 55,
      kickDecay: 0.35,
      kickPunch: 0.8,
      kickDrive: 0.5,
      snareTune: 220,
      snareDecay: 0.22,
      snareSnappy: 0.75,
      snareTone: 6000,
      hatClosed: 0.06,
      hatOpen: 0.35,
      hatTone: 0.75,
      tomTune: 120,
      tomDecay: 0.3,
    }),
    // Dry and short, for busy patterns.
    kit('Tight kit', {
      kickTune: 60,
      kickDecay: 0.18,
      kickPunch: 0.6,
      kickDrive: 0.3,
      snareTune: 240,
      snareDecay: 0.1,
      snareSnappy: 0.55,
      snareTone: 5000,
      hatClosed: 0.025,
      hatOpen: 0.2,
      hatTone: 0.6,
      tomTune: 140,
      tomDecay: 0.18,
      width: 0.3,
    }),
    // Big and roomy.
    kit(
      'Boom kit',
      {
        kickTune: 40,
        kickDecay: 1.6,
        kickPunch: 0.5,
        kickDrive: 0.35,
        snareTune: 160,
        snareDecay: 0.35,
        snareSnappy: 0.5,
        snareTone: 3000,
        hatClosed: 0.05,
        hatOpen: 0.7,
        hatTone: 0.4,
        tomTune: 80,
        tomDecay: 0.8,
        width: 0.8,
      },
      [box('fx.reverb', { size: 0.75, damping: 0.6, wet: 0.25 })],
    ),
    // Crunchy, like an old sampler.
    kit(
      'Lo-fi kit',
      {
        kickTune: 52,
        kickDecay: 0.5,
        kickPunch: 0.45,
        kickDrive: 0.6,
        snareTune: 200,
        snareDecay: 0.2,
        snareSnappy: 0.65,
        snareTone: 3000,
        hatClosed: 0.05,
        hatOpen: 0.4,
        hatTone: 0.3,
        width: 0.2,
      },
      [box('fx.bitcrush', { bits: 8, rate: 12000, mix: 0.8 }), box('fx.filter', { cutoff: 7000 })],
    ),
  ];
}
