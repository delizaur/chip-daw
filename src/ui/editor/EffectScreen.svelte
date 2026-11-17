<!--
  An effect's or sequencer's little OLED screen (filter response, delay echoes, crushed wave,
  reverb tail, arp pattern), drawn in its knobs' colors. Redraws as the knobs move.
-->
<script lang="ts">
  import type { BoxInstance } from '../../model/types';
  import { effectScreen, type ScreenLine } from './effect-visuals';
  import { svgPath } from './synth-visuals';

  interface Props {
    box: BoxInstance;
    /** Param id → the color of its knob. */
    colors: ReadonlyMap<string, string>;
  }

  let { box, colors }: Props = $props();

  const W = 168;
  const H = 72;

  const screen = $derived(effectScreen(box));
  const stroke = (line: ScreenLine) =>
    line.param
      ? (colors.get(line.param) ?? 'var(--screen-ink)')
      : line.tone === 'dim'
        ? 'var(--screen-ink-dim)'
        : line.tone === 'faint'
          ? 'var(--screen-line-strong)'
          : 'var(--screen-ink)';
</script>

{#if screen}
  <figure class="screen" aria-hidden="true">
    <svg viewBox="-4 -4 {W + 8} {H + 8}" width={W} height={H}>
      {#each screen.lines as line, i (i)}
        <path
          d={svgPath(line.points, W, H)}
          style:stroke={stroke(line)}
          class:dashed={line.dashed}
          class:thin={line.tone === 'faint' || line.tone === 'dim'}
          class:bold={line.bold}
        />
      {/each}
      {#each screen.dots ?? [] as dot, i (i)}
        <circle
          cx={dot.point.x * W}
          cy={(1 - dot.point.y) * H}
          r="3"
          style:stroke={dot.param ? colors.get(dot.param) : undefined}
        />
      {/each}
    </svg>
    <figcaption>{screen.caption}</figcaption>
  </figure>
{/if}

<style>
  .screen {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--screen-line-strong);
    background: var(--screen);
    flex-shrink: 0;
  }

  figcaption {
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--screen-ink-dim);
  }

  svg {
    display: block;
    overflow: visible;
  }

  path {
    fill: none;
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  path.thin {
    stroke-width: 1;
  }

  path.bold {
    stroke-width: 3;
    stroke-linecap: butt;
  }

  path.dashed {
    stroke-dasharray: 2 3;
  }

  circle {
    fill: var(--screen);
    stroke: var(--screen-ink);
    stroke-width: 1.5;
  }
</style>
