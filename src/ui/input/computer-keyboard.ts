import { isTextInput } from '../keymap';

/**
 * Computer keyboard as a piano, using physical key positions (works on any layout):
 *
 *    W E   T Y U   O P        black keys
 *   A S D F G H J K L ;       white keys, A = C of the current octave
 *
 * Z / X: octave down / up. C / V: velocity down / up.
 */
export const PIANO_KEYS: Readonly<Record<string, number>> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
};

export const MIN_OCTAVE = 0;
export const MAX_OCTAVE = 8;
/** Velocities the C / V keys step through. */
export const VELOCITY_LEVELS = [20, 40, 60, 80, 100, 127] as const;

/** Next velocity level in `direction` from `current` (which need not be a level itself). */
export function shiftVelocity(current: number, direction: 1 | -1): number {
  if (direction > 0) return VELOCITY_LEVELS.find((v) => v > current) ?? 127;
  return [...VELOCITY_LEVELS].reverse().find((v) => v < current) ?? VELOCITY_LEVELS[0];
}

/** MIDI pitch for a piano key in `octave` (octave 4: A = C4 = MIDI 60), or null. */
export function pianoPitch(code: string, octave: number): number | null {
  const offset = PIANO_KEYS[code];
  if (offset === undefined) return null;
  const pitch = (octave + 1) * 12 + offset;
  return pitch >= 0 && pitch <= 127 ? pitch : null;
}

/** Note name like "C4" for a MIDI pitch. */
export function noteName(pitch: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

export interface KeyboardPianoHandlers {
  /** When false, the keyboard doesn't play (its keys are left to the keymap as shortcuts). */
  enabled(): boolean;
  octave(): number;
  noteOn(pitch: number): void;
  noteOff(pitch: number): void;
  shiftOctave(delta: 1 | -1): void;
  shiftVelocity(delta: 1 | -1): void;
}

/**
 * Listens for piano keys on the window. Keys with Ctrl/Cmd/Alt are left to the keymap,
 * and typing in text fields is ignored. Held notes are released when the window loses focus.
 */
export function installComputerKeyboard(handlers: KeyboardPianoHandlers): () => void {
  /** Physical key → pitch it started, so octave changes while holding don't strand notes. */
  const held = new Map<string, number>();

  const releaseAll = () => {
    for (const pitch of held.values()) handlers.noteOff(pitch);
    held.clear();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || isTextInput(event.target)) return;
    if (!handlers.enabled()) return;
    const control = {
      KeyZ: () => handlers.shiftOctave(-1),
      KeyX: () => handlers.shiftOctave(1),
      KeyC: () => handlers.shiftVelocity(-1),
      KeyV: () => handlers.shiftVelocity(1),
    }[event.code];
    if (control) {
      event.preventDefault();
      if (!event.repeat) control();
      return;
    }
    const pitch = pianoPitch(event.code, handlers.octave());
    if (pitch === null) return;
    event.preventDefault();
    if (event.repeat || held.has(event.code)) return;
    held.set(event.code, pitch);
    handlers.noteOn(pitch);
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const pitch = held.get(event.code);
    if (pitch === undefined) return;
    held.delete(event.code);
    handlers.noteOff(pitch);
  };

  const onVisibility = () => {
    if (document.hidden) releaseAll();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    releaseAll();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', releaseAll);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
