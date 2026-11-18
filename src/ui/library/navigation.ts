/**
 * Keyboard browsing of the preset library (pure functions): the rows as shown, top to bottom,
 * and where the up/down and folder-skip keys move the selection.
 */
import { presetsIn, sortedFolders, type Library } from '../../model/library';

export interface LibraryRow {
  kind: 'folder' | 'preset';
  id: string;
}

/** The rows as the panel shows them: each folder, its presets when open, then loose presets. */
export function libraryRows(library: Library, expanded: ReadonlySet<string>): LibraryRow[] {
  const rows: LibraryRow[] = [];
  for (const folder of sortedFolders(library)) {
    rows.push({ kind: 'folder', id: folder.id });
    if (!expanded.has(folder.id)) continue;
    for (const entry of presetsIn(library, folder.id)) {
      rows.push({ kind: 'preset', id: entry.preset.id });
    }
  }
  for (const entry of presetsIn(library, null)) rows.push({ kind: 'preset', id: entry.preset.id });
  return rows;
}

const indexOf = (rows: readonly LibraryRow[], row: LibraryRow | null) =>
  row ? rows.findIndex((r) => r.kind === row.kind && r.id === row.id) : -1;

/**
 * The row before (-1) or after (+1) `current`, staying put at either end. With no current row
 * (or one that isn't shown), the first row.
 */
export function stepRow(
  rows: readonly LibraryRow[],
  current: LibraryRow | null,
  direction: 1 | -1,
): LibraryRow | null {
  const index = indexOf(rows, current);
  if (index < 0) return rows[0] ?? null;
  return rows[Math.max(0, Math.min(rows.length - 1, index + direction))]!;
}

/**
 * The previous (-1) or next (+1) folder row from `current` (from a preset inside a folder,
 * -1 is that folder). Null when there's none that way; with no current row, the first folder.
 */
export function stepFolder(
  rows: readonly LibraryRow[],
  current: LibraryRow | null,
  direction: 1 | -1,
): LibraryRow | null {
  const index = indexOf(rows, current);
  if (index < 0) return rows.find((r) => r.kind === 'folder') ?? null;
  for (let i = index + direction; i >= 0 && i < rows.length; i += direction) {
    if (rows[i]!.kind === 'folder') return rows[i]!;
  }
  return null;
}
