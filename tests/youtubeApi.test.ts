/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import {
  YouTubeApiError,
  classifyYouTubeFailure,
  createYouTubeApi,
  type YouTubeFetch,
} from '../src/utils/youtubeApi';

interface Call {
  method: string;
  url: URL;
  authorization: string | null;
  body: unknown;
}

type Reply = { status: number; body?: unknown };

/** A fetch that answers from a queue and records what it was asked. */
function fakeFetch(replies: Reply[]): { fetch: YouTubeFetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...replies];
  const fetchImpl: YouTubeFetch = async (input, init) => {
    const request = new Request(input, init);
    const text = await request.text();
    calls.push({
      method: request.method,
      url: new URL(request.url),
      authorization: request.headers.get('authorization'),
      body: parseJson(text),
    });
    const reply = queue.shift();
    if (!reply) throw new Error('fakeFetch ran out of replies');
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fetchImpl, calls };
}

function parseJson(text: string): unknown {
  return text ? JSON.parse(text) : null;
}

/** The playlist title in a request body, or '' when the body has another shape. */
function titleOf(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('snippet' in body)) return '';
  const snippet = body.snippet;
  if (typeof snippet !== 'object' || snippet === null || !('title' in snippet)) return '';
  return typeof snippet.title === 'string' ? snippet.title : '';
}

function googleError(status: number, reason: string): Reply {
  return {
    status,
    body: { error: { code: status, message: `it failed: ${reason}`, errors: [{ reason }] } },
  };
}

async function failureOf(run: () => Promise<unknown>): Promise<YouTubeApiError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof YouTubeApiError) return err;
    throw err;
  }
  throw new Error('expected the call to fail');
}

describe('createPlaylist', () => {
  test('creates a private playlist and returns its id', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: { id: 'PL-new' } }]);
    const api = createYouTubeApi('token-1', fetch);

    const id = await api.createPlaylist({ title: 'Road Mix', description: 'From the car folder' });

    expect(id).toBe('PL-new');
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/youtube/v3/playlists');
    expect(calls[0].url.searchParams.get('part')).toBe('snippet,status');
    expect(calls[0].authorization).toBe('Bearer token-1');
    expect(calls[0].body).toEqual({
      snippet: { title: 'Road Mix', description: 'From the car folder' },
      status: { privacyStatus: 'private' },
    });
  });

  test('sends a title YouTube accepts: no angle brackets, at most 150 characters', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: { id: 'PL-new' } }]);
    const api = createYouTubeApi('token-1', fetch);

    await api.createPlaylist({ title: `<Mix> ${'x'.repeat(200)}`, description: '' });

    const title = titleOf(calls[0].body);
    expect(title.startsWith('Mix xxx')).toBe(true);
    expect(title).toHaveLength(150);
  });

  test('fails when the reply carries no playlist id', async () => {
    const { fetch } = fakeFetch([{ status: 200, body: { kind: 'youtube#playlist' } }]);
    const error = await failureOf(() =>
      createYouTubeApi('t', fetch).createPlaylist({ title: 'A', description: '' })
    );
    expect(error.failure).toBe('other');
  });
});

