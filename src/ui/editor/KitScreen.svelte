<!--
  The drum synth's screen: one octave of keys, each labelled with the drum it plays (the same
  in every octave), like the OP-1's drum keyboard. Drums are colored by family.
-->
<script lang="ts">
  import { DRUM_SOUNDS, type DrumSound } from '../../model/boxes/drum-synth';

  interface Props {
    /** Pitches playing on the track right now: their drums' keys light up. */
    lit?: ReadonlySet<number>;
  }

  let { lit = new Set() }: Props = $props();

  /** Lit pitch classes (a drum lights up whichever octave it's played in). */
  const litDrums = $derived(new Set([...lit].map((p) => ((p % 12) + 12) % 12)));

  /** White keys of the octave (pitch classes), and black keys with their gap position. */
  const WHITE = [0, 2, 4, 5, 7, 9, 11];
  const BLACK = [
    { pitch: 1, slot: 1 },
    { pitch: 3, slot: 2 },
    { pitch: 6, slot: 4 },
    { pitch: 8, slot: 5 },
    { pitch: 10, slot: 6 },
  ];

  const KEY = 24;
  const W = KEY * WHITE.length;
  const H = 76;
  const BLACK_W = 18;
  const BLACK_H = 44;

  /** Families: kick, snare and clap, metal (hats, cymbal, shaker), toms; the rest white. */
  const COLOR: Partial<Record<DrumSound, string>> = {
    kick: 'var(--c-blue)',
    snare: 'var(--c-green)',
    clap: 'var(--c-green)',
    hatClosed: 'var(--c-pink)',
    hatOpen: 'var(--c-pink)',
    cymbal: 'var(--c-pink)',
    shaker: 'var(--c-pink)',
    tomLow: 'var(--c-orange)',
    tomMid: 'var(--c-orange)',
    tomHigh: 'var(--c-orange)',
  };

  const sound = (pitch: number) => DRUM_SOUNDS[pitch]!;
  const color = (pitch: number) => COLOR[sound(pitch).id] ?? 'var(--screen-ink)';
</script>

<figure class="screen" aria-hidden="true">
  <svg viewBox="-1 -1 {W + 2} {H + 2}" width={W} height={H}>
    {#each WHITE as pitch, i (pitch)}
      <rect
        class="white"
        class:lit={litDrums.has(pitch)}
        style:--key={color(pitch)}
        x={i * KEY}
        y="0"
        width={KEY}
        height={H}
      />
      <text
        x={i * KEY + KEY / 2}
        y={H - 8}
        class:lit={litDrums.has(pitch)}
        style:fill={color(pitch)}>{sound(pitch).short}</text
      >
    {/each}
    {#each BLACK as key (key.pitch)}
      <rect
        class="black"
        class:lit={litDrums.has(key.pitch)}
        style:--key={color(key.pitch)}
        x={key.slot * KEY - BLACK_W / 2}
        y="0"
        width={BLACK_W}
        height={BLACK_H}
      />
      <text
        x={key.slot * KEY}
        y={BLACK_H - 8}
        class:lit={litDrums.has(key.pitch)}
        style:fill={color(key.pitch)}
      >
        {sound(key.pitch).short}
      </text>
    {/each}
  </svg>
  <figcaption>Kit · every octave</figcaption>
</figure>

<style>
  .screen {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-1);
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

  .white {
    fill: var(--screen);
    stroke: var(--screen-line-strong);
  }

  .black {
    fill: var(--screen-raised);
    stroke: var(--screen-line-strong);
  }

  /* A key lights up in its drum's color while it plays, then fades out (so even a short hit
     shows). */
  rect {
    transition: fill 180ms ease-out;
  }

  rect.lit {
    fill: var(--key);
    transition: none;
  }

  text.lit {
    fill: var(--screen) !important;
  }

  text {
    font-size: 10px;
    font-weight: 500;
    text-anchor: middle;
  }
</style>
