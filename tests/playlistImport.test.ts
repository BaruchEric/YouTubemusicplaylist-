/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { planPlaylistImport } from '../src/utils/playlistImport';
import type { ImportedTrackSeed } from '../src/utils/youtubeLinks';
import { makeTrack } from './factories';

const NOW = Date.UTC(2026, 10, 26);

function seed(overrides: Partial<ImportedTrackSeed>): ImportedTrackSeed {
  return {
    title: 'Song',
    artist: 'Band',
    album: '',
    duration: 0,
    youtubeVideoId: null,
    relativePath: 'Band - Song',
    ...overrides,
  };
}

function ids(): () => string {
  let next = 0;
  return () => `id-${(next += 1)}`;
}

describe('planPlaylistImport', () => {
  test('starts the imported playlist as never synced', () => {
    const plan = planPlaylistImport({
      name: 'Road trip',
      seeds: [seed({ youtubeVideoId: 'aaaaaaaaaaa' }), seed({ title: 'Other' })],
      existingTracks: [],
      now: NOW,
      newId: ids(),
    });
    expect(plan.playlist.lastSyncedAt).toBeNull();
    expect(plan.playlist.syncedTrackIds).toEqual([]);
    expect(plan.playlist.trackIds).toHaveLength(2);
  });

  test('adds a list-only entry for a song the library does not have', () => {
    const plan = planPlaylistImport({
      name: 'Road trip',
      seeds: [seed({ youtubeVideoId: 'aaaaaaaaaaa' }), seed({ title: 'Other' })],
      existingTracks: [],
      now: NOW,
      newId: ids(),
    });
    expect(plan.newTracks.map((t) => [t.title, t.format, t.matchStatus, t.fileSize])).toEqual([
      ['Song', 'YT', 'matched', 0],
      ['Other', 'LIST', 'unmatched', 0],
    ]);
    expect(plan.playlist.trackIds).toEqual(plan.newTracks.map((t) => t.id));
  });

  test('reuses a library song with the same artist and title', () => {
    const owned = makeTrack({ id: 'owned', title: 'song', artist: 'BAND' });
    const plan = planPlaylistImport({
      name: 'Road trip',
      seeds: [seed({ youtubeVideoId: 'aaaaaaaaaaa' })],
      existingTracks: [owned],
      now: NOW,
      newId: ids(),
    });
    expect(plan.newTracks).toEqual([]);
    expect(plan.playlist.trackIds).toEqual(['owned']);
    expect([...plan.videoIdsToLink]).toEqual([['owned', 'aaaaaaaaaaa']]);
  });

  test('keeps the YouTube match a library song already has', () => {
    const owned = makeTrack({ id: 'owned', title: 'Song', artist: 'Band', youtubeVideoId: 'bbbbbbbbbbb' });
    const plan = planPlaylistImport({
      name: 'Road trip',
      seeds: [seed({ youtubeVideoId: 'aaaaaaaaaaa' })],
      existingTracks: [owned],
      now: NOW,
      newId: ids(),
    });
    expect(plan.videoIdsToLink.size).toBe(0);
  });
});
