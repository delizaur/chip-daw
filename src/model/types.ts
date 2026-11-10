/** Musical time in ticks (see PPQ). */
export type Tick = number;

export interface Project {
  /** File format version, used for migrations. */
  formatVersion: number;
  name: string;
  /** 0..1 */
  masterVolume: number;
  tempoMap: TempoMap;
  /**
   * The loop region (whether looping is on is transport state, not saved). Saved with the song
   * so the region you set up comes back.
   */
  loop: LoopRegion;
  /**
   * Every preset a track or clip uses, and no others. Tracks and clips point at them by id, so
   * one preset can be shared (see design-principles.md, "Terminology").
   */
  presets: Preset[];
  /** Length is DEFAULT_TRACK_COUNT for new projects; never assume a fixed size. */
  tracks: Track[];
}

export interface LoopRegion {
  startTick: Tick;
  /** Always after startTick. */
  endTick: Tick;
}

export interface TempoEvent {
  tick: Tick;
  bpm: number;
  /** How the tempo moves towards the NEXT tempo event. */
  ramp: 'step' | 'linear';
}

export interface MeterEvent {
  tick: Tick;
  numerator: number;
  denominator: number;
  /** Default grid subdivision, as a note value (16 = sixteenth notes). */
  subdivision: number;
}

export interface TempoMap {
  /** Sorted by tick; the first event is at tick 0. */
  tempos: TempoEvent[];
  /** Sorted by tick; the first event is at tick 0. */
  meters: MeterEvent[];
}

export interface Track {
  id: string;
  name: string;
  /** 0..1 */
  volume: number;
  mute: boolean;
  solo: boolean;
  /**
   * The track preset (in `Project.presets`): played live, and used by new recordings. May be
   * shared with clips; editing it through the track never changes them (copy on write).
   */
  presetId: string;
  /** Never overlap on the same track. */
  clips: Clip[];
}

export interface Preset {
  id: string;
  name: string;
  /** Library preset this was copied from, if any. Informational only. */
  libraryOrigin?: string;
  /** Applied in order. */
  sequencers: BoxInstance[];
  synth: BoxInstance;
  /** Applied in order. */
  effects: BoxInstance[];
}

export interface BoxInstance {
  id: string;
  /** Registry key, e.g. "synth.pulse", "fx.bitcrush", "seq.arp". */
  type: string;
  /** All params are numbers; enum params are stepped numbers. */
  params: Record<string, number>;
  /** Bypassed boxes are skipped (sequencers and effects pass through). Absent = active. */
  bypassed?: boolean;
}

export interface AutomationTarget {
  /** Box in the clip's preset. */
  boxId: string;
  /** Fallback for re-linking, e.g. "fx.bitcrush". */
  boxType: string;
  /** Nth box of that type in the preset (fallback for re-linking). */
  boxIndex: number;
}

export interface AutomationPoint {
  /** Relative to the clip start. */
  tick: Tick;
  value: number;
  curve: 'step' | 'linear';
}

export interface AutomationLane {
  target: AutomationTarget;
  paramId: string;
  points: AutomationPoint[];
}

export interface Clip {
  id: string;
  startTick: Tick;
  lengthTicks: Tick;
  /** The clip preset (in `Project.presets`), set when recorded. May be shared with other clips. */
  presetId: string;
  notes: Note[];
  /** Moves with the clip. */
  automation: AutomationLane[];
}

export interface Note {
  id: string;
  /** Relative to the clip start. */
  tick: Tick;
  durationTicks: Tick;
  /** MIDI 0..127 */
  pitch: number;
  /** 1..127 */
  velocity: number;
}
