/** Musical time in ticks (see PPQ). */
export type Tick = number;

export interface Project {
  /** File format version, used for migrations. */
  formatVersion: number;
  name: string;
  /** 0..1 */
  masterVolume: number;
  tempoMap: TempoMap;
  /** Length is DEFAULT_TRACK_COUNT for new projects; never assume a fixed size. */
  tracks: Track[];
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
  /** Sorted by startTick; the first segment starts at tick 0. Boundaries between segments are "walls". */
  segments: PresetSegment[];
  /** Never overlap on the same track. */
  clips: Clip[];
}

/** The part of a track between two walls. Lasts until the next segment's startTick. */
export interface PresetSegment {
  id: string;
  startTick: Tick;
  /** A copy owned by this segment. */
  preset: Preset;
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
  /** Box in the active segment's preset. */
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
