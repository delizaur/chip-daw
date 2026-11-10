/**
 * Starter presets, put in the library the first time it's opened (an empty library would be
 * a bleak first impression). Built from the box descriptors, so they always use valid params.
 */
import { ChipWave } from './boxes/chip-synth';
import { ArpMode, ARP_RATES, FilterType, SYNC_DIVISIONS } from './boxes/effects';
import { FM_RATIOS } from './boxes/fm-synth';
import { createBox } from './boxes/registry';
import { WAVES } from './boxes/wave-synth';
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
  chain: { sequencers?: BoxInstance[]; effects?: BoxInstance[]; synthType?: string } = {},
): Preset {
  return {
    id: createId(),
    name,
    sequencers: chain.sequencers ?? [],
    synth: box(chain.synthType ?? 'synth.chip', synth),
    effects: chain.effects ?? [],
  };
}

/** FM ratio param value for a modulator multiple. */
const ratio = (multiple: number) => FM_RATIOS.indexOf(multiple as (typeof FM_RATIOS)[number]);
const fm = { synthType: 'synth.fm' };

/** Wave synth param value for a preset wave's name. */
const waveNamed = (name: string) => WAVES.findIndex((w) => w.name === name);
const wave = { synthType: 'synth.wave' };

const division = (label: string) => SYNC_DIVISIONS.findIndex((d) => d.label === label);

