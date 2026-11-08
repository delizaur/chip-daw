import { describe, expect, it } from 'vitest';
import { createBox } from '../model/boxes/registry';
import { addBox, removeBox, setBoxBypassed } from '../model/chain-commands';
import { createClip } from '../model/clips';
import { placeClips, setBoxParam } from '../model/commands';
import { PPQ } from '../model/constants';
import { createProject } from '../model/defaults';
import { History } from '../model/history';
import { Engine } from './engine';
import { BLOCK, peak, renderBlocks, SAMPLE_RATE } from './test-utils';

function setup() {
  const engine = new Engine(SAMPLE_RATE, () => {});
  const history = new History(createProject());
  engine.handle({ type: 'loadProject', project: history.state });
  history.subscribe(({ patches }) => engine.handle({ type: 'applyPatches', patches }));
  const track = history.state.tracks[0]!;
  const address = { trackId: track.id, segmentId: track.segments[0]!.id };
  const synthId = track.segments[0]!.preset.synth.id;
  const noteOn = (pitch: number) =>
    engine.handle({ type: 'noteOn', trackId: track.id, pitch, velocity: 100 });
  const noteOff = (pitch: number) => engine.handle({ type: 'noteOff', trackId: track.id, pitch });
  const render = (seconds: number) => renderBlocks((l, r) => engine.process(l, r), seconds).left;
  // A short, percussive synth makes separate notes easy to count.
  history.run(setBoxParam({ ...address, boxId: synthId }, 'decay', 0.03));
  history.run(setBoxParam({ ...address, boxId: synthId }, 'sustain', 0));
  history.run(setBoxParam({ ...address, boxId: synthId }, 'release', 0.01));
  render(0.1); // the master volume fades in after loading; let it settle
  return { engine, history, address, noteOn, noteOff, render, trackId: track.id };
}

/** Counts note onsets: places where the signal jumps from near-silence to clearly audible. */
function onsets(buffer: Float32Array): number {
  let count = 0;
  let quiet = true;
  const window = 64;
  for (let i = 0; i + window <= buffer.length; i += window) {
    const level = peak(buffer.subarray(i, i + window));
    if (quiet && level > 0.05) {
      count++;
      quiet = false;
    } else if (level < 0.005) {
      quiet = true;
    }
  }
  return count;
}

describe('preset chain in the engine', () => {
  it('an arpeggiator turns a held chord into a stream of notes (also when stopped)', () => {
    const { history, address, noteOn, render } = setup();
    history.run(addBox(address, createBox('seq.arp')));
    noteOn(60);
    noteOn(64);
    noteOn(67);
    // 1 s at 120 BPM in sixteenths = 8 notes.
    expect(onsets(render(1))).toBeGreaterThanOrEqual(7);
  });

  it('a bypassed arp lets notes through unchanged', () => {
    const { history, address, noteOn, render } = setup();
    const arp = createBox('seq.arp');
    history.run(addBox(address, arp));
    history.run(setBoxBypassed(address, arp.id, true));
    noteOn(60);
    expect(onsets(render(1))).toBe(1);
  });

  it('removing a running arp leaves no stuck notes', () => {
    const { history, address, noteOn, noteOff, render } = setup();
    const arp = createBox('seq.arp');
    history.run(addBox(address, arp));
    history.run(setBoxParam({ ...address, boxId: arp.id }, 'gate', 1));
    noteOn(60);
    render(0.3);
    history.run(removeBox(address, arp.id));
    noteOff(60);
    const out = render(0.5);
    expect(peak(out.subarray(out.length - BLOCK * 4))).toBe(0);
  });

  it('clip notes go through the arp too', () => {
    const { engine, history, address, trackId, render } = setup();
    history.run(addBox(address, createBox('seq.arp')));
    history.run(
      placeClips([
        {
          trackId,
          clip: createClip(0, 4 * PPQ, [
            { id: 'a', tick: 0, durationTicks: 2 * PPQ, pitch: 60, velocity: 100 },
            { id: 'b', tick: 0, durationTicks: 2 * PPQ, pitch: 67, velocity: 100 },
          ]),
        },
      ]),
    );
    engine.handle({ type: 'play' });
    const out = render(1.5);
    // Two beats (1 s) of sixteenths, then nothing.
    expect(onsets(out.subarray(0, SAMPLE_RATE))).toBeGreaterThanOrEqual(7);
    expect(peak(out.subarray(SAMPLE_RATE * 1.2))).toBe(0);
  });

  it('effects keep ringing after the note ends (delay tail)', () => {
    const { history, address, noteOn, noteOff, render } = setup();
    history.run(addBox(address, createBox('fx.delay')));
    noteOn(60);
    render(0.05);
    noteOff(60);
    const out = render(1);
    // Dotted eighth at 120 BPM = 0.375 s: an echo after the dry note has died away.
    expect(peak(out.subarray(SAMPLE_RATE * 0.3, SAMPLE_RATE * 0.4))).toBeGreaterThan(0.01);
  });
});
