/**
 * Pushing a CrateSync playlist to a YouTube playlist.
 *
 * A push makes the YouTube playlist hold every matched song of the CrateSync playlist. It
 * adds what is missing at the end, in playlist order, and removes a song only when CrateSync
 * added it in an earlier push and it has since left the playlist. Songs added on YouTube by
 * hand stay. The order of songs already on YouTube is not changed.
 *
 * Every push reads the YouTube playlist first and sends only the difference, so a push that
 * stopped at the daily allowance continues from where it stopped the next day.
 */
import type { LocalTrack, Playlist, YouTubePushRecord } from '../types/music';
import {
  YouTubeApiError,
  describeYouTubeFailure,
  type YouTubeApi,
  type YouTubeFailure,
  type YouTubePlaylistItem,
} from './youtubeApi';
import { buildYouTubeMusicPlaylistUrl, extractYouTubePlaylistId } from './youtubeLinks';

export const YOUTUBE_DAILY_QUOTA_UNITS = 10_000;
/** Creating a playlist, adding a song and removing a song cost this much each. */
export const YOUTUBE_WRITE_COST_UNITS = 50;
const BUSY_RETRY_DELAY_MS = 2_000;

type PushablePlaylist = Pick<Playlist, 'name' | 'description' | 'youtubePlaylistUrl' | 'youtubePush'>;

/** The YouTube videos a playlist's songs are matched to, in playlist order, each once. */
export function playlistVideoIds(tracks: readonly LocalTrack[]): {
  videoIds: string[];
  unmatchedCount: number;
} {
  const seen = new Set<string>();
  let unmatchedCount = 0;
  for (const track of tracks) {
    if (track.youtubeVideoId) seen.add(track.youtubeVideoId);
    else unmatchedCount++;
  }
  return { videoIds: [...seen], unmatchedCount };
}

export interface YouTubePushPlan {
  /** Videos to add, in playlist order. */
  toInsert: string[];
  /** Entries to remove: songs CrateSync pushed earlier that the playlist no longer holds. */
  toDelete: YouTubePlaylistItem[];
  /** Wanted songs YouTube already has. */
  alreadyThere: number;
  /** Songs on YouTube that the playlist does not hold and CrateSync did not add. They stay. */
  leftAlone: number;
}

export function planYouTubePush(input: {
  wanted: readonly string[];
  remote: readonly YouTubePlaylistItem[];
  previouslyPushed: readonly string[];
}): YouTubePushPlan {
  const wanted = new Set(input.wanted);
  const pushed = new Set(input.previouslyPushed);
  const remoteVideos = new Set(input.remote.map((entry) => entry.videoId));

  const unwanted = input.remote.filter((entry) => !wanted.has(entry.videoId));
  const toDelete = unwanted.filter((entry) => pushed.has(entry.videoId));
  const toInsert = input.wanted.filter((videoId) => !remoteVideos.has(videoId));

  return {
    toInsert,
    toDelete,
    alreadyThere: input.wanted.length - toInsert.length,
    leftAlone: new Set(unwanted.filter((entry) => !pushed.has(entry.videoId)).map((e) => e.videoId))
      .size,
  };
}

/** The record of earlier pushes, when it is about the playlist that is linked now. */
function pushedTo(playlist: PushablePlaylist, linkedPlaylistId: string | null): string[] | null {
  const record = playlist.youtubePush;
  if (!record || !linkedPlaylistId || record.playlistId !== linkedPlaylistId) return null;
  return record.videoIds;
}

export interface YouTubePushEstimate {
  /** The linked YouTube playlist, or null when the push will create one. */
  linkedPlaylistId: string | null;
  /**
   * True when an earlier push recorded what is on the linked playlist. When false, sendCount
   * is every matched song, and the push skips the ones YouTube turns out to have.
   */
  knowsWhatIsThere: boolean;
  /** Songs of the playlist that have a YouTube match, each video once. */
  matchedCount: number;
  sendCount: number;
  removeCount: number;
  unmatchedCount: number;
  quotaUnits: number;
  /** How many days of YouTube's allowance the push needs. 1 means it fits in one go. */
  days: number;
}

