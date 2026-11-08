<!--
  One box (sequencer, synth or effect) in the preset editor. Rendered entirely from the box's
  descriptor: enum params become segmented selectors, everything else a knob.
-->
<script lang="ts">
  import { setBoxParam, type BoxAddress } from '../../model/commands';
  import { getBoxDescriptor, paramValue } from '../../model/boxes/registry';
  import type { ParamDescriptor } from '../../model/boxes/types';
  import type { BoxInstance } from '../../model/types';
  import { formatParam } from '../controls/format';
  import Knob from '../controls/Knob.svelte';
  import Segmented from '../controls/Segmented.svelte';
  import { session } from '../state/session.svelte';

  interface Props {
    box: BoxInstance;
    address: BoxAddress;
  }

  let { box, address }: Props = $props();

  /** Knob colors cycle like the OP-1's four encoders. */
  const KNOB_COLORS = ['var(--c-blue)', 'var(--c-green)', 'var(--c-pink)', 'var(--c-orange)'];

  const descriptor = $derived(getBoxDescriptor(box.type));
  const enumParams = $derived(descriptor?.params.filter((p) => p.steps) ?? []);
  const knobParams = $derived(descriptor?.params.filter((p) => !p.steps) ?? []);

  const options = (param: ParamDescriptor) =>
    (param.steps ?? []).map((label, i) => ({ value: param.min + i * (param.step ?? 1), label }));

  const set = (param: ParamDescriptor, value: number) =>
    session.run(setBoxParam(address, param.id, value, `Change ${param.name}`));
</script>

<article class="box" aria-label="{descriptor?.name ?? box.type} {descriptor?.kind ?? 'box'}">
  <header>
    <span class="kind">{descriptor?.kind ?? 'box'}</span>
    <h3>{descriptor?.name ?? box.type}</h3>
  </header>

  {#if descriptor}
    {#each enumParams as param (param.id)}
      <div class="enum">
        <span class="param-label">{param.name}</span>
        <Segmented
          label={param.name}
          options={options(param)}
          value={paramValue(box, param)}
          color="var(--c-blue)"
          onchange={(v) => set(param, v)}
        />
      </div>
    {/each}
    <div class="knobs">
      {#each knobParams as param, i (param.id)}
        <Knob
          label={param.name}
          value={paramValue(box, param)}
          min={param.min}
          max={param.max}
          defaultValue={param.default}
          step={param.step}
          scale={param.scale}
          color={KNOB_COLORS[i % KNOB_COLORS.length]}
          size={44}
          format={(v) => formatParam(param, v)}
          onstart={() => session.begin(`Change ${param.name}`)}
          oninput={(v) => set(param, v)}
          onend={() => session.commit()}
        />
      {/each}
    </div>
  {:else}
    <p class="placeholder">Unknown box type "{box.type}". It stays silent.</p>
  {/if}
</article>

<style>
  .box {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-radius: var(--r-l);
    background: var(--panel-raised);
    box-shadow: var(--shadow-raised);
    flex-shrink: 0;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  h3 {
    font-size: var(--text-m);
    font-weight: 800;
  }

  .kind {
    padding: 1px 6px;
    border-radius: var(--r-pill);
    background: var(--panel-sunken);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .enum {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .param-label {
    min-width: 36px;
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .knobs {
    display: flex;
    gap: var(--space-2);
  }
</style>
