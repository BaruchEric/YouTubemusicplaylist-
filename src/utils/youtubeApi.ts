/**
 * The YouTube Data API v3 calls CrateSync makes. Five serve a playlist push: create a
 * playlist, read its entries, add, move and remove a song. Two serve bulk matching: read a
 * playlist's videos with their titles, and search for a song. One checks which saved videos
 * YouTube still has. Every call carries the access
 * token from "Connect YouTube" (scope https://www.googleapis.com/auth/youtube). YouTube Music
 * shows the same playlists as YouTube, so a playlist made here appears in both.
 *
 * Quota: YouTube gives the Google Cloud project 10,000 units a day. Creating a playlist,
 * adding a song, moving a song and removing a song cost 50 each. Reading a page of 50
 * entries costs 1, and so does checking 50 videos. One search costs 100.
 */

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const PAGE_SIZE = 50;
/** YouTube caps a playlist at 5,000 videos, which is 100 pages. The loop stops well past that. */
const MAX_PAGES = 200;
const TITLE_MAX_LENGTH = 150;
const DESCRIPTION_MAX_LENGTH = 5000;
/** The list call reads three values of each entry. Without this YouTube sends titles and thumbnails too. */
const LIST_FIELDS = 'nextPageToken,items(id,snippet(position),contentDetails(videoId))';
/** The titled read asks for the title and the uploader's channel as well. */
const VIDEO_LIST_FIELDS =
  'nextPageToken,items(snippet(title,position,videoOwnerChannelTitle),contentDetails(videoId))';
const SEARCH_FIELDS = 'items(id(videoId),snippet(title,channelTitle))';
/** How many results one search asks for. The price is 100 units whatever the number. */
const SEARCH_RESULT_COUNT = 5;
/** YouTube's category for music, which keeps trailers and gameplay out of the results. */
const MUSIC_CATEGORY_ID = '10';

/** Why a call failed, sorted by what the caller should do about it. */
export type YouTubeFailure =
  /** The token is missing, expired or lacks the YouTube scope: connect again. */
  | 'auth'
  /** The project's daily allowance is used up: continue tomorrow. */
  | 'quota'
  /** The YouTube Data API is switched off for the Google Cloud project. */
  | 'api-disabled'
  /** The Google account has no YouTube channel yet. */
  | 'no-channel'
  /** The playlist belongs to somebody else. */
  | 'forbidden'
  | 'playlist-missing'
  /** The video was deleted or made private: skip it. */
  | 'video-missing'
  /** The playlist entry is already gone. */
  | 'item-missing'
  | 'playlist-full'
  /** YouTube sorts the playlist by date or popularity, so nobody can place a song in it. */
  | 'not-manual-order'
  /** YouTube refused the place asked for. The playlist changed since it was read. */
  | 'bad-position'
  /** A rate limit, a write conflict or a server error: worth one more try. */
  | 'busy'
  /** The request never reached YouTube. */
  | 'network'
  | 'other';

export class YouTubeApiError extends Error {
  readonly failure: YouTubeFailure;
  readonly status: number;
  /** The reason code from Google's error body, or '' when it gave none. */
  readonly reason: string;

  constructor(input: { failure: YouTubeFailure; status: number; reason: string; message: string }) {
    super(input.message);
    this.name = 'YouTubeApiError';
    this.failure = input.failure;
    this.status = input.status;
    this.reason = input.reason;
  }
}

/** One entry of a YouTube playlist. Removing a song needs the entry's id, not the video's. */
export interface YouTubePlaylistItem {
  itemId: string;
  videoId: string;
}

/** A video as a playlist or a search names it. */
export interface YouTubeVideoSummary {
  videoId: string;
  title: string;
  /** The channel that uploaded it. "Artist - Topic" is the upload YouTube Music plays. */
  channel: string;
}

