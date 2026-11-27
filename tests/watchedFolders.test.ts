/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { FolderDirectory } from '../src/utils/folderAudio';
import { resolveWatcherStatus, type FolderPermission } from '../src/utils/folderWatch';
import {
  addFolder,
  askForFoldersInTurn,
  describeFolderRemoval,
  describeFolders,
  describeRescan,
  fileKeysOfOtherFolders,
  findSameFolder,
  foldersFromLegacyRecord,
  foldersHoldingKey,
  foldersToReadFor,
  hasReadableFolder,
  isMissingAfterScan,
  keysOnlyInFolder,
  listFolderRows,
  parseStoredFolders,
  readTrackFromFolders,
  removeFolder,
  summarizeFolderPermission,
  toStoredFolders,
  unionFileKeys,
  withFolderFileKeys,
  withFolderHandle,
  type WatchedFolder,
} from '../src/utils/watchedFolders';
import { makeTrack } from './factories';

/**
 * A folder handle as the list sees it. Two handles are the same folder when they name the
 * same place on disk, whatever the folder is called. Chrome's isSameEntry answers the same way.
 */
class FakeHandle {
  readonly kind = 'directory';
  compared = 0;

  constructor(
    readonly name: string,
    readonly place: string,
    private readonly comparable = true
  ) {}

  async isSameEntry(other: FakeHandle): Promise<boolean> {
    this.compared += 1;
    if (!this.comparable) throw new DOMException('The folder is gone', 'NotFoundError');
    return other.place === this.place;
  }
}

type Folder = WatchedFolder<FakeHandle>;

function folder(id: string, handle: FakeHandle, keys: string[] = []): Folder {
  return { id, handle, fileKeys: new Set(keys) };
}

const homeMusic = new FakeHandle('Music', '/Users/eric/Music');
const diskMusic = new FakeHandle('Music', '/Volumes/Disk/Music');
const podcasts = new FakeHandle('Podcasts', '/Users/eric/Podcasts');

describe('addFolder', () => {
  test('puts a picked folder at the end of the list, with no songs yet', () => {
    const before = [folder('a', homeMusic, ['music/a.mp3::1000'])];

    const after = addFolder(before, { id: 'b', handle: podcasts });

    expect(after.map((item) => item.id)).toEqual(['a', 'b']);
    expect(after[1]?.handle).toBe(podcasts);
    expect([...(after[1]?.fileKeys ?? ['unset'])]).toEqual([]);
  });

  test('keeps every folder that was in the list, with its songs', () => {
    const first = folder('a', homeMusic, ['music/a.mp3::1000']);

    const after = addFolder([first], { id: 'b', handle: diskMusic });

    expect(after[0]).toBe(first);
    expect([...first.fileKeys]).toEqual(['music/a.mp3::1000']);
  });
});

describe('findSameFolder', () => {
  test('finds a folder picked a second time', async () => {
    const list = [folder('a', homeMusic), folder('b', podcasts)];
    const pickedAgain = new FakeHandle('Podcasts', '/Users/eric/Podcasts');

    expect((await findSameFolder(list, pickedAgain))?.id).toBe('b');
  });

  test('tells two folders with the same name apart', async () => {
    const list = [folder('a', homeMusic)];

    expect(await findSameFolder(list, diskMusic)).toBeNull();
  });

  test('finds the right one of two folders with the same name', async () => {
    const list = [folder('a', homeMusic), folder('b', diskMusic)];
    const pickedAgain = new FakeHandle('Music', '/Volumes/Disk/Music');

    expect((await findSameFolder(list, pickedAgain))?.id).toBe('b');
  });

  test('counts a folder the browser can no longer compare as another folder', async () => {
    const gone = new FakeHandle('Music', '/Users/eric/Music', false);
    const list = [folder('gone', gone), folder('b', podcasts)];

    expect(await findSameFolder(list, homeMusic)).toBeNull();
    expect((await findSameFolder(list, podcasts))?.id).toBe('b');
  });

  test('finds nothing in an empty list', async () => {
    expect(await findSameFolder([], homeMusic)).toBeNull();
  });
});