/** What a push will do, worked out from this device alone, before anybody signs in. */
export function estimateYouTubePush(
  playlist: PushablePlaylist,
  tracks: readonly LocalTrack[]
): YouTubePushEstimate {
  const { videoIds, unmatchedCount } = playlistVideoIds(tracks);
  const linkedPlaylistId = extractYouTubePlaylistId(playlist.youtubePlaylistUrl);
  const pushed = pushedTo(playlist, linkedPlaylistId);

  const pushedSet = new Set(pushed ?? []);
  const wantedSet = new Set(videoIds);
  const sendCount = videoIds.filter((videoId) => !pushedSet.has(videoId)).length;
  const removeCount = (pushed ?? []).filter((videoId) => !wantedSet.has(videoId)).length;

  const writes = sendCount + removeCount + (linkedPlaylistId ? 0 : 1);
  const quotaUnits = writes * YOUTUBE_WRITE_COST_UNITS;

  return {
    linkedPlaylistId,
    knowsWhatIsThere: pushed !== null,
    matchedCount: videoIds.length,
    sendCount,
    removeCount,
    unmatchedCount,
    quotaUnits,
    days: Math.max(1, Math.ceil(quotaUnits / YOUTUBE_DAILY_QUOTA_UNITS)),
  };
}

export type YouTubePushProgress =
  | { step: 'reading' }
  | { step: 'creating' }
  | { step: 'adding'; done: number; total: number }
  | { step: 'removing'; done: number; total: number };

export interface YouTubePushOutcome {
  /** The YouTube playlist the push went to, and whether this push made it. Null when making it failed. */
  playlist: { id: string; created: boolean } | null;
  /** Videos added by this push. */
  inserted: string[];
  /** Videos removed by this push. */
  removed: string[];
  alreadyThere: number;
  leftAlone: number;
  /** Videos YouTube no longer has. The push skipped them. */
  unavailable: string[];
  /** Songs the push did not get to before it stopped. */
  notSent: number;
  /** Why the push ended early, or null when it finished. */
  stopped: { failure: YouTubeFailure | 'cancelled'; message: string } | null;
  /** The record to store on the playlist. Null means leave the stored one as it is. */
  record: YouTubePushRecord | null;
}

function stopFor(failure: YouTubeFailure | 'cancelled'): NonNullable<YouTubePushOutcome['stopped']> {
  return { failure, message: describeYouTubeFailure(failure) };
}

function failureOf(err: unknown): YouTubeFailure {
  return err instanceof YouTubeApiError ? err.failure : 'other';
}

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Runs one write, and runs it once more after a pause when YouTube says it is busy.
 * Returns the failure of the last try, or null when the write went through.
 */
async function writeOnce(
  write: () => Promise<void>,
  wait: (ms: number) => Promise<void>
): Promise<YouTubeFailure | null> {
  try {
    await write();
    return null;
  } catch (err) {
    if (failureOf(err) !== 'busy') return failureOf(err);
  }
  await wait(BUSY_RETRY_DELAY_MS);
  try {
    await write();
    return null;
  } catch (err) {
    return failureOf(err);
  }
}

