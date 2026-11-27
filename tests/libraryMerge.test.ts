/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { LibraryTombstone, LocalTrack, SmartPlaylist, SyncEvent } from '../src/types/music';
import {
  describeCarriedOver,
  dropTombstoned,
  mergeLibraryForPush,
  mergeLibraryTombstones,
  mergeTrackEdits,
  newestWins,
  parseLibraryTombstones,
  reviveTombstoned,
  stampEditedPlaylists,
  stampEditedTracks,
  trackTombstone,
  type LibrarySnapshot,
} from '../src/utils/libraryMerge';
import { makePlaylist, makeTrack } from './factories';

const NOW = Date.UTC(2026, 10, 26);
const T1 = NOW - 30_000;
const T2 = NOW - 20_000;
const T3 = NOW - 10_000;

function snapshot(parts: Partial<LibrarySnapshot>): LibrarySnapshot {
  return { tracks: [], playlists: [], smartPlaylists: [], syncHistory: [], tombstones: [], ...parts };
}

function smart(id: string, updatedAt: number): SmartPlaylist {
  return {
    id,
    name: `Smart ${id}`,
    description: '',
    matchMode: 'all',
    rules: [],
    sortBy: 'addedAt',
    sortDir: 'desc',
    excludeMissing: false,
    createdAt: 0,
    updatedAt,
  };
}

function event(id: string, timestamp: number): SyncEvent {
  return {
    id,
    playlistId: 'p',
    playlistName: 'P',
    timestamp,
    addedCount: 0,
    removedCount: 0,
    matchedCount: 0,
    totalTracks: 0,
    summary: '',
  };
}

const nobodyHoldsAudio = (): boolean => false;

describe('stampEditedTracks', () => {
  const before = [makeTrack({ id: 'a' }), makeTrack({ id: 'b' })];

  test('stamps a track whose tags or YouTube match changed', () => {
    const after = [{ ...before[0], title: 'Renamed' }, { ...before[1], youtubeVideoId: 'aaaaaaaaaaa' }];
    expect(stampEditedTracks(before, after, NOW).map((t) => t.updatedAt)).toEqual([NOW, NOW]);
  });

  test('leaves a track alone when only device state changed', () => {
    const after = [{ ...before[0], lastSeenAt: 5, cachedOnDeviceAt: 5, isMissingOnDevice: true }, before[1]];
    const stamped = stampEditedTracks(before, after, NOW);
    expect(stamped[0].updatedAt).toBeUndefined();
    expect(stamped[1]).toBe(before[1]);
  });

  test('keeps the time an update brought with it, such as a pulled edit', () => {
    const after = [{ ...before[0], title: 'From Drive', updatedAt: T1 }, before[1]];
    expect(stampEditedTracks(before, after, NOW)[0].updatedAt).toBe(T1);
  });

  test('does not stamp a track that is new to the library', () => {
    const added = makeTrack({ id: 'c' });
    expect(stampEditedTracks(before, [...before, added], NOW)[2]).toBe(added);
  });
});

describe('stampEditedPlaylists', () => {
  const before = [makePlaylist({ id: 'p', trackIds: ['a'], updatedAt: T1 })];

  test('stamps a playlist whose tracks changed without a new time', () => {
    const after = [{ ...before[0], trackIds: ['a', 'b'] }];
    expect(stampEditedPlaylists(before, after, NOW)[0].updatedAt).toBe(NOW);
  });

  test('keeps the time the update set', () => {
    const after = [{ ...before[0], trackIds: ['a', 'b'], updatedAt: T2 }];
    expect(stampEditedPlaylists(before, after, NOW)[0].updatedAt).toBe(T2);
  });

  test('returns the same object for an untouched playlist', () => {
    const copy = [{ ...before[0], trackIds: [...before[0].trackIds] }];
    expect(stampEditedPlaylists(before, copy, NOW)[0].updatedAt).toBe(T1);
  });
});

