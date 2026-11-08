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
    // Picking an input means the user wants to play: start audio while this counts as a gesture.
    void session.startAudio();
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === 'enable') void session.enableMidi();
    else session.selectMidi(value);
  }
</script>

<span class="midi">
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
  {#if ready}
    <!-- Blinks on every incoming MIDI message; hover for the last one. -->
    {#key session.midiActivity}
      <span
        class="midi-led"
        class:flash={session.midiActivity > 0}
        role="img"
        aria-label="MIDI activity"
        title={session.midiLastMessage
          ? `Last MIDI message: ${session.midiLastMessage}`
          : 'No MIDI messages received yet'}
      ></span>
    {/key}
  {/if}
</span>

<style>
  .midi {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .midi-led {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--panel-sunken);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  .midi-led.flash {
    animation: midi-flash 300ms ease-out;
  }

  @keyframes midi-flash {
    from {
      background: var(--c-green);
      box-shadow: 0 0 8px var(--c-green);
    }
  }

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
