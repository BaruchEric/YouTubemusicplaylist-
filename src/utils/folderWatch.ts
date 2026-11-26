import type { DirectoryWatcherStatus } from '../types/music';

export const WATCH_INTERVALS = [0, 30, 120, 300] as const;

/** Seconds between timed folder checks. 0 turns the timer off. */
export type WatchIntervalSec = (typeof WATCH_INTERVALS)[number];

export const DEFAULT_WATCH_INTERVAL: WatchIntervalSec = 120;

const WATCH_INTERVAL_STORAGE_KEY = 'cratesync_auto_watch_interval_v1';

/** Reads an interval from a select value or from storage. Anything the app does not offer is 2 minutes. */
export function parseWatchInterval(raw: unknown): WatchIntervalSec {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_WATCH_INTERVAL;
  const value = Number(raw);
  return WATCH_INTERVALS.find((interval) => interval === value) ?? DEFAULT_WATCH_INTERVAL;
}

export function loadWatchInterval(): WatchIntervalSec {
  try {
    return parseWatchInterval(window.localStorage.getItem(WATCH_INTERVAL_STORAGE_KEY));
  } catch {
    return DEFAULT_WATCH_INTERVAL;
  }
}

export function saveWatchInterval(interval: WatchIntervalSec): void {
  try {
    window.localStorage.setItem(WATCH_INTERVAL_STORAGE_KEY, String(interval));
  } catch {
    // Storage is blocked or full. The interval then lasts until the page closes.
  }
}

/**
 * Whether the browser lets the app read the watched folder right now. A folder handle restored
 * after a reload needs the user to allow it again, and only a click can ask.
 */
export type FolderPermission = 'granted' | 'needs-permission';

export function resolveWatcherStatus(input: {
  isScanning: boolean;
  hasLiveHandle: boolean;
  intervalSec: WatchIntervalSec;
  permission: FolderPermission;
}): DirectoryWatcherStatus {
  if (input.isScanning) return 'syncing';
  if (!input.hasLiveHandle || input.intervalSec === 0) return 'idle';
  return input.permission === 'granted' ? 'watching' : 'paused';
}

interface PermissionQueryable {
  queryPermission(descriptor: { mode: 'read' }): Promise<PermissionState>;
}

function canQueryPermission(handle: object): handle is PermissionQueryable {
  return 'queryPermission' in handle && typeof handle.queryPermission === 'function';
}

/** Asks the browser, without prompting, whether the app may read this folder. */
export async function queryFolderPermission(
  handle: FileSystemDirectoryHandle
): Promise<FolderPermission> {
  // A browser without queryPermission never takes access back from a handle it gave.
  if (!canQueryPermission(handle)) return 'granted';
  try {
    return (await handle.queryPermission({ mode: 'read' })) === 'granted'
      ? 'granted'
      : 'needs-permission';
  } catch {
    return 'needs-permission';
  }
}
