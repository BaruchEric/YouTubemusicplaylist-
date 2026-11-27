/**
 * The list of folders the user picked with the folder chooser.
 *
 * Each folder keeps its own handle and the file keys of the songs its last scan saw. A song
 * plays from a folder only when that folder's keys hold it, so two folders with the same
 * name never stand in for each other.
 */
import type { LocalTrack } from '../types/music';
import { needsFolderRead, type DeviceAudio } from './deviceAudio';
import { readTrackFromFolder, type FolderDirectory } from './folderAudio';
import type { FolderPermission, WatchIntervalSec } from './folderWatch';

/** One picked folder. `H` is the handle type, a FileSystemDirectoryHandle in the app. */
export interface WatchedFolder<H = FileSystemDirectoryHandle> {
  readonly id: string;
  readonly handle: H;
  /** File keys of the songs the last scan of this folder saw in it. */
  readonly fileKeys: ReadonlySet<string>;
}

type FolderList<H> = ReadonlyArray<WatchedFolder<H>>;

/** The part of a handle that says whether another handle is the same folder on disk. */
interface SameEntryTest<H> {
  isSameEntry(other: H): Promise<boolean>;
}

/**
 * The folder of the list that `handle` is, or null. The browser decides, so a second folder
 * with the same name is another folder, and a folder picked twice is one.
 */
export async function findSameFolder<H extends SameEntryTest<H>>(
  folders: FolderList<H>,
  handle: H
): Promise<WatchedFolder<H> | null> {
  for (const folder of folders) {
    try {
      if (await folder.handle.isSameEntry(handle)) return folder;
    } catch {
      // A handle the browser can no longer compare counts for another folder.
    }
  }
  return null;
}

/** The list with a newly picked folder at its end. No scan has seen a song in it yet. */
export function addFolder<H>(
  folders: FolderList<H>,
  picked: { id: string; handle: H }
): WatchedFolder<H>[] {
  return [...folders, { id: picked.id, handle: picked.handle, fileKeys: new Set<string>() }];
}

export function removeFolder<H>(folders: FolderList<H>, id: string): WatchedFolder<H>[] {
  return folders.filter((folder) => folder.id !== id);
}

/**
 * The list with one folder's songs replaced by what its scan saw. A folder that left the
 * list while it was scanned gets nothing, and the caller can tell by looking for its id.
 */
export function withFolderFileKeys<H>(
  folders: FolderList<H>,
  id: string,
  fileKeys: ReadonlySet<string>
): WatchedFolder<H>[] {
  return folders.map((folder) => (folder.id === id ? { ...folder, fileKeys } : folder));
}

/** The list with one folder's handle replaced by the handle of a new pick of that folder. */
export function withFolderHandle<H>(
  folders: FolderList<H>,
  id: string,
  handle: H
): WatchedFolder<H>[] {
  return folders.map((folder) => (folder.id === id ? { ...folder, handle } : folder));
}

/** File keys of the songs any picked folder holds. */
export function unionFileKeys<H>(folders: FolderList<H>): Set<string> {
  return fileKeysOfOtherFolders(folders, null);
}

/**
 * File keys of the songs held by every folder but the one with this id. Null is for a scan
 * that came from no folder of the list, such as dropped files.
 */
export function fileKeysOfOtherFolders<H>(folders: FolderList<H>, id: string | null): Set<string> {
  const keys = new Set<string>();
  for (const folder of folders) {
    if (folder.id === id) continue;
    for (const key of folder.fileKeys) keys.add(key);
  }
  return keys;
}

/** The folders whose last scan saw the song, in list order. */
export function foldersHoldingKey<H>(folders: FolderList<H>, fileKey: string): WatchedFolder<H>[] {
  return folders.filter((folder) => folder.fileKeys.has(fileKey));
}

/** File keys of the songs this folder holds and no other folder does. */
export function keysOnlyInFolder<H>(folders: FolderList<H>, id: string): Set<string> {
  const folder = folders.find((candidate) => candidate.id === id);
  if (!folder) return new Set();
  const elsewhere = fileKeysOfOtherFolders(folders, id);
  return new Set([...folder.fileKeys].filter((key) => !elsewhere.has(key)));
}

export interface FolderScanOutcome {
  /** The name of the folder that was scanned in full. */
  folderName: string;
  /** File keys of the songs the scan saw. */
  seenKeys: ReadonlySet<string>;
  /** File keys held by the picked folders other than the scanned one. */
  otherFolderKeys: ReadonlySet<string>;
}