describe('removeFolder', () => {
  test('drops the one folder and keeps the others in order', () => {
    const list = [folder('a', homeMusic), folder('b', diskMusic), folder('c', podcasts)];

    expect(removeFolder(list, 'b').map((item) => item.id)).toEqual(['a', 'c']);
  });

  test('removes one of two folders with the same name by its id', () => {
    const list = [folder('a', homeMusic, ['one']), folder('b', diskMusic, ['two'])];

    const after = removeFolder(list, 'a');

    expect(after.map((item) => item.handle)).toEqual([diskMusic]);
    expect([...unionFileKeys(after)]).toEqual(['two']);
  });

  test('leaves the list alone for an id it does not hold', () => {
    const list = [folder('a', homeMusic)];

    expect(removeFolder(list, 'nobody')).toEqual(list);
  });
});

describe('withFolderFileKeys', () => {
  test('gives one folder the songs its scan saw and leaves the others their own', () => {
    const list = [folder('a', homeMusic, ['old']), folder('b', diskMusic, ['kept'])];

    const after = withFolderFileKeys(list, 'a', new Set(['new-1', 'new-2']));

    expect([...(after[0]?.fileKeys ?? [])]).toEqual(['new-1', 'new-2']);
    expect(after[1]).toBe(list[1]);
  });

  test('changes nothing when the folder left the list during the scan', () => {
    const list = [folder('a', homeMusic, ['old'])];

    const after = withFolderFileKeys(list, 'removed', new Set(['new']));

    expect(after).toEqual(list);
    expect(after.some((item) => item.id === 'removed')).toBe(false);
  });
});

describe('withFolderHandle', () => {
  test('swaps in the handle from a new pick and keeps the id and the songs', () => {
    const list = [folder('a', homeMusic, ['music/a.mp3::1000'])];
    const pickedAgain = new FakeHandle('Music', '/Users/eric/Music');

    const after = withFolderHandle(list, 'a', pickedAgain);

    expect(after[0]?.id).toBe('a');
    expect(after[0]?.handle).toBe(pickedAgain);
    expect([...(after[0]?.fileKeys ?? [])]).toEqual(['music/a.mp3::1000']);
  });
});

describe('unionFileKeys', () => {
  test('holds every song of every folder once', () => {
    const list = [
      folder('a', homeMusic, ['shared', 'only-a']),
      folder('b', diskMusic, ['shared', 'only-b']),
    ];

    expect([...unionFileKeys(list)].sort()).toEqual(['only-a', 'only-b', 'shared']);
  });

  test('is empty with no folders', () => {
    expect(unionFileKeys([]).size).toBe(0);
  });
});

describe('fileKeysOfOtherFolders', () => {
  const list = [
    folder('a', homeMusic, ['shared', 'only-a']),
    folder('b', diskMusic, ['shared', 'only-b']),
    folder('c', podcasts, ['only-c']),
  ];

  test('holds the songs of every folder but the one named', () => {
    expect([...fileKeysOfOtherFolders(list, 'a')].sort()).toEqual(['only-b', 'only-c', 'shared']);
  });

  test('holds every folder for a scan that came from no folder of the list', () => {
    expect(fileKeysOfOtherFolders(list, null)).toEqual(unionFileKeys(list));
  });
});

describe('foldersHoldingKey', () => {
  test('gives the folders whose scan saw the song, in list order', () => {
    const list = [
      folder('a', homeMusic, ['shared']),
      folder('b', podcasts, ['talk']),
      folder('c', diskMusic, ['shared']),
    ];

    expect(foldersHoldingKey(list, 'shared').map((item) => item.id)).toEqual(['a', 'c']);
  });

  test('leaves out a folder with the right name whose scan did not see the song', () => {
    const list = [folder('a', homeMusic, ['music/a.mp3::1000']), folder('b', diskMusic, [])];

    expect(foldersHoldingKey(list, 'music/a.mp3::1000').map((item) => item.id)).toEqual(['a']);
  });

  test('gives none for a song no folder holds', () => {
    expect(foldersHoldingKey([folder('a', homeMusic, ['x'])], 'y')).toEqual([]);
  });
});

