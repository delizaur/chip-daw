<!--
  Tracks sidebar: one compact mixer row per track (number, mute, solo, volume), each as tall as
  the track's lane in the arrangement and scrolled with it, so the rows line up side by side.
-->
<script lang="ts">
  import { setTrackMute, setTrackSolo, setTrackVolume } from '../../model/commands';
  import { LANE_HEIGHT, tracksTop } from '../arrangement/geometry';
  import Slider from '../controls/Slider.svelte';
  import Toggle from '../controls/Toggle.svelte';
  import { session } from '../state/session.svelte';
  import { trackColor } from '../theme';

  const percent = (v: number) => `${Math.round(v * 100)}%`;

  let list: HTMLDivElement | undefined = $state();

  // Follow scrolling done in the arrangement (they share session.trackScrollTop).
  $effect(() => {
    const top = session.trackScrollTop;
    if (list && Math.abs(list.scrollTop - top) >= 1) list.scrollTop = top;
  });
</script>

<aside
  class="right-sidebar"
  aria-label="Tracks"
  style:--lane-height="{LANE_HEIGHT}px"
  style:--head-height="{tracksTop(session.tempoLaneVisible)}px"
>
  <div
    class="list"
    bind:this={list}
    onscroll={() => {
      if (list) session.trackScrollTop = list.scrollTop;
    }}
  >
    <!-- Level with the ruler (and tempo lane) above the arrangement's lanes. -->
    <h2 class="head">Tracks</h2>
    <ul>
      {#each session.project.tracks as track, i (track.id)}
        <li class:selected={session.selectedTrackIndex === i} style:--color={trackColor(i)}>
          <button
            type="button"
            class="badge"
            aria-label="{track.name} mixer"
            aria-pressed={session.selectedTrackIndex === i}
            title="Select {track.name}"
            onclick={() => session.selectTrack(i)}>{i + 1}</button
          >
          <Toggle
            size="small"
            label="Mute {track.name}"
            color="var(--c-yellow)"
            pressed={track.mute}
            onchange={(mute) => session.run(setTrackMute(track.id, mute))}>M</Toggle
          >
          <Toggle
            size="small"
            label="Solo {track.name}"
            color="var(--c-blue)"
            pressed={track.solo}
            onchange={(solo) => session.run(setTrackSolo(track.id, solo))}>S</Toggle
          >
          <div class="volume">
            <Slider
              label="{track.name} volume"
              value={track.volume}
              defaultValue={0.8}
              color={trackColor(i)}
              format={percent}
              onstart={() => session.begin('Change track volume')}
              oninput={(v) => session.run(setTrackVolume(track.id, v))}
              onend={() => session.commit()}
            />
          </div>
        </li>
      {/each}
    </ul>
  </div>
</aside>

<style>
  .right-sidebar {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--panel);
    border-left: 1px solid var(--line);
  }

  /* Scrolls in step with the arrangement; its own scrollbar is hidden (the arrangement's shows). */
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .list::-webkit-scrollbar {
    display: none;
  }

  .head {
    display: flex;
    align-items: flex-start;
    height: var(--head-height);
    margin: 0;
    padding: 5px var(--space-3) 0;
    border-bottom: 1px solid var(--line);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* Same height and bottom line as a lane header in the arrangement. */
  li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--lane-height);
    padding: 0 var(--space-3) 0 var(--space-2);
    border-left: 4px solid var(--color);
    border-bottom: 1px solid var(--line);
  }

  li.selected {
    background: color-mix(in srgb, var(--color) 18%, var(--panel));
  }

  .badge {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border-radius: var(--r-s);
    background: var(--color);
    color: var(--ink-on-color);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .volume {
    flex: 1;
    min-width: 0;
    padding: 0 var(--space-1);
  }
</style>
