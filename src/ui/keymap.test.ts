import { describe, expect, it } from 'vitest';
import { comboFromEvent } from './keymap';

const key = (
  key: string,
  code: string,
  mods: Partial<Record<'ctrl' | 'meta' | 'shift' | 'alt', boolean>> = {},
) => ({
  key,
  code,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

describe('comboFromEvent', () => {
  it('treats Ctrl and Cmd as "mod"', () => {
    expect(comboFromEvent(key('z', 'KeyZ', { ctrl: true }))).toBe('mod+z');
    expect(comboFromEvent(key('z', 'KeyZ', { meta: true }))).toBe('mod+z');
  });

  it('lower-cases shifted letters', () => {
    expect(comboFromEvent(key('Z', 'KeyZ', { ctrl: true, shift: true }))).toBe('mod+shift+z');
  });

  it('names the space bar', () => {
    expect(comboFromEvent(key(' ', 'Space'))).toBe('space');
  });

  it('uses the physical key for digits', () => {
    expect(comboFromEvent(key('1', 'Digit1'))).toBe('digit1');
    // AZERTY: the unshifted "1" key produces "&"
    expect(comboFromEvent(key('&', 'Digit1'))).toBe('digit1');
  });
});
