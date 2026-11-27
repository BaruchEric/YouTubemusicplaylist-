/**
 * The 30-day check of saved matches. YouTube's developer policy lets an app keep data from
 * the API for 30 days, after which the app has to ask again or delete it. A song's match
 * is a video ID, so CrateSync asks YouTube whether each saved video still exists and clears
 * the match of a song whose video is gone.
 *
 * The check runs when CrateSync holds a YouTube token anyway: at the start of a push and of
 * a search or playlist read in Match YouTube. It costs 1 quota unit for every 50 videos.
 */
import type { LocalTrack } from '../types/music';
import { YouTubeApiError, type YouTubeFailure, type YouTubeLookupApi } from './youtubeApi';

export const MATCH_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

export interface MatchRefreshOutcome {
  /** Videos YouTube still has. */
  confirmed: ReadonlySet<string>;
  /** Videos YouTube no longer has: deleted, or made private. */
  gone: ReadonlySet<string>;
  /** Why YouTube refused the check, or null when it answered. A refused check changes nothing. */
  failure: YouTubeFailure | null;
}

/** The matched songs whose video YouTube has not confirmed in the last 30 days. */
export function matchesDueForRefresh(tracks: readonly LocalTrack[], now: number): LocalTrack[] {
  return tracks.filter((track) => {
    if (!track.youtubeVideoId) return false;
    const checked = track.youtubeChecked;
    if (!checked || checked.videoId !== track.youtubeVideoId) return true;
    return now - checked.at >= MATCH_REFRESH_MS;
  });
}

/** Asks YouTube which of the due videos it still has. Never throws. */
export async function refreshMatches(input: {
  api: Pick<YouTubeLookupApi, 'listExistingVideoIds'>;
  tracks: readonly LocalTrack[];
  now: number;
}): Promise<MatchRefreshOutcome> {
  const due = new Set<string>();
  for (const track of matchesDueForRefresh(input.tracks, input.now)) {
    if (track.youtubeVideoId) due.add(track.youtubeVideoId);
  }
  if (due.size === 0) return { confirmed: new Set(), gone: new Set(), failure: null };

  try {
    const confirmed = await input.api.listExistingVideoIds([...due]);
    const gone = new Set([...due].filter((videoId) => !confirmed.has(videoId)));
    return { confirmed, gone, failure: null };
  } catch (err) {
    return {
      confirmed: new Set(),
      gone: new Set(),
      failure: err instanceof YouTubeApiError ? err.failure : 'other',
    };
  }
}

/**
 * The library after a check: a confirmed song carries the time of the check, and a song
 * whose video is gone is unmatched again. Returns the same array when nothing changed.
 */
export function applyMatchRefresh(
  tracks: LocalTrack[],
  outcome: MatchRefreshOutcome,
  now: number
): { tracks: LocalTrack[]; clearedCount: number } {
  if (outcome.confirmed.size === 0 && outcome.gone.size === 0) return { tracks, clearedCount: 0 };

  let clearedCount = 0;
  let changed = false;
  const next = tracks.map((track) => {
    const videoId = track.youtubeVideoId;
    if (!videoId) return track;
    if (outcome.gone.has(videoId)) {
      clearedCount += 1;
      changed = true;
      const { youtubeChecked: _dropped, ...rest } = track;
      const cleared: LocalTrack = {
        ...rest,
        youtubeVideoId: null,
        youtubeTitle: null,
        matchStatus: 'unmatched',
      };
      return cleared;
    }
    if (outcome.confirmed.has(videoId)) {
      changed = true;
      return { ...track, youtubeChecked: { videoId, at: now } };
    }
    return track;
  });
  return { tracks: changed ? next : tracks, clearedCount };
}

/** What to tell the user after a check cleared matches. */
export function describeClearedMatches(count: number): string {
  return count === 1
    ? 'YouTube no longer has the video of 1 song, so that song is unmatched again.'
    : `YouTube no longer has the videos of ${count} songs, so those songs are unmatched again.`;
}
