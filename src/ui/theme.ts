/** Track colors, cycled for any number of tracks. */
const TRACK_COLORS = [
  'var(--c-blue)',
  'var(--c-green)',
  'var(--c-orange)',
  'var(--c-pink)',
  'var(--c-yellow)',
  'var(--c-purple)',
  'var(--c-cyan)',
  'var(--c-red)',
];

export function trackColor(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length]!;
}
