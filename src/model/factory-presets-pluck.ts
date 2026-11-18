/**
 * Starter presets for the pluck (string model) synth: guitars, harp, mallets, bells, basses
 * and bowed strings. Part of `factoryLibrary`.
 */
import { PluckExcite } from './boxes/pluck-synth';
import { createBox } from './boxes/registry';
import { createId } from './ids';
import type { LibraryPreset } from './library';
import type { BoxInstance } from './types';
import type { StarterFolders } from './factory-presets-analog';

function box(type: string, params: Record<string, number> = {}): BoxInstance {
  const created = createBox(type);
  return { ...created, params: { ...created.params, ...params } };
}

export function pluckPresets(folders: StarterFolders): LibraryPreset[] {
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
      synth: box('synth.pluck', synth),
      effects,
    },
  });
  const reverb = (size: number, wet: number) => box('fx.reverb', { size, wet });
  const { Pluck, Strike, Bow } = PluckExcite;

  return [
    // Guitars and harp.
    entry(
      folders.leads,
      'Nylon guitar',
      {
        excite: Pluck,
        brightness: 0.45,
        position: 0.2,
        decay: 2.5,
        damping: 0.55,
        body: 0.5,
        bodySize: 0.45,
        release: 0.2,
      },
      [reverb(0.5, 0.15)],
    ),
    entry(
      folders.leads,
      'Steel guitar',
      {
        excite: Pluck,
        brightness: 0.75,
        position: 0.12,
        decay: 4,
        damping: 0.2,
        body: 0.35,
        double: 0.2,
        release: 0.25,
      },
      [reverb(0.55, 0.15)],
    ),
    entry(
      folders.leads,
      '12-string',
      {
        excite: Pluck,
        brightness: 0.7,
        position: 0.14,
        decay: 4,
        damping: 0.25,
        body: 0.3,
        double: 1,
        release: 0.3,
      },
      [reverb(0.65, 0.2)],
    ),
    entry(
      folders.leads,
      'Harp',
      {
        excite: Pluck,
        brightness: 0.5,
        position: 0.3,
        decay: 5,
        damping: 0.5,
        body: 0.25,
        bodySize: 0.3,
        release: 1.2,
      },
      [reverb(0.85, 0.35)],
    ),

    // Mallets and bells.
    entry(
      folders.leads,
      'Kalimba',
      {
        excite: Strike,
        brightness: 0.55,
        position: 0.3,
        decay: 1.2,
        damping: 0.3,
        stiffness: 0.35,
        body: 0.6,
        bodySize: 0.8,
        release: 0.6,
      },
      [reverb(0.6, 0.2)],
    ),
    entry(
      folders.leads,
      'Marimba',
      {
        excite: Strike,
        brightness: 0.35,
        position: 0.5,
        decay: 0.8,
        damping: 0.7,
        stiffness: 0.2,
        body: 0.7,
        bodySize: 0.2,
        release: 0.4,
      },
      [reverb(0.6, 0.18)],
    ),
    entry(
      folders.fx,
      'Music box',
      {
        excite: Strike,
        brightness: 0.9,
        position: 0.1,
        decay: 3,
        damping: 0.1,
        stiffness: 0.55,
        body: 0.2,
        bodySize: 0.9,
        release: 1.5,
        transpose: 12,
      },
      [reverb(0.8, 0.35)],
    ),
    entry(
      folders.fx,
      'Tubular bell',
      {
        excite: Strike,
        brightness: 0.7,
        position: 0.2,
        decay: 6,
        damping: 0.15,
        stiffness: 1,
        body: 0,
        double: 0.3,
        release: 2,
      },
      [reverb(0.9, 0.35)],
    ),

    // Bass.
    entry(folders.bass, 'Pluck bass', {
      excite: Pluck,
      brightness: 0.35,
      position: 0.25,
      decay: 1.5,
      damping: 0.7,
      body: 0.2,
      release: 0.1,
      transpose: -12,
      level: 0.85,
    }),
    entry(folders.bass, 'Upright bass', {
      excite: Pluck,
      brightness: 0.25,
      position: 0.3,
      decay: 1.2,
      damping: 0.8,
      body: 0.7,
      bodySize: 0.2,
      release: 0.12,
      transpose: -12,
      level: 0.9,
    }),

    // Bowed.
    entry(
      folders.pads,
      'Bowed cello',
      {
        excite: Bow,
        brightness: 0.45,
        position: 0.15,
        decay: 2,
        damping: 0.6,
        body: 0.6,
        bodySize: 0.3,
        release: 0.4,
        transpose: -12,
      },
      [reverb(0.75, 0.3)],
    ),
    entry(
      folders.pads,
      'Bowed strings',
      {
        excite: Bow,
        brightness: 0.55,
        position: 0.12,
        decay: 2,
        damping: 0.5,
        body: 0.4,
        double: 0.6,
        release: 0.6,
      },
      [reverb(0.85, 0.35)],
    ),
  ];
}
