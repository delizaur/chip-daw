import { QUEUED_MESSAGE_TYPES, type EngineToUi, type UiToEngine } from '../engine/protocol';
import workletUrl from './engine.worklet.ts?worker&url';

// Must match PROCESSOR_NAME in engine.worklet.ts (not imported, so the worklet isn't bundled twice).
const PROCESSOR_NAME = 'chip-engine';

type Listener = (message: EngineToUi) => void;

/** Main-thread handle to the audio engine running in the AudioWorklet. */
export class EngineBridge {
  #context: AudioContext | null = null;
  #node: AudioWorkletNode | null = null;
  #starting: Promise<void> | null = null;
  #pending: UiToEngine[] = [];
  #listeners = new Set<Listener>();

  get running(): boolean {
    return this.#context?.state === 'running';
  }

  /**
   * Creates the AudioContext and engine (or resumes it). Browsers only allow this from a user
   * gesture. `initialMessages` (the project snapshot and transport settings) is read once the
   * engine is ready, so no edits made while loading are lost.
   */
  start(initialMessages: () => UiToEngine[]): Promise<void> {
    if (this.#context) return this.#context.resume();
    this.#starting ??= this.#create(initialMessages).finally(() => (this.#starting = null));
    return this.#starting;
  }

  async #create(initialMessages: () => UiToEngine[]): Promise<void> {
    const context = new AudioContext({ latencyHint: 'interactive' });
    try {
      await context.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      node.port.onmessage = (event: MessageEvent<EngineToUi>) => {
        for (const listener of this.#listeners) listener(event.data);
      };
      node.connect(context.destination);
      this.#context = context;
      this.#node = node;
      for (const message of initialMessages()) this.send(message);
      for (const message of this.#pending.splice(0)) this.send(message);
      await context.resume();
      // Known once running: how late what we play reaches the speakers.
      const latency = (context.outputLatency || 0) + context.baseLatency;
      this.send({ type: 'setLatency', seconds: latency });
    } catch (error) {
      this.#pending = [];
      await context.close();
      throw error;
    }
  }

  /**
   * Sends a message to the engine. Before the engine exists, project patches are dropped
   * (the engine loads a fresh snapshot when it starts), but notes and transport commands sent
   * while audio is starting are queued, so the key press that starts audio still sounds.
   */
  send(message: UiToEngine): void {
    if (this.#node) {
      this.#node.port.postMessage(message);
    } else if (this.#starting && QUEUED_MESSAGE_TYPES.has(message.type)) {
      this.#pending.push(message);
    }
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
