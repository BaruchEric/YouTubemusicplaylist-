/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { YouTubeApiError, type YouTubeApi, type YouTubeFailure, type YouTubePlaylistItem } from '../src/utils/youtubeApi';
import {
  describeYouTubePush,
  estimateYouTubePush,
  planYouTubeOrder,
  planYouTubePush,
  playlistAfterPush,
  playlistVideoIds,
  pushPlaylistToYouTube,
  type YouTubePushOutcome,
  type YouTubePushProgress,
} from '../src/utils/youtubePush';
import { makePlaylist, makeTrack } from './factories';

const PLAYLIST_URL = 'https://music.youtube.com/playlist?list=PL-linked-playlist';

function matched(id: string, videoId: string) {
  return makeTrack({ id, youtubeVideoId: videoId, matchStatus: 'matched' });
}

function item(videoId: string, itemId = `item-${videoId}`): YouTubePlaylistItem {
  return { itemId, videoId };
}

function fail(failure: YouTubeFailure): YouTubeApiError {
  return new YouTubeApiError({ failure, status: 400, reason: failure, message: `failed: ${failure}` });
}

interface FakeYouTube {
  api: YouTubeApi;
  /** Video ids on the playlist, in order. */
  videos: () => string[];
  log: string[];
}

/**
 * A YouTube account with at most one playlist. `failOn` maps a logged call such as
 * "insert vid-2" or "move vid-2" to the errors its next attempts throw, first attempt first.
 * With `sortedByYouTube` the playlist is not in manual order: YouTube refuses every place
 * a caller asks for, as it does for a playlist sorted by date.
 */
function fakeYouTube(
  options: {
    remote?: YouTubePlaylistItem[];
    failOn?: Record<string, YouTubeApiError[]>;
    sortedByYouTube?: boolean;
  } = {}
): FakeYouTube {
  let items = [...(options.remote ?? [])];
  const failOn = new Map(Object.entries(options.failOn ?? {}).map(([call, errors]) => [call, [...errors]]));
  const log: string[] = [];
  const attempt = (call: string) => {
    log.push(call);
    const error = failOn.get(call)?.shift();
    if (error) throw error;
  };
  return {
    log,
    videos: () => items.map((entry) => entry.videoId),
    api: {
      async createPlaylist({ title }) {
        attempt(`create ${title}`);
        return 'PL-created-playlist';
      },
      async listPlaylistItems(playlistId) {
        attempt(`list ${playlistId}`);
        return [...items];
      },
      async insertPlaylistItem(playlistId, videoId, position) {
        attempt(`insert ${videoId}`);
        if (position !== undefined && options.sortedByYouTube) throw fail('not-manual-order');
        if (position !== undefined && position > items.length) throw fail('bad-position');
        const entry = { itemId: `item-${videoId}-${items.length}`, videoId };
        items.splice(position ?? items.length, 0, entry);
        void playlistId;
      },
      // As on YouTube, position is where the entry sits once it has moved.
      async movePlaylistItem({ itemId, videoId, position }) {
        attempt(`move ${videoId}`);
        if (options.sortedByYouTube) throw fail('not-manual-order');
        const from = items.findIndex((entry) => entry.itemId === itemId);
        const [entry] = from === -1 ? [] : items.splice(from, 1);
        if (!entry) throw fail('item-missing');
        if (position > items.length) throw fail('bad-position');
        items.splice(position, 0, entry);
      },
      async deletePlaylistItem(itemId) {
        attempt(`delete ${itemId}`);
        items = items.filter((entry) => entry.itemId !== itemId);
      },
    },
  };
}

describe('playlistVideoIds', () => {
  test('keeps playlist order, drops unmatched songs and counts them', () => {
    const tracks = [matched('a', 'vid-a'), makeTrack({ id: 'b' }), matched('c', 'vid-c')];
    expect(playlistVideoIds(tracks)).toEqual({ videoIds: ['vid-a', 'vid-c'], unmatchedCount: 1 });
  });

  test('sends a video once when two files match it', () => {
    const tracks = [matched('a', 'vid-a'), matched('a-flac', 'vid-a')];
    expect(playlistVideoIds(tracks).videoIds).toEqual(['vid-a']);
  });
});

