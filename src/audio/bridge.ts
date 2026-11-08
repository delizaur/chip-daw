import type { Project } from '../model/types';
import type { EngineToUi, UiToEngine } from '../engine/protocol';
import workletUrl from './engine.worklet.ts?worker&url';

// Must match PROCESSOR_NAME in engine.worklet.ts (not imported, so the worklet isn't bundled twice).
const PROCESSOR_NAME = 'chip-engine';

type Listener = (message: EngineToUi) => void;

const LIVE_MESSAGES = new Set<UiToEngine['type']>(['noteOn', 'noteOff', 'allNotesOff']);

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
   * gesture. `getProject` is read once the engine is ready, so no edits made while loading are lost.
   */
  start(getProject: () => Project): Promise<void> {
    if (this.#context) return this.#context.resume();
    this.#starting ??= this.#create(getProject).finally(() => (this.#starting = null));
    return this.#starting;
  }

  async #create(getProject: () => Project): Promise<void> {
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
      this.send({ type: 'loadProject', project: getProject() });
      for (const message of this.#pending.splice(0)) this.send(message);
      await context.resume();
    } catch (error) {
      this.#pending = [];
      await context.close();
      throw error;
    }
  }

  /**
   * Sends a message to the engine. Before the engine exists, project patches are dropped
   * (the engine loads a fresh snapshot when it starts), but live notes played while audio is
   * starting are queued, so the key press that starts audio still sounds.
   */
  send(message: UiToEngine): void {
    if (this.#node) {
      this.#node.port.postMessage(message);
    } else if (this.#starting && LIVE_MESSAGES.has(message.type)) {
      this.#pending.push(message);
    }
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
