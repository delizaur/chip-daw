/**
 * What the effect and sequencer screens draw (filter response, delay echoes, crushed wave,
 * reverb tail, arp pattern), worked out from the box's params. Pure, so it's testable.
 */
import { ARP_RATES, SYNC_DIVISIONS } from '../../model/boxes/effects';
import { getBoxDescriptor, paramValue } from '../../model/boxes/registry';
import type { BoxInstance } from '../../model/types';
import type { Point } from './synth-visuals';

/** One stroke on a screen. */
export interface ScreenLine {
  points: Point[];
  /** Drawn in this param's knob color; otherwise in `tone`. */
  param?: string;
  tone?: 'ink' | 'dim' | 'faint';
  dashed?: boolean;
  /** A thicker stroke (impulses such as delay echoes). */
  bold?: boolean;
}

export interface Screen {
  caption: string;
  lines: ScreenLine[];
  /** Points to mark with a dot (e.g. the filter's cutoff). */
  dots?: { point: Point; param?: string }[];
}

function reader(box: BoxInstance) {
  const descriptor = getBoxDescriptor(box.type);
  return (id: string, fallback = 0) => {
    const param = descriptor?.params.find((p) => p.id === id);
    return param ? paramValue(box, param) : fallback;
  };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** A deterministic pseudo-random sequence in 0..1 (the same picture every redraw). */
function random(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** A vertical line (an impulse) at `x` from `y0` to `y1`. */
const spike = (x: number, y0: number, y1: number): Point[] => [
  { x, y: y0 },
  { x, y: y1 },
];

const LOW_HZ = 20;
const HIGH_HZ = 20000;
const DB_TOP = 18;
const DB_BOTTOM = -36;
const hzToX = (hz: number) => Math.log(hz / LOW_HZ) / Math.log(HIGH_HZ / LOW_HZ);
const dbToY = (db: number) => clamp01((db - DB_BOTTOM) / (DB_TOP - DB_BOTTOM));

/** Magnitude of the state-variable filter (as in the engine: k = 2 − 1.96·reso) at `hz`. */
export function filterGain(type: number, cutoff: number, resonance: number, hz: number): number {
  const k = 2 - 1.96 * resonance;
  const w = hz / cutoff;
  const denominator = Math.hypot(1 - w * w, k * w);
  const numerator = type === 1 ? w * w : type === 2 ? k * w : 1;
  return numerator / denominator;
}

function filterScreen(box: BoxInstance): Screen {
  const read = reader(box);
  const type = Math.round(read('type'));
  const cutoff = read('cutoff', 2000);
  const resonance = read('resonance');
  const count = 120;
  const curve = Array.from({ length: count + 1 }, (_, i) => {
    const hz = LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, i / count);
    const db = 20 * Math.log10(Math.max(1e-6, filterGain(type, cutoff, resonance, hz)));
    return { x: i / count, y: dbToY(db) };
  });
  const atCutoff = 20 * Math.log10(filterGain(type, cutoff, resonance, cutoff));
  return {
    caption: 'Response',
    lines: [
      {
        points: [
          { x: 0, y: dbToY(0) },
          { x: 1, y: dbToY(0) },
        ],
        tone: 'faint',
        dashed: true,
      },
      { points: curve, param: 'cutoff' },
    ],
    dots: [{ point: { x: hzToX(cutoff), y: dbToY(atCutoff) }, param: 'resonance' }],
  };
}

function delayScreen(box: BoxInstance): Screen {
  const read = reader(box);
  const division = SYNC_DIVISIONS[Math.round(read('time'))] ?? SYNC_DIVISIONS[0];
  const pingPong = Math.round(read('mode')) === 1;
  const feedback = read('feedback');
  const wet = read('wet');
  // A half note spans most of the screen; the shortest times pack the echoes tight.
  const spacing = (division.ticks / SYNC_DIVISIONS.at(-1)!.ticks) * 0.42;
  const base = pingPong ? 0.5 : 0;
  const room = pingPong ? 0.48 : 0.95;
  const lines: ScreenLine[] = [{ points: spike(0.01, base, base + room), tone: 'ink', bold: true }];
  let level = 0.5 + 0.5 * wet;
  for (let n = 1; n * spacing < 1 && level > 0.02; n++) {
    const down = pingPong && n % 2 === 1;
    const height = room * level;
    lines.push({
      points: spike(0.01 + n * spacing, base, down ? base - height : base + height),
      param: 'feedback',
      bold: true,
    });
    level *= feedback;
  }
  lines.unshift({
    points: [
      { x: 0, y: base },
      { x: 1, y: base },
    ],
    tone: 'faint',
  });
  return { caption: pingPong ? 'Echoes · L ↑ R ↓' : 'Echoes', lines };
}

function bitcrushScreen(box: BoxInstance): Screen {
  const read = reader(box);
  const step = 2 / Math.pow(2, Math.round(read('bits', 6)));
  // Holds per cycle of a low note: the lower the rate, the coarser the staircase.
  const holds = Math.max(1, Math.min(160, read('rate', 11025) / 700));
  const mix = read('mix', 1);
  const count = 240;
  const sine = (x: number) => Math.sin(2 * Math.PI * x);
  const y = (v: number) => 0.5 + Math.max(-1, Math.min(1, v)) * 0.45;
  const crushed = Array.from({ length: count + 1 }, (_, i) => {
    const x = i / count;
    const held = Math.floor(x * holds) / holds;
    const value = Math.round(sine(held) / step) * step;
    return { x, y: y(value * mix + sine(x) * (1 - mix)) };
  });
  const clean = Array.from({ length: 81 }, (_, i) => ({ x: i / 80, y: y(sine(i / 80)) }));
  return {
    caption: 'Crushed wave',
    lines: [
      { points: clean, tone: 'faint' },
      { points: crushed, param: 'bits' },
    ],
  };
}

function reverbScreen(box: BoxInstance): Screen {
  const read = reader(box);
  const size = read('size', 0.6);
  const damping = read('damping', 0.5);
  const width = read('width', 1);
  const wet = read('wet', 0.25);
  const left = random(7);
  const right = random(11);
  // Bigger rooms ring longer; damping takes the bright spikes out of the tail.
  const decay = 5 - 4.2 * size;
  const lines: ScreenLine[] = [
    {
      points: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
      tone: 'faint',
    },
    { points: spike(0.01, 0.5, 0.98), tone: 'ink' },
    { points: spike(0.01, 0.5, 0.02), tone: 'ink' },
  ];
  const envelope: Point[] = [];
  const count = 70;
  for (let i = 1; i <= count; i++) {
    const x = 0.03 + (i / count) * 0.96;
    const level = (0.6 + 0.4 * wet) * Math.exp(-decay * x);
    const roughness = 1 - damping * 0.7 * x;
    const l = left();
    const r = l + (right() - l) * width;
    lines.push({
      points: spike(x, 0.5, 0.5 + 0.47 * level * (1 - roughness + roughness * l)),
      param: 'size',
    });
    lines.push({
      points: spike(x, 0.5, 0.5 - 0.47 * level * (1 - roughness + roughness * r)),
      param: 'width',
    });
    envelope.push({ x, y: 0.5 + 0.47 * level });
  }
  lines.push({ points: envelope, tone: 'dim', dashed: true });
  return { caption: 'Tail · L ↑ R ↓', lines };
}

/** The arp pattern for a C major chord, as the notes it plays, low to high 0..1. */
export function arpPattern(mode: number, octaves: number, steps: number): number[] {
  const chord = [0, 4, 7];
  const up: number[] = [];
  for (let o = 0; o < octaves; o++) for (const n of chord) up.push(n + 12 * o);
  const top = Math.max(1, 12 * octaves - 5);
  let order: number[];
  if (mode === 1) order = [...up].reverse();
  else if (mode === 2) order = up.length > 1 ? [...up, ...up.slice(1, -1).reverse()] : up;
  else if (mode === 3) {
    const next = random(3);
    order = Array.from({ length: steps }, () => up[Math.floor(next() * up.length)]!);
  } else if (mode === 4) {
    // As played: E, C, G (the order the keys went down), repeated over the octaves.
    order = [];
    for (let o = 0; o < octaves; o++) for (const n of [4, 0, 7]) order.push(n + 12 * o);
  } else order = up;
  return Array.from({ length: steps }, (_, i) => order[i % order.length]! / top);
}

function arpScreen(box: BoxInstance): Screen {
  const read = reader(box);
  const mode = Math.round(read('mode'));
  const octaves = Math.round(read('octaves', 1));
  const gate = read('gate', 0.5);
  const rate = ARP_RATES[Math.round(read('rate', 2))] ?? '1/16';
  // Two beats' worth of steps (capped so they stay readable).
  const ticks = SYNC_DIVISIONS.find((d) => d.label === rate)!.ticks;
  const steps = Math.max(2, Math.min(24, Math.round((SYNC_DIVISIONS[7].ticks * 2) / ticks)));
  const pattern = arpPattern(mode, octaves, steps);
  const lines: ScreenLine[] = [];
  for (let i = 0; i <= steps; i++) {
    lines.push({ points: spike(i / steps, 0, i % 4 === 0 ? 0.08 : 0.04), tone: 'dim' });
  }
  pattern.forEach((pitch, i) => {
    const y = 0.08 + pitch * 0.84;
    lines.push({
      points: [
        { x: i / steps + 0.01, y },
        { x: (i + gate) / steps - 0.01, y },
      ],
      param: 'gate',
    });
  });
  return { caption: `Pattern · ${rate}`, lines };
}

/** The screen for an effect or sequencer box, or null if it has none. */
export function effectScreen(box: BoxInstance): Screen | null {
  switch (box.type) {
    case 'fx.filter':
      return filterScreen(box);
    case 'fx.delay':
      return delayScreen(box);
    case 'fx.bitcrush':
      return bitcrushScreen(box);
    case 'fx.reverb':
      return reverbScreen(box);
    case 'seq.arp':
      return arpScreen(box);
    default:
      return null;
  }
}