describe('planYouTubePush', () => {
  test('adds what the YouTube playlist lacks, in playlist order', () => {
    const plan = planYouTubePush({
      wanted: ['vid-a', 'vid-b', 'vid-c'],
      remote: [item('vid-b')],
      previouslyPushed: [],
    });
    expect(plan.toInsert).toEqual(['vid-a', 'vid-c']);
    expect(plan.alreadyThere).toBe(1);
    expect(plan.toDelete).toEqual([]);
  });

  test('removes a song CrateSync pushed earlier that has since left the playlist', () => {
    const plan = planYouTubePush({
      wanted: ['vid-a'],
      remote: [item('vid-a'), item('vid-gone')],
      previouslyPushed: ['vid-a', 'vid-gone'],
    });
    expect(plan.toDelete).toEqual([item('vid-gone')]);
    expect(plan.toInsert).toEqual([]);
  });

  test('leaves alone a song somebody added on YouTube by hand', () => {
    const plan = planYouTubePush({
      wanted: ['vid-a'],
      remote: [item('vid-a'), item('vid-by-hand')],
      previouslyPushed: ['vid-a'],
    });
    expect(plan.toDelete).toEqual([]);
    expect(plan.leftAlone).toBe(1);
  });

  test('removes every copy of a pushed song that left, when YouTube holds it twice', () => {
    const plan = planYouTubePush({
      wanted: [],
      remote: [item('vid-gone', 'item-1'), item('vid-gone', 'item-2')],
      previouslyPushed: ['vid-gone'],
    });
    expect(plan.toDelete.map((entry) => entry.itemId)).toEqual(['item-1', 'item-2']);
  });
});

describe('planYouTubeOrder', () => {
  test('moves nothing when YouTube has the songs in playlist order', () => {
    const plan = planYouTubeOrder({
      wanted: ['vid-a', 'vid-b', 'vid-c'],
      remote: ['vid-a', 'vid-b', 'vid-c'],
    });
    expect(plan.moves).toEqual([]);
    expect(plan.stays).toEqual(['vid-a', 'vid-b', 'vid-c']);
  });

  test('moves one song when one song changed place', () => {
    const plan = planYouTubeOrder({
      wanted: ['vid-e', 'vid-a', 'vid-b', 'vid-c', 'vid-d'],
      remote: ['vid-a', 'vid-b', 'vid-c', 'vid-d', 'vid-e'],
    });
    expect(plan.moves).toEqual(['vid-e']);
    expect(plan.stays).toEqual(['vid-a', 'vid-b', 'vid-c', 'vid-d']);
  });

  test('keeps the longest run that is already in order and lists the rest in playlist order', () => {
    const plan = planYouTubeOrder({
      wanted: ['vid-c', 'vid-d', 'vid-b', 'vid-a'],
      remote: ['vid-a', 'vid-b', 'vid-c', 'vid-d'],
    });
    expect(plan.stays).toEqual(['vid-c', 'vid-d']);
    expect(plan.moves).toEqual(['vid-b', 'vid-a']);
  });

  test('moves all but one song of a reversed playlist', () => {
    const plan = planYouTubeOrder({
      wanted: ['vid-d', 'vid-c', 'vid-b', 'vid-a'],
      remote: ['vid-a', 'vid-b', 'vid-c', 'vid-d'],
    });
    expect(plan.stays).toHaveLength(1);
    expect(plan.moves).toHaveLength(3);
  });

  test('looks past songs the playlist does not hold and past second copies', () => {
    const plan = planYouTubeOrder({
      wanted: ['vid-a', 'vid-b'],
      remote: ['vid-by-hand', 'vid-a', 'vid-b', 'vid-a'],
    });
    expect(plan.moves).toEqual([]);
  });

  test('leaves out a wanted song YouTube does not have yet', () => {
    const plan = planYouTubeOrder({ wanted: ['vid-new', 'vid-a'], remote: ['vid-a'] });
    expect(plan).toEqual({ stays: ['vid-a'], moves: [] });
  });
});