export async function pushPlaylistToYouTube(input: {
  api: YouTubeApi;
  playlist: PushablePlaylist;
  /** The playlist's songs, in playlist order. */
  tracks: readonly LocalTrack[];
  now: number;
  onProgress?: (progress: YouTubePushProgress) => void;
  /** Aborting stops the push before the next song. */
  signal?: AbortSignal;
  wait?: (ms: number) => Promise<void>;
}): Promise<YouTubePushOutcome> {
  const { api, playlist, now } = input;
  const report = input.onProgress ?? (() => {});
  const wait = input.wait ?? defaultWait;
  const { videoIds: wanted } = playlistVideoIds(input.tracks);
  const linkedPlaylistId = extractYouTubePlaylistId(playlist.youtubePlaylistUrl);

  const outcome: YouTubePushOutcome = {
    playlist: linkedPlaylistId ? { id: linkedPlaylistId, created: false } : null,
    inserted: [],
    removed: [],
    alreadyThere: 0,
    leftAlone: 0,
    unavailable: [],
    notSent: wanted.length,
    stopped: null,
    record: null,
  };

  let playlistId: string;
  let remote: YouTubePlaylistItem[] = [];
  try {
    if (linkedPlaylistId) {
      report({ step: 'reading' });
      remote = await api.listPlaylistItems(linkedPlaylistId);
      playlistId = linkedPlaylistId;
    } else {
      report({ step: 'creating' });
      playlistId = await api.createPlaylist({
        title: playlist.name,
        description: playlist.description,
      });
      outcome.playlist = { id: playlistId, created: true };
    }
  } catch (err) {
    outcome.stopped = stopFor(failureOf(err));
    return outcome;
  }

  const previouslyPushed = pushedTo(playlist, linkedPlaylistId) ?? [];
  const plan = planYouTubePush({ wanted, remote, previouslyPushed });
  outcome.alreadyThere = plan.alreadyThere;
  outcome.leftAlone = plan.leftAlone;
  outcome.notSent = plan.toInsert.length;

  for (const videoId of plan.toInsert) {
    if (input.signal?.aborted) {
      outcome.stopped = stopFor('cancelled');
      break;
    }
    const failure = await writeOnce(() => api.insertPlaylistItem(playlistId, videoId), wait);
    if (failure === 'video-missing') {
      outcome.unavailable.push(videoId);
    } else if (failure) {
      outcome.stopped = stopFor(failure);
      break;
    } else {
      outcome.inserted.push(videoId);
    }
    outcome.notSent--;
    report({
      step: 'adding',
      done: outcome.inserted.length + outcome.unavailable.length,
      total: plan.toInsert.length,
    });
  }

  if (!outcome.stopped) {
    let done = 0;
    for (const entry of plan.toDelete) {
      if (input.signal?.aborted) {
        outcome.stopped = stopFor('cancelled');
        break;
      }
      const failure = await writeOnce(() => api.deletePlaylistItem(entry.itemId), wait);
      if (failure && failure !== 'item-missing') {
        outcome.stopped = stopFor(failure);
        break;
      }
      if (!outcome.removed.includes(entry.videoId)) outcome.removed.push(entry.videoId);
      done++;
      report({ step: 'removing', done, total: plan.toDelete.length });
    }
  }

  // What CrateSync has put on the playlist and is still there: the earlier pushes that
  // YouTube still holds, minus what this push removed, plus what it added.
  const remoteVideos = new Set(remote.map((entry) => entry.videoId));
  const removed = new Set(outcome.removed);
  const kept = previouslyPushed.filter(
    (videoId) => remoteVideos.has(videoId) && !removed.has(videoId)
  );
  outcome.record = {
    playlistId,
    videoIds: [...new Set([...kept, ...outcome.inserted])],
    pushedAt: now,
  };
  return outcome;
}

/**
 * The playlist as it is stored after a push: linked to the YouTube playlist the push created,
 * and carrying the record of what CrateSync has put there. A push that never reached a
 * YouTube playlist changes nothing.
 */
export function playlistAfterPush(
  playlist: Playlist,
  outcome: YouTubePushOutcome,
  now: number
): Playlist {
  if (!outcome.record) return playlist;
  return {
    ...playlist,
    youtubePlaylistUrl: outcome.playlist?.created
      ? buildYouTubeMusicPlaylistUrl(outcome.playlist.id)
      : playlist.youtubePlaylistUrl,
    youtubePush: outcome.record,
    updatedAt: now,
  };
}

function count(n: number, singular: string): string {
  return `${n} ${singular}${n === 1 ? '' : 's'}`;
}

/** The push in one or two sentences, for the result screen and the sync history. */
export function describeYouTubePush(outcome: YouTubePushOutcome): string {
  const parts: string[] = [];
  if (outcome.inserted.length > 0) parts.push(`added ${count(outcome.inserted.length, 'song')}`);
  if (outcome.removed.length > 0) parts.push(`removed ${count(outcome.removed.length, 'song')}`);

  let text: string;
  if (parts.length > 0) {
    const joined = parts.join(' and ');
    text = `${joined.charAt(0).toUpperCase()}${joined.slice(1)} on YouTube.`;
  } else if (outcome.stopped) {
    text = 'Nothing changed on YouTube.';
  } else {
    text = 'YouTube already had every matched song.';
  }

  if (outcome.unavailable.length > 0) {
    text += ` YouTube no longer has ${count(outcome.unavailable.length, 'video')}, so ${
      outcome.unavailable.length === 1 ? 'it was' : 'they were'
    } skipped.`;
  }
  if (outcome.stopped && outcome.notSent > 0) {
    text += ` ${count(outcome.notSent, 'song')} still to send.`;
  }
  return text;
}
