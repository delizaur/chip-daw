/** Ticks per quarter note. All musical time in the project is stored in ticks. */
export const PPQ = 960;

/**
 * Number of tracks a *new* project gets. Never assume a fixed track count elsewhere:
 * a project's `tracks.length` is authoritative.
 */
export const DEFAULT_TRACK_COUNT = 8;

/** Version of the project file format written by this build. Bump it and add a migration on change. */
export const PROJECT_FORMAT_VERSION = 2;

export const DEFAULT_BPM = 120;