describe('estimateYouTubePush', () => {
  test('a playlist never pushed sends every matched song and creates the playlist', () => {
    const playlist = makePlaylist({ id: 'p' });
    const estimate = estimateYouTubePush(playlist, [matched('a', 'vid-a'), makeTrack({ id: 'b' })]);
    expect(estimate).toEqual({
      linkedPlaylistId: null,
      knowsWhatIsThere: false,
      matchedCount: 1,
      sendCount: 1,
      removeCount: 0,
      moveCount: 0,
      unmatchedCount: 1,
      quotaUnits: 100,
      days: 1,
    });
  });

  test('counts the songs that changed place since the last push', () => {
    const playlist = makePlaylist({
      id: 'p',
      youtubePlaylistUrl: PLAYLIST_URL,
      youtubePush: {
        playlistId: 'PL-linked-playlist',
        videoIds: ['vid-a', 'vid-b', 'vid-c'],
        pushedAt: 1,
      },
    });
    const estimate = estimateYouTubePush(playlist, [
      matched('c', 'vid-c'),
      matched('a', 'vid-a'),
      matched('b', 'vid-b'),
    ]);
    expect(estimate.sendCount).toBe(0);
    expect(estimate.moveCount).toBe(1);
    expect(estimate.quotaUnits).toBe(50);
  });

  test('a playlist pushed before counts only the songs added and removed since', () => {
    const playlist = makePlaylist({
      id: 'p',
      youtubePlaylistUrl: PLAYLIST_URL,
      youtubePush: { playlistId: 'PL-linked-playlist', videoIds: ['vid-a', 'vid-old'], pushedAt: 1 },
    });
    const estimate = estimateYouTubePush(playlist, [matched('a', 'vid-a'), matched('b', 'vid-b')]);
    expect(estimate.linkedPlaylistId).toBe('PL-linked-playlist');
    expect(estimate.knowsWhatIsThere).toBe(true);
    expect(estimate.sendCount).toBe(1);
    expect(estimate.removeCount).toBe(1);
  });

  test('ignores the record of a push to a different YouTube playlist', () => {
    const playlist = makePlaylist({
      id: 'p',
      youtubePlaylistUrl: PLAYLIST_URL,
      youtubePush: { playlistId: 'PL-another-playlist', videoIds: ['vid-a', 'vid-old'], pushedAt: 1 },
    });
    const estimate = estimateYouTubePush(playlist, [matched('a', 'vid-a')]);
    expect(estimate.knowsWhatIsThere).toBe(false);
    expect(estimate.sendCount).toBe(1);
    expect(estimate.removeCount).toBe(0);
  });

  test('says how many days a push larger than the daily allowance takes', () => {
    const tracks = Array.from({ length: 450 }, (_, index) => matched(`t${index}`, `vid-${index}`));
    const estimate = estimateYouTubePush(makePlaylist({ id: 'p' }), tracks);
    expect(estimate.quotaUnits).toBe(50 + 450 * 50);
    expect(estimate.days).toBe(3);
  });
});

