<!--
  Bottom panel: a preset as a chain of boxes, left to right: sequencers → synth → effects, with
  "add" menus at both ends. It shows the clip preset when clips on the selected track are
  selected, otherwise the track preset (see session.presetView). The header always says which
  one it is and how many clips use it; for a clip preset it has the clip preset buttons.
-->
<script lang="ts">
  import { addBox, renamePreset } from '../../model/chain-commands';
  import { boxDescriptorsOfKind, createBox } from '../../model/boxes/registry';
  import { libraryStore } from '../state/library.svelte';
  import { session } from '../state/session.svelte';
  import { trackColor } from '../theme';
  import BoxPanel from './BoxPanel.svelte';

  const view = $derived(session.presetView);
  /** Automation of the clips on this track that play with the shown preset. */
  const curves = $derived(
    view && view.kind !== 'mixed' ? session.automationCurves(view.track, view.preset) : [],
  );
  const sequencerTypes = boxDescriptorsOfKind('sequencer');
  const effectTypes = boxDescriptorsOfKind('effect');

  const clips = (n: number) => (n === 1 ? '1 clip' : `${n} clips`);

  /** "Add" menus: add the chosen box type, then reset the menu to its label. */
  function add(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    if (view && view.kind !== 'mixed' && select.value) {
      session.runPresetEdit(addBox(view.target, createBox(select.value)));
    }
    select.value = '';
  }
</script>

<section
  class="preset-editor"
  aria-label="Preset editor"
  style:--color={trackColor(view?.trackIndex ?? 0)}
