<script lang="ts">
  import { setMasterVolume } from '../../model/commands';
  import MeterFader from '../controls/MeterFader.svelte';
  import { noteName } from '../input/computer-keyboard';
  import { session } from '../state/session.svelte';
  import MidiSelect from './MidiSelect.svelte';
  import Transport from './Transport.svelte';

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
</script>

<header class="top-bar">
  <div class="brand" aria-label="chip-daw">
    <span class="dot" style:background="var(--c-blue)"></span>
    <span class="dot" style:background="var(--c-green)"></span>
    <span class="dot" style:background="var(--c-orange)"></span>
    <span class="wordmark">chip</span>
  </div>

  <div class="file">
    <span class="project-name" title="Project name (set when you export or import)"
      >{session.project.name}</span
    >
    <button
      type="button"
      class="text-button"
      title="New project"
      onclick={() => session.newProject()}>New</button
    >
    <button
      type="button"
      class="text-button"
      title="Import a .chip project ({mod}O)"
      onclick={() => session.importProject()}>Import</button
    >
    <button
      type="button"
      class="text-button"
      title="Export this project as a .chip file ({mod}S)"
      onclick={() => session.exportProject()}>Export</button
    >
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

  <Transport />

  <div class="spacer"></div>

  <MidiSelect />
  <span
    class="keys"
    title="Computer keyboard: A–; play notes on the selected track, Z/X octave, C/V velocity"
  >
    <span aria-hidden="true">⌨</span>
    {noteName((session.keyboardOctave + 1) * 12)} · vel {session.keyboardVelocity}
  </span>

  {#if session.notice}
    <div class="notice {session.notice.kind}" role="status">{session.notice.text}</div>
  {/if}

  <MeterFader
    label="Master"
    value={session.project.masterVolume}
    level={session.masterPeak}
    defaultValue={0.8}
    onstart={() => session.begin('Change master volume')}
    oninput={(v) => session.run(setMasterVolume(v))}
    onend={() => session.commit()}
  />
</header>

<style>
  .top-bar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: 44px;
    padding: 0 var(--space-4);
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }

  .file {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .project-name {
    max-width: 140px;
    margin-right: var(--space-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-s);
    font-weight: 600;
    color: var(--ink-dim);
  }

  .text-button {
    position: relative;
    height: 26px;
    padding: 0 var(--space-2);
    border-radius: var(--r-s);
    font-size: var(--text-s);
    font-weight: 600;
    color: var(--ink);
  }

  .text-button::after {
    content: '';
    position: absolute;
    inset: -7px 0;
  }

  .text-button:hover {
    background: var(--panel-sunken);
  }

  .notice {
    position: fixed;
    top: 52px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    max-width: min(560px, calc(100vw - 32px));
    padding: var(--space-2) var(--space-4);
    border-radius: var(--r-m);
    background: var(--panel-raised);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.35);
    font-size: var(--text-s);
    color: var(--ink);
  }

  .notice.error {
    background: var(--c-red);
    color: var(--ink-on-color);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }

  .wordmark {
    margin-left: var(--space-2);
    font-size: var(--text-m);
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .audio-status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 26px;
    padding: 0 var(--space-3);
    border-radius: var(--r-pill);
    background: var(--panel-sunken);
    font-size: var(--text-s);
    font-weight: 600;
    color: var(--ink-dim);
  }

  .led {
    width: 7px;
    height: 7px;
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

  /* Compact visually; the ::after keeps the touch target at --hit. */
  .icon-button {
    position: relative;
    width: 30px;
    height: 30px;
    border-radius: var(--r-s);
    font-size: var(--text-l);
    line-height: 1;
    color: var(--ink);
  }

  .icon-button::after {
    content: '';
    position: absolute;
    inset: -5px -2px;
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

  .keys {
    font-family: var(--font-mono);
    font-size: var(--text-s);
    color: var(--ink-dim);
    white-space: nowrap;
  }
</style>
