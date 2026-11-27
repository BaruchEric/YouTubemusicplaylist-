/**
 * Pushing a CrateSync playlist to a YouTube playlist.
 *
 * A push makes the YouTube playlist hold every matched song of the CrateSync playlist, in
 * playlist order. It works in three passes:
 *
 * 1. Add each missing song at its place, right after the playlist song before it.
 * 2. Remove a song only when CrateSync added it in an earlier push and it has since left
 *    the playlist.
 * 3. Move the songs that are out of order. The longest run already in order stays put.
 *
 * Songs added on YouTube by hand stay and are never moved, though they shift when a playlist
 * song lands in front of them. Moving comes last, so a push that runs out of YouTube's daily
 * allowance has sent the songs before it spends anything on their order.
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
/** Creating a playlist, adding a song, moving a song and removing a song cost this much each. */
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

export interface YouTubeOrderPlan {
  /** Wanted songs on YouTube that are already in playlist order among themselves. */
  stays: string[];
  /** Wanted songs on YouTube that have to move, in playlist order. */
  moves: string[];
}

/**
 * Which of the wanted songs on YouTube have to move so that all of them sit in playlist
 * order. A move costs as much of YouTube's allowance as adding a song, so the longest run
 * that is already in order stays where it is and only the rest move. Songs the playlist does
 * not hold are looked past, and so is a second copy of a song.
 */
export function planYouTubeOrder(input: {
  wanted: readonly string[];
  /** The videos on the YouTube playlist, first to last. */
  remote: readonly string[];
}): YouTubeOrderPlan {
  const placeInPlaylist = new Map(input.wanted.map((videoId, index) => [videoId, index]));

  // The playlist places of the wanted songs, in the order YouTube has them.
  const onYouTube = new Set<string>();
  const places: number[] = [];
  for (const videoId of input.remote) {
    const place = placeInPlaylist.get(videoId);
    if (place === undefined || onYouTube.has(videoId)) continue;
    onYouTube.add(videoId);
    places.push(place);
  }

  // Longest increasing run of places. lastOfRun[n] is the index in places that ends the
  // run of n + 1 songs with the lowest last place, and before[i] is the song before i in
  // the run that ends at i.
  const lastOfRun: number[] = [];
  const before: number[] = [];
  for (const [index, place] of places.entries()) {
    let low = 0;
    let high = lastOfRun.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (places[lastOfRun[middle]] < place) low = middle + 1;
      else high = middle;
    }
    before[index] = low > 0 ? lastOfRun[low - 1] : -1;
    lastOfRun[low] = index;
  }

  const staying = new Set<number>();
  for (let index = lastOfRun.at(-1) ?? -1; index !== -1; index = before[index]) {
    staying.add(places[index]);
  }

  const stays: string[] = [];
  const moves: string[] = [];
  for (const [place, videoId] of input.wanted.entries()) {
    if (!onYouTube.has(videoId) || placeInPlaylist.get(videoId) !== place) continue;
    (staying.has(place) ? stays : moves).push(videoId);
  }
  return { stays, moves };
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
  /** Songs that changed place since the last push. 0 when no earlier push is on record. */
  moveCount: number;
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
  const moveCount = planYouTubeOrder({ wanted: videoIds, remote: pushed ?? [] }).moves.length;

  const writes = sendCount + removeCount + moveCount + (linkedPlaylistId ? 0 : 1);
  const quotaUnits = writes * YOUTUBE_WRITE_COST_UNITS;

  return {
    linkedPlaylistId,
    knowsWhatIsThere: pushed !== null,
    matchedCount: videoIds.length,
    sendCount,
    removeCount,
    moveCount,
    unmatchedCount,
    quotaUnits,
    days: Math.max(1, Math.ceil(quotaUnits / YOUTUBE_DAILY_QUOTA_UNITS)),
  };
}

export type YouTubePushProgress =
  | { step: 'reading' }
  | { step: 'creating' }
  | { step: 'adding'; done: number; total: number }
  | { step: 'removing'; done: number; total: number }
  | { step: 'ordering'; done: number; total: number };

/** Where the playlist's songs stand on YouTube when a push ends. */
export type YouTubeSongOrder =
  /** They sit in playlist order. */
  | { state: 'in-order' }
  /** left songs still have to move. The next push moves them. */
  | { state: 'out-of-order'; left: number }
  /** YouTube sorts the playlist by date or popularity, so the push could not place songs. */
  | { state: 'sorted-by-youtube' };

