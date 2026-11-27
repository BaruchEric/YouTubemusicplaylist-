/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import {
  TAG_READ_BATCH_SIZE,
  countTracksNeedingTagRead,
  describeTagReadProgress,
  describeTagReadResult,
  needsTagRead,
  readDriveTrackTags,
  readTagsFromScannedFile,
  type TagReadProgress,
  type TagReadResult,
  type TagReadUpdates,
} from '../src/utils/driveTagReader';
import { DriveApiError, buildTrackStubFromDriveAudio } from '../src/utils/googleDriveApi';
import type { LocalTrack } from '../src/types/music';
import { MPEG1_128, concat, id3Text, id3v2Tag, mpegFrames, xingFrame, type Bytes } from './audioFixtures';
import { makeTrack } from './factories';

const XING_FRAMES = 9571;
const XING_SECONDS = Math.round(((XING_FRAMES * 1152) / 44100) * 1000) / 1000;

/** A small tagged MP3: one read of its head gives the title, the artist and the duration. */
function taggedMp3(title: string): Bytes {
  return concat(
    id3v2Tag([id3Text('TIT2', title), id3Text('TPE1', 'Owl City')]),
    xingFrame(MPEG1_128, XING_FRAMES),
    mpegFrames(MPEG1_128, 3)
  );
}

/** An MP3 with audio frames and no tag of any kind. */
function untaggedMp3(): Bytes {
  return mpegFrames(MPEG1_128, 20);
}

interface FakeDrive {
  songs: LocalTrack[];
  readRange: (fileId: string, start: number, end: number) => Promise<ArrayBuffer>;
  /** File ids in the order they were asked for. */
  asked: string[];
  /** Makes the next reads of a file fail, one error for each read. */
  failNext: (fileId: string, ...errors: unknown[]) => void;
  replace: (fileId: string, bytes: Bytes) => void;
}

/** A library of `count` Drive songs that nothing has read yet, and a Drive that serves them. */
function fakeDrive(count: number): FakeDrive {
  const files = new Map<string, Bytes>();
  const failures = new Map<string, unknown[]>();
  const asked: string[] = [];
  const songs: LocalTrack[] = [];
  for (let i = 1; i <= count; i++) {
    const id = `f${i}`;
    const bytes = taggedMp3(`Song ${i}`);
    files.set(id, bytes);
    songs.push({
      ...buildTrackStubFromDriveAudio({
        id,
        name: `${String(i).padStart(2, '0')} Track.mp3`,
        mimeType: 'audio/mpeg',
        size: bytes.length,
        modifiedTime: '2026-11-20T10:00:00Z',
        folderPath: 'Google Drive/Music/Owl City/Ocean Eyes',
      }),
      id: `t${i}`,
    });
  }
  return {
    songs,
    asked,
    failNext: (fileId, ...errors) => failures.set(fileId, errors),
    replace: (fileId, bytes) => {
      files.set(fileId, bytes);
      const song = songs.find((s) => s.driveFileId === fileId);
      if (song) song.fileSize = bytes.length;
    },
    readRange: async (fileId, start, end) => {
      asked.push(fileId);
      const failure = failures.get(fileId)?.shift();
      if (failure !== undefined) throw failure;
      const bytes = files.get(fileId);
      if (!bytes) throw new DriveApiError('File not found', 404, 'notFound');
      return bytes.slice(start, Math.min(end, bytes.length)).buffer;
    },
  };
}

/** A wait that records how long it was asked to wait and returns at once. */
function recordedWait(): { wait: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    wait: async (ms) => {
      waits.push(ms);
    },
  };
}

function collect(): { onBatch: (updates: TagReadUpdates) => void; batches: TagReadUpdates[]; all: Map<string, Partial<LocalTrack>> } {
  const batches: TagReadUpdates[] = [];
  const all = new Map<string, Partial<LocalTrack>>();
  return {
    batches,
    all,
    onBatch: (updates) => {
      batches.push(updates);
      for (const [id, changes] of updates) all.set(id, changes);
    },
  };
}

describe('needsTagRead', () => {
  const driveStub = makeTrack({ id: 'a', driveFileId: 'f1', duration: 0 });

  test('is true for a Drive song whose duration nobody has read', () => {
    expect(needsTagRead(driveStub)).toBe(true);
  });

  test('is false once the duration is known, for a song with no Drive file, and for a list entry', () => {
    expect(needsTagRead({ ...driveStub, duration: 181 })).toBe(false);
    expect(needsTagRead({ ...driveStub, driveFileId: null })).toBe(false);
    expect(needsTagRead(makeTrack({ id: 'b', duration: 0 }))).toBe(false);
    expect(needsTagRead({ ...driveStub, format: 'YT' })).toBe(false);
    expect(needsTagRead({ ...driveStub, format: 'list' })).toBe(false);
  });

  test('countTracksNeedingTagRead counts them', () => {
    expect(
      countTracksNeedingTagRead([
        driveStub,
        { ...driveStub, id: 'c', duration: 200 },
        { ...driveStub, id: 'd', format: 'LIST' },
        { ...driveStub, id: 'e' },
      ])
    ).toBe(2);
  });
});

