import type { LocalTrack, Playlist, PlaylistDiff, ScanErrorEntry } from '../types/music';
import { isAudioFile } from './audioMetadata';

export interface ScannedFileEntry {
  file: File;
  relativePath: string;
}

export interface DirectoryWalkReport {
  entries: ScannedFileEntry[];
  totalFilesEncountered: number;
  errors: ScanErrorEntry[];
}

/**
 * Check if the browser supports the File System Access API (showDirectoryPicker)
 * AND we are in a top-level browsing context.
 * Inside cross-origin iframes (such as embedded preview frames), showDirectoryPicker()
 * throws a SecurityError asynchronously, which consumes user activation and blocks
 * programmatic fallback <input>.click(). Returning false in iframes guarantees the
 * fallback <input type="file" webkitdirectory> opens synchronously on click.
 */
export function supportsDirectoryPicker(): boolean {
  if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
    return false;
  }
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

/**
 * Recursively walks a FileSystemDirectoryHandle, collecting audio files while recording
 * total encountered files and any unreadable file / inaccessible subfolder errors.
 */
export async function walkDirectoryHandleWithReport(
  dirHandle: FileSystemDirectoryHandle,
  prefix = ''
): Promise<DirectoryWalkReport> {
  const entries: ScannedFileEntry[] = [];
  const errors: ScanErrorEntry[] = [];
  let totalFilesEncountered = 0;
  const rootPrefix = prefix || dirHandle.name;

  const entriesIterable = (
    dirHandle as FileSystemDirectoryHandle & {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    }
  ).entries();

  for await (const [name, handle] of entriesIterable) {
    if (name.startsWith('.')) continue;

    if (handle.kind === 'file') {
      totalFilesEncountered += 1;
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        if (isAudioFile(file)) {
          entries.push({
            file,
            relativePath: `${rootPrefix}/${name}`,
          });
        }
      } catch (err) {
        errors.push({
          path: `${rootPrefix}/${name}`,
          message:
            err instanceof Error && err.message
              ? err.message
              : 'File could not be read (locked or permission denied).',
          code: 'unreadable-file',
        });
      }
    } else if (handle.kind === 'directory') {
      try {
        const nested = await walkDirectoryHandleWithReport(
          handle as FileSystemDirectoryHandle,
          `${rootPrefix}/${name}`
        );
        entries.push(...nested.entries);
        totalFilesEncountered += nested.totalFilesEncountered;
        errors.push(...nested.errors);
      } catch (err) {
        errors.push({
          path: `${rootPrefix}/${name}`,
          message:
            err instanceof Error && err.message
              ? err.message
              : 'Subfolder could not be accessed.',
          code: 'inaccessible-folder',
        });
      }
    }
  }

  return { entries, totalFilesEncountered, errors };
}

/**
 * Recursively walks a FileSystemDirectoryHandle and collects all audio files.
 */
export async function walkDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  prefix = ''
): Promise<ScannedFileEntry[]> {
  const report = await walkDirectoryHandleWithReport(dirHandle, prefix);
  return report.entries;
}

interface WebkitFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (success: (file: File) => void, error?: (err: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: WebkitFileSystemEntry[]) => void,
      error?: (err: unknown) => void
    ) => void;
  };
}

async function readWebkitEntry(
  entry: WebkitFileSystemEntry,
  parentPath = '',
  errors: ScanErrorEntry[] = []
): Promise<ScannedFileEntry[]> {
  if (entry.name.startsWith('.')) return [];

  if (entry.isFile && entry.file) {
    return new Promise<ScannedFileEntry[]>((resolve) => {
      const targetPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
      entry.file!(
        (file) => {
          const rel = parentPath ? `${parentPath}/${file.name}` : file.name;
          resolve([{ file, relativePath: rel }]);
        },
        (err) => {
          errors.push({
            path: targetPath,
            message:
              err instanceof Error && err.message
                ? err.message
                : 'Dropped file could not be read.',
            code: 'unreadable-file',
          });
          resolve([]);
        }
      );
    });
  }

  if (entry.isDirectory && entry.createReader) {
    const dirPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    const reader = entry.createReader();
    const allChildren: WebkitFileSystemEntry[] = [];

    // readEntries returns batches (often max 100) until empty array
    await new Promise<void>((resolve) => {
      const readBatch = () => {
        reader.readEntries(
          (batch) => {
            if (!batch || batch.length === 0) {
              resolve();
            } else {
              allChildren.push(...batch);
              readBatch();
            }
          },
          (err) => {
            errors.push({
              path: dirPath,
              message:
                err instanceof Error && err.message
                  ? err.message
                  : 'Dropped folder could not be read completely.',
              code: 'inaccessible-folder',
            });
            resolve();
          }
        );
      };
      readBatch();
    });

    const nestedResults: ScannedFileEntry[] = [];
    for (const child of allChildren) {
      const childFiles = await readWebkitEntry(child, dirPath, errors);
      nestedResults.push(...childFiles);
    }
    return nestedResults;
  }

  return [];
}