describe('listPlaylistItems', () => {
  test('follows every page and returns each item with its video', async () => {
    const { fetch, calls } = fakeFetch([
      {
        status: 200,
        body: {
          nextPageToken: 'page-2',
          items: [
            { id: 'item-1', contentDetails: { videoId: 'vid-1' } },
            { id: 'item-2', contentDetails: { videoId: 'vid-2' } },
          ],
        },
      },
      { status: 200, body: { items: [{ id: 'item-3', contentDetails: { videoId: 'vid-3' } }] } },
    ]);

    const items = await createYouTubeApi('t', fetch).listPlaylistItems('PL-1');

    expect(items).toEqual([
      { itemId: 'item-1', videoId: 'vid-1' },
      { itemId: 'item-2', videoId: 'vid-2' },
      { itemId: 'item-3', videoId: 'vid-3' },
    ]);
    expect(calls[0].url.searchParams.get('playlistId')).toBe('PL-1');
    expect(calls[0].url.searchParams.get('maxResults')).toBe('50');
    expect(calls[0].url.searchParams.get('pageToken')).toBeNull();
    expect(calls[1].url.searchParams.get('pageToken')).toBe('page-2');
  });

  test('asks only for the item id, the video id and the position', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: { items: [] } }]);

    await createYouTubeApi('t', fetch).listPlaylistItems('PL-1');

    expect(calls[0].url.searchParams.get('part')).toBe('snippet,contentDetails');
    expect(calls[0].url.searchParams.get('fields')).toBe(
      'nextPageToken,items(id,snippet(position),contentDetails(videoId))'
    );
  });

  test('returns the items in playlist order when the reply is not', async () => {
    const { fetch } = fakeFetch([
      {
        status: 200,
        body: {
          nextPageToken: 'page-2',
          items: [
            { id: 'item-c', snippet: { position: 2 }, contentDetails: { videoId: 'vid-c' } },
            { id: 'item-a', snippet: { position: 0 }, contentDetails: { videoId: 'vid-a' } },
          ],
        },
      },
      {
        status: 200,
        body: {
          items: [{ id: 'item-b', snippet: { position: 1 }, contentDetails: { videoId: 'vid-b' } }],
        },
      },
    ]);

    const items = await createYouTubeApi('t', fetch).listPlaylistItems('PL-1');

    expect(items.map((entry) => entry.videoId)).toEqual(['vid-a', 'vid-b', 'vid-c']);
  });

  test('keeps the order of the reply when an item carries no position', async () => {
    const { fetch } = fakeFetch([
      {
        status: 200,
        body: {
          items: [
            { id: 'item-b', snippet: { position: 1 }, contentDetails: { videoId: 'vid-b' } },
            { id: 'item-a', contentDetails: { videoId: 'vid-a' } },
          ],
        },
      },
    ]);

    const items = await createYouTubeApi('t', fetch).listPlaylistItems('PL-1');

    expect(items.map((entry) => entry.videoId)).toEqual(['vid-b', 'vid-a']);
  });

  test('leaves out rows without an item id or a video id', async () => {
    const { fetch } = fakeFetch([
      {
        status: 200,
        body: {
          items: [{ id: 'item-1' }, { contentDetails: { videoId: 'vid-2' } }, 'junk', null],
        },
      },
    ]);
    expect(await createYouTubeApi('t', fetch).listPlaylistItems('PL-1')).toEqual([]);
  });
});

describe('listPlaylistVideos', () => {
  test('returns each video with its title and channel, in playlist order', async () => {
    const { fetch, calls } = fakeFetch([
      {
        status: 200,
        body: {
          nextPageToken: 'page-2',
          items: [
            {
              snippet: { title: 'Second', videoOwnerChannelTitle: 'B - Topic', position: 1 },
              contentDetails: { videoId: 'vid-2' },
            },
            {
              snippet: { title: 'First', videoOwnerChannelTitle: 'A - Topic', position: 0 },
              contentDetails: { videoId: 'vid-1' },
            },
          ],
        },
      },
      {
        status: 200,
        body: {
          items: [
            {
              snippet: { title: 'Third', videoOwnerChannelTitle: 'C', position: 2 },
              contentDetails: { videoId: 'vid-3' },
            },
          ],
        },
      },
    ]);

    const videos = await createYouTubeApi('t', fetch).listPlaylistVideos('PL-1');

    expect(videos).toEqual([
      { videoId: 'vid-1', title: 'First', channel: 'A - Topic' },
      { videoId: 'vid-2', title: 'Second', channel: 'B - Topic' },
      { videoId: 'vid-3', title: 'Third', channel: 'C' },
    ]);
    expect(calls[0].url.pathname.endsWith('/playlistItems')).toBe(true);
    expect(calls[0].url.searchParams.get('playlistId')).toBe('PL-1');
    expect(calls[1].url.searchParams.get('pageToken')).toBe('page-2');
  });

  test('leaves out deleted and private videos, which carry no channel', async () => {
    const { fetch } = fakeFetch([
      {
        status: 200,
        body: {
          items: [
            { snippet: { title: 'Deleted video', position: 0 }, contentDetails: { videoId: 'vid-1' } },
            { snippet: { title: 'Private video', position: 1 }, contentDetails: { videoId: 'vid-2' } },
            {
              snippet: { title: 'Kept', videoOwnerChannelTitle: 'A', position: 2 },
              contentDetails: { videoId: 'vid-3' },
            },
          ],
        },
      },
    ]);

    const videos = await createYouTubeApi('t', fetch).listPlaylistVideos('PL-1');

    expect(videos).toEqual([{ videoId: 'vid-3', title: 'Kept', channel: 'A' }]);
  });
});

