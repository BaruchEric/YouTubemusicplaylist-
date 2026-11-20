import type { LocalTrack, Playlist, PlaylistDiff } from '../types/music';
import { isAudioFile } from './audioMetadata';

export interface ScannedFileEntry {
  file: File;
  relativePath: string;
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
 * Recursively walks a FileSystemDirectoryHandle and collects all audio files.
 */
export async function walkDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  prefix = ''
): Promise<ScannedFileEntry[]> {
  const results: ScannedFileEntry[] = [];
  const rootPrefix = prefix || dirHandle.name;

  const entriesIterable = (
    dirHandle as FileSystemDirectoryHandle & {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    }
  ).entries();

  for await (const [name, handle] of entriesIterable) {
    if (name.startsWith('.')) continue;

    if (handle.kind === 'file') {
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        if (isAudioFile(file)) {
          results.push({
            file,
            relativePath: `${rootPrefix}/${name}`,
          });
        }
      } catch {
        // Ignore unreadable locked file
      }
    } else if (handle.kind === 'directory') {
      try {
        const nested = await walkDirectoryHandle(
          handle as FileSystemDirectoryHandle,
          `${rootPrefix}/${name}`
        );
        results.push(...nested);
      } catch {
        // Ignore inaccessible subfolder
      }
    }
  }

  return results;
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
  parentPath = ''
): Promise<ScannedFileEntry[]> {
  if (entry.name.startsWith('.')) return [];

  if (entry.isFile && entry.file) {
    return new Promise<ScannedFileEntry[]>((resolve) => {
      entry.file!(
        (file) => {
          const rel = parentPath ? `${parentPath}/${file.name}` : file.name;
          resolve([{ file, relativePath: rel }]);
        },
        () => resolve([])
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
          () => resolve()
        );
      };
      readBatch();
    });

    const nestedResults: ScannedFileEntry[] = [];
    for (const child of allChildren) {
      const childFiles = await readWebkitEntry(child, dirPath);
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
): Promise<{ entries: ScannedFileEntry[]; folderRootName?: string }> {
  const items = Array.from(dataTransfer.items ?? []);
  const webkitEntries: WebkitFileSystemEntry[] = [];

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
      const extracted = await readWebkitEntry(entry);
      results.push(...extracted);
    }
    return { entries: results, folderRootName };
  }

  const files = Array.from(dataTransfer.files ?? []);
  return {
    entries: files.map((file) => ({
      file,
      relativePath:
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    })),
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