export interface YouTubeApi {
  /** Creates a private playlist and returns its id. */
  createPlaylist(input: { title: string; description: string }): Promise<string>;
  /** The playlist's entries, first to last. */
  listPlaylistItems(playlistId: string): Promise<YouTubePlaylistItem[]>;
  /**
   * Adds the video. position is where it lands, counted from 0. Without one, YouTube puts
   * it where the playlist's own setting says, which is the end unless the owner changed it.
   */
  insertPlaylistItem(playlistId: string, videoId: string, position?: number): Promise<void>;
  /** Moves an entry so that it sits at position, counted from 0, once the move is done. */
  movePlaylistItem(input: {
    playlistId: string;
    itemId: string;
    videoId: string;
    position: number;
  }): Promise<void>;
  deletePlaylistItem(itemId: string): Promise<void>;
}

/**
 * The reads bulk matching and the 30-day check of saved matches use. A push needs none of
 * them, so they stay out of YouTubeApi.
 */
export interface YouTubeLookupApi {
  /**
   * The playlist's videos with their titles, first to last. Deleted and private videos are
   * left out. "LL" is the id of the signed-in account's liked videos.
   */
  listPlaylistVideos(playlistId: string): Promise<YouTubeVideoSummary[]>;
  /** Up to five music videos for the words, best first. One call costs 100 quota units. */
  searchVideos(query: string): Promise<YouTubeVideoSummary[]>;
  /**
   * Which of the videos YouTube still has. A deleted or private video is not among them.
   * Asks for 50 ids per call, 1 quota unit each.
   */
  listExistingVideoIds(videoIds: readonly string[]): Promise<Set<string>>;
}

/** The part of fetch this module uses, so a test can pass a plain function. */
export type YouTubeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const NO_CHANNEL_REASONS = new Set([
  'youtubeSignupRequired',
  'channelNotFound',
  'channelClosed',
  'channelSuspended',
]);
const QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded']);
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);
const API_DISABLED_REASONS = new Set(['accessNotConfigured', 'SERVICE_DISABLED']);
const SCOPE_REASONS = new Set(['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']);

/** Sorts a failed reply into a YouTubeFailure. The reason code decides before the status does. */
export function classifyYouTubeFailure(status: number, reason: string): YouTubeFailure {
  if (NO_CHANNEL_REASONS.has(reason)) return 'no-channel';
  if (QUOTA_REASONS.has(reason)) return 'quota';
  if (RATE_LIMIT_REASONS.has(reason)) return 'busy';
  if (API_DISABLED_REASONS.has(reason)) return 'api-disabled';
  if (SCOPE_REASONS.has(reason)) return 'auth';
  if (reason === 'playlistNotFound') return 'playlist-missing';
  if (reason === 'videoNotFound') return 'video-missing';
  if (reason === 'playlistItemNotFound') return 'item-missing';
  if (reason === 'playlistContainsMaximumNumberOfVideos') return 'playlist-full';
  if (reason === 'manualSortRequired') return 'not-manual-order';
  if (reason === 'invalidPlaylistItemPosition') return 'bad-position';
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 409 || status >= 500) return 'busy';
  return 'other';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Pulls the reason code and the message out of Google's error body, whatever shape it has. */
function readGoogleError(body: unknown): { reason: string; message: string } {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  if (!error) return { reason: '', message: '' };
  const first = Array.isArray(error.errors) ? error.errors.find(isRecord) : undefined;
  return {
    reason: (first ? stringField(first, 'reason') : null) ?? stringField(error, 'status') ?? '',
    message: stringField(error, 'message') ?? '',
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return null;
  }
}

