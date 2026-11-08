<!--
  Bottom panel: the selected track's preset, or the piano roll of the clip being edited.
-->
<script lang="ts">
  import PianoRoll from '../piano-roll/PianoRoll.svelte';
  import { session } from '../state/session.svelte';
  import PresetEditor from './PresetEditor.svelte';

  const clipLabel = $derived.by(() => {
    const editing = session.editing;
    return editing ? editing.track.name : null;
  });
</script>

<section class="bottom-panel" aria-label="Editor">
  <div class="tabs" role="tablist" aria-label="Editor view">
    <button
      type="button"
      role="tab"
      aria-selected={session.bottomTab === 'preset'}
      onclick={() => (session.bottomTab = 'preset')}>Preset</button
    >
    <button
      type="button"
      role="tab"
      aria-label="Piano roll"
      aria-selected={session.bottomTab === 'pianoRoll'}
      onclick={() => {
        session.bottomTab = 'pianoRoll';
        session.focusArea = 'pianoRoll';
      }}
      >Piano roll{#if clipLabel}<span class="clip-label">· {clipLabel}</span>{/if}</button
    >
  </div>
  <div class="content">
    {#if session.bottomTab === 'preset'}
      <PresetEditor />
    {:else}
      <PianoRoll />
    {/if}
  </div>
</section>

<style>
  .bottom-panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--panel);
    border-top: 1px solid var(--line);
  }

  .tabs {
    display: flex;
    gap: 2px;
    padding: var(--space-1) var(--space-3) 0;
    border-bottom: 1px solid var(--line);
  }

  [role='tab'] {
    position: relative;
    height: 28px;
    padding: 0 var(--space-3);
    border-radius: var(--r-s) var(--r-s) 0 0;
    font-size: var(--text-s);
    font-weight: 700;
    color: var(--ink-dim);
  }

  [role='tab'][aria-selected='true'] {
    background: var(--panel-raised);
    color: var(--ink);
  }

  .clip-label {
    margin-left: var(--space-1);
    font-weight: 500;
    color: var(--ink-dim);
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .content > :global(*) {
    flex: 1;
    min-height: 0;
  }
</style>
