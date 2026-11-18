/**
 * Starter presets for the analog synth: pads, leads, basses, keys and an FX, beyond the
 * chiptune palette. Part of `factoryLibrary`.
 */
import { AnalogFilter, AnalogLfoTarget, AnalogWave } from './boxes/analog-synth';
import { SYNC_DIVISIONS } from './boxes/effects';
import { createBox } from './boxes/registry';
import { createId } from './ids';
import type { LibraryPreset } from './library';
import type { BoxInstance } from './types';

function box(type: string, params: Record<string, number> = {}): BoxInstance {
  const created = createBox(type);
  return { ...created, params: { ...created.params, ...params } };
}

const division = (label: string) => SYNC_DIVISIONS.findIndex((d) => d.label === label);
const { Saw, Square, Triangle, Sine } = AnalogWave;

/** Folder ids of the starter library, by name. */
export interface StarterFolders {
  leads: string;
  bass: string;
  pads: string;
  fx: string;
}

export function analogPresets(folders: StarterFolders): LibraryPreset[] {
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
      synth: box('synth.analog', synth),
      effects,
    },
  });
  const reverb = (size: number, wet: number) => box('fx.reverb', { size, wet });
  const delay = (time: string, feedback: number, wet: number) =>
    box('fx.delay', { time: division(time), feedback, wet });

  return [
    // Pads: slow, wide and moving.
    entry(
      folders.pads,
      'Supersaw pad',
      {
        osc1Wave: Saw,
        osc2Wave: Saw,
        unison: 7,
        spread: 0.7,
        detune: 12,
        cutoff: 3200,
        resonance: 0.15,
        envAmount: 0.15,
        filterDecay: 1.5,
        filterSustain: 0.5,
        attack: 0.6,
        decay: 1.5,
        sustain: 0.85,
        release: 2.5,
        lfoTarget: AnalogLfoTarget.Filter,
        lfoRate: 0.3,
        lfoDepth: 0.15,
        level: 0.6,
      },
      [reverb(0.85, 0.35)],
    ),
    entry(
      folders.pads,
      'Warm strings',
      {
        osc1Wave: Saw,
        osc2Wave: Saw,
        unison: 5,
        spread: 0.5,
        detune: 15,
        filterType: AnalogFilter.LowPass12,
        cutoff: 2200,
        envAmount: 0.1,
        attack: 0.35,
        decay: 1,
        sustain: 0.9,
        release: 1.2,
        lfoTarget: AnalogLfoTarget.Pitch,
        lfoRate: 5,
        lfoDepth: 0.04,
        level: 0.6,
      },
      [reverb(0.75, 0.3)],
    ),
    entry(
      folders.pads,
      'Dark drone',
      {
        osc1Wave: Saw,
        osc2Wave: Square,
        osc2Pitch: -12,
        unison: 3,
        spread: 0.8,
        detune: 6,
        cutoff: 450,
        resonance: 0.55,
        drive: 0.3,
        envAmount: 0,
        attack: 1.2,
        sustain: 1,
        release: 4,
        lfoTarget: AnalogLfoTarget.Filter,
        lfoRate: 0.12,
        lfoDepth: 0.45,
        level: 0.75,
      },
      [reverb(0.95, 0.45)],
    ),
    entry(
      folders.pads,
      'Glass pad',
      {
        osc1Wave: Triangle,
        osc2Wave: Sine,
        osc2Pitch: 12,
        mix: 0.4,
        unison: 3,
        spread: 0.6,
        detune: 5,
        cutoff: 5000,
        attack: 0.8,
        decay: 2,
        sustain: 0.7,
        release: 3,
        lfoTarget: AnalogLfoTarget.Amp,
        lfoRate: 3,
        lfoDepth: 0.15,
        level: 0.7,
      },
      [delay('1/4d', 0.4, 0.25), reverb(0.9, 0.4)],
    ),

    // Leads.
    entry(
      folders.leads,
      'Analog lead',
      {
        osc1Wave: Saw,
        osc2Wave: Square,
        osc2Pitch: 12,
        mix: 0.3,
        detune: 10,
        cutoff: 1800,
        resonance: 0.35,
        drive: 0.2,
        envAmount: 0.45,
        filterDecay: 0.3,
        filterSustain: 0.3,
        decay: 0.3,
        sustain: 0.8,
        release: 0.2,
        glide: 0.08,
        lfoTarget: AnalogLfoTarget.Pitch,
        lfoRate: 5.5,
        lfoDepth: 0.06,
        level: 0.85,
      },
      [delay('1/8d', 0.3, 0.2)],
    ),
    entry(
      folders.leads,
      'Trance lead',
      {
        osc1Wave: Saw,
        osc2Wave: Saw,
        unison: 7,
        spread: 0.55,
        detune: 8,
        cutoff: 6000,
        resonance: 0.1,
        envAmount: 0.2,
        filterDecay: 0.2,
        decay: 0.3,
        sustain: 0.75,
        release: 0.3,
        level: 0.65,
      },
      [delay('1/8d', 0.35, 0.25), reverb(0.7, 0.2)],
    ),
    entry(
      folders.leads,
      'Brass section',
      {
        osc1Wave: Saw,
        osc2Wave: Saw,
        unison: 3,
        spread: 0.4,
        detune: 10,
        cutoff: 900,
        resonance: 0.1,
        envAmount: 0.5,
        filterDecay: 0.4,
        filterSustain: 0.45,
        attack: 0.06,
        decay: 0.5,
        sustain: 0.8,
        release: 0.25,
        level: 0.8,
      },
      [reverb(0.6, 0.2)],
    ),
    entry(
      folders.leads,
      'Pluck keys',
      {
        osc1Wave: Saw,
        osc2Wave: Square,
        mix: 0.4,
        detune: 7,
        cutoff: 380,
        resonance: 0.3,
        envAmount: 0.75,
        filterDecay: 0.25,
        filterSustain: 0,
        decay: 0.7,
        sustain: 0,
        release: 0.4,
        level: 0.95,
      },
      [delay('1/4d', 0.35, 0.25), reverb(0.7, 0.25)],
    ),

    // Bass.
    entry(folders.bass, 'Moog bass', {
      osc1Wave: Saw,
      osc2Wave: Square,
      osc2Pitch: -12,
      mix: 0.4,
      sub: 0.3,
      detune: 4,
      cutoff: 260,
      resonance: 0.45,
      drive: 0.4,
      envAmount: 0.6,
      filterDecay: 0.25,
      filterSustain: 0,
      decay: 0.3,
      sustain: 0.8,
      release: 0.08,
      transpose: -12,
      level: 0.95,
    }),
    entry(folders.bass, 'Acid bass', {
      osc1Wave: Saw,
      mix: 0,
      detune: 0,
      cutoff: 280,
      resonance: 0.82,
      drive: 0.5,
      envAmount: 0.7,
      filterDecay: 0.2,
      filterSustain: 0,
      decay: 0.25,
      sustain: 0.6,
      release: 0.06,
      glide: 0.06,
      transpose: -12,
      level: 1,
    }),
    entry(folders.bass, 'Reese bass', {
      osc1Wave: Saw,
      osc2Wave: Saw,
      detune: 30,
      sub: 0.5,
      cutoff: 700,
      resonance: 0.2,
      drive: 0.35,
      envAmount: 0.1,
      sustain: 1,
      release: 0.15,
      transpose: -12,
      level: 0.8,
    }),
    entry(folders.bass, 'Wobble bass', {
      osc1Wave: Saw,
      osc2Wave: Square,
      mix: 0.5,
      sub: 0.5,
      detune: 8,
      cutoff: 300,
      resonance: 0.6,
      drive: 0.5,
      envAmount: 0,
      sustain: 1,
      release: 0.1,
      lfoTarget: AnalogLfoTarget.Filter,
      lfoRate: 2,
      lfoDepth: 0.7,
      transpose: -12,
      level: 0.85,
    }),

    // FX.
    entry(
      folders.fx,
      'Siren',
      {
        osc1Wave: Square,
        osc2Wave: Saw,
        mix: 0.3,
        filterType: AnalogFilter.LowPass12,
        cutoff: 2500,
        resonance: 0.3,
        envAmount: 0,
        sustain: 1,
        release: 0.3,
        lfoTarget: AnalogLfoTarget.Pitch,
        lfoRate: 0.8,
        lfoDepth: 1,
        level: 0.55,
      },
      [reverb(0.7, 0.25)],
    ),
  ];
}