describe('pushPlaylistToYouTube', () => {
  test('creates the playlist on a first push and records what it sent', async () => {
    const youtube = fakeYouTube();
    const progress: YouTubePushProgress[] = [];

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: makePlaylist({ id: 'p', name: 'Road Mix' }),
      tracks: [matched('a', 'vid-a'), makeTrack({ id: 'b' }), matched('c', 'vid-c')],
      now: 500,
      onProgress: (step) => progress.push(step),
    });

    expect(youtube.log).toEqual(['create Road Mix', 'insert vid-a', 'insert vid-c']);
    expect(youtube.videos()).toEqual(['vid-a', 'vid-c']);
    expect(outcome.order).toEqual({ state: 'in-order' });
    expect(outcome.playlist).toEqual({ id: 'PL-created-playlist', created: true });
    expect(outcome.inserted).toEqual(['vid-a', 'vid-c']);
    expect(outcome.stopped).toBeNull();
    expect(outcome.record).toEqual({ playlistId: 'PL-created-playlist', videoIds: ['vid-a', 'vid-c'], pushedAt: 500 });
    expect(progress.at(-1)).toEqual({ step: 'adding', done: 2, total: 2 });
  });

  test('a second push reads the linked playlist and sends only the difference', async () => {
    const youtube = fakeYouTube({ remote: [item('vid-a'), item('vid-old')] });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: makePlaylist({
        id: 'p',
        youtubePlaylistUrl: PLAYLIST_URL,
        youtubePush: { playlistId: 'PL-linked-playlist', videoIds: ['vid-a', 'vid-old'], pushedAt: 1 },
      }),
      tracks: [matched('a', 'vid-a'), matched('b', 'vid-b')],
      now: 900,
    });

    expect(youtube.log).toEqual(['list PL-linked-playlist', 'insert vid-b', 'delete item-vid-old']);
    expect(youtube.videos()).toEqual(['vid-a', 'vid-b']);
    expect(outcome.playlist).toEqual({ id: 'PL-linked-playlist', created: false });
    expect(outcome.removed).toEqual(['vid-old']);
    expect(outcome.alreadyThere).toBe(1);
    expect(outcome.record).toEqual({ playlistId: 'PL-linked-playlist', videoIds: ['vid-a', 'vid-b'], pushedAt: 900 });
  });

  test('skips a video YouTube no longer has and sends the rest', async () => {
    const youtube = fakeYouTube({ failOn: { 'insert vid-b': [fail('video-missing')] } });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: makePlaylist({ id: 'p' }),
      tracks: [matched('a', 'vid-a'), matched('b', 'vid-b'), matched('c', 'vid-c')],
      now: 1,
    });

    expect(outcome.inserted).toEqual(['vid-a', 'vid-c']);
    expect(outcome.unavailable).toEqual(['vid-b']);
    expect(outcome.stopped).toBeNull();
  });

  test('stops at the daily limit and keeps a record of what did go', async () => {
    const youtube = fakeYouTube({ failOn: { 'insert vid-b': [fail('quota')] } });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: makePlaylist({ id: 'p' }),
      tracks: [matched('a', 'vid-a'), matched('b', 'vid-b'), matched('c', 'vid-c')],
      now: 7,
    });

    expect(youtube.log).toEqual(['create Playlist p', 'insert vid-a', 'insert vid-b']);
    expect(outcome.stopped?.failure).toBe('quota');
    expect(outcome.notSent).toBe(2);
    expect(outcome.record).toEqual({ playlistId: 'PL-created-playlist', videoIds: ['vid-a'], pushedAt: 7 });
  });

  test('the push after a stop sends only what is still missing', async () => {
    const youtube = fakeYouTube({ remote: [item('vid-a')] });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: makePlaylist({
        id: 'p',
        youtubePlaylistUrl: PLAYLIST_URL,
        youtubePush: { playlistId: 'PL-linked-playlist', videoIds: ['vid-a'], pushedAt: 7 },
      }),
      tracks: [matched('a', 'vid-a'), matched('b', 'vid-b'), matched('c', 'vid-c')],
      now: 8,
    });

    expect(youtube.log).toEqual(['list PL-linked-playlist', 'insert vid-b', 'insert vid-c']);
    expect(outcome.record?.videoIds).toEqual(['vid-a', 'vid-b', 'vid-c']);
  });

  test('waits and tries once more when YouTube is busy', async () => {
    const youtube = fakeYouTube({ failOn: { 'insert vid-a': [fail('busy')] } });
    const waits: number[] = [];

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: makePlaylist({ id: 'p' }),
      tracks: [matched('a', 'vid-a')],
      now: 1,
      wait: async (ms) => {
        waits.push(ms);
      },
    });

    expect(youtube.log).toEqual(['create Playlist p', 'insert vid-a', 'insert vid-a']);
    expect(waits).toHaveLength(1);
    expect(outcome.inserted).toEqual(['vid-a']);
    expect(outcome.stopped).toBeNull();
  });

  test('stops when YouTube is still busy on the second try', async () => {
    const youtube = fakeYouTube({ failOn: { 'insert vid-a': [fail('busy'), fail('busy')] } });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: makePlaylist({ id: 'p' }),
      tracks: [matched('a', 'vid-a')],
      now: 1,
      wait: async () => {},
    });

    expect(outcome.stopped?.failure).toBe('busy');
    expect(outcome.inserted).toEqual([]);
  });

  test('changes nothing when the linked playlist cannot be read', async () => {
    const youtube = fakeYouTube({ failOn: { 'list PL-linked-playlist': [fail('playlist-missing')] } });
    const playlist = makePlaylist({
      id: 'p',
      youtubePlaylistUrl: PLAYLIST_URL,
      youtubePush: { playlistId: 'PL-linked-playlist', videoIds: ['vid-a'], pushedAt: 7 },
    });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist,
      tracks: [matched('a', 'vid-a')],
      now: 9,
    });

    expect(youtube.log).toEqual(['list PL-linked-playlist']);
    expect(outcome.stopped?.failure).toBe('playlist-missing');
    expect(outcome.record).toBeNull();
  });

  test('counts an entry that is already gone from YouTube as removed', async () => {
    const youtube = fakeYouTube({
      remote: [item('vid-old')],
      failOn: { 'delete item-vid-old': [fail('item-missing')] },
    });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: makePlaylist({
        id: 'p',
        youtubePlaylistUrl: PLAYLIST_URL,
        youtubePush: { playlistId: 'PL-linked-playlist', videoIds: ['vid-old'], pushedAt: 1 },
      }),
      tracks: [],
      now: 2,
    });

    expect(outcome.removed).toEqual(['vid-old']);
    expect(outcome.stopped).toBeNull();
    expect(outcome.record?.videoIds).toEqual([]);
  });

  test('forgets a pushed song that somebody removed on YouTube, so a later removal does not look for it', async () => {
    const youtube = fakeYouTube({ remote: [item('vid-a')] });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: makePlaylist({
        id: 'p',
        youtubePlaylistUrl: PLAYLIST_URL,
        youtubePush: { playlistId: 'PL-linked-playlist', videoIds: ['vid-a', 'vid-removed-by-hand'], pushedAt: 1 },
      }),
      tracks: [matched('a', 'vid-a')],
      now: 2,
    });

    expect(youtube.log).toEqual(['list PL-linked-playlist']);
    expect(outcome.record?.videoIds).toEqual(['vid-a']);
  });

  test('stops between songs when the caller cancels', async () => {
    const youtube = fakeYouTube();
    const controller = new AbortController();

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: makePlaylist({ id: 'p' }),
      tracks: [matched('a', 'vid-a'), matched('b', 'vid-b')],
      now: 1,
      signal: controller.signal,
      onProgress: (step) => {
        if (step.step === 'adding' && step.done === 1) controller.abort();
      },
    });

    expect(outcome.inserted).toEqual(['vid-a']);
    expect(outcome.stopped?.failure).toBe('cancelled');
    expect(outcome.notSent).toBe(1);
  });
});

