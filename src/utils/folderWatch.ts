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

interface PermissionRequestable {
  requestPermission(descriptor: { mode: 'read' }): Promise<PermissionState>;
}

function canRequestPermission(handle: object): handle is PermissionRequestable {
  return 'requestPermission' in handle && typeof handle.requestPermission === 'function';
}

/** Asks the browser, without prompting, whether the app may read this folder. */
export async function queryFolderPermission(handle: object): Promise<FolderPermission> {
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

/**
 * Finds out whether the app may read this folder, and asks the user when it may not and
 * `mayPrompt` is true. A re-scan and a click on Play both come through here, so the watcher
 * and the player agree on the folder's state.
 */
export async function ensureFolderPermission(
  handle: object,
  mayPrompt: boolean
): Promise<FolderPermission> {
  const current = await queryFolderPermission(handle);
  if (current === 'granted' || !mayPrompt || !canRequestPermission(handle)) return current;
  try {
    return (await handle.requestPermission({ mode: 'read' })) === 'granted'
      ? 'granted'
      : 'needs-permission';
  } catch {
    // The browser throws when no click or key press is behind the request.
    return 'needs-permission';
  }
}

/** The part of `navigator` that says whether a click is fresh. Older browsers lack it. */
type ClickReporter = Partial<Pick<Navigator, 'userActivation'>>;

/**
 * True while the browser counts a click or key press as just made. The browser shows the
 * folder permission prompt only then, so a song that starts by itself never asks.
 */
export function hasUserGesture(
  browser: ClickReporter | undefined = typeof navigator === 'undefined' ? undefined : navigator
): boolean {
  // A browser too old for userActivation has no folder handles to ask about either.
  return browser?.userActivation?.isActive === true;
}
