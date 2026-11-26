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
    [400, 'invalidPlaylistSnippet', 'other'],
  ];

  for (const [status, reason, failure] of cases) {
    test(`${status} ${reason || '(no reason)'} is ${failure}`, () => {
      expect(classifyYouTubeFailure(status, reason)).toBe(failure);
    });
  }
});
