import { describe, expect, it } from 'vitest';
import {
  setBoxParam,
  setMasterVolume,
  setTrackMute,
  setTrackSolo,
  setTrackVolume,
} from './commands';
import { createProject } from './defaults';
import { History } from './history';

describe('project commands', () => {
  it('change master and track settings, undoably', () => {
    const project = createProject();
    const trackId = project.tracks[2]!.id;
    const h = new History(project);

    h.run(setMasterVolume(0.3));
    h.run(setTrackVolume(trackId, 0.4));
    h.run(setTrackMute(trackId, true));
    h.run(setTrackSolo(trackId, true));
    expect(h.state.masterVolume).toBe(0.3);
    expect(h.state.tracks[2]).toMatchObject({ volume: 0.4, mute: true, solo: true });

    for (let i = 0; i < 4; i++) h.undo();
    expect(h.state).toEqual(project);
  });

  it('clamps volumes to 0..1', () => {
    const h = new History(createProject());
    h.run(setMasterVolume(3));
    expect(h.state.masterVolume).toBe(1);
    h.run(setMasterVolume(-1));
    expect(h.state.masterVolume).toBe(0);
  });

  it('sets box params within their range, undoably', () => {
    const project = createProject();
    const track = project.tracks[1]!;
    const segment = track.segments[0]!;
    const address = { trackId: track.id, segmentId: segment.id, boxId: segment.preset.synth.id };
    const h = new History(project);

    h.run(setBoxParam(address, 'sustain', 0.25, 'Change Sustain'));
    expect(h.state.tracks[1]!.segments[0]!.preset.synth.params.sustain).toBe(0.25);
    expect(h.undoLabel).toBe('Change Sustain');

    h.run(setBoxParam(address, 'wave', 7.6));
    expect(h.state.tracks[1]!.segments[0]!.preset.synth.params.wave).toBe(5);

    h.undo();
    h.undo();
    expect(h.state).toEqual(project);
    expect(() => h.run(setBoxParam(address, 'nope', 1))).toThrow(/Unknown param/);
    expect(() => h.run(setBoxParam({ ...address, boxId: 'x' }, 'wave', 1))).toThrow(/not found/);
  });

  it('throws on unknown tracks', () => {
    const h = new History(createProject());
    expect(() => h.run(setTrackMute('missing', true))).toThrow(/not found/);
  });
});
