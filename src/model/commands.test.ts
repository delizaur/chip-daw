import { describe, expect, it } from 'vitest';
import { setMasterVolume, setTrackMute, setTrackSolo, setTrackVolume } from './commands';
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

  it('throws on unknown tracks', () => {
    const h = new History(createProject());
    expect(() => h.run(setTrackMute('missing', true))).toThrow(/not found/);
  });
});
