import { EngineBridge } from '../../audio/bridge';
import type { TestToneSettings } from '../../engine/protocol';
import type { ProjectCommand } from '../../model/commands';
import { createProject } from '../../model/defaults';
import { History } from '../../model/history';
import type { Project } from '../../model/types';

export type AudioStatus = 'off' | 'starting' | 'running' | 'error';

/**
 * App-wide state: the project (through its undo history), the audio engine, and UI state
 * that isn't part of the project (selection, audio status...).
 *
 * Every project change flows History → `project` (for the UI) + patches → engine.
 */
class Session {
  readonly #history = new History<Project>(createProject());
  readonly #engine = new EngineBridge();

  project = $state.raw<Project>(this.#history.state);
  undoLabel = $state<string | undefined>();
  redoLabel = $state<string | undefined>();

  audioStatus = $state<AudioStatus>('off');
  audioError = $state<string | null>(null);
  masterPeak = $state(0);

  selectedTrackIndex = $state(0);
  testTone = $state.raw<TestToneSettings>({ enabled: false, frequency: 220, shape: 'square' });

  constructor() {
    this.#history.subscribe(({ state, patches }) => {
      this.project = state;
      this.undoLabel = this.#history.undoLabel;
      this.redoLabel = this.#history.redoLabel;
      if (this.selectedTrackIndex >= state.tracks.length) {
        this.selectedTrackIndex = Math.max(0, state.tracks.length - 1);
      }
      if (patches.length > 0) this.#engine.send({ type: 'applyPatches', patches });
    });
    this.#engine.subscribe((message) => {
      if (message.type === 'meters') this.masterPeak = message.master;
    });
  }

  // --- Project editing -------------------------------------------------------------------

  run(command: ProjectCommand): void {
    this.#history.run(command);
  }

  /** Groups the following `run` calls into one undo step, e.g. for a knob drag. */
  begin(label: string): void {
    this.#history.begin(label);
  }

  commit(): void {
    this.#history.commit();
  }

  undo(): void {
    this.#history.undo();
  }

  redo(): void {
    this.#history.redo();
  }

  // --- UI state ---------------------------------------------------------------------------

  selectTrack(index: number): void {
    if (index >= 0 && index < this.project.tracks.length) this.selectedTrackIndex = index;
  }

  setTestTone(settings: Partial<TestToneSettings>): void {
    this.testTone = { ...this.testTone, ...settings };
    this.#engine.send({ type: 'testTone', settings: this.testTone });
  }

  // --- Audio ------------------------------------------------------------------------------

  /** Starts audio. Must be called from a user gesture (click, key press). */
  async startAudio(): Promise<void> {
    if (this.audioStatus === 'running' || this.audioStatus === 'starting') return;
    this.audioStatus = 'starting';
    try {
      await this.#engine.start(() => this.#history.state);
      this.#engine.send({ type: 'testTone', settings: this.testTone });
      this.audioStatus = 'running';
      this.audioError = null;
    } catch (error) {
      this.audioStatus = 'error';
      this.audioError = error instanceof Error ? error.message : String(error);
    }
  }
}

export const session = new Session();
