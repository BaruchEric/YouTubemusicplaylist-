import type { LocalTrack } from '../types/music';
import {
  readTagsFromBlob,
  readTagsFromFileHead,
  type AudioFileTags,
  type CoverArtCompressor,
} from './audioMetadata';
import { applyFileTags } from './fileTags';
import { DriveApiError } from './googleDriveApi';
import { isListOnlyTrack } from './trackSource';

/** The reader hands over changed fields each time it has finished this many songs. */
export const TAG_READ_BATCH_SIZE = 25;
/** Songs read at the same time unless the caller asks for another number. */
export const TAG_READ_CONCURRENCY = 4;

const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_FIRST_WAIT_MS = 1000;
const NETWORK_RETRY_WAIT_MS = 1000;

/**
 * A song the Drive listing added and nothing has read since: it has a Drive file and no
 * duration. An entry from an imported list has no file to read.
 */
export function needsTagRead(track: LocalTrack): boolean {
  return Boolean(track.driveFileId) && track.duration === 0 && !isListOnlyTrack(track);
}

export function countTracksNeedingTagRead(tracks: readonly LocalTrack[]): number {
  let count = 0;
  for (const track of tracks) {
    if (needsTagRead(track)) count += 1;
  }
  return count;
}

/**
 * The fields a folder scan fills in on a Drive song from the local file it found for it. The
 * file is already on this device, so reading it costs no download. A song that has been read
 * before, or that was never on Drive, comes back with nothing to change.
 */
export async function readTagsFromScannedFile(
  track: LocalTrack,
  file: Blob,
  options: { compressCover?: CoverArtCompressor } = {}
): Promise<Partial<LocalTrack>> {
  if (!needsTagRead(track)) return {};
  return applyFileTags(track, await readTagsFromBlob(file, track.fileName, options));
}

/** Track id to the fields of that song the file changes. */
export type TagReadUpdates = ReadonlyMap<string, Partial<LocalTrack>>;

export interface TagReadProgress {
  /** Songs finished, whatever the outcome. */
  done: number;
  total: number;
  /** Bytes downloaded from Drive so far. */
  bytes: number;
}

export interface TagReadStop {
  /** stopped: the caller aborted. session-ended: Drive refused the sign-in. */
  reason: 'stopped' | 'session-ended' | 'rate-limited';
  message: string;
}

export interface TagReadResult {
  /** Songs the caller gave the run. */
  total: number;
  /** Songs whose file had at least one tag. */
  read: number;
  /** Songs whose file had no tag. */
  withoutTags: number;
  failed: number;
  /** Bytes downloaded from Drive. */
  bytes: number;
  /** Why the run ended before the last song, or null when it reached it. */
  stopped: TagReadStop | null;
}

export interface TagReadOptions {
  tracks: readonly LocalTrack[];
  /** Downloads bytes start up to, not including, end of a Drive file. */
  readRange: (fileId: string, start: number, end: number) => Promise<ArrayBuffer>;
  /** The copy of a song this browser already stores, so reading it costs no download. */
  localBlob?: (track: LocalTrack) => Promise<Blob | null>;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: TagReadProgress) => void;
  /** The reader calls this every 25 songs and at the end, with the changes since the last call. */
  onBatch?: (updates: TagReadUpdates) => void;
  /** Waits between retries. A test passes one that does not sleep. */
  wait?: (ms: number) => Promise<void>;
  compressCover?: CoverArtCompressor;
}

const STOPPED_BY_CALLER: TagReadStop = {
  reason: 'stopped',
  message: 'The run stopped before it read every song.',
};
const SESSION_ENDED: TagReadStop = {
  reason: 'session-ended',
  message: 'The Google Drive session ended. Sign in again, then run Read Tags for the rest.',
};
const RATE_LIMITED: TagReadStop = {
  reason: 'rate-limited',
  message: 'Google Drive is limiting requests. Run Read Tags again in a few minutes.',
};

function hasAnyTag(tags: AudioFileTags): boolean {
  return Boolean(
    tags.title ||
      tags.artist ||
      tags.album ||
      tags.genre ||
      tags.year ||
      tags.trackNumber ||
      tags.coverArtUrl
  );
}

/**
 * Reads the tags and duration of Drive songs from the first bytes of each file and reports the
 * fields that change. It holds no React state and touches no storage: the caller gives it a
 * way to download a byte range and takes the changes in batches.
 */