describe('searchVideos', () => {
  test('asks for music videos and returns them best first', async () => {
    const { fetch, calls } = fakeFetch([
      {
        status: 200,
        body: {
          items: [
            { id: { videoId: 'vid-1' }, snippet: { title: 'Fireflies', channelTitle: 'Owl City - Topic' } },
            { id: { videoId: 'vid-2' }, snippet: { title: 'Owl City - Fireflies', channelTitle: 'OwlCityVEVO' } },
          ],
        },
      },
    ]);

    const videos = await createYouTubeApi('t', fetch).searchVideos('Owl City Fireflies');

    expect(videos).toEqual([
      { videoId: 'vid-1', title: 'Fireflies', channel: 'Owl City - Topic' },
      { videoId: 'vid-2', title: 'Owl City - Fireflies', channel: 'OwlCityVEVO' },
    ]);
    const { url, method } = calls[0];
    expect(method).toBe('GET');
    expect(url.pathname.endsWith('/search')).toBe(true);
    expect(url.searchParams.get('q')).toBe('Owl City Fireflies');
    expect(url.searchParams.get('type')).toBe('video');
    expect(url.searchParams.get('videoCategoryId')).toBe('10');
    expect(url.searchParams.get('maxResults')).toBe('5');
  });

  test('turns the HTML entities in a search title back into characters', async () => {
    const { fetch } = fakeFetch([
      {
        status: 200,
        body: {
          items: [
            {
              id: { videoId: 'vid-1' },
              snippet: { title: 'Guns N&#39; Roses - Sweet Child O&#39; Mine &amp; More &quot;Live&quot;', channelTitle: 'Guns N&#39; Roses' },
            },
          ],
        },
      },
    ]);

    const [video] = await createYouTubeApi('t', fetch).searchVideos('x');

    expect(video?.title).toBe('Guns N\' Roses - Sweet Child O\' Mine & More "Live"');
    expect(video?.channel).toBe("Guns N' Roses");
  });

  test('leaves out results without a video id', async () => {
    const { fetch } = fakeFetch([
      { status: 200, body: { items: [{ id: {}, snippet: { title: 'A channel', channelTitle: 'X' } }] } },
    ]);

    expect(await createYouTubeApi('t', fetch).searchVideos('x')).toEqual([]);
  });

  test('reports a used-up allowance as a quota failure', async () => {
    const { fetch } = fakeFetch([googleError(403, 'quotaExceeded')]);

    const attempt = createYouTubeApi('t', fetch).searchVideos('x');

    await expect(attempt).rejects.toMatchObject({ failure: 'quota' });
  });
});

describe('listExistingVideoIds', () => {
  test('returns the ids YouTube still has and leaves out the ones it lost', async () => {
    const { fetch, calls } = fakeFetch([
      { status: 200, body: { items: [{ id: 'vid-1' }, { id: 'vid-3' }] } },
    ]);

    const existing = await createYouTubeApi('t', fetch).listExistingVideoIds([
      'vid-1',
      'vid-2',
      'vid-3',
    ]);

    expect([...existing].sort()).toEqual(['vid-1', 'vid-3']);
    const { url, method } = calls[0];
    expect(method).toBe('GET');
    expect(url.pathname.endsWith('/videos')).toBe(true);
    expect(url.searchParams.get('part')).toBe('id');
    expect(url.searchParams.get('id')).toBe('vid-1,vid-2,vid-3');
    expect(url.searchParams.get('fields')).toBe('items(id)');
  });

  test('asks for 50 ids at a time and each id once', async () => {
    const ids = Array.from({ length: 120 }, (_, index) => `vid-${index}`);
    const { fetch, calls } = fakeFetch([
      { status: 200, body: { items: ids.slice(0, 50).map((id) => ({ id })) } },
      { status: 200, body: { items: [] } },
      { status: 200, body: { items: ids.slice(100).map((id) => ({ id })) } },
    ]);

    const existing = await createYouTubeApi('t', fetch).listExistingVideoIds([...ids, 'vid-0']);

    expect(calls).toHaveLength(3);
    expect(calls[0].url.searchParams.get('id')?.split(',')).toHaveLength(50);
    expect(calls[2].url.searchParams.get('id')?.split(',')).toHaveLength(20);
    expect(existing.size).toBe(70);
    expect(existing.has('vid-60')).toBe(false);
  });

  test('makes no call for an empty list', async () => {
    const { fetch, calls } = fakeFetch([]);

    const existing = await createYouTubeApi('t', fetch).listExistingVideoIds([]);

    expect(existing.size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('insertPlaylistItem and deletePlaylistItem', () => {
  test('adds one video to the playlist', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: { id: 'item-9' } }]);

    await createYouTubeApi('t', fetch).insertPlaylistItem('PL-1', 'vid-9');

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/youtube/v3/playlistItems');
    expect(calls[0].body).toEqual({
      snippet: { playlistId: 'PL-1', resourceId: { kind: 'youtube#video', videoId: 'vid-9' } },
    });
  });

  test('adds a video at a given place in the playlist', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: { id: 'item-9' } }]);

    await createYouTubeApi('t', fetch).insertPlaylistItem('PL-1', 'vid-9', 2);

    expect(calls[0].body).toEqual({
      snippet: {
        playlistId: 'PL-1',
        resourceId: { kind: 'youtube#video', videoId: 'vid-9' },
        position: 2,
      },
    });
  });

  test('moves an entry to another place in the playlist', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: { id: 'item-9' } }]);

    await createYouTubeApi('t', fetch).movePlaylistItem({
      playlistId: 'PL-1',
      itemId: 'item-9',
      videoId: 'vid-9',
      position: 0,
    });

    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url.pathname).toBe('/youtube/v3/playlistItems');
    expect(calls[0].url.searchParams.get('part')).toBe('snippet');
    expect(calls[0].body).toEqual({
      id: 'item-9',
      snippet: {
        playlistId: 'PL-1',
        resourceId: { kind: 'youtube#video', videoId: 'vid-9' },
        position: 0,
      },
    });
  });

  test('removes one playlist entry by its item id', async () => {
    const { fetch, calls } = fakeFetch([{ status: 204 }]);

    await createYouTubeApi('t', fetch).deletePlaylistItem('item-9');

    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url.searchParams.get('id')).toBe('item-9');
  });
});

