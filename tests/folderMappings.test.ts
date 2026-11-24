/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type {
  DeviceFolderBinding,
  DriveFolderMapping,
  FolderMappingTombstone,
} from '../src/types/music';
import {
  applyFolderMappingTombstones,
  mergeFolderMappingState,
  mergeFolderMappingTombstones,
} from '../src/utils/folderMappings';
import { buildLibraryBackupPayload, parseLibraryBackupPayload } from '../src/utils/googleDriveApi';

const NOW = Date.UTC(2026, 10, 23);
const T0 = NOW - 10_000;
const T1 = NOW - 5_000; // the deletion
const T2 = NOW - 1_000; // after the deletion

function binding(deviceId: string, updatedAt?: number, lastSyncedAt: number | null = null): DeviceFolderBinding {
  return {
    deviceId,
    localFolderPath: `Music/${deviceId}`,
    syncDirection: 'bidirectional',
    autoCacheOffline: false,
    lastSyncedAt,
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

function mapping(
  driveFolderId: string,
  bindings: DeviceFolderBinding[],
  updatedAt = T0
): DriveFolderMapping {
  return {
    id: `map-${driveFolderId}-${bindings.map((b) => b.deviceId).join('')}`,
    driveFolderId,
    driveFolderName: `Drive ${driveFolderId}`,
    createdAt: T0,
    updatedAt,
    deviceBindings: Object.fromEntries(bindings.map((b) => [b.deviceId, b])),
  };
}

function state(folderMappings: DriveFolderMapping[], folderMappingTombstones: FolderMappingTombstone[] = []) {
  return { folderMappings, folderMappingTombstones };
}

describe('mergeFolderMappingState', () => {
  test('a deleted mapping stays deleted when a stale copy is pulled', () => {
    const local = state([], [{ driveFolderId: 'M', deletedAt: T1 }]);
    const remote = state([mapping('M', [binding('A', T0), binding('B', T0)])]);
    const merged = mergeFolderMappingState(local, remote, 'A', NOW);
    expect(merged.folderMappings).toEqual([]);
    expect(merged.folderMappingTombstones).toEqual([{ driveFolderId: 'M', deletedAt: T1 }]);
  });

  test('unbinding this device leaves the other device bound', () => {
    const local = state(
      [mapping('M', [binding('B', T0)])],
      [{ driveFolderId: 'M', deviceId: 'A', deletedAt: T1 }]
    );
    const remote = state([mapping('M', [binding('A', T0), binding('B', T0)])]);
    const merged = mergeFolderMappingState(local, remote, 'A', NOW);
    expect(merged.folderMappings).toHaveLength(1);
    expect(Object.keys(merged.folderMappings[0].deviceBindings)).toEqual(['B']);
  });

  test('unbinding the last device removes the mapping everywhere', () => {
    const local = state([], [{ driveFolderId: 'M', deviceId: 'A', deletedAt: T1 }]);
    const remote = state([mapping('M', [binding('A', T0)])]);
    expect(mergeFolderMappingState(local, remote, 'A', NOW).folderMappings).toEqual([]);
  });

  test('a mapping re-created after the delete survives, without the stale bindings', () => {
    const local = state(
      [mapping('M', [binding('A', T2)], T2)],
      [{ driveFolderId: 'M', deletedAt: T1 }]
    );
    const remote = state([mapping('M', [binding('A', T0), binding('B', T0)])]);
    const merged = mergeFolderMappingState(local, remote, 'A', NOW);
    expect(merged.folderMappings).toHaveLength(1);
    expect(Object.keys(merged.folderMappings[0].deviceBindings)).toEqual(['A']);
    expect(merged.folderMappings[0].deviceBindings.A.updatedAt).toBe(T2);
  });

  test('a stale device marking a sync after the delete does not bring the mapping back', () => {
    // Device B never saw the delete, then synced (bumping updatedAt and lastSyncedAt).
    const deviceB = state([mapping('M', [binding('B', T0, T2)], T2)]);
    const manifestFromA = state([], [{ driveFolderId: 'M', deletedAt: T1 }]);
    const onB = mergeFolderMappingState(deviceB, manifestFromA, 'B', NOW);
    expect(onB.folderMappings).toEqual([]);
    // And B's next push carries the tombstone forward instead of erasing it.
    expect(onB.folderMappingTombstones).toEqual([{ driveFolderId: 'M', deletedAt: T1 }]);
  });

  test("a binding saved before updatedAt existed counts as older than any tombstone", () => {
    const local = state([], [{ driveFolderId: 'M', deletedAt: T1 }]);
    const remote = state([mapping('M', [binding('B')])]);
    expect(mergeFolderMappingState(local, remote, 'A', NOW).folderMappings).toEqual([]);
  });

  test("this device's own newer binding beats the manifest's older copy", () => {
    const edited = { ...binding('A', T2), localFolderPath: 'Music/new-place' };
    const local = state([mapping('M', [edited], T2)]);
    const remote = state([mapping('M', [binding('A', T0), binding('B', T0)])]);
    const merged = mergeFolderMappingState(local, remote, 'A', NOW);
    expect(merged.folderMappings[0].deviceBindings.A.localFolderPath).toBe('Music/new-place');
    expect(merged.folderMappings[0].deviceBindings.B).toBeDefined();
  });

  test('a manifest without tombstones is handled', () => {
    const local = state([mapping('M', [binding('A', T0)])]);
    const merged = mergeFolderMappingState(local, { folderMappings: [mapping('N', [binding('B', T0)])] }, 'A', NOW);
    expect(merged.folderMappings.map((m) => m.driveFolderId).sort()).toEqual(['M', 'N']);
    expect(merged.folderMappingTombstones).toEqual([]);
  });
});

describe('mergeFolderMappingTombstones', () => {
  test('drops malformed and expired entries and keeps the latest per key', () => {
    const yearAndADay = 366 * 24 * 60 * 60 * 1000;
    const merged = mergeFolderMappingTombstones(
      [
        [
          null,
          {},
          'M',
          { driveFolderId: '', deletedAt: T1 },
          { driveFolderId: 'M', deletedAt: '5' },
          { driveFolderId: 'M', deletedAt: Number.NaN },
          { driveFolderId: 'M', deviceId: '', deletedAt: T1 },
          { driveFolderId: 'OLD', deletedAt: NOW - yearAndADay },
          { driveFolderId: 'M', deletedAt: T0 },
        ],
        [
          { driveFolderId: 'M', deletedAt: T1 },
          { driveFolderId: 'M', deviceId: 'A', deletedAt: T2, extra: 'ignored' },
        ],
        undefined,
      ],
      NOW
    );
    expect(merged).toEqual([
      { driveFolderId: 'M', deviceId: 'A', deletedAt: T2 },
      { driveFolderId: 'M', deletedAt: T1 },
    ]);
  });
});

describe('applyFolderMappingTombstones', () => {
  test('returns the same array when there are no tombstones', () => {
    const list = [mapping('M', [binding('A', T0)])];
    expect(applyFolderMappingTombstones(list, [])).toBe(list);
  });
});

describe('Drive manifest round trip', () => {
  test('tombstones survive build and parse, and malformed ones are dropped', () => {
    const payload = buildLibraryBackupPayload({
      tracks: [],
      playlists: [],
      smartPlaylists: [],
      syncHistory: [],
      watchedFolderName: null,
      folderMappings: [],
      folderMappingTombstones: [{ driveFolderId: 'M', deletedAt: Date.now() - 1000 }],
    });
    const raw = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    raw.folderMappingTombstones = [
      ...(raw.folderMappingTombstones as unknown[]),
      { driveFolderId: 42, deletedAt: 1 },
    ];
    const parsed = parseLibraryBackupPayload(JSON.stringify(raw));
    expect(parsed?.folderMappingTombstones).toHaveLength(1);
    expect(parsed?.folderMappingTombstones?.[0].driveFolderId).toBe('M');
  });

  test('a manifest written before tombstones existed parses with none', () => {
    const parsed = parseLibraryBackupPayload(
      JSON.stringify({ app: 'CrateSync', tracks: [], playlists: [], folderMappings: [] })
    );
    expect(parsed?.folderMappingTombstones).toEqual([]);
  });
});
