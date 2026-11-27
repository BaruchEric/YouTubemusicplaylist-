/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import {
  describeUnplayable,
  hasAudioOnDevice,
  needsFolderRead,
  readTrackAudio,
  type AudioSources,
  type FolderAsk,
} from '../src/utils/deviceAudio';
import { makeTrack } from './factories';

const none: ReadonlySet<string> = new Set();

describe('hasAudioOnDevice', () => {
  test('counts a file held in memory', () => {
    const memory = new Map([['a::1', new Blob(['x'])]]);

    expect(hasAudioOnDevice('a::1', { memory, storedKeys: none, folderKeys: none })).toBe(true);
  });

  test('counts a copy in the browser storage', () => {
    const audio = { memory: new Map(), storedKeys: new Set(['a::1']), folderKeys: none };

    expect(hasAudioOnDevice('a::1', audio)).toBe(true);
  });

  test('counts a song the scan saw in the folder, with no copy anywhere else', () => {
    const audio = { memory: new Map(), storedKeys: none, folderKeys: new Set(['a::1']) };

    expect(hasAudioOnDevice('a::1', audio)).toBe(true);
  });

  test('counts a Drive song a scan linked to a file in the folder', () => {
    const audio = { memory: new Map(), storedKeys: none, folderKeys: new Set(['gdrive::d1']) };

    expect(hasAudioOnDevice('gdrive::d1', audio)).toBe(true);
  });

  test('does not count a song held nowhere on the device', () => {
    const audio = {
      memory: new Map([['b::1', new Blob(['x'])]]),
      storedKeys: new Set(['c::1']),
      folderKeys: new Set(['d::1']),
    };

    expect(hasAudioOnDevice('gdrive::cloud-only', audio)).toBe(false);
  });
});

describe('needsFolderRead', () => {
  const inFolder = { fileKey: 'music/a.mp3::1000' };
  const added = { fileKey: 'added.mp3::700' };

  test('is true when a song is in the folder and nowhere else on the device', () => {
    const audio = { memory: new Map(), storedKeys: none, folderKeys: new Set([inFolder.fileKey]) };

    expect(needsFolderRead([added, inFolder], audio)).toBe(true);
  });

  test('is false when memory already holds the folder song', () => {
    const audio = {
      memory: new Map([[inFolder.fileKey, new Blob(['x'])]]),
      storedKeys: none,
      folderKeys: new Set([inFolder.fileKey]),
    };

    expect(needsFolderRead([inFolder], audio)).toBe(false);
  });

  test('is false when the browser storage holds a copy of the folder song', () => {
    const audio = {
      memory: new Map(),
      storedKeys: new Set([inFolder.fileKey]),
      folderKeys: new Set([inFolder.fileKey]),
    };

    expect(needsFolderRead([inFolder], audio)).toBe(false);
  });

  test('is false when none of the songs is in the folder', () => {
    const audio = { memory: new Map(), storedKeys: none, folderKeys: new Set([inFolder.fileKey]) };

    expect(needsFolderRead([added], audio)).toBe(false);
    expect(needsFolderRead([], audio)).toBe(false);
  });
});

describe('readTrackAudio', () => {
  const track = makeTrack({ id: 'a', fileKey: 'music/a.mp3::1000', relativePath: 'Music/a.mp3' });
  const inMemory = new Blob(['memory']);
  const stored = new Blob(['stored']);
  const inFolder = new Blob(['folder']);

  type Holder = 'memory' | 'stored' | 'folder';

  /** The three places a song's audio can be, with the song held in the ones named. */
  function sources(...holders: Holder[]) {
    const calls: string[] = [];
    const asks: FolderAsk[] = [];
    const made: AudioSources = {
      memory: new Map(holders.includes('memory') ? [[track.fileKey, inMemory]] : []),
      loadStored: async (fileKey) => {
        calls.push(`stored:${fileKey}`);
        return holders.includes('stored') ? stored : null;
      },
      readFromFolder: async (song, ask) => {
        calls.push(`folder:${song.relativePath}`);
        asks.push(ask);
        return holders.includes('folder') ? inFolder : null;
      },
    };
    return { made, calls, asks };
  }

  test('takes the file in memory and looks no further', async () => {
    const { made, calls } = sources('memory', 'stored', 'folder');

    expect(await readTrackAudio(track, made)).toBe(inMemory);
    expect(calls).toEqual([]);
  });

  test('takes the stored copy before the folder', async () => {
    const { made, calls } = sources('stored', 'folder');

    expect(await readTrackAudio(track, made)).toBe(stored);
    expect(calls).toEqual(['stored:music/a.mp3::1000']);
  });

  test('reads the folder when there is no copy in memory or in storage', async () => {
    const { made, calls } = sources('folder');

    expect(await readTrackAudio(track, made)).toBe(inFolder);
    expect(calls).toEqual(['stored:music/a.mp3::1000', 'folder:Music/a.mp3']);
  });

  test('keeps what it read in memory for the next read', async () => {
    const { made, calls } = sources('folder');

    await readTrackAudio(track, made);
    await readTrackAudio(track, made);

    expect(made.memory.get(track.fileKey)).toBe(inFolder);
    expect(calls).toHaveLength(2);
  });

  test('finds nothing when the device has no audio for the song', async () => {
    const { made } = sources();

    expect(await readTrackAudio(track, made)).toBeNull();
    expect(made.memory.has(track.fileKey)).toBe(false);
  });

  test('tells the folder whether the read may ask for access, and does not ask unless told', async () => {
    const { made, asks } = sources();

    await readTrackAudio(track, made);
    await readTrackAudio(track, made, 'never-ask');
    await readTrackAudio(track, made, 'may-ask');

    expect(asks).toEqual(['never-ask', 'never-ask', 'may-ask']);
  });
});

describe('describeUnplayable', () => {
  test('asks for the folder when the song is in the picked folder and could not be read', () => {
    const notice = describeUnplayable({ inPickedFolder: true });

    expect(notice.message).toBe(
      'Folder access needed. Press Play again and allow it, or re-scan if the file moved.'
    );
    expect(notice.offerRelink).toBe(false);
  });

  test('offers to re-link a song this device holds no audio for', () => {
    const notice = describeUnplayable({ inPickedFolder: false });

    expect(notice.message).toBe(
      'Audio file not cached yet. Re-select your local file or folder to play.'
    );
    expect(notice.offerRelink).toBe(true);
  });
});
