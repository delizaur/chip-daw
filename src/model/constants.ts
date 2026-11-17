/** Ticks per quarter note. All musical time in the project is stored in ticks. */
export const PPQ = 960;

/**
 * Number of tracks a *new* project gets. Never assume a fixed track count elsewhere:
 * a project's `tracks.length` is authoritative.
 */
export const DEFAULT_TRACK_COUNT = 8;

/** Version of the project file format written by this build. Bump it and add a migration on change. */
export const PROJECT_FORMAT_VERSION = 4;

export const DEFAULT_BPM = 120;

/**
 * The ways a beat can be divided for the grid: those that give a whole number of ticks for
 * every beat value (PPQ = 960; 7 wouldn't), so notes snapped to them stay on the grid.
 */
export const SUBDIVISIONS = [1, 2, 3, 4, 5, 6, 8, 12, 16] as const;
export const DEFAULT_SUBDIVISION = 4;

/** A new project's loop region: the first bars. */
export const DEFAULT_LOOP_BARS = 4;
