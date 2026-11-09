/**
 * Starter presets, put in the library the first time it's opened (an empty library would be
 * a bleak first impression). Built from the box descriptors, so they always use valid params.
 */
import { ChipWave } from './boxes/chip-synth';
import { ArpMode, ARP_RATES, FilterType, SYNC_DIVISIONS } from './boxes/effects';
import { createBox } from './boxes/registry';
import { createId } from './ids';
import { emptyLibrary, type Library, type LibraryPreset } from './library';
import type { BoxInstance, Preset } from './types';

function box(type: string, params: Record<string, number> = {}): BoxInstance {
  const created = createBox(type);
  return { ...created, params: { ...created.params, ...params } };
}

function preset(
  name: string,
  synth: Record<string, number>,
  chain: { sequencers?: BoxInstance[]; effects?: BoxInstance[] } = {},
): Preset {
  return {
    id: createId(),
    name,
    sequencers: chain.sequencers ?? [],
    synth: box('synth.chip', synth),
    effects: chain.effects ?? [],
  };
}

const division = (label: string) => SYNC_DIVISIONS.findIndex((d) => d.label === label);

export function factoryLibrary(): Library {
  const folders = ['Leads', 'Bass', 'Drums', 'FX'].map((name) => ({ id: createId(), name }));
  const [leads, bass, drums, fx] = folders.map((f) => f.id) as [string, string, string, string];
  const entry = (folderId: string, p: Preset): LibraryPreset => ({ folderId, preset: p });

  return {
    ...emptyLibrary(),
    folders,
    presets: [
      entry(
        leads,
        preset(
          'Square lead',
          { wave: ChipWave.Pulse50, decay: 0.4, sustain: 0.7, release: 0.15 },
          { effects: [box('fx.delay', { wet: 0.2, feedback: 0.3 })] },
        ),
      ),
      entry(
        leads,
        preset(
          'Thin lead',
          { wave: ChipWave.Pulse12, decay: 0.3, sustain: 0.6, release: 0.1 },
          { effects: [box('fx.bitcrush', { bits: 8, rate: 22050 })] },
        ),
      ),
      entry(
        leads,
        preset(
          'Arp sparkle',
          { wave: ChipWave.Pulse25, decay: 0.12, sustain: 0.2, release: 0.08, level: 0.6 },
          {
            sequencers: [
              box('seq.arp', { mode: ArpMode.UpDown, rate: ARP_RATES.indexOf('1/16'), octaves: 2 }),
            ],
            effects: [
              box('fx.delay', { time: division('1/8d'), wet: 0.3 }),
              box('fx.reverb', { wet: 0.2 }),
            ],
          },
        ),
      ),
      entry(
        bass,
        preset('Triangle bass', {
          wave: ChipWave.Triangle,
          transpose: -12,
          decay: 0.4,
          sustain: 0.8,
          release: 0.08,
          level: 0.9,
        }),
      ),
      entry(
        bass,
        preset(
          'Pulse bass',
          { wave: ChipWave.Pulse25, transpose: -12, decay: 0.25, sustain: 0.5, release: 0.06 },
          {
            effects: [box('fx.filter', { type: FilterType.LowPass, cutoff: 1200, resonance: 0.3 })],
          },
        ),
      ),
      entry(
        drums,
        preset('Triangle kick', {
          wave: ChipWave.Triangle,
          transpose: -24,
          decay: 0.12,
          sustain: 0,
          release: 0.05,
          level: 1,
        }),
      ),
      entry(
        drums,
        preset('Noise snare', {
          wave: ChipWave.Noise,
          transpose: 12,
          decay: 0.16,
          sustain: 0,
          release: 0.08,
        }),
      ),
      entry(
        drums,
        preset('Noise hat', {
          wave: ChipWave.Noise,
          transpose: 24,
          decay: 0.05,
          sustain: 0,
          release: 0.03,
          level: 0.5,
        }),
      ),
      entry(
        fx,
        preset(
          'Echo pluck',
          { wave: ChipWave.Pulse50, decay: 0.1, sustain: 0, release: 0.1 },
          {
            effects: [
              box('fx.delay', { time: division('1/8d'), feedback: 0.6, wet: 0.45 }),
              box('fx.reverb', { size: 0.8, wet: 0.3 }),
            ],
          },
        ),
      ),
      entry(
        fx,
        preset(
          'Metal zap',
          { wave: ChipWave.MetalNoise, decay: 0.2, sustain: 0, release: 0.1 },
          { effects: [box('fx.bitcrush', { bits: 5, rate: 8000 })] },
        ),
      ),
    ],
  };
}