function positionOf(row: Record<string, unknown>): number | null {
  if (!isRecord(row.snippet)) return null;
  const position = row.snippet.position;
  return typeof position === 'number' && Number.isInteger(position) && position >= 0
    ? position
    : null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** A search reply writes titles as HTML: "Guns N&#39; Roses". This turns them back into text. */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Sorts rows by the place each reports. One row without a place means the reply's order has to do. */
function inPlaylistOrder<T>(rows: readonly T[], positions: ReadonlyArray<number | null>): T[] {
  const placed: Array<{ row: T; position: number }> = [];
  for (const [index, row] of rows.entries()) {
    const position = positions[index];
    if (position === null || position === undefined) return [...rows];
    placed.push({ row, position });
  }
  return placed.sort((a, b) => a.position - b.position).map((entry) => entry.row);
}

function playlistTitle(title: string): string {
  const cleaned = title.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return (cleaned || 'CrateSync playlist').slice(0, TITLE_MAX_LENGTH);
}

export function createYouTubeApi(
  accessToken: string,
  fetchImpl: YouTubeFetch = fetch
): YouTubeApi & YouTubeLookupApi {
  async function call(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    query: Record<string, string>,
    body?: unknown
  ): Promise<unknown> {
    const url = new URL(`${API_BASE}/${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new YouTubeApiError({
        failure: 'network',
        status: 0,
        reason: '',
        message: err instanceof Error ? err.message : 'The request did not reach YouTube.',
      });
    }

    const payload = await readJson(response);
    if (response.ok) return payload;

    const { reason, message } = readGoogleError(payload);
    throw new YouTubeApiError({
      failure: classifyYouTubeFailure(response.status, reason),
      status: response.status,
      reason,
      message: message || `YouTube answered ${response.status}.`,
    });
  }

  return {
    async createPlaylist({ title, description }) {
      const payload = await call(
        'POST',
        'playlists',
        { part: 'snippet,status' },
        {
          snippet: {
            title: playlistTitle(title),
            description: description.slice(0, DESCRIPTION_MAX_LENGTH),
          },
          status: { privacyStatus: 'private' },
        }
      );
      const id = isRecord(payload) ? stringField(payload, 'id') : null;
      if (!id) {
        throw new YouTubeApiError({
          failure: 'other',
          status: 200,
          reason: '',
          message: 'YouTube created a playlist but did not say which one.',
        });
      }
      return id;
    },

    async listPlaylistItems(playlistId) {
      const items: YouTubePlaylistItem[] = [];
      const positions: Array<number | null> = [];
      let pageToken: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query: Record<string, string> = {
          part: 'snippet,contentDetails',
          fields: LIST_FIELDS,
          playlistId,
          maxResults: String(PAGE_SIZE),
        };
        if (pageToken) query.pageToken = pageToken;

        const payload = await call('GET', 'playlistItems', query);
        if (!isRecord(payload)) break;

        const rows = Array.isArray(payload.items) ? payload.items : [];
        for (const row of rows) {
          if (!isRecord(row) || !isRecord(row.contentDetails)) continue;
          const itemId = stringField(row, 'id');
          const videoId = stringField(row.contentDetails, 'videoId');
          if (!itemId || !videoId) continue;
          items.push({ itemId, videoId });
          positions.push(positionOf(row));
        }

        pageToken = stringField(payload, 'nextPageToken');
        if (!pageToken) break;
      }

      // YouTube's reference does not promise the order of the reply, so sort by the place
      // each entry reports.
      return inPlaylistOrder(items, positions);
    },

    async listPlaylistVideos(playlistId) {
      const videos: YouTubeVideoSummary[] = [];
      const positions: Array<number | null> = [];
      let pageToken: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query: Record<string, string> = {
          part: 'snippet,contentDetails',
          fields: VIDEO_LIST_FIELDS,
          playlistId,
          maxResults: String(PAGE_SIZE),
        };
        if (pageToken) query.pageToken = pageToken;

        const payload = await call('GET', 'playlistItems', query);
        if (!isRecord(payload)) break;

        const rows = Array.isArray(payload.items) ? payload.items : [];
        for (const row of rows) {
          if (!isRecord(row) || !isRecord(row.contentDetails) || !isRecord(row.snippet)) continue;
          const videoId = stringField(row.contentDetails, 'videoId');
          const title = stringField(row.snippet, 'title');
          // A deleted or private video keeps its entry but has no owner channel.
          const channel = stringField(row.snippet, 'videoOwnerChannelTitle');
          if (!videoId || !title || !channel) continue;
          videos.push({ videoId, title, channel });
          positions.push(positionOf(row));
        }

        pageToken = stringField(payload, 'nextPageToken');
        if (!pageToken) break;
      }
      return inPlaylistOrder(videos, positions);
    },

    async searchVideos(query) {
      const payload = await call('GET', 'search', {
        part: 'snippet',
        fields: SEARCH_FIELDS,
        type: 'video',
        videoCategoryId: MUSIC_CATEGORY_ID,
        maxResults: String(SEARCH_RESULT_COUNT),
        q: query,
      });
      const rows = isRecord(payload) && Array.isArray(payload.items) ? payload.items : [];
      const videos: YouTubeVideoSummary[] = [];
      for (const row of rows) {
        if (!isRecord(row) || !isRecord(row.id) || !isRecord(row.snippet)) continue;
        const videoId = stringField(row.id, 'videoId');
        const title = stringField(row.snippet, 'title');
        if (!videoId || !title) continue;
        videos.push({
          videoId,
          title: decodeHtmlEntities(title),
          channel: decodeHtmlEntities(stringField(row.snippet, 'channelTitle') ?? ''),
        });
      }
      return videos;
    },

    async listExistingVideoIds(videoIds) {
      const wanted = [...new Set(videoIds)];
      const existing = new Set<string>();
      for (let start = 0; start < wanted.length; start += PAGE_SIZE) {
        const payload = await call('GET', 'videos', {
          part: 'id',
          fields: 'items(id)',
          id: wanted.slice(start, start + PAGE_SIZE).join(','),
        });
        const rows = isRecord(payload) && Array.isArray(payload.items) ? payload.items : [];
        for (const row of rows) {
          const id = isRecord(row) ? stringField(row, 'id') : null;
          if (id) existing.add(id);
        }
      }
      return existing;
    },

    async insertPlaylistItem(playlistId, videoId, position) {
      const snippet = { playlistId, resourceId: { kind: 'youtube#video', videoId } };
      await call('POST', 'playlistItems', { part: 'snippet' }, {
        snippet: position === undefined ? snippet : { ...snippet, position },
      });
    },

    // The reference says an update deletes every snippet value the request leaves out, so
    // the body names the playlist and the video again next to the new position.
    async movePlaylistItem({ playlistId, itemId, videoId, position }) {
      await call('PUT', 'playlistItems', { part: 'snippet' }, {
        id: itemId,
        snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId }, position },
      });
    },

    async deletePlaylistItem(itemId) {
      await call('DELETE', 'playlistItems', { id: itemId });
    },
  };
}

/** One sentence for the person at the screen: what happened and what to do next. */
export function describeYouTubeFailure(failure: YouTubeFailure | 'cancelled'): string {
  switch (failure) {
    case 'auth':
      return 'YouTube no longer accepts the connection. Connect YouTube again and push once more.';
    case 'quota':
      return "YouTube's daily allowance for CrateSync is used up. It resets at midnight Pacific time. Push again after that and CrateSync sends what is left.";
    case 'api-disabled':
      return 'The YouTube Data API is switched off for the Google Cloud project behind CrateSync. Turn it on in the Google Cloud console, then push again.';
    case 'no-channel':
      return 'This Google account has no YouTube channel yet. Open YouTube once, create the channel, then push again.';
    case 'forbidden':
      return 'YouTube refused the change. The linked playlist probably belongs to another account. Connect the account that owns it, or clear the link so CrateSync creates a new playlist.';
    case 'playlist-missing':
      return 'YouTube cannot find the linked playlist under this account. Clear the link in the playlist details so CrateSync creates a new one, or connect the account that owns it.';
    case 'video-missing':
      return 'YouTube no longer has this video.';
    case 'item-missing':
      return 'The song was already gone from the YouTube playlist.';
    case 'playlist-full':
      return 'The YouTube playlist is full. YouTube allows 5,000 videos in one playlist.';
    case 'not-manual-order':
      return 'YouTube sorts this playlist by its own rule, so the songs cannot be put in order. Set the playlist to manual order on YouTube, then push again.';
    case 'bad-position':
      return 'The YouTube playlist changed while CrateSync was working. Push again to finish.';
    case 'busy':
      return 'YouTube was too busy to take the change. Push again in a minute.';
    case 'network':
      return 'CrateSync could not reach YouTube. Check the connection and push again.';
    case 'cancelled':
      return 'Stopped. Push again to send the rest.';
    case 'other':
      return 'YouTube refused the change.';
    default: {
      const _exhaustive: never = failure;
      return _exhaustive;
    }
  }
}
