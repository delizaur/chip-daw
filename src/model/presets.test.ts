import { describe, expect, it } from 'vitest';
import { createBox } from './boxes/registry';
import { addBox, loadTrackPreset, renamePreset, setBoxBypassed } from './chain-commands';
import {
  canMakeUnique,
  loadClipPresetToTrack,
  makeClipsUnique,
  useTrackPreset,
} from './clip-preset-commands';
import { createClip } from './clips';
import { deleteClips, placeClips, recordTake, setBoxParam, type RecordedTake } from './commands';
import { PPQ, PROJECT_FORMAT_VERSION } from './constants';
import { createPreset, createProject } from './defaults';
import { History } from './history';
import { copyPreset } from './library';
import { migrateProject } from './migrations';
import { nextPresetName, presetUsage } from './presets';
import { parseProject } from './project-file';
import type { Project } from './types';
import { validateProject } from './validate';

const BAR = 4 * PPQ;

function setup() {
  const h = new History(createProject(2));
  const trackId = h.state.tracks[0]!.id;
  const track = () => h.state.tracks[0]!;
  const presetOf = (id: string) => h.state.presets.find((p) => p.id === id)!;
  const trackPreset = () => presetOf(track().presetId);
  const clip = (i: number) => track().clips[i]!;
  /** Records a one-note clip at `bar` (0-based) on track 1, like the record button does. */
  const record = (bar: number, overdub = false) => {
    const take: RecordedTake = {
      startTick: bar * BAR,
      endTick: (bar + 1) * BAR,
      notes: [
        { trackId, pitch: 60, velocity: 100, startTick: bar * BAR, endTick: bar * BAR + PPQ },
      ],
    };
    h.run(recordTake(take, overdub));
  };
  const synthParam = (target: { trackId: string } | { presetId: string }, id: string, v: number) =>
    h.run(
      setBoxParam(
        {
          target,
          boxId: ('presetId' in target ? presetOf(target.presetId) : trackPreset()).synth.id,
        },
        id,
        v,
      ),
    );
  return { h, trackId, track, presetOf, trackPreset, clip, record, synthParam };
}

describe('recording and the track preset', () => {
  it('a new recording shares the track preset', () => {
    const { h, track, clip, record } = setup();
    record(0);
    expect(clip(0).presetId).toBe(track().presetId);
    expect(h.state.presets).toHaveLength(2); // one per track, no copies
  });

  it('editing the track preset after recording switches the track to a copy (copy on write)', () => {
    const { h, trackId, track, presetOf, trackPreset, clip, record, synthParam } = setup();
    record(0);
    const original = trackPreset();
    synthParam({ trackId }, 'transpose', 12);

    expect(track().presetId).not.toBe(original.id);
    expect(trackPreset().name).toBe('Init 2');
    expect(trackPreset().synth.params.transpose).toBe(12);
    expect(trackPreset().synth.id).toBe(original.synth.id); // box ids kept
    // The recorded clip keeps its sound.
    expect(clip(0).presetId).toBe(original.id);
    expect(presetOf(original.id)).toEqual(original);

    // Later edits change the copy in place (nothing else uses it).
    synthParam({ trackId }, 'transpose', 7);
    expect(h.state.presets).toHaveLength(3);

    h.undo();
    h.undo();
    expect(track().presetId).toBe(original.id);
    expect(h.state.presets).toHaveLength(2);
  });

  it('turning off a box after recording leaves the recorded clip alone (the motivating case)', () => {
    const { h, trackId, presetOf, trackPreset, clip, record } = setup();
    const arp = createBox('seq.arp');
    h.run(addBox({ trackId }, arp)); // nothing recorded yet: edits in place
    expect(h.state.presets).toHaveLength(2);
    record(0);
    h.run(setBoxBypassed({ trackId }, arp.id, true));
    record(1);
    expect(presetOf(clip(0).presetId).sequencers[0]!.bypassed).toBeUndefined();
    expect(presetOf(clip(1).presetId).sequencers[0]!.bypassed).toBe(true);
    expect(clip(1).presetId).toBe(trackPreset().id);
  });

  it('edits that change nothing never make a copy', () => {
    const { h, trackId, trackPreset, record, synthParam } = setup();
    record(0);
    const id = trackPreset().id;
    synthParam({ trackId }, 'transpose', 0); // already 0
    h.run(renamePreset({ trackId }, 'Init'));
    expect(trackPreset().id).toBe(id);
    expect(h.state.presets).toHaveLength(2);
  });

  it('renaming a shared track preset names the copy; clips keep the old name', () => {
    const { h, trackId, presetOf, trackPreset, clip, record } = setup();
    record(0);
    h.run(renamePreset({ trackId }, 'Lead'));
    expect(trackPreset().name).toBe('Lead');
    expect(presetOf(clip(0).presetId).name).toBe('Init');
  });

  it('editing a clip preset changes every clip sharing it, and the track preset if shared', () => {
    const { track, presetOf, clip, record, synthParam } = setup();
    record(0);
    record(1);
    const presetId = clip(0).presetId;
    synthParam({ presetId }, 'transpose', 5);
    expect(clip(1).presetId).toBe(presetId);
    expect(track().presetId).toBe(presetId);
    expect(presetOf(presetId).synth.params.transpose).toBe(5);
  });

  it('loading a library preset onto the track leaves recorded clips alone', () => {
    const { h, trackId, presetOf, trackPreset, clip, record } = setup();
    record(0);
    const recorded = clip(0).presetId;
    h.run(loadTrackPreset(trackId, copyPreset(createPreset('Bass'))));
    expect(trackPreset().name).toBe('Bass');
    expect(presetOf(recorded).name).toBe('Init');
  });

  it('overdub merges keep the first merged clip preset; plain recording uses the track preset', () => {
    const { trackId, track, clip, record, synthParam } = setup();
    record(0);
    const first = clip(0).presetId;
    synthParam({ trackId }, 'transpose', 12); // the track now plays a copy
    record(0, true);
    expect(track().clips).toHaveLength(1);
    expect(clip(0).presetId).toBe(first);
    expect(clip(0).notes).toHaveLength(2);
    record(0); // replaces it
    expect(clip(0).presetId).toBe(track().presetId);
  });
});

