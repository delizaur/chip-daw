import { clamp, valueAt, valueForKey, type Scale } from './scale';

export interface LinearRangeOptions {
  value: number;
  min: number;
  max: number;
  step?: number;
  scale?: Scale;
  defaultValue: number;
  disabled: boolean;
  orientation: 'horizontal' | 'vertical';
  /** Pixels at each end of the element the value can't reach (e.g. a round thumb's radius). */
  inset: (rect: DOMRect) => number;
  oninput: (value: number) => void;
  onstart?: () => void;
  onend?: () => void;
}

/**
 * Interaction shared by linear controls (Slider, MeterFader): press to jump to the pointer,
 * drag to adjust, double-click to reset, arrow keys when focused. `onstart`/`onend` bracket
 * each gesture so it becomes one undo step.
 *
 * Spread the result onto the control element: `<div {...handlers}>`. `get` is called on every
 * event, so handlers always see the component's current props.
 */
export function linearRangeHandlers(get: () => LinearRangeOptions) {
  let pointerId: number | null = null;

  const emit = (next: number) => {
    const options = get();
    if (next !== options.value) options.oninput(next);
  };

  const valueAtPointer = (event: PointerEvent) => {
    const options = get();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const inset = options.inset(rect);
    const n =
      options.orientation === 'horizontal'
        ? (event.clientX - rect.left - inset) / (rect.width - 2 * inset)
        : (rect.bottom - event.clientY - inset) / (rect.height - 2 * inset);
    return valueAt(clamp(n, 0, 1), options);
  };

  const onpointerup = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    get().onend?.();
  };

  return {
    onpointerdown(event: PointerEvent) {
      const options = get();
      if (options.disabled || event.button !== 0) return;
      event.preventDefault();
      const element = event.currentTarget as HTMLElement;
      element.focus();
      element.setPointerCapture(event.pointerId);
      pointerId = event.pointerId;
      options.onstart?.();
      emit(valueAtPointer(event));
    },
    onpointermove(event: PointerEvent) {
      if (event.pointerId === pointerId) emit(valueAtPointer(event));
    },
    onpointerup,
    onpointercancel: onpointerup,
    ondblclick() {
      const options = get();
      if (options.disabled) return;
      options.onstart?.();
      emit(options.defaultValue);
      options.onend?.();
    },
    onkeydown(event: KeyboardEvent) {
      const options = get();
      if (options.disabled) return;
      const next = valueForKey(event.key, event.shiftKey, options.value, options);
      if (next === null) return;
      event.preventDefault();
      options.onstart?.();
      emit(next);
      options.onend?.();
    },
  };
}
