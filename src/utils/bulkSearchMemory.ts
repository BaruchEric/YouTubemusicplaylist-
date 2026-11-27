/**
 * Which songs a bulk search already asked YouTube about. One search costs 100 of the day's
 * 10,000 quota units, and asking again returns the same videos, so a song is left out of the
 * next runs for 30 days. The list lives in this browser only.
 */
import type { LocalTrack } from '../types/music';

const STORAGE_KEY = 'cratesync_bulk_search_memory_v1';
export const SEARCH_MEMORY_MS = 30 * 24 * 60 * 60 * 1000;

/** Song id to the time YouTube was last searched for it, in milliseconds. */
export type SearchMemory = Record<string, number>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the stored text. Anything unreadable or older than 30 days is left out. */
export function parseSearchMemory(raw: string | null, now: number): SearchMemory {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};

  const memory: SearchMemory = {};
  for (const [id, searchedAt] of Object.entries(parsed)) {
    if (typeof searchedAt !== 'number' || !Number.isFinite(searchedAt)) continue;
    if (now - searchedAt > SEARCH_MEMORY_MS) continue;
    memory[id] = searchedAt;
  }
  return memory;
}

export function addToSearchMemory(
  memory: SearchMemory,
  searchedIds: readonly string[],
  now: number
): SearchMemory {
  const next: SearchMemory = { ...memory };
  for (const id of searchedIds) next[id] = now;
  return next;
}

export function songsNotSearchedLately(
  tracks: readonly LocalTrack[],
  memory: SearchMemory
): LocalTrack[] {
  return tracks.filter((track) => memory[track.id] === undefined);
}

export function loadSearchMemory(now: number = Date.now()): SearchMemory {
  try {
    return parseSearchMemory(window.localStorage.getItem(STORAGE_KEY), now);
  } catch {
    return {};
  }
}

/** Stamps the songs as searched and returns the list as it now stands. */
export function rememberSearched(searchedIds: readonly string[], now: number = Date.now()): SearchMemory {
  const next = addToSearchMemory(loadSearchMemory(now), searchedIds, now);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A full or blocked storage only means the next run asks YouTube again.
  }
  return next;
}

export function clearSearchMemory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}
