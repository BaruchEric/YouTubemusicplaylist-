import type { LocalTrack, Playlist } from '../types/music';
import type { ImportedTrackSeed } from './youtubeLinks';

export interface PlaylistImportPlan {
  playlist: Playlist;
  /** List-only entries for songs the library did not have. */
  newTracks: LocalTrack[];
  /** Library songs that had no YouTube match and get one from the list: track ID to video ID. */
  videoIdsToLink: Map<string, string>;
}

function titleArtistKey(artist: string, title: string): string {
  return `${artist.toLowerCase()}::${title.toLowerCase()}`;
}

/**
 * Works out what importing a list adds to the library. The playlist starts as never synced:
 * reading a file says nothing about what is on YouTube, so every line shows as pending until
 * the user sends the playlist there.
 */
export function planPlaylistImport(input: {
  name: string;
  seeds: readonly ImportedTrackSeed[];
  existingTracks: readonly LocalTrack[];
  now: number;
  newId: () => string;
}): PlaylistImportPlan {
  const { name, seeds, existingTracks, now, newId } = input;
  const existingByTitleArtist = new Map<string, LocalTrack>();
  for (const track of existingTracks) {
    existingByTitleArtist.set(titleArtistKey(track.artist, track.title), track);
  }

  const newTracks: LocalTrack[] = [];
  const videoIdsToLink = new Map<string, string>();
  const trackIds: string[] = [];

  for (const seed of seeds) {
    const existing = existingByTitleArtist.get(titleArtistKey(seed.artist, seed.title));
    if (existing) {
      trackIds.push(existing.id);
      if (!existing.youtubeVideoId && seed.youtubeVideoId) {
        videoIdsToLink.set(existing.id, seed.youtubeVideoId);
      }
      continue;
    }

    const created: LocalTrack = {
      id: newId(),
      fileKey: `import::${seed.relativePath.toLowerCase()}::${now}::${newTracks.length}`,
      fileName: seed.title,
      relativePath: seed.relativePath,
      folderName: 'Imported',
      title: seed.title,
      artist: seed.artist,
      album: seed.album,
      year: '',
      trackNumber: null,
      duration: seed.duration,
      format: seed.youtubeVideoId ? 'YT' : 'LIST',
      fileSize: 0,
      coverArtUrl: null,
      addedAt: now,
      lastSeenAt: now,
      isMissingOnDevice: false,
      youtubeVideoId: seed.youtubeVideoId,
      youtubeTitle: null,
      matchStatus: seed.youtubeVideoId ? 'matched' : 'unmatched',
    };
    newTracks.push(created);
    trackIds.push(created.id);
  }

  const playlist: Playlist = {
    id: newId(),
    name,
    description: `Imported ${seeds.length} tracks`,
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: null,
    trackIds,
    syncedTrackIds: [],
    youtubePlaylistUrl: '',
    watchedFolderName: null,
    syncRule: {
      autoAddNewFiles: false,
      removeMissingFiles: false,
      folderFilter: '',
    },
  };

  return { playlist, newTracks, videoIdsToLink };
}
