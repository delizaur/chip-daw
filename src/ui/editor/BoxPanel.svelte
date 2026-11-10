<!--
  One box (sequencer, synth or effect) in the preset editor. Rendered entirely from the box's
  descriptor: enum params become segmented selectors (or a dropdown when they have many
  options), everything else a knob. The header has the box's chain controls: on/off, move,
  remove, and replace with another box of the same kind.
-->
<script lang="ts">
  import { setBoxParam } from '../../model/commands';
  import { moveBox, removeBox, replaceBox, setBoxBypassed } from '../../model/chain-commands';
  import type { AutomationCurve } from '../../engine/automation';
  import type { PresetTarget } from '../../model/presets';
  import { boxDescriptorsOfKind, getBoxDescriptor, paramValue } from '../../model/boxes/registry';
  import type { ParamDescriptor } from '../../model/boxes/types';
  import type { BoxInstance } from '../../model/types';
  import { formatParam } from '../controls/format';
  import Knob from '../controls/Knob.svelte';
  import Segmented from '../controls/Segmented.svelte';
  import { session } from '../state/session.svelte';

  interface Props {
    box: BoxInstance;
    /** The preset the box is in: the track preset (copy on write) or a clip preset. */
    target: PresetTarget;
    /** Automation of the clips playing with that preset on the track (moves the knobs). */
    curves?: readonly AutomationCurve[];
    /** Position within its list (sequencers or effects) and the list's length; synth: 0 of 1. */
    index: number;
    count: number;
  }

  let { box, target, index, count, curves = [] }: Props = $props();

  /** Knob colors cycle like the OP-1's four encoders. */
  const KNOB_COLORS = ['var(--c-blue)', 'var(--c-green)', 'var(--c-pink)', 'var(--c-orange)'];
  /** Enum params with more options than this get a dropdown instead of a button row. */
  const MAX_SEGMENTS = 6;

  const descriptor = $derived(getBoxDescriptor(box.type));
  const name = $derived(descriptor?.name ?? box.type);
  const isSynth = $derived(descriptor?.kind === 'synth');
  const alternatives = $derived(descriptor ? boxDescriptorsOfKind(descriptor.kind) : []);
  const enumParams = $derived(descriptor?.params.filter((p) => p.steps) ?? []);
  const knobParams = $derived(descriptor?.params.filter((p) => !p.steps) ?? []);
  const address = $derived({ target, boxId: box.id });

  const options = (param: ParamDescriptor) =>
    (param.steps ?? []).map((label, i) => ({ value: param.min + i * (param.step ?? 1), label }));

  /** While recording, moves are recorded as automation instead of changing the preset. */
  const recording = $derived(session.recordingKnobs);

  const set = (param: ParamDescriptor, value: number) => {
    if (recording) session.moveParamWhileRecording(box, param.id, value);
    else session.runPresetEdit(setBoxParam(address, param.id, value, `Change ${param.name}`));
  };

  const AUTOMATED = "Automated in this track's clips: moves while they play";

  /** This box's automated params (param id → curve). */
  const automation = $derived(
    new Map(curves.filter((c) => c.boxId === box.id).map((c) => [c.paramId, c])),
  );

  /** The automated value at the playhead while playing (NaN before the first point). */
  function automated(param: ParamDescriptor): number | undefined {
    if (!session.playing) return undefined;
    const value = automation.get(param.id)?.valueAt(session.position);
    return value === undefined || Number.isNaN(value) ? undefined : value;
  }

  /**
   * The value a control shows: a knob moved while recording, else the automated value while
   * playing (so recorded knob moves play back on the knobs), else the box's own.
   */
  const shown = (param: ParamDescriptor) =>
    (recording ? session.liveParamValue(box.id, param.id) : undefined) ??
    automated(param) ??
    paramValue(box, param);
</script>