>
  {#if view}
    <header>
      <span class="badge" class:clip={view.kind !== 'track'}>{view.trackIndex + 1}</span>
      <div class="titles">
        {#if view.kind === 'mixed'}
          <span class="mixed-title">{clips(view.clipIds.length)}</span>
          <span class="kind">Different clip presets</span>
        {:else}
          <input
            class="preset-name"
            aria-label="Preset name"
            value={view.preset.name}
            onchange={(e) =>
              session.runPresetEdit(renamePreset(view.target, e.currentTarget.value))}
            onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          {#if view.kind === 'track'}
            <span class="kind">{view.track.name} preset</span>
            <span class="usage" title="New recordings use the track preset">
              {view.clipCount > 0
                ? `Also on ${clips(view.clipCount)}; edits make a copy`
                : 'Played live and recorded'}
            </span>
          {:else}
            <span class="kind">Clip preset</span>
            <span class="usage">
              {view.clipCount === 1
                ? 'Only this clip'
                : `Used by ${clips(view.clipCount)}`}{view.isTrackPreset
                ? ` and ${view.track.name}`
                : ''}
            </span>
          {/if}
        {/if}

        {#if session.recordingKnobs && view.kind !== 'mixed'}
          <span class="recording" title="They become automation in the recorded clip"
            >● Recording knob moves</span
          >
        {/if}

        {#if view.kind !== 'track'}
          <div class="actions clip-actions">
            {#if view.kind === 'clip'}
              <button
                type="button"
                disabled={!view.canMakeUnique}
                title={view.canMakeUnique
                  ? 'Give the selected clips their own copy, so edits only change them'
                  : 'Nothing else uses this preset'}
                onclick={() => session.makeSelectedClipsUnique()}>Make unique</button
              >
            {/if}
            <button
              type="button"
              disabled={view.kind === 'clip' && view.isTrackPreset}
              title="Play the selected clips with the {view.track.name} preset"
              onclick={() => session.useTrackPresetForSelectedClips()}>Use track preset</button
            >
            {#if view.kind === 'clip'}
              <button
                type="button"
                disabled={view.isTrackPreset}
                title={view.isTrackPreset
                  ? `This is already the ${view.track.name} preset`
                  : `Play and record on ${view.track.name} with this preset`}
                onclick={() => session.loadSelectedClipPresetToTrack()}>Load to track</button
              >
            {/if}
          </div>
        {/if}

        {#if view.kind !== 'mixed'}
          <div class="actions">
            <button
              type="button"
              title="Save a copy of this preset in the library"
              onclick={() => libraryStore.saveToLibrary(view.preset)}>Save to library</button
            >
            <button
              type="button"
              aria-label="Export {view.kind === 'track' ? 'track' : 'clip'} preset"
              title="Export this preset as a .chippreset file"
              onclick={() => libraryStore.exportPreset(view.preset)}>Export</button
            >
          </div>
        {/if}

        {#if view.kind !== 'track'}
          <button
            type="button"
            class="back"
            aria-label="Show track preset"
            title="Deselect the clips and show the {view.track.name} preset"
            onclick={() => session.showTrackPreset()}>← {view.track.name} preset</button
          >
        {/if}
      </div>
    </header>

    {#if view.kind === 'mixed'}
      <p class="mixed-note">
        The selected clips use different presets. Select one clip to edit its preset, or use the
        {view.track.name} preset for all of them.
      </p>
    {:else}
      <div class="chain">
        <select class="add" aria-label="Add sequencer" onchange={add}>
          <option value="">+ Sequencer</option>
          {#each sequencerTypes as type (type.type)}
            <option value={type.type}>{type.name}</option>
          {/each}
        </select>
        {#each view.preset.sequencers as box, i (box.id)}
          <BoxPanel
            {box}
            {curves}
            target={view.target}
            index={i}
            count={view.preset.sequencers.length}
          />
          <span class="arrow" aria-hidden="true">→</span>
        {/each}
        <BoxPanel box={view.preset.synth} {curves} target={view.target} index={0} count={1} />
        {#each view.preset.effects as box, i (box.id)}
          <span class="arrow" aria-hidden="true">→</span>
          <BoxPanel
            {box}
            {curves}
            target={view.target}
            index={i}
            count={view.preset.effects.length}
          />
        {/each}
        <select class="add" aria-label="Add effect" onchange={add}>
          <option value="">+ Effect</option>
          {#each effectTypes as type (type.type)}
            <option value={type.type}>{type.name}</option>
          {/each}
        </select>
      </div>
    {/if}
  {/if}
</section>

<style>
  .preset-editor {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-4);
    overflow: auto;
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    width: 176px;
    flex-shrink: 0;
  }

  .badge {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border: 2px solid var(--color);
    border-radius: var(--r-s);
    background: var(--color);
    color: var(--ink-on-color);
    font-family: var(--font-mono);
    font-size: var(--text-s);
    font-weight: 700;
  }

  /* A clip preset: outlined, like a clip on the timeline. */
  .badge.clip {
    background: color-mix(in srgb, var(--color) 25%, transparent);
    color: var(--ink);
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .preset-name {
    width: 100%;
    padding: 2px var(--space-1);
    margin-left: calc(-1 * var(--space-1));
    border: 1px solid transparent;
    border-radius: var(--r-s);
    background: none;
    color: var(--ink);
    font: inherit;
    font-size: var(--text-m);
    font-weight: 800;
    text-overflow: ellipsis;
  }

  .preset-name:hover {
    border-color: var(--line);
  }

  .preset-name:focus {
    border-color: var(--focus);
    background: var(--panel-raised);
    outline: none;
  }

  .mixed-title {
    font-size: var(--text-m);
    font-weight: 800;
  }

  .kind {
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color);
  }

  .usage {
    font-size: var(--text-xs);
    color: var(--ink-dim);
  }

  .recording {
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--c-red);
  }

  .actions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    margin-top: var(--space-2);
  }

  .actions button,
  .back {
    padding: 2px 0;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--ink-dim);
    text-align: left;
  }

  .clip-actions button {
    color: var(--ink);
  }

  .actions button:hover:not(:disabled),
  .back:hover {
    color: var(--ink);
    text-decoration: underline;
  }

  .actions button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .back {
    margin-top: var(--space-2);
  }

  .mixed-note {
    max-width: 360px;
    margin: 0;
    align-self: center;
    font-size: var(--text-s);
    color: var(--ink-dim);
  }

  .chain {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    /* Room after the last item when scrolled all the way right. */
    padding-right: var(--space-4);
  }

  .add {
    align-self: center;
    height: 32px;
    padding: 0 var(--space-3);
    border: 1px dashed var(--ink-dim);
    border-radius: var(--r-m);
    background: none;
    color: var(--ink-dim);
    font: inherit;
    font-size: var(--text-s);
    font-weight: 600;
    cursor: pointer;
  }

  .add:hover {
    color: var(--ink);
    border-color: var(--ink);
  }

  .arrow {
    align-self: center;
    color: var(--ink-dim);
  }
</style>
