<!--
  Bottom panel: the selected track's preset as a chain of boxes, left to right:
  sequencers → synth → effects, with "add" menus at both ends. It edits the track's first
  segment (preset walls arrive in Phase 4).
-->
<script lang="ts">
  import { addBox, renameTrackPreset } from '../../model/chain-commands';
  import { boxDescriptorsOfKind, createBox } from '../../model/boxes/registry';
  import { libraryStore } from '../state/library.svelte';
  import { session } from '../state/session.svelte';
  import { trackColor } from '../theme';
  import BoxPanel from './BoxPanel.svelte';

  const index = $derived(session.selectedTrackIndex);
  const track = $derived(session.selectedTrack);
  const segment = $derived(track?.segments[0]);
  const address = $derived(track && segment ? { trackId: track.id, segmentId: segment.id } : null);
  const sequencerTypes = boxDescriptorsOfKind('sequencer');
  const effectTypes = boxDescriptorsOfKind('effect');

  /** "Add" menus: add the chosen box type, then reset the menu to its label. */
  function add(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    if (address && select.value) session.run(addBox(address, createBox(select.value)));
    select.value = '';
  }
</script>

<section class="preset-editor" aria-label="Preset editor" style:--color={trackColor(index)}>
  {#if track && segment}
    <header>
      <span class="badge">{index + 1}</span>
      <div class="titles">
        <input
          class="preset-name"
          aria-label="Preset name"
          value={segment.preset.name}
          onchange={(e) =>
            address && session.run(renameTrackPreset(address, e.currentTarget.value))}
          onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <span class="track-name">{track.name}</span>
        <div class="preset-actions">
          <button
            type="button"
            title="Save a copy of this preset in the library"
            onclick={() => libraryStore.saveTrackPreset()}>Save to library</button
          >
          <button
            type="button"
            aria-label="Export track preset"
            title="Export this preset as a .chippreset file"
            onclick={() => libraryStore.exportPreset()}>Export</button
          >
        </div>
      </div>
    </header>
    <div class="chain">
      <select class="add" aria-label="Add sequencer" onchange={add}>
        <option value="">+ Sequencer</option>
        {#each sequencerTypes as type (type.type)}
          <option value={type.type}>{type.name}</option>
        {/each}
      </select>
      {#each segment.preset.sequencers as box, i (box.id)}
        <BoxPanel {box} segment={address!} index={i} count={segment.preset.sequencers.length} />
        <span class="arrow" aria-hidden="true">→</span>
      {/each}
      <BoxPanel box={segment.preset.synth} segment={address!} index={0} count={1} />
      {#each segment.preset.effects as box, i (box.id)}
        <span class="arrow" aria-hidden="true">→</span>
        <BoxPanel {box} segment={address!} index={i} count={segment.preset.effects.length} />
      {/each}
      <select class="add" aria-label="Add effect" onchange={add}>
        <option value="">+ Effect</option>
        {#each effectTypes as type (type.type)}
          <option value={type.type}>{type.name}</option>
        {/each}
      </select>
    </div>
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
    width: 160px;
    flex-shrink: 0;
  }

  .badge {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: var(--r-s);
    background: var(--color);
    color: var(--ink-on-color);
    font-family: var(--font-mono);
    font-size: var(--text-s);
    font-weight: 700;
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

  .preset-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    margin-top: var(--space-2);
  }

  .preset-actions button {
    padding: 2px 0;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--ink-dim);
  }

  .preset-actions button:hover {
    color: var(--ink);
    text-decoration: underline;
  }

  .track-name {
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
