/**
 * Starter presets for the 4-operator FM synth: the DX / Mega Drive classics (electric piano,
 * bells, brass, organ, basses...). Part of `factoryLibrary`.
 */
import { FM4_RATIOS } from './boxes/fm4-synth';
import { createBox } from './boxes/registry';
import type { StarterFolders } from './factory-presets-analog';
import { createId } from './ids';
import type { LibraryPreset } from './library';
import type { BoxInstance } from './types';

function box(type: string, params: Record<string, number> = {}): BoxInstance {
  const created = createBox(type);
  return { ...created, params: { ...created.params, ...params } };
}

/** One operator's settings: ratio (a multiple of the note), level and envelope. */
interface Op {
  ratio: number;
  level: number;
  attack?: number;
  decay?: number;
  sustain?: number;
  detune?: number;
}

/** Params for `algorithm` (1-based, as shown) and four operators. */
function patch(algorithm: number, ops: [Op, Op, Op, Op], extra: Record<string, number> = {}) {
  const params: Record<string, number> = { algorithm: algorithm - 1, ...extra };
  ops.forEach((op, i) => {
    const n = i + 1;
    params[`op${n}Ratio`] = FM4_RATIOS.indexOf(op.ratio as (typeof FM4_RATIOS)[number]);
    params[`op${n}Level`] = op.level;
    params[`op${n}Attack`] = op.attack ?? 0.002;
    params[`op${n}Decay`] = op.decay ?? 1;
    params[`op${n}Sustain`] = op.sustain ?? 1;
    params[`op${n}Detune`] = op.detune ?? 0;
  });
  return params;
}

export function fm4Presets(folders: StarterFolders): LibraryPreset[] {
  const entry = (
    folderId: string,
    name: string,
    synth: Record<string, number>,
    effects: BoxInstance[] = [],
  ): LibraryPreset => ({
    folderId,
    preset: {
      id: createId(),
      name,
      sequencers: [],
      synth: box('synth.fm4', synth),
      effects,
    },
  });
  const reverb = (size: number, wet: number) => box('fx.reverb', { size, wet });

  return [
    // Two pairs: a bell-like "tine" (a high ratio, quickly fading) over a mellow body.
    entry(
      folders.leads,
      'DX piano',
      patch(
        5,
        [
          { ratio: 1, level: 0.8, decay: 2.5, sustain: 0.25 },
          { ratio: 14, level: 0.35, decay: 0.15, sustain: 0 },
          { ratio: 1, level: 0.6, decay: 1.5, sustain: 0.3, detune: 4 },
          { ratio: 1, level: 0.45, decay: 0.8, sustain: 0.15 },
        ],
        { release: 0.4 },
      ),
      [reverb(0.6, 0.18)],
    ),
    entry(
      folders.leads,
      'Brass stack',
      patch(
        2,
        [
          { ratio: 1, level: 0.85, attack: 0.06, decay: 1, sustain: 0.8 },
          { ratio: 1, level: 0.55, attack: 0.08, decay: 0.5, sustain: 0.5 },
          { ratio: 1, level: 0.3, detune: 5 },
          { ratio: 1, level: 0.3, detune: -5 },
        ],
        { feedback: 0.3, release: 0.25 },
      ),
      [reverb(0.6, 0.15)],
    ),
    // Additive: four "drawbars" at 16', 8', 4' and 2'.
    entry(
      folders.leads,
      'Drawbar organ',
      patch(
        8,
        [
          { ratio: 0.5, level: 0.7 },
          { ratio: 1, level: 0.8 },
          { ratio: 2, level: 0.5 },
          { ratio: 4, level: 0.35 },
        ],
        { release: 0.08, level: 1 },
      ),
      [reverb(0.5, 0.12)],
    ),
    entry(
      folders.leads,
      'Clavi',
      patch(
        5,
        [
          { ratio: 1, level: 0.8, decay: 0.6, sustain: 0.2 },
          { ratio: 3, level: 0.55, decay: 0.2, sustain: 0.1 },
          { ratio: 2, level: 0.5, decay: 0.5, sustain: 0.15, detune: 3 },
          { ratio: 5, level: 0.3, decay: 0.15, sustain: 0 },
        ],
        { release: 0.08, level: 0.85 },
      ),
    ),
    entry(
      folders.leads,
      'Steel drum',
      patch(
        5,
        [
          { ratio: 1, level: 0.85, decay: 0.8, sustain: 0 },
          { ratio: 3, level: 0.3, decay: 0.3, sustain: 0 },
          { ratio: 2, level: 0.4, decay: 0.5, sustain: 0, detune: 12 },
          { ratio: 5, level: 0.25, decay: 0.2, sustain: 0 },
        ],
        { release: 0.3, level: 0.85 },
      ),
      [reverb(0.6, 0.2)],
    ),

    // Bass.
    entry(
      folders.bass,
      'Digital bass',
      patch(
        1,
        [
          { ratio: 1, level: 0.9, decay: 0.5, sustain: 0.9 },
          { ratio: 1, level: 0.6, decay: 0.3, sustain: 0.35 },
          { ratio: 2, level: 0.3, decay: 0.2, sustain: 0.1 },
          { ratio: 1, level: 0.3 },
        ],
        { feedback: 0.4, release: 0.1, transpose: -12, level: 0.8 },
      ),
    ),
    entry(
      folders.bass,
      'Growl bass',
      patch(
        1,
        [
          { ratio: 1, level: 0.9, decay: 0.4, sustain: 0.7 },
          { ratio: 2, level: 0.4, decay: 0.6, sustain: 0.4 },
          { ratio: 1, level: 0.5 },
          { ratio: 1, level: 0.5 },
        ],
        { feedback: 0.7, release: 0.1, transpose: -12, level: 0.75 },
      ),
    ),

    // Pads and bells.
    entry(
      folders.pads,
      'Crystal pad',
      patch(
        7,
        [
          { ratio: 1, level: 0.6, attack: 0.8, decay: 2, sustain: 0.8 },
          { ratio: 2, level: 0.4, attack: 1, decay: 2, sustain: 0.7, detune: 7 },
          { ratio: 1, level: 0.5, attack: 0.6, decay: 2, sustain: 0.8, detune: -7 },
          { ratio: 4, level: 0.35, decay: 2, sustain: 0.3 },
        ],
        { release: 2.5, level: 0.65 },
      ),
      [reverb(0.9, 0.4)],
    ),
    entry(
      folders.fx,
      'Glass bells',
      patch(
        5,
        [
          { ratio: 1, level: 0.8, decay: 4, sustain: 0 },
          { ratio: 7, level: 0.5, decay: 3, sustain: 0 },
          { ratio: 2, level: 0.5, decay: 3, sustain: 0 },
          { ratio: 5, level: 0.4, decay: 2, sustain: 0, detune: 7 },
        ],
        { release: 2 },
      ),
      [reverb(0.85, 0.35)],
    ),
  ];
}
