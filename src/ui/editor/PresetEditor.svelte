<!--
  Bottom panel: the selected track's preset as a chain of boxes, left to right:
  sequencers → synth → effects. Phase 1 has no transport, so it edits the track's first segment.
-->
<script lang="ts">
  import { session } from '../state/session.svelte';
  import { trackColor } from '../theme';
  import BoxPanel from './BoxPanel.svelte';

  const index = $derived(session.selectedTrackIndex);
  const track = $derived(session.selectedTrack);
  const segment = $derived(track?.segments[0]);
  const boxes = $derived(
    segment ? [...segment.preset.sequencers, segment.preset.synth, ...segment.preset.effects] : [],
  );
</script>

<section class="preset-editor" aria-label="Preset editor" style:--color={trackColor(index)}>
  {#if track && segment}
    <header>
      <span class="badge">{index + 1}</span>
      <div class="titles">
        <h2>{segment.preset.name}</h2>
        <span class="track-name">{track.name}</span>
      </div>
    </header>
    <div class="chain">
      {#each boxes as box, i (box.id)}
        {#if i > 0}<span class="arrow" aria-hidden="true">→</span>{/if}
        <BoxPanel {box} address={{ trackId: track.id, segmentId: segment.id, boxId: box.id }} />
      {/each}
    </div>
  {/if}
</section>

<style>
  .preset-editor {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-4);
    background: var(--panel);
    border-top: 1px solid var(--line);
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

  h2 {
    font-size: var(--text-m);
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .track-name {
    font-size: var(--text-s);
    color: var(--ink-dim);
  }

  .chain {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .arrow {
    align-self: center;
    color: var(--ink-dim);
  }
</style>
