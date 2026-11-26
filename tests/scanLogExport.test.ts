/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ScanLogEntry } from '../src/types/music';
import { buildScanLogExport, localDateStamp } from '../src/utils/scanLogExport';

const LOG: ScanLogEntry = {
  id: 'log-1',
  startedAt: 1,
  completedAt: 2,
  durationMs: 1,
  source: 'manual-folder',
  folderName: 'Music',
  totalFilesEncountered: 3,
  audioFilesProcessed: 2,
  addedCount: 2,
  updatedCount: 0,
  restoredCount: 0,
  missingCount: 0,
  skippedNonAudioCount: 1,
  status: 'completed',
  errors: [],
};

describe('buildScanLogExport', () => {
  const file = buildScanLogExport({
    scanLogs: [LOG],
    watcherStatus: 'watching',
    watchedFolderName: 'Music',
    autoWatchIntervalSec: 120,
    now: new Date(2026, 10, 26, 23, 30),
  });

  test('names the file after the local day, as JSON', () => {
    expect(file.fileName).toBe('cratesync-scan-logs-2026-11-26.json');
    expect(file.mimeType).toBe('application/json');
  });

  test('puts the logs in the contents, not in the file name', () => {
    const parsed: unknown = JSON.parse(file.content);
    expect(parsed).toMatchObject({
      watcherStatus: 'watching',
      watchedFolder: 'Music',
      autoWatchIntervalSec: 120,
      totalScans: 1,
      logs: [{ id: 'log-1', addedCount: 2 }],
    });
  });
});

describe('localDateStamp', () => {
  test('uses the local calendar day late in the evening', () => {
    expect(localDateStamp(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
