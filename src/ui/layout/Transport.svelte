<!--
  Transport: go to start, play/pause, record, overdub, metronome, tempo and position.
-->
<script lang="ts">
  import { MAX_BPM, MIN_BPM, setTempo } from '../../model/commands';
  import { formatPosition } from '../../model/time';
  import Toggle from '../controls/Toggle.svelte';
  import { session } from '../state/session.svelte';

  const bpm = $derived(session.project.tempoMap.tempos[0]?.bpm ?? 120);
  const meter = $derived(session.project.tempoMap.meters[0]!);
  const position = $derived(formatPosition(session.project.tempoMap, session.position));
  /** Playing, or counting in before recording. */
  const running = $derived(session.playing || session.countIn > 0);

  function commitTempo(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const value = Number(input.value);
    if (Number.isFinite(value) && value > 0) session.run(setTempo(value));
    input.value = String(session.project.tempoMap.tempos[0]?.bpm ?? 120);
  }

  function onTempoKey(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === 'Escape') {
      if (event.key === 'Escape') (event.currentTarget as HTMLInputElement).value = String(bpm);
      (event.currentTarget as HTMLInputElement).blur();
    }
  }
</script>

<div class="transport">
  <button
    type="button"
    class="icon-button"
    aria-label="Go to start"
    title="Go to start (Home)"
    onclick={() => session.seek(0)}>⏮</button
  >
  <Toggle
    size="small"
    label={running ? 'Pause' : 'Play'}
    title={running ? 'Pause (Space)' : 'Play (Space); with Record on, counts in 4 beats first'}
    color="var(--c-green)"
    pressed={running}
    onchange={() => session.togglePlay()}>{running ? '❚❚' : '▶'}</Toggle
  >
  <Toggle
    size="small"
    label="Record"
    title="Record (R with the keyboard piano off)"
    color="var(--c-red)"
    pressed={session.recordArmed}
    onchange={() => session.toggleRecord()}>●</Toggle
  >
  <Toggle
    size="small"
    label="Overdub"
    title="Overdub (O with the keyboard piano off)"
    color="var(--c-red)"
    pressed={session.overdub}
    onchange={() => session.toggleOverdub()}>OVR</Toggle
  >
  <Toggle
    size="small"
    label="Metronome"
    title="Metronome (M with the keyboard piano off)"
    color="var(--c-blue)"
    pressed={session.metronome}
    onchange={() => session.toggleMetronome()}>♩</Toggle
  >
  <Toggle
    size="small"
    label="Loop"
    title="Loop (L with the keyboard piano off): drag its markers on the ruler to set it"
    color="var(--c-yellow)"
    pressed={session.loopEnabled}
    onchange={() => session.toggleLoop()}>LOOP</Toggle
  >

  <label class="tempo" title="Tempo (BPM)">
    <input
      type="number"
      aria-label="Tempo"
      min={MIN_BPM}
      max={MAX_BPM}
      step="1"
      value={bpm}
      onchange={commitTempo}
      onkeydown={onTempoKey}
    />
    <span>BPM</span>
  </label>
  <span class="readout" title="Time signature">{meter.numerator}/{meter.denominator}</span>
  <span class="readout position" aria-label="Position">{position}</span>
</div>

<style>
  .transport {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .icon-button {
    position: relative;
    width: 26px;
    height: 26px;
    border-radius: var(--r-s);
    color: var(--ink);
  }

  .icon-button::after {
    content: '';
    position: absolute;
    inset: -7px -2px;
  }

  .icon-button:hover {
    background: var(--panel-sunken);
  }

  .tempo {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    margin-left: var(--space-2);
    padding: 3px var(--space-2);
    border-radius: var(--r-s);
    background: var(--panel-sunken);
    font-size: var(--text-xs);
    color: var(--ink-dim);
  }

  .tempo input {
    width: 3.2em;
    border: none;
    background: none;
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--text-s);
    text-align: right;
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .tempo input::-webkit-inner-spin-button,
  .tempo input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .readout {
    padding: 3px var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-s);
    color: var(--ink-dim);
  }

  .position {
    min-width: 7ch;
    color: var(--ink);
  }
</style>