describe('pushPlaylistToYouTube, song order', () => {
  /** A playlist linked to the fake's playlist, with an earlier push of these videos on record. */
  function pushedBefore(videoIds: string[]) {
    return makePlaylist({
      id: 'p',
      youtubePlaylistUrl: PLAYLIST_URL,
      youtubePush: { playlistId: 'PL-linked-playlist', videoIds, pushedAt: 1 },
    });
  }

  test('puts a newly matched song where it sits in the playlist', async () => {
    const youtube = fakeYouTube({ remote: [item('vid-a'), item('vid-c')] });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: pushedBefore(['vid-a', 'vid-c']),
      tracks: [matched('a', 'vid-a'), matched('b', 'vid-b'), matched('c', 'vid-c')],
      now: 2,
    });

    expect(youtube.log).toEqual(['list PL-linked-playlist', 'insert vid-b']);
    expect(youtube.videos()).toEqual(['vid-a', 'vid-b', 'vid-c']);
    expect(outcome.moved).toEqual([]);
    expect(outcome.order).toEqual({ state: 'in-order' });
    expect(outcome.record?.videoIds).toEqual(['vid-a', 'vid-b', 'vid-c']);
  });

  test('puts a new first song at the top', async () => {
    const youtube = fakeYouTube({ remote: [item('vid-b'), item('vid-c')] });

    await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: pushedBefore(['vid-b', 'vid-c']),
      tracks: [matched('a', 'vid-a'), matched('b', 'vid-b'), matched('c', 'vid-c')],
      now: 2,
    });

    expect(youtube.videos()).toEqual(['vid-a', 'vid-b', 'vid-c']);
  });

  test('moves a song that changed place in the playlist', async () => {
    const youtube = fakeYouTube({ remote: [item('vid-a'), item('vid-b'), item('vid-c')] });
    const progress: YouTubePushProgress[] = [];

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: pushedBefore(['vid-a', 'vid-b', 'vid-c']),
      tracks: [matched('c', 'vid-c'), matched('a', 'vid-a'), matched('b', 'vid-b')],
      now: 2,
      onProgress: (step) => progress.push(step),
    });

    expect(youtube.log).toEqual(['list PL-linked-playlist', 'move vid-c']);
    expect(youtube.videos()).toEqual(['vid-c', 'vid-a', 'vid-b']);
    expect(outcome.moved).toEqual(['vid-c']);
    expect(outcome.order).toEqual({ state: 'in-order' });
    expect(outcome.stopped).toBeNull();
    expect(progress.at(-1)).toEqual({ step: 'ordering', done: 1, total: 1 });
    expect(outcome.record?.videoIds).toEqual(['vid-c', 'vid-a', 'vid-b']);
  });

  test('puts a reversed playlist in order', async () => {
    const youtube = fakeYouTube({
      remote: [item('vid-a'), item('vid-b'), item('vid-c'), item('vid-d')],
    });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: pushedBefore(['vid-a', 'vid-b', 'vid-c', 'vid-d']),
      tracks: [matched('d', 'vid-d'), matched('c', 'vid-c'), matched('b', 'vid-b'), matched('a', 'vid-a')],
      now: 2,
    });

    expect(youtube.videos()).toEqual(['vid-d', 'vid-c', 'vid-b', 'vid-a']);
    expect(outcome.moved).toHaveLength(3);
  });

  test('never moves a song somebody added on YouTube by hand', async () => {
    const youtube = fakeYouTube({ remote: [item('vid-a'), item('vid-by-hand'), item('vid-b')] });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: pushedBefore(['vid-a', 'vid-b']),
      tracks: [matched('b', 'vid-b'), matched('a', 'vid-a')],
      now: 2,
    });

    expect(youtube.log).not.toContain('move vid-by-hand');
    expect(youtube.videos().filter((videoId) => videoId !== 'vid-by-hand')).toEqual(['vid-b', 'vid-a']);
    expect(youtube.videos()).toContain('vid-by-hand');
    expect(outcome.moved).toHaveLength(1);
    expect(outcome.leftAlone).toBe(1);
  });

  test('adds first, removes next and moves last', async () => {
    const youtube = fakeYouTube({ remote: [item('vid-a'), item('vid-old'), item('vid-b')] });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: pushedBefore(['vid-a', 'vid-old', 'vid-b']),
      tracks: [matched('b', 'vid-b'), matched('x', 'vid-x'), matched('a', 'vid-a')],
      now: 2,
    });

    expect(youtube.log.map((call) => call.split(' ')[0])).toEqual(['list', 'insert', 'delete', 'move']);
    expect(youtube.videos()).toEqual(['vid-b', 'vid-x', 'vid-a']);
    expect(outcome.record?.videoIds).toEqual(['vid-b', 'vid-x', 'vid-a']);
  });

  test('leaves the order to YouTube when the playlist is not in manual order', async () => {
    const youtube = fakeYouTube({
      remote: [item('vid-c'), item('vid-a')],
      sortedByYouTube: true,
    });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: pushedBefore(['vid-c', 'vid-a']),
      tracks: [matched('a', 'vid-a'), matched('b', 'vid-b'), matched('c', 'vid-c')],
      now: 2,
    });

    // The first try names a place and is refused. The second leaves the place to YouTube.
    expect(youtube.log).toEqual(['list PL-linked-playlist', 'insert vid-b', 'insert vid-b']);
    expect(outcome.inserted).toEqual(['vid-b']);
    expect(outcome.moved).toEqual([]);
    expect(outcome.order).toEqual({ state: 'sorted-by-youtube' });
    expect(outcome.stopped).toBeNull();
  });

  test('finds out at the first move that YouTube sorts the playlist, and stops moving', async () => {
    const youtube = fakeYouTube({
      remote: [item('vid-c'), item('vid-b'), item('vid-a')],
      sortedByYouTube: true,
    });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: pushedBefore(['vid-c', 'vid-b', 'vid-a']),
      tracks: [matched('a', 'vid-a'), matched('b', 'vid-b'), matched('c', 'vid-c')],
      now: 2,
    });

    expect(youtube.log.filter((call) => call.startsWith('move'))).toHaveLength(1);
    expect(outcome.order).toEqual({ state: 'sorted-by-youtube' });
    expect(outcome.stopped).toBeNull();
  });

  test('stops moving at the daily limit and counts the songs still out of place', async () => {
    const youtube = fakeYouTube({
      remote: [item('vid-a'), item('vid-b'), item('vid-c'), item('vid-d')],
      failOn: { 'move vid-a': [fail('quota')] },
    });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: pushedBefore(['vid-a', 'vid-b', 'vid-c', 'vid-d']),
      tracks: [matched('c', 'vid-c'), matched('d', 'vid-d'), matched('b', 'vid-b'), matched('a', 'vid-a')],
      now: 2,
    });

    expect(youtube.log).toEqual(['list PL-linked-playlist', 'move vid-b', 'move vid-a']);
    expect(youtube.videos()).toEqual(['vid-a', 'vid-c', 'vid-d', 'vid-b']);
    expect(outcome.moved).toEqual(['vid-b']);
    expect(outcome.stopped?.failure).toBe('quota');
    expect(outcome.order).toEqual({ state: 'out-of-order', left: 1 });
    expect(outcome.record?.videoIds).toEqual(['vid-a', 'vid-c', 'vid-d', 'vid-b']);
  });

  test('carries on when a song to move is already gone from YouTube', async () => {
    const youtube = fakeYouTube({
      remote: [item('vid-a'), item('vid-b'), item('vid-c'), item('vid-d')],
      failOn: { 'move vid-b': [fail('item-missing')] },
    });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: pushedBefore(['vid-a', 'vid-b', 'vid-c', 'vid-d']),
      tracks: [matched('c', 'vid-c'), matched('d', 'vid-d'), matched('b', 'vid-b'), matched('a', 'vid-a')],
      now: 2,
    });

    expect(youtube.log).toEqual(['list PL-linked-playlist', 'move vid-b', 'move vid-a']);
    expect(outcome.moved).toEqual(['vid-a']);
    expect(outcome.stopped).toBeNull();
  });

  test('a push that stops while adding counts the songs it did not get to move', async () => {
    const youtube = fakeYouTube({
      remote: [item('vid-a'), item('vid-b')],
      failOn: { 'insert vid-x': [fail('quota')] },
    });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: pushedBefore(['vid-a', 'vid-b']),
      tracks: [matched('b', 'vid-b'), matched('a', 'vid-a'), matched('x', 'vid-x')],
      now: 2,
    });

    expect(youtube.log).toEqual(['list PL-linked-playlist', 'insert vid-x']);
    expect(outcome.stopped?.failure).toBe('quota');
    expect(outcome.order).toEqual({ state: 'out-of-order', left: 1 });
  });

  test('adds a song at the end when YouTube refuses its place, and leaves the order for the next push', async () => {
    const youtube = fakeYouTube({
      remote: [item('vid-a'), item('vid-c')],
      failOn: { 'insert vid-b': [fail('bad-position')] },
    });

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: pushedBefore(['vid-a', 'vid-c']),
      tracks: [matched('a', 'vid-a'), matched('b', 'vid-b'), matched('c', 'vid-c')],
      now: 2,
    });

    expect(youtube.videos()).toEqual(['vid-a', 'vid-c', 'vid-b']);
    expect(outcome.inserted).toEqual(['vid-b']);
    expect(outcome.stopped).toBeNull();
    expect(outcome.order).toEqual({ state: 'out-of-order', left: 1 });
  });

  test('stops between moves when the caller cancels', async () => {
    const youtube = fakeYouTube({
      remote: [item('vid-a'), item('vid-b'), item('vid-c'), item('vid-d')],
    });
    const controller = new AbortController();

    const outcome = await pushPlaylistToYouTube({
      api: youtube.api,
      playlist: pushedBefore(['vid-a', 'vid-b', 'vid-c', 'vid-d']),
      tracks: [matched('c', 'vid-c'), matched('d', 'vid-d'), matched('b', 'vid-b'), matched('a', 'vid-a')],
      now: 2,
      signal: controller.signal,
      onProgress: (step) => {
        if (step.step === 'ordering' && step.done === 1) controller.abort();
      },
    });

    expect(outcome.moved).toEqual(['vid-b']);
    expect(outcome.stopped?.failure).toBe('cancelled');
    expect(outcome.order).toEqual({ state: 'out-of-order', left: 1 });
  });
});

