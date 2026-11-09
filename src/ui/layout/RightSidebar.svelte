<script lang="ts">
  import { setTrackMute, setTrackSolo, setTrackVolume } from '../../model/commands';
  import Slider from '../controls/Slider.svelte';
  import Toggle from '../controls/Toggle.svelte';
  import { session } from '../state/session.svelte';
  import { trackColor } from '../theme';

  const percent = (v: number) => `${Math.round(v * 100)}%`;
</script>

<aside class="right-sidebar" aria-label="Tracks">
  <h2 class="panel-title">Tracks</h2>
  <ul>
    {#each session.project.tracks as track, i (track.id)}
      <li class:selected={session.selectedTrackIndex === i} style:--color={trackColor(i)}>
        <button type="button" class="track-info" onclick={() => session.selectTrack(i)}>
          <span class="badge">{i + 1}</span>
          <span class="text">
            <span class="name">{track.name}</span>
            <span class="preset"
              >{session.project.presets.find((p) => p.id === track.presetId)?.name ?? '—'}</span
            >
          </span>
        </button>
        <div class="controls">
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
        </div>
      </li>
    {/each}
  </ul>
</aside>

<style>
  .right-sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--panel);
    border-left: 1px solid var(--line);
    overflow-y: auto;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  li {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--r-m);
    background: var(--panel-raised);
    box-shadow: var(--shadow-raised);
    border: 2px solid transparent;
  }

  li.selected {
    border-color: var(--color);
  }

  .track-info {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-align: left;
    min-height: 32px;
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
    font-weight: 700;
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    font-size: var(--text-s);
    font-weight: 700;
  }

  .preset {
    font-size: var(--text-xs);
    color: var(--ink-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .volume {
    flex: 1;
    padding: 0 var(--space-1);
  }
</style>