/**
 * Extracts all dropped files — including recursively traversing dropped folders
 * via webkitGetAsEntry when supported by the browser.
 */
export async function extractDroppedEntries(
  dataTransfer: DataTransfer
): Promise<{ entries: ScannedFileEntry[]; folderRootName?: string; errors: ScanErrorEntry[] }> {
  const items = Array.from(dataTransfer.items ?? []);
  const webkitEntries: WebkitFileSystemEntry[] = [];
  const errors: ScanErrorEntry[] = [];

  for (const item of items) {
    const withWebkit = item as DataTransferItem & {
      webkitGetAsEntry?: () => WebkitFileSystemEntry | null;
    };
    if (typeof withWebkit.webkitGetAsEntry === 'function') {
      const entry = withWebkit.webkitGetAsEntry();
      if (entry) webkitEntries.push(entry);
    }
  }

  if (webkitEntries.length > 0) {
    const results: ScannedFileEntry[] = [];
    let folderRootName: string | undefined;
    if (webkitEntries.length === 1 && webkitEntries[0].isDirectory) {
      folderRootName = webkitEntries[0].name;
    }
    for (const entry of webkitEntries) {
      const extracted = await readWebkitEntry(entry, '', errors);
      results.push(...extracted);
    }
    return { entries: results, folderRootName, errors };
  }

  const files = Array.from(dataTransfer.files ?? []);
  return {
    entries: files.map((file) => ({
      file,
      relativePath:
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    })),
    errors,
  };
}

/**
 * Computes the exact sync delta between a playlist's current tracklist,
 * its last synced snapshot, and the current state of local device storage.
 */
export function computePlaylistDiff(
  playlist: Playlist,
  trackMap: Map<string, LocalTrack>
): PlaylistDiff {
  const currentSet = new Set(playlist.trackIds);
  const syncedSet = new Set(playlist.syncedTrackIds);

  const toAdd: LocalTrack[] = [];
  const toRemove: LocalTrack[] = [];
  const missingOnDevice: LocalTrack[] = [];

  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const id of playlist.trackIds) {
    const track = trackMap.get(id);
    if (!track) continue;

    if (track.youtubeVideoId) {
      matchedCount++;
    } else if (track.matchStatus !== 'skipped') {
      unmatchedCount++;
    }

    if (track.isMissingOnDevice) {
      missingOnDevice.push(track);
      if (playlist.syncRule.removeMissingFiles && syncedSet.has(id)) {
        toRemove.push(track);
      }
    } else if (!syncedSet.has(id)) {
      toAdd.push(track);
    }
  }

  // Tracks previously synced that were manually removed from playlist.trackIds
  for (const id of playlist.syncedTrackIds) {
    if (!currentSet.has(id)) {
      const track = trackMap.get(id);
      if (track && !toRemove.some((t) => t.id === track.id)) {
        toRemove.push(track);
      }
    }
  }

  // If autoAddNewFiles is enabled and a folderFilter matches device tracks not yet in playlist
  if (playlist.syncRule.autoAddNewFiles) {
    const filter = playlist.syncRule.folderFilter.trim().toLowerCase();
    for (const track of trackMap.values()) {
      if (track.isMissingOnDevice) continue;
      if (currentSet.has(track.id)) continue;
      const matchesFolder =
        !filter ||
        track.relativePath.toLowerCase().startsWith(filter) ||
        track.folderName.toLowerCase() === filter;
      if (matchesFolder && !toAdd.some((t) => t.id === track.id)) {
        toAdd.push(track);
      }
    }
  }

  return {
    playlistId: playlist.id,
    toAdd,
    toRemove,
    missingOnDevice,
    unmatchedCount,
    matchedCount,
    hasChanges: toAdd.length > 0 || toRemove.length > 0,
  };
}