describe('mergeLibraryTombstones', () => {
  test('keeps the latest deletion of each record', () => {
    const merged = mergeLibraryTombstones(
      [
        [{ kind: 'playlist', id: 'p', deletedAt: T1 }],
        [{ kind: 'playlist', id: 'p', deletedAt: T2 }, { kind: 'smart-playlist', id: 'p', deletedAt: T1 }],
        undefined,
      ],
      NOW
    );
    expect(merged).toEqual([
      { kind: 'playlist', id: 'p', deletedAt: T2 },
      { kind: 'smart-playlist', id: 'p', deletedAt: T1 },
    ]);
  });

  test('forgets a deletion after a year', () => {
    const old = NOW - 366 * 24 * 60 * 60 * 1000;
    expect(mergeLibraryTombstones([[{ kind: 'playlist', id: 'p', deletedAt: old }]], NOW)).toEqual([]);
  });
});

describe('parseLibraryTombstones', () => {
  test('keeps well-formed entries and drops the rest', () => {
    const raw: unknown = [
      { kind: 'playlist', id: 'p', deletedAt: T1 },
      { kind: 'track', id: 't', fileKey: 'k::1', driveFileId: null, deletedAt: T1 },
      { kind: 'track', id: 't2', deletedAt: T1 },
      { kind: 'album', id: 'x', deletedAt: T1 },
      { kind: 'playlist', id: 'q' },
      'nonsense',
    ];
    expect(parseLibraryTombstones(raw)).toEqual([
      { kind: 'playlist', id: 'p', deletedAt: T1 },
      { kind: 'track', id: 't', fileKey: 'k::1', driveFileId: null, deletedAt: T1 },
    ]);
    expect(parseLibraryTombstones(undefined)).toEqual([]);
  });
});

describe('newestWins', () => {
  test('takes the newer copy of a record both sides have', () => {
    const local = [makePlaylist({ id: 'p', name: 'Local', updatedAt: T2 }), makePlaylist({ id: 'q', name: 'Local', updatedAt: T1 })];
    const remote = [makePlaylist({ id: 'p', name: 'Remote', updatedAt: T1 }), makePlaylist({ id: 'q', name: 'Remote', updatedAt: T2 })];
    expect(newestWins(local, remote, 'local').map((p) => [p.id, p.name])).toEqual([
      ['p', 'Local'],
      ['q', 'Remote'],
    ]);
  });

  test('breaks a tie the way the caller asks', () => {
    const local = [makePlaylist({ id: 'p', name: 'Local', updatedAt: T1 })];
    const remote = [makePlaylist({ id: 'p', name: 'Remote', updatedAt: T1 })];
    expect(newestWins(local, remote, 'local')[0].name).toBe('Local');
    expect(newestWins(local, remote, 'remote')[0].name).toBe('Remote');
  });

  test('keeps records only one side has, the other side first', () => {
    const local = [makePlaylist({ id: 'mine' })];
    const remote = [makePlaylist({ id: 'theirs' })];
    expect(newestWins(local, remote, 'local').map((p) => p.id)).toEqual(['theirs', 'mine']);
  });
});

describe('mergeTrackEdits', () => {
  const local = makeTrack({ id: 'a', title: 'Local title', updatedAt: T2, lastSeenAt: 9 });

  test('takes the tags of a newer remote edit and keeps this device\'s file state', () => {
    const remote = makeTrack({ id: 'a', title: 'Remote title', genre: 'Jazz', updatedAt: T3, lastSeenAt: 1 });
    const merged = mergeTrackEdits(local, remote, 'local');
    expect([merged.title, merged.genre, merged.updatedAt, merged.lastSeenAt]).toEqual(['Remote title', 'Jazz', T3, 9]);
  });

  test('keeps the local tags when the local edit is newer', () => {
    const remote = makeTrack({ id: 'a', title: 'Remote title', updatedAt: T1 });
    expect(mergeTrackEdits(local, remote, 'local')).toBe(local);
  });

  test('treats a record with no edit time as the oldest', () => {
    const remote = makeTrack({ id: 'a', title: 'Remote title' });
    expect(mergeTrackEdits(local, remote, 'remote').title).toBe('Local title');
    const legacyLocal = makeTrack({ id: 'a', title: 'Local title' });
    expect(mergeTrackEdits(legacyLocal, remote, 'remote').title).toBe('Remote title');
    expect(mergeTrackEdits(legacyLocal, remote, 'local').title).toBe('Local title');
  });
});

