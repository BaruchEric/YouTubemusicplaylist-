/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import {
  describeFreedStorage,
  planFolderScanStorage,
  readFolderFile,
  readTrackFromFolder,
  type FolderDirectory,
  type FolderSource,
} from '../src/utils/folderAudio';
import { makeTrack } from './factories';

function domError(name: string): DOMException {
  return new DOMException(`${name} from the fake folder`, name);
}

type FakeChild = FakeFolder | File;

/** A directory handle that finds a child only by the exact spelling it was made with. Chrome's does the same. */
class FakeFolder implements FolderDirectory {
  listings = 0;

  constructor(
    readonly name: string,
    private readonly children: Record<string, FakeChild> = {}
  ) {}

  async getDirectoryHandle(name: string): Promise<FakeFolder> {
    const child = this.children[name];
    if (child === undefined) throw domError('NotFoundError');
    if (!(child instanceof FakeFolder)) throw domError('TypeMismatchError');
    return child;
  }

  async getFileHandle(name: string): Promise<{ getFile(): Promise<File> }> {
    const child = this.children[name];
    if (child === undefined) throw domError('NotFoundError');
    if (child instanceof FakeFolder) throw domError('TypeMismatchError');
    return { getFile: async () => child };
  }

  async *entries(): AsyncGenerator<[string, FakeChild]> {
    this.listings += 1;
    for (const [name, child] of Object.entries(this.children)) yield [name, child];
  }
}

/** A folder the browser no longer lets the page read. */
function lockedFolder(name: string): FolderDirectory {
  const refuse = async (): Promise<never> => {
    throw domError('NotAllowedError');
  };
  return {
    name,
    getDirectoryHandle: refuse,
    getFileHandle: refuse,
    entries: () => {
      throw domError('NotAllowedError');
    },
  };
}

function audio(name: string, text = 'audio bytes'): File {
  return new File([text], name, { type: 'audio/mpeg' });
}

describe('readFolderFile', () => {
  test('reads a file by its path under the scanned folder', async () => {
    const song = audio('01 Song.mp3');
    const album = new FakeFolder('Album', { '01 Song.mp3': song });
    const root = new FakeFolder('Music', { Artist: new FakeFolder('Artist', { Album: album }) });

    expect(await readFolderFile(root, 'Music/Artist/Album/01 Song.mp3')).toBe(song);
  });

  test('reads a file that sits right inside the scanned folder', async () => {
    const song = audio('loose.mp3');
    const root = new FakeFolder('Music', { 'loose.mp3': song });

    expect(await readFolderFile(root, 'Music/loose.mp3')).toBe(song);
  });

  test('takes the folder name in any case', async () => {
    const song = audio('a.mp3');
    const root = new FakeFolder('Music', { 'a.mp3': song });

    expect(await readFolderFile(root, 'music/a.mp3')).toBe(song);
  });

  test('finds nothing for a path that starts in another folder', async () => {
    const root = new FakeFolder('Music', { 'a.mp3': audio('a.mp3') });

    expect(await readFolderFile(root, 'Backup/a.mp3')).toBeNull();
  });

  test('finds nothing for a file picked on its own, which has no folder', async () => {
    const root = new FakeFolder('Music', { 'a.mp3': audio('a.mp3') });

    expect(await readFolderFile(root, 'a.mp3')).toBeNull();
  });

  test('finds nothing when the file is gone', async () => {
    const root = new FakeFolder('Music', { Artist: new FakeFolder('Artist') });

    expect(await readFolderFile(root, 'Music/Artist/gone.mp3')).toBeNull();
    expect(await readFolderFile(root, 'Music/Nobody/gone.mp3')).toBeNull();
  });

  test('finds nothing when a folder sits where the file should be', async () => {
    const root = new FakeFolder('Music', { 'a.mp3': new FakeFolder('a.mp3') });

    expect(await readFolderFile(root, 'Music/a.mp3')).toBeNull();
  });

  // A folder on a Mac can hand back "é" as "e" plus a combining accent. The library holds one character.
  test('finds a file whose name the disk spells with a separate accent', async () => {
    const song = audio("01 L'Eté Indien.mp3");
    const root = new FakeFolder('Music', { "01 L'Eté Indien.mp3": song });

    expect(await readFolderFile(root, "Music/01 L'Eté Indien.mp3")).toBe(song);
  });

  test('finds a folder whose name the disk spells with a separate accent', async () => {
    const song = audio('01 Halo.mp3');
    const artist = new FakeFolder('Beyoncé', { '01 Halo.mp3': song });
    const root = new FakeFolder('Music', { 'Beyoncé': artist });

    expect(await readFolderFile(root, 'Music/Beyoncé/01 Halo.mp3')).toBe(song);
  });

  test('finds a file the library spells with a separate accent and the disk with one character', async () => {
    const song = audio('Café.mp3');
    const root = new FakeFolder('Music', { 'Café.mp3': song });

    expect(await readFolderFile(root, 'Music/Café.mp3')).toBe(song);
  });

  test('lists a folder only when the name is not there as spelled', async () => {
    const album = new FakeFolder('Album', { 'a.mp3': audio('a.mp3') });
    const root = new FakeFolder('Music', { Album: album });

    await readFolderFile(root, 'Music/Album/a.mp3');
    expect(root.listings + album.listings).toBe(0);

    await readFolderFile(root, 'Music/Album/b.mp3');
    expect(album.listings).toBe(1);
  });

  test('passes on an error that is not about a missing file', async () => {
    const locked = lockedFolder('Music');

    await expect(readFolderFile(locked, 'Music/a.mp3')).rejects.toThrow('NotAllowedError');
  });
});