describe('describeYouTubePush', () => {
  function outcome(overrides: Partial<YouTubePushOutcome>): YouTubePushOutcome {
    return {
      playlist: { id: 'PL-linked-playlist', created: false },
      inserted: [],
      removed: [],
      moved: [],
      order: { state: 'in-order' },
      alreadyThere: 0,
      leftAlone: 0,
      unavailable: [],
      notSent: 0,
      stopped: null,
      record: null,
      ...overrides,
    };
  }

  test('says what was added and removed', () => {
    expect(describeYouTubePush(outcome({ inserted: ['a', 'b'], removed: ['c'] }))).toBe(
      'Added 2 songs and removed 1 song on YouTube.'
    );
  });

  test('says how many songs moved', () => {
    expect(describeYouTubePush(outcome({ moved: ['a'] }))).toBe('Moved 1 song on YouTube.');
    expect(
      describeYouTubePush(outcome({ inserted: ['a'], removed: ['b'], moved: ['c', 'd'] }))
    ).toBe('Added 1 song, removed 1 song and moved 2 songs on YouTube.');
  });

  test('says how many songs a stopped push still has to move', () => {
    const stopped: YouTubePushOutcome['stopped'] = { failure: 'quota', message: 'limit reached' };
    expect(
      describeYouTubePush(
        outcome({ inserted: ['a'], stopped, order: { state: 'out-of-order', left: 2 } })
      )
    ).toBe('Added 1 song on YouTube. 2 songs still to move.');
  });

  test('says so when YouTube already had everything', () => {
    expect(describeYouTubePush(outcome({ alreadyThere: 4 }))).toBe(
      'YouTube already had every matched song.'
    );
  });

  test('names the videos YouTube no longer has', () => {
    expect(describeYouTubePush(outcome({ inserted: ['a'], unavailable: ['gone'] }))).toBe(
      'Added 1 song on YouTube. YouTube no longer has 1 video, so it was skipped.'
    );
  });

  test('says how many songs a stopped push still has to send', () => {
    const stopped: YouTubePushOutcome['stopped'] = { failure: 'quota', message: 'limit reached' };
    expect(describeYouTubePush(outcome({ inserted: ['a'], notSent: 3, stopped }))).toBe(
      'Added 1 song on YouTube. 3 songs still to send.'
    );
    expect(describeYouTubePush(outcome({ notSent: 3, stopped }))).toBe(
      'Nothing changed on YouTube. 3 songs still to send.'
    );
  });
});

