import { isSteppedParam } from '../../model/automation';
import type { ParamDescriptor } from '../../model/boxes/types';
import { ticksPerBar, ticksPerBeat } from '../../model/time';
import type { AutomationPoint, Clip, MeterEvent, Tick } from '../../model/types';
import { colorResolver, roundRect, type ColorResolver } from '../canvas';
import { formatParam } from '../controls/format';
import { noteName } from '../input/computer-keyboard';
import {
  AUTOMATION_HEIGHT,
  automationBounds,
  automationY,
  isBlackKey,
  KEYS_WIDTH,
  pitchToY,
  ROW_HEIGHT,
  RULER_HEIGHT,
  tickToX,
  VELOCITY_HEIGHT,
  type RollView,
} from './geometry';

/** What the bottom lane shows: velocities, or one parameter's automation in this clip. */
export type LaneScene =
  | { kind: 'velocity' }
  | {
      kind: 'automation';
      /** E.g. "Filter › Cutoff". */
      name: string;
      param: ParamDescriptor;
      points: readonly AutomationPoint[];
      /** The preset's own value (what plays before the first point). */
      base: number;
      /** The lane's box isn't in the clip's preset any more: kept, but it doesn't play. */
      inactive: boolean;
    };

export const laneHeightOf = (lane: LaneScene) =>
  lane.kind === 'velocity' ? VELOCITY_HEIGHT : AUTOMATION_HEIGHT;

export interface RollScene {
  lane: LaneScene;
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
  const laneHeight = laneHeightOf(scene.lane);
  const gridBottom = height - laneHeight;
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

  // Playhead (the grid here; the bottom lane after it's drawn).
  const px = Math.round(tickToX(view, scene.playhead)) + 0.5;
  if (px >= KEYS_WIDTH && px <= width) {
    ctx.fillStyle = color('var(--accent)');
    ctx.fillRect(px - 0.5, 0, 1.5, height);
  }
  ctx.restore();

  // Bottom lane: velocities or automation.
  ctx.fillStyle = color('var(--screen)');
  ctx.fillRect(0, gridBottom, width, laneHeight);
  ctx.fillStyle = color('var(--screen-line-strong)');
  ctx.fillRect(0, gridBottom, width, 1);
  if (scene.lane.kind === 'automation') {
    drawAutomationLane(ctx, scene, scene.lane, color, trackColor, mono);
  } else {
    drawVelocityLane(ctx, scene, gridBottom, trackColor, mono, color);
  }

