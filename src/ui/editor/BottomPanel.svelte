<!--
  Bottom panel: the selected track's preset, or the piano roll of the clip being edited.
-->
<script lang="ts">
  import PianoRoll from '../piano-roll/PianoRoll.svelte';
  import { session } from '../state/session.svelte';
  import PresetEditor from './PresetEditor.svelte';
  import { BOTTOM_MIN_HEIGHT } from '../state/session.svelte';

  /** Drag the top edge to resize: the panel's height at the start, and where the drag began. */
  let resize: { pointerId: number; startY: number; startHeight: number } | null = null;
  let panel: HTMLElement | undefined = $state();

  function onpointerdown(event: PointerEvent) {
    if (event.button !== 0 || !panel) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    resize = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: panel.getBoundingClientRect().height,
    };
  }

  function onpointermove(event: PointerEvent) {
    if (!resize || event.pointerId !== resize.pointerId) return;
    // Dragging up makes the panel taller.
    session.setBottomHeight(resize.startHeight + resize.startY - event.clientY);
  }

  function onpointerup(event: PointerEvent) {
    if (resize?.pointerId === event.pointerId) resize = null;
  }

  function onkeydown(event: KeyboardEvent) {
    const step = event.shiftKey ? 64 : 16;
    const current = panel?.getBoundingClientRect().height ?? session.bottomHeight;
    if (event.key === 'ArrowUp') session.setBottomHeight(current + step);
    else if (event.key === 'ArrowDown') session.setBottomHeight(current - step);
    else if (event.key === 'Home') session.setBottomHeight(BOTTOM_MIN_HEIGHT);
    else return;
    event.preventDefault();
  }

  const clipLabel = $derived.by(() => {
    const editing = session.editing;
    return editing ? editing.track.name : null;
  });
</script>

<section class="bottom-panel" aria-label="Editor" bind:this={panel}>
  <!-- A focusable separator is ARIA's resize handle ("splitter"), which Svelte's checks
       don't know is interactive. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="resize"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Resize editor"
    aria-valuemin={BOTTOM_MIN_HEIGHT}
    aria-valuenow={session.bottomHeight}
    title="Drag to resize · double-click to reset"
    tabindex="0"
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    onpointercancel={onpointerup}
    ondblclick={() => session.setBottomHeight(BOTTOM_MIN_HEIGHT)}
    {onkeydown}
  ></div>
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
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--panel);
    border-top: 1px solid var(--line);
  }

  /* The resize handle: a strip over the panel's top edge (a little above and below it). */
  .resize {
    position: absolute;
    top: -4px;
    left: 0;
    right: 0;
    z-index: 3;
    height: 8px;
    cursor: row-resize;
    touch-action: none;
  }

  .resize:hover,
  .resize:focus-visible {
    background: linear-gradient(
      transparent 3px,
      var(--accent) 3px,
      var(--accent) 5px,
      transparent 5px
    );
    outline: none;
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
    font-weight: 500;
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
