<!--
  Left sidebar: the preset library. Folders open and close; double-click a preset (or select
  it and press "Load") to put a copy on the selected track. Actions for the selected folder or
  preset are in the toolbar at the bottom.
-->
<script lang="ts">
  import { findPreset, presetsIn, sortedFolders } from '../../model/library';
  import { libraryStore as store } from '../state/library.svelte';
  import { session } from '../state/session.svelte';

  const library = $derived(store.library);
  const folders = $derived(sortedFolders(library));
  const looseFolder = $derived(presetsIn(library, null));
  const trackNumber = $derived(session.selectedTrackIndex + 1);
  /** The library preset the selected track's preset was loaded from, to mark it. */
  const loadedFrom = $derived(session.selectedTrackPreset?.libraryOrigin);
  const selectedPreset = $derived(
    store.selection?.kind === 'preset' ? findPreset(library, store.selection.id) : undefined,
  );
  const selectedFolder = $derived(
    store.selection?.kind === 'folder'
      ? library.folders.find((f) => f.id === store.selection!.id)
      : undefined,
  );

  /** Focuses and selects an input when it appears (inline rename). */
  function focusSelect(input: HTMLInputElement) {
    input.focus();
    input.select();
  }

  function renameKeys(event: KeyboardEvent, commit: (name: string) => void) {
    const input = event.currentTarget as HTMLInputElement;
    if (event.key === 'Enter') commit(input.value);
    else if (event.key === 'Escape') store.renaming = null;
  }
</script>

