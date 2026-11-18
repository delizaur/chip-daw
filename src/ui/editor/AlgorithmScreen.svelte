<!--
  The FM 4-op synth's screen: its algorithm as a diagram, as on the chips' front panels.
  Operators are boxes (carriers, the ones heard, in blue on the output line; modulators in
  orange, arrows into what they bend), each filled to its level; operator 4 loops back on
  itself when it has feedback.
-->
<script lang="ts">
  import { FM4_ALGORITHMS } from '../../model/boxes/fm4-synth';
  import type { BoxInstance } from '../../model/types';

  interface Props {
    box: BoxInstance;
  }

  let { box }: Props = $props();

  /** Each algorithm's layout: operator → [column, row] (rows top to bottom, carriers last). */
  const LAYOUTS: readonly Record<number, readonly [number, number]>[] = [
    { 4: [0, 0], 3: [0, 1], 2: [0, 2], 1: [0, 3] },
    { 4: [1, 0], 3: [0, 0], 2: [0.5, 1], 1: [0.5, 2] },
    { 3: [0, 0], 2: [0, 1], 4: [1, 1], 1: [0.5, 2] },
    { 4: [1, 0], 3: [1, 1], 2: [0, 1], 1: [0.5, 2] },
    { 2: [0, 0], 1: [0, 1], 4: [1, 0], 3: [1, 1] },
    { 4: [1, 0], 1: [0, 1], 2: [1, 1], 3: [2, 1] },
    { 4: [2, 0], 3: [2, 1], 1: [0, 1], 2: [1, 1] },
    { 1: [0, 0], 2: [1, 0], 3: [2, 0], 4: [3, 0] },
  ];

  const W = 168;
  const H = 128;
  const CELL = 30;
  const BOX = 20;

  const value = (id: string, fallback: number) => box.params[id] ?? fallback;
  const index = $derived(
    Math.min(FM4_ALGORITHMS.length - 1, Math.max(0, Math.round(value('algorithm', 0)))),
  );
  const algorithm = $derived(FM4_ALGORITHMS[index]!);
  const layout = $derived(LAYOUTS[index]!);
  const feedback = $derived(value('feedback', 0) > 0.001);

  /** Box centres, the diagram centred on the screen above the output line. */
  const centres = $derived.by(() => {
    const cells = Object.values(layout);
    const columns = Math.max(...cells.map(([c]) => c)) + 1;
    const rows = Math.max(...cells.map(([, r]) => r)) + 1;
    const left = (W - columns * CELL) / 2 + CELL / 2;
    const top = (H - 16 - rows * CELL) / 2 + CELL / 2;
    const result: Record<number, { x: number; y: number }> = {};
    for (const [op, [c, r]] of Object.entries(layout)) {
      result[Number(op)] = { x: left + c * CELL, y: top + r * CELL };
    }
    return result;
  });

  const OUTPUT_Y = H - 8;
  const ops = [1, 2, 3, 4];
  const isCarrier = (op: number) => algorithm.carriers.includes(op);
  const level = (op: number) => Math.min(1, Math.max(0, value(`op${op}Level`, 0)));

  /** Modulation arrows: from each modulator's bottom edge to its target's top edge. */
  const arrows = $derived(
    ops.flatMap((target) =>
      algorithm.modulators[target - 1]!.map((source) => ({
        from: centres[source]!,
        to: centres[target]!,
      })),
    ),
  );
</script>

<figure class="screen" aria-hidden="true">
  <svg viewBox="0 0 {W} {H}" width={W} height={H}>
    <defs>
      <marker
        id="fm4-arrow"
        viewBox="0 0 6 6"
        refX="5"
        refY="3"
        markerWidth="5"
        markerHeight="5"
        orient="auto"
      >
        <path d="M0 0L6 3L0 6Z" class="arrowhead" />
      </marker>
    </defs>
    <line class="output" x1="12" y1={OUTPUT_Y} x2={W - 12} y2={OUTPUT_Y} />
    {#each arrows as arrow, i (i)}
      <line
        class="wire"
        x1={arrow.from.x}
        y1={arrow.from.y + BOX / 2}
        x2={arrow.to.x}
        y2={arrow.to.y - BOX / 2 - 1}
        marker-end="url(#fm4-arrow)"
      />
    {/each}
    {#each ops.filter(isCarrier) as op (op)}
      <line
        class="wire"
        x1={centres[op]!.x}
        y1={centres[op]!.y + BOX / 2}
        x2={centres[op]!.x}
        y2={OUTPUT_Y}
      />
    {/each}
    {#if feedback}
      {@const c = centres[4]!}
      <path
        class="wire"
        d="M{c.x + BOX / 2} {c.y + 4} h6 v-{BOX / 2 + 6} h-{BOX / 2 + 6} v{4}"
        marker-end="url(#fm4-arrow)"
      />
    {/if}
    {#each ops as op (op)}
      {@const c = centres[op]!}
      {@const carrier = isCarrier(op)}
      <rect class="op" class:carrier x={c.x - BOX / 2} y={c.y - BOX / 2} width={BOX} height={BOX} />
      <rect
        class="fill"
        class:carrier
        x={c.x - BOX / 2}
        y={c.y + BOX / 2 - BOX * level(op)}
        width={BOX}
        height={BOX * level(op)}
      />
      <text x={c.x} y={c.y + 4}>{op}</text>
    {/each}
  </svg>
  <figcaption>Algorithm {index + 1}</figcaption>
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

  svg {
    display: block;
    overflow: visible;
  }

  .output {
    stroke: var(--screen-ink-dim);
    stroke-width: 2;
  }

  .wire {
    fill: none;
    stroke: var(--screen-ink-dim);
    stroke-width: 1.5;
  }

  .arrowhead {
    fill: var(--screen-ink-dim);
  }

  .op {
    fill: var(--screen);
    stroke: var(--c-orange);
    stroke-width: 1.5;
  }

  .op.carrier {
    stroke: var(--c-blue);
  }

  .fill {
    fill: color-mix(in srgb, var(--c-orange) 45%, transparent);
  }

  .fill.carrier {
    fill: color-mix(in srgb, var(--c-blue) 45%, transparent);
  }

  text {
    font-size: 11px;
    font-weight: 500;
    text-anchor: middle;
    fill: var(--screen-ink);
  }
</style>
