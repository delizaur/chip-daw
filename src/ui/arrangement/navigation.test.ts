import { describe, expect, it } from 'vitest';
import { createClip } from '../../model/clips';
import { createTrack } from '../../model/defaults';
import type { Clip, Track } from '../../model/types';
import { adjacentClip, clipEdgeJump, closestClip } from './navigation';

/** A track with clips given as [start, length], with ids "<track>:<start>". */
function track(index: number, ...spans: [number, number][]): Track {
  const t = createTrack(index, 'p');
  t.clips = spans.map(([start, length]): Clip => ({
    ...createClip(start, length, 'p'),
    id: `${index}:${start}`,
  }));
  return t;
}

//   track 0:  [0..100)        [200..300)[300..400)
//   track 1:  (empty)
//   track 2:            [150..250)              [500..600)
const tracks = [
  track(0, [0, 100], [200, 100], [300, 100]),
  track(1),
  track(2, [150, 100], [500, 100]),
];

describe('closestClip', () => {
  it('picks the clip under or nearest the playhead on the selected track', () => {
    expect(closestClip(tracks, 0, 50)).toEqual({ trackIndex: 0, clipId: '0:0' });
    expect(closestClip(tracks, 0, 160)).toEqual({ trackIndex: 0, clipId: '0:200' });
    expect(closestClip(tracks, 2, 1000)).toEqual({ trackIndex: 2, clipId: '2:500' });
  });

  it('falls back to the nearest track with clips', () => {
    expect(closestClip(tracks, 1, 160)).toEqual({ trackIndex: 0, clipId: '0:200' });
    expect(closestClip([track(0)], 0, 0)).toBeNull();
  });
});

describe('adjacentClip', () => {
  it('left/right walk the clips of the same track', () => {
    const from = { trackIndex: 0, clipId: '0:200' };
    expect(adjacentClip(tracks, from, 'right')).toEqual({ trackIndex: 0, clipId: '0:300' });
    expect(adjacentClip(tracks, from, 'left')).toEqual({ trackIndex: 0, clipId: '0:0' });
    expect(adjacentClip(tracks, { trackIndex: 0, clipId: '0:300' }, 'right')).toBeNull();
  });

  it('up/down find the clip closest in time on the next track with clips', () => {
    const from = { trackIndex: 0, clipId: '0:200' };
    expect(adjacentClip(tracks, from, 'down')).toEqual({ trackIndex: 2, clipId: '2:150' });
    const late = { trackIndex: 2, clipId: '2:500' };
    expect(adjacentClip(tracks, late, 'up')).toEqual({ trackIndex: 0, clipId: '0:300' });
    expect(adjacentClip(tracks, from, 'up')).toBeNull();
  });
});

describe('clipEdgeJump', () => {
  const t = tracks[0]!;

  it('D goes to the end of the current clip, then the start of the next one', () => {
    expect(clipEdgeJump(t, 50, 1)).toEqual({ tick: 100, clipId: '0:0' });
    expect(clipEdgeJump(t, 100, 1, '0:0')).toEqual({ tick: 200, clipId: '0:200' });
    expect(clipEdgeJump(t, 200, 1, '0:200')).toEqual({ tick: 300, clipId: '0:200' });
    // 0:200 ends where 0:300 starts: D selects 0:300 there, then goes to its end.
    expect(clipEdgeJump(t, 300, 1, '0:200')).toEqual({ tick: 300, clipId: '0:300' });
    expect(clipEdgeJump(t, 300, 1, '0:300')).toEqual({ tick: 400, clipId: '0:300' });
    expect(clipEdgeJump(t, 400, 1, '0:300')).toBeNull();
  });

  it('A goes to the start of the current clip, then the end of the previous one', () => {
    expect(clipEdgeJump(t, 350, -1, '0:300')).toEqual({ tick: 300, clipId: '0:300' });
    // 0:300 starts where 0:200 ends: A selects 0:200 there, then goes to its start.
    expect(clipEdgeJump(t, 300, -1, '0:300')).toEqual({ tick: 300, clipId: '0:200' });
    expect(clipEdgeJump(t, 300, -1, '0:200')).toEqual({ tick: 200, clipId: '0:200' });
    expect(clipEdgeJump(t, 200, -1, '0:200')).toEqual({ tick: 100, clipId: '0:0' });
    expect(clipEdgeJump(t, 0, -1, '0:0')).toBeNull();
  });

  it('starts from the nearest edge when the playhead is not on the selected clip', () => {
    expect(clipEdgeJump(t, 250, 1)).toEqual({ tick: 300, clipId: '0:200' });
    expect(clipEdgeJump(t, 150, -1, '0:300')).toEqual({ tick: 100, clipId: '0:0' });
    expect(clipEdgeJump(t, 0, 1)).toEqual({ tick: 100, clipId: '0:0' }); // inside clip 0:0
  });
});
