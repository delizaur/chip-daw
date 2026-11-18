<!--
  Keyboard view (bottom panel tab, K): a full 88-key piano. Shows which computer keys play
  which notes (with the octave and velocity), plays notes when clicked or dragged across, and
  lights keys up: bright in the track's color for notes played live (mouse, computer keyboard,
  MIDI), dimmer in each track's color for notes its clips play. Optional note names and scale
  highlighting.
-->
<script lang="ts">
  import Toggle from '../controls/Toggle.svelte';
  import { MAX_OCTAVE, MIN_OCTAVE, PIANO_KEYS, VELOCITY_LEVELS } from '../input/computer-keyboard';
  import { session } from '../state/session.svelte';
  import { trackColor } from '../theme';
  import {
    isBlack,
    keyLight,
    layoutKeys,
    NOTE_NAMES,
    pitchName,
    scaleNotes,
    SCALES,
    whiteKeyCount,
    type KeyLight,
    type ScaleId,
  } from './keys';
  import { keyboardView as settings } from './settings.svelte';

  const keys = layoutKeys();
  const whites = whiteKeyCount();
  /** Narrowest a white key gets; below that the piano scrolls sideways. */
  const MIN_KEY_WIDTH = 18;

  let scrollerWidth = $state(0);
  const keyWidth = $derived(Math.max(MIN_KEY_WIDTH, scrollerWidth / whites));

  /** The computer key letter for each pitch it plays at the current octave. */
  const letters = $derived.by(() => {
    const base = (session.keyboardOctave + 1) * 12;
    return new Map(
      Object.entries(PIANO_KEYS).map(([code, offset]) => [
        base + offset,
        code === 'Semicolon' ? ';' : code.slice(3),
      ]),
    );
  });
  const range = $derived.by(() => {
    const pitches = [...letters.keys()];
    return { low: Math.min(...pitches), high: Math.max(...pitches) };
  });
  const rangeKeys = $derived(keys.filter((k) => k.pitch >= range.low && k.pitch <= range.high));

  const inScale = $derived(settings.scaleOn ? scaleNotes(settings.root, settings.scale) : null);

  const tracks = $derived(session.project.tracks);
  const lights = $derived.by(() => {
    const index = new Map(tracks.map((t, i) => [t.id, i]));
    const live = new Map(
      [...session.liveNotes].flatMap(([pitch, trackId]) => {
        const i = index.get(trackId);
        return i === undefined ? [] : [[pitch, i] as const];
      }),
    );
    const sounding = tracks.map((t) => session.litNotes.get(t.id));
    return new Map(
      keys.map((k) => [k.pitch, keyLight(k.pitch, live, sounding, session.selectedTrackIndex)]),
    );
  });

  /** A lit key's background: the track colors side by side (dimmer when not live). */
  function lightFill(light: KeyLight, black: boolean): string {
    const base = black ? 'var(--key-black)' : 'var(--key-white)';
    const colors = light.tracks.map((i) =>
      light.live ? trackColor(i) : `color-mix(in srgb, ${trackColor(i)} 50%, ${base})`,
    );
    if (colors.length === 1) return colors[0]!;
    const band = 100 / colors.length;
    const stops = colors.map((c, i) => `${c} ${i * band}% ${(i + 1) * band}%`);
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }

  // --- Mouse: press a key to play it; drag across keys to slide between them ----------------

  let mouse: { pointerId: number; pitch: number } | null = null;

  const pitchAt = (target: EventTarget | null) => {
    const key = target instanceof Element ? target.closest<HTMLElement>('[data-pitch]') : null;
    return key ? Number(key.dataset.pitch) : null;
  };

  function play(pointerId: number, pitch: number) {
    if (mouse) session.noteOff('mouse', mouse.pitch);
    mouse = { pointerId, pitch };
    session.noteOn('mouse', pitch, session.keyboardVelocity);
  }

  function onpointerdown(event: PointerEvent) {
    if (event.button !== 0) return;
    const pitch = pitchAt(event.target);
    if (pitch === null) return;
    event.preventDefault();
    // Touch captures the pointer implicitly; let it go so sliding reaches the other keys.
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    play(event.pointerId, pitch);
  }

  function onpointerover(event: PointerEvent) {
    if (!mouse || event.pointerId !== mouse.pointerId) return;
    const pitch = pitchAt(event.target);
    if (pitch !== null && pitch !== mouse.pitch) play(event.pointerId, pitch);
  }

  function release(event: PointerEvent) {
    if (!mouse || event.pointerId !== mouse.pointerId) return;
    session.noteOff('mouse', mouse.pitch);
    mouse = null;
  }

  // Release on a pointerup anywhere (the pointer may have left the piano), and when the view
  // closes with a key down.
  $effect(() => {
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      session.releaseSource('mouse');
    };
  });

  // Start with the computer keyboard's octave in view when the piano is wider than the panel.
  let scroller: HTMLDivElement | undefined = $state();
  $effect(() => {
    const low = range.low;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    const left = keys.find((k) => k.pitch === low)!.x * keyWidth;
    const right = left + 10 * keyWidth;
    if (left < scroller.scrollLeft || right > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = left - (scroller.clientWidth - 10 * keyWidth) / 2;
    }
  });

  const velocityIndex = $derived(VELOCITY_LEVELS.findIndex((v) => v >= session.keyboardVelocity));
