<script lang="ts">
  import { setMasterVolume } from '../../model/commands';
  import Knob from '../controls/Knob.svelte';
  import { session } from '../state/session.svelte';

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl+';

  const audioText = $derived(
    {
      off: 'Audio off · click to start',
      starting: 'Starting audio…',
      running: 'Audio on',
      error: 'Audio unavailable',
    }[session.audioStatus],
  );

  const percent = (v: number) => `${Math.round(v * 100)}%`;
</script>

<header class="top-bar">
  <div class="brand" aria-label="chip-daw">
    <span class="dot" style:background="var(--c-blue)"></span>
    <span class="dot" style:background="var(--c-green)"></span>
    <span class="dot" style:background="var(--c-orange)"></span>
    <span class="wordmark">chip</span>
  </div>

  <button
    type="button"
    class="audio-status {session.audioStatus}"
    title={session.audioError ?? undefined}
    onclick={() => session.startAudio()}
  >
    <span class="led"></span>
    {audioText}
  </button>

  <div class="group">
    <button
      type="button"
      class="icon-button"
      disabled={!session.undoLabel}
      title={session.undoLabel ? `Undo ${session.undoLabel} (${mod}Z)` : 'Nothing to undo'}
      aria-label="Undo"
      onclick={() => session.undo()}
    >
      ↶
    </button>
    <button
      type="button"
      class="icon-button"
      disabled={!session.redoLabel}
      title={session.redoLabel ? `Redo ${session.redoLabel} (${mod}Shift+Z)` : 'Nothing to redo'}
      aria-label="Redo"
      onclick={() => session.redo()}
    >
      ↷
    </button>
  </div>

  <div class="spacer"></div>

  <div class="master">
    <div class="meter" aria-hidden="true">
      <div class="meter-fill" style:--level={Math.min(1, session.masterPeak)}></div>
    </div>
    <Knob
      label="Master"
      value={session.project.masterVolume}
      defaultValue={0.8}
      color="var(--c-orange)"
      size={40}
      format={percent}
      onstart={() => session.begin('Change master volume')}
      oninput={(v) => session.run(setMasterVolume(v))}
      onend={() => session.commit()}
    />
  </div>
</header>

<style>
  .top-bar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .wordmark {
    margin-left: var(--space-2);
    font-size: var(--text-l);
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .audio-status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 32px;
    padding: 0 var(--space-3);
    border-radius: var(--r-pill);
    background: var(--panel-sunken);
    font-size: var(--text-s);
    font-weight: 600;
    color: var(--ink-dim);
  }

  .led {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c-grey);
  }

  .running .led {
    background: var(--c-green);
    box-shadow: 0 0 6px var(--c-green);
  }

  .starting .led {
    background: var(--c-yellow);
  }

  .error .led {
    background: var(--c-red);
  }

  .group {
    display: flex;
    gap: var(--space-1);
  }

  .icon-button {
    width: var(--hit);
    height: var(--hit);
    border-radius: var(--r-s);
    font-size: var(--text-l);
    color: var(--ink);
  }

  .icon-button:hover:not(:disabled) {
    background: var(--panel-sunken);
  }

  .icon-button:disabled {
    color: var(--ink-dim);
    opacity: 0.4;
  }

  .spacer {
    flex: 1;
  }

  .master {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .meter {
    width: 8px;
    height: 56px;
    border-radius: var(--r-pill);
    background: var(--panel-sunken);
    overflow: hidden;
    display: flex;
    align-items: flex-end;
  }

  .meter-fill {
    width: 100%;
    height: calc(var(--level) * 100%);
    background: var(--c-green);
    transition: height 60ms linear;
  }
</style>