export async function readDriveTrackTags(options: TagReadOptions): Promise<TagReadResult> {
  const { tracks, signal, onProgress, onBatch, compressCover } = options;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? TAG_READ_CONCURRENCY));

  const result: TagReadResult = {
    total: tracks.length,
    read: 0,
    withoutTags: 0,
    failed: 0,
    bytes: 0,
    stopped: null,
  };
  let done = 0;
  let pending = new Map<string, Partial<LocalTrack>>();

  // The first reason to stop wins. Songs in flight then end uncounted.
  const stop = (why: TagReadStop) => {
    result.stopped ??= why;
  };
  const aborted = new Promise<void>((resolve) => {
    if (!signal) return;
    if (signal.aborted) {
      stop(STOPPED_BY_CALLER);
      resolve();
      return;
    }
    signal.addEventListener(
      'abort',
      () => {
        stop(STOPPED_BY_CALLER);
        resolve();
      },
      { once: true }
    );
  });
  // A stop ends a wait early.
  const pause = (ms: number) => Promise.race([wait(ms), aborted]);

  const flush = () => {
    if (pending.size === 0) return;
    const batch = pending;
    pending = new Map();
    onBatch?.(batch);
  };

  /** One range of one file, with the retries Drive's errors call for. */
  const readWithRetry = async (fileId: string, start: number, end: number): Promise<ArrayBuffer> => {
    let rateLimitRetries = 0;
    let retriedNetwork = false;
    for (;;) {
      if (result.stopped) throw new Error('The tag read stopped.');
      try {
        const buffer = await options.readRange(fileId, start, end);
        result.bytes += buffer.byteLength;
        return buffer;
      } catch (err) {
        if (result.stopped) throw err;
        if (err instanceof DriveApiError) {
          // A rate limit or a server error passes. Any other answer from Drive is final.
          const passes = err.isRateLimit || err.status >= 500;
          if (err.isAuthError || !passes || rateLimitRetries >= RATE_LIMIT_RETRIES) throw err;
          await pause(RATE_LIMIT_FIRST_WAIT_MS * 2 ** rateLimitRetries);
          rateLimitRetries += 1;
        } else {
          // Not an answer from Drive, so the request never arrived or the reply broke off.
          if (retriedNetwork) throw err;
          retriedNetwork = true;
          await pause(NETWORK_RETRY_WAIT_MS);
        }
      }
    }
  };

  const readTags = async (track: LocalTrack): Promise<AudioFileTags> => {
    let blob: Blob | null = null;
    try {
      blob = options.localBlob ? await options.localBlob(track) : null;
    } catch {
      // Loading the stored copy failed. Drive still has the file.
    }
    if (blob) return readTagsFromBlob(blob, track.fileName, { compressCover });

    const fileId = track.driveFileId;
    if (!fileId) throw new Error(`"${track.fileName}" has no Google Drive file to read.`);
    return readTagsFromFileHead(
      track.fileName,
      track.fileSize,
      (start, end) => readWithRetry(fileId, start, end),
      { compressCover }
    );
  };

  const readOne = async (track: LocalTrack): Promise<void> => {
    try {
      const tags = await readTags(track);
      const changes = applyFileTags(track, tags);
      if (Object.keys(changes).length > 0) pending.set(track.id, changes);
      if (hasAnyTag(tags)) result.read += 1;
      else result.withoutTags += 1;
    } catch (err) {
      // A stop cut this song off, so it counts as neither read nor failed.
      if (result.stopped) return;
      if (err instanceof DriveApiError && err.isAuthError) {
        stop(SESSION_ENDED);
        return;
      }
      if (err instanceof DriveApiError && err.isRateLimit) {
        stop(RATE_LIMITED);
        return;
      }
      result.failed += 1;
    }
    done += 1;
    if (done % TAG_READ_BATCH_SIZE === 0) flush();
    onProgress?.({ done, total: tracks.length, bytes: result.bytes });
  };

  let next = 0;
  const worker = async (): Promise<void> => {
    while (!result.stopped && next < tracks.length) {
      const track = tracks[next];
      next += 1;
      await readOne(track);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tracks.length) }, worker));
  flush();

  return result;
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}

function downloadSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** The line shown while a run is under way. */
export function describeTagReadProgress(progress: TagReadProgress): string {
  return `Reading tags: ${count(progress.done)} of ${count(progress.total)} songs`;
}

/** The line shown when a run ends, whether it finished or stopped early. */
export function describeTagReadResult(result: TagReadResult): string {
  const sentences: string[] = [];
  if (result.stopped?.reason === 'stopped') {
    const done = result.read + result.withoutTags + result.failed;
    sentences.push(`Stopped after ${count(done)} of ${count(result.total)} songs.`);
  }
  const downloaded = result.bytes > 0 ? `${downloadSize(result.bytes)} downloaded` : 'nothing downloaded';
  sentences.push(`Read tags for ${count(result.read)} song${result.read === 1 ? '' : 's'} (${downloaded}).`);
  if (result.withoutTags > 0) sentences.push(`${count(result.withoutTags)} had no tags.`);
  if (result.failed > 0) sentences.push(`${count(result.failed)} failed.`);
  if (result.stopped && result.stopped.reason !== 'stopped') sentences.push(result.stopped.message);
  return sentences.join(' ');
}
