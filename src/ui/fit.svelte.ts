/**
 * Fitting the app on small touch screens (phones, tablets) until the touch layouts of Phase 6:
 * the app is laid out at desktop size (at least MIN_WIDTH × MIN_HEIGHT) and scaled down with a
 * CSS transform to fill the screen, small but all of it showing. A taller screen (fullscreen,
 * without the browser's bars) gets a bigger scale.
 *
 * Done in the page rather than with the viewport meta tag (`width=1600`): Chrome-based mobile
 * browsers drop the meta tag's zoom in fullscreen and show the page at 1:1 there.
 *
 * Pointer positions in screen pixels have to be divided by `scale` to get layout pixels.
 * Desktop browsers (a fine pointer) always get scale 1.
 */
const MIN_WIDTH = 1600;
const MIN_HEIGHT = 760;

class Fit {
  /** Layout pixels to screen pixels (1: not scaled). */
  scale = $state(1);
  /** The app's size in layout pixels. */
  width = $state(0);
  height = $state(0);

  constructor() {
    if (typeof window === 'undefined') return;
    this.#update();
    window.addEventListener('resize', () => this.#update());
  }

  #update(): void {
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const scale = touch
      ? Math.min(1, window.innerWidth / MIN_WIDTH, window.innerHeight / MIN_HEIGHT)
      : 1;
    this.scale = scale;
    this.width = window.innerWidth / scale;
    this.height = window.innerHeight / scale;
  }
}

export const fit = new Fit();