describe('clip preset buttons', () => {
  it('Make unique gives the selected clips one copy of their preset', () => {
    const { h, track, presetOf, clip, record } = setup();
    record(0);
    record(1);
    record(2);
    const shared = clip(0).presetId;
    expect(canMakeUnique(h.state, [clip(1).id, clip(2).id])).toBe(true);

    h.run(makeClipsUnique([clip(1).id, clip(2).id]));
    expect(clip(0).presetId).toBe(shared);
    expect(track().presetId).toBe(shared);
    expect(clip(1).presetId).not.toBe(shared);
    expect(clip(2).presetId).toBe(clip(1).presetId);
    const copy = presetOf(clip(1).presetId);
    expect(copy.name).toBe('Init 2');
    expect({ ...copy, id: shared, name: 'Init' }).toEqual(presetOf(shared)); // same sound, ids
    expect(h.undoLabel).toBe('Make unique');

    // Already unique: nothing to do.
    expect(canMakeUnique(h.state, [clip(1).id, clip(2).id])).toBe(false);
    const before = h.state;
    h.run(makeClipsUnique([clip(1).id, clip(2).id]));
    expect(h.state.presets).toEqual(before.presets);
  });

  it('a clip whose preset is also the track preset can still be made unique', () => {
    const { h, track, clip, record } = setup();
    record(0);
    expect(canMakeUnique(h.state, [clip(0).id])).toBe(true);
    h.run(makeClipsUnique([clip(0).id]));
    expect(clip(0).presetId).not.toBe(track().presetId);
  });

  it('Use track preset points clips at the track preset and removes presets left unused', () => {
    const { h, trackId, track, clip, record, synthParam } = setup();
    record(0);
    const old = clip(0).presetId;
    synthParam({ trackId }, 'transpose', 12);
    h.run(useTrackPreset([clip(0).id]));
    expect(clip(0).presetId).toBe(track().presetId);
    expect(h.state.presets.some((p) => p.id === old)).toBe(false);
    h.undo();
    expect(clip(0).presetId).toBe(old);
    expect(h.state.presets.some((p) => p.id === old)).toBe(true);
  });

  it('Load to track makes the clip preset the track preset', () => {
    const { h, trackId, track, trackPreset, clip, record, synthParam } = setup();
    record(0);
    synthParam({ trackId }, 'transpose', 12); // track: "Init 2"; clip: "Init"
    const copy = track().presetId;
    h.run(loadClipPresetToTrack(clip(0).id));
    expect(track().presetId).toBe(clip(0).presetId);
    expect(trackPreset().name).toBe('Init');
    expect(h.state.presets.some((p) => p.id === copy)).toBe(false); // nothing used it
    // Record more with it: the new clip shares it.
    record(1);
    expect(clip(1).presetId).toBe(clip(0).presetId);
  });
});

