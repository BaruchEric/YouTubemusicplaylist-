import type { LocalTrack, Playlist } from '../src/types/music';

/** A scanned device file, unless the overrides say otherwise. */
export function makeTrack(overrides: Partial<LocalTrack> & Pick<LocalTrack, 'id'>): LocalTrack {
  return {
    fileKey: `music/${overrides.id}.mp3::1000`,
    fileName: `${overrides.id}.mp3`,
    relativePath: `Music/${overrides.id}.mp3`,
    folderName: 'Music',
    title: `Title ${overrides.id}`,
    artist: `Artist ${overrides.id}`,
    album: '',
    year: '',
    trackNumber: null,
    duration: 180,
    format: 'MP3',
    fileSize: 1000,
    coverArtUrl: null,
    addedAt: 0,
    lastSeenAt: 0,
    isMissingOnDevice: false,
    youtubeVideoId: null,
    youtubeTitle: null,
    matchStatus: 'unmatched',
    ...overrides,
  };
}

export function makePlaylist(overrides: Partial<Playlist> & Pick<Playlist, 'id'>): Playlist {
  return {
    name: `Playlist ${overrides.id}`,
    description: '',
    createdAt: 0,
    updatedAt: 0,
    lastSyncedAt: null,
    trackIds: [],
    syncedTrackIds: [],
    youtubePlaylistUrl: '',
    watchedFolderName: null,
    syncRule: { autoAddNewFiles: false, removeMissingFiles: false, folderFilter: '' },
    ...overrides,
  };
}