describe('failures', () => {
  test('names the failure from the reason Google gives', async () => {
    const { fetch } = fakeFetch([googleError(403, 'quotaExceeded')]);
    const error = await failureOf(() =>
      createYouTubeApi('t', fetch).insertPlaylistItem('PL-1', 'vid-1')
    );
    expect(error.failure).toBe('quota');
    expect(error.status).toBe(403);
    expect(error.reason).toBe('quotaExceeded');
  });

  test('reads a reply that is not JSON as a failure of that status', async () => {
    const fetchImpl: YouTubeFetch = async () =>
      new Response('<html>bad gateway</html>', { status: 502 });
    const error = await failureOf(() => createYouTubeApi('t', fetchImpl).listPlaylistItems('PL-1'));
    expect(error.failure).toBe('busy');
    expect(error.status).toBe(502);
  });

  test('reports a request that never reached YouTube as a network failure', async () => {
    const fetchImpl: YouTubeFetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    const error = await failureOf(() => createYouTubeApi('t', fetchImpl).listPlaylistItems('PL-1'));
    expect(error.failure).toBe('network');
  });
});

describe('classifyYouTubeFailure', () => {
  const cases: Array<[number, string, ReturnType<typeof classifyYouTubeFailure>]> = [
    [401, 'authError', 'auth'],
    [401, '', 'auth'],
    [403, 'insufficientPermissions', 'auth'],
    [401, 'youtubeSignupRequired', 'no-channel'],
    [404, 'channelNotFound', 'no-channel'],
    [403, 'quotaExceeded', 'quota'],
    [403, 'dailyLimitExceeded', 'quota'],
    [403, 'accessNotConfigured', 'api-disabled'],
    [404, 'playlistNotFound', 'playlist-missing'],
    [404, 'videoNotFound', 'video-missing'],
    [404, 'playlistItemNotFound', 'item-missing'],
    [400, 'playlistContainsMaximumNumberOfVideos', 'playlist-full'],
    [403, 'playlistItemsNotAccessible', 'forbidden'],
    [403, 'forbidden', 'forbidden'],
    [403, 'rateLimitExceeded', 'busy'],
    [409, 'aborted', 'busy'],
    [503, 'backendError', 'busy'],
    [400, 'manualSortRequired', 'not-manual-order'],
    [400, 'invalidPlaylistItemPosition', 'bad-position'],
    [400, 'invalidPlaylistSnippet', 'other'],
  ];

  for (const [status, reason, failure] of cases) {
    test(`${status} ${reason || '(no reason)'} is ${failure}`, () => {
      expect(classifyYouTubeFailure(status, reason)).toBe(failure);
    });
  }
});
