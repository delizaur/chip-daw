import type { Patch } from 'immer';
import type { RecordedNote, RecordedTake } from '../model/commands';
import type { Project, Tick } from '../model/types';

/** Messages from the main thread to the engine. */
export type UiToEngine =
  | { type: 'loadProject'; project: Project }
  | { type: 'applyPatches'; patches: Patch[] }
  /**
   * Live input (computer keyboard, MIDI). Velocity is 1..127. `record: false` plays without
   * recording (piano roll auditions). `presetId` plays it through that clip preset's chain on
   * the track (auditions of a clip) instead of the track preset.
   */
  | {
      type: 'noteOn';
      trackId: string;
      pitch: number;
      velocity: number;
      record?: boolean;
      presetId?: string;
    }
  | { type: 'noteOff'; trackId: string; pitch: number }
  /** Releases every note on every track (e.g. when the window loses focus). */
  | { type: 'allNotesOff' }
  // Transport
  | { type: 'play' }
  | { type: 'pause' }
  /** `seq` numbers the UI's seeks; transport reports echo the last one handled. */
  | { type: 'seek'; tick: Tick; seq?: number }
  /** Record arm: while armed and playing, live notes are captured into a take. */
  | { type: 'setRecord'; armed: boolean }
  /** Overdub mode: while recording, live notes play through the clip under the playhead. */
  | { type: 'setOverdub'; enabled: boolean }
  | { type: 'setMetronome'; enabled: boolean }
  /** Output latency in seconds, so recorded notes line up with what the player heard. */
  | { type: 'setLatency'; seconds: number };

/** Messages from the engine to the main thread. */
export type EngineToUi =
  | {
      type: 'meters';
      /** Peak absolute sample value of the master output since the last report (0..1). */
      master: number;
    }
  /**
   * Transport state. `countIn` is the number of count-in beats still to go before playback
   * (and recording) starts, 0 when not counting in. `seekSeq` is the `seq` of the last seek
   * handled, so the UI can ignore positions reported before its latest seek arrived.
   */
  | { type: 'transport'; playing: boolean; tick: Tick; countIn: number; seekSeq: number }
  /** A recording pass started (record armed and playing). */
  | { type: 'takeStarted'; startTick: Tick }
  /**
   * A note of the current pass was played or released, so the UI can show it live. `index`
   * identifies the note within the pass; while `held`, its end is still growing.
   */
  | { type: 'takeNote'; index: number; note: RecordedNote; held: boolean }
  /**
   * The pass ended (playback stopped, seek, or record disarmed). Sent even when no notes were
   * played, so the UI can clear its preview.
   */
  | { type: 'recorded'; take: RecordedTake }
  /** The engine hit an exception (it keeps running, silent for the failing blocks). */
  | { type: 'error'; message: string };

/** Messages that are meaningful before the engine exists, so the bridge queues them. */
export const QUEUED_MESSAGE_TYPES: ReadonlySet<UiToEngine['type']> = new Set([
  'noteOn',
  'noteOff',
  'allNotesOff',
  'play',
  'pause',
  'seek',
  'setRecord',
  'setOverdub',
  'setMetronome',
]);