  if (px >= KEYS_WIDTH && px <= width) {
    ctx.fillStyle = color('var(--accent)');
    ctx.fillRect(px - 0.5, gridBottom, 1.5, laneHeight);
  }

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

function drawVelocityLane(
  ctx: CanvasRenderingContext2D,
  scene: RollScene,
  gridBottom: number,
  trackColor: string,
  mono: string,
  color: ColorResolver,
) {
  const { clip, view, width, height } = scene;
  ctx.save();
  ctx.beginPath();
  ctx.rect(KEYS_WIDTH, gridBottom, width - KEYS_WIDTH, VELOCITY_HEIGHT);
  ctx.clip();
  const laneTop = gridBottom + 6;
  const laneBottom = height - 4;
  for (const note of clip.notes) {
    const x = Math.round(tickToX(view, clip.startTick + note.tick)) + 0.5;
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
}

/**
 * One param's automation: a line through the points (ramps, or steps for enum params and
 * `step` points), holding after the last one; before the first, a dashed line at the preset's
 * own value. The key column shows the param's range.
 */
function drawAutomationLane(
  ctx: CanvasRenderingContext2D,
  scene: RollScene,
  lane: Extract<LaneScene, { kind: 'automation' }>,
  color: ColorResolver,
  trackColor: string,
  mono: string,
) {
  const { clip, view, width, height } = scene;
  const { param, points } = lane;
  const laneTop = height - AUTOMATION_HEIGHT;
  const { top, bottom } = automationBounds(height);
  const clipLeft = tickToX(view, clip.startTick);
  const clipRight = tickToX(view, clip.startTick + clip.lengthTicks);
  const y = (value: number) => automationY(value, param, height);
  const x = (tick: Tick) => tickToX(view, clip.startTick + tick);

  ctx.save();
  ctx.beginPath();
  ctx.rect(KEYS_WIDTH, laneTop, width - KEYS_WIDTH, AUTOMATION_HEIGHT);
  ctx.clip();
  // Bar and beat lines, like the note grid, to place points by eye.
  const bar = ticksPerBar(scene.meter);
  const beat = ticksPerBeat(scene.meter);
  for (
    let tick = Math.floor(view.scrollTick / beat) * beat;
    tickToX(view, tick) < width;
    tick += beat
  ) {
    ctx.fillStyle = color(
      Math.round(tick) % bar === 0 ? 'var(--screen-line-strong)' : 'var(--screen-line)',
    );
    ctx.fillRect(Math.round(tickToX(view, tick)), laneTop, 1, AUTOMATION_HEIGHT);
  }
  // Range guides at the top and bottom of the value range.
  ctx.fillStyle = color('var(--screen-line)');
  ctx.fillRect(KEYS_WIDTH, Math.round(top) + 0.5, width, 1);
  ctx.fillRect(KEYS_WIDTH, Math.round(bottom) + 0.5, width, 1);
  if (lane.inactive) ctx.globalAlpha = 0.35;

  // Before the first point: the preset's own value.
  const firstX = points.length > 0 ? x(points[0]!.tick) : clipRight;
  if (firstX > clipLeft) {
    ctx.strokeStyle = trackColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(clipLeft, y(lane.base) + 0.5);
    ctx.lineTo(Math.min(firstX, clipRight), y(lane.base) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (points.length > 0) {
    const stepped = isSteppedParam(param);
    const path = new Path2D();
    path.moveTo(x(points[0]!.tick), y(points[0]!.value));
    points.forEach((point, i) => {
      const next = points[i + 1];
      if (!next) {
        path.lineTo(clipRight, y(point.value));
      } else if (stepped || point.curve === 'step') {
        path.lineTo(x(next.tick), y(point.value));
        path.lineTo(x(next.tick), y(next.value));
      } else {
        path.lineTo(x(next.tick), y(next.value));
      }
    });
    // Fill under the line, then the line, then the points.
    const fill = new Path2D(path);
    fill.lineTo(clipRight, bottom);
    fill.lineTo(x(points[0]!.tick), bottom);
    fill.closePath();
    ctx.fillStyle = trackColor;
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * 0.15;
    ctx.fill(fill);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = trackColor;
    ctx.lineWidth = 1.5;
    ctx.stroke(path);
    ctx.fillStyle = trackColor;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(x(point.tick), y(point.value), 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Outside the clip: dimmed.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  if (clipLeft > KEYS_WIDTH)
    ctx.fillRect(KEYS_WIDTH, laneTop, clipLeft - KEYS_WIDTH, AUTOMATION_HEIGHT);
  if (clipRight < width) ctx.fillRect(clipRight, laneTop, width - clipRight, AUTOMATION_HEIGHT);
  ctx.restore();

  // Labels: the lane's name, and the value range in the key column.
  ctx.font = `9px ${mono}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = color('var(--screen-ink-dim)');
  ctx.fillText(
    lane.inactive ? `${lane.name} (unlinked: doesn't play)` : lane.name,
    KEYS_WIDTH + 6,
    laneTop + 4,
  );
  ctx.textBaseline = 'middle';
  ctx.fillText(formatParam(param, param.max), 4, top, KEYS_WIDTH - 6);
  ctx.fillText(formatParam(param, param.min), 4, bottom, KEYS_WIDTH - 6);
}