/**
 * True when a full scan of a folder shows that a song is gone from this device. The song's
 * folder name or path has to put it in the scanned folder, the scan must not have seen it,
 * and no other picked folder may hold it. Without the last test a scan of one folder named
 * Music would take away the songs of another folder named Music.
 */
export function isMissingAfterScan(
  track: Pick<LocalTrack, 'fileKey' | 'folderName' | 'relativePath'>,
  scan: FolderScanOutcome
): boolean {
  const scope = scan.folderName.toLowerCase();
  if (!scope) return false;
  const isInFolderByName =
    track.folderName.toLowerCase() === scope ||
    track.relativePath.toLowerCase().startsWith(`${scope}/`);
  return (
    isInFolderByName && !scan.seenKeys.has(track.fileKey) && !scan.otherFolderKeys.has(track.fileKey)
  );
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'directory' &&
    'name' in value &&
    typeof value.name === 'string'
  );
}

function textKeys(saved: unknown): Set<string> {
  const keys: unknown[] = Array.isArray(saved) ? saved : [];
  return new Set(keys.filter((key) => typeof key === 'string'));
}

/**
 * The list an older version's record becomes. That version kept one folder: its handle
 * under one key and its file keys under another. Keys with no handle can read no file, so
 * they make no folder.
 */
export function foldersFromLegacyRecord(
  legacy: { handle: unknown; fileKeys: unknown },
  id: string
): WatchedFolder[] {
  if (!isDirectoryHandle(legacy.handle)) return [];
  return [{ id, handle: legacy.handle, fileKeys: textKeys(legacy.fileKeys) }];
}

/** A folder as IndexedDB stores it. The keys are a plain list. */
export interface StoredWatchedFolder<H = FileSystemDirectoryHandle> {
  id: string;
  handle: H;
  fileKeys: string[];
}

export function toStoredFolders<H>(folders: FolderList<H>): StoredWatchedFolder<H>[] {
  return folders.map((folder) => ({
    id: folder.id,
    handle: folder.handle,
    fileKeys: [...folder.fileKeys],
  }));
}

/** Reads the saved list back. An entry the app cannot use is left out. */
export function parseStoredFolders(saved: unknown): WatchedFolder[] {
  const entries: unknown[] = Array.isArray(saved) ? saved : [];
  const folders: WatchedFolder[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    if (!('id' in entry) || typeof entry.id !== 'string') continue;
    if (!('handle' in entry) || !isDirectoryHandle(entry.handle)) continue;
    const fileKeys = 'fileKeys' in entry ? entry.fileKeys : undefined;
    folders.push({ id: entry.id, handle: entry.handle, fileKeys: textKeys(fileKeys) });
  }
  return folders;
}

/** What a read needs to know about the picked folders. */
export interface FoldersSource<H extends FolderDirectory> {
  folders: FolderList<H>;
  /**
   * Says whether one folder may be read now. It may show the browser's permission prompt
   * only when `mayPrompt` is true.
   */
  ensurePermission(folder: WatchedFolder<H>, mayPrompt: boolean): Promise<FolderPermission>;
}

/**
 * Reads a song from the first picked folder that can supply it. Only a folder whose scan
 * saw the song is tried, so no folder is asked for or read on the strength of its name. A
 * folder the browser withholds, or one the file is gone from, gives its turn to the next.
 * Null sends the caller on to the next source.
 *
 * `clickIsFresh` is asked again before each folder. A prompt can stay up for a long time,
 * and the browser shows the next one only while the click still counts as just made.
 */
export async function readTrackFromFolders<H extends FolderDirectory>(
  track: Pick<LocalTrack, 'fileKey' | 'relativePath'>,
  source: FoldersSource<H>,
  clickIsFresh: () => boolean
): Promise<File | null> {
  for (const folder of foldersHoldingKey(source.folders, track.fileKey)) {
    const file = await readTrackFromFolder(
      track,
      {
        folder: folder.handle,
        fileKeys: folder.fileKeys,
        ensurePermission: (_handle, mayPrompt) => source.ensurePermission(folder, mayPrompt),
      },
      clickIsFresh()
    );
    if (file) return file;
  }
  return null;
}

/**
 * Finds out which folders may be read, one folder at a time and in list order. `ask` may
 * prompt only when told so, and it is told so only while `clickIsFresh` says the click
 * still counts. The timed check passes a `clickIsFresh` that is always false.
 */