export function factoryLibrary(): Library {
  const folders = ['Leads', 'Bass', 'Drums', 'FX'].map((name) => ({ id: createId(), name }));
  const [leads, bass, drums, fx] = folders.map((f) => f.id) as [string, string, string, string];
  const entry = (folderId: string, p: Preset): LibraryPreset => ({ folderId, preset: p });

  const library: Library = {
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
        leads,
        preset(
          'FM e-piano',
          {
            ratio: ratio(1),
            amount: 0.45,
            modDecay: 0.6,
            modSustain: 0.1,
            decay: 1.4,
            sustain: 0.25,
            release: 0.35,
          },
          { ...fm, effects: [box('fx.reverb', { wet: 0.2 })] },
        ),
      ),
      entry(
        leads,
        preset(
          'FM glock',
          {
            ratio: ratio(7),
            amount: 0.5,
            modDecay: 0.15,
            modSustain: 0,
            decay: 0.8,
            sustain: 0,
            release: 0.6,
            transpose: 12,
          },
          { ...fm, effects: [box('fx.reverb', { wet: 0.25 })] },
        ),
      ),
      entry(
        bass,
        preset(
          'FM bass',
          {
            ratio: ratio(1),
            amount: 0.6,
            modDecay: 0.18,
            modSustain: 0.25,
            feedback: 0.35,
            decay: 0.3,
            sustain: 0.7,
            release: 0.08,
            transpose: -12,
            level: 0.85,
          },
          fm,
        ),
      ),
      entry(
        leads,
        preset(
          'FM brass',
          {
            ratio: ratio(1),
            amount: 0.55,
            modDecay: 0.7,
            modSustain: 0.55,
            feedback: 0.25,
            attack: 0.04,
            decay: 0.5,
            sustain: 0.8,
            release: 0.15,
          },
          { ...fm, effects: [box('fx.reverb', { wet: 0.15 })] },
        ),
      ),
      entry(
        leads,
        preset(
          'FM organ',
          {
            ratio: ratio(2),
            amount: 0.3,
            modDecay: 0.05,
            modSustain: 0.9,
            attack: 0.005,
            decay: 0.1,
            sustain: 1,
            release: 0.06,
            level: 0.6,
          },
          fm,
        ),
      ),
      entry(
        leads,
        preset(
          'FM saw lead',
          {
            ratio: ratio(1),
            amount: 0.45,
            modDecay: 0.4,
            modSustain: 0.7,
            feedback: 0.75,
            decay: 0.4,
            sustain: 0.75,
            release: 0.12,
            level: 0.6,
          },
          { ...fm, effects: [box('fx.delay', { time: division('1/8d'), wet: 0.2 })] },
        ),
      ),
      entry(
        bass,
        preset(
          'FM slap bass',
          {
            ratio: ratio(3),
            amount: 0.7,
            modDecay: 0.06,
            modSustain: 0.05,
            feedback: 0.15,
            decay: 0.35,
            sustain: 0.4,
            release: 0.06,
            transpose: -12,
            level: 0.85,
          },
          fm,
        ),
      ),
      entry(
        drums,
        preset(
          'FM tom',
          {
            ratio: ratio(0.5),
            amount: 0.5,
            modDecay: 0.05,
            modSustain: 0,
            decay: 0.25,
            sustain: 0,
            release: 0.1,
            transpose: -12,
            level: 0.9,
          },
          fm,
        ),
      ),
      entry(
        drums,
        preset(
          'FM metal hat',
          {
            ratio: ratio(15),
            amount: 1,
            modDecay: 0.08,
            modSustain: 0.4,
            feedback: 1,
            decay: 0.06,
            sustain: 0,
            release: 0.04,
            transpose: 24,
            level: 0.4,
          },
          fm,
        ),
      ),
      entry(
        fx,
        preset(
          'FM bell pad',
          {
            ratio: ratio(7),
            amount: 0.35,
            modDecay: 1.5,
            modSustain: 0.2,
            attack: 0.4,
            decay: 1.5,
            sustain: 0.5,
            release: 1.5,
            level: 0.6,
          },
          {
            ...fm,
            effects: [
              box('fx.delay', { time: division('1/4d'), feedback: 0.4, wet: 0.25 }),
              box('fx.reverb', { size: 0.85, wet: 0.35 }),
            ],
          },
        ),
      ),
      entry(
        leads,
        preset(
          'Wave lead',
          { wave: waveNamed('Square'), morph: 0.3, decay: 0.35, sustain: 0.7, release: 0.12 },
          { ...wave, effects: [box('fx.delay', { time: division('1/8d'), wet: 0.2 })] },
        ),
      ),
      entry(
        leads,
        preset(
          'Wave vocal',
          {
            wave: waveNamed('Vocal'),
            morph: 0.2,
            attack: 0.03,
            decay: 0.5,
            sustain: 0.8,
            release: 0.2,
          },
          { ...wave, effects: [box('fx.reverb', { wet: 0.2 })] },
        ),
      ),
      entry(
        leads,
        preset(
          'Wave organ',
          { wave: waveNamed('Organ'), decay: 0.1, sustain: 1, release: 0.06, level: 0.6 },
          wave,
        ),
      ),
      entry(
        bass,
        preset(
          'Wave bass',
          {
            wave: waveNamed('Saw'),
            decay: 0.3,
            sustain: 0.6,
            release: 0.06,
            transpose: -12,
            level: 0.85,
          },
          wave,
        ),
      ),
      entry(
        bass,
        preset(
          'Wave sine bass',
          {
            wave: waveNamed('Sine'),
            morph: 0.25,
            decay: 0.4,
            sustain: 0.8,
            release: 0.08,
            transpose: -12,
            level: 0.9,
          },
          wave,
        ),
      ),
      entry(
        drums,
        preset(
          'Wave kick',
          {
            wave: waveNamed('Sine'),
            decay: 0.1,
            sustain: 0,
            release: 0.05,
            transpose: -24,
            level: 1,
          },
          wave,
        ),
      ),
      entry(
        fx,
        preset(
          'Wave bell',
          { wave: waveNamed('Bright'), decay: 1.2, sustain: 0, release: 1, level: 0.6 },
          {
            ...wave,
            effects: [
              box('fx.delay', { time: division('1/4d'), feedback: 0.35, wet: 0.25 }),
              box('fx.reverb', { size: 0.8, wet: 0.3 }),
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
  return { ...library, starters: library.presets.map((p) => p.preset.name) };
}
