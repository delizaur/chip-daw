import { ticksPerBar, ticksPerBeat } from '../../model/time';
import type { Clip, MeterEvent, Tick, Track } from '../../model/types';
import { trackColor } from '../theme';
import { LANE_HEIGHT, laneTop, RULER_HEIGHT, tickToX, type TimelineView } from './geometry';

/** A clip drawn somewhere other than where the project has it (while dragging). */
export interface ClipGhost {
  trackIndex: number;
  startTick: Tick;
  lengthTicks: Tick;
  /** Song tick of the clip's note tick 0: moves with a moved clip, stays put when resizing. */
  notesStart: Tick;
  clip: Clip;
}

export interface TimelineScene {
  tracks: readonly Track[];
  meter: MeterEvent;
  view: TimelineView;
  width: number;
  height: number;
  selectedTrack: number;
  selectedClips: ReadonlySet<string>;
  playhead: Tick;
  /** The recording pass in progress (drawn live); null when not recording. */
  take: TakePreview | null;
  /** Clips being dragged: drawn at their new place, originals dimmed. */
  ghosts: ClipGhost[] | null;
}

/** A recording pass in progress, with notes mapped to track indices. */
export interface TakePreview {
  startTick: Tick;
  /** Tracks to draw a recording region on (the selected track, plus any receiving notes). */
  trackIndices: number[];
  notes: { trackIndex: number; pitch: number; startTick: Tick; endTick: Tick; held: boolean }[];
}

