/**
 * The one answer to "is this song's audio on this device" and the one way to read it.
 *
 * A song's audio can be in three places here: a file held in memory since this page
 * loaded, a copy in the browser's storage, or a file in the folder the user picked.
 */
import type { LocalTrack } from '../types/music';

export interface DeviceAudio {
  /** Files held in memory since the page loaded, by file key. */
  memory: ReadonlyMap<string, Blob>;
  /** File keys of the copies in the browser's storage. */
  storedKeys: ReadonlySet<string>;
  /** File keys of the songs the last scan of the picked folder saw there. */
  folderKeys: ReadonlySet<string>;
}

/** True when the device can play the song without a download. */
export function hasAudioOnDevice(fileKey: string, audio: DeviceAudio): boolean {
  return (
    audio.memory.has(fileKey) || audio.storedKeys.has(fileKey) || audio.folderKeys.has(fileKey)
  );
}

/**
 * True when reading one of these songs means reading the picked folder, because neither
 * memory nor the browser's storage holds it. A job that reads many songs checks this at the
 * click that starts it, and asks for the folder then.
 */
export function needsFolderRead(
  tracks: ReadonlyArray<Pick<LocalTrack, 'fileKey'>>,
  audio: DeviceAudio
): boolean {
  return tracks.some(
    ({ fileKey }) =>
      audio.folderKeys.has(fileKey) && !audio.memory.has(fileKey) && !audio.storedKeys.has(fileKey)
  );
}

/**
 * Asks for the picked folder when one of these songs has to be read from it. A job that
 * reads many songs calls it once, in the click that starts the job. Its reads come too late
 * to ask, since a click stays fresh for a few seconds only, and too often: after a No, each
 * further song would bring the prompt up again.
 */
export type PrepareFolderRead = (
  tracks: ReadonlyArray<Pick<LocalTrack, 'fileKey'>>
) => Promise<void>;

type ReadableTrack = Pick<LocalTrack, 'fileKey' | 'relativePath'>;

/**
 * Whether a read may bring up the browser's prompt for folder access. 'may-ask' is for the
 * one read behind a click on Play. The prompt still shows only while the click is fresh, so
 * a song that starts by itself never asks. 'never-ask' is for every other read: the next
 * song loaded ahead of time, and the songs of a long job, which asks once before it starts.
 */
export type FolderAsk = 'may-ask' | 'never-ask';

/** Reads a song's bytes from this device, or gives null when the device does not hold them. */
export type ReadTrackAudio = (track: ReadableTrack, ask?: FolderAsk) => Promise<Blob | null>;

export interface AudioSources {
  memory: Map<string, Blob>;
  loadStored(fileKey: string): Promise<Blob | null>;
  readFromFolder(track: ReadableTrack, ask: FolderAsk): Promise<Blob | null>;
}

/**
 * Reads a song's bytes: memory first, then the stored copy, then the picked folder. What
 * it finds stays in memory, so the next read of the song costs nothing.
 */
export async function readTrackAudio(
  track: ReadableTrack,
  sources: AudioSources,
  ask: FolderAsk = 'never-ask'
): Promise<Blob | null> {
  const inMemory = sources.memory.get(track.fileKey);
  if (inMemory) return inMemory;
  const found =
    (await sources.loadStored(track.fileKey)) ?? (await sources.readFromFolder(track, ask));
  if (found) sources.memory.set(track.fileKey, found);
  return found;
}

export interface UnplayableNotice {
  message: string;
  /** True when picking the file again is the way to get the song back. */
  offerRelink: boolean;
}

/**
 * What the player says when it found no audio for a song with no Drive file and no video.
 * `inPickedFolder` is hasAudioOnDevice for the song at that point. A file in memory or a
 * stored copy would have played, so true means the last scan saw the song in the picked
 * folder and the read gave nothing: the browser withholds the folder, or the file moved.
 */
export function describeUnplayable(song: { inPickedFolder: boolean }): UnplayableNotice {
  if (song.inPickedFolder) {
    return {
      message: 'Folder access needed. Press Play again and allow it, or re-scan if the file moved.',
      offerRelink: false,
    };
  }
  return {
    message: 'Audio file not cached yet. Re-select your local file or folder to play.',
    offerRelink: true,
  };
}