describe('keysOnlyInFolder', () => {
  test('names the songs that no other folder holds', () => {
    const list = [
      folder('a', homeMusic, ['shared', 'only-a']),
      folder('b', diskMusic, ['shared', 'only-b']),
    ];

    expect([...keysOnlyInFolder(list, 'a')]).toEqual(['only-a']);
  });

  test('names nothing for a folder the list does not hold', () => {
    expect(keysOnlyInFolder([folder('a', homeMusic, ['x'])], 'nobody').size).toBe(0);
  });
});

describe('isMissingAfterScan', () => {
  const inMusic = makeTrack({ id: 'a' });
  const none: ReadonlySet<string> = new Set();

  test('marks a song of the scanned folder that the scan did not see', () => {
    const scan = { folderName: 'Music', seenKeys: none, otherFolderKeys: none };

    expect(isMissingAfterScan(inMusic, scan)).toBe(true);
  });

  test('leaves a song the scan saw', () => {
    const scan = { folderName: 'Music', seenKeys: new Set([inMusic.fileKey]), otherFolderKeys: none };

    expect(isMissingAfterScan(inMusic, scan)).toBe(false);
  });

  test('leaves a song of a folder with another name', () => {
    const scan = { folderName: 'Podcasts', seenKeys: none, otherFolderKeys: none };

    expect(isMissingAfterScan(inMusic, scan)).toBe(false);
  });

  // Two folders named Music: a scan of the second must not take the songs of the first away.
  test('leaves a song another folder with the same name holds', () => {
    const list = [
      folder('home', homeMusic, [inMusic.fileKey]),
      folder('disk', diskMusic, ['music/b.mp3::1000']),
    ];
    const scanOfDisk = {
      folderName: diskMusic.name,
      seenKeys: new Set(['music/b.mp3::1000']),
      otherFolderKeys: fileKeysOfOtherFolders(list, 'disk'),
    };

    expect(isMissingAfterScan(inMusic, scanOfDisk)).toBe(false);
  });

  test('marks a song gone from its own folder when no other folder holds it', () => {
    const list = [
      folder('home', homeMusic, [inMusic.fileKey]),
      folder('disk', diskMusic, ['music/b.mp3::1000']),
    ];
    const scanOfHome = {
      folderName: homeMusic.name,
      seenKeys: none,
      otherFolderKeys: fileKeysOfOtherFolders(list, 'home'),
    };

    expect(isMissingAfterScan(inMusic, scanOfHome)).toBe(true);
  });

  test('leaves a song gone from one folder while a second folder still holds the same file', () => {
    const list = [
      folder('home', homeMusic, [inMusic.fileKey]),
      folder('disk', diskMusic, [inMusic.fileKey]),
    ];
    const scanOfHome = {
      folderName: homeMusic.name,
      seenKeys: none,
      otherFolderKeys: fileKeysOfOtherFolders(list, 'home'),
    };

    expect(isMissingAfterScan(inMusic, scanOfHome)).toBe(false);
  });

  test('puts a song in the folder by its path when its folder name says something else', () => {
    const relinked = makeTrack({ id: 'd', folderName: 'Google Drive', relativePath: 'music/Album/d.mp3' });
    const scan = { folderName: 'Music', seenKeys: none, otherFolderKeys: none };

    expect(isMissingAfterScan(relinked, scan)).toBe(true);
  });

  test('does not take a folder whose name only starts the same way', () => {
    const other = makeTrack({ id: 'e', folderName: 'Music Videos', relativePath: 'Music Videos/e.mp3' });
    const scan = { folderName: 'Music', seenKeys: none, otherFolderKeys: none };

    expect(isMissingAfterScan(other, scan)).toBe(false);
  });

  test('marks nothing for a scan with no folder name', () => {
    const scan = { folderName: '', seenKeys: none, otherFolderKeys: none };

    expect(isMissingAfterScan(inMusic, scan)).toBe(false);
  });
});

