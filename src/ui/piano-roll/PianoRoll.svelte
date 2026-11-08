<!--
  Piano roll for the clip being edited (session.editing).

  Mouse/touch:
    empty grid        click to add a note (drag right to set its length)
    note              click to select (Shift: add/remove) and hear it; drag to move (time and
                      pitch); drag its right edge to change length; double-click to delete
    Shift+drag        select a rectangle of notes
    keys              click to hear a pitch
    velocity lane     click or drag across stems to set velocities
    ruler             click to move the playhead
    wheel             scroll pitches; Shift+wheel scrolls time; Ctrl/Cmd+wheel zooms
  Alt while dragging disables snapping. Arrow keys (via the app keymap) transpose / move.
-->
<script lang="ts">
  import { PPQ } from '../../model/constants';
  import { createId } from '../../model/ids';
  import { addNotes, quantizeNotes, updateNotes, type NoteChange } from '../../model/note-commands';
  import { floorTo, snapTick } from '../../model/time';
  import type { Note, Tick } from '../../model/types';
  import { prepareCanvas } from '../canvas';
  import Segmented from '../controls/Segmented.svelte';
  import { session } from '../state/session.svelte';
  import { trackColor } from '../theme';
  import { drawPianoRoll } from './draw';
  import {
    areaAt,
    fitView,
    KEYS_WIDTH,
    MAX_PIXELS_PER_TICK,
    MIN_PIXELS_PER_TICK,
    noteAt,
    pitchToY,
    ROW_HEIGHT,
    stemAt,
    velocityAtY,
    visibleRows,
    xToTick,
    yToPitch,
    type RollView,
  } from './geometry';

  const GRIDS = [
    { value: PPQ, label: '1/4' },
    { value: PPQ / 2, label: '1/8' },
    { value: PPQ / 4, label: '1/16' },
    { value: PPQ / 8, label: '1/32' },
  ];

  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);
  let height = $state(0);
  let view = $state<RollView>({ pixelsPerTick: 64 / PPQ, scrollTick: 0, topPitch: 84 });
  let marquee = $state.raw<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  let themeVersion = $state(0);
  /** Length for newly drawn notes: the last drawn or resized length. */
  let drawLength: Tick = PPQ / 4;
  /** The clip the view was fitted to, so switching clips refits. */
  let fittedClipId: string | null = null;

  const editing = $derived(session.editing);
  const meter = $derived(session.project.tempoMap.meters[0]!);

  type Drag =
    | { kind: 'seek' }
    | { kind: 'draw'; id: string; startTick: Tick }
    | {
        kind: 'move';
        originals: Map<string, Note>;
        anchor: Note;
        startX: number;
        startY: number;
        started: boolean;
        lastPitch: number;
      }
    | { kind: 'resize'; originals: Map<string, Note>; anchor: Note }
    | { kind: 'velocity' }
    | { kind: 'marquee'; base: ReadonlySet<string> };
  let drag: Drag | null = null;
  /** Note created by the current gesture; a double-click right after shouldn't delete it. */
  let createdId: string | null = null;

  function point(event: MouseEvent) {
    const rect = canvas!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  const snap = (tick: Tick, event: MouseEvent) =>
    event.altKey ? Math.round(tick) : snapTick(tick, session.pianoRollGrid);
  const floorSnap = (tick: Tick, event: MouseEvent) =>
    event.altKey ? Math.round(tick) : floorTo(tick, session.pianoRollGrid);

  // Fit the view whenever a different clip is opened (or the canvas first gets a size).
  $effect(() => {
    const clip = editing?.clip;
    if (!clip || width === 0 || height === 0) return;
    if (clip.id !== fittedClipId) {
      fittedClipId = clip.id;
      view = fitView(clip, width, height);
    }
  });

  // --- Drawing ------------------------------------------------------------------------------

  function draw() {
    if (!canvas || !editing || width === 0 || height === 0) return;
    const ctx = prepareCanvas(canvas, width, height);
    if (!ctx) return;
    drawPianoRoll(ctx, canvas, {
      clip: editing.clip,
      color: trackColor(editing.trackIndex),
      meter,
      view,
      grid: session.pianoRollGrid,
      width,
      height,
      selected: session.selectedNoteIds,
      playhead: session.playheadAt(),
      marquee,
    });
  }

  $effect(() => {
    void [
      editing,
      view,
      width,
      height,
      marquee,
      themeVersion,
      session.selectedNoteIds,
      session.pianoRollGrid,
      session.position,
    ];
    draw();
  });

  $effect(() => {
    if (!session.playing) return;
    let frame = requestAnimationFrame(function loop() {
      draw();
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    const observer = new MutationObserver(() => themeVersion++);
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  });

  $effect(() => {
    const element = canvas;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { x } = point(event);
      if (event.ctrlKey || event.metaKey) {
        const anchor = xToTick(view, x);
        const pixelsPerTick = Math.min(
          MAX_PIXELS_PER_TICK,
          Math.max(MIN_PIXELS_PER_TICK, view.pixelsPerTick * Math.exp(-event.deltaY * 0.002)),
        );
        view = { ...view, pixelsPerTick, scrollTick: anchor - (x - KEYS_WIDTH) / pixelsPerTick };
      } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const dx = event.shiftKey ? event.deltaY : event.deltaX;
        view = { ...view, scrollTick: view.scrollTick + dx / view.pixelsPerTick };
      } else {
        const rows = Math.sign(event.deltaY) * Math.max(1, Math.round(Math.abs(event.deltaY) / 40));
        const top = Math.min(127, Math.max(visibleRows(height) - 1, view.topPitch - rows));
        view = { ...view, topPitch: top };
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  });

  // --- Editing ------------------------------------------------------------------------------

  function address() {
    return session.editingClip!;
  }

  function audition(pitch: number, velocity = 100) {
    if (editing) session.previewNote(editing.track.id, pitch, velocity);
  }

  function notesInMarquee(x0: number, y0: number, x1: number, y1: number): string[] {
    if (!editing) return [];
    const { clip } = editing;
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    return clip.notes
      .filter((n) => {
        const nx = KEYS_WIDTH + (clip.startTick + n.tick - view.scrollTick) * view.pixelsPerTick;
        const nw = n.durationTicks * view.pixelsPerTick;
        const ny = pitchToY(view, n.pitch);
        return nx < right && nx + nw > left && ny < bottom && ny + ROW_HEIGHT > top;
      })
      .map((n) => n.id);
  }

  function setVelocityAt(x: number, y: number) {
    if (!editing) return;
    const note = stemAt(editing.clip, view, x, session.selectedNoteIds);
    if (!note) return;
    const velocity = velocityAtY(y, height);
    // Dragging a selected note's stem sets every selected note's velocity.
    const ids = session.selectedNoteIds.has(note.id) ? [...session.selectedNoteIds] : [note.id];
    session.run(
      updateNotes(
        address(),
        ids.map((id) => ({ id, velocity })),
      ),
    );
  }

  function onpointerdown(event: PointerEvent) {
    if (event.button !== 0 || !canvas || !editing) return;
    session.focusArea = 'pianoRoll';
    const { x, y } = point(event);
    const { clip } = editing;
    canvas.setPointerCapture(event.pointerId);
    createdId = null;

    switch (areaAt(x, y, height)) {
      case 'ruler':
        session.seek(snap(xToTick(view, x), event));
        drag = { kind: 'seek' };
        return;
      case 'keys':
        audition(yToPitch(view, y));
        return;
      case 'velocity':
        session.begin('Change velocity');
        drag = { kind: 'velocity' };
        setVelocityAt(x, y);
        return;
      case 'grid':
        break;
    }

    if (event.shiftKey) {
      const hit = noteAt(clip, view, x, y);
      if (hit) {
        const ids = [...session.selectedNoteIds];
        const has = ids.includes(hit.note.id);
        session.selectNotes(has ? ids.filter((id) => id !== hit.note.id) : [...ids, hit.note.id]);
        return;
      }
      marquee = { x0: x, y0: y, x1: x, y1: y };
      drag = { kind: 'marquee', base: session.selectedNoteIds };
      return;
    }

    const hit = noteAt(clip, view, x, y);
    if (hit) {
      if (!session.selectedNoteIds.has(hit.note.id)) session.selectNotes([hit.note.id]);
      const originals = new Map(
        clip.notes.filter((n) => session.selectedNoteIds.has(n.id)).map((n) => [n.id, n]),
      );
      // Second click of a double-click (which deletes the note): don't play it again.
      if (event.detail < 2) audition(hit.note.pitch, hit.note.velocity);
      if (hit.edge === 'end') {
        session.begin(originals.size === 1 ? 'Resize note' : 'Resize notes');
        drag = { kind: 'resize', originals, anchor: hit.note };
      } else {
        session.begin(originals.size === 1 ? 'Move note' : 'Move notes');
        drag = {
          kind: 'move',
          originals,
          anchor: hit.note,
          startX: x,
          startY: y,
          started: false,
          lastPitch: hit.note.pitch,
        };
      }
      return;
    }

    // Empty grid: draw a new note, inside the clip only.
    const tick = floorSnap(xToTick(view, x), event);
    if (tick < clip.startTick || tick >= clip.startTick + clip.lengthTicks) {
      session.selectNotes([]);
      return;
    }
    const pitch = yToPitch(view, y);
    if (pitch < 0 || pitch > 127) return;
    const note: Note = {
      id: createId(),
      tick: tick - clip.startTick,
      durationTicks: drawLength,
      pitch,
      velocity: session.keyboardVelocity,
    };
    session.begin('Add note');
    session.run(addNotes(address(), [note]));
    session.selectNotes([note.id]);
    createdId = note.id;
    audition(pitch, note.velocity);
    drag = { kind: 'draw', id: note.id, startTick: tick };
  }

  function onpointermove(event: PointerEvent) {
    if (!canvas || !editing) return;
    const { x, y } = point(event);
    const { clip } = editing;
    if (!drag) {
      const area = areaAt(x, y, height);
      const hit = area === 'grid' ? noteAt(clip, view, x, y) : null;
      canvas.style.cursor = hit
        ? hit.edge
          ? 'ew-resize'
          : 'grab'
        : area === 'ruler'
          ? 'pointer'
          : '';
      return;
    }

    switch (drag.kind) {
      case 'seek':
        session.seek(snap(xToTick(view, x), event));
        break;
      case 'velocity':
        setVelocityAt(x, y);
        break;
      case 'marquee': {
        marquee = { ...marquee!, x1: x, y1: y };
        const inside = notesInMarquee(marquee.x0, marquee.y0, x, y);
        session.selectNotes([...drag.base, ...inside]);
        break;
      }
      case 'draw': {
        const end = snap(xToTick(view, x), event);
        const length = Math.max(event.altKey ? 1 : session.pianoRollGrid, end - drag.startTick);
        session.run(updateNotes(address(), [{ id: drag.id, durationTicks: length }]));
        drawLength = length;
        break;
      }
      case 'move': {
        if (!drag.started && Math.hypot(x - drag.startX, y - drag.startY) < 3) return;
        drag.started = true;
        canvas.style.cursor = 'grabbing';
        const originals = [...drag.originals.values()];
        const anchorStart = clip.startTick + drag.anchor.tick;
        const wanted = snap(anchorStart + xToTick(view, x) - xToTick(view, drag.startX), event);
        // Keep every note inside the clip and every pitch on the keyboard.
        const minTick = Math.min(...originals.map((n) => n.tick));
        const maxTick = Math.max(...originals.map((n) => n.tick));
        const dt = Math.min(
          clip.lengthTicks - 1 - maxTick,
          Math.max(-minTick, wanted - anchorStart),
        );
        const minPitch = Math.min(...originals.map((n) => n.pitch));
        const maxPitch = Math.max(...originals.map((n) => n.pitch));
        const dp = Math.min(
          127 - maxPitch,
          Math.max(-minPitch, yToPitch(view, y) - yToPitch(view, drag.startY)),
        );
        const changes: NoteChange[] = originals.map((n) => ({
          id: n.id,
          tick: n.tick + dt,
          pitch: n.pitch + dp,
        }));
        session.run(updateNotes(address(), changes));
        if (drag.anchor.pitch + dp !== drag.lastPitch) {
          drag.lastPitch = drag.anchor.pitch + dp;
          audition(drag.lastPitch, drag.anchor.velocity);
        }
        break;
      }
      case 'resize': {
        const anchorEnd = clip.startTick + drag.anchor.tick + drag.anchor.durationTicks;
        const wantedEnd = snap(xToTick(view, x), event);
        const minLength = event.altKey ? 1 : session.pianoRollGrid;
        const delta = wantedEnd - anchorEnd;
        const changes: NoteChange[] = [...drag.originals.values()].map((n) => ({
          id: n.id,
          durationTicks: Math.max(minLength, n.durationTicks + delta),
        }));
        session.run(updateNotes(address(), changes));
        drawLength = Math.max(minLength, drag.anchor.durationTicks + delta);
        break;
      }
    }
  }

  function onpointerup() {
    const finished = drag;
    drag = null;
    marquee = null;
    if (canvas) canvas.style.cursor = '';
    if (finished && ['draw', 'move', 'resize', 'velocity'].includes(finished.kind)) {
      session.commit();
    }
  }

  function ondblclick(event: MouseEvent) {
    if (!editing) return;
    const { x, y } = point(event);
    if (areaAt(x, y, height) !== 'grid') return;
    const hit = noteAt(editing.clip, view, x, y);
    if (!hit || hit.note.id === createdId) return;
    session.selectNotes([hit.note.id]);
    session.deleteSelection();
  }

  function quantize() {
    if (!editing) return;
    const ids = session.selectedNoteIds.size > 0 ? session.selectedNoteIds : null;
    session.run(quantizeNotes(address(), ids, session.pianoRollGrid));
  }
</script>

<div class="piano-roll">
  <div class="toolbar">
    <span class="label">Grid</span>
    <Segmented
      label="Grid"
      options={GRIDS}
      value={session.pianoRollGrid}
      color="var(--c-blue)"
      onchange={(grid) => (session.pianoRollGrid = grid)}
    />
    <button type="button" class="tool" disabled={!editing} onclick={quantize}>
      Quantize{session.selectedNoteIds.size > 0 ? ' selected' : ''}
    </button>
    <button
      type="button"
      class="tool"
      disabled={!editing}
      onclick={() => editing && (view = fitView(editing.clip, width, height))}>Fit</button
    >
    <span class="hint">
      Click to add · drag to move · Shift+drag to select · double-click to delete · ↑↓ transpose
    </span>
  </div>
  <div class="surface" bind:clientWidth={width} bind:clientHeight={height}>
    {#if editing}
      <canvas
        bind:this={canvas}
        class="piano-roll-canvas"
        aria-label="Piano roll"
        {onpointerdown}
        {onpointermove}
        {onpointerup}
        onpointercancel={onpointerup}
        {ondblclick}
      ></canvas>
    {:else}
      <p class="empty">Double-click a clip in the arrangement to edit its notes.</p>
    {/if}
  </div>
</div>

<style>
  .piano-roll {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .label {
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .toolbar :global(.segmented button) {
    min-width: 36px;
    height: 24px;
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
  }

  .tool {
    height: 28px;
    padding: 0 var(--space-3);
    border-radius: var(--r-s);
    background: var(--panel-raised);
    box-shadow: var(--shadow-raised);
    font-size: var(--text-s);
    font-weight: 600;
  }

  .tool:disabled {
    opacity: 0.4;
  }

  .hint {
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--ink-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .surface {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    touch-action: none;
  }

  .empty {
    margin: var(--space-5);
    color: var(--ink-dim);
    font-size: var(--text-s);
  }
</style>
