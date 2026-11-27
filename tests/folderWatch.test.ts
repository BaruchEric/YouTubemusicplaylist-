/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import {
  ensureFolderPermission,
  hasUserGesture,
  parseWatchInterval,
  resolveWatcherStatus,
} from '../src/utils/folderWatch';

describe('hasUserGesture', () => {
  test('is true while the browser counts a click as fresh', () => {
    const fresh = { userActivation: { isActive: true, hasBeenActive: true } };

    expect(hasUserGesture(fresh)).toBe(true);
  });

  test('is false once the click has gone stale', () => {
    const stale = { userActivation: { isActive: false, hasBeenActive: true } };

    expect(hasUserGesture(stale)).toBe(false);
  });

  test('is false in a browser that does not report clicks', () => {
    expect(hasUserGesture({})).toBe(false);
    expect(hasUserGesture(undefined)).toBe(false);
  });
});

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

describe('ensureFolderPermission', () => {
  /** A folder handle whose permission starts at `state` and becomes `answer` once the user is asked. */
  function folder(state: PermissionState, answer: PermissionState = state) {
    let current = state;
    let prompts = 0;
    return {
      queryPermission: async () => current,
      requestPermission: async () => {
        prompts += 1;
        current = answer;
        return current;
      },
      prompts: () => prompts,
    };
  }

  test('reads a folder the browser already allows, without a prompt', async () => {
    const handle = folder('granted');

    expect(await ensureFolderPermission(handle, true)).toBe('granted');
    expect(handle.prompts()).toBe(0);
  });

  test('does not prompt when the caller has no click to show for it', async () => {
    const handle = folder('prompt', 'granted');

    expect(await ensureFolderPermission(handle, false)).toBe('needs-permission');
    expect(handle.prompts()).toBe(0);
  });

  test('prompts on a click and reads the folder once the user allows it', async () => {
    const handle = folder('prompt', 'granted');

    expect(await ensureFolderPermission(handle, true)).toBe('granted');
    expect(handle.prompts()).toBe(1);
  });

  test('stays without access when the user says no', async () => {
    const handle = folder('prompt', 'denied');

    expect(await ensureFolderPermission(handle, true)).toBe('needs-permission');
  });

  test('stays without access when the browser refuses to show the prompt', async () => {
    const handle = {
      queryPermission: async (): Promise<PermissionState> => 'prompt',
      requestPermission: async (): Promise<PermissionState> => {
        throw new DOMException('User activation is required', 'SecurityError');
      },
    };

    expect(await ensureFolderPermission(handle, true)).toBe('needs-permission');
  });

  test('trusts a handle from a browser that never takes access back', async () => {
    expect(await ensureFolderPermission({}, false)).toBe('granted');
  });
});
