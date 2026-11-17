import { mount } from 'svelte';
import App from './App.svelte';
import { libraryStore } from './ui/state/library.svelte';
import { session } from './ui/state/session.svelte';
import '@fontsource/barlow-semi-condensed/latin-300.css';
import '@fontsource/barlow-semi-condensed/latin-400.css';
import '@fontsource/barlow-semi-condensed/latin-500.css';
import '@fontsource/barlow-semi-condensed/latin-600.css';
import './ui/styles/tokens.css';
import './ui/styles/global.css';

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app element');

export default mount(App, { target });

// Handle for debugging in the console and for the automation driver (.claude/skills/run-chip-daw).
(window as unknown as { chipDaw: unknown }).chipDaw = { session };

// Bring back the autosaved project, and save right away when the page is hidden or closed.
void session.restoreAutosave();
void libraryStore.load();
window.addEventListener('pagehide', () => void session.flushAutosave());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) void session.flushAutosave();
});