/** Resolves "var(--name)" colors for the canvas, which can't read CSS variables itself. */
function colorResolver(element: Element) {
  const style = getComputedStyle(element);
  const cache = new Map<string, string>();
  return (value: string) => {
    let resolved = cache.get(value);
    if (resolved === undefined) {
      const match = /^var\((--[\w-]+)\)$/.exec(value);
      resolved = match ? style.getPropertyValue(match[1]!).trim() : value;
      cache.set(value, resolved);
    }
    return resolved;
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

function drawClip(
  ctx: CanvasRenderingContext2D,
  scene: TimelineScene,
  color: string,
  trackIndex: number,
  clip: Clip,
  startTick: Tick,
  lengthTicks: Tick,
  notesStart: Tick,
  style: 'normal' | 'selected' | 'dimmed' | 'ghost',
) {
  const x = tickToX(scene.view, startTick);
  const w = Math.max(2, lengthTicks * scene.view.pixelsPerTick);
  if (x > scene.width || x + w < 0) return;
  const y = laneTop(trackIndex) + 3;
  const h = LANE_HEIGHT - 6;

  ctx.save();
  ctx.globalAlpha = style === 'dimmed' ? 0.25 : 1;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 5);
  ctx.fillStyle = color;
  ctx.globalAlpha *= style === 'selected' || style === 'ghost' ? 0.55 : 0.32;
  ctx.fill();
  ctx.globalAlpha = style === 'dimmed' ? 0.25 : 1;
  ctx.lineWidth = style === 'selected' ? 2 : 1;
  ctx.strokeStyle = style === 'selected' ? '#ffffff' : color;
  if (style === 'ghost') ctx.setLineDash([4, 3]);
  ctx.stroke();

  // Note preview, scaled to the clip's pitch range.
  const end = startTick + lengthTicks;
  const visible = clip.notes.filter((n) => {
    const at = notesStart + n.tick;
    return at >= startTick && at < end;
  });
  if (visible.length > 0) {
    let low = 127;
    let high = 0;
    for (const n of visible) {
      low = Math.min(low, n.pitch);
      high = Math.max(high, n.pitch);
    }
    const span = Math.max(high - low, 8);
    const inner = h - 10;
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha *= 0.85;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (const n of visible) {
      const nx = tickToX(scene.view, notesStart + n.tick);
      const nw = Math.max(1.5, n.durationTicks * scene.view.pixelsPerTick - 1);
      const ny = y + 5 + inner - ((n.pitch - low + (span - (high - low)) / 2) / span) * inner;
      ctx.fillRect(nx, ny - 1, nw, 2.5);
    }
  }
  ctx.restore();
}

/** The recording pass: a red region per track up to the playhead, with its notes so far. */
function drawTake(
  ctx: CanvasRenderingContext2D,
  scene: TimelineScene,
  take: TakePreview,
  color: (value: string) => string,
) {
  const { view, playhead } = scene;
  const start = Math.min(take.startTick, ...take.notes.map((n) => n.startTick));
  const x = tickToX(view, start);
  const w = tickToX(view, playhead) - x;
  if (w <= 0) return;
  for (const trackIndex of take.trackIndices) {
    const y = laneTop(trackIndex) + 3;
    const h = LANE_HEIGHT - 6;
    ctx.fillStyle = color('var(--c-red)');
    ctx.globalAlpha = 0.3;
    roundRect(ctx, x, y, w, h, 5);
    ctx.fill();
    ctx.globalAlpha = 1;

    const notes = take.notes.filter((n) => n.trackIndex === trackIndex);
    if (notes.length === 0) continue;
    const low = Math.min(...notes.map((n) => n.pitch));
    const high = Math.max(...notes.map((n) => n.pitch));
    const span = Math.max(high - low, 8);
    const inner = h - 10;
    ctx.fillStyle = '#ffffff';
    for (const n of notes) {
      const nx = tickToX(view, n.startTick);
      const end = n.held ? playhead : n.endTick;
      const nw = Math.max(1.5, (end - n.startTick) * view.pixelsPerTick - 1);
      const ny = y + 5 + inner - ((n.pitch - low + (span - (high - low)) / 2) / span) * inner;
      ctx.fillRect(nx, ny - 1, nw, 2.5);
    }
  }
}

export function drawTimeline(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  scene: TimelineScene,
) {
  const color = colorResolver(canvas);
  const { view, width, height, meter } = scene;
  ctx.clearRect(0, 0, width, height);

  // Lanes.
  ctx.fillStyle = color('var(--screen)');
  ctx.fillRect(0, 0, width, height);
  scene.tracks.forEach((_, i) => {
    if (i === scene.selectedTrack) {
      ctx.fillStyle = color(trackColor(i));
      ctx.globalAlpha = 0.07;
      ctx.fillRect(0, laneTop(i), width, LANE_HEIGHT);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = color('var(--screen-line)');
    ctx.fillRect(0, laneTop(i + 1) - 1, width, 1);
  });

  // Grid: bars always, beats when there's room.
  const bar = ticksPerBar(meter);
  const beat = ticksPerBeat(meter);
  const showBeats = beat * view.pixelsPerTick >= 10;
  const step = showBeats ? beat : bar;
  const first = Math.floor(view.scrollTick / step) * step;
  ctx.font = `10px ${getComputedStyle(canvas).getPropertyValue('--font-mono')}`;
  ctx.textBaseline = 'middle';
  for (let tick = first; tickToX(view, tick) < width; tick += step) {
    const x = Math.round(tickToX(view, tick)) + 0.5;
    const isBar = Math.round(tick) % bar === 0;
    ctx.fillStyle = color(isBar ? 'var(--screen-line-strong)' : 'var(--screen-line)');
    ctx.fillRect(x - 0.5, isBar ? 0 : RULER_HEIGHT, 1, height);
    if (isBar) {
      ctx.fillStyle = color('var(--screen-ink-dim)');
      ctx.fillText(String(Math.round(tick / bar) + 1), x + 4, RULER_HEIGHT / 2);
    }
  }
  ctx.fillStyle = color('var(--screen-line-strong)');
  ctx.fillRect(0, RULER_HEIGHT - 1, width, 1);

  // Clips.
  const moving = new Set(scene.ghosts?.map((g) => g.clip.id));
  scene.tracks.forEach((track, i) => {
    const c = color(trackColor(i));
    for (const clip of track.clips) {
      const style = moving.has(clip.id)
        ? 'dimmed'
        : scene.selectedClips.has(clip.id)
          ? 'selected'
          : 'normal';
      drawClip(ctx, scene, c, i, clip, clip.startTick, clip.lengthTicks, clip.startTick, style);
    }
  });
  for (const ghost of scene.ghosts ?? []) {
    const c = color(trackColor(ghost.trackIndex));
    const { trackIndex, clip, startTick, lengthTicks, notesStart } = ghost;
    drawClip(ctx, scene, c, trackIndex, clip, startTick, lengthTicks, notesStart, 'ghost');
  }

  if (scene.take) drawTake(ctx, scene, scene.take, color);

  // Playhead.
  const px = Math.round(tickToX(view, scene.playhead)) + 0.5;
  if (px >= 0 && px <= width) {
    ctx.fillStyle = color('var(--accent)');
    ctx.fillRect(px - 0.5, 0, 1.5, height);
    ctx.beginPath();
    ctx.moveTo(px - 6, 0);
    ctx.lineTo(px + 6, 0);
    ctx.lineTo(px, 8);
    ctx.fill();
  }
}