export async function askForFoldersInTurn<F>(
  folders: readonly F[],
  ask: (folder: F, mayPrompt: boolean) => Promise<FolderPermission>,
  clickIsFresh: () => boolean
): Promise<{ granted: F[]; refused: F[] }> {
  const granted: F[] = [];
  const refused: F[] = [];
  for (const folder of folders) {
    const permission = await ask(folder, clickIsFresh());
    if (permission === 'granted') granted.push(folder);
    else refused.push(folder);
  }
  return { granted, refused };
}

/**
 * The folders a job has to read: each holds one of the job's songs that neither memory nor
 * the browser's storage can supply. A job that reads many songs asks for these at the click
 * that starts it.
 */
export function foldersToReadFor<H>(
  songs: ReadonlyArray<Pick<LocalTrack, 'fileKey'>>,
  folders: FolderList<H>,
  held: Pick<DeviceAudio, 'memory' | 'storedKeys'>
): WatchedFolder<H>[] {
  return folders.filter((folder) =>
    needsFolderRead(songs, { ...held, folderKeys: folder.fileKeys })
  );
}

/** What the browser last said about each folder, by folder id. */
export type FolderPermissions = Readonly<Record<string, FolderPermission>>;

/** A folder with no answer on record is one the user just picked, which the browser allows. */
function permissionOf(permissions: FolderPermissions, id: string): FolderPermission {
  return permissions[id] ?? 'granted';
}

/** One answer for the whole list: it needs permission as soon as one folder does. */
export function summarizeFolderPermission<H>(
  folders: FolderList<H>,
  permissions: FolderPermissions
): FolderPermission {
  return folders.some((folder) => permissionOf(permissions, folder.id) === 'needs-permission')
    ? 'needs-permission'
    : 'granted';
}

/** True when the timed check has a folder to scan without asking for it. */
export function hasReadableFolder<H>(folders: FolderList<H>, permissions: FolderPermissions): boolean {
  return folders.some((folder) => permissionOf(permissions, folder.id) === 'granted');
}

export type FolderRowState = 'watching' | 'idle' | 'needs-access';

/** One line of the folder list on the Device Storage page. */
export interface FolderRow {
  id: string;
  name: string;
  /** How many songs the last scan of the folder saw. */
  songCount: number;
  state: FolderRowState;
}

export function listFolderRows<H extends { readonly name: string }>(
  folders: FolderList<H>,
  permissions: FolderPermissions,
  intervalSec: WatchIntervalSec
): FolderRow[] {
  return folders.map((folder) => {
    const mayRead = permissionOf(permissions, folder.id) === 'granted';
    return {
      id: folder.id,
      name: folder.handle.name,
      songCount: folder.fileKeys.size,
      state: !mayRead ? 'needs-access' : intervalSec === 0 ? 'idle' : 'watching',
    };
  });
}

function quoteNames(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  const last = quoted.pop();
  if (last === undefined) return '';
  return quoted.length === 0 ? last : `${quoted.join(', ')} and ${last}`;
}

/**
 * The notice after a click on Re-scan. One folder's notice stands as the scan wrote it.
 * With more folders each notice gets its folder's name, and the folders the browser did
 * not let the app read are named last.
 */
export function describeRescan(
  scanned: ReadonlyArray<{ name: string; notice: string | null }>,
  refusedNames: readonly string[]
): string | null {
  const isOnlyFolder = scanned.length === 1 && refusedNames.length === 0;
  const parts: string[] = [];
  for (const { name, notice } of scanned) {
    if (notice) parts.push(isOnlyFolder ? notice : `${name}: ${notice}`);
  }
  if (refusedNames.length > 0) {
    parts.push(`Folder read permission was not granted for ${quoteNames(refusedNames)}.`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/** How the top bar speaks of the folders: one by name, several by their number. */
export function describeFolders(names: readonly string[]): string {
  if (names.length === 0) return 'the folder';
  return names.length === 1 ? quoteNames(names) : `${names.length} folders`;
}

/** What the confirm window says before a folder leaves the list. */
export function describeFolderRemoval(folder: { songCount: number }): string {
  const opening = 'CrateSync stops reading this folder.';
  if (folder.songCount <= 0) {
    return `${opening} Its last scan saw no songs in it. No file on your disk is touched.`;
  }
  const one = folder.songCount === 1;
  const songs = one
    ? 'The 1 song its last scan saw stays in your library. It plays again once you scan the folder again, or from Google Drive when it has a Drive file.'
    : `The ${folder.songCount} songs its last scan saw stay in your library. They play again once you scan the folder again, or from Google Drive when they have a Drive file.`;
  return `${opening} ${songs} No file on your disk is touched, and no stored copy is removed.`;
}
