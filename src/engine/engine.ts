import { applyPatches, enablePatches } from 'immer';
import type { Project } from '../model/types';
import { SmoothedValue, softClip, volumeToGain } from './dsp';
import type { EngineToUi, UiToEngine } from './protocol';
import { TestTone } from './test-tone';

enablePatches();

/** How often meters are reported to the UI. */
const METER_RATE_HZ = 30;

/**
 * The audio engine. Pure TypeScript: no DOM, Web Audio or Node APIs, so it can run inside
 * the AudioWorklet, in a Worker for offline rendering, and in unit tests.
 *
 * Real-time rule: `process` must not allocate. Allocation is only allowed in `handle`,
 * i.e. when the project changes. The one exception is the throttled meter message, since
 * posting a message to the UI allocates anyway.
 */
export class Engine {
  readonly sampleRate: number;
  #project: Project | null = null;
  readonly #emit: (message: EngineToUi) => void;
  readonly #testTone: TestTone;
  readonly #masterGain: SmoothedValue;
  readonly #meterInterval: number;
  #framesSinceMeter = 0;
  #masterPeak = 0;
  #lastReportedPeak = -1;

  constructor(sampleRate: number, emit: (message: EngineToUi) => void) {
    this.sampleRate = sampleRate;
    this.#emit = emit;
    this.#testTone = new TestTone(sampleRate);
    this.#masterGain = new SmoothedValue(0, sampleRate);
    this.#meterInterval = Math.round(sampleRate / METER_RATE_HZ);
  }

  get project(): Project | null {
    return this.#project;
  }

  handle(message: UiToEngine): void {
    switch (message.type) {
      case 'loadProject':
        this.#project = message.project;
        break;
      case 'applyPatches':
        if (this.#project) this.#project = applyPatches(this.#project, message.patches);
        break;
      case 'testTone':
        this.#testTone.settings = message.settings;
        break;
    }
  }

  /** Renders one block of stereo audio. `left` and `right` may be the same buffer. */
  process(left: Float32Array, right: Float32Array): void {
    this.#masterGain.target = this.#project ? volumeToGain(this.#project.masterVolume) : 0;
    let peak = this.#masterPeak;

    for (let i = 0; i < left.length; i++) {
      const sample = softClip(this.#testTone.next() * this.#masterGain.next());
      left[i] = sample;
      right[i] = sample;
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }

    this.#masterPeak = peak;
    this.#framesSinceMeter += left.length;
    if (this.#framesSinceMeter >= this.#meterInterval) this.#reportMeters();
  }

  #reportMeters(): void {
    // Skip repeated silence so an idle engine doesn't wake the UI 30 times a second.
    if (!(this.#masterPeak === 0 && this.#lastReportedPeak === 0)) {
      this.#emit({ type: 'meters', master: this.#masterPeak });
      this.#lastReportedPeak = this.#masterPeak;
    }
    this.#masterPeak = 0;
    this.#framesSinceMeter = 0;
  }
}
