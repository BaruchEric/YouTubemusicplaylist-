import type {
  LibraryTombstone,
  LocalTrack,
  Playlist,
  SmartPlaylist,
  SyncEvent,
} from '../types/music';

/** The part of a library that devices share through the Drive manifest. */
export interface LibrarySnapshot {
  tracks: LocalTrack[];
  playlists: Playlist[];
  smartPlaylists: SmartPlaylist[];
  syncHistory: SyncEvent[];
  tombstones: LibraryTombstone[];
}

const TOMBSTONE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const SYNC_HISTORY_LIMIT = 50;

type TrackEdits = Pick<
  LocalTrack,
  | 'title'
  | 'artist'
  | 'album'
  | 'genre'
  | 'year'
  | 'trackNumber'
  | 'youtubeVideoId'
  | 'youtubeTitle'
  | 'matchStatus'
>;

/** What a user edits on a song. The rest of a track is this device's view of the file. */
function editsOf(track: LocalTrack): TrackEdits {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    genre: track.genre,
    year: track.year,
    trackNumber: track.trackNumber,
    youtubeVideoId: track.youtubeVideoId,
    youtubeTitle: track.youtubeTitle,
    matchStatus: track.matchStatus,
  };
}

function sameEdits(a: LocalTrack, b: LocalTrack): boolean {
  return (
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.genre === b.genre &&
    a.year === b.year &&
    a.trackNumber === b.trackNumber &&
    a.youtubeVideoId === b.youtubeVideoId &&
    a.youtubeTitle === b.youtubeTitle &&
    a.matchStatus === b.matchStatus
  );
}

/**
 * Sets updatedAt on every track whose tags or YouTube match differ from the previous state.
 * An update that set updatedAt itself, such as an edit pulled from Drive, keeps its own time.
 */
export function stampEditedTracks(
  prev: readonly LocalTrack[],
  next: LocalTrack[],
  now: number
): LocalTrack[] {
  if (prev.length === 0) return next;
  const prevById = new Map(prev.map((track) => [track.id, track]));
  let stampedAny = false;
  const stamped = next.map((track) => {
    const before = prevById.get(track.id);
    if (!before || before === track) return track;
    if (before.updatedAt !== track.updatedAt) return track;
    if (sameEdits(before, track)) return track;
    stampedAny = true;
    return { ...track, updatedAt: now };
  });
  return stampedAny ? stamped : next;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function samePlaylistContent(a: Playlist, b: Playlist): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.youtubePlaylistUrl === b.youtubePlaylistUrl &&
    a.watchedFolderName === b.watchedFolderName &&
    a.lastSyncedAt === b.lastSyncedAt &&
    a.syncRule.autoAddNewFiles === b.syncRule.autoAddNewFiles &&
    a.syncRule.removeMissingFiles === b.syncRule.removeMissingFiles &&
    a.syncRule.folderFilter === b.syncRule.folderFilter &&
    sameIds(a.trackIds, b.trackIds) &&
    sameIds(a.syncedTrackIds, b.syncedTrackIds)
  );
}

/** Sets updatedAt on every playlist that changed without the update giving it a new time. */
export function stampEditedPlaylists(
  prev: readonly Playlist[],
  next: Playlist[],
  now: number
): Playlist[] {
  if (prev.length === 0) return next;
  const prevById = new Map(prev.map((playlist) => [playlist.id, playlist]));
  let stampedAny = false;
  const stamped = next.map((playlist) => {
    const before = prevById.get(playlist.id);
    if (!before || before === playlist) return playlist;
    if (before.updatedAt !== playlist.updatedAt) return playlist;
    if (samePlaylistContent(before, playlist)) return playlist;
    stampedAny = true;
    return { ...playlist, updatedAt: now };
  });
  return stampedAny ? stamped : next;
}

export function trackTombstone(track: LocalTrack, deletedAt: number): LibraryTombstone {
  return {
    kind: 'track',
    id: track.id,
    fileKey: track.fileKey,
    driveFileId: track.driveFileId ?? null,
    deletedAt,
  };
}