describe('readDriveTrackTags', () => {
  test('reads every song and hands back the fields that change', async () => {
    const drive = fakeDrive(3);
    const { onBatch, all } = collect();

    const result = await readDriveTrackTags({ tracks: drive.songs, readRange: drive.readRange, onBatch });

    expect(result).toEqual({
      total: 3,
      read: 3,
      withoutTags: 0,
      failed: 0,
      bytes: drive.songs.reduce((sum, song) => sum + song.fileSize, 0),
      stopped: null,
    });
    expect(all.size).toBe(3);
    expect(all.get('t2')).toEqual({ title: 'Song 2', duration: XING_SECONDS });
    expect(drive.asked.sort()).toEqual(['f1', 'f2', 'f3']);
  });

  test('counts a file with no tags apart, and still takes its duration', async () => {
    const drive = fakeDrive(2);
    drive.replace('f2', untaggedMp3());
    const { onBatch, all } = collect();

    const result = await readDriveTrackTags({ tracks: drive.songs, readRange: drive.readRange, onBatch });

    expect(result.read).toBe(1);
    expect(result.withoutTags).toBe(1);
    expect(result.failed).toBe(0);
    expect(Object.keys(all.get('t2') ?? {})).toEqual(['duration']);
  });

  test('never has more than 4 songs in flight unless told otherwise', async () => {
    const drive = fakeDrive(20);
    let inFlight = 0;
    let most = 0;
    const slowRead = async (fileId: string, start: number, end: number) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return drive.readRange(fileId, start, end);
    };

    await readDriveTrackTags({ tracks: drive.songs, readRange: slowRead });
    expect(most).toBe(4);

    most = 0;
    await readDriveTrackTags({ tracks: drive.songs, readRange: slowRead, concurrency: 2 });
    expect(most).toBe(2);
  });

  test('hands over changes every 25 songs and once more at the end', async () => {
    const drive = fakeDrive(60);
    const { onBatch, batches, all } = collect();

    await readDriveTrackTags({ tracks: drive.songs, readRange: drive.readRange, onBatch });

    expect(TAG_READ_BATCH_SIZE).toBe(25);
    expect(batches.map((batch) => batch.size)).toEqual([25, 25, 10]);
    expect(all.size).toBe(60);
  });

  test('reports progress after each song', async () => {
    const drive = fakeDrive(5);
    const seen: TagReadProgress[] = [];

    const result = await readDriveTrackTags({
      tracks: drive.songs,
      readRange: drive.readRange,
      concurrency: 1,
      onProgress: (progress) => seen.push(progress),
    });

    expect(seen.map((p) => p.done)).toEqual([1, 2, 3, 4, 5]);
    expect(seen.every((p) => p.total === 5)).toBe(true);
    expect(seen[4].bytes).toBe(result.bytes);
    expect(seen[0].bytes).toBe(drive.songs[0].fileSize);
  });

  test('stops when the signal aborts, keeps what it read and asks Drive for nothing more', async () => {
    const drive = fakeDrive(40);
    const controller = new AbortController();
    const { onBatch, all } = collect();

    const result = await readDriveTrackTags({
      tracks: drive.songs,
      readRange: drive.readRange,
      concurrency: 1,
      signal: controller.signal,
      onBatch,
      onProgress: ({ done }) => {
        if (done === 7) controller.abort();
      },
    });

    expect(result.stopped?.reason).toBe('stopped');
    expect(result.read).toBe(7);
    expect(result.total).toBe(40);
    expect(all.size).toBe(7);
    expect(drive.asked).toHaveLength(7);
  });

  test('does not count a song that was cut off by Stop as failed', async () => {
    const drive = fakeDrive(8);
    const controller = new AbortController();
    const abortingRead = async (fileId: string, start: number, end: number) => {
      if (fileId === 'f3') {
        controller.abort();
        throw new DOMException('Aborted', 'AbortError');
      }
      return drive.readRange(fileId, start, end);
    };

    const result = await readDriveTrackTags({
      tracks: drive.songs,
      readRange: abortingRead,
      concurrency: 1,
      signal: controller.signal,
    });

    expect(result.stopped?.reason).toBe('stopped');
    expect(result.read).toBe(2);
    expect(result.failed).toBe(0);
  });

  test('reads nothing when the signal is already aborted', async () => {
    const drive = fakeDrive(3);
    const controller = new AbortController();
    controller.abort();

    const result = await readDriveTrackTags({
      tracks: drive.songs,
      readRange: drive.readRange,
      signal: controller.signal,
    });

    expect(result.stopped?.reason).toBe('stopped');
    expect(drive.asked).toHaveLength(0);
  });

  test('stops on a 401 and says the Drive session ended', async () => {
    const drive = fakeDrive(10);
    drive.failNext('f4', new DriveApiError('Invalid Credentials', 401, 'authError'));
    const { onBatch, all } = collect();

    const result = await readDriveTrackTags({
      tracks: drive.songs,
      readRange: drive.readRange,
      concurrency: 1,
      onBatch,
    });

    expect(result.stopped?.reason).toBe('session-ended');
    expect(result.stopped?.message).toContain('session ended');
    expect(result.read).toBe(3);
    expect(result.failed).toBe(0);
    expect(all.size).toBe(3);
    expect(drive.asked).toEqual(['f1', 'f2', 'f3', 'f4']);
  });

  test('counts a 404 as failed and goes on', async () => {
    const drive = fakeDrive(5);
    drive.failNext('f2', new DriveApiError('File not found', 404, 'notFound'));

    const result = await readDriveTrackTags({ tracks: drive.songs, readRange: drive.readRange, concurrency: 1 });

    expect(result.stopped).toBeNull();
    expect(result.read).toBe(4);
    expect(result.failed).toBe(1);
  });

  test('waits and retries a 429, and a 403 that is a rate limit', async () => {
    const drive = fakeDrive(3);
    drive.failNext('f1', new DriveApiError('Too many', 429), new DriveApiError('Too many', 429));
    drive.failNext('f3', new DriveApiError('Slow down', 403, 'userRateLimitExceeded'));
    const { wait, waits } = recordedWait();

    const result = await readDriveTrackTags({
      tracks: drive.songs,
      readRange: drive.readRange,
      concurrency: 1,
      wait,
    });

    expect(result.read).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.stopped).toBeNull();
    expect(waits).toEqual([1000, 2000, 1000]);
    expect(drive.asked).toEqual(['f1', 'f1', 'f1', 'f2', 'f3', 'f3']);
  });

  test('gives up after 3 retries of a rate limit and stops the run', async () => {
    const drive = fakeDrive(6);
    const limit = () => new DriveApiError('Too many', 429);
    drive.failNext('f2', limit(), limit(), limit(), limit());
    const { wait, waits } = recordedWait();

    const result = await readDriveTrackTags({
      tracks: drive.songs,
      readRange: drive.readRange,
      concurrency: 1,
      wait,
    });

    expect(waits).toEqual([1000, 2000, 4000]);
    expect(result.stopped?.reason).toBe('rate-limited');
    expect(result.read).toBe(1);
    expect(result.failed).toBe(0);
    expect(drive.asked).toEqual(['f1', 'f2', 'f2', 'f2', 'f2']);
  });

  test('does not retry a 403 that is not a rate limit', async () => {
    const drive = fakeDrive(2);
    drive.failNext('f1', new DriveApiError('No download', 403, 'cannotDownloadFile'));
    const { wait, waits } = recordedWait();

    const result = await readDriveTrackTags({ tracks: drive.songs, readRange: drive.readRange, concurrency: 1, wait });

    expect(waits).toEqual([]);
    expect(result.failed).toBe(1);
    expect(result.read).toBe(1);
  });

  test('retries a network error once', async () => {
    const drive = fakeDrive(3);
    drive.failNext('f1', new TypeError('Failed to fetch'));
    drive.failNext('f2', new TypeError('Failed to fetch'), new TypeError('Failed to fetch'));
    const { wait } = recordedWait();

    const result = await readDriveTrackTags({ tracks: drive.songs, readRange: drive.readRange, concurrency: 1, wait });

    expect(result.read).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.stopped).toBeNull();
    expect(drive.asked).toEqual(['f1', 'f1', 'f2', 'f2', 'f3']);
  });

  test('parses a song this browser already holds without asking Drive', async () => {
    const drive = fakeDrive(3);
    const { onBatch, all } = collect();

    const result = await readDriveTrackTags({
      tracks: drive.songs,
      readRange: drive.readRange,
      localBlob: async (track) => (track.id === 't2' ? new Blob([taggedMp3('From The Cache')]) : null),
      onBatch,
    });

    expect(result.read).toBe(3);
    expect(drive.asked.sort()).toEqual(['f1', 'f3']);
    expect(result.bytes).toBe(drive.songs[0].fileSize + drive.songs[2].fileSize);
    expect(all.get('t2')?.title).toBe('From The Cache');
  });

  test('asks Drive when the local copy cannot be loaded', async () => {
    const drive = fakeDrive(1);

    const result = await readDriveTrackTags({
      tracks: drive.songs,
      readRange: drive.readRange,
      localBlob: async () => {
        throw new Error('IndexedDB is closed');
      },
    });

    expect(result.read).toBe(1);
    expect(drive.asked).toEqual(['f1']);
  });

  test('keeps a title the user typed', async () => {
    const drive = fakeDrive(1);
    const edited = { ...drive.songs[0], title: 'My Name For It' };
    const { onBatch, all } = collect();

    await readDriveTrackTags({ tracks: [edited], readRange: drive.readRange, onBatch });

    expect(all.get('t1')).toEqual({ duration: XING_SECONDS });
  });

  test('does nothing for an empty list', async () => {
    const { onBatch, batches } = collect();
    const result = await readDriveTrackTags({ tracks: [], readRange: async () => new ArrayBuffer(0), onBatch });

    expect(result).toEqual({ total: 0, read: 0, withoutTags: 0, failed: 0, bytes: 0, stopped: null });
    expect(batches).toHaveLength(0);
  });
});