describe('mergeLibraryForPush', () => {
  test('writes the local library as it is when Drive has no manifest', () => {
    const local = snapshot({ tracks: [makeTrack({ id: 'a' })], playlists: [makePlaylist({ id: 'p', trackIds: ['a'] })] });
    const result = mergeLibraryForPush({ local, remote: null, holdsAudio: nobodyHoldsAudio, now: NOW });
    expect(result.library.tracks).toEqual(local.tracks);
    expect(result.library.playlists).toEqual(local.playlists);
    expect(result.carriedOver).toEqual({ tracks: 0, playlists: 0, smartPlaylists: 0 });
  });

  test('keeps songs and playlists that only another device pushed', () => {
    const local = snapshot({ tracks: [makeTrack({ id: 'mine' })], playlists: [makePlaylist({ id: 'p-mine', trackIds: ['mine'] })] });
    const remote = snapshot({
      tracks: [makeTrack({ id: 'theirs' })],
      playlists: [makePlaylist({ id: 'p-theirs', trackIds: ['theirs'] })],
      smartPlaylists: [smart('s-theirs', T1)],
    });
    const result = mergeLibraryForPush({ local, remote, holdsAudio: nobodyHoldsAudio, now: NOW });
    expect(result.library.tracks.map((t) => t.id).sort()).toEqual(['mine', 'theirs']);
    expect(result.library.playlists.map((p) => p.id).sort()).toEqual(['p-mine', 'p-theirs']);
    expect(result.library.smartPlaylists.map((s) => s.id)).toEqual(['s-theirs']);
    expect(result.carriedOver).toEqual({ tracks: 1, playlists: 1, smartPlaylists: 1 });
  });

  test('writes one record for a file both devices scanned, under this device\'s ID', () => {
    const mine = makeTrack({ id: 'mine', fileKey: 'music/song.mp3::1000' });
    const theirs = makeTrack({ id: 'theirs', fileKey: 'music/song.mp3::1000' });
    const result = mergeLibraryForPush({
      local: snapshot({ tracks: [mine] }),
      remote: snapshot({ tracks: [theirs], playlists: [makePlaylist({ id: 'p', trackIds: ['theirs'] })] }),
      holdsAudio: nobodyHoldsAudio,
      now: NOW,
    });
    expect(result.library.tracks.map((t) => t.id)).toEqual(['mine']);
    expect(result.library.playlists[0].trackIds).toEqual(['mine']);
    expect(result.carriedOver.tracks).toBe(0);
  });

  test('writes one record for a file whose name spells an accent differently on each side', () => {
    // A folder on a Mac can hand back "é" as "e" plus a combining accent. The Drive listing sends one character.
    const mine = makeTrack({ id: 'mine', fileKey: 'music/ete\u0301.mp3::1000', fileName: 'Ete\u0301.mp3' });
    const theirs = makeTrack({ id: 'theirs', fileKey: 'gdrive::d1', fileName: 'Et\u00e9.mp3', driveFileId: 'd1' });
    const result = mergeLibraryForPush({
      local: snapshot({ tracks: [mine] }),
      remote: snapshot({ tracks: [theirs] }),
      holdsAudio: nobodyHoldsAudio,
      now: NOW,
    });
    expect(result.library.tracks.map((t) => t.id)).toEqual(['mine']);
  });

  test('lets the newer tag edit of a shared song win', () => {
    const mine = makeTrack({ id: 'a', title: 'Mine', updatedAt: T1 });
    const theirs = makeTrack({ id: 'a', title: 'Theirs', updatedAt: T2 });
    const result = mergeLibraryForPush({
      local: snapshot({ tracks: [mine] }),
      remote: snapshot({ tracks: [theirs] }),
      holdsAudio: nobodyHoldsAudio,
      now: NOW,
    });
    expect(result.library.tracks[0].title).toBe('Theirs');
  });

  test('lets the newer copy of a playlist win, and this device win a tie', () => {
    const local = snapshot({
      playlists: [makePlaylist({ id: 'p', name: 'Mine', updatedAt: T1 }), makePlaylist({ id: 'q', name: 'Mine', updatedAt: T2 })],
    });
    const remote = snapshot({
      playlists: [makePlaylist({ id: 'p', name: 'Theirs', updatedAt: T2 }), makePlaylist({ id: 'q', name: 'Theirs', updatedAt: T2 })],
    });
    const result = mergeLibraryForPush({ local, remote, holdsAudio: nobodyHoldsAudio, now: NOW });
    const names = new Map(result.library.playlists.map((p) => [p.id, p.name]));
    expect(names.get('p')).toBe('Theirs');
    expect(names.get('q')).toBe('Mine');
  });

  test('does not bring back a playlist this device deleted', () => {
    const tombstones: LibraryTombstone[] = [{ kind: 'playlist', id: 'p', deletedAt: T2 }];
    const result = mergeLibraryForPush({
      local: snapshot({ tombstones }),
      remote: snapshot({ playlists: [makePlaylist({ id: 'p', updatedAt: T1 })] }),
      holdsAudio: nobodyHoldsAudio,
      now: NOW,
    });
    expect(result.library.playlists).toEqual([]);
    expect(result.library.tombstones).toEqual(tombstones);
  });

  test('keeps a playlist another device edited after this device deleted it', () => {
    const result = mergeLibraryForPush({
      local: snapshot({ tombstones: [{ kind: 'playlist', id: 'p', deletedAt: T2 }] }),
      remote: snapshot({ playlists: [makePlaylist({ id: 'p', updatedAt: T3 })] }),
      holdsAudio: nobodyHoldsAudio,
      now: NOW,
    });
    expect(result.library.playlists.map((p) => p.id)).toEqual(['p']);
  });

  test('leaves out a local playlist another device deleted since', () => {
    const result = mergeLibraryForPush({
      local: snapshot({ playlists: [makePlaylist({ id: 'p', updatedAt: T1 })] }),
      remote: snapshot({ tombstones: [{ kind: 'playlist', id: 'p', deletedAt: T2 }] }),
      holdsAudio: nobodyHoldsAudio,
      now: NOW,
    });
    expect(result.library.playlists).toEqual([]);
  });

  test('does not bring back a song this device removed, matched by its file', () => {
    const removed = makeTrack({ id: 'mine', fileKey: 'music/song.mp3::1000', addedAt: T1 });
    const result = mergeLibraryForPush({
      local: snapshot({ tombstones: [trackTombstone(removed, T2)] }),
      remote: snapshot({
        tracks: [makeTrack({ id: 'theirs', fileKey: 'music/song.mp3::1000', addedAt: T1 })],
        playlists: [makePlaylist({ id: 'p', trackIds: ['theirs'] })],
      }),
      holdsAudio: nobodyHoldsAudio,
      now: NOW,
    });
    expect(result.library.tracks).toEqual([]);
    expect(result.library.playlists[0].trackIds).toEqual([]);
  });

  test('keeps a removed song on a device that still holds its audio, as a fresh edit', () => {
    const held = makeTrack({ id: 'mine', addedAt: T1 });
    const result = mergeLibraryForPush({
      local: snapshot({ tracks: [held] }),
      remote: snapshot({ tombstones: [trackTombstone(held, T2)] }),
      holdsAudio: (track: LocalTrack) => track.id === 'mine',
      now: NOW,
    });
    expect(result.library.tracks.map((t) => [t.id, t.updatedAt])).toEqual([['mine', NOW]]);
    expect(result.revivedTrackIds).toEqual(['mine']);
  });

  test('leaves out a removed song this device only lists', () => {
    const listed = makeTrack({ id: 'mine', addedAt: T1 });
    const result = mergeLibraryForPush({
      local: snapshot({ tracks: [listed] }),
      remote: snapshot({ tombstones: [trackTombstone(listed, T2)] }),
      holdsAudio: nobodyHoldsAudio,
      now: NOW,
    });
    expect(result.library.tracks).toEqual([]);
  });

  test('joins the sync history, newest first, at most 50', () => {
    const local = snapshot({ syncHistory: Array.from({ length: 40 }, (_, i) => event(`l${i}`, 1000 + i)) });
    const remote = snapshot({
      syncHistory: [...Array.from({ length: 40 }, (_, i) => event(`r${i}`, 2000 + i)), event('l0', 1000)],
    });
    const history = mergeLibraryForPush({ local, remote, holdsAudio: nobodyHoldsAudio, now: NOW }).library.syncHistory;
    expect(history).toHaveLength(50);
    expect(history[0].id).toBe('r39');
    expect(new Set(history.map((e) => e.id)).size).toBe(50);
  });
});

