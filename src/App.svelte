<script lang="ts">
  import Arrangement from './ui/arrangement/Arrangement.svelte';
  import LibraryPanel from './ui/library/LibraryPanel.svelte';
  import RightSidebar from './ui/layout/RightSidebar.svelte';
  import TopBar from './ui/layout/TopBar.svelte';
  import BottomPanel from './ui/editor/BottomPanel.svelte';
  import { installComputerKeyboard } from './ui/input/computer-keyboard';
  import { installKeymap, type KeyHandler } from './ui/keymap';
  import { setTrackMute, setTrackSolo } from './model/commands';
  import { libraryStore } from './ui/state/library.svelte';
  import { BOTTOM_MIN_HEIGHT, session } from './ui/state/session.svelte';

  let windowHeight = $state(0);
  /** Room the top bar and the arrangement keep however tall the bottom panel is dragged. */
  const KEEP_ABOVE = 260;
  /** The bottom panel's height as shown: what was set, within what the window allows. */
  const bottomHeight = $derived(
    Math.max(BOTTOM_MIN_HEIGHT, Math.min(session.bottomHeight, windowHeight - KEEP_ABOVE)),
  );

  /**
   * A shortcut that only applies while the computer keyboard piano is off (its letter keys play
   * notes otherwise). Returning false leaves the key alone.
   */
  const whenPianoOff =
    (action: () => void | boolean): KeyHandler =>
    () =>
      session.keyboardPiano ? false : action();

  /**
   * While browsing the library (I), these keys move through it instead of doing `normal`.
   */
  const orBrowse =
    (action: Parameters<typeof libraryStore.browse>[0], normal: KeyHandler): KeyHandler =>
    (event) => {
      if (!libraryStore.browsing) return normal(event);
      if (!event.repeat || action !== 'enter') libraryStore.browse(action);
    };

  /**
   * M / S held: a number key mutes / solos that track; released without one, the selected
   * track. Only with the keyboard piano off (S plays a note otherwise).
   */
  let held: { kind: 'mute' | 'solo'; used: boolean } | null = null;

  function toggleTrack(kind: 'mute' | 'solo', index: number) {
    const track = session.project.tracks[index];
    if (!track) return;
    session.run(
      kind === 'mute' ? setTrackMute(track.id, !track.mute) : setTrackSolo(track.id, !track.solo),
    );
  }

  const hold =
    (kind: 'mute' | 'solo'): KeyHandler =>
    (event) => {
      if (session.keyboardPiano) return false;
      if (!event.repeat || !held) held = { kind, used: false };
    };

  $effect(() => {
    const onKeyUp = (event: KeyboardEvent) => {
      const kind = { KeyM: 'mute', KeyS: 'solo' }[event.code];
      if (!held || held.kind !== kind) return;
      if (!held.used) toggleTrack(held.kind, session.selectedTrackIndex);
      held = null;
    };
    const forget = () => (held = null);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', forget);
    return () => {
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', forget);
    };
  });

  /** Enter opens the selected clip, unless a button or link has focus (Enter presses it). */
  const enter: KeyHandler = (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('button, a, [role="button"], [role="tab"]')) {
      return false;
    }
    if (session.keyboardPiano) return false;
    session.openSelectedClip();
  };

  // All keyboard shortcuts live here.
  $effect(() => {
    const bindings: Record<string, KeyHandler> = {
      'mod+z': () => session.undo(),
      'mod+shift+z': () => session.redo(),
      'mod+y': () => session.redo(),
      escape: () => {
        session.allNotesOff();
        if (libraryStore.browsing) libraryStore.browsing = false;
        else session.clearSelection();
      },
      space: () => session.togglePlay(),
      home: () => session.seek(0),
      // These act on notes when the piano roll was clicked last, otherwise on clips.
      delete: () => session.deleteSelection(),
      backspace: () => session.deleteSelection(),
      'mod+a': () => session.selectAll(),
      'mod+c': () => session.copySelection(),
      'mod+v': () => session.paste(),
      'mod+d': () => session.duplicateSelection(),
      // Bars: the ones selected on the ruler (Shift-drag), or the bar at the playhead.
      'mod+i': () => session.insertBars(),
      'mod+delete': () => session.deleteBars(),
      'mod+backspace': () => session.deleteBars(),
      // Piano roll: transpose / move selected notes. Otherwise up/down select the track
      // above/below and left/right move the playhead a bar (each selecting the clip under the
      // playhead). Arrows don't play notes, so they work with the keyboard piano on too.
      arrowup: orBrowse('up', () => session.nudgeNotes(1, 0) || session.stepTrack(-1)),
      arrowdown: orBrowse('down', () => session.nudgeNotes(-1, 0) || session.stepTrack(1)),
      'shift+arrowup': () => session.nudgeNotes(12, 0),
      'shift+arrowdown': () => session.nudgeNotes(-12, 0),
      arrowleft: orBrowse('left', () => session.nudgeNotes(0, -1) || session.stepBar(-1)),
      arrowright: orBrowse('right', () => session.nudgeNotes(0, 1) || session.stepBar(1)),
      // The key left of 1 turns the computer keyboard piano on and off.
      backquote: () => session.toggleKeyboardPiano(),
      // With the keyboard piano off, letter keys are shortcuts.
      r: whenPianoOff(() => session.toggleRecord()),
      o: whenPianoOff(() => session.toggleOverdub()),
      c: whenPianoOff(() => session.toggleMetronome()),
      m: hold('mute'),
      l: whenPianoOff(() => session.toggleLoop()),
      a: orBrowse(
        'left',
        whenPianoOff(() => session.jumpToClipEdge(-1)),
      ),
      d: orBrowse(
        'right',
        whenPianoOff(() => session.jumpToClipEdge(1)),
      ),
      w: orBrowse('up', () => false),
      s: orBrowse('down', hold('solo')),
      enter: orBrowse('enter', enter),
      // I (for instrument) turns library browsing on and off; I isn't a piano key.
      i: () => libraryStore.toggleBrowsing(),
      u: whenPianoOff(() => session.clipPresetShortcut('unique')),
      p: whenPianoOff(() => session.clipPresetShortcut('useTrack')),
      t: whenPianoOff(() => session.clipPresetShortcut('loadToTrack')),
      // Files.
      'mod+s': () => void session.exportProject(),
      'mod+o': () => void session.importProject(),
    };
    // Number keys select a track, or with M / S held mute / solo it.
    for (let i = 0; i < 9; i++) {
      bindings[`digit${i + 1}`] = () => {
        if (!held) return session.selectTrack(i);
        held.used = true;
        toggleTrack(held.kind, i);
      };
    }
    return installKeymap(bindings);
  });

  // The computer keyboard plays notes on the selected track.
  $effect(() =>
    installComputerKeyboard({
      enabled: () => session.keyboardPiano && !libraryStore.browsing,
      octave: () => session.keyboardOctave,
      noteOn: (pitch) => session.noteOn('keyboard', pitch, session.keyboardVelocity),
      noteOff: (pitch) => session.noteOff('keyboard', pitch),
      shiftOctave: (delta) => session.shiftOctave(delta),
      shiftVelocity: (delta) => session.shiftVelocity(delta),
    }),
  );

  // Browsers only allow audio after a user gesture, so start it on the first interaction.
  $effect(() => {
    const start = () => {
      window.removeEventListener('pointerdown', start, true);
      window.removeEventListener('keydown', start, true);
      void session.startAudio();
    };
    window.addEventListener('pointerdown', start, true);
    window.addEventListener('keydown', start, true);
    return () => {
      window.removeEventListener('pointerdown', start, true);
      window.removeEventListener('keydown', start, true);
    };
  });
