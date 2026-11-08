import { PROJECT_FORMAT_VERSION } from './constants';
import type { Project } from './types';

type Migration = (project: Record<string, unknown>) => Record<string, unknown>;

/**
 * `migrations[n]` upgrades a project from format version n to n + 1.
 * When bumping PROJECT_FORMAT_VERSION, add an entry here and a test with an old fixture.
 */
const migrations: Record<number, Migration> = {};

export class ProjectFormatError extends Error {}

/** Upgrades a parsed project file of any supported version to the current format. */
export function migrateProject(
  raw: unknown,
  table: Record<number, Migration> = migrations,
  targetVersion: number = PROJECT_FORMAT_VERSION,
): Project {
  if (typeof raw !== 'object' || raw === null) {
    throw new ProjectFormatError('Not a project file.');
  }
  let project = raw as Record<string, unknown>;
  let version = project.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ProjectFormatError('Project file has no valid format version.');
  }
  if (version > targetVersion) {
    throw new ProjectFormatError(
      `Project was saved by a newer version of chip-daw (format ${version}, this build supports ${targetVersion}).`,
    );
  }
  while (version < targetVersion) {
    const migrate = table[version];
    if (!migrate) throw new ProjectFormatError(`No migration from format version ${version}.`);
    project = { ...migrate(project), formatVersion: version + 1 };
    version += 1;
  }
  return project as unknown as Project;
}