describe('dropTombstoned', () => {
  test('removes deleted playlists and listed songs, and keeps songs held on this device', () => {
    const listed = makeTrack({ id: 'listed', addedAt: T1 });
    const held = makeTrack({ id: 'held', addedAt: T1 });
    const result = dropTombstoned({
      tracks: [listed, held],
      playlists: [makePlaylist({ id: 'p', trackIds: ['listed', 'held'], updatedAt: T1 }), makePlaylist({ id: 'gone', updatedAt: T1 })],
      smartPlaylists: [smart('s', T1), smart('kept', T3)],
      tombstones: [
        trackTombstone(listed, T2),
        trackTombstone(held, T2),
        { kind: 'playlist', id: 'gone', deletedAt: T2 },
        { kind: 'smart-playlist', id: 's', deletedAt: T2 },
        { kind: 'smart-playlist', id: 'kept', deletedAt: T2 },
      ],
      holdsAudio: (track: LocalTrack) => track.id === 'held',
      now: NOW,
    });
    expect(result.tracks.map((t) => [t.id, t.updatedAt])).toEqual([['held', NOW]]);
    expect(result.playlists.map((p) => [p.id, p.trackIds])).toEqual([['p', ['held']]]);
    expect(result.smartPlaylists.map((s) => s.id)).toEqual(['kept']);
  });
});

