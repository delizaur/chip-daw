import { describe, expect, it } from 'vitest';
import { applyPatches, type Patch } from 'immer';
import { History, type Command } from './history';

interface State {
  volume: number;
  name: string;
  items: string[];
}

const initial = (): State => ({ volume: 0.5, name: 'a', items: [] });

const setVolume = (v: number): Command<State> => ({
  label: 'Volume',
  recipe: (d) => {
    d.volume = v;
  },
});
const setName = (n: string): Command<State> => ({
  label: 'Name',
  recipe: (d) => {
    d.name = n;
  },
});
const addItem = (item: string): Command<State> => ({
  label: 'Add',
  recipe: (d) => {
    d.items.push(item);
  },
});

describe('History', () => {
  it('runs commands and undoes/redoes them', () => {
    const h = new History(initial());
    h.run(setVolume(0.7));
    h.run(setName('b'));
    expect(h.state).toMatchObject({ volume: 0.7, name: 'b' });

    h.undo();
    expect(h.state).toMatchObject({ volume: 0.7, name: 'a' });
    expect(h.redoLabel).toBe('Name');
    h.undo();
    expect(h.state).toEqual(initial());
    expect(h.canUndo).toBe(false);

    h.redo();
    h.redo();
    expect(h.state).toMatchObject({ volume: 0.7, name: 'b' });
    expect(h.canRedo).toBe(false);
  });

  it('keeps state immutable', () => {
    const h = new History(initial());
    const before = h.state;
    h.run(addItem('x'));
    expect(before.items).toEqual([]);
    expect(h.state).not.toBe(before);
    expect(Object.isFrozen(h.state)).toBe(true);
  });

  it('ignores commands that change nothing', () => {
    const h = new History(initial());
    h.run(setVolume(0.5));
    expect(h.canUndo).toBe(false);
  });

  it('clears redo when a new command runs', () => {
    const h = new History(initial());
    h.run(setVolume(0.1));
    h.undo();
    h.run(setVolume(0.2));
    expect(h.canRedo).toBe(false);
  });

  it('merges a transaction into one undo step', () => {
    const h = new History(initial());
    h.begin('Drag');
    for (let i = 1; i <= 40; i++) h.run(setVolume(0.5 + i / 100));
    h.run(addItem('x'));
    h.commit();
    expect(h.undoLabel).toBe('Drag');

    h.undo();
    expect(h.state).toEqual(initial());
    expect(h.canUndo).toBe(false);
    h.redo();
    expect(h.state.volume).toBeCloseTo(0.9);
    expect(h.state.items).toEqual(['x']);
  });

  it('collapses repeated value changes inside a transaction', () => {
    const h = new History(initial());
    const seen: Patch[][] = [];
    h.begin('Drag');
    for (let i = 0; i < 100; i++) h.run(setVolume(i / 100));
    h.commit();
    h.subscribe(({ patches }) => seen.push(patches));
    h.undo();
    expect(seen[0]).toHaveLength(1);
    expect(h.state.volume).toBe(0.5);
  });

  it('restores interleaved changes inside a transaction', () => {
    const h = new History(initial());
    h.begin('Mixed');
    h.run(setVolume(0.6));
    h.run(setName('b'));
    h.run(setVolume(0.7));
    h.run(setName('c'));
    h.commit();
    h.undo();
    expect(h.state).toEqual(initial());
    h.redo();
    expect(h.state).toMatchObject({ volume: 0.7, name: 'c' });
  });

  it('cancel reverts the transaction without adding an undo step', () => {
    const h = new History(initial());
    h.begin('Drag');
    h.run(setVolume(0.9));
    h.run(addItem('x'));
    h.cancel();
    expect(h.state).toEqual(initial());
    expect(h.canUndo).toBe(false);
  });

  it('undo during a transaction commits it first', () => {
    const h = new History(initial());
    h.begin('Drag');
    h.run(setVolume(0.9));
    h.undo();
    expect(h.state).toEqual(initial());
    expect(h.inTransaction).toBe(false);
  });

  it('notifies listeners with patches that reproduce the state', () => {
    const h = new History(initial());
    let mirror = h.state;
    h.subscribe(({ patches }) => {
      mirror = applyPatches(mirror, patches);
    });
    h.run(setVolume(0.1));
    h.begin('Drag');
    h.run(setVolume(0.2));
    h.run(addItem('y'));
    h.commit();
    h.undo();
    h.redo();
    h.undo();
    h.undo();
    h.redo();
    expect(mirror).toEqual(h.state);
    h.reset({ volume: 1, name: 'z', items: ['q'] });
    expect(mirror).toEqual(h.state);
  });

  it('reset clears the stacks', () => {
    const h = new History(initial());
    h.run(setVolume(0.1));
    h.reset(initial());
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it('drops the oldest entries beyond the limit', () => {
    const h = new History(initial(), 3);
    for (let i = 1; i <= 5; i++) h.run(setVolume(i / 10));
    h.undo();
    h.undo();
    h.undo();
    expect(h.canUndo).toBe(false);
    expect(h.state.volume).toBe(0.2);
  });
});
