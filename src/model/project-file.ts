import { migrateProject, ProjectFormatError } from './migrations';
import type { Project } from './types';
import { validateProject } from './validate';

/** File extension of chip-daw project files. */
export const PROJECT_EXTENSION = '.chip';

/** Serializes a project for a .chip file (JSON). */
export function serializeProject(project: Project): string {
  return JSON.stringify(project);
}

/**
 * Parses a .chip file: JSON → migrated to the current format → validated.
 * Throws ProjectFormatError with a readable message for anything that isn't a valid project.
 */
export function parseProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFormatError('This file is not a chip-daw project (it is not valid JSON).');
  }
  return validateProject(migrateProject(raw));
}

/** "My Song.chip" → "My Song". */
export function projectNameFromFile(fileName: string): string {
  const name = fileName.replace(/\.chip$/i, '').trim();
  return name || 'Untitled';
}

/** A safe file name for a project, e.g. "My Song.chip". */
export function projectFileName(project: Project): string {
  const base = project.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Untitled';
  return `${base}${PROJECT_EXTENSION}`;
}
