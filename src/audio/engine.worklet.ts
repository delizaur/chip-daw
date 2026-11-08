/**
 * AudioWorklet entry point: a thin wrapper that hosts the pure-TS Engine on the audio thread.
 * Loaded by the bridge via Vite's `?worker&url` import, which bundles it into a single file.
 */
import { Engine } from '../engine/engine';
import type { EngineToUi, UiToEngine } from '../engine/protocol';

// AudioWorkletGlobalScope globals. Declared here (not globally) so they don't leak into UI code.
declare const sampleRate: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

// Must match PROCESSOR_NAME in bridge.ts.
const PROCESSOR_NAME = 'chip-engine';

class ChipEngineProcessor extends AudioWorkletProcessor {
  readonly #engine = new Engine(sampleRate, (message) => this.#send(message));
  /** Report each kind of failure once, not 375 times a second. */
  #reportedError = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<UiToEngine>) => {
      try {
        this.#engine.handle(event.data);
      } catch (error) {
        this.#fail(error);
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    const left = output?.[0];
    if (!left) return true;
    try {
      this.#engine.process(left, output[1] ?? left);
    } catch (error) {
      // An uncaught exception would kill the processor silently (no sound, frozen playhead).
      // Output silence for this block and tell the UI instead.
      left.fill(0);
      output[1]?.fill(0);
      this.#fail(error);
    }
    return true;
  }

  #send(message: EngineToUi): void {
    this.port.postMessage(message);
  }

  #fail(error: unknown): void {
    if (this.#reportedError) return;
    this.#reportedError = true;
    const message =
      error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    this.#send({ type: 'error', message });
  }
}

registerProcessor(PROCESSOR_NAME, ChipEngineProcessor);
