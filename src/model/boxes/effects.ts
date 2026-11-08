import { PPQ } from '../constants';
import type { BoxDescriptor } from './types';

/**
 * Note values for tempo-synced params (delay time, arp rate), in ticks. Index = param value.
 * "d" = dotted, "T" = triplet.
 */
export const SYNC_DIVISIONS = [
  { label: '1/32', ticks: PPQ / 8 },
  { label: '1/16T', ticks: PPQ / 6 },
  { label: '1/16', ticks: PPQ / 4 },
  { label: '1/16d', ticks: (PPQ / 4) * 1.5 },
  { label: '1/8T', ticks: PPQ / 3 },
  { label: '1/8', ticks: PPQ / 2 },
  { label: '1/8d', ticks: (PPQ / 2) * 1.5 },
  { label: '1/4', ticks: PPQ },
  { label: '1/4d', ticks: PPQ * 1.5 },
  { label: '1/2', ticks: PPQ * 2 },
] as const;

const divisionIndex = (label: string) => SYNC_DIVISIONS.findIndex((d) => d.label === label);

export const BITCRUSH: BoxDescriptor = {
  type: 'fx.bitcrush',
  kind: 'effect',
  name: 'Bitcrush',
  params: [
    { id: 'bits', name: 'Bits', min: 1, max: 16, default: 6, scale: 'linear', step: 1 },
    {
      id: 'rate',
      name: 'Rate',
      min: 500,
      max: 48000,
      default: 11025,
      scale: 'exp',
      unit: 'Hz',
    },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 1, scale: 'linear', unit: '%' },
  ],
};

export const FilterType = { LowPass: 0, HighPass: 1, BandPass: 2 } as const;

export const FILTER: BoxDescriptor = {
  type: 'fx.filter',
  kind: 'effect',
  name: 'Filter',
  params: [
    {
      id: 'type',
      name: 'Type',
      min: 0,
      max: 2,
      default: FilterType.LowPass,
      scale: 'linear',
      step: 1,
      steps: ['Low', 'High', 'Band'],
    },
    {
      id: 'cutoff',
      name: 'Cutoff',
      min: 30,
      max: 18000,
      default: 2000,
      scale: 'exp',
      unit: 'Hz',
    },
    { id: 'resonance', name: 'Reso', min: 0, max: 1, default: 0.2, scale: 'linear', unit: '%' },
  ],
};

export const DELAY: BoxDescriptor = {
  type: 'fx.delay',
  kind: 'effect',
  name: 'Delay',
  params: [
    {
      id: 'time',
      name: 'Time',
      min: 0,
      max: SYNC_DIVISIONS.length - 1,
      default: divisionIndex('1/8d'),
      scale: 'linear',
      step: 1,
      steps: SYNC_DIVISIONS.map((d) => d.label),
    },
    {
      id: 'mode',
      name: 'Mode',
      min: 0,
      max: 1,
      default: 1,
      scale: 'linear',
      step: 1,
      steps: ['Mono', 'Ping-pong'],
    },
    {
      id: 'feedback',
      name: 'Feedback',
      min: 0,
      max: 0.95,
      default: 0.4,
      scale: 'linear',
      unit: '%',
    },
    { id: 'tone', name: 'Tone', min: 500, max: 18000, default: 6000, scale: 'exp', unit: 'Hz' },
    { id: 'wet', name: 'Wet', min: 0, max: 1, default: 0.35, scale: 'linear', unit: '%' },
  ],
};

export const REVERB: BoxDescriptor = {
  type: 'fx.reverb',
  kind: 'effect',
  name: 'Reverb',
  params: [
    { id: 'size', name: 'Size', min: 0, max: 1, default: 0.6, scale: 'linear', unit: '%' },
    { id: 'damping', name: 'Damping', min: 0, max: 1, default: 0.5, scale: 'linear', unit: '%' },
    { id: 'width', name: 'Width', min: 0, max: 1, default: 1, scale: 'linear', unit: '%' },
    { id: 'wet', name: 'Wet', min: 0, max: 1, default: 0.25, scale: 'linear', unit: '%' },
  ],
};

export const ArpMode = { Up: 0, Down: 1, UpDown: 2, Random: 3, Played: 4 } as const;

/** Arp rates: a subset of the sync divisions (index into SYNC_DIVISIONS by label). */
export const ARP_RATES = ['1/32', '1/16T', '1/16', '1/8T', '1/8', '1/4'] as const;

export const ARPEGGIATOR: BoxDescriptor = {
  type: 'seq.arp',
  kind: 'sequencer',
  name: 'Arpeggiator',
  params: [
    {
      id: 'mode',
      name: 'Mode',
      min: 0,
      max: 4,
      default: ArpMode.Up,
      scale: 'linear',
      step: 1,
      steps: ['Up', 'Down', 'Up-Down', 'Random', 'Played'],
    },
    {
      id: 'rate',
      name: 'Rate',
      min: 0,
      max: ARP_RATES.length - 1,
      default: ARP_RATES.indexOf('1/16'),
      scale: 'linear',
      step: 1,
      steps: [...ARP_RATES],
    },
    { id: 'octaves', name: 'Octaves', min: 1, max: 4, default: 1, scale: 'linear', step: 1 },
    { id: 'gate', name: 'Gate', min: 0.05, max: 1, default: 0.5, scale: 'linear', unit: '%' },
  ],
};

/** Ticks of an arp rate param value. */
export function arpRateTicks(value: number): number {
  const label = ARP_RATES[Math.round(value)] ?? '1/16';
  return SYNC_DIVISIONS[divisionIndex(label)]!.ticks;
}
