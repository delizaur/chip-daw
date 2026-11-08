/** Shared helpers for the canvas views (arrangement timeline, piano roll). */

export type ColorResolver = (value: string) => string;

/** Resolves "var(--name)" colors for the canvas, which can't read CSS variables itself. */
export function colorResolver(element: Element): ColorResolver {
  const style = getComputedStyle(element);
  const cache = new Map<string, string>();
  return (value: string) => {
    let resolved = cache.get(value);
    if (resolved === undefined) {
      const match = /^var\((--[\w-]+)\)$/.exec(value);
      resolved = match ? style.getPropertyValue(match[1]!).trim() : value;
      cache.set(value, resolved);
    }
    return resolved;
  };
}

/** Starts a rounded-rectangle path (fill or stroke it after). */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

/**
 * Sizes a canvas for the device pixel ratio and returns a context that draws in CSS pixels.
 */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}