/** Joins tombstone lists, keeping the latest deletion of each record and none older than a year. */
export function mergeLibraryTombstones(
  lists: ReadonlyArray<readonly LibraryTombstone[] | undefined>,
  now: number
): LibraryTombstone[] {
  const latest = new Map<string, LibraryTombstone>();
  for (const list of lists) {
    for (const tombstone of list ?? []) {
      if (now - tombstone.deletedAt > TOMBSTONE_MAX_AGE_MS) continue;
      const key = `${tombstone.kind}:${tombstone.id}`;
      const known = latest.get(key);
      if (!known || tombstone.deletedAt > known.deletedAt) latest.set(key, tombstone);
    }
  }
  return [...latest.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Reads tombstones out of a manifest or saved state, dropping anything malformed. */
export function parseLibraryTombstones(raw: unknown): LibraryTombstone[] {
  if (!Array.isArray(raw)) return [];
  const parsed: LibraryTombstone[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { kind, id, deletedAt, fileKey, driveFileId } = entry;
    if (typeof id !== 'string' || typeof deletedAt !== 'number') continue;
    if (kind === 'playlist' || kind === 'smart-playlist') {
      parsed.push({ kind, id, deletedAt });
    } else if (kind === 'track' && typeof fileKey === 'string') {
      parsed.push({
        kind,
        id,
        fileKey,
        driveFileId: typeof driveFileId === 'string' ? driveFileId : null,
        deletedAt,
      });
    }
  }
  return parsed;
}

/**
 * Merges two lists of records that share IDs. A record both sides have is taken from the side
 * that changed it last. Records only the remote side has come first.
 */
export function newestWins<T extends { id: string; updatedAt: number }>(
  local: readonly T[],
  remote: readonly T[],
  onTie: 'local' | 'remote'
): T[] {
  const localIds = new Set(local.map((record) => record.id));
  const remoteById = new Map(remote.map((record) => [record.id, record]));
  const remoteOnly = remote.filter((record) => !localIds.has(record.id));
  const merged = local.map((mine) => {
    const theirs = remoteById.get(mine.id);
    if (!theirs) return mine;
    if (theirs.updatedAt > mine.updatedAt) return theirs;
    return theirs.updatedAt === mine.updatedAt && onTie === 'remote' ? theirs : mine;
  });
  return [...remoteOnly, ...merged];
}

/**
 * Settles one song both sides have. The side with the newer edit gives the tags and the YouTube
 * match. Everything else stays local, because it describes the file on this device.
 */
export function mergeTrackEdits(
  local: LocalTrack,
  remote: LocalTrack,
  onTie: 'local' | 'remote'
): LocalTrack {
  if (!remoteEditWins(local, remote, onTie)) return local;
  return { ...local, ...editsOf(remote), updatedAt: remote.updatedAt };
}

function remoteEditWins(local: LocalTrack, remote: LocalTrack, onTie: 'local' | 'remote'): boolean {
  const localAt = local.updatedAt ?? 0;
  const remoteAt = remote.updatedAt ?? 0;
  return remoteAt > localAt || (remoteAt === localAt && onTie === 'remote');
}

/** The tags, YouTube match and edit time of whichever side edited the song last. */
export function newerTrackEdits(
  local: LocalTrack,
  remote: LocalTrack,
  onTie: 'local' | 'remote'
): TrackEdits & Pick<LocalTrack, 'updatedAt'> {
  const winner = remoteEditWins(local, remote, onTie) ? remote : local;
  return { ...editsOf(winner), updatedAt: winner.updatedAt };
}

/** A song counts as changed when it was edited or when it (re)entered the library. */
function trackClock(track: LocalTrack): number {
  return Math.max(track.updatedAt ?? 0, track.addedAt);
}

interface TombstoneIndex {
  /** When a song was deleted, or undefined when no tombstone matches it. */
  trackDeletedAt: (track: LocalTrack) => number | undefined;
  isDeleted: (kind: 'playlist' | 'smart-playlist', record: { id: string; updatedAt: number }) => boolean;
}

function indexTombstones(tombstones: readonly LibraryTombstone[]): TombstoneIndex {
  const trackById = new Map<string, number>();
  const trackByDriveId = new Map<string, number>();
  const trackByFileKey = new Map<string, number>();
  const others = new Map<string, number>();
  const keepLatest = (map: Map<string, number>, key: string, deletedAt: number) => {
    const known = map.get(key);
    if (known === undefined || deletedAt > known) map.set(key, deletedAt);
  };
  for (const tombstone of tombstones) {
    if (tombstone.kind === 'track') {
      keepLatest(trackById, tombstone.id, tombstone.deletedAt);
      keepLatest(trackByFileKey, tombstone.fileKey.toLowerCase(), tombstone.deletedAt);
      if (tombstone.driveFileId) {
        keepLatest(trackByDriveId, tombstone.driveFileId, tombstone.deletedAt);
      }
    } else {
      keepLatest(others, `${tombstone.kind}:${tombstone.id}`, tombstone.deletedAt);
    }
  }
  return {
    trackDeletedAt: (track) => {
      const matches = [
        trackById.get(track.id),
        track.driveFileId ? trackByDriveId.get(track.driveFileId) : undefined,
        trackByFileKey.get(track.fileKey.toLowerCase()),
      ].filter((at): at is number => at !== undefined);
      return matches.length > 0 ? Math.max(...matches) : undefined;
    },
    isDeleted: (kind, record) => {
      const deletedAt = others.get(`${kind}:${record.id}`);
      return deletedAt !== undefined && deletedAt >= record.updatedAt;
    },
  };
}

function isTrackDeleted(index: TombstoneIndex, track: LocalTrack): boolean {
  const deletedAt = index.trackDeletedAt(track);
  return deletedAt !== undefined && deletedAt >= trackClock(track);
}

/** Finds the local song that is the same file as a remote one, the way a pull does. */
function buildTrackMatcher(local: readonly LocalTrack[]): (remote: LocalTrack) => LocalTrack | undefined {
  const byDriveId = new Map<string, LocalTrack>();
  const byId = new Map<string, LocalTrack>();
  const byFileKey = new Map<string, LocalTrack>();
  const byNameSize = new Map<string, LocalTrack>();
  for (const track of local) {
    if (track.driveFileId) byDriveId.set(track.driveFileId, track);
    byId.set(track.id, track);
    byFileKey.set(track.fileKey.toLowerCase(), track);
    if (track.fileSize > 0) {
      byNameSize.set(`${track.fileName.toLowerCase()}::${track.fileSize}`, track);
    }
  }
  return (remote) =>
    (remote.driveFileId ? byDriveId.get(remote.driveFileId) : undefined) ??
    byId.get(remote.id) ??
    byFileKey.get(remote.fileKey.toLowerCase()) ??
    (remote.fileSize > 0
      ? byNameSize.get(`${remote.fileName.toLowerCase()}::${remote.fileSize}`)
      : undefined);
}

function uniqueKnownIds(ids: readonly string[], known: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Builds the library a push writes to Drive: this device's library joined with what Drive
 * already holds, so a push never drops what another device pushed.
 *
 * - A song or playlist only Drive has is kept, unless a newer tombstone says it was deleted.
 * - A record both sides have is settled by the newer edit. This device wins a tie.
 * - A deleted song stays in the manifest only while the pushing device holds its audio, and
 *   then with a fresh updatedAt, so the deletion stops applying to it everywhere.
 */
export function mergeLibraryForPush(input: {
  local: LibrarySnapshot;
  remote: LibrarySnapshot | null;
  holdsAudio: (track: LocalTrack) => boolean;
  now: number;
}): {
  library: LibrarySnapshot;
  carriedOver: { tracks: number; playlists: number; smartPlaylists: number };
  /** Local songs a deletion covered that stay because this device holds their audio. */
  revivedTrackIds: string[];
} {
  const { local, remote, holdsAudio, now } = input;
  if (!remote) {
    return {
      library: {
        ...local,
        syncHistory: local.syncHistory.slice(0, SYNC_HISTORY_LIMIT),
        tombstones: mergeLibraryTombstones([local.tombstones], now),
      },
      carriedOver: { tracks: 0, playlists: 0, smartPlaylists: 0 },
      revivedTrackIds: [],
    };
  }

  const tombstones = mergeLibraryTombstones([local.tombstones, remote.tombstones], now);
  const deleted = indexTombstones(tombstones);

  // Songs. A remote song that is the same file as a local one takes the local ID.
  const findLocal = buildTrackMatcher(local.tracks);
  const remoteTwinByLocalId = new Map<string, LocalTrack>();
  const mergedIdByRemoteId = new Map<string, string>();
  const carriedTracks: LocalTrack[] = [];
  for (const theirs of remote.tracks) {
    const mine = findLocal(theirs);
    if (mine) {
      mergedIdByRemoteId.set(theirs.id, mine.id);
      if (!remoteTwinByLocalId.has(mine.id)) remoteTwinByLocalId.set(mine.id, theirs);
    } else if (!isTrackDeleted(deleted, theirs)) {
      mergedIdByRemoteId.set(theirs.id, theirs.id);
      carriedTracks.push(theirs);
    }
  }

  const keptLocalTracks: LocalTrack[] = [];
  const revivedTrackIds: string[] = [];
  for (const mine of local.tracks) {
    const theirs = remoteTwinByLocalId.get(mine.id);
    const settled = theirs ? mergeTrackEdits(mine, theirs, 'local') : mine;
    if (!isTrackDeleted(deleted, settled)) {
      keptLocalTracks.push(settled);
    } else if (holdsAudio(mine)) {
      keptLocalTracks.push({ ...settled, updatedAt: now });
      revivedTrackIds.push(mine.id);
    }
  }

  const tracks = [...keptLocalTracks, ...carriedTracks];
  const trackIds = new Set(tracks.map((track) => track.id));

  // Playlists. Their IDs are the same on every device; their track IDs are not.
  const localPlaylists = local.playlists.map((playlist) => ({
    ...playlist,
    trackIds: uniqueKnownIds(playlist.trackIds, trackIds),
    syncedTrackIds: uniqueKnownIds(playlist.syncedTrackIds, trackIds),
  }));
  const toMergedIds = (ids: readonly string[]): string[] =>
    uniqueKnownIds(
      ids.map((id) => mergedIdByRemoteId.get(id) ?? id),
      trackIds
    );
  const remotePlaylists = remote.playlists.map((playlist) => ({
    ...playlist,
    trackIds: toMergedIds(playlist.trackIds),
    syncedTrackIds: toMergedIds(playlist.syncedTrackIds ?? []),
  }));
  const playlists = newestWins(localPlaylists, remotePlaylists, 'local').filter(
    (playlist) => !deleted.isDeleted('playlist', playlist)
  );

  const smartPlaylists = newestWins(local.smartPlaylists, remote.smartPlaylists, 'local').filter(
    (smartPlaylist) => !deleted.isDeleted('smart-playlist', smartPlaylist)
  );

  const historyById = new Map<string, SyncEvent>();
  for (const event of [...local.syncHistory, ...remote.syncHistory]) {
    if (!historyById.has(event.id)) historyById.set(event.id, event);
  }
  const syncHistory = [...historyById.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, SYNC_HISTORY_LIMIT);

  const localPlaylistIds = new Set(local.playlists.map((playlist) => playlist.id));
  const localSmartIds = new Set(local.smartPlaylists.map((smartPlaylist) => smartPlaylist.id));
  return {
    library: { tracks, playlists, smartPlaylists, syncHistory, tombstones },
    revivedTrackIds,
    carriedOver: {
      tracks: carriedTracks.length,
      playlists: playlists.filter((playlist) => !localPlaylistIds.has(playlist.id)).length,
      smartPlaylists: smartPlaylists.filter((smartPlaylist) => !localSmartIds.has(smartPlaylist.id))
        .length,
    },
  };
}

/** What a push writes to the Drive manifest for songs, playlists and deletions. */
export type LibraryPushMerge = ReturnType<typeof mergeLibraryForPush>;

/** This device's library as a push hands it over. The app adds the deletions it has recorded. */
export type LocalLibraryForPush = Omit<LibrarySnapshot, 'tombstones'>;

/**
 * Applies deletions to this device's library after a pull. A deleted song goes only when this
 * device does not hold its audio. A device that has the file keeps its entry and marks it
 * changed now, so the deletion stops applying to it on every device.
 */
export function dropTombstoned(input: {
  tracks: LocalTrack[];
  playlists: Playlist[];
  smartPlaylists: SmartPlaylist[];
  tombstones: readonly LibraryTombstone[];
  holdsAudio: (track: LocalTrack) => boolean;
  now: number;
}): { tracks: LocalTrack[]; playlists: Playlist[]; smartPlaylists: SmartPlaylist[] } {
  const deleted = indexTombstones(input.tombstones);
  const removedTrackIds = new Set<string>();
  const tracks: LocalTrack[] = [];
  for (const track of input.tracks) {
    if (!isTrackDeleted(deleted, track)) {
      tracks.push(track);
    } else if (input.holdsAudio(track)) {
      tracks.push({ ...track, updatedAt: input.now });
    } else {
      removedTrackIds.add(track.id);
    }
  }
  const playlists = input.playlists
    .filter((playlist) => !deleted.isDeleted('playlist', playlist))
    .map((playlist) =>
      removedTrackIds.size > 0 && playlist.trackIds.some((id) => removedTrackIds.has(id))
        ? {
            ...playlist,
            trackIds: playlist.trackIds.filter((id) => !removedTrackIds.has(id)),
            syncedTrackIds: playlist.syncedTrackIds.filter((id) => !removedTrackIds.has(id)),
          }
        : playlist
    );
  const smartPlaylists = input.smartPlaylists.filter(
    (smartPlaylist) => !deleted.isDeleted('smart-playlist', smartPlaylist)
  );
  return { tracks, playlists, smartPlaylists };
}

/**
 * Marks every record a deletion still covers as changed now, so the deletion stops applying to
 * it. For records the user brings back on purpose: a restore from a backup file, or replacing
 * the library with Drive's copy.
 */
export function reviveTombstoned(input: {
  tracks: LocalTrack[];
  playlists: Playlist[];
  smartPlaylists: SmartPlaylist[];
  tombstones: readonly LibraryTombstone[];
  now: number;
}): { tracks: LocalTrack[]; playlists: Playlist[]; smartPlaylists: SmartPlaylist[] } {
  if (input.tombstones.length === 0) {
    return { tracks: input.tracks, playlists: input.playlists, smartPlaylists: input.smartPlaylists };
  }
  const deleted = indexTombstones(input.tombstones);
  return {
    tracks: input.tracks.map((track) =>
      isTrackDeleted(deleted, track) ? { ...track, updatedAt: input.now } : track
    ),
    playlists: input.playlists.map((playlist) =>
      deleted.isDeleted('playlist', playlist) ? { ...playlist, updatedAt: input.now } : playlist
    ),
    smartPlaylists: input.smartPlaylists.map((smartPlaylist) =>
      deleted.isDeleted('smart-playlist', smartPlaylist)
        ? { ...smartPlaylist, updatedAt: input.now }
        : smartPlaylist
    ),
  };
}

/** One sentence for the push result: what Drive held from other devices that this push kept. */
export function describeCarriedOver(carriedOver: LibraryPushMerge['carriedOver']): string {
  const parts = [
    [carriedOver.tracks, 'song'],
    [carriedOver.playlists, 'playlist'],
    [carriedOver.smartPlaylists, 'smart playlist'],
  ]
    .filter((part): part is [number, string] => typeof part[0] === 'number' && part[0] > 0)
    .map(([count, noun]) => `${count} ${noun}${count === 1 ? '' : 's'}`);
  if (parts.length === 0) return '';
  const last = parts[parts.length - 1];
  const list = parts.length === 1 ? last : `${parts.slice(0, -1).join(', ')} and ${last}`;
  return `Kept ${list} that other devices pushed.`;
}
