<script lang="ts">
  import Arrangement from './ui/arrangement/Arrangement.svelte';
  import LibraryPanel from './ui/library/LibraryPanel.svelte';
  import RightSidebar from './ui/layout/RightSidebar.svelte';
  import TopBar from './ui/layout/TopBar.svelte';
  import BottomPanel from './ui/editor/BottomPanel.svelte';
  import { installComputerKeyboard } from './ui/input/computer-keyboard';
  import { installKeymap, type KeyHandler } from './ui/keymap';
  import { session } from './ui/state/session.svelte';

  /**
   * A shortcut that only applies while the computer keyboard piano is off (its letter keys play
   * notes otherwise). Returning false leaves the key alone.
   */
  const whenPianoOff =
    (action: () => void | boolean): KeyHandler =>
    () =>
      session.keyboardPiano ? false : action();

  /** Arrows: nudge selected notes in the piano roll; else, with the piano off, select clips. */
  const arrow =
    (nudge: () => boolean, direction: 'left' | 'right' | 'up' | 'down'): KeyHandler =>
    () =>
      nudge() || (!session.keyboardPiano && session.selectAdjacentClip(direction));

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
        session.clearSelection();
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
      // Piano roll: transpose / move selected notes. With the keyboard piano off, otherwise
      // select the neighbouring clip. Unhandled otherwise (keeps scrolling).
      arrowup: arrow(() => session.nudgeNotes(1, 0), 'up'),
      arrowdown: arrow(() => session.nudgeNotes(-1, 0), 'down'),
      'shift+arrowup': () => session.nudgeNotes(12, 0),
      'shift+arrowdown': () => session.nudgeNotes(-12, 0),
      arrowleft: arrow(() => session.nudgeNotes(0, -1), 'left'),
      arrowright: arrow(() => session.nudgeNotes(0, 1), 'right'),
      // The key left of 1 turns the computer keyboard piano on and off.
      backquote: () => session.toggleKeyboardPiano(),
      // With the keyboard piano off, letter keys are shortcuts.
      r: whenPianoOff(() => session.toggleRecord()),
      o: whenPianoOff(() => session.toggleOverdub()),
      m: whenPianoOff(() => session.toggleMetronome()),
      l: whenPianoOff(() => session.toggleLoop()),
      a: whenPianoOff(() => session.jumpToClipEdge(-1)),
      d: whenPianoOff(() => session.jumpToClipEdge(1)),
      enter,
      u: whenPianoOff(() => session.clipPresetShortcut('unique')),
      p: whenPianoOff(() => session.clipPresetShortcut('useTrack')),
      t: whenPianoOff(() => session.clipPresetShortcut('loadToTrack')),
      // Files.
      'mod+s': () => void session.exportProject(),
      'mod+o': () => void session.importProject(),
    };
    for (let i = 0; i < 9; i++) bindings[`digit${i + 1}`] = () => session.selectTrack(i);
    return installKeymap(bindings);
  });

  // The computer keyboard plays notes on the selected track.
  $effect(() =>
    installComputerKeyboard({
      enabled: () => session.keyboardPiano,
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

<div class="app" style:--bottom-height={session.bottomTab === 'pianoRoll' ? '380px' : '300px'}>
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
