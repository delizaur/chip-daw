<!--
  MIDI input selector. MIDI access is only requested when the user picks "Enable MIDI…",
  because browsers may show a permission prompt.
-->
<script lang="ts">
  import { session } from '../state/session.svelte';

  const ready = $derived(session.midiStatus === 'ready');
  const offLabel = $derived(
    {
      off: 'MIDI off',
      connecting: 'Connecting MIDI…',
      ready: 'MIDI off',
      unsupported: 'MIDI not supported',
      error: 'MIDI blocked',
    }[session.midiStatus],
  );

  function onchange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === 'enable') void session.enableMidi();
    else session.selectMidi(value);
  }
</script>

<select
  class="midi-select"
  class:active={ready && session.midiSelection !== 'none'}
  aria-label="MIDI input"
  title={session.midiError ?? 'MIDI input: notes play on the selected track'}
  disabled={session.midiStatus === 'connecting' || session.midiStatus === 'unsupported'}
  value={ready ? session.midiSelection : 'none'}
  {onchange}
>
  <option value="none">{offLabel}</option>
  {#if ready}
    <option value="all">
      {session.midiDevices.length === 0 ? 'MIDI: no devices' : 'MIDI: all inputs'}
    </option>
    {#each session.midiDevices as device (device.id)}
      <option value={device.id}>{device.name}</option>
    {/each}
  {:else if session.midiStatus === 'off' || session.midiStatus === 'error'}
    <option value="enable">Enable MIDI…</option>
  {/if}
</select>

<style>
  .midi-select {
    height: 26px;
    max-width: 200px;
    padding: 0 var(--space-2) 0 var(--space-3);
    border: none;
    border-radius: var(--r-pill);
    background: var(--panel-sunken);
    color: var(--ink-dim);
    font: inherit;
    font-size: var(--text-s);
    font-weight: 600;
    cursor: pointer;
  }

  .midi-select.active {
    color: var(--ink);
  }

  .midi-select:disabled {
    cursor: default;
    opacity: 0.6;
  }
</style>
