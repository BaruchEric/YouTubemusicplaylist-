export type MatchStatus = 'unmatched' | 'matched' | 'skipped';

export interface LocalTrack {
  id: string;
  /** Stable fingerprint derived from relativePath + fileName + fileSize */
  fileKey: string;
  fileName: string;
  relativePath: string;
  folderName: string;
  title: string;
  artist: string;
  album: string;
  genre?: string;
  year: string;
  trackNumber: number | null;
  duration: number; // seconds, 0 if unknown
  format: string; // e.g., MP3, FLAC, M4A, WAV
  fileSize: number; // bytes
  contentHash?: string | null; // SHA-256 content fingerprint
  coverArtUrl: string | null;
  addedAt: number;
  lastSeenAt: number;
  isMissingOnDevice: boolean;
  youtubeVideoId: string | null;
  youtubeTitle: string | null;
  matchStatus: MatchStatus;
}

export interface SyncRule {
  /** Automatically queue newly discovered local files from the bound folder */
  autoAddNewFiles: boolean;
  /** Flag or remove playlist entries when local files disappear on device */
  removeMissingFiles: boolean;
  /** Auto-scan interval in seconds (0 = manual only) */
  autoScanIntervalSec: 0 | 30 | 120 | 300;
  /** Optional subfolder prefix filter; empty string matches all scanned tracks */
  folderFilter: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt: number | null;
  /** Current track IDs in the playlist (ordered) */
  trackIds: string[];
  /** Snapshot of track IDs from the last completed sync */
  syncedTrackIds: string[];
  /** Optional saved YouTube Music playlist URL linked by the user */
  youtubePlaylistUrl: string;
  /** Optional watched folder name associated with this playlist */
  watchedFolderName: string | null;
  syncRule: SyncRule;
}

export interface PlaylistDiff {
  playlistId: string;
  toAdd: LocalTrack[];
  toRemove: LocalTrack[];
  missingOnDevice: LocalTrack[];
  unmatchedCount: number;
  matchedCount: number;
  hasChanges: boolean;
}

export interface SyncEvent {
  id: string;
  playlistId: string;
  playlistName: string;
  timestamp: number;
  addedCount: number;
  removedCount: number;
  matchedCount: number;
  totalTracks: number;
  summary: string;
}

export type WorkspaceView = 'dashboard' | 'scanner' | 'playlist' | 'sync' | 'transfer';

export interface WatchedFolderInfo {
  name: string;
  lastScannedAt: number | null;
  trackCount: number;
  hasLiveHandle: boolean;
}
