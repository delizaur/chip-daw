import { applyPatches, enablePatches } from 'immer';
import type { Project } from '../model/types';
import { SmoothedValue, softClip, volumeToGain } from './dsp';
import type { EngineToUi, UiToEngine } from './protocol';
import { TrackRuntime } from './track';

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
  #tracks: TrackRuntime[] = [];
  readonly #tracksById = new Map<string, TrackRuntime>();
  readonly #masterGain: SmoothedValue;
  #mixLeft = new Float32Array(128);
  #mixRight = new Float32Array(128);
  readonly #meterInterval: number;
  #framesSinceMeter = 0;
  #masterPeak = 0;
  #lastReportedPeak = -1;

  constructor(sampleRate: number, emit: (message: EngineToUi) => void) {
    this.sampleRate = sampleRate;
    this.#emit = emit;
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
        this.#sync();
        break;
      case 'applyPatches':
        if (!this.#project) break;
        this.#project = applyPatches(this.#project, message.patches);
        this.#sync();
        break;
      case 'noteOn':
        this.#tracksById.get(message.trackId)?.noteOn(message.pitch, message.velocity);
        break;
      case 'noteOff':
        this.#tracksById.get(message.trackId)?.noteOff(message.pitch);
        break;
      case 'allNotesOff':
        for (const track of this.#tracks) track.allNotesOff();
        break;
    }
  }

  /** Brings the runtime graph in line with the project. */
  #sync(): void {
    const project = this.#project;
    if (!project) return;
    this.#masterGain.target = volumeToGain(project.masterVolume);
    const anySolo = project.tracks.some((t) => t.solo);
    const seen = new Set<string>();
    this.#tracks = project.tracks.map((track) => {
      let runtime = this.#tracksById.get(track.id);
      if (!runtime) {
        runtime = new TrackRuntime(track.id, this.sampleRate);
        this.#tracksById.set(track.id, runtime);
      }
      runtime.sync(track, !track.mute && (!anySolo || track.solo));
      seen.add(track.id);
      return runtime;
    });
    for (const id of this.#tracksById.keys()) if (!seen.has(id)) this.#tracksById.delete(id);
  }

  /** Renders one block of stereo audio. `left` and `right` may be the same buffer. */
  process(left: Float32Array, right: Float32Array): void {
    const frames = left.length;
    if (this.#mixLeft.length < frames) {
      this.#mixLeft = new Float32Array(frames);
      this.#mixRight = new Float32Array(frames);
    }
    const mixLeft = this.#mixLeft;
    const mixRight = this.#mixRight;
    mixLeft.fill(0, 0, frames);
    mixRight.fill(0, 0, frames);
    for (const track of this.#tracks) track.process(mixLeft, mixRight, frames);

    let peak = this.#masterPeak;
    for (let i = 0; i < frames; i++) {
      const gain = this.#masterGain.next();
      const l = softClip(mixLeft[i]! * gain);
      const r = softClip(mixRight[i]! * gain);
      left[i] = l;
      right[i] = r;
      const magnitude = Math.max(Math.abs(l), Math.abs(r));
      if (magnitude > peak) peak = magnitude;
    }

    this.#masterPeak = peak;
    this.#framesSinceMeter += frames;
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
