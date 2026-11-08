/**
 * Central keyboard shortcut handling. All shortcuts are declared in one place (App.svelte)
 * instead of scattered listeners, so conflicts are easy to see.
 *
 * Combos are written like "mod+shift+z" ("mod" = Ctrl on Windows/Linux, Cmd on macOS).
 * Digits use the physical key ("digit1"), so track keys work on any keyboard layout.
 */
/** Return false to leave the key unhandled (its default behaviour then happens). */
export type KeyHandler = (event: KeyboardEvent) => void | boolean;

type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'
>;

export function comboFromEvent(event: KeyEventLike): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('mod');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  if (/^Digit\d$/.test(event.code)) parts.push(event.code.toLowerCase());
  else if (event.key === ' ') parts.push('space');
  else parts.push(event.key.toLowerCase());
  return parts.join('+');
}

/** True for elements where keys should type text instead of triggering shortcuts. */
export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return (
    target instanceof HTMLInputElement &&
    !['checkbox', 'radio', 'range', 'button'].includes(target.type)
  );
}

export function installKeymap(bindings: Record<string, KeyHandler>): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    // A focused control (knob, slider...) that used the key has already prevented its default.
    if (event.defaultPrevented || isTextInput(event.target)) return;
    const handler = bindings[comboFromEvent(event)];
    if (!handler) return;
    if (handler(event) !== false) event.preventDefault();
  };
  // Buttons activate on Space's keyup; stop that when Space is a shortcut (play/pause), so a
  // focused button isn't pressed as well.
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === ' ' && bindings.space && !isTextInput(event.target)) event.preventDefault();
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}
