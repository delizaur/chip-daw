<!--
  Center area: track headers (DOM) and the timeline (canvas) with ruler, clips and playhead.

  Timeline mouse/touch:
    ruler           click or drag to move the playhead; Shift-drag to select whole bars (for
                    Insert/Delete bars); with the loop on, drag its start and end markers
                    (snapped to the grid; Alt: free)
    tempo lane      tempo line: click to add a tempo change, drag a point to move it,
                    double-click to delete it, Shift-click to make it ramp to the next one
                    (or jump again); time-signature strip: double-click a bar to change its
                    time signature
    clip            click to select (Shift: add/remove), drag to move (also to other tracks),
                    drag an edge to resize, double-click to open it in the piano roll;
                    Alt while dragging disables snapping
    empty lane      click to select the track (and place the playhead when stopped),
                    double-click to create an empty one-bar clip
    wheel           Shift+wheel or horizontal wheel scrolls, Ctrl/Cmd+wheel zooms
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { getParamDescriptor } from '../../model/boxes/registry';
  import { moveClips, resizeClip, setLoopRegion } from '../../model/commands';
  import { toNormalized } from '../../model/scale';
  import { PPQ, SUBDIVISIONS } from '../../model/constants';
  import { deleteMeter, setMeter, setTempoEvents } from '../../model/tempo-commands';
  import { barAt, meterAt, snapInMeter } from '../../model/time';
  import type { Clip, TempoEvent, Tick } from '../../model/types';
  import { session } from '../state/session.svelte';
  import { trackColor } from '../theme';
  import { drawTimeline, type ClipGhost, type TakePreview } from './draw';
  import {
    DEFAULT_PIXELS_PER_TICK,
    gridTicks,
    hitTest,
    LANE_HEIGHT,
    laneAt,
    loopMarkerAt,
    RULER_HEIGHT,
    TEMPO_LANE_HEIGHT,
    TEMPO_LINE_HEIGHT,
    bpmAtY,
    tempoPointAt,
    tempoRange,
    tickToX,
    tracksTop,
    xToTick,
    zoomAround,
    type TempoRange,
    type TimelineView,
  } from './geometry';

  /** Shortest clip a resize can produce (a sixteenth). */
  const MIN_CLIP_TICKS = PPQ / 4;

  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);
  let view = $state<TimelineView>({ pixelsPerTick: DEFAULT_PIXELS_PER_TICK, scrollTick: 0 });
  let ghosts = $state.raw<ClipGhost[] | null>(null);
  /** Bumped when something outside Svelte's knowledge (the theme) changes the drawing. */
  let themeVersion = $state(0);

  const tracks = $derived(session.project.tracks);
  const presetNames = $derived(new Map(session.project.presets.map((p) => [p.id, p.name])));
  /** Tracks and clips an edit in the preset editor would change, highlighted. */
  const reach = $derived(session.presetReach);
  const noClips: ReadonlySet<string> = new Set();
  /** The loop region while looping is on (null hides the markers). */
  const loop = $derived(session.loopEnabled ? session.project.loop : null);
  const tempoMap = $derived(session.project.tempoMap);
  /** Held still while a tempo point is dragged, so the line doesn't rescale under the pointer. */
  let frozenRange = $state.raw<TempoRange | null>(null);
  const range = $derived(frozenRange ?? tempoRange(tempoMap.tempos));
  const showTempo = $derived(session.tempoLaneVisible);
  /** Where the track lanes start (lower with the tempo lane shown). */
  const top = $derived(tracksTop(showTempo));
  const height = $derived(top + tracks.length * LANE_HEIGHT);
  /** The time-signature editor, open on a bar (double-click in the strip). */
  let meterEdit = $state<{
    tick: Tick;
    bar: number;
    numerator: number;
    denominator: number;
    subdivision: number;
    existing: boolean;
    x: number;
  } | null>(null);
  /** A tempo point added by the current gesture: a double-click right after shouldn't delete it. */
  let tempoAdded = false;

  type Drag =
    | { kind: 'seek' }
    | { kind: 'barSelect'; anchor: Tick }
    | {
        kind: 'tempoPoint';
        /** The other points (the dragged one is re-added where it's dropped). */
        others: TempoEvent[];
        ramp: TempoEvent['ramp'];
        /** The first point stays at the song start (only its tempo moves). */
        first: boolean;
        startX: number;
        startY: number;
        began: boolean;
      }
    | { kind: 'loop'; edge: 'start' | 'end' }
    | {
        kind: 'move';
        ids: ReadonlySet<string>;
        anchorTick: Tick;
        anchorLane: number;
        startX: number;
        startY: number;
        started: boolean;
        deltaTicks: Tick;
        deltaTracks: number;
      }
    | {
        kind: 'resize';
        trackIndex: number;
        clip: Clip;
        edge: 'start' | 'end';
        start: Tick;
        end: Tick;
      };
  let drag: Drag | null = null;

  function point(event: MouseEvent) {
    const rect = canvas!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** Snaps to the grid for the zoom, counted in the meter at `tick` (Alt: no snapping). */
  function snap(tick: Tick, event: MouseEvent): Tick {
    if (event.altKey) return Math.max(0, Math.round(tick));
    return snapInMeter(tempoMap, tick, gridTicks(view, meterAt(tempoMap, tick)));
  }

  // --- Drawing ------------------------------------------------------------------------------

  /** The live recording pass, with notes mapped from track ids to lanes. */
  function takePreview(): TakePreview | null {
    const take = session.liveTake;
    if (!take) return null;
    const indexOf = new Map(tracks.map((t, i) => [t.id, i]));
    const notes = take.notes.flatMap((n) => {
      const trackIndex = indexOf.get(n.trackId);
      return trackIndex === undefined ? [] : [{ ...n, trackIndex }];
    });
    const trackIndices = [
      ...new Set([session.selectedTrackIndex, ...notes.map((n) => n.trackIndex)]),
    ];
    // Knob moves, one line per param, as heights within the param's range.
    const lines: Record<string, { trackIndex: number; points: { tick: Tick; level: number }[] }> =
      {};
    for (const move of session.liveMoves) {
      const trackIndex = indexOf.get(move.trackId);
      const param = getParamDescriptor(move.target.boxType, move.paramId);
      if (trackIndex === undefined || !param) continue;
      const key = `${move.trackId}:${move.target.boxId}:${move.paramId}`;
      lines[key] ??= { trackIndex, points: [] };
      lines[key].points.push({
        tick: Math.max(take.startTick, move.tick),
        level: toNormalized(move.value, param.min, param.max, param.scale),
      });
    }
    return { startTick: take.startTick, trackIndices, notes, moves: Object.values(lines) };
  }

  function draw() {
    if (!canvas || width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawTimeline(ctx, canvas, {
      tracks,
      tempoMap,
      tempoRange: range,
      barSelection: session.barSelection,
      tracksTop: top,
      tempoLane: showTempo,
      view,
      width,
      height,
      selectedTrack: session.selectedTrackIndex,
      selectedClips: session.selectedClipIds,
      affectedClips: reach?.clipIds ?? noClips,
      playhead: session.playheadAt(),
      take: takePreview(),
      ghosts,
      loop,
      presetNames,
      font: getComputedStyle(canvas).getPropertyValue('--font-ui') || 'sans-serif',
    });
  }

  /** While playing, page the view so the playhead stays visible. */
  function followPlayhead() {
    const x = tickToX(view, session.playheadAt());
    if (x > width - 24 || x < 0) {
      view = {
        ...view,
        scrollTick: Math.max(0, session.playheadAt() - (width * 0.1) / view.pixelsPerTick),
      };
    }
  }

  // Redraw whenever anything drawn changes.
  $effect(() => {
    void [
      tracks,
      tempoMap,
      range,
      session.barSelection,
      top,
      view,
      width,
      height,
      ghosts,
      themeVersion,
      presetNames,
      loop,
      reach,
      session.selectedTrackIndex,
      session.selectedClipIds,
      session.position,
      session.liveTake,
      session.liveMoves,
    ];
    draw();
  });

  /** Scrolls the view (when needed) so ticks `start`..`end` are visible. */
  function reveal(start: Tick, end: Tick = start) {
    if (width === 0) return;
    const margin = 24;
    const left = tickToX(view, start);
    const right = tickToX(view, end);
    if (left >= 0 && right <= width - margin) return;
    const scrollTick = Math.max(0, start - (width * 0.1) / view.pixelsPerTick);
    if (scrollTick !== view.scrollTick) view = { ...view, scrollTick };
  }

  // Keyboard navigation can select a clip or move the playhead off screen: bring it into view.
  $effect(() => {
    const ids = session.selectedClipIds;
    if (ids.size !== 1) return;
    const [id] = ids;
    const clip = tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    if (clip) untrack(() => reveal(clip.startTick, clip.startTick + clip.lengthTicks));
  });
  $effect(() => {
    const position = session.position;
    if (!session.playing) untrack(() => reveal(position));
  });

  // Animate the playhead while playing.
  $effect(() => {
    if (!session.playing) return;
    let frame = requestAnimationFrame(function loop() {
      followPlayhead();
      draw();
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  });

  // The canvas resolves CSS colors itself, so redraw when the theme attribute changes.
  $effect(() => {
    const observer = new MutationObserver(() => themeVersion++);
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  });

  // Wheel: needs a non-passive listener to stop the page from scrolling/zooming.
  $effect(() => {
    const element = canvas;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const { x } = point(event);
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        view = zoomAround(view, Math.exp(-event.deltaY * 0.002), x);
        return;
      }
      const dx = event.shiftKey ? event.deltaY : event.deltaX;
      if (dx !== 0) {
        event.preventDefault();
        view = { ...view, scrollTick: Math.max(0, view.scrollTick + dx / view.pixelsPerTick) };
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  });

  function zoom(factor: number) {
    view = zoomAround(view, factor, width / 2);
  }

  // --- Pointer --------------------------------------------------------------------------------

  /** On the tempo line: Shift-click a point to toggle its ramp, drag it, or add a new one. */
  function startTempoGesture(x: number, y: number, event: PointerEvent) {
    const tempos = tempoMap.tempos;
    tempoAdded = false;
    const index = tempoPointAt(tempos, view, range, x, y);
    if (index >= 0) {
      const point = tempos[index]!;
      if (event.shiftKey) {
        const ramp: TempoEvent['ramp'] = point.ramp === 'linear' ? 'step' : 'linear';
        const changed = tempos.map((t, i) => (i === index ? { ...t, ramp } : t));
        session.run(setTempoEvents(changed, ramp === 'linear' ? 'Ramp tempo' : 'Jump tempo'));
        return;
      }
      frozenRange = range;
      drag = {
        kind: 'tempoPoint',
        others: tempos.filter((_, i) => i !== index),
        ramp: point.ramp,
        first: index === 0,
        startX: x,
        startY: y,
        began: false,
      };
      return;
    }
    const tick = snap(xToTick(view, x), event);
    if (tick <= 0) return;
    frozenRange = range;
    session.begin('Add tempo change');
    session.run(setTempoEvents([...tempos, { tick, bpm: bpmAtY(y, range), ramp: 'step' }]));
    tempoAdded = true;
    drag = {
      kind: 'tempoPoint',
      others: [...tempos],
      ramp: 'step',
      first: false,
      startX: x,
      startY: y,
      began: true,
    };
  }

  function onpointerdown(event: PointerEvent) {
    if (event.button !== 0 || !canvas) return;
    session.focusArea = 'arrangement';
    const { x, y } = point(event);
    const hit = hitTest(tracks, view, x, y, top);
    canvas.setPointerCapture(event.pointerId);
    const marker = loop ? loopMarkerAt(view, loop, x, y) : null;

    if (marker) {
      session.begin('Move loop');
      drag = { kind: 'loop', edge: marker };
    } else if (hit.kind === 'ruler') {
      if (event.shiftKey) {
        const bar = barAt(tempoMap, hit.tick);
        session.barSelection = { startTick: bar.start, endTick: bar.start + bar.length };
        drag = { kind: 'barSelect', anchor: bar.start };
      } else {
        session.barSelection = null;
        session.seek(snap(hit.tick, event));
        drag = { kind: 'seek' };
      }
    } else if (hit.kind === 'tempo') {
      if (hit.part === 'line') startTempoGesture(x, y, event);
    } else if (hit.kind === 'clip') {
      session.selectTrack(hit.trackIndex);
      const id = hit.clip.id;
      if (event.shiftKey) {
        const ids = [...session.selectedClipIds];
        const wasSelected = ids.includes(id);
        session.selectClips(wasSelected ? ids.filter((other) => other !== id) : [...ids, id]);
        if (wasSelected) return;
      } else if (!session.selectedClipIds.has(id)) {
        session.selectClips([id]);
      }
      const start = hit.clip.startTick;
      drag = hit.edge
        ? {
            kind: 'resize',
            trackIndex: hit.trackIndex,
            clip: hit.clip,
            edge: hit.edge,
            start,
            end: start + hit.clip.lengthTicks,
          }
        : {
            kind: 'move',
            ids: session.selectedClipIds,
            anchorTick: start,
            anchorLane: hit.trackIndex,
            startX: x,
            startY: y,
            started: false,
            deltaTicks: 0,
            deltaTracks: 0,
          };
    } else if (hit.kind === 'lane') {
      session.selectTrack(hit.trackIndex);
      if (!event.shiftKey) session.selectClips([]);
      if (!session.playing) session.seek(snap(hit.tick, event));
    }
  }

  function onpointermove(event: PointerEvent) {
    if (!canvas) return;
    const { x, y } = point(event);
    if (!drag) {
      const hit = hitTest(tracks, view, x, y, top);
      const onTempoPoint =
        hit.kind === 'tempo' &&
        hit.part === 'line' &&
        tempoPointAt(tempoMap.tempos, view, range, x, y) >= 0;
      canvas.style.cursor =
        loop && loopMarkerAt(view, loop, x, y)
          ? 'ew-resize'
          : onTempoPoint
            ? 'grab'
            : hit.kind === 'tempo'
              ? hit.part === 'line'
                ? 'crosshair'
                : 'pointer'
              : hit.kind === 'clip'
                ? hit.edge
                  ? 'ew-resize'
                  : 'grab'
                : hit.kind === 'ruler'
                  ? 'pointer'
                  : '';
      return;
    }

    if (drag.kind === 'seek') {
      session.seek(snap(xToTick(view, x), event));
    } else if (drag.kind === 'barSelect') {
      const anchor = barAt(tempoMap, drag.anchor);
      const bar = barAt(tempoMap, Math.max(0, xToTick(view, x)));
      session.barSelection = {
        startTick: Math.min(anchor.start, bar.start),
        endTick: Math.max(anchor.start + anchor.length, bar.start + bar.length),
      };
    } else if (drag.kind === 'tempoPoint') {
      if (!drag.began) {
        if (Math.hypot(x - drag.startX, y - drag.startY) < 3) return;
        session.begin('Move tempo change');
        drag.began = true;
      }
      canvas.style.cursor = 'grabbing';
      let tick = drag.first ? 0 : snap(xToTick(view, x), event);
      if (!drag.first && tick <= 0) tick = gridTicks(view, meterAt(tempoMap, 0));
      const moved: TempoEvent = { tick, bpm: bpmAtY(y, range), ramp: drag.ramp };
      session.run(setTempoEvents([...drag.others, moved]));
    } else if (drag.kind === 'loop') {
      const tick = snap(xToTick(view, x), event);
      const { startTick, endTick } = session.project.loop;
      session.run(
        drag.edge === 'start'
          ? setLoopRegion(tick, endTick, 'end')
          : setLoopRegion(startTick, tick, 'start'),
      );
    } else if (drag.kind === 'move') {
      if (!drag.started && Math.hypot(x - drag.startX, y - drag.startY) < 4) return;
      drag.started = true;
      canvas.style.cursor = 'grabbing';
      const raw = xToTick(view, x) - xToTick(view, drag.startX);
      const wantTicks = snap(drag.anchorTick + raw, event) - drag.anchorTick;
      const wantTracks = Math.min(tracks.length - 1, Math.max(0, laneAt(y, top))) - drag.anchorLane;
      const ids = drag.ids;
      const moving = tracks.flatMap((track, trackIndex) =>
        track.clips.filter((c) => ids.has(c.id)).map((clip) => ({ trackIndex, clip })),
      );
      if (moving.length === 0) return;
      // Same clamping as the moveClips command, so the preview matches the result.
      const minStart = Math.min(...moving.map((m) => m.clip.startTick));
      const minTrack = Math.min(...moving.map((m) => m.trackIndex));
      const maxTrack = Math.max(...moving.map((m) => m.trackIndex));
      drag.deltaTicks = Math.max(wantTicks, -minStart);
      drag.deltaTracks = Math.min(tracks.length - 1 - maxTrack, Math.max(wantTracks, -minTrack));
      const { deltaTicks, deltaTracks } = drag;
      ghosts = moving.map(({ trackIndex, clip }) => ({
        trackIndex: trackIndex + deltaTracks,
        startTick: clip.startTick + deltaTicks,
        lengthTicks: clip.lengthTicks,
        notesStart: clip.startTick + deltaTicks,
        clip,
      }));
    } else {
      const tick = snap(xToTick(view, x), event);
      const original = {
        start: drag.clip.startTick,
        end: drag.clip.startTick + drag.clip.lengthTicks,
      };
      if (drag.edge === 'end') {
        drag.end = Math.max(tick, original.start + MIN_CLIP_TICKS);
      } else {
        drag.start = Math.min(Math.max(0, tick), original.end - MIN_CLIP_TICKS);
      }
      ghosts = [
        {
          trackIndex: drag.trackIndex,
          startTick: drag.start,
          lengthTicks: drag.end - drag.start,
          notesStart: drag.clip.startTick,
          clip: drag.clip,
        },
      ];
    }
  }

  function onpointerup() {
    const finished = drag;
    drag = null;
    ghosts = null;
    if (canvas) canvas.style.cursor = '';
    if (finished?.kind === 'loop') {
      session.commit();
    } else if (finished?.kind === 'tempoPoint') {
      if (finished.began) session.commit();
      frozenRange = null;
    } else if (finished?.kind === 'move' && finished.started) {
      if (finished.deltaTicks !== 0 || finished.deltaTracks !== 0) {
        session.run(moveClips(finished.ids, finished.deltaTicks, finished.deltaTracks));
      }
    } else if (finished?.kind === 'resize') {
      const { clip } = finished;
      if (finished.start !== clip.startTick || finished.end !== clip.startTick + clip.lengthTicks) {
        const trackId = tracks[finished.trackIndex]!.id;
        session.run(resizeClip(trackId, clip.id, finished.start, finished.end));
      }
    }
  }

  function ondblclick(event: MouseEvent) {
    const { x, y } = point(event);
    const hit = hitTest(tracks, view, x, y, top);
    if (hit.kind === 'tempo' && hit.part === 'line') {
      // Delete a tempo change (not the first: the song needs a tempo).
      const index = tempoPointAt(tempoMap.tempos, view, range, x, y);
      if (index > 0 && !tempoAdded) {
        const rest = tempoMap.tempos.filter((_, i) => i !== index);
        session.run(setTempoEvents(rest, 'Delete tempo change'));
      }
    } else if (hit.kind === 'tempo') {
      const bar = barAt(tempoMap, Math.max(0, hit.tick));
      const existing = tempoMap.meters.find((m) => m.tick === bar.start);
      meterEdit = {
        tick: bar.start,
        bar: bar.index + 1,
        numerator: bar.meter.numerator,
        denominator: bar.meter.denominator,
        subdivision: bar.meter.subdivision,
        existing: !!existing && bar.start > 0,
        x: Math.max(0, Math.min(width - 220, tickToX(view, bar.start))),
      };
    } else if (hit.kind === 'lane') {
      session.createEmptyClip(hit.trackIndex, barAt(tempoMap, hit.tick).start);
    } else if (hit.kind === 'clip') {
      session.openPianoRoll(hit.trackIndex, hit.clip.id);
    }
  }

  function closeOnEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') meterEdit = null;
  }

  function applyMeter() {
    if (!meterEdit) return;
    session.run(
      setMeter(meterEdit.tick, meterEdit.numerator, meterEdit.denominator, meterEdit.subdivision),
    );
    meterEdit = null;
  }

  function removeMeter() {
    if (!meterEdit) return;
    session.run(deleteMeter(meterEdit.tick));
    meterEdit = null;
  }

  const bars = $derived(session.barRange);
</script>

<section
  class="arrangement"
  aria-label="Arrangement"
  style:--ruler-height="{RULER_HEIGHT}px"
  style:--tempo-height="{TEMPO_LANE_HEIGHT}px"
  style:--lane-height="{LANE_HEIGHT}px"
>
  <div class="scroller">
    <div class="headers">
      <div class="zoom">
        <div class="bar-tools">
          <button
            type="button"
            aria-label="Insert bars"
            title="Insert {bars.count === 1 ? 'a bar' : `${bars.count} bars`} {session.barSelection
              ? 'where the selection starts'
              : 'at the playhead'} (Ctrl+I). Shift-drag the ruler to select bars."
            onclick={() => session.insertBars()}>+ bar</button
          >
          <button
            type="button"
            aria-label="Delete bars"
            title="Delete {bars.count === 1
              ? 'the bar'
              : `${bars.count} bars`} {session.barSelection
              ? 'selected'
              : 'at the playhead'} (Ctrl+Delete). Shift-drag the ruler to select bars."
            onclick={() => session.deleteBars()}>− bar</button
          >
        </div>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out (Ctrl+wheel)"
          onclick={() => zoom(0.7)}>−</button
        >
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in (Ctrl+wheel)"
          onclick={() => zoom(1.4)}>+</button
        >
      </div>
      <div class="tempo-corner" hidden={!showTempo}>
        <span class="tempo-label">Tempo</span>
      </div>
      {#each tracks as track, i (track.id)}
        <button
          type="button"
          class="lane-header"
          class:selected={session.selectedTrackIndex === i}
          class:affected={reach?.trackIds.has(track.id) ?? false}
          style:--color={trackColor(i)}
          aria-label="Select {track.name}"
          aria-pressed={session.selectedTrackIndex === i}
          onclick={() => session.selectTrack(i)}
        >
          <span class="number">{i + 1}</span>
          <span class="name">{track.name}</span>
        </button>
      {/each}
    </div>
    <div class="timeline" bind:clientWidth={width}>
      <canvas
        bind:this={canvas}
        class="timeline-canvas"
        style:height="{height}px"
        aria-label="Timeline"
        {onpointerdown}
        {onpointermove}
        {onpointerup}
        onpointercancel={onpointerup}
        {ondblclick}
      ></canvas>
      {#if meterEdit}
        <form
          class="meter-edit"
          style:left="{meterEdit.x}px"
          style:top="{RULER_HEIGHT + TEMPO_LINE_HEIGHT}px"
          aria-label="Time signature"
          onsubmit={(e) => {
            e.preventDefault();
            applyMeter();
          }}
        >
          <span class="meter-title">Bar {meterEdit.bar}</span>
          <input
            type="number"
            min="1"
            max="16"
            aria-label="Beats per bar"
            bind:value={meterEdit.numerator}
            onkeydown={closeOnEscape}
          />
          <span>/</span>
          <select
            aria-label="Beat value"
            bind:value={meterEdit.denominator}
            onkeydown={closeOnEscape}
          >
            {#each [2, 4, 8, 16] as d (d)}
              <option value={d}>{d}</option>
            {/each}
          </select>
          <span
            class="meter-sub"
            title="How the grid divides a beat: 4 for sixteenths in x/4, 3 for triplets, 5 for quintuplets…"
            >÷</span
          >
          <select
            aria-label="Subdivision"
            bind:value={meterEdit.subdivision}
            onkeydown={closeOnEscape}
          >
            {#each SUBDIVISIONS as parts (parts)}
              <option value={parts}>{parts}</option>
            {/each}
          </select>
          <span class="meter-sub">per beat</span>
          <button type="submit" class="primary">Set</button>
          {#if meterEdit.existing}
            <button type="button" onclick={removeMeter}>Delete</button>
          {/if}
          <button type="button" aria-label="Cancel" onclick={() => (meterEdit = null)}>✕</button>
        </form>
      {/if}
      {#if session.countIn > 0}
        <div class="count-in" role="status" aria-label="Count-in">
          {#key session.countIn}<span>{session.countIn}</span>{/key}
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  .arrangement {
    --header-width: 120px;
    display: flex;
    min-width: 0;
    min-height: 0;
    background: var(--screen);
    color: var(--screen-ink);
  }

  .scroller {
    flex: 1;
    display: flex;
    align-items: flex-start;
    overflow-y: auto;
    min-height: 0;
  }

  .headers {
    width: var(--header-width);
    flex-shrink: 0;
    position: sticky;
    left: 0;
  }

  .zoom {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    height: var(--ruler-height);
    padding: 0 var(--space-1);
    border-bottom: 1px solid var(--screen-line-strong);
  }

  .tempo-corner {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    height: var(--tempo-height);
    padding: 3px var(--space-1) 3px var(--space-2);
    border-bottom: 1px solid var(--screen-line-strong);
    background: var(--screen-raised);
  }

  .tempo-corner[hidden] {
    display: none;
  }

  .tempo-label {
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--c-orange);
  }

  .bar-tools {
    display: flex;
    gap: 2px;
    margin-right: auto;
  }

  .bar-tools button {
    height: 18px;
    padding: 0 var(--space-1);
    border-radius: var(--r-s);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--screen-ink-dim);
  }

  .bar-tools button:hover {
    color: var(--screen-ink);
    background: var(--screen-line);
  }

  .meter-edit {
    position: absolute;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--r-m);
    background: var(--panel-raised);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.35);
    color: var(--ink);
    font-size: var(--text-s);
  }

  .meter-edit input {
    width: 44px;
  }

  .meter-edit input,
  .meter-edit select {
    height: 24px;
    border: 1px solid var(--line);
    border-radius: var(--r-s);
    background: var(--panel);
    color: var(--ink);
    font: inherit;
  }

  .meter-edit button {
    height: 24px;
    padding: 0 var(--space-2);
    border-radius: var(--r-s);
    font-weight: 600;
  }

  .meter-edit .primary {
    background: var(--accent);
    color: var(--ink-on-color);
  }

  .meter-sub {
    color: var(--ink-dim);
    margin-left: var(--space-1);
  }

  .meter-title {
    font-weight: 700;
    margin-right: var(--space-1);
  }

  .zoom > button {
    position: relative;
    width: 20px;
    height: 18px;
    border-radius: var(--r-s);
    color: var(--screen-ink-dim);
    font-size: var(--text-m);
    line-height: 1;
  }

  .zoom > button::after {
    content: '';
    position: absolute;
    inset: -4px -1px;
  }

  .zoom > button:hover {
    background: var(--screen-raised);
    color: var(--screen-ink);
  }

  .lane-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: var(--lane-height);
    padding: 0 var(--space-3);
    border-left: 4px solid var(--color);
    border-bottom: 1px solid var(--screen-line);
    background: var(--screen-raised);
    text-align: left;
  }

  .lane-header.selected {
    background: color-mix(in srgb, var(--color) 22%, var(--screen-raised));
  }

  /* An edit in the preset editor would change this track's preset: a white-ish tint. */
  .lane-header.affected {
    background: color-mix(in srgb, #fff 16%, var(--screen-raised));
  }

  .lane-header.selected.affected {
    background: color-mix(
      in srgb,
      #fff 16%,
      color-mix(in srgb, var(--color) 22%, var(--screen-raised))
    );
  }

  .number {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color);
  }

  .name {
    font-size: var(--text-s);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .timeline {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  /* Count-in before recording: a big beat number over the timeline, popping on each beat. */
  .count-in {
    position: absolute;
    top: 48px;
    left: 50%;
    transform: translateX(-50%);
    display: grid;
    place-items: center;
    width: 96px;
    height: 96px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--c-red) 85%, transparent);
    color: #fff;
    font-family: var(--font-mono);
    font-size: 48px;
    font-weight: 800;
    pointer-events: none;
  }

  .count-in span {
    animation: count-pop 0.3s ease-out;
  }

  @keyframes count-pop {
    from {
      transform: scale(1.5);
      opacity: 0.4;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .count-in span {
      animation: none;
    }
  }

  .timeline-canvas {
    display: block;
    width: 100%;
    touch-action: none;
  }
</style>