</script>

<svelte:window bind:innerHeight={windowHeight} />

<div
  class="app"
  style:--bottom-height="{bottomHeight}px"
  style:--bottom-extra="{bottomHeight - BOTTOM_MIN_HEIGHT}px"
>
  <div class="top"><TopBar /></div>
  <div class="left"><LibraryPanel /></div>
  <div class="center"><Arrangement /></div>
  <div class="right"><RightSidebar /></div>
  <div class="bottom"><BottomPanel /></div>
</div>

<style>
  .app {
    display: grid;
    height: 100%;
    grid-template-columns: 220px minmax(0, 1fr) 280px;
    /* The preset editor and the piano roll share one height (adjustable from the panel's top
       edge): switching tabs doesn't move the arrangement. */
    grid-template-rows: auto minmax(0, 1fr) var(--bottom-height);
    grid-template-areas:
      'top top top'
      'left center right'
      'bottom bottom bottom';
  }

  /* Each area fills its grid cell and never grows past it: wide content (a long preset chain)
     scrolls inside its own panel instead of stretching the page. */
  .app > div {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
    min-width: 0;
  }

  .top {
    grid-area: top;
  }
  .left {
    grid-area: left;
  }
  .center {
    grid-area: center;
  }
  .right {
    grid-area: right;
  }
  .bottom {
    grid-area: bottom;
  }

  /* Narrow screens (proper tablet layouts come in Phase 6): drop the library, slim the mixer. */
  @media (max-width: 900px) {
    .app {
      grid-template-columns: minmax(0, 1fr) 240px;
      grid-template-areas:
        'top top'
        'center right'
        'bottom bottom';
    }
    .left {
      display: none !important;
    }
  }
</style>