describe('describeTagReadProgress', () => {
  test('says how far the run is', () => {
    expect(describeTagReadProgress({ done: 120, total: 2568, bytes: 0 })).toBe(
      'Reading tags: 120 of 2,568 songs'
    );
  });
});

describe('describeTagReadResult', () => {
  const done: TagReadResult = {
    total: 2568,
    read: 2560,
    withoutTags: 6,
    failed: 2,
    bytes: 412 * 1024 * 1024,
    stopped: null,
  };

  test('sums up a finished run', () => {
    expect(describeTagReadResult(done)).toBe(
      'Read tags for 2,560 songs (412 MB downloaded). 6 had no tags. 2 failed.'
    );
  });

  test('leaves out the counts that are zero', () => {
    expect(describeTagReadResult({ ...done, total: 1, read: 1, withoutTags: 0, failed: 0, bytes: 130_000 })).toBe(
      'Read tags for 1 song (127 KB downloaded).'
    );
  });

  test('says so when nothing was downloaded', () => {
    expect(describeTagReadResult({ ...done, total: 3, read: 3, withoutTags: 0, failed: 0, bytes: 0 })).toBe(
      'Read tags for 3 songs (nothing downloaded).'
    );
  });

  test('says where a stopped run got to', () => {
    expect(
      describeTagReadResult({
        ...done,
        read: 118,
        withoutTags: 2,
        failed: 0,
        bytes: 20 * 1024 * 1024,
        stopped: { reason: 'stopped', message: 'The run stopped before it read every song.' },
      })
    ).toBe('Stopped after 120 of 2,568 songs. Read tags for 118 songs (20 MB downloaded). 2 had no tags.');
  });

  test('ends with the reason when Drive stopped the run', () => {
    const text = describeTagReadResult({
      ...done,
      read: 40,
      withoutTags: 0,
      failed: 0,
      bytes: 3 * 1024 * 1024 * 1024,
      stopped: { reason: 'session-ended', message: 'The Google Drive session ended. Sign in again to read the rest.' },
    });

    expect(text).toBe(
      'Read tags for 40 songs (3.00 GB downloaded). The Google Drive session ended. Sign in again to read the rest.'
    );
  });
});

