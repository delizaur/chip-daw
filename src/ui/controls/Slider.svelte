<!--
  Linear fader. Press anywhere on the track to jump there, drag to adjust, double-click to reset,
  arrow keys when focused. Fills its container along its orientation.
  Same controlled/gesture contract as Knob.
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
    orientation?: 'horizontal' | 'vertical';
    color?: string;
    format?: (value: number) => string;
    disabled?: boolean;
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
    orientation = 'horizontal',
    color = 'var(--c-blue)',
    format = (v) => v.toFixed(2),
    disabled = false,
    oninput,
    onstart,
    onend,
  }: Props = $props();

  const range = $derived({ min, max, step, scale });
  const normalized = $derived(toNormalized(value, min, max, scale));
  let pointerId: number | null = null;

  function emit(next: number) {
    if (next !== value) oninput(next);
  }

  function positionToNormalized(event: PointerEvent, element: HTMLElement): number {
    const rect = element.getBoundingClientRect();
    // Keep the thumb under the pointer: the usable track is inset by the thumb radius.
    const inset = (orientation === 'horizontal' ? rect.height : rect.width) / 2;
    return orientation === 'horizontal'
      ? clamp((event.clientX - rect.left - inset) / (rect.width - 2 * inset), 0, 1)
      : clamp((rect.bottom - event.clientY - inset) / (rect.height - 2 * inset), 0, 1);
  }

  function onpointerdown(event: PointerEvent) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    element.focus();
    element.setPointerCapture(event.pointerId);
    pointerId = event.pointerId;
    onstart?.();
    emit(valueAt(positionToNormalized(event, element), range));
  }

  function onpointermove(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    emit(valueAt(positionToNormalized(event, event.currentTarget as HTMLElement), range));
  }

  function onpointerup(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
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

<div
  class="slider {orientation}"
  class:disabled
  style:--color={color}
  style:--n={normalized}
  role="slider"
  tabindex={disabled ? -1 : 0}
  aria-label={label}
  aria-orientation={orientation}
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
  <div class="track">
    <div class="fill"></div>
  </div>
  <div class="thumb"></div>
</div>

<style>
  .slider {
    --thumb: 18px;
    position: relative;
    touch-action: none;
    cursor: pointer;
  }

  .horizontal {
    width: 100%;
    height: var(--thumb);
  }

  .vertical {
    width: var(--thumb);
    height: 100%;
  }

  .disabled {
    opacity: 0.4;
    cursor: default;
  }

  .track {
    position: absolute;
    border-radius: var(--r-pill);
    background: var(--panel-sunken);
    overflow: hidden;
  }

  .horizontal .track {
    inset: calc(50% - 3px) 0;
  }

  .vertical .track {
    inset: 0 calc(50% - 3px);
  }

  .fill {
    position: absolute;
    background: var(--color);
  }

  .horizontal .fill {
    inset: 0 auto 0 0;
    width: calc(var(--thumb) / 2 + (100% - var(--thumb)) * var(--n));
  }

  .vertical .fill {
    inset: auto 0 0 0;
    height: calc(var(--thumb) / 2 + (100% - var(--thumb)) * var(--n));
  }

  .thumb {
    position: absolute;
    width: var(--thumb);
    height: var(--thumb);
    border-radius: 50%;
    background: var(--panel-raised);
    border: 4px solid var(--color);
    box-shadow: var(--shadow-raised);
  }

  .horizontal .thumb {
    top: 0;
    left: calc((100% - var(--thumb)) * var(--n));
  }

  .vertical .thumb {
    left: 0;
    bottom: calc((100% - var(--thumb)) * var(--n));
  }
</style>
