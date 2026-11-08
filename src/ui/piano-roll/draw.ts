import { ticksPerBar, ticksPerBeat } from '../../model/time';
import type { Clip, MeterEvent, Tick } from '../../model/types';
import { colorResolver, roundRect } from '../canvas';
import { noteName } from '../input/computer-keyboard';
import {
  isBlackKey,
  KEYS_WIDTH,
  pitchToY,
  ROW_HEIGHT,
  RULER_HEIGHT,
  tickToX,
  VELOCITY_HEIGHT,
  type RollView,
} from './geometry';

export interface RollScene {
  clip: Clip;
  color: string;
  meter: MeterEvent;
  view: RollView;
  grid: Tick;
  width: number;
  height: number;
  selected: ReadonlySet<string>;
  playhead: Tick;
  /** Selection rectangle while Shift-dragging, in canvas pixels. */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
}

export function drawPianoRoll(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  scene: RollScene,
) {
  const color = colorResolver(canvas);
  const { clip, view, width, height, meter } = scene;
  const gridBottom = height - VELOCITY_HEIGHT;
  const clipStart = clip.startTick;
  const clipEnd = clip.startTick + clip.lengthTicks;
  const trackColor = color(scene.color);
  const mono = getComputedStyle(canvas).getPropertyValue('--font-mono');

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color('var(--screen)');
  ctx.fillRect(0, 0, width, height);

  // Rows: black-key rows darker, a line at every C.
  ctx.save();
  ctx.beginPath();
  ctx.rect(KEYS_WIDTH, RULER_HEIGHT, width - KEYS_WIDTH, gridBottom - RULER_HEIGHT);
  ctx.clip();
  for (let pitch = view.topPitch; pitchToY(view, pitch) < gridBottom && pitch >= 0; pitch--) {
    const y = pitchToY(view, pitch);
    ctx.fillStyle = color(isBlackKey(pitch) ? 'var(--screen)' : 'var(--screen-raised)');
    ctx.fillRect(KEYS_WIDTH, y, width, ROW_HEIGHT);
    if (pitch % 12 === 0) {
      ctx.fillStyle = color('var(--screen-line-strong)');
      ctx.fillRect(KEYS_WIDTH, y + ROW_HEIGHT - 1, width, 1);
    }
  }

  // Outside the clip: dimmed.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  const left = tickToX(view, clipStart);
  const right = tickToX(view, clipEnd);
  if (left > KEYS_WIDTH) ctx.fillRect(KEYS_WIDTH, RULER_HEIGHT, left - KEYS_WIDTH, gridBottom);
  if (right < width) ctx.fillRect(right, RULER_HEIGHT, width - right, gridBottom);

  // Vertical grid: bars, beats and the snap grid.
  const bar = ticksPerBar(meter);
  const beat = ticksPerBeat(meter);
  const step = scene.grid * view.pixelsPerTick >= 6 ? scene.grid : beat;
  for (
    let tick = Math.floor(view.scrollTick / step) * step;
    tickToX(view, tick) < width;
    tick += step
  ) {
    const x = Math.round(tickToX(view, tick)) + 0.5;
    const t = Math.round(tick);
    ctx.fillStyle = color(
      t % bar === 0
        ? 'var(--screen-ink-dim)'
        : t % beat === 0
          ? 'var(--screen-line-strong)'
          : 'var(--screen-line)',
    );
    ctx.globalAlpha = t % bar === 0 ? 0.5 : 1;
    ctx.fillRect(x - 0.5, RULER_HEIGHT, 1, height);
    ctx.globalAlpha = 1;
  }

  // Notes: brightness follows velocity; notes hidden outside the clip are faint.
  for (const note of clip.notes) {
    const start = clipStart + note.tick;
    const x = tickToX(view, start);
    const w = Math.max(3, note.durationTicks * view.pixelsPerTick);
    const y = pitchToY(view, note.pitch);
    if (x > width || x + w < KEYS_WIDTH || y > gridBottom || y + ROW_HEIGHT < RULER_HEIGHT)
      continue;
    const hidden = start < clipStart || start >= clipEnd;
    const selected = scene.selected.has(note.id);
    ctx.globalAlpha = hidden ? 0.25 : 0.45 + (note.velocity / 127) * 0.55;
    ctx.fillStyle = trackColor;
    roundRect(ctx, x + 0.5, y + 1, w - 1, ROW_HEIGHT - 2, 3);
    ctx.fill();
    ctx.globalAlpha = hidden ? 0.25 : 1;
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected ? '#ffffff' : 'rgba(0, 0, 0, 0.5)';
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Playhead (grid and velocity lane).
  const px = Math.round(tickToX(view, scene.playhead)) + 0.5;
  if (px >= KEYS_WIDTH && px <= width) {
    ctx.fillStyle = color('var(--accent)');
    ctx.fillRect(px - 0.5, 0, 1.5, height);
  }
  ctx.restore();

  // Velocity lane.
  ctx.fillStyle = color('var(--screen)');
  ctx.fillRect(0, gridBottom, width, VELOCITY_HEIGHT);
  ctx.fillStyle = color('var(--screen-line-strong)');
  ctx.fillRect(0, gridBottom, width, 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(KEYS_WIDTH, gridBottom, width - KEYS_WIDTH, VELOCITY_HEIGHT);
  ctx.clip();
  const laneTop = gridBottom + 6;
  const laneBottom = height - 4;
  for (const note of clip.notes) {
    const x = Math.round(tickToX(view, clipStart + note.tick)) + 0.5;
    if (x < KEYS_WIDTH || x > width) continue;
    const y = laneBottom - (note.velocity / 127) * (laneBottom - laneTop);
    const selected = scene.selected.has(note.id);
    ctx.fillStyle = selected ? '#ffffff' : trackColor;
    ctx.fillRect(x - 0.5, y, 2, laneBottom - y);
    ctx.beginPath();
    ctx.arc(x + 0.5, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = color('var(--screen-ink-dim)');
  ctx.font = `9px ${mono}`;
  ctx.textBaseline = 'top';
  ctx.fillText('VEL', 8, gridBottom + 6);

  // Ruler with bar numbers.
  ctx.fillStyle = color('var(--screen)');
  ctx.fillRect(0, 0, width, RULER_HEIGHT);
  ctx.font = `10px ${mono}`;
  ctx.textBaseline = 'middle';
  for (
    let tick = Math.floor(view.scrollTick / bar) * bar;
    tickToX(view, tick) < width;
    tick += bar
  ) {
    const x = Math.round(tickToX(view, tick)) + 0.5;
    if (x < KEYS_WIDTH) continue;
    ctx.fillStyle = color('var(--screen-line-strong)');
    ctx.fillRect(x - 0.5, 0, 1, RULER_HEIGHT);
    ctx.fillStyle = color('var(--screen-ink-dim)');
    ctx.fillText(String(Math.round(tick / bar) + 1), x + 4, RULER_HEIGHT / 2);
  }
  ctx.fillStyle = color('var(--screen-line-strong)');
  ctx.fillRect(0, RULER_HEIGHT - 1, width, 1);
  if (px >= KEYS_WIDTH && px <= width) {
    ctx.fillStyle = color('var(--accent)');
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 7);
    ctx.fill();
  }

  // Keyboard column.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, RULER_HEIGHT, KEYS_WIDTH, gridBottom - RULER_HEIGHT);
  ctx.clip();
  ctx.font = `9px ${mono}`;
  for (let pitch = view.topPitch; pitchToY(view, pitch) < gridBottom && pitch >= 0; pitch--) {
    const y = pitchToY(view, pitch);
    const black = isBlackKey(pitch);
    ctx.fillStyle = black ? '#1a1a1d' : '#e9e8e4';
    ctx.fillRect(0, y, black ? KEYS_WIDTH * 0.62 : KEYS_WIDTH, ROW_HEIGHT);
    if (black) {
      ctx.fillStyle = '#e9e8e4';
      ctx.fillRect(KEYS_WIDTH * 0.62, y, KEYS_WIDTH * 0.38, ROW_HEIGHT);
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(0, y + ROW_HEIGHT - 1, KEYS_WIDTH, 1);
    if (pitch % 12 === 0) {
      ctx.fillStyle = '#55545a';
      ctx.fillText(noteName(pitch), KEYS_WIDTH - 22, y + ROW_HEIGHT / 2 + 0.5);
    }
  }
  ctx.restore();
  ctx.fillStyle = color('var(--screen-line-strong)');
  ctx.fillRect(KEYS_WIDTH - 1, 0, 1, height);

  // Selection rectangle.
  if (scene.marquee) {
    const { x0, y0, x1, y1 } = scene.marquee;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeRect(
      Math.min(x0, x1) + 0.5,
      Math.min(y0, y1) + 0.5,
      Math.abs(x1 - x0),
      Math.abs(y1 - y0),
    );
    ctx.setLineDash([]);
  }
}