describe('readTrackFromFolder', () => {
  const song = audio('a.mp3');
  const track = makeTrack({ id: 'a', fileKey: 'music/a.mp3::1000', relativePath: 'Music/a.mp3' });

  function source(overrides: Partial<FolderSource> = {}): FolderSource & { asked: boolean[] } {
    const asked: boolean[] = [];
    return {
      folder: new FakeFolder('Music', { 'a.mp3': song }),
      fileKeys: new Set([track.fileKey]),
      ensurePermission: async (_folder, mayPrompt) => {
        asked.push(mayPrompt);
        return 'granted';
      },
      asked,
      ...overrides,
    };
  }

  test('reads a song the scan saw in the folder', async () => {
    expect(await readTrackFromFolder(track, source(), false)).toBe(song);
  });

  test('reads a Drive song by the local path a scan gave it', async () => {
    const driveSong = makeTrack({
      id: 'd1',
      fileKey: 'gdrive::d1',
      relativePath: 'Music/a.mp3',
      driveFileId: 'd1',
      drivePath: 'Google Drive/Music',
    });

    const read = await readTrackFromFolder(
      driveSong,
      source({ fileKeys: new Set(['gdrive::d1']) }),
      false
    );

    expect(read).toBe(song);
  });

  test('leaves a song the scan did not see alone, and asks for nothing', async () => {
    const from = source({ fileKeys: new Set() });

    expect(await readTrackFromFolder(track, from, true)).toBeNull();
    expect(from.asked).toEqual([]);
  });

  test('finds nothing when no folder is saved', async () => {
    const from = source({ folder: null });

    expect(await readTrackFromFolder(track, from, true)).toBeNull();
    expect(from.asked).toEqual([]);
  });

  test('says whether the read may show the permission prompt', async () => {
    const from = source();

    await readTrackFromFolder(track, from, true);
    await readTrackFromFolder(track, from, false);

    expect(from.asked).toEqual([true, false]);
  });

  test('finds nothing when the browser withholds the folder', async () => {
    const from = source({ ensurePermission: async () => 'needs-permission' });

    expect(await readTrackFromFolder(track, from, false)).toBeNull();
  });

  test('finds nothing when the folder cannot be read after all', async () => {
    const locked = lockedFolder('Music');

    expect(await readTrackFromFolder(track, source({ folder: locked }), false)).toBeNull();
  });
});

describe('planFolderScanStorage', () => {
  test('records every song the scan saw as playing from the folder', () => {
    const plan = planFolderScanStorage(
      [
        { fileKey: 'music/a.mp3::1000', size: 1000 },
        { fileKey: 'gdrive::d1', size: 2000 },
      ],
      new Set()
    );

    expect([...plan.folderKeys]).toEqual(['music/a.mp3::1000', 'gdrive::d1']);
    expect(plan.freeKeys).toEqual([]);
    expect(plan.freedBytes).toBe(0);
  });

  test('frees the stored copy of a song the scan saw, and adds up the bytes', () => {
    const plan = planFolderScanStorage(
      [
        { fileKey: 'music/a.mp3::1000', size: 1000 },
        { fileKey: 'gdrive::d1', size: 2000 },
        { fileKey: 'music/new.mp3::500', size: 500 },
      ],
      new Set(['music/a.mp3::1000', 'gdrive::d1'])
    );

    expect(plan.freeKeys).toEqual(['music/a.mp3::1000', 'gdrive::d1']);
    expect(plan.freedBytes).toBe(3000);
  });

  test('keeps the stored copy of a song the scan did not see', () => {
    const plan = planFolderScanStorage(
      [{ fileKey: 'music/a.mp3::1000', size: 1000 }],
      new Set(['music/a.mp3::1000', 'added.mp3::700', 'gdrive::elsewhere'])
    );

    expect(plan.freeKeys).toEqual(['music/a.mp3::1000']);
    expect(plan.folderKeys.has('added.mp3::700')).toBe(false);
  });

  test('counts a song once when two files of the scan share its key', () => {
    const plan = planFolderScanStorage(
      [
        { fileKey: 'gdrive::d1', size: 2000 },
        { fileKey: 'gdrive::d1', size: 2000 },
      ],
      new Set(['gdrive::d1'])
    );

    expect(plan.freeKeys).toEqual(['gdrive::d1']);
    expect(plan.freedBytes).toBe(2000);
  });
});

describe('describeFreedStorage', () => {
  test('says how much the scan freed and where the songs play from now', () => {
    expect(describeFreedStorage({ songCount: 2573, bytes: 11.7 * 1024 ** 3 })).toBe(
      'Freed 11.70 GB of browser storage. These songs now play from the folder.'
    );
  });

  test('speaks of one song as one', () => {
    expect(describeFreedStorage({ songCount: 1, bytes: 5 * 1024 ** 2 })).toBe(
      'Freed 5.0 MB of browser storage. This song now plays from the folder.'
    );
  });

  test('says nothing when the scan freed nothing', () => {
    expect(describeFreedStorage({ songCount: 0, bytes: 0 })).toBeNull();
  });
});
