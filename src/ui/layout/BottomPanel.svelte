<!--
  Bottom panel: will host the preset editor (Phase 1) and piano roll (Phase 2).
  For now it holds a test-tone panel to verify the audio path and show off the control kit.
-->
<script lang="ts">
  import type { TestToneShape } from '../../engine/protocol';
  import Knob from '../controls/Knob.svelte';
  import Segmented from '../controls/Segmented.svelte';
  import Toggle from '../controls/Toggle.svelte';
  import { session } from '../state/session.svelte';

  const shapes: { value: TestToneShape; label: string }[] = [
    { value: 'square', label: 'Square' },
    { value: 'triangle', label: 'Triangle' },
    { value: 'sine', label: 'Sine' },
  ];

  const hz = (v: number) => `${Math.round(v)} Hz`;
</script>

<section class="bottom-panel" aria-label="Editor">
  <div class="box">
    <div class="box-header">
      <h2 class="panel-title">Test tone</h2>
      <span class="tag">dev</span>
    </div>
    <div class="box-body">
      <Toggle
        label={session.testTone.enabled ? 'Stop test tone' : 'Play test tone'}
        color="var(--c-green)"
        pressed={session.testTone.enabled}
        onchange={async (enabled) => {
          await session.startAudio();
          session.setTestTone({ enabled });
        }}
      >
        {session.testTone.enabled ? '■ Stop' : '▶ Play'}
      </Toggle>
      <Segmented
        label="Waveform"
        options={shapes}
        value={session.testTone.shape}
        color="var(--c-blue)"
        onchange={(shape) => session.setTestTone({ shape })}
      />
      <Knob
        label="Pitch"
        value={session.testTone.frequency}
        min={55}
        max={1760}
        defaultValue={220}
        scale="exp"
        color="var(--c-purple)"
        format={hz}
        oninput={(frequency) => session.setTestTone({ frequency })}
      />
    </div>
  </div>
  <p class="placeholder">
    The preset editor (sequencer → synth → effects boxes) arrives in Phase 1, the piano roll in
    Phase 2.
  </p>
</section>

<style>
  .bottom-panel {
    display: flex;
    align-items: flex-start;
    gap: var(--space-5);
    padding: var(--space-4);
    background: var(--panel);
    border-top: 1px solid var(--line);
    overflow: auto;
  }

  .box {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-radius: var(--r-l);
    background: var(--panel-raised);
    box-shadow: var(--shadow-raised);
  }

  .box-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .tag {
    padding: 1px 6px;
    border-radius: var(--r-pill);
    background: var(--panel-sunken);
    font-size: var(--text-xs);
    color: var(--ink-dim);
  }

  .box-body {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .placeholder {
    max-width: 280px;
    margin: var(--space-3) 0 0;
  }
</style>
