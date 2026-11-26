/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { parseWatchInterval, resolveWatcherStatus } from '../src/utils/folderWatch';

describe('parseWatchInterval', () => {
  test('reads a saved interval back', () => {
    expect(parseWatchInterval('30')).toBe(30);
    expect(parseWatchInterval('0')).toBe(0);
    expect(parseWatchInterval(300)).toBe(300);
  });

  test('falls back to 2 minutes for a value the app never offers', () => {
    expect(parseWatchInterval('45')).toBe(120);
    expect(parseWatchInterval(null)).toBe(120);
    expect(parseWatchInterval('')).toBe(120);
  });
});

describe('resolveWatcherStatus', () => {
  const watching = {
    isScanning: false,
    hasLiveHandle: true,
    intervalSec: 120,
    permission: 'granted',
  } as const;

  test('watches a folder the browser may read on a timer', () => {
    expect(resolveWatcherStatus(watching)).toBe('watching');
  });

  test('says paused when the browser wants the folder allowed again', () => {
    expect(resolveWatcherStatus({ ...watching, permission: 'needs-permission' })).toBe('paused');
  });

  test('is idle with the timer off or no folder', () => {
    expect(resolveWatcherStatus({ ...watching, intervalSec: 0 })).toBe('idle');
    expect(resolveWatcherStatus({ ...watching, hasLiveHandle: false })).toBe('idle');
  });

  test('says syncing while a scan runs', () => {
    expect(resolveWatcherStatus({ ...watching, isScanning: true })).toBe('syncing');
  });
});