export interface YouTubePushOutcome {
  /** The YouTube playlist the push went to, and whether this push made it. Null when making it failed. */
  playlist: { id: string; created: boolean } | null;
  /** Videos added by this push. */
  inserted: string[];
  /** Videos removed by this push. */
  removed: string[];
  /** Videos this push moved to another place in the playlist. */
  moved: string[];
  order: YouTubeSongOrder;
  alreadyThere: number;
  leftAlone: number;
  /** Videos YouTube no longer has. The push skipped them. */
  unavailable: string[];
  /** Songs the push did not get to before it stopped. */
  notSent: number;
  /**
   * This playlist's videos that the YouTube playlist holds when the push ends, whether this
   * push added them or they were there before it.
   */
  onYouTube: string[];
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

/** One entry of the YouTube playlist as the push pictures it. A song this push added has no id yet. */
interface PicturedEntry {
  itemId: string | null;
  videoId: string;
}

function indexOfVideo(entries: readonly PicturedEntry[], videoId: string): number {
  return entries.findIndex((entry) => entry.videoId === videoId);
}

/**
 * Where a song belongs on the YouTube playlist: right after the nearest playlist song before
 * it that is already in place. With no such song it goes right before the nearest one after
 * it, and with none of those either it goes to the end.
 */
function placeFor(input: {
  entries: readonly PicturedEntry[];
  wanted: readonly string[];
  videoId: string;
  inPlace: ReadonlySet<string>;
}): number {
  const { entries, wanted, inPlace } = input;
  const at = wanted.indexOf(input.videoId);
  for (let index = at - 1; index >= 0; index--) {
    if (!inPlace.has(wanted[index])) continue;
    const found = indexOfVideo(entries, wanted[index]);
    if (found !== -1) return found + 1;
  }
  for (let index = at + 1; index < wanted.length; index++) {
    if (!inPlace.has(wanted[index])) continue;
    const found = indexOfVideo(entries, wanted[index]);
    if (found !== -1) return found;
  }
  return entries.length;
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
    moved: [],
    order: { state: 'in-order' },
    alreadyThere: 0,
    leftAlone: 0,
    unavailable: [],
    notSent: wanted.length,
    onYouTube: [],
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

  // The YouTube playlist as this push leaves it, entry by entry. Every write that goes
  // through is repeated here, so the place asked for in the next write is the right one.
  const entries: PicturedEntry[] = remote.map((entry) => ({ ...entry }));
  const orderPlan = planYouTubeOrder({ wanted, remote: remote.map((entry) => entry.videoId) });
  const inPlace = new Set(orderPlan.stays);
  // False from the moment YouTube refuses a place. The push then stops naming places.
  let placing = true;
  let sortedByYouTube = false;
  const refusedPlace = (failure: YouTubeFailure | null): boolean => {
    if (failure !== 'not-manual-order' && failure !== 'bad-position') return false;
    placing = false;
    if (failure === 'not-manual-order') sortedByYouTube = true;
    return true;
  };

  for (const videoId of plan.toInsert) {
    if (input.signal?.aborted) {
      outcome.stopped = stopFor('cancelled');
      break;
    }
    let place = placing ? placeFor({ entries, wanted, videoId, inPlace }) : null;
    let failure = await writeOnce(
      () => api.insertPlaylistItem(playlistId, videoId, place ?? undefined),
      wait
    );
    if (place !== null && refusedPlace(failure)) {
      place = null;
      failure = await writeOnce(() => api.insertPlaylistItem(playlistId, videoId), wait);
    }
    if (failure === 'video-missing') {
      outcome.unavailable.push(videoId);
    } else if (failure) {
      outcome.stopped = stopFor(failure);
      break;
    } else {
      outcome.inserted.push(videoId);
      if (place === null) {
        entries.push({ itemId: null, videoId });
      } else {
        entries.splice(place, 0, { itemId: null, videoId });
        inPlace.add(videoId);
      }
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
      const pictured = entries.findIndex((candidate) => candidate.itemId === entry.itemId);
      if (pictured !== -1) entries.splice(pictured, 1);
      if (!outcome.removed.includes(entry.videoId)) outcome.removed.push(entry.videoId);
      done++;
      report({ step: 'removing', done, total: plan.toDelete.length });
    }
  }

  if (!outcome.stopped && placing) {
    let done = 0;
    for (const videoId of orderPlan.moves) {
      if (input.signal?.aborted) {
        outcome.stopped = stopFor('cancelled');
        break;
      }
      const from = indexOfVideo(entries, videoId);
      const entry = entries[from];
      const itemId = entry?.itemId;
      if (!entry || !itemId) continue;

      // YouTube counts the new place with the entry already taken out, so take it out here too.
      entries.splice(from, 1);
      const place = placeFor({ entries, wanted, videoId, inPlace });
      const failure = await writeOnce(
        () => api.movePlaylistItem({ playlistId, itemId, videoId, position: place }),
        wait
      );
      if (failure === 'item-missing') {
        // Somebody removed it on YouTube since the read. The next push adds it again.
      } else if (failure) {
        entries.splice(from, 0, entry);
        if (!refusedPlace(failure)) outcome.stopped = stopFor(failure);
        break;
      } else {
        entries.splice(place, 0, entry);
        inPlace.add(videoId);
        outcome.moved.push(videoId);
      }
      done++;
      report({ step: 'ordering', done, total: orderPlan.moves.length });
    }
  }

  const videosNow = entries.map((entry) => entry.videoId);
  const wantedVideos = new Set(wanted);
  outcome.onYouTube = [...new Set(videosNow.filter((videoId) => wantedVideos.has(videoId)))];
  const left = planYouTubeOrder({ wanted, remote: videosNow }).moves.length;
  if (sortedByYouTube) outcome.order = { state: 'sorted-by-youtube' };
  else if (left > 0) outcome.order = { state: 'out-of-order', left };

  // What CrateSync has put on the playlist and is still there, in the order YouTube has it:
  // the earlier pushes that YouTube still holds, minus what this push removed, plus what it
  // added. The next estimate reads the order from here.
  const remoteVideos = new Set(remote.map((entry) => entry.videoId));
  const removed = new Set(outcome.removed);
  const pushedAndThere = new Set([
    ...previouslyPushed.filter((videoId) => remoteVideos.has(videoId) && !removed.has(videoId)),
    ...outcome.inserted,
  ]);
  outcome.record = {
    playlistId,
    videoIds: [...new Set(videosNow.filter((videoId) => pushedAndThere.has(videoId)))],
    pushedAt: now,
  };
  return outcome;
}

/**
 * The playlist's record of what is synced, after a push. A song YouTube now holds counts as
 * synced, and so does a song Apply Sync recorded earlier. A removal that was pending is done
 * once the push finishes. A push that stopped keeps the removals it did not get to.
 */
function syncedAfterPush(
  playlist: Playlist,
  outcome: YouTubePushOutcome,
  library: ReadonlyMap<string, LocalTrack>
): string[] {
  const onYouTube = new Set(outcome.onYouTube);
  const removed = new Set(outcome.removed);
  const videoOf = (trackId: string) => library.get(trackId)?.youtubeVideoId ?? null;
  const holds = (videos: ReadonlySet<string>, trackId: string) => {
    const videoId = videoOf(trackId);
    return videoId !== null && videos.has(videoId);
  };

  const wasSynced = new Set(playlist.syncedTrackIds);
  const inPlaylist = new Set(playlist.trackIds);
  const synced = playlist.trackIds.filter((id) => wasSynced.has(id) || holds(onYouTube, id));
  if (!outcome.stopped) return synced;

  const removalsLeft = playlist.syncedTrackIds.filter(
    (id) => !inPlaylist.has(id) && !holds(removed, id)
  );
  return [...synced, ...removalsLeft];
}

/**
 * The playlist as it is stored after a push: linked to the YouTube playlist the push created,
 * carrying the record of what CrateSync has put there, and with the songs YouTube now holds
 * marked as synced. `library` is every track by id. A push that never reached a YouTube
 * playlist changes nothing.
 */
export function playlistAfterPush(
  playlist: Playlist,
  outcome: YouTubePushOutcome,
  now: number,
  library: ReadonlyMap<string, LocalTrack>
): Playlist {
  if (!outcome.record) return playlist;
  return {
    ...playlist,
    youtubePlaylistUrl: outcome.playlist?.created
      ? buildYouTubeMusicPlaylistUrl(outcome.playlist.id)
      : playlist.youtubePlaylistUrl,
    youtubePush: outcome.record,
    syncedTrackIds: syncedAfterPush(playlist, outcome, library),
    lastSyncedAt: outcome.stopped ? playlist.lastSyncedAt : now,
    updatedAt: now,
  };
}

function count(n: number, singular: string): string {
  return `${n} ${singular}${n === 1 ? '' : 's'}`;
}

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The push in one or two sentences, for the result screen and the sync history. */
export function describeYouTubePush(outcome: YouTubePushOutcome): string {
  const parts: string[] = [];
  if (outcome.inserted.length > 0) parts.push(`added ${count(outcome.inserted.length, 'song')}`);
  if (outcome.removed.length > 0) parts.push(`removed ${count(outcome.removed.length, 'song')}`);
  if (outcome.moved.length > 0) parts.push(`moved ${count(outcome.moved.length, 'song')}`);

  let text: string;
  if (parts.length > 0) {
    const joined = listed(parts);
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
  if (outcome.order.state === 'out-of-order') {
    text += ` ${count(outcome.order.left, 'song')} still to move.`;
  }
  return text;
}
