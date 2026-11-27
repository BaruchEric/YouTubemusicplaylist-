/**
 * Plays a song straight from the folder the user picked with the folder chooser.
 *
 * A scan of that folder records which songs it saw there. Those songs are read from the
 * folder when they play, so the scan keeps no copy of them in the browser's storage.
 */
import type { LocalTrack } from '../types/music';
import { foldFileName } from './fileNameKey';
import type { FolderPermission } from './folderWatch';
import { formatFileSize } from './youtubeLinks';

export interface FolderFile {
  getFile(): Promise<File>;
}

/** The part of a directory handle the reader uses. A FileSystemDirectoryHandle fits it. */
export interface FolderDirectory {
  readonly name: string;
  getDirectoryHandle(name: string): Promise<FolderDirectory>;
  getFileHandle(name: string): Promise<FolderFile>;
  /** Lists the folder by entry name. The reader uses it only when a name is not found as spelled. */
  entries(): AsyncIterable<[string, unknown]>;
}

function errorName(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || !('name' in err)) return null;
  return typeof err.name === 'string' ? err.name : null;
}

/** True when the browser says the name is not there, or is a folder where a file should be. */
function isMissingEntry(err: unknown): boolean {
  const name = errorName(err);
  return name === 'NotFoundError' || name === 'TypeMismatchError';
}

/** The name the disk uses for an entry the library spells another way, or null. */
async function findSpellingOnDisk(dir: FolderDirectory, name: string): Promise<string | null> {
  const wanted = foldFileName(name);
  for await (const [onDisk] of dir.entries()) {
    if (onDisk !== name && foldFileName(onDisk) === wanted) return onDisk;
  }
  return null;
}

async function openEntry<T>(
  dir: FolderDirectory,
  name: string,
  open: (dir: FolderDirectory, name: string) => Promise<T>
): Promise<T | null> {
  try {
    return await open(dir, name);
  } catch (err) {
    if (!isMissingEntry(err)) throw err;
  }
  // A folder on a Mac can spell an accent as a letter plus a combining mark where the
  // library holds one character. The browser matches names exactly, so look the name up.
  const onDisk = await findSpellingOnDisk(dir, name);
  return onDisk === null ? null : open(dir, onDisk);
}

/**
 * Reads the file at `relativePath` from the folder. The path starts with the folder's own
 * name, such as "Music/Artist/Album/01 Song.mp3". Gives null when the file is not there.
 * Any other failure, such as the browser taking folder access back, is thrown.
 */
export async function readFolderFile(
  root: FolderDirectory,
  relativePath: string
): Promise<File | null> {
  const [rootName, ...below] = relativePath.split('/').filter(Boolean);
  const fileName = below.pop();
  // A file picked on its own has no folder, and a path under another name is another folder.
  if (rootName === undefined || fileName === undefined) return null;
  if (foldFileName(rootName) !== foldFileName(root.name)) return null;

  try {
    let dir = root;
    for (const folderName of below) {
      const next = await openEntry(dir, folderName, (parent, name) =>
        parent.getDirectoryHandle(name)
      );
      if (!next) return null;
      dir = next;
    }
    const handle = await openEntry(dir, fileName, (parent, name) => parent.getFileHandle(name));
    return handle ? await handle.getFile() : null;
  } catch (err) {
    if (isMissingEntry(err)) return null;
    throw err;
  }
}

/** What a read needs to know about the picked folder. */
export interface FolderSource {
  /** The folder the user picked, or null when none is saved. */
  folder: FolderDirectory | null;
  /** File keys of the songs the last scan of that folder saw in it. */
  fileKeys: ReadonlySet<string>;
  /**
   * Says whether the folder may be read now. It may show the browser's permission prompt
   * only when `mayPrompt` is true.
   */
  ensurePermission(folder: FolderDirectory, mayPrompt: boolean): Promise<FolderPermission>;
}

/**
 * Reads a song from the picked folder, or gives null when the folder cannot supply it:
 * the scan did not see the song there, no folder is saved, the browser withholds access,
 * or the file is gone. The caller then tries the next source.
 */
export async function readTrackFromFolder(
  track: Pick<LocalTrack, 'fileKey' | 'relativePath'>,
  source: FolderSource,
  mayPrompt: boolean
): Promise<File | null> {
  const { folder } = source;
  if (!folder || !source.fileKeys.has(track.fileKey)) return null;
  if ((await source.ensurePermission(folder, mayPrompt)) !== 'granted') return null;
  try {
    return await readFolderFile(folder, track.relativePath);
  } catch {
    // Access can end between the check and the read. The next source gets its turn.
    return null;
  }
}

export interface FolderScanStoragePlan {
  /** File keys of the songs that now play from the folder. */
  folderKeys: Set<string>;
  /** Stored copies the scan makes needless, by file key. */
  freeKeys: string[];
  /** The bytes those copies hold. */
  freedBytes: number;
}

/**
 * Works out what a scan of the picked folder does to the browser's storage. Every song it
 * saw plays from the folder from now on, so a stored copy of such a song is freed. A copy
 * of a song the scan did not see stays, because nothing else on this device holds it.
 */
export function planFolderScanStorage(
  seen: ReadonlyArray<{ fileKey: string; size: number }>,
  storedKeys: ReadonlySet<string>
): FolderScanStoragePlan {
  const folderKeys = new Set<string>();
  const freeKeys: string[] = [];
  let freedBytes = 0;
  for (const { fileKey, size } of seen) {
    if (folderKeys.has(fileKey)) continue;
    folderKeys.add(fileKey);
    if (storedKeys.has(fileKey)) {
      freeKeys.push(fileKey);
      // The stored copy is a copy of this file, so the file's size is the copy's size.
      freedBytes += size;
    }
  }
  return { folderKeys, freeKeys, freedBytes };
}

/** The sentence a scan adds to its notice after it freed stored copies, or null. */
export function describeFreedStorage(freed: { songCount: number; bytes: number }): string | null {
  if (freed.songCount <= 0) return null;
  const songs =
    freed.songCount === 1
      ? 'This song now plays from the folder.'
      : 'These songs now play from the folder.';
  return `Freed ${formatFileSize(freed.bytes)} of browser storage. ${songs}`;
}
