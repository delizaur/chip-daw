<!--
  Horizontal volume fader with a level meter inside it, label and value on the right.
  The fader behaves like Slider (press to jump, drag, double-click to reset, arrow keys).

  The meter uses a dB scale (-60 dBFS at the left edge, 0 dBFS at the right), because a linear
  meter would hide everything quieter than about -20 dB. The fader position is the raw 0..1
  volume, so the two are independent overlays on the same bar.
-->
<script lang="ts">
  import { linearRangeHandlers } from './linear-range';
  import { clamp, toNormalized } from './scale';

  interface Props {
    value: number;
    /** Peak level to display, as linear amplitude (1 = 0 dBFS). */
    level: number;
    label: string;
    min?: number;
    max?: number;
    defaultValue?: number;
    color?: string;
    /** Width of the bar in px. */
    width?: number;
    format?: (value: number) => string;
    disabled?: boolean;
    oninput: (value: number) => void;
    onstart?: () => void;
    onend?: () => void;
  }

  let {
    value,
    level,
    label,
    min = 0,
    max = 1,
    defaultValue = min,
    color = 'var(--c-orange)',
    width = 160,
    format = (v) => `${Math.round(v * 100)}%`,
    disabled = false,
    oninput,
    onstart,
    onend,
  }: Props = $props();

  const METER_FLOOR_DB = -60;

  const normalized = $derived(toNormalized(value, min, max));
  const meterFill = $derived(
    level > 0 ? clamp(1 - (20 * Math.log10(level)) / METER_FLOOR_DB, 0, 1) : 0,
  );

  const handlers = linearRangeHandlers(() => ({
    value,
    min,
    max,
    defaultValue,
    disabled,
    orientation: 'horizontal',
    inset: () => 0,
    oninput,
    onstart,
    onend,
  }));
</script>

<div
  class="meter-fader"
  class:disabled
  style:--color={color}
  style:--n={normalized}
  style:--fill={meterFill}
  style:--width="{width}px"
>
  <div
    class="track"
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label={label}
    aria-orientation="horizontal"
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    aria-valuetext={format(value)}
    aria-disabled={disabled}
    {...handlers}
  >
    <div class="bar">
      <div class="volume"></div>
      <div class="meter-fill" data-level={level}></div>
    </div>
    <div class="thumb"></div>
  </div>
  <span class="label">{label}</span>
  <span class="value">{format(value)}</span>
</div>

<style>
  .meter-fader {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* Taller than the bar so it's an easy touch target. */
  .track {
    position: relative;
    width: var(--width);
    height: 28px;
    cursor: pointer;
    touch-action: none;
    border-radius: var(--r-s);
  }

  .disabled .track {
    cursor: default;
    opacity: 0.4;
  }

  .bar {
    position: absolute;
    inset: 7px 0;
    border-radius: var(--r-pill);
    background: var(--panel-sunken);
    overflow: hidden;
  }

  /* Tints the bar up to the fader position. */
  .volume {
    position: absolute;
    inset: 0 auto 0 0;
    width: calc(var(--n) * 100%);
    background: color-mix(in srgb, var(--color) 30%, transparent);
  }

  /* Green up to -12 dB, yellow to -3 dB, red above. */
  .meter-fill {
    position: absolute;
    inset: 4px 0;
    background: linear-gradient(
      to right,
      var(--c-green) 0 80%,
      var(--c-yellow) 80% 95%,
      var(--c-red) 95%
    );
    clip-path: inset(0 calc((1 - var(--fill)) * 100%) 0 0 round 2px);
    transition: clip-path 60ms linear;
  }

  .thumb {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: calc(var(--n) * (100% - 6px));
    width: 6px;
    border-radius: 3px;
    background: var(--color);
    box-shadow: 0 0 0 2px var(--panel);
    pointer-events: none;
  }

  .label {
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .value {
    min-width: 4ch;
    font-family: var(--font-mono);
    font-size: var(--text-s);
    color: var(--ink);
  }
</style>