describe('foldersFromLegacyRecord', () => {
  test('builds one folder from the single handle and its keys', () => {
    const folders = foldersFromLegacyRecord(
      { handle: homeMusic, fileKeys: ['music/a.mp3::1000', 'gdrive::d1'] },
      'new-id'
    );

    expect(folders).toHaveLength(1);
    expect(folders[0]?.id).toBe('new-id');
    expect(Object.is(folders[0]?.handle, homeMusic)).toBe(true);
    expect([...(folders[0]?.fileKeys ?? [])]).toEqual(['music/a.mp3::1000', 'gdrive::d1']);
  });

  test('builds a folder with no songs when the old record had a handle and no keys', () => {
    const folders = foldersFromLegacyRecord({ handle: homeMusic, fileKeys: undefined }, 'new-id');

    expect(folders).toHaveLength(1);
    expect(folders[0]?.fileKeys.size).toBe(0);
  });

  test('builds nothing when there was no handle, since keys alone can read no file', () => {
    expect(foldersFromLegacyRecord({ handle: undefined, fileKeys: ['a'] }, 'new-id')).toEqual([]);
    expect(foldersFromLegacyRecord({ handle: null, fileKeys: ['a'] }, 'new-id')).toEqual([]);
  });

  test('drops keys that are not text', () => {
    const folders = foldersFromLegacyRecord({ handle: homeMusic, fileKeys: ['a', 7, null] }, 'id');

    expect([...(folders[0]?.fileKeys ?? [])]).toEqual(['a']);
  });
});

describe('the saved list', () => {
  test('comes back as it was saved, in order, each folder with its own songs', () => {
    const list = [folder('a', homeMusic, ['one', 'two']), folder('b', diskMusic, ['three'])];

    const loaded = parseStoredFolders(toStoredFolders(list));

    expect(loaded.map((item) => item.id)).toEqual(['a', 'b']);
    expect(Object.is(loaded[0]?.handle, homeMusic)).toBe(true);
    expect(Object.is(loaded[1]?.handle, diskMusic)).toBe(true);
    expect([...(loaded[0]?.fileKeys ?? [])]).toEqual(['one', 'two']);
    expect([...(loaded[1]?.fileKeys ?? [])]).toEqual(['three']);
  });

  test('saves the keys as a plain list, which IndexedDB can store', () => {
    const [saved] = toStoredFolders([folder('a', homeMusic, ['one'])]);

    expect(saved).toEqual({ id: 'a', handle: homeMusic, fileKeys: ['one'] });
  });

  test('loads nothing from a record that is not a list', () => {
    expect(parseStoredFolders(undefined)).toEqual([]);
    expect(parseStoredFolders({ id: 'a' })).toEqual([]);
  });

  test('skips an entry with no id or no folder handle and keeps the rest', () => {
    const loaded = parseStoredFolders([
      { handle: homeMusic, fileKeys: [] },
      { id: 'no-handle', fileKeys: ['x'] },
      { id: 'a-file', handle: { kind: 'file', name: 'a.mp3' }, fileKeys: [] },
      { id: 'good', handle: diskMusic, fileKeys: ['kept', 3] },
    ]);

    expect(loaded.map((item) => item.id)).toEqual(['good']);
    expect([...(loaded[0]?.fileKeys ?? [])]).toEqual(['kept']);
  });
});

/** A picked folder with its songs right inside it. */
function songFolder(name: string, files: Record<string, File> = {}): FolderDirectory {
  const missing = async (): Promise<never> => {
    throw new DOMException('No such entry in the fake folder', 'NotFoundError');
  };
  return {
    name,
    getDirectoryHandle: missing,
    getFileHandle: async (fileName) => {
      const file = files[fileName];
      return file ? { getFile: async () => file } : missing();
    },
    async *entries() {
      for (const entry of Object.entries(files)) yield entry;
    },
  };
}

function audio(text: string): File {
  return new File([text], 'a.mp3', { type: 'audio/mpeg' });
}

