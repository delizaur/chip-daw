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
  import AlgorithmScreen from './AlgorithmScreen.svelte';
  import EffectScreen from './EffectScreen.svelte';
  import KitScreen from './KitScreen.svelte';
  import NoteScreen from './NoteScreen.svelte';
  import SynthScreen from './SynthScreen.svelte';
  import { waveIcon } from './synth-visuals';

  interface Props {
    box: BoxInstance;
    /** The preset the box is in: the track preset (copy on write) or a clip preset. */
    target: PresetTarget;
    /** Automation of the clips playing with that preset on the track (moves the knobs). */
    curves?: readonly AutomationCurve[];
    /** Position within its list (sequencers or effects) and the list's length; synth: 0 of 1. */
    index: number;
    count: number;
    /** The track it plays on (its notes light up the drum synth's keys). */
    trackId?: string;
  }

  let { box, target, index, count, curves = [], trackId }: Props = $props();

  /** Knob colors cycle like the OP-1's four encoders. */
  const KNOB_COLORS = ['var(--c-blue)', 'var(--c-green)', 'var(--c-pink)', 'var(--c-orange)'];
  /** Enum params with more options than this get a dropdown instead of a button row. */
  const MAX_SEGMENTS = 6;

  const descriptor = $derived(getBoxDescriptor(box.type));
  const name = $derived(descriptor?.name ?? box.type);
  const isSynth = $derived(descriptor?.kind === 'synth');
  const alternatives = $derived(descriptor ? boxDescriptorsOfKind(descriptor.kind) : []);
  /**
   * The params by section ("Osc", "Filter"...), in the order they first appear. A box without
   * groups is one untitled section. Each has its selectors (enums) and its knobs.
   */
  const sections = $derived.by(() => {
    const result: { title?: string; enums: ParamDescriptor[]; knobs: ParamDescriptor[] }[] = [];
    for (const param of descriptor?.params ?? []) {
      let section = result.find((s) => s.title === param.group);
      if (!section) result.push((section = { title: param.group, enums: [], knobs: [] }));
      (param.steps && param.control !== 'knob' ? section.enums : section.knobs).push(param);
    }
    return result;
  });
  const grouped = $derived(sections.some((s) => s.title !== undefined));
  const address = $derived({ target, boxId: box.id });

  const options = (param: ParamDescriptor) =>
    (param.steps ?? []).map((label, i) => {
      const value = param.min + i * (param.step ?? 1);
      return { value, label, icon: waveIcon(box.type, param.id, value) };
    });

  /**
   * The envelope knobs have the same colors on every synth (attack blue, decay green, sustain
   * pink, release orange), matching the stages on the synth screen; the rest cycle. Matched by
   * the end of the id too (an operator's "op2Decay").
   */
  const ENVELOPE_COLORS: Record<string, string> = {
    attack: 'var(--c-blue)',
    decay: 'var(--c-green)',
    sustain: 'var(--c-pink)',
    release: 'var(--c-orange)',
  };
  /** Knob `i` of its section: colors cycle within each section, like a bank of encoders. */
  const knobColor = (param: ParamDescriptor, i: number) =>
    ENVELOPE_COLORS[envelopeStage(param.id) ?? ''] ?? KNOB_COLORS[i % KNOB_COLORS.length]!;

  /** The envelope stage a param sets ("attack", "op2Attack" → attack), if any. */
  function envelopeStage(id: string): string | undefined {
    const match = /^(?:attack|decay|sustain|release)$|(Attack|Decay|Sustain|Release)$/.exec(id);
    return match ? (match[1] ?? match[0]).toLowerCase() : undefined;
  }

  /**
   * The envelope a section's knobs set, for its strip: the ids of its attack, decay and
   * sustain (release is the synth's shared one), or undefined if it has none.
   */
  function sectionEnvelope(knobs: readonly ParamDescriptor[]) {
    const attack = knobs.find((p) => envelopeStage(p.id) === 'attack')?.id;
    if (!attack) return undefined;
    const prefix = attack.slice(0, attack.length - 'attack'.length);
    const name = (stage: string) =>
      prefix ? `${prefix}${stage[0]!.toUpperCase()}${stage.slice(1)}` : stage;
    return { attack, decay: name('decay'), sustain: name('sustain'), release: 'release' };
  }
  /** Param id → its knob's color: the screens draw each envelope stage (etc.) in it. */
  const knobColors = $derived(
    new Map(sections.flatMap((s) => s.knobs.map((p, i) => [p.id, knobColor(p, i)] as const))),
  );

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

  /** The box as its controls show it (recorded or automated moves included), for the screen. */
  const shownBox = $derived(
    descriptor
      ? { ...box, params: Object.fromEntries(descriptor.params.map((p) => [p.id, shown(p)])) }
      : box,
  );
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
    <div class="body" class:stacked={!grouped}>
      {#if box.type === 'synth.drums'}
        <KitScreen lit={trackId ? session.litNotes.get(trackId) : undefined} />
      {:else if box.type === 'synth.fm4'}
        <AlgorithmScreen box={shownBox} />
      {:else if box.type === 'synth.pluck'}
        <NoteScreen box={shownBox} />
      {:else if isSynth && grouped}
        <!-- The envelope is drawn in its own section (see below); no wave screen. -->
      {:else if isSynth}
        <SynthScreen box={shownBox} colors={knobColors} />
      {:else}
        <EffectScreen box={shownBox} colors={knobColors} />
      {/if}
      <div class="params" class:grouped>
        {#each sections as section (section.title ?? '')}
          {@const envelopeIds = isSynth && grouped ? sectionEnvelope(section.knobs) : undefined}
          <section class="section" aria-label={section.title}>
            {#if section.title}<h4 class="section-title">{section.title}</h4>{/if}
            {#if envelopeIds}
              <SynthScreen box={shownBox} colors={knobColors} compact ids={envelopeIds} />
            {/if}
            {#if section.enums.length}
              <div class="enums">
                {#each section.enums as param (param.id)}
                  <div class="enum">
                    <span class="param-label"
                      >{#if automation.has(param.id)}<span
                          class="mark"
                          title={AUTOMATED}
                          aria-hidden="true">●</span
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
                        size="small"
                        onchange={(v) => set(param, v)}
                      />
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
            <div class="knobs">
              {#each section.knobs as param, i (param.id)}
                <Knob
                  label={param.name}
                  mark={automation.has(param.id) ? AUTOMATED : undefined}
                  value={shown(param)}
                  min={param.min}
                  max={param.max}
                  defaultValue={param.default}
                  step={param.step}
                  scale={param.scale}
                  color={knobColor(param, i)}
                  size={38}
                  format={(v) => formatParam(param, v)}
                  onstart={() => session.begin(`Change ${param.name}`)}
                  oninput={(v) => set(param, v)}
                  onend={() => session.commit()}
                />
              {/each}
            </div>
          </section>
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
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3);
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
    font-weight: 600;
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
    font-weight: 500;
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

  .body {
    display: flex;
    gap: var(--space-4);
  }

  /* Boxes without sections: the screen on top, the controls under it. As wide as the knob
     row (min-content): the selectors wrap under each other rather than widen the box. */
  .body.stacked {
    flex-direction: column;
    gap: var(--space-2);
    width: min-content;
  }

  .stacked .params {
    flex-direction: column;
    gap: var(--space-2);
  }

  .stacked .knobs {
    flex-wrap: nowrap;
  }

  .params {
    display: flex;
    gap: var(--space-4);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  /* Grouped boxes: sections two to a column (in the order the box lists them), split by
     hairlines; each a row of selectors over a row of knobs. */
  .params.grouped {
    display: grid;
    grid-template-rows: auto auto;
    grid-auto-flow: column;
    gap: var(--space-3) var(--space-4);
  }

  .params.grouped {
    row-gap: var(--space-2);
  }

  .grouped .section {
    gap: var(--space-1);
  }

  .grouped .section:nth-child(n + 3) {
    padding-left: var(--space-4);
    border-left: 1px solid var(--line);
  }

  .grouped .section:nth-child(even) {
    padding-top: var(--space-2);
    border-top: 1px solid var(--line);
  }

  .grouped .enums {
    flex-wrap: nowrap;
  }

  /* Knob rows line up across sections, with or without selectors above them. */
  .grouped .knobs {
    margin-top: auto;
  }

  .section-title {
    font-size: var(--text-xs);
    line-height: 1.2;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-dim);
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
    font-weight: 500;
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
    font-weight: 500;
  }

  .knobs {
    display: flex;
    gap: var(--space-2);
  }
</style>
