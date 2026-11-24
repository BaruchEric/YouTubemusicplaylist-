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
  playCount?: number;
  skipCount?: number;
  lastPlayedAt?: number | null;
  /** Canonical Google Drive file ID when synced with Drive as source of truth */
  driveFileId?: string | null;
  /** ISO modifiedTime of the canonical audio file in Google Drive */
  driveModifiedTime?: string | null;
  /** Folder / source label in Google Drive */
  drivePath?: string | null;
  /** Timestamp when this song's audio binary was cached locally on this playing device */
  cachedOnDeviceAt?: number | null;
}

export type PlayEventOutcome = 'completed' | 'skipped';

export interface TrackPlayStats {
  playCount: number;
  completedCount: number;
  skipCount: number;
  lastPlayedAt: number | null;
}

export interface PlayHistoryEntry {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  album: string;
  coverArtUrl: string | null;
  playedAt: number;
  outcome: PlayEventOutcome;
  listenedSeconds: number;
  duration: number;
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

export type SmartRuleField =
  | 'genre'
  | 'artist'
  | 'album'
  | 'title'
  | 'format'
  | 'year'
  | 'playCount'
  | 'duration'
  | 'matchStatus'
  | 'folderName'
  | 'addedDaysAgo';

export type SmartRuleOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte';

export interface SmartPlaylistRule {
  id: string;
  field: SmartRuleField;
  operator: SmartRuleOperator;
  value: string;
}

export type SmartPlaylistMatchMode = 'all' | 'any';

export type SmartPlaylistSortBy =
  | 'addedAt'
  | 'playCount'
  | 'lastPlayedAt'
  | 'title'
  | 'artist'
  | 'duration'
  | 'year';

export type SmartPlaylistSortDir = 'asc' | 'desc';

export interface SmartPlaylist {
  id: string;
  name: string;
  description: string;
  matchMode: SmartPlaylistMatchMode;
  rules: SmartPlaylistRule[];
  sortBy: SmartPlaylistSortBy;
  sortDir: SmartPlaylistSortDir;
  excludeMissing: boolean;
  createdAt: number;
  updatedAt: number;
}

export type WorkspaceView =
  | 'dashboard'
  | 'scanner'
  | 'playlist'
  | 'smart-playlist'
  | 'sync'
  | 'scan-logs'
  | 'transfer';

export type DirectoryWatcherStatus = 'watching' | 'syncing' | 'idle';

export type ScanTriggerSource =
  | 'manual-folder'
  | 'background-watch'
  | 'file-picker'
  | 'drag-drop'
  | 'drive-mapping';

export type ScanErrorCode =
  | 'permission'
  | 'unreadable-file'
  | 'inaccessible-folder'
  | 'metadata-parse'
  | 'unknown';

export interface ScanErrorEntry {
  path: string;
  message: string;
  code: ScanErrorCode;
}

export type ScanLogStatus = 'completed' | 'completed-with-errors' | 'failed';

export interface ScanLogEntry {
  id: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  source: ScanTriggerSource;
  folderName: string;
  totalFilesEncountered: number;
  audioFilesProcessed: number;
  addedCount: number;
  updatedCount: number;
  restoredCount: number;
  missingCount: number;
  skippedNonAudioCount: number;
  status: ScanLogStatus;
  errors: ScanErrorEntry[];
}

export interface WatchedFolderInfo {
  name: string;
  lastScannedAt: number | null;
  trackCount: number;
  hasLiveHandle: boolean;
}

export type FolderSyncDirection = 'pull' | 'push' | 'bidirectional';

export interface SyncDeviceProfile {
  id: string;
  name: string;
  platform: string;
  lastSeenAt: number;
}

export interface DeviceFolderBinding {
  deviceId: string;
  /** Local folder name/path on this device (empty string = IndexedDB offline audio cache only) */
  localFolderPath: string;
  syncDirection: FolderSyncDirection;
  autoCacheOffline: boolean;
  lastSyncedAt: number | null;
  /**
   * When this binding was last created or edited (ms). Marking it synced leaves this alone.
   * A tombstone removes the binding only if the binding is not newer than the tombstone.
   * Bindings saved before this field existed count as 0.
   */
  updatedAt?: number;
}

/**
 * Records a deleted folder mapping, or one device's removed binding, so that merging an older
 * copy from Drive or another device does not bring it back.
 */
export interface FolderMappingTombstone {
  driveFolderId: string;
  /** The device whose binding was removed. Absent when the whole mapping was deleted. */
  deviceId?: string;
  deletedAt: number;
}

export interface DriveFolderMapping {
  id: string;
  driveFolderId: string;
  driveFolderName: string;
  createdAt: number;
  updatedAt: number;
  /** Per-device local folder bindings keyed by SyncDeviceProfile.id */
  deviceBindings: Record<string, DeviceFolderBinding>;
}
