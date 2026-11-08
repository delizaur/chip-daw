<script lang="ts">
  import Arrangement from './ui/layout/Arrangement.svelte';
  import BottomPanel from './ui/layout/BottomPanel.svelte';
  import LeftSidebar from './ui/layout/LeftSidebar.svelte';
  import RightSidebar from './ui/layout/RightSidebar.svelte';
  import TopBar from './ui/layout/TopBar.svelte';
  import { installKeymap, type KeyHandler } from './ui/keymap';
  import { session } from './ui/state/session.svelte';

  // All keyboard shortcuts live here.
  $effect(() => {
    const bindings: Record<string, KeyHandler> = {
      'mod+z': () => session.undo(),
      'mod+shift+z': () => session.redo(),
      'mod+y': () => session.redo(),
    };
    for (let i = 0; i < 9; i++) bindings[`digit${i + 1}`] = () => session.selectTrack(i);
    return installKeymap(bindings);
  });

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

<div class="app">
  <div class="top"><TopBar /></div>
  <div class="left"><LeftSidebar /></div>
  <div class="center"><Arrangement /></div>
  <div class="right"><RightSidebar /></div>
  <div class="bottom"><BottomPanel /></div>
</div>

<style>
  .app {
    display: grid;
    height: 100%;
    grid-template-columns: 220px minmax(0, 1fr) 280px;
    grid-template-rows: auto minmax(0, 1fr) 220px;
    grid-template-areas:
      'top top top'
      'left center right'
      'bottom bottom bottom';
  }

  .app > div {
    display: grid;
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
