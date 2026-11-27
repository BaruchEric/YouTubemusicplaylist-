/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import {
  MATCH_REFRESH_MS,
  applyMatchRefresh,
  describeClearedMatches,
  matchesDueForRefresh,
  refreshMatches,
} from '../src/utils/matchRefresh';
import { YouTubeApiError } from '../src/utils/youtubeApi';
import type { LocalTrack } from '../src/types/music';
import { makeTrack } from './factories';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

function matched(id: string, videoId: string, checkedDaysAgo?: number): LocalTrack {
  return makeTrack({
    id,
    youtubeVideoId: videoId,
    matchStatus: 'matched',
    ...(checkedDaysAgo === undefined
      ? {}
      : { youtubeChecked: { videoId, at: NOW - checkedDaysAgo * DAY } }),
  });
}

/** An API that knows the given videos and records what it was asked. */
function apiThatHas(videoIds: string[]) {
  const asked: string[][] = [];
  return {
    asked,
    api: {
      async listExistingVideoIds(ids: readonly string[]) {
        asked.push([...ids]);
        return new Set(ids.filter((id) => videoIds.includes(id)));
      },
    },
  };
}

describe('matchesDueForRefresh', () => {
  test('keeps a saved match for 30 days', () => {
    expect(MATCH_REFRESH_MS).toBe(30 * DAY);
  });

  test('a match YouTube never confirmed is due', () => {
    const track = matched('a', 'vid-a');

    expect(matchesDueForRefresh([track], NOW)).toEqual([track]);
  });

  test('a match confirmed 29 days ago is not due and one confirmed 30 days ago is', () => {
    const fresh = matched('a', 'vid-a', 29);
    const old = matched('b', 'vid-b', 30);

    expect(matchesDueForRefresh([fresh, old], NOW)).toEqual([old]);
  });

  test('a match is due when the song got another video since the check', () => {
    const track = {
      ...matched('a', 'vid-new'),
      youtubeChecked: { videoId: 'vid-old', at: NOW - DAY },
    };

    expect(matchesDueForRefresh([track], NOW)).toEqual([track]);
  });

  test('a song without a video is never due', () => {
    expect(matchesDueForRefresh([makeTrack({ id: 'a' })], NOW)).toEqual([]);
  });
});

describe('refreshMatches', () => {
  test('asks YouTube about the videos that are due and sorts them into kept and gone', async () => {
    const tracks = [matched('a', 'vid-a'), matched('b', 'vid-b', 45), matched('c', 'vid-c', 2)];
    const { api, asked } = apiThatHas(['vid-a']);

    const outcome = await refreshMatches({ api, tracks, now: NOW });

    expect(asked).toEqual([['vid-a', 'vid-b']]);
    expect([...outcome.confirmed]).toEqual(['vid-a']);
    expect([...outcome.gone]).toEqual(['vid-b']);
    expect(outcome.failure).toBeNull();
  });

  test('makes no call when nothing is due', async () => {
    const { api, asked } = apiThatHas([]);

    const outcome = await refreshMatches({ api, tracks: [matched('a', 'vid-a', 1)], now: NOW });

    expect(asked).toEqual([]);
    expect(outcome.confirmed.size + outcome.gone.size).toBe(0);
  });

  test('changes nothing when YouTube refuses the call', async () => {
    const api = {
      async listExistingVideoIds(): Promise<Set<string>> {
        throw new YouTubeApiError({ failure: 'quota', status: 403, reason: 'quotaExceeded', message: 'x' });
      },
    };

    const outcome = await refreshMatches({ api, tracks: [matched('a', 'vid-a')], now: NOW });

    expect(outcome.confirmed.size + outcome.gone.size).toBe(0);
    expect(outcome.failure).toBe('quota');
  });
});

describe('applyMatchRefresh', () => {
  test('records when YouTube confirmed a video', () => {
    const tracks = [matched('a', 'vid-a')];

    const result = applyMatchRefresh(
      tracks,
      { confirmed: new Set(['vid-a']), gone: new Set(), failure: null },
      NOW
    );

    expect(result.tracks[0]?.youtubeChecked).toEqual({ videoId: 'vid-a', at: NOW });
    expect(result.tracks[0]?.youtubeVideoId).toBe('vid-a');
    expect(result.clearedCount).toBe(0);
  });

  test('clears the match of a song whose video YouTube no longer has', () => {
    const tracks = [{ ...matched('a', 'vid-a', 40), youtubeTitle: 'Old title' }];

    const result = applyMatchRefresh(
      tracks,
      { confirmed: new Set(), gone: new Set(['vid-a']), failure: null },
      NOW
    );

    expect(result.clearedCount).toBe(1);
    expect(result.tracks[0]).toMatchObject({
      youtubeVideoId: null,
      youtubeTitle: null,
      matchStatus: 'unmatched',
    });
    expect(result.tracks[0]?.youtubeChecked).toBeUndefined();
  });

  test('leaves the songs it did not ask about as they are', () => {
    const tracks = [matched('a', 'vid-a', 3), makeTrack({ id: 'b' })];

    const result = applyMatchRefresh(
      tracks,
      { confirmed: new Set(), gone: new Set(), failure: null },
      NOW
    );

    expect(result.tracks).toBe(tracks);
  });

  test('does not touch a song that got another video while YouTube was being asked', () => {
    const track = matched('a', 'vid-new', 1);

    const result = applyMatchRefresh(
      [track],
      { confirmed: new Set(), gone: new Set(['vid-old']), failure: null },
      NOW
    );

    expect(result.tracks[0]).toBe(track);
  });
});

describe('describeClearedMatches', () => {
  test('says how many songs are unmatched again and why', () => {
    expect(describeClearedMatches(3)).toBe(
      'YouTube no longer has the videos of 3 songs, so those songs are unmatched again.'
    );
    expect(describeClearedMatches(1)).toBe(
      'YouTube no longer has the video of 1 song, so that song is unmatched again.'
    );
  });
});
