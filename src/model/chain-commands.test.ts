import { describe, expect, it } from 'vitest';
import { createBox } from './boxes/registry';
import { addBox, moveBox, removeBox, replaceBox, setBoxBypassed } from './chain-commands';
import { createProject } from './defaults';
import { History } from './history';

function setup() {
  const h = new History(createProject());
  const track = h.state.tracks[0]!;
  const address = { trackId: track.id, segmentId: track.segments[0]!.id };
  const preset = () => h.state.tracks[0]!.segments[0]!.preset;
  const effects = () => preset().effects.map((b) => b.type);
  return { h, address, preset, effects };
}

describe('chain commands', () => {
  it('adds sequencers and effects to their own lists', () => {
    const { h, address, preset, effects } = setup();
    h.run(addBox(address, createBox('fx.delay')));
    h.run(addBox(address, createBox('fx.bitcrush'), 0));
    h.run(addBox(address, createBox('seq.arp')));
    expect(effects()).toEqual(['fx.bitcrush', 'fx.delay']);
    expect(preset().sequencers.map((b) => b.type)).toEqual(['seq.arp']);
    expect(h.undoLabel).toBe('Add Arpeggiator');
  });

  it('refuses to add a second synth or remove the synth', () => {
    const { h, address, preset } = setup();
    expect(() => h.run(addBox(address, createBox('synth.chip')))).toThrow(/one synth/);
    expect(() => h.run(removeBox(address, preset().synth.id))).toThrow(/can't be removed/);
  });

  it('removes and reorders boxes, undoably', () => {
    const { h, address, preset, effects } = setup();
    const crush = createBox('fx.bitcrush');
    const delay = createBox('fx.delay');
    const reverb = createBox('fx.reverb');
    for (const box of [crush, delay, reverb]) h.run(addBox(address, box));

    h.run(moveBox(address, reverb.id, -1));
    expect(effects()).toEqual(['fx.bitcrush', 'fx.reverb', 'fx.delay']);
    h.run(moveBox(address, crush.id, -1)); // already first: no change
    expect(h.undoLabel).toBe('Move box');

    h.run(removeBox(address, delay.id));
    expect(effects()).toEqual(['fx.bitcrush', 'fx.reverb']);
    h.undo();
    h.undo();
    expect(effects()).toEqual(['fx.bitcrush', 'fx.delay', 'fx.reverb']);
    expect(preset().effects[1]).toEqual(delay);
  });

  it('replaces a box in place with defaults of the new type', () => {
    const { h, address, preset, effects } = setup();
    const crush = createBox('fx.bitcrush');
    h.run(addBox(address, crush));
    h.run(addBox(address, createBox('fx.reverb')));
    h.run(replaceBox(address, crush.id, 'fx.filter'));
    expect(effects()).toEqual(['fx.filter', 'fx.reverb']);
    expect(preset().effects[0]!.params.cutoff).toBe(2000);
    expect(() => h.run(replaceBox(address, preset().effects[0]!.id, 'seq.arp'))).toThrow(
      /same kind/,
    );
  });

  it('bypasses and re-enables boxes', () => {
    const { h, address, preset } = setup();
    const delay = createBox('fx.delay');
    h.run(addBox(address, delay));
    h.run(setBoxBypassed(address, delay.id, true));
    expect(preset().effects[0]!.bypassed).toBe(true);
    h.run(setBoxBypassed(address, delay.id, false));
    expect('bypassed' in preset().effects[0]!).toBe(false);
  });
});