describe('preset bookkeeping', () => {
  it('removes a preset when its last clip is deleted (undo brings it back)', () => {
    const { h, clip, record } = setup();
    record(0);
    h.run(makeClipsUnique([clip(0).id]));
    const unique = clip(0).presetId;
    h.run(deleteClips([clip(0).id]));
    expect(h.state.presets.some((p) => p.id === unique)).toBe(false);
    h.undo();
    expect(h.state.presets.some((p) => p.id === unique)).toBe(true);
  });

  it('pasting a clip whose preset is gone puts the preset back', () => {
    const { h, trackId, track, presetOf, clip, record } = setup();
    record(0);
    h.run(makeClipsUnique([clip(0).id]));
    const copied = { clip: clip(0), preset: presetOf(clip(0).presetId) };
    h.run(deleteClips([copied.clip.id]));
    h.run(
      placeClips(
        [
          {
            trackId,
            clip: createClip(BAR, BAR, copied.clip.presetId),
            preset: copied.preset,
          },
        ],
        'Paste',
      ),
    );
    expect(track().clips[0]!.presetId).toBe(copied.preset.id);
    expect(presetOf(copied.preset.id)).toEqual(copied.preset);
    expect(() => validateProject(h.state)).not.toThrow();
  });

  it('counts users of a preset', () => {
    const { h, track, record } = setup();
    record(0);
    record(1);
    expect(presetUsage(h.state, track().presetId)).toEqual({
      trackIds: [track().id],
      clipIds: track().clips.map((c) => c.id),
    });
  });

  it('names copies with the next free number', () => {
    const project = createProject(1);
    project.presets[0]!.name = 'Bass';
    expect(nextPresetName(project, 'Bass')).toBe('Bass 2');
    project.presets.push({ ...createPreset('Bass 2') });
    expect(nextPresetName(project, 'Bass')).toBe('Bass 3');
    expect(nextPresetName(project, 'Bass 2')).toBe('Bass 3');
    expect(nextPresetName(project, '808')).toBe('808 2');
  });

  it('rejects files whose tracks or clips point at missing presets', () => {
    const project = createProject(1);
    expect(() => validateProject({ ...project, presets: [] })).toThrow(
      /tracks\[0\]\.presetId should be the id of a preset/,
    );
  });
});

describe('format 1 → 2 migration', () => {
  /** A format-1 project: presets lived in each track's segments. */
  function v1Project() {
    const current = createProject(2);
    const preset = (name: string, id: string) => ({ ...createPreset(name), id });
    const tracks = current.tracks.map((t, i) => {
      const { presetId: _presetId, ...rest } = t;
      return {
        ...rest,
        segments: [{ id: `s${i}`, startTick: 0, preset: preset(`P${i}`, i === 0 ? 'dup' : 'dup') }],
        clips: [
          { id: `c${i}`, startTick: 0, lengthTicks: BAR, notes: [], automation: [] },
          { id: `d${i}`, startTick: BAR, lengthTicks: BAR, notes: [], automation: [] },
        ],
      };
    });
    const { presets: _presets, ...rest } = current;
    return { ...rest, formatVersion: 1, tracks };
  }

  it('moves segment presets into the project list and points tracks and clips at them', () => {
    const migrated = validateProject(migrateProject(v1Project()));
    expect(migrated.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(migrated.presets.map((p) => p.name)).toEqual(['P0', 'P1']);
    // Both presets had the same id in the file: the second got a fresh one.
    expect(new Set(migrated.presets.map((p) => p.id)).size).toBe(2);
    migrated.tracks.forEach((track, i) => {
      expect('segments' in track).toBe(false);
      expect(track.presetId).toBe(migrated.presets[i]!.id);
      for (const clip of track.clips) expect(clip.presetId).toBe(track.presetId);
    });
  });

  it('gives clips the preset of the segment they start in', () => {
    const v1 = v1Project();
    v1.tracks[0]!.segments.push({
      id: 'wall',
      startTick: BAR,
      preset: { ...createPreset('Late'), id: 'late' },
    });
    const migrated = migrateProject(v1) as Project;
    const [early, late] = migrated.tracks[0]!.clips;
    expect(early!.presetId).toBe(migrated.tracks[0]!.presetId);
    expect(late!.presetId).toBe('late');
  });

  it('opens format-1 files', () => {
    const project = parseProject(JSON.stringify(v1Project()));
    expect(project.presets).toHaveLength(2);
  });
});