describe('describeCarriedOver', () => {
  test('says nothing when Drive had nothing this device lacked', () => {
    expect(describeCarriedOver({ tracks: 0, playlists: 0, smartPlaylists: 0 })).toBe('');
  });

  test('counts what other devices pushed and this push kept', () => {
    expect(describeCarriedOver({ tracks: 2, playlists: 1, smartPlaylists: 0 })).toBe(
      'Kept 2 songs and 1 playlist that other devices pushed.'
    );
    expect(describeCarriedOver({ tracks: 1, playlists: 2, smartPlaylists: 3 })).toBe(
      'Kept 1 song, 2 playlists and 3 smart playlists that other devices pushed.'
    );
  });
});

describe('reviveTombstoned', () => {
  test('marks records a deletion covers as changed now, and leaves the rest alone', () => {
    const back = makeTrack({ id: 'back', addedAt: T1 });
    const untouched = makeTrack({ id: 'untouched', addedAt: T1 });
    const result = reviveTombstoned({
      tracks: [back, untouched],
      playlists: [makePlaylist({ id: 'p', updatedAt: T1 }), makePlaylist({ id: 'q', updatedAt: T1 })],
      smartPlaylists: [smart('s', T1)],
      tombstones: [
        trackTombstone(back, T2),
        { kind: 'playlist', id: 'p', deletedAt: T2 },
        { kind: 'smart-playlist', id: 's', deletedAt: T2 },
      ],
      now: NOW,
    });
    expect(result.tracks.map((t) => [t.id, t.updatedAt])).toEqual([
      ['back', NOW],
      ['untouched', undefined],
    ]);
    expect(result.tracks[1]).toBe(untouched);
    expect(result.playlists.map((p) => [p.id, p.updatedAt])).toEqual([
      ['p', NOW],
      ['q', T1],
    ]);
    expect(result.smartPlaylists[0].updatedAt).toBe(NOW);
  });

  test('a revived record survives the deletion that covered it', () => {
    const back = makeTrack({ id: 'back', addedAt: T1 });
    const tombstones = [trackTombstone(back, T2)];
    const revived = reviveTombstoned({ tracks: [back], playlists: [], smartPlaylists: [], tombstones, now: NOW });
    const afterPull = dropTombstoned({ ...revived, tombstones, holdsAudio: nobodyHoldsAudio, now: NOW + 1 });
    expect(afterPull.tracks.map((t) => t.id)).toEqual(['back']);
  });
});
