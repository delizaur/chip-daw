const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Short random id for project entities (tracks, clips, notes, boxes...).
 * 12 base-36 chars ≈ 62 bits: collisions are not a practical concern within a project.
 * Uses Math.random so it works in every environment the core runs in.
 */
export function createId(): string {
  let id = '';
  for (let i = 0; i < 12; i++) id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return id;
}
