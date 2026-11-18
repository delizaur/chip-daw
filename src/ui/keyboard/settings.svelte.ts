import { SCALES, type ScaleId } from './keys';

const STORAGE_KEY = 'chip-daw.keyboardView';

interface Saved {
  noteNames: boolean;
  scaleOn: boolean;
  root: number;
  scale: ScaleId;
}

function load(): Partial<Saved> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown;
    return saved && typeof saved === 'object' ? (saved as Partial<Saved>) : {};
  } catch {
    return {};
  }
}

/**
 * The keyboard view's display options: note names and scale highlighting. A per-browser
 * preference (not part of the project), remembered in localStorage when it's available.
 */
class KeyboardViewSettings {
  noteNames = $state(false);
  scaleOn = $state(false);
  /** Pitch class of the scale's root (0 = C). */
  root = $state(0);
  scale = $state<ScaleId>('major');

  constructor() {
    const saved = load();
    if (typeof saved.noteNames === 'boolean') this.noteNames = saved.noteNames;
    if (typeof saved.scaleOn === 'boolean') this.scaleOn = saved.scaleOn;
    if (Number.isInteger(saved.root) && saved.root! >= 0 && saved.root! < 12)
      this.root = saved.root!;
    if (SCALES.some((s) => s.id === saved.scale)) this.scale = saved.scale!;
  }

  /** Changes options and remembers them. */
  set(changes: Partial<Saved>): void {
    Object.assign(this, changes);
    const saved: Saved = {
      noteNames: this.noteNames,
      scaleOn: this.scaleOn,
      root: this.root,
      scale: this.scale,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Storage blocked (private mode...): the options just aren't remembered.
    }
  }
}

export const keyboardView = new KeyboardViewSettings();
