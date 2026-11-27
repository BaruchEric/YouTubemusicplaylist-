/**
 * Decides, for each audio file a folder scan finds, which song in the library it is.
 *
 * A song listed from Google Drive starts with a path under "Google Drive/..." and no local
 * file. When a scan finds a file with the same name and byte size, that file is the local
 * copy of the Drive song, so the song takes the file's path instead of the library gaining
 * a second entry for it.
 */
import type { LocalTrack } from '../types/music';
import { foldFileName, nameSizeKey } from './fileNameKey';

/** What a scan knows about a file before reading it. */
export interface ScannedFile {
  name: string;
  size: number;
  /** The path from the scanned folder's name down, such as "Music/Artist/Album/01 Song.mp3". */
  relativePath: string;
}

export type ScanMatch =
  /** The library has this file already. The song keeps its path. */
  | { kind: 'known'; track: LocalTrack }
  /** The file is the local copy of a Drive song that had no local file. The song takes its path. */
  | { kind: 'drive-copy'; track: LocalTrack }
  | { kind: 'new' };

export interface ScanMatcher {
  /** Call once per scanned file. A Drive song goes to the first file that fits it. */
  match(file: ScannedFile): ScanMatch;
}

function pathSizeKey(relativePath: string, size: number): string {
  return `${foldFileName(relativePath)}::${size}`;
}

/** True while a Drive song still sits at the path Drive gave it, so no local file holds it. */
function isAtDrivePath(track: LocalTrack): boolean {
  if (!track.driveFileId || !track.drivePath) return false;
  return foldFileName(track.relativePath) === foldFileName(`${track.drivePath}/${track.fileName}`);
}

/** How many folders two paths share, counted back from the file. */
function sharedParentFolders(a: string, b: string): number {
  const left = foldFileName(a).split('/').slice(0, -1).reverse();
  const right = foldFileName(b).split('/').slice(0, -1).reverse();
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared++;
  return shared;
}

/**
 * Builds the matcher for one scan. `hasAudioOnDevice` says whether this device holds the
 * audio for a song's key: in memory, in the browser's storage or in the picked folder.
 */
export function createScanMatcher(
  tracks: readonly LocalTrack[],
  hasAudioOnDevice: (fileKey: string) => boolean
): ScanMatcher {
  const byKey = new Map<string, LocalTrack>();
  // A Drive song keeps its gdrive:: key after it takes a local path, so the path and size
  // find it on the next scan.
  const byPathSize = new Map<string, LocalTrack>();
  const byNameSize = new Map<string, LocalTrack[]>();
  for (const track of tracks) {
    byKey.set(track.fileKey, track);
    if (track.fileSize <= 0) continue;
    byPathSize.set(pathSizeKey(track.relativePath, track.fileSize), track);
    const key = nameSizeKey(track.fileName, track.fileSize);
    const list = byNameSize.get(key);
    if (list) list.push(track);
    else byNameSize.set(key, [track]);
  }

  /** Drive songs a file of this scan already took. */
  const taken = new Set<string>();

  return {
    match(file) {
      // A scanned song's key is its path as the disk spelled it, in lower case.
      const same =
        byKey.get(`${file.relativePath.toLowerCase()}::${file.size}`) ??
        byPathSize.get(pathSizeKey(file.relativePath, file.size));
      if (same) return { kind: 'known', track: same };
      if (file.size <= 0) return { kind: 'new' };

      const candidates = byNameSize.get(nameSizeKey(file.name, file.size)) ?? [];

      let driveSong: LocalTrack | null = null;
      let driveSongScore = -1;
      for (const candidate of candidates) {
        if (taken.has(candidate.id) || !isAtDrivePath(candidate)) continue;
        const score = sharedParentFolders(candidate.relativePath, file.relativePath);
        if (score > driveSongScore) {
          driveSong = candidate;
          driveSongScore = score;
        }
      }
      // A file picked on its own carries no folder, so there is no path for a song to take.
      const isLoose = !file.relativePath.includes('/');
      if (driveSong) {
        taken.add(driveSong.id);
        return { kind: isLoose ? 'known' : 'drive-copy', track: driveSong };
      }

      // With only a name and a size to go by, a loose file goes back to a song that lost its
      // audio, never to one that still has it.
      if (isLoose) {
        const orphan = candidates.find(
          (candidate) =>
            !taken.has(candidate.id) &&
            (candidate.isMissingOnDevice || !hasAudioOnDevice(candidate.fileKey))
        );
        if (orphan) return { kind: 'known', track: orphan };
      }
      return { kind: 'new' };
    },
  };
}

/** The Drive song as it is once a local file holds it: the file's path, the Drive identity kept. */
export function linkDriveSongToLocalFile(track: LocalTrack, file: ScannedFile): LocalTrack {
  const segments = file.relativePath.split('/').filter(Boolean);
  return {
    ...track,
    relativePath: file.relativePath,
    folderName: segments.length > 1 ? (segments[0] ?? track.folderName) : track.folderName,
  };
}