describe('readTrackFromFolders', () => {
  const track = makeTrack({ id: 'a', fileKey: 'music/a.mp3::1000', relativePath: 'Music/a.mp3' });
  const fromHome = audio('home');
  const fromDisk = audio('disk');

  type SongFolder = WatchedFolder<FolderDirectory>;

  function picked(id: string, file: File | null, keys: string[]): SongFolder {
    return {
      id,
      handle: songFolder('Music', file ? { 'a.mp3': file } : {}),
      fileKeys: new Set(keys),
    };
  }

  /** The list and a record of which folder was asked, and whether the ask could prompt. */
  function source(folders: SongFolder[], refused: string[] = []) {
    const asked: Array<[string, boolean]> = [];
    return {
      asked,
      folders,
      ensurePermission: async (asking: SongFolder, mayPrompt: boolean): Promise<FolderPermission> => {
        asked.push([asking.id, mayPrompt]);
        return refused.includes(asking.id) ? 'needs-permission' : 'granted';
      },
    };
  }

  const fresh = () => true;
  const stale = () => false;

  test('reads the song from the folder whose scan saw it', async () => {
    const from = source([picked('home', fromHome, [track.fileKey])]);

    expect(await readTrackFromFolders(track, from, stale)).toBe(fromHome);
  });

  // Both folders are named Music and both have a file at Music/a.mp3. Only the second scan
  // saw this song, so the first folder's file is some other song.
  test('never reads a folder for its name alone', async () => {
    const from = source([picked('home', fromHome, []), picked('disk', fromDisk, [track.fileKey])]);

    expect(await readTrackFromFolders(track, from, fresh)).toBe(fromDisk);
    expect(from.asked).toEqual([['disk', true]]);
  });

  test('takes the first folder in list order when two hold the song', async () => {
    const from = source([
      picked('home', fromHome, [track.fileKey]),
      picked('disk', fromDisk, [track.fileKey]),
    ]);

    expect(await readTrackFromFolders(track, from, stale)).toBe(fromHome);
    expect(from.asked).toEqual([['home', false]]);
  });

  test('goes on to the next folder when the browser withholds the first', async () => {
    const from = source(
      [picked('home', fromHome, [track.fileKey]), picked('disk', fromDisk, [track.fileKey])],
      ['home']
    );

    expect(await readTrackFromFolders(track, from, stale)).toBe(fromDisk);
    expect(from.asked.map(([id]) => id)).toEqual(['home', 'disk']);
  });

  test('goes on to the next folder when the file is gone from the first', async () => {
    const from = source([
      picked('home', null, [track.fileKey]),
      picked('disk', fromDisk, [track.fileKey]),
    ]);

    expect(await readTrackFromFolders(track, from, stale)).toBe(fromDisk);
  });

  test('finds nothing when no folder can supply the song, so the next source gets its turn', async () => {
    const from = source(
      [picked('home', null, [track.fileKey]), picked('disk', fromDisk, [track.fileKey])],
      ['disk']
    );

    expect(await readTrackFromFolders(track, from, stale)).toBeNull();
  });

  test('asks for no folder when none holds the song', async () => {
    const from = source([picked('home', fromHome, ['music/other.mp3::5'])]);

    expect(await readTrackFromFolders(track, from, fresh)).toBeNull();
    expect(from.asked).toEqual([]);
  });

  test('looks at the click again before each folder, and stops prompting once it is stale', async () => {
    const from = source(
      [
        picked('home', fromHome, [track.fileKey]),
        picked('disk', fromDisk, [track.fileKey]),
        picked('spare', fromDisk, [track.fileKey]),
      ],
      ['home', 'disk', 'spare']
    );
    // The click is fresh for the first prompt. The user takes a while to answer it.
    const answers = [true, false, false];
    const clickIsFresh = () => answers.shift() ?? false;

    await readTrackFromFolders(track, from, clickIsFresh);

    expect(from.asked).toEqual([
      ['home', true],
      ['disk', false],
      ['spare', false],
    ]);
  });
});

