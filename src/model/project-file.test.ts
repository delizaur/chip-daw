import { describe, expect, it } from 'vitest';
import { createClip } from './clips';
import { placeClips, setBoxParam, setTempo } from './commands';
import { createProject } from './defaults';
import { History } from './history';
import { ProjectFormatError } from './migrations';
import {
  parseProject,
  projectFileName,
  projectNameFromFile,
  serializeProject,
} from './project-file';

function sampleProject() {
  const h = new History(createProject());
  const track = h.state.tracks[2]!;
  const synthId = h.state.presets.find((p) => p.id === track.presetId)!.synth.id;
  h.run(setTempo(140));
  h.run(setBoxParam({ target: { trackId: track.id }, boxId: synthId }, 'wave', 3));
  h.run(
    placeClips([
      {
        trackId: track.id,
        clip: createClip(960, 3840, track.presetId, [
          { id: 'n1', tick: 0, durationTicks: 240, pitch: 60, velocity: 100 },
        ]),
      },
    ]),
  );
  return h.state;
}

describe('project files', () => {
  it('round-trips a project', () => {
    const project = sampleProject();
    expect(parseProject(serializeProject(project))).toEqual(project);
  });

  it('rejects text that is not JSON, or not a project', () => {
    expect(() => parseProject('hello')).toThrow(/not valid JSON/);
    expect(() => parseProject('[1,2]')).toThrow(ProjectFormatError);
    expect(() => parseProject('{"formatVersion": 1}')).toThrow(/name should be text/);
  });

  it('points at the broken part of a damaged project', () => {
    const project = JSON.parse(serializeProject(sampleProject()));
    project.tracks[2].clips[0].notes[0].pitch = 'C4';
    expect(() => parseProject(JSON.stringify(project))).toThrow(
      /tracks\[2\]\.clips\[0\]\.notes\[0\]\.pitch should be a number/,
    );
    const noSynth = JSON.parse(serializeProject(sampleProject()));
    delete noSynth.presets[0].synth;
    expect(() => parseProject(JSON.stringify(noSynth))).toThrow(
      /presets\[0\]\.synth should be a box/,
    );
  });

  it('rejects projects from a newer version', () => {
    const project = JSON.parse(serializeProject(sampleProject()));
    project.formatVersion = 99;
    expect(() => parseProject(JSON.stringify(project))).toThrow(/newer version/);
  });

  it('turns names into file names and back', () => {
    expect(projectNameFromFile('My Song.chip')).toBe('My Song');
    expect(projectNameFromFile('.chip')).toBe('Untitled');
    expect(projectFileName({ ...createProject(), name: 'a/b: c?' })).toBe('a-b- c-.chip');
  });
});
