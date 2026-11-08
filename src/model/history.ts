import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';

enablePatches();

export interface Command<T> {
  /** Human-readable, shown in the UI as "Undo <label>". */
  label: string;
  recipe: (draft: Draft<T>) => void;
}

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
}

export interface HistoryChange<T> {
  state: T;
  /** Patches that turn the previous state into `state`. Empty when only the undo/redo stacks changed. */
  patches: Patch[];
}

export type HistoryListener<T> = (change: HistoryChange<T>) => void;

/**
 * Immutable state + undo/redo, built on Immer patches.
 *
 * Every change goes through `run` (one command = one undo step) or a transaction
 * (`begin` → many `run`s → `commit`), which merges continuous gestures like knob drags
 * into a single undo step. Listeners receive the forward patches of every change,
 * including undo/redo, which is also how the audio engine is kept in sync.
 */
export class History<T> {
  #state: T;
  #undoStack: HistoryEntry[] = [];
  #redoStack: HistoryEntry[] = [];
  #transaction: Transaction | null = null;
  #listeners = new Set<HistoryListener<T>>();
  readonly limit: number;

  constructor(initial: T, limit = 500) {
    this.#state = initial;
    this.limit = limit;
  }

  get state(): T {
    return this.#state;
  }
  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }
  get undoLabel(): string | undefined {
    return this.#undoStack.at(-1)?.label;
  }
  get redoLabel(): string | undefined {
    return this.#redoStack.at(-1)?.label;
  }
  get inTransaction(): boolean {
    return this.#transaction !== null;
  }

  subscribe(listener: HistoryListener<T>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  run(command: Command<T>): void {
    const [next, patches, inversePatches] = produceWithPatches(this.#state, command.recipe);
    if (patches.length === 0) return;
    this.#state = next as T;
    if (this.#transaction) {
      appendToTransaction(this.#transaction, patches, inversePatches);
    } else {
      this.#push({ label: command.label, patches, inversePatches });
    }
    this.#emit(patches);
  }

  /** Starts grouping changes into one undo step. Changes still apply (and notify) immediately. */
  begin(label: string): void {
    if (this.#transaction) this.commit();
    this.#transaction = { label, patches: [], inversePatches: [], lastStepWasSingleReplace: false };
  }

  commit(): void {
    const transaction = this.#transaction;
    this.#transaction = null;
    if (transaction && transaction.patches.length > 0) {
      const { label, patches, inversePatches } = transaction;
      this.#push({ label, patches, inversePatches });
      this.#emit([]);
    }
  }

  /** Ends the transaction and reverts everything it changed. */
  cancel(): void {
    const transaction = this.#transaction;
    this.#transaction = null;
    if (transaction && transaction.inversePatches.length > 0) {
      this.#state = applyPatches(this.#state as object, transaction.inversePatches) as T;
      this.#emit(transaction.inversePatches);
    }
  }

  undo(): void {
    this.commit();
    const entry = this.#undoStack.pop();
    if (!entry) return;
    this.#state = applyPatches(this.#state as object, entry.inversePatches) as T;
    this.#redoStack.push(entry);
    this.#emit(entry.inversePatches);
  }

  redo(): void {
    this.commit();
    const entry = this.#redoStack.pop();
    if (!entry) return;
    this.#state = applyPatches(this.#state as object, entry.patches) as T;
    this.#undoStack.push(entry);
    this.#emit(entry.patches);
  }

  /** Replaces the whole state (e.g. opening a project) and clears undo/redo. */
  reset(state: T): void {
    this.#transaction = null;
    this.#undoStack = [];
    this.#redoStack = [];
    this.#state = state;
    this.#emit([{ op: 'replace', path: [], value: state }]);
  }

  #push(entry: HistoryEntry): void {
    this.#undoStack.push(entry);
    if (this.#undoStack.length > this.limit) this.#undoStack.shift();
    this.#redoStack = [];
  }

  #emit(patches: Patch[]): void {
    const change = { state: this.#state, patches };
    for (const listener of this.#listeners) listener(change);
  }
}

interface Transaction extends HistoryEntry {
  /** True when the most recent step was exactly one primitive replace (and its inverse). */
  lastStepWasSingleReplace: boolean;
}

function isPrimitiveReplace(patch: Patch | undefined): patch is Patch {
  return (
    patch !== undefined &&
    patch.op === 'replace' &&
    (patch.value === null || typeof patch.value !== 'object')
  );
}

function samePath(a: Patch, b: Patch): boolean {
  return a.path.length === b.path.length && a.path.every((key, i) => key === b.path[i]);
}

/**
 * Appends one step to a transaction. Inverse patches are kept in reverse order so they undo
 * the steps last-to-first. Repeated replaces of the same primitive value (a knob drag) are
 * collapsed so a long gesture doesn't store thousands of patches.
 */
function appendToTransaction(entry: Transaction, patches: Patch[], inversePatches: Patch[]): void {
  const [patch] = patches;
  const [inverse] = inversePatches;
  const isSingleReplace =
    patches.length === 1 &&
    inversePatches.length === 1 &&
    isPrimitiveReplace(patch) &&
    isPrimitiveReplace(inverse);
  const last = entry.patches.at(-1);
  if (isSingleReplace && entry.lastStepWasSingleReplace && last && samePath(patch, last)) {
    // Same value changed again: overwrite the previous forward value. The previous step's
    // inverse (first in the list) already restores the value from before, so this step's
    // inverse is redundant.
    entry.patches[entry.patches.length - 1] = patch;
    return;
  }
  entry.patches.push(...patches);
  entry.inversePatches.unshift(...inversePatches);
  entry.lastStepWasSingleReplace = isSingleReplace;
}
