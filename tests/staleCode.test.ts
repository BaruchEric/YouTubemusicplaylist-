/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { STALE_CODE_RELOAD_PAUSE_MS, shouldReloadForStaleCode } from '../src/utils/staleCode';

describe('shouldReloadForStaleCode', () => {
  test('reloads the first time a screen fails to load', () => {
    expect(shouldReloadForStaleCode(null, 5_000)).toBe(true);
  });

  test('does not reload again right after a reload, so a real outage cannot loop', () => {
    expect(shouldReloadForStaleCode(5_000, 5_000 + STALE_CODE_RELOAD_PAUSE_MS)).toBe(false);
  });

  test('reloads again once the pause has passed', () => {
    expect(shouldReloadForStaleCode(5_000, 5_001 + STALE_CODE_RELOAD_PAUSE_MS)).toBe(true);
  });

  test('ignores a stored time from the future, as after a clock change', () => {
    expect(shouldReloadForStaleCode(9_000, 5_000)).toBe(true);
  });
});
