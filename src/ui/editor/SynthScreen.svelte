<!--
  A synth's little OLED screen, OP-1 style: one cycle of its oscillator, and its ADSR envelope
  with each stage drawn in the color of the knob that sets it. Redraws as the knobs move.
-->
<script lang="ts">
  import type { BoxInstance } from '../../model/types';
  import { envelopeShape, svgPath, waveShape, type Point } from './synth-visuals';

  interface Props {
    box: BoxInstance;
    /** Param id → the color of its knob. */
    colors: ReadonlyMap<string, string>;
  }

  let { box, colors }: Props = $props();

  const W = 168;
  const H = 52;

  const wave = $derived(waveShape(box));
  const envelope = $derived(envelopeShape(box));
  /** FM: the modulator's envelope (brightness over the note), drawn dashed behind. */
  const modEnvelope = $derived(
    box.type === 'synth.fm'
      ? envelopeShape(
          box,
          { attack: 'attack', decay: 'modDecay', sustain: 'modSustain', release: 'release' },
          0.001,
        )
      : null,
  );

  const color = (id: string) => colors.get(id) ?? 'var(--screen-ink)';
  const path = (points: Point[]) => svgPath(points, W, H);
  const at = (p: Point | undefined) => ({ x: (p?.x ?? 0) * W, y: (1 - (p?.y ?? 0)) * H });

  /** Where the stages meet: dots and dashed guides, as on the OP-1's envelope screen. */
  const joints = $derived(
    envelope
      ? [envelope.attack.at(-1), envelope.decay.at(-1), envelope.sustain.at(-1)].map(at)
      : [],
  );
</script>

{#if wave || envelope}
  <div class="screen" aria-hidden="true">
    {#if wave}
      <figure>
        <svg viewBox="-2 -2 {W + 4} {H + 4}" width={W} height={H}>
          <line class="axis" x1="0" y1={H / 2} x2={W} y2={H / 2} />
          <path class="wave" d={path(wave)} />
        </svg>
        <figcaption>Wave</figcaption>
      </figure>
    {/if}
    {#if envelope}
      <figure>
        <svg viewBox="-4 -4 {W + 8} {H + 8}" width={W} height={H}>
          <line class="axis" x1="0" y1={H} x2={W} y2={H} />
          {#each joints as joint, i (i)}
            <line class="guide" x1={joint.x} y1={joint.y} x2={joint.x} y2={H} />
          {/each}
          {#if modEnvelope}
            <path
              class="mod"
              d={path([
                ...modEnvelope.attack,
                ...modEnvelope.decay,
                ...modEnvelope.sustain,
                ...modEnvelope.release,
              ])}
            />
          {/if}
          <path d={path(envelope.attack)} style:stroke={color('attack')} />
          <path d={path(envelope.decay)} style:stroke={color('decay')} />
          <path d={path(envelope.sustain)} style:stroke={color('sustain')} />
          <path d={path(envelope.release)} style:stroke={color('release')} />
          {#each joints as joint, i (i)}
            <circle cx={joint.x} cy={joint.y} r="2.5" />
          {/each}
        </svg>
        <figcaption>
          Envelope{#if modEnvelope}<span class="legend">┄ mod</span>{/if}
        </figcaption>
      </figure>
    {/if}
  </div>
{/if}

<style>
  .screen {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--screen-line-strong);
    background: var(--screen);
    color: var(--screen-ink);
    flex-shrink: 0;
  }

  figure {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
  }

  figcaption {
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--screen-ink-dim);
  }

  .legend {
    margin-left: var(--space-2);
    letter-spacing: 0;
    text-transform: none;
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

  .wave {
    stroke: var(--screen-ink);
  }

  .mod {
    stroke: var(--screen-ink-dim);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }

  .axis {
    stroke: var(--screen-line-strong);
    stroke-width: 1;
  }

  .guide {
    stroke: var(--screen-line-strong);
    stroke-width: 1;
    stroke-dasharray: 2 3;
  }

  circle {
    fill: var(--screen);
    stroke: var(--screen-ink);
    stroke-width: 1.5;
  }
</style>