describe('readTagsFromScannedFile', () => {
  test('fills in a Drive song nothing has read from the local file a scan found', async () => {
    const [song] = fakeDrive(1).songs;

    const changes = await readTagsFromScannedFile(song, new Blob([taggedMp3('Fireflies')]));

    // The folder already gave the artist, so only what the file adds comes back.
    expect(changes).toEqual({ title: 'Fireflies', duration: XING_SECONDS });
  });

  test('keeps a title the user typed and still takes the duration', async () => {
    const [stub] = fakeDrive(1).songs;
    const song = { ...stub, title: 'My Own Name' };

    const changes = await readTagsFromScannedFile(song, new Blob([taggedMp3('Fireflies')]));

    expect(changes.title).toBeUndefined();
    expect(changes.duration).toBe(XING_SECONDS);
  });

  test('does not read the file of a song that has been read before', async () => {
    const [stub] = fakeDrive(1).songs;
    const song = { ...stub, duration: 200 };
    const file = new Blob([taggedMp3('Fireflies')]);
    let reads = 0;
    const counted = new Proxy(file, {
      get(target, key) {
        if (key === 'slice' || key === 'arrayBuffer') reads += 1;
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    expect(await readTagsFromScannedFile(song, counted)).toEqual({});
    expect(reads).toBe(0);
  });

  test('leaves a song that was never on Drive alone', async () => {
    const local = makeTrack({ id: 'local', duration: 0 });

    expect(await readTagsFromScannedFile(local, new Blob([taggedMp3('Fireflies')]))).toEqual({});
  });
});
