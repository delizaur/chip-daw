<!--
  A screen showing what one note of the synth sounds like over its first seconds: the real
  engine renders it (at a low sample rate, off the audio thread) whenever a knob moves, and its
  waveform is drawn as an envelope. Used where a synth has no ADSR to draw (Pluck): it shows
  the decay, the damping and the bow as they really are.
-->
<script lang="ts">
  import { PluckSynth } from '../../engine/boxes/pluck-synth';
  import type { BoxInstance } from '../../model/types';

  interface Props {
    box: BoxInstance;
  }

  let { box }: Props = $props();

  const W = 168;
  const H = 64;
  /** Low, but plenty for a picture of the envelope. */
  const SAMPLE_RATE = 12000;
  const SECONDS = 2;
  /** A bowed (held) note is let go here, so the release shows too. */
  const HOLD = 1.4;
  const PITCH = 52;

  /** Decibels shown, down from the loudest moment: the ear hears level this way. */
  const RANGE_DB = 48;
  /** -1..1 to the same on a decibel scale (sign kept). */
  const toDb = (v: number) =>
    Math.sign(v) * Math.max(0, 1 + (20 * Math.log10(Math.abs(v) + 1e-9)) / RANGE_DB);

  /** Min and max of the note per column, -1..1 on a decibel scale (0 dB: the loudest). */
  const columns = $derived.by(() => {
    const synth = new PluckSynth(SAMPLE_RATE);
    synth.setParams({ ...box.params, transpose: 0, fine: 0, level: 1 });
    const total = SAMPLE_RATE * SECONDS;
    const left = new Float32Array(total);
    const right = new Float32Array(total);
    synth.noteOn(PITCH, 110);
    const block = 128;
    const release = Math.round(HOLD * SAMPLE_RATE);
    for (let offset = 0; offset < total; offset += block) {
      if (offset <= release && release < offset + block) synth.noteOff(PITCH);
      synth.process(left, right, offset, Math.min(block, total - offset));
    }
    const per = total / W;
    const result: { low: number; high: number }[] = [];
    let loudest = 1e-6;
    for (let x = 0; x < W; x++) {
      let low = 0;
      let high = 0;
      for (let i = Math.floor(x * per); i < Math.floor((x + 1) * per); i++) {
        low = Math.min(low, left[i]!);
        high = Math.max(high, left[i]!);
      }
      loudest = Math.max(loudest, high, -low);
      result.push({ low, high });
    }
    return result.map((c) => ({ low: toDb(c.low / loudest), high: toDb(c.high / loudest) }));
  });

  /** The envelope as a closed shape: along the tops, back along the bottoms. */
  const shape = $derived(
    [
      ...columns.map((c, x) => `${x === 0 ? 'M' : 'L'}${x} ${((1 - c.high) * H) / 2}`),
      ...columns.map((c, x) => `L${x} ${((1 - c.low) * H) / 2}`).reverse(),
      'Z',
    ].join(''),
  );
  const bowed = $derived(box.params.excite === 2);
</script>

<figure class="screen" aria-hidden="true">
  <svg viewBox="-2 -2 {W + 4} {H + 4}" width={W} height={H}>
    <line class="axis" x1="0" y1={H / 2} x2={W} y2={H / 2} />
    {#if bowed}
      <line class="release" x1={(HOLD / SECONDS) * W} y1="0" x2={(HOLD / SECONDS) * W} y2={H} />
    {/if}
    <path d={shape} />
  </svg>
  <figcaption>
    Note · {SECONDS} s{#if bowed}<span class="legend">┆ let go</span>{/if}
  </figcaption>
</figure>

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
    fill: color-mix(in srgb, var(--c-green) 35%, transparent);
    stroke: var(--c-green);
    stroke-width: 1;
    stroke-linejoin: round;
  }

  .axis {
    stroke: var(--screen-line-strong);
    stroke-width: 1;
  }

  .release {
    stroke: var(--screen-ink-dim);
    stroke-width: 1;
    stroke-dasharray: 2 3;
  }
</style>