describe('askForFoldersInTurn', () => {
  test('goes through the folders in order and sorts them by the answer', async () => {
    const answers: Record<string, FolderPermission> = {
      a: 'granted',
      b: 'needs-permission',
      c: 'granted',
    };

    const result = await askForFoldersInTurn(
      ['a', 'b', 'c'],
      async (id) => answers[id] ?? 'needs-permission',
      () => true
    );

    expect(result.granted).toEqual(['a', 'c']);
    expect(result.refused).toEqual(['b']);
  });

  test('checks that the click is still fresh before each ask', async () => {
    const mayPrompt: boolean[] = [];
    const freshness = [true, true, false];

    await askForFoldersInTurn(
      ['a', 'b', 'c'],
      async (_id, prompt) => {
        mayPrompt.push(prompt);
        return 'needs-permission';
      },
      () => freshness.shift() ?? false
    );

    expect(mayPrompt).toEqual([true, true, false]);
  });

  test('never prompts for the timed check, which has no click behind it', async () => {
    const mayPrompt: boolean[] = [];

    const result = await askForFoldersInTurn(
      ['a', 'b'],
      async (id, prompt) => {
        mayPrompt.push(prompt);
        return id === 'a' ? 'granted' : 'needs-permission';
      },
      () => false
    );

    expect(mayPrompt).toEqual([false, false]);
    // The folder the browser already allows is still scanned.
    expect(result.granted).toEqual(['a']);
  });

  test('asks for one folder at a time', async () => {
    const log: string[] = [];

    await askForFoldersInTurn(
      ['a', 'b'],
      async (id) => {
        log.push(`ask ${id}`);
        await Promise.resolve();
        log.push(`answer ${id}`);
        return 'granted';
      },
      () => true
    );

    expect(log).toEqual(['ask a', 'answer a', 'ask b', 'answer b']);
  });
});

describe('foldersToReadFor', () => {
  const song = { fileKey: 'music/a.mp3::1000' };
  const talk = { fileKey: 'podcasts/t.mp3::9' };
  const nowhere = { memory: new Map<string, Blob>(), storedKeys: new Set<string>() };

  test('names the folders that hold a song no copy on the device can supply', () => {
    const list = [
      folder('home', homeMusic, [song.fileKey]),
      folder('talk', podcasts, [talk.fileKey]),
      folder('disk', diskMusic, ['music/unrelated.mp3::3']),
    ];

    expect(foldersToReadFor([song, talk], list, nowhere).map((item) => item.id)).toEqual([
      'home',
      'talk',
    ]);
  });

  test('leaves out a folder whose songs of this job are in memory or in storage', () => {
    const list = [folder('home', homeMusic, [song.fileKey]), folder('talk', podcasts, [talk.fileKey])];
    const held = {
      memory: new Map([[song.fileKey, new Blob(['x'])]]),
      storedKeys: new Set([talk.fileKey]),
    };

    expect(foldersToReadFor([song, talk], list, held)).toEqual([]);
  });

  test('names no folder for songs that are in none', () => {
    const list = [folder('home', homeMusic, [song.fileKey])];

    expect(foldersToReadFor([{ fileKey: 'added.mp3::700' }], list, nowhere)).toEqual([]);
  });
});

describe('summarizeFolderPermission', () => {
  const list = [folder('a', homeMusic), folder('b', diskMusic)];

  test('is granted when the browser allows every folder', () => {
    expect(summarizeFolderPermission(list, { a: 'granted', b: 'granted' })).toBe('granted');
  });

  test('needs permission when at least one folder does', () => {
    expect(summarizeFolderPermission(list, { a: 'granted', b: 'needs-permission' })).toBe(
      'needs-permission'
    );
  });

  test('ignores the answer for a folder that left the list', () => {
    expect(
      summarizeFolderPermission(list, { a: 'granted', b: 'granted', gone: 'needs-permission' })
    ).toBe('granted');
  });

  test('makes the top bar read Paused when one of two folders needs access', () => {
    const status = resolveWatcherStatus({
      isScanning: false,
      hasLiveHandle: true,
      intervalSec: 120,
      permission: summarizeFolderPermission(list, { a: 'granted', b: 'needs-permission' }),
    });

    expect(status).toBe('paused');
  });
});

describe('hasReadableFolder', () => {
  const list = [folder('a', homeMusic), folder('b', diskMusic)];

  test('keeps the timed check running while another folder still needs access', () => {
    expect(hasReadableFolder(list, { a: 'needs-permission', b: 'granted' })).toBe(true);
  });

  test('is false when the browser withholds every folder, or there is none', () => {
    expect(hasReadableFolder(list, { a: 'needs-permission', b: 'needs-permission' })).toBe(false);
    expect(hasReadableFolder([], {})).toBe(false);
  });
});