{#snippet presetRow(id: string, name: string, nested: boolean)}
  <div
    class="row preset"
    class:nested
    class:selected={store.selection?.kind === 'preset' && store.selection.id === id}
  >
    {#if store.renaming === id}
      <input
        class="rename"
        aria-label="Library preset name"
        value={name}
        use:focusSelect
        onkeydown={(e) => renameKeys(e, (n) => store.renamePreset(id, n))}
        onblur={(e) => store.renaming === id && store.renamePreset(id, e.currentTarget.value)}
      />
    {:else}
      <button
        type="button"
        class="name"
        title="Double-click to load onto Track {trackNumber}"
        onclick={() => store.select({ kind: 'preset', id })}
        ondblclick={() => store.loadToTrack(id)}
      >
        <span class="icon" aria-hidden="true">♪</span>
        <span class="label">{name}</span>
        {#if loadedFrom === id}<span class="loaded" title="On Track {trackNumber}">●</span>{/if}
      </button>
    {/if}
  </div>
{/snippet}

<aside class="library" aria-label="Preset library">
  <header>
    <h2 class="panel-title">Presets</h2>
    <div class="tools">
      <button
        type="button"
        class="tool"
        aria-label="New folder"
        title="New folder"
        onclick={() => store.newFolder()}>+ Folder</button
      >
      <button
        type="button"
        class="tool"
        aria-label="Import preset"
        title="Import a .chippreset file"
        onclick={() => store.importPreset()}>Import</button
      >
    </div>
  </header>

  <button type="button" class="save" onclick={() => store.saveToLibrary()}>
    Save Track {trackNumber} preset
  </button>

  <div class="tree" aria-label="Presets">
    {#each folders as folder (folder.id)}
      {@const open = store.expanded.has(folder.id)}
      <div
        class="row folder"
        class:selected={store.selection?.kind === 'folder' && store.selection.id === folder.id}
      >
        <button
          type="button"
          class="disclosure"
          aria-label="{open ? 'Close' : 'Open'} {folder.name}"
          aria-expanded={open}
          onclick={() => store.toggleFolder(folder.id)}>{open ? '▾' : '▸'}</button
        >
        {#if store.renaming === folder.id}
          <input
            class="rename"
            aria-label="Folder name"
            value={folder.name}
            use:focusSelect
            onkeydown={(e) => renameKeys(e, (n) => store.renameFolder(folder.id, n))}
            onblur={(e) =>
              store.renaming === folder.id && store.renameFolder(folder.id, e.currentTarget.value)}
          />
        {:else}
          <button
            type="button"
            class="name"
            onclick={() => store.select({ kind: 'folder', id: folder.id })}
            ondblclick={() => store.toggleFolder(folder.id)}
          >
            <span class="label">{folder.name}</span>
            <span class="count">{presetsIn(library, folder.id).length}</span>
          </button>
        {/if}
      </div>
      {#if open}
        {#each presetsIn(library, folder.id) as entry (entry.preset.id)}
          {@render presetRow(entry.preset.id, entry.preset.name, true)}
        {/each}
      {/if}
    {/each}
    {#each looseFolder as entry (entry.preset.id)}
      {@render presetRow(entry.preset.id, entry.preset.name, false)}
    {/each}
  </div>

  {#if selectedPreset}
    {@const id = selectedPreset.preset.id}
    <div class="actions" aria-label="Preset actions">
      <button type="button" class="primary" onclick={() => store.loadToTrack(id)}>
        Load to Track {trackNumber}
      </button>
      <div class="action-row">
        <button type="button" aria-label="Rename preset" onclick={() => (store.renaming = id)}
          >Rename</button
        >
        <button
          type="button"
          aria-label="Duplicate preset"
          onclick={() => store.duplicatePreset(id)}>Duplicate</button
        >
        <button
          type="button"
          aria-label="Export preset"
          onclick={() => store.exportLibraryPreset(id)}>Export</button
        >
        <button
          type="button"
          class="danger"
          aria-label="Delete preset"
          onclick={() => store.deletePreset(id)}>Delete</button
        >
      </div>
      <label class="move">
        <span>Folder</span>
        <select
          aria-label="Move to folder"
          value={selectedPreset.folderId ?? ''}
          onchange={(e) => store.movePreset(id, e.currentTarget.value || null)}
        >
          <option value="">(top level)</option>
          {#each folders as folder (folder.id)}
            <option value={folder.id}>{folder.name}</option>
          {/each}
        </select>
      </label>
    </div>
  {:else if selectedFolder}
    {@const id = selectedFolder.id}
    <div class="actions" aria-label="Folder actions">
      <div class="action-row">
        <button type="button" aria-label="Rename folder" onclick={() => (store.renaming = id)}
          >Rename</button
        >
        <button
          type="button"
          class="danger"
          title="Its presets move to the top level"
          onclick={() => store.deleteFolder(id)}>Delete folder</button
        >
      </div>
    </div>
  {/if}
</aside>

<style>
  .library {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
    padding: var(--space-4) var(--space-3);
    background: var(--panel);
    border-right: 1px solid var(--line);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-1);
  }

  .tools {
    display: flex;
    gap: 2px;
  }

  .tool {
    position: relative;
    height: 24px;
    padding: 0 var(--space-2);
    border-radius: var(--r-s);
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--ink-dim);
  }

  .tool::after {
    content: '';
    position: absolute;
    inset: -8px 0;
  }

  .tool:hover {
    background: var(--panel-sunken);
    color: var(--ink);
  }

  .save {
    height: 32px;
    border: 1px dashed var(--ink-dim);
    border-radius: var(--r-m);
    font-size: var(--text-s);
    font-weight: 600;
    color: var(--ink-dim);
  }

  .save:hover {
    border-color: var(--ink);
    color: var(--ink);
  }

  .tree {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .row {
    display: flex;
    align-items: center;
    min-height: 30px;
    border-radius: var(--r-s);
  }

  .row.selected {
    background: var(--panel-sunken);
  }

  .row.nested {
    padding-left: 20px;
  }

  .disclosure {
    width: 20px;
    height: 30px;
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--ink-dim);
  }

  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 30px;
    padding: 0 var(--space-2);
    text-align: left;
    font-size: var(--text-s);
  }

  .folder .name {
    font-weight: 700;
  }

  .preset:not(.nested) .name {
    padding-left: var(--space-2);
  }

  .icon {
    color: var(--ink-dim);
    font-size: var(--text-xs);
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--ink-dim);
  }

  .loaded {
    font-size: 8px;
    color: var(--c-green);
  }

  .rename {
    flex: 1;
    min-width: 0;
    height: 26px;
    margin: 0 var(--space-1);
    padding: 0 var(--space-2);
    border: 1px solid var(--focus);
    border-radius: var(--r-s);
    background: var(--panel-raised);
    color: var(--ink);
    font: inherit;
    font-size: var(--text-s);
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--line);
  }

  .action-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .actions button {
    height: 28px;
    padding: 0 var(--space-2);
    border-radius: var(--r-s);
    background: var(--panel-raised);
    box-shadow: var(--shadow-raised);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .actions .primary {
    height: 32px;
    background: var(--c-blue);
    color: var(--ink-on-color);
    font-size: var(--text-s);
  }

  .actions .danger {
    color: var(--c-red);
  }

  .move {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--ink-dim);
  }

  .move select {
    flex: 1;
    min-width: 0;
    height: 26px;
    border: none;
    border-radius: var(--r-s);
    background: var(--panel-sunken);
    color: var(--ink);
    font: inherit;
    font-size: var(--text-xs);
  }
</style>