<article class="box" class:bypassed={box.bypassed} aria-label="{name} {descriptor?.kind ?? 'box'}">
  <header>
    <span class="kind">{descriptor?.kind ?? 'box'}</span>
    {#if alternatives.length > 1}
      <select
        class="type"
        aria-label="{name} type"
        value={box.type}
        onchange={(event) =>
          session.runPresetEdit(
            replaceBox(target, box.id, (event.currentTarget as HTMLSelectElement).value),
          )}
      >
        {#each alternatives as alternative (alternative.type)}
          <option value={alternative.type}>{alternative.name}</option>
        {/each}
      </select>
    {:else}
      <h3>{name}</h3>
    {/if}
    {#if !isSynth}
      <div class="actions">
        <button
          type="button"
          class="power"
          class:on={!box.bypassed}
          aria-pressed={!box.bypassed}
          aria-label="{name} on"
          title={box.bypassed ? `Turn ${name} on` : `Bypass ${name}`}
          onclick={() => session.runPresetEdit(setBoxBypassed(target, box.id, !box.bypassed))}
          >⏻</button
        >
        <button
          type="button"
          aria-label="Move {name} left"
          title="Move left"
          disabled={index === 0}
          onclick={() => session.runPresetEdit(moveBox(target, box.id, -1))}>◀</button
        >
        <button
          type="button"
          aria-label="Move {name} right"
          title="Move right"
          disabled={index === count - 1}
          onclick={() => session.runPresetEdit(moveBox(target, box.id, 1))}>▶</button
        >
        <button
          type="button"
          aria-label="Remove {name}"
          title="Remove"
          onclick={() => session.runPresetEdit(removeBox(target, box.id))}>✕</button
        >
      </div>
    {/if}
  </header>

  {#if descriptor}
    <div class="params">
      <div class="enums">
        {#each enumParams as param (param.id)}
          <div class="enum">
            <span class="param-label"
              >{#if automation.has(param.id)}<span class="mark" title={AUTOMATED} aria-hidden="true"
                  >●</span
                >{/if}{param.name}</span
            >
            {#if (param.steps?.length ?? 0) > MAX_SEGMENTS}
              <select
                class="param-select"
                aria-label={param.name}
                value={shown(param)}
                onchange={(event) =>
                  set(param, Number((event.currentTarget as HTMLSelectElement).value))}
              >
                {#each options(param) as option (option.value)}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            {:else}
              <Segmented
                label={param.name}
                options={options(param)}
                value={shown(param)}
                color="var(--c-blue)"
                onchange={(v) => set(param, v)}
              />
            {/if}
          </div>
        {/each}
      </div>
      <div class="knobs">
        {#each knobParams as param, i (param.id)}
          <Knob
            label={param.name}
            mark={automation.has(param.id) ? AUTOMATED : undefined}
            value={shown(param)}
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
    </div>
  {:else}
    <p class="placeholder">Unknown box type "{box.type}". It's skipped.</p>
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

  .bypassed .params {
    opacity: 0.4;
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  h3,
  .type {
    font-size: var(--text-m);
    font-weight: 800;
  }

  .type {
    padding: 0 var(--space-1);
    border: none;
    border-radius: var(--r-s);
    background: none;
    color: var(--ink);
    font-family: inherit;
    cursor: pointer;
  }

  .type:hover {
    background: var(--panel-sunken);
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

  .actions {
    display: flex;
    gap: 2px;
    margin-left: auto;
  }

  .actions button {
    position: relative;
    width: 24px;
    height: 24px;
    border-radius: var(--r-s);
    font-size: var(--text-xs);
    color: var(--ink-dim);
  }

  .actions button::after {
    content: '';
    position: absolute;
    inset: -8px -1px;
  }

  .actions button:hover:not(:disabled) {
    background: var(--panel-sunken);
    color: var(--ink);
  }

  .actions button:disabled {
    opacity: 0.3;
  }

  .actions .power {
    font-size: var(--text-s);
  }

  .actions .power.on {
    color: var(--c-green);
  }

  .params {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  /* Side by side (wrapping), so boxes with several selectors (SID) stay short. */
  .enums {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
  }

  .enum {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .mark {
    margin-right: 3px;
    color: var(--c-red);
  }

  .param-label {
    min-width: 36px;
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .param-select {
    height: 30px;
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--r-m);
    background: var(--panel-sunken);
    color: var(--ink);
    font: inherit;
    font-size: var(--text-s);
    font-weight: 600;
  }

  .knobs {
    display: flex;
    gap: var(--space-2);
  }
</style>
