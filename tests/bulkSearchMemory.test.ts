/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import {
  SEARCH_MEMORY_MS,
  addToSearchMemory,
  parseSearchMemory,
  songsNotSearchedLately,
} from '../src/utils/bulkSearchMemory';
import { makeTrack } from './factories';

const NOW = 1_800_000_000_000;

describe('parseSearchMemory', () => {
  test('reads the stored map of song ids and search times', () => {
    expect(parseSearchMemory('{"a":1799999999000,"b":1799999998000}', NOW)).toEqual({
      a: 1_799_999_999_000,
      b: 1_799_999_998_000,
    });
  });

  test('drops entries older than the memory lasts', () => {
    const old = NOW - SEARCH_MEMORY_MS - 1;
    expect(parseSearchMemory(JSON.stringify({ a: old, b: NOW - 1000 }), NOW)).toEqual({ b: NOW - 1000 });
  });

  test('reads anything that is not such a map as empty', () => {
    expect(parseSearchMemory(null, NOW)).toEqual({});
    expect(parseSearchMemory('not json', NOW)).toEqual({});
    expect(parseSearchMemory('[1,2]', NOW)).toEqual({});
    expect(parseSearchMemory('{"a":"yesterday"}', NOW)).toEqual({});
  });
});

describe('addToSearchMemory', () => {
  test('stamps the searched songs and keeps the earlier ones', () => {
    expect(addToSearchMemory({ a: NOW - 5000 }, ['b', 'c'], NOW)).toEqual({
      a: NOW - 5000,
      b: NOW,
      c: NOW,
    });
  });
});

describe('songsNotSearchedLately', () => {
  test('leaves out the songs the memory holds', () => {
    const tracks = [makeTrack({ id: 'a' }), makeTrack({ id: 'b' })];
    expect(songsNotSearchedLately(tracks, { a: NOW }).map((t) => t.id)).toEqual(['b']);
  });
});