describe('playlistAfterPush', () => {
  const finished: YouTubePushOutcome = {
    playlist: { id: 'PL-created-playlist', created: true },
    inserted: ['vid-a'],
    removed: [],
    moved: [],
    order: { state: 'in-order' },
    alreadyThere: 0,
    leftAlone: 0,
    unavailable: [],
    notSent: 0,
    stopped: null,
    record: { playlistId: 'PL-created-playlist', videoIds: ['vid-a'], pushedAt: 40 },
  };

  test('links the playlist to the one the push created and stores the record', () => {
    const after = playlistAfterPush(makePlaylist({ id: 'p', updatedAt: 1 }), finished, 40);
    expect(after.youtubePlaylistUrl).toBe('https://music.youtube.com/playlist?list=PL-created-playlist');
    expect(after.youtubePush).toEqual(finished.record ?? undefined);
    expect(after.updatedAt).toBe(40);
  });

  test('keeps the link the user pasted when the push went to that playlist', () => {
    const playlist = makePlaylist({ id: 'p', youtubePlaylistUrl: PLAYLIST_URL });
    const record = { playlistId: 'PL-linked-playlist', videoIds: ['vid-a'], pushedAt: 40 };
    const after = playlistAfterPush(
      playlist,
      { ...finished, playlist: { id: 'PL-linked-playlist', created: false }, record },
      40
    );
    expect(after.youtubePlaylistUrl).toBe(PLAYLIST_URL);
    expect(after.youtubePush).toEqual(record);
  });

  test('returns the playlist untouched when the push never reached a YouTube playlist', () => {
    const playlist = makePlaylist({ id: 'p', updatedAt: 1 });
    const after = playlistAfterPush(playlist, { ...finished, playlist: null, record: null }, 40);
    expect(after).toBe(playlist);
  });
});
