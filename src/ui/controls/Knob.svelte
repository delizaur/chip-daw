<!--
  Rotary control. Drag up/down to change (hold Shift for fine control), double-click to reset,
  arrow keys when focused. Controlled: the parent owns `value` and updates it from `oninput`.
  `onstart`/`onend` bracket a gesture so the parent can group it into one undo step.
-->
<script lang="ts">
  import { clamp, toNormalized, valueAt, valueForKey, type Scale } from './scale';

  interface Props {
    value: number;
    label: string;
    min?: number;
    max?: number;
    defaultValue?: number;
    step?: number;
    scale?: Scale;
    color?: string;
    size?: number;
    format?: (value: number) => string;
    disabled?: boolean;
    /** Shows a mark next to the label, with this tooltip (e.g. the param is automated). */
    mark?: string;
    oninput: (value: number) => void;
    onstart?: () => void;
    onend?: () => void;
  }

  let {
    value,
    label,
    min = 0,
    max = 1,
    defaultValue = min,
    step,
    scale = 'linear',
    color = 'var(--c-blue)',
    size = 48,
    format = (v) => v.toFixed(2),
    disabled = false,
    mark,
    oninput,
    onstart,
    onend,
  }: Props = $props();

  /** Pixels of vertical drag for the full range. */
  const DRAG_RANGE = 200;
  const FINE_FACTOR = 6;
  const START_ANGLE = -135;
  const SWEEP = 270;
  /** Scale ticks: the ends and the middle. */
  const TICKS = [0, 0.5, 1];

  const range = $derived({ min, max, step, scale });
  const normalized = $derived(toNormalized(value, min, max, scale));
  const angle = $derived(START_ANGLE + SWEEP * normalized);

  let drag: { pointerId: number; lastY: number; n: number } | null = null;
  let dragging = $state(false);

  function emit(next: number) {
    if (next !== value) oninput(next);
  }

  function polar(degrees: number, radius: number): [number, number] {
    const radians = (degrees * Math.PI) / 180;
    return [50 + radius * Math.sin(radians), 50 - radius * Math.cos(radians)];
  }

  function arc(from: number, to: number, radius: number): string {
    const [x1, y1] = polar(from, radius);
    const [x2, y2] = polar(to, radius);
    const largeArc = to - from > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
  }

  function onpointerdown(event: PointerEvent) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).focus();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, lastY: event.clientY, n: normalized };
    dragging = true;
    onstart?.();
  }

  function onpointermove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const pixels = DRAG_RANGE * (event.shiftKey ? FINE_FACTOR : 1);
    drag.n = clamp(drag.n + (drag.lastY - event.clientY) / pixels, 0, 1);
    drag.lastY = event.clientY;
    emit(valueAt(drag.n, range));
  }

  function onpointerup(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    dragging = false;
    onend?.();
  }

  function ondblclick() {
    if (disabled) return;
    onstart?.();
    emit(defaultValue);
    onend?.();
  }

  function onkeydown(event: KeyboardEvent) {
    if (disabled) return;
    const next = valueForKey(event.key, event.shiftKey, value, range);
    if (next === null) return;
    event.preventDefault();
    onstart?.();
    emit(next);
    onend?.();
  }
</script>

<div class="knob" class:disabled style:--color={color} style:--size="{size}px">
  <div
    class="dial"
    class:dragging
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label={label}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    aria-valuetext={format(value)}
    aria-disabled={disabled}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    onpointercancel={onpointerup}
    {ondblclick}
    {onkeydown}
  >
    <!-- OP-1 style gauge: hairline scale with ticks, the value as a colored arc, an outline
         ring and a needle. -->
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path class="track" d={arc(START_ANGLE, START_ANGLE + SWEEP, 44)} />
      {#each TICKS as tick (tick)}
        <line
          class="tick"
          x1={polar(START_ANGLE + SWEEP * tick, 44)[0]}
          y1={polar(START_ANGLE + SWEEP * tick, 44)[1]}
          x2={polar(START_ANGLE + SWEEP * tick, 36)[0]}
          y2={polar(START_ANGLE + SWEEP * tick, 36)[1]}
        />
      {/each}
      {#if normalized > 0.001}
        <path class="fill" d={arc(START_ANGLE, angle, 44)} />
      {/if}
      <circle class="ring" cx="50" cy="50" r="26" />
      <line class="needle" x1="50" y1="50" x2={polar(angle, 34)[0]} y2={polar(angle, 34)[1]} />
      <circle class="hub" cx="50" cy="50" r="6" />
    </svg>
  </div>
  <div class="label">
    {#if mark}<span class="mark" title={mark} aria-hidden="true">●</span>{/if}{label}
  </div>
  <div class="value">{format(value)}</div>
</div>

<style>
  .knob {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: max(var(--size), var(--hit));
  }

  .dial {
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    cursor: ns-resize;
    touch-action: none;
  }

  .disabled .dial {
    cursor: default;
    opacity: 0.4;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .track,
  .fill {
    fill: none;
  }

  .track {
    stroke: var(--line-strong);
    stroke-width: 2;
  }

  .tick {
    stroke: var(--line-strong);
    stroke-width: 2;
  }

  .fill {
    stroke: var(--color);
    stroke-width: 5;
  }

  .ring {
    fill: none;
    stroke: var(--color);
    stroke-width: 3;
    transition: fill 80ms ease-out;
  }

  .dragging .ring,
  .dial:focus-visible .ring {
    fill: color-mix(in srgb, var(--color) 20%, transparent);
  }

  .needle {
    stroke: var(--ink);
    stroke-width: 3;
    stroke-linecap: round;
  }

  .hub {
    fill: var(--color);
  }

  .label {
    font-size: var(--text-xs);
    line-height: 1.2;
    white-space: nowrap;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .mark {
    margin-right: 3px;
    color: var(--c-red);
  }

  .value {
    font-size: var(--text-s);
    line-height: 1.2;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }
</style>