describe('listFolderRows', () => {
  test('gives each folder its name, the songs its last scan saw and its state', () => {
    const list = [folder('a', homeMusic, ['1', '2', '3']), folder('b', diskMusic)];

    const rows = listFolderRows(list, { a: 'granted', b: 'needs-permission' }, 120);

    expect(rows).toEqual([
      { id: 'a', name: 'Music', songCount: 3, state: 'watching' },
      { id: 'b', name: 'Music', songCount: 0, state: 'needs-access' },
    ]);
  });

  test('says idle for a folder the app may read while the timer is off', () => {
    const rows = listFolderRows([folder('a', homeMusic)], { a: 'granted' }, 0);

    expect(rows[0]?.state).toBe('idle');
  });

  test('still says needs access while the timer is off, so the folder can be allowed', () => {
    const rows = listFolderRows([folder('a', homeMusic)], { a: 'needs-permission' }, 0);

    expect(rows[0]?.state).toBe('needs-access');
  });
});

describe('describeRescan', () => {
  test("gives one folder's notice as it is", () => {
    const scanned = [{ name: 'Music', notice: 'All 3 audio files already in your library.' }];

    expect(describeRescan(scanned, [])).toBe('All 3 audio files already in your library.');
  });

  test("puts each folder's name before its notice when several were scanned", () => {
    const scanned = [
      { name: 'Music', notice: 'Added 2 audio files (5 total scanned).' },
      { name: 'Podcasts', notice: 'All 3 audio files already in your library.' },
    ];

    expect(describeRescan(scanned, [])).toBe(
      'Music: Added 2 audio files (5 total scanned). Podcasts: All 3 audio files already in your library.'
    );
  });

  test('names the folders it could not read after the ones it scanned', () => {
    const scanned = [{ name: 'Music', notice: 'All 3 audio files already in your library.' }];

    expect(describeRescan(scanned, ['Podcasts'])).toBe(
      'Music: All 3 audio files already in your library. Folder read permission was not granted for "Podcasts".'
    );
  });

  test('names every folder it could not read', () => {
    expect(describeRescan([], ['Music'])).toBe(
      'Folder read permission was not granted for "Music".'
    );
    expect(describeRescan([], ['Music', 'Podcasts'])).toBe(
      'Folder read permission was not granted for "Music" and "Podcasts".'
    );
    expect(describeRescan([], ['Music', 'Podcasts', 'Old'])).toBe(
      'Folder read permission was not granted for "Music", "Podcasts" and "Old".'
    );
  });

  test('says nothing when there is nothing to say', () => {
    expect(describeRescan([], [])).toBeNull();
    expect(describeRescan([{ name: 'Music', notice: null }], [])).toBeNull();
  });
});

describe('describeFolders', () => {
  test('names one folder and counts several', () => {
    expect(describeFolders(['Music'])).toBe('"Music"');
    expect(describeFolders(['Music', 'Music', 'Podcasts'])).toBe('3 folders');
  });

  test('has a word for none', () => {
    expect(describeFolders([])).toBe('the folder');
  });
});

describe('describeFolderRemoval', () => {
  test('says the songs stay and where they play from afterwards', () => {
    expect(describeFolderRemoval({ songCount: 2573 })).toBe(
      'CrateSync stops reading this folder. The 2573 songs its last scan saw stay in your library. They play again once you scan the folder again, or from Google Drive when they have a Drive file. No file on your disk is touched, and no stored copy is removed.'
    );
  });

  test('speaks of one song as one', () => {
    expect(describeFolderRemoval({ songCount: 1 })).toBe(
      'CrateSync stops reading this folder. The 1 song its last scan saw stays in your library. It plays again once you scan the folder again, or from Google Drive when it has a Drive file. No file on your disk is touched, and no stored copy is removed.'
    );
  });

  test('is short for a folder with no songs', () => {
    expect(describeFolderRemoval({ songCount: 0 })).toBe(
      'CrateSync stops reading this folder. Its last scan saw no songs in it. No file on your disk is touched.'
    );
  });
});