</script>

<div class="keyboard-view">
  <div class="controls">
    <div class="group" aria-label="Computer keyboard">
      <span class="status" class:off={!session.keyboardPiano}>
        {session.keyboardPiano
          ? 'Computer keyboard plays notes'
          : 'Computer keyboard piano off (the key left of 1 turns it on)'}
      </span>
      <div class="stepper">
        <span class="label">Octave</span>
        <button
          type="button"
          aria-label="Octave down"
          title="Octave down (Z)"
          disabled={session.keyboardOctave <= MIN_OCTAVE}
          onclick={() => session.shiftOctave(-1)}>−</button
        >
        <output aria-label="Octave">{pitchName(range.low)}–{pitchName(range.high)}</output>
        <button
          type="button"
          aria-label="Octave up"
          title="Octave up (X)"
          disabled={session.keyboardOctave >= MAX_OCTAVE}
          onclick={() => session.shiftOctave(1)}>+</button
        >
      </div>
      <div class="stepper">
        <span class="label">Velocity</span>
        <button
          type="button"
          aria-label="Velocity down"
          title="Velocity down (C)"
          disabled={velocityIndex === 0}
          onclick={() => session.shiftVelocity(-1)}>−</button
        >
        <output aria-label="Velocity">{session.keyboardVelocity}</output>
        <button
          type="button"
          aria-label="Velocity up"
          title="Velocity up (V)"
          disabled={session.keyboardVelocity >= 127}
          onclick={() => session.shiftVelocity(1)}>+</button
        >
      </div>
    </div>
    <div class="group">
      <Toggle
        size="small"
        label="Note names"
        pressed={settings.noteNames}
        onchange={(noteNames) => settings.set({ noteNames })}>Names</Toggle
      >
      <Toggle
        size="small"
        label="Scale"
        title="Highlight a scale"
        pressed={settings.scaleOn}
        onchange={(scaleOn) => settings.set({ scaleOn })}>Scale</Toggle
      >
      {#if settings.scaleOn}
        <select
          aria-label="Scale root"
          value={settings.root}
          onchange={(e) => settings.set({ root: Number(e.currentTarget.value) })}
        >
          {#each NOTE_NAMES as name, i (name)}
            <option value={i}>{name}</option>
          {/each}
        </select>
        <select
          aria-label="Scale type"
          value={settings.scale}
          onchange={(e) => settings.set({ scale: e.currentTarget.value as ScaleId })}
        >
          {#each SCALES as scale (scale.id)}
            <option value={scale.id}>{scale.name}</option>
          {/each}
        </select>
      {/if}
    </div>
  </div>

  <div class="scroller" bind:this={scroller} bind:clientWidth={scrollerWidth}>
    <!-- Mouse input for the whole piano (one handler instead of 88); keys aren't tab stops,
         the computer keyboard and MIDI play them. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="piano"
      aria-label="Piano keyboard"
      style:width="{keyWidth * whites}px"
      {onpointerdown}
      {onpointerover}
    >
      <div
        class="range"
        class:off={!session.keyboardPiano}
        style:left="{rangeKeys[0]!.x * keyWidth}px"
        style:width="{(rangeKeys.at(-1)!.x + rangeKeys.at(-1)!.width - rangeKeys[0]!.x) *
          keyWidth}px"
        title="Played by the computer keyboard"
      ></div>
      {#each keys as key (key.pitch)}
        {@const light = lights.get(key.pitch)}
        {@const pitchClass = key.pitch % 12}
        {@const letter = letters.get(key.pitch)}
        <div
          class="key"
          class:black={key.black}
          class:out={inScale !== null && !inScale.has(pitchClass)}
          class:lit={!!light}
          class:live={light?.live}
          data-pitch={key.pitch}
          style:left="{key.x * keyWidth}px"
          style:width="{key.width * keyWidth}px"
          style:background={light ? lightFill(light, key.black) : undefined}
        >
          {#if inScale?.has(pitchClass)}
            <span class="dot" class:root={pitchClass === settings.root}></span>
          {/if}
          <!-- Every key keeps a slot for its letter and its name, shown or not, so letters,
               names and scale dots line up across the keys. -->
          <span class="letter" class:off={!session.keyboardPiano} class:hidden={!letter}
            >{letter ?? 'A'}</span
          >
          <span
            class="name"
            class:hidden={!settings.noteNames && (pitchClass !== 0 || isBlack(key.pitch))}
          >
            {key.black ? NOTE_NAMES[pitchClass] : pitchName(key.pitch)}
          </span>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .keyboard-view {
    /* Piano colors stay the same in both themes, like a real one. */
    --key-white: #ecebf0;
    --key-white-out: #a9a7b1;
    --key-black: #1d1b22;
    --key-black-in: #3b3743;
    --key-ink: #2a2830;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-4);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3) var(--space-5, 24px);
  }

  .group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
  }

  .status {
    font-size: var(--text-s);
    color: var(--ink);
  }

  .status.off {
    color: var(--ink-dim);
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .stepper .label {
    margin-right: var(--space-1);
    font-size: var(--text-xs);
    color: var(--ink-dim);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .stepper button {
    width: 26px;
    height: 26px;
    background: var(--panel-raised);
    box-shadow: var(--shadow-raised);
    font-size: var(--text-m);
  }

  .stepper button:disabled {
    opacity: 0.4;
  }

  .stepper output {
    min-width: 64px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: var(--text-s);
  }

  select {
    height: 26px;
    border: none;
    background: var(--panel-sunken);
    color: var(--ink);
    font: inherit;
    font-size: var(--text-s);
  }

  .scroller {
    flex: 1;
    min-height: 0;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .piano {
    position: relative;
    height: 100%;
    max-height: 240px;
    min-height: 120px;
    padding-top: 8px;
    touch-action: none;
    user-select: none;
  }

  /* The keys the computer keyboard plays: a strip above them. */
  .range {
    position: absolute;
    top: 0;
    height: 4px;
    background: var(--accent);
  }

  .range.off {
    background: var(--line-strong);
  }

  .key {
    position: absolute;
    top: 8px;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    padding-bottom: 6px;
    background: var(--key-white);
    box-shadow: inset -1px 0 0 #8d8b95;
    color: var(--key-ink);
    cursor: pointer;
  }

  .key.out {
    background: var(--key-white-out);
  }

  .key.black {
    z-index: 1;
    bottom: 38%;
    padding-bottom: 4px;
    background: var(--key-black);
    box-shadow: none;
    color: #e9e8ee;
  }

  /* With a scale on, its black keys are a little lighter than the others. */
  .key.black:has(.dot) {
    background: var(--key-black-in);
  }

  .key.lit.black,
  .key.live {
    color: #fff;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.45;
  }

  .dot.root {
    width: 8px;
    height: 8px;
    background: var(--accent);
    opacity: 1;
  }

  .letter {
    min-width: 14px;
    padding: 0 2px;
    border: 1px solid currentColor;
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 14px;
    text-align: center;
  }

  .letter.off {
    opacity: 0.4;
  }

  .name {
    font-size: 10px;
    line-height: 1;
    white-space: nowrap;
  }

  .black .name {
    font-size: 9px;
  }

  .hidden {
    visibility: hidden;
  }
</style>
