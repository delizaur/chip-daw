/**
 * AudioWorklet entry point: a thin wrapper that hosts the pure-TS Engine on the audio thread.
 * Loaded by the bridge via Vite's `?worker&url` import, which bundles it into a single file.
 */
import { Engine } from '../engine/engine';
import type { UiToEngine } from '../engine/protocol';

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
  readonly #engine = new Engine(sampleRate, (message) => this.port.postMessage(message));

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<UiToEngine>) => this.#engine.handle(event.data);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    const left = output?.[0];
    if (!left) return true;
    this.#engine.process(left, output[1] ?? left);
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, ChipEngineProcessor);
