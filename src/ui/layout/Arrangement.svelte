<!--
  Center area. For now: one empty lane per track. The canvas timeline with clips,
  ruler and playhead arrives in Phase 2.
-->
<script lang="ts">
  import { session } from '../state/session.svelte';
  import { trackColor } from '../theme';

  const BARS = 16;
</script>

<section class="arrangement" aria-label="Arrangement">
  <div class="ruler" aria-hidden="true">
    <div class="header-spacer"></div>
    <div class="bars">
      {#each { length: BARS }, bar (bar)}
        <span>{bar + 1}</span>
      {/each}
    </div>
  </div>

  <div class="lanes">
    {#each session.project.tracks as track, i (track.id)}
      <button
        type="button"
        class="lane"
        class:selected={session.selectedTrackIndex === i}
        style:--color={trackColor(i)}
        aria-label="Select {track.name}"
        aria-pressed={session.selectedTrackIndex === i}
        onclick={() => session.selectTrack(i)}
      >
        <span class="lane-header">
          <span class="number">{i + 1}</span>
          <span class="name">{track.name}</span>
        </span>
        <span class="lane-body" style:--bars={BARS}></span>
      </button>
    {/each}
  </div>
</section>

<style>
  .arrangement {
    --header-width: 120px;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--screen);
    color: var(--screen-ink);
  }

  .ruler {
    display: flex;
    height: 24px;
    border-bottom: 1px solid var(--screen-line-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--screen-ink-dim);
  }

  .header-spacer {
    width: var(--header-width);
    flex-shrink: 0;
  }

  .bars {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(16, 1fr);
  }

  .bars span {
    padding: 5px 0 0 4px;
    border-left: 1px solid var(--screen-line-strong);
  }

  .lanes {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .lane {
    display: flex;
    flex: 1;
    min-height: 44px;
    max-height: 72px;
    text-align: left;
    border-bottom: 1px solid var(--screen-line);
  }

  .lane-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: var(--header-width);
    flex-shrink: 0;
    padding: 0 var(--space-3);
    border-left: 4px solid var(--color);
    background: var(--screen-raised);
  }

  .number {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color);
  }

  .name {
    font-size: var(--text-s);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lane-body {
    flex: 1;
    background-image: linear-gradient(to right, var(--screen-line) 1px, transparent 1px);
    background-size: calc(100% / var(--bars)) 100%;
  }

  .selected .lane-header {
    background: color-mix(in srgb, var(--color) 22%, var(--screen-raised));
  }

  .selected .lane-body {
    background-color: color-mix(in srgb, var(--color) 6%, transparent);
  }
</style>
