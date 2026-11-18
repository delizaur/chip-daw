/**
 * The keyboard view's maths (pure): which keys are black, where each key sits, which notes a
 * scale holds, and the colors a key lights up in.
 */

/** The keys shown: a full 88-key piano, A0 to C8. */
export const LOWEST_KEY = 21;
export const HIGHEST_KEY = 108;

export const NOTE_NAMES = [
  'C',
  'C♯',
  'D',
  'D♯',
  'E',
  'F',
  'F♯',
  'G',
  'G♯',
  'A',
  'A♯',
  'B',
] as const;

const BLACK = new Set([1, 3, 6, 8, 10]);

export const isBlack = (pitch: number) => BLACK.has(((pitch % 12) + 12) % 12);

/** "C4" (middle C = MIDI 60). */
export const pitchName = (pitch: number) =>
  `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;

export interface KeyLayout {
  pitch: number;
  black: boolean;
  /** Left edge, in white-key widths from the lowest key. */
  x: number;
  /** In white-key widths. */
  width: number;
}

/** Black keys are this much of a white key wide, centred on the line between two white keys. */
export const BLACK_WIDTH = 0.6;

/** Every key from `low` to `high`, white keys side by side and black keys between them. */
export function layoutKeys(low = LOWEST_KEY, high = HIGHEST_KEY): KeyLayout[] {
  const keys: KeyLayout[] = [];
  let white = 0;
  for (let pitch = low; pitch <= high; pitch++) {
    if (isBlack(pitch)) {
      keys.push({ pitch, black: true, x: white - BLACK_WIDTH / 2, width: BLACK_WIDTH });
    } else {
      keys.push({ pitch, black: false, x: white, width: 1 });
      white++;
    }
  }
  return keys;
}

export const whiteKeyCount = (low = LOWEST_KEY, high = HIGHEST_KEY) =>
  layoutKeys(low, high).filter((k) => !k.black).length;

// --- Scales ----------------------------------------------------------------------------------

export const SCALES = [
  { id: 'major', name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonicMinor', name: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'melodicMinor', name: 'Melodic minor', steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'lydian', name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'dorian', name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'locrian', name: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10] },
] as const;

export type ScaleId = (typeof SCALES)[number]['id'];

/** The pitch classes (0 = C) of a scale on `root`. */
export function scaleNotes(root: number, scale: ScaleId): ReadonlySet<number> {
  const steps = SCALES.find((s) => s.id === scale)?.steps ?? SCALES[0].steps;
  return new Set(steps.map((step) => (root + step) % 12));
}

// --- Lights ----------------------------------------------------------------------------------

export interface KeyLight {
  /** Track indexes, in the order their colors are drawn. */
  tracks: number[];
  /** Played live (bright) rather than by recorded clips (dimmer). */
  live: boolean;
}

/**
 * The tracks lighting `pitch`: the track a live note plays on (bright), or else every track
 * whose clips play it, the selected track first. Null when the key isn't lit.
 */
export function keyLight(
  pitch: number,
  live: ReadonlyMap<number, number>,
  sounding: readonly (ReadonlySet<number> | undefined)[],
  selectedTrack: number,
): KeyLight | null {
  const liveTrack = live.get(pitch);
  if (liveTrack !== undefined) return { tracks: [liveTrack], live: true };
  const tracks = sounding.flatMap((pitches, index) => (pitches?.has(pitch) ? [index] : []));
  if (tracks.length === 0) return null;
  tracks.sort((a, b) => Number(b === selectedTrack) - Number(a === selectedTrack) || a - b);
  return { tracks, live: false };
}

// --- Spelling: sharps or flats, as the scale reads best -------------------------------------

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
/** Pitch class of each natural letter. */
const NATURALS = [0, 2, 4, 5, 7, 9, 11] as const;
const ACCIDENTALS: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };

/** A note's spelling: a letter (0 = C ... 6 = B) and its accidental (-2 = 𝄫 ... 2 = 𝄪). */
export interface Spelling {
  letter: number;
  accidental: number;
}

/** The offset from a natural to `pitchClass`, in -6..5. */
const offset = (pitchClass: number, letter: number) =>
  ((((pitchClass - NATURALS[letter]!) % 12) + 18) % 12) - 6;

export const spellingName = (s: Spelling) => LETTERS[s.letter]! + ACCIDENTALS[s.accidental]!;

/** A scale spelled from a root spelling: one letter per degree, in order. */
function spellFrom(root: Spelling, rootClass: number, scale: ScaleId): Spelling[] {
  const steps = SCALES.find((s) => s.id === scale)!.steps;
  return steps.map((step, degree) => {
    const letter = (root.letter + degree) % 7;
    return { letter, accidental: offset((rootClass + step) % 12, letter) };
  });
}

/**
 * The scale on `root` spelled with the fewest accidentals: the root is tried as its sharp,
 * natural or flat name (C♯ or D♭...). On a tie (F♯ / G♭ major, 6 each) flats win.
 */
export function spellScale(root: number, scale: ScaleId): Spelling[] {
  let best: Spelling[] | null = null;
  let bestScore = Infinity;
  for (let letter = 0; letter < 7; letter++) {
    const accidental = offset(root, letter);
    if (Math.abs(accidental) > 1) continue;
    const spelled = spellFrom({ letter, accidental }, root, scale);
    const count = spelled.reduce((sum, s) => sum + Math.abs(s.accidental), 0);
    const flats = spelled.some((s) => s.accidental < 0);
    // Fewest accidentals, then flats over sharps.
    const score = count * 2 + (flats ? 0 : 1);
    if (score < bestScore) {
      best = spelled;
      bestScore = score;
    }
  }
  return best!;
}

const SHARP_NAMES = NOTE_NAMES;
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'] as const;

/**
 * How to name each pitch class: as the scale spells it (so B♭ major shows B♭ and E♭, and
 * F♯ major shows E♯), and the notes outside it with flats when the scale uses flats, else
 * sharps. With no scale, sharps.
 */
export function noteSpellings(scale: { root: number; scale: ScaleId } | null): Spelling[] {
  const names = new Array<Spelling>(12);
  const spelled = scale ? spellScale(scale.root, scale.scale) : [];
  const flats = spelled.some((s) => s.accidental < 0);
  for (let pc = 0; pc < 12; pc++) {
    const name = (flats ? FLAT_NAMES : SHARP_NAMES)[pc]!;
    const letter = LETTERS.indexOf(name[0] as (typeof LETTERS)[number]);
    names[pc] = { letter, accidental: name.length > 1 ? (flats ? -1 : 1) : 0 };
  }
  for (const s of spelled) names[(NATURALS[s.letter]! + s.accidental + 12) % 12] = s;
  return names;
}

/**
 * A key's name with its octave, from its spelling. The octave goes with the letter, so the B
 * below middle C spelled C♭ is C♭4 and the C spelled B♯ is B♯3.
 */
export function spelledPitchName(pitch: number, spelling: Spelling): string {
  return `${spellingName(spelling)}${Math.floor((pitch - spelling.accidental) / 12) - 1}`;
}

/** The root note's name for each pitch class, as `scale` reads best (for the root menu). */
export const rootNames = (scale: ScaleId) =>
  Array.from({ length: 12 }, (_, pc) => spellingName(spellScale(pc, scale)[0]!));
