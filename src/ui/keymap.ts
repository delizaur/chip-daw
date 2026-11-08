/**
 * Central keyboard shortcut handling. All shortcuts are declared in one place (App.svelte)
 * instead of scattered listeners, so conflicts are easy to see.
 *
 * Combos are written like "mod+shift+z" ("mod" = Ctrl on Windows/Linux, Cmd on macOS).
 * Digits use the physical key ("digit1"), so track keys work on any keyboard layout.
 */
export type KeyHandler = (event: KeyboardEvent) => void;

type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'
>;

export function comboFromEvent(event: KeyEventLike): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('mod');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(/^Digit\d$/.test(event.code) ? event.code.toLowerCase() : event.key.toLowerCase());
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
    if (isTextInput(event.target)) return;
    const handler = bindings[comboFromEvent(event)];
    if (!handler) return;
    event.preventDefault();
    handler(event);
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
