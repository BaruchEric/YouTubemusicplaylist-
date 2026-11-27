import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  CheckCircle2,
  Cloud,
  CloudDownload,
  CloudOff,
  CloudUpload,
  Database,
  ExternalLink,
  FileText,
  FolderOpen,
  HardDrive,
  Loader2,
  LogOut,
  Music2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import type {
  DeviceFolderBinding,
  DriveFolderMapping,
  LocalTrack,
  Playlist,
  SmartPlaylist,
  SyncDeviceProfile,
  SyncEvent,
} from '../types/music';
import {
  clearDriveAccessToken,
  getDriveAccessToken,
  initGoogleAuth,
  signInWithGoogleDrive,
  signOutGoogleDrive,
} from '../utils/googleAuth';
import {
  buildLibraryBackupPayload,
  clearDriveFolderCountsIndex,
  CRATESYNC_CANONICAL_MANIFEST_NAME,
  CRATESYNC_DRIVE_FOLDER_NAME,
  createDriveFolder,
  deleteDriveFile,
  downloadDriveAudioBlob,
  downloadDriveFileRange,
  downloadDriveFileText,
  DriveApiError,
  findOrCreateCrateSyncFolder,
  inferAudioMimeFromName,
  listCrateSyncBackups,
  listDriveAudioFiles,
  listDriveFolders,
  listDrivePlaylistFiles,
  parseLibraryBackupPayload,
  syncCanonicalManifestToDrive,
  uploadAudioFileToDrive,
  uploadPlaylistExportToDrive,
  type CrateSyncLibraryBackupPayload,
  type DriveFileItem,
  type DriveFolderItem,
  type DriveScanProgress,
} from '../utils/googleDriveApi';
import {
  normalizeFolderPath,
  resolveDriveMappingForLocalTrack,
  trackMatchesLocalFolder,
  type ManifestFolderState,
} from '../utils/folderMappings';
import { clearDeviceCacheMessage, summarizeDeviceCache } from '../utils/deviceCache';
import {
  countTracksNeedingTagRead,
  describeTagReadProgress,
  describeTagReadResult,
  needsTagRead,
  readDriveTrackTags,
  type TagReadProgress,
  type TagReadUpdates,
} from '../utils/driveTagReader';
import {
  describeCarriedOver,
  type LibraryPushMerge,
  type LocalLibraryForPush,
} from '../utils/libraryMerge';
import { loadAudioBlob } from '../utils/storage';
import type { ScannedFileEntry } from '../utils/syncEngine';
import {
  exportPlaylistToCSV,
  exportPlaylistToJSON,
  exportPlaylistToM3U8,
  formatFileSize,
  formatRelativeTime,
  parseImportedText,
  type ImportedTrackSeed,
} from '../utils/youtubeLinks';
import { DriveFolderBrowserModal } from './DriveFolderBrowserModal';
import { FolderMappingsPanel } from './FolderMappingsPanel';
import { LocalFolderBrowserModal } from './LocalFolderBrowserModal';
import { ConfirmModal } from './Modals';

interface GoogleDriveTransferSectionProps {
  tracks: LocalTrack[];
  playlists: Playlist[];
  smartPlaylists: SmartPlaylist[];
  syncHistory: SyncEvent[];
  watchedFolderName: string | null;
  availableLocalFolders: string[];
  currentDevice: SyncDeviceProfile;
  devices: SyncDeviceProfile[];
  folderMappings: DriveFolderMapping[];
  trackMap: Map<string, LocalTrack>;
  storedAudioKeys: Set<string>;
  deviceCacheBytes: number;
  hasPlayableFile: (fileKey: string) => boolean;
  getCachedAudioBlob: (fileKey: string) => Promise<Blob | null>;
  onRenameCurrentDevice: (newName: string) => void;
  onSaveFolderMapping: (params: {
    driveFolderId: string;
    driveFolderName: string;
    binding: DeviceFolderBinding;
  }) => void;
  onUnbindDeviceFromMapping: (mappingId: string, deviceId: string) => void;
  onDeleteFolderMapping: (mappingId: string) => void;
  onMarkMappingSynced: (mappingId: string, deviceId: string) => void;
  /**
   * Joins this device's library, devices and folder mappings with a downloaded Drive manifest
   * (or, given null, with nothing) and returns what a push should write to the manifest.
   */
  onPrepareManifestForPush: (
    remote: CrateSyncLibraryBackupPayload | null,
    local: LocalLibraryForPush
  ) => ManifestFolderState & LibraryPushMerge;
  onImportPlaylist: (name: string, seeds: ImportedTrackSeed[]) => void;
  onRestoreLibraryBackup: (
    backup: CrateSyncLibraryBackupPayload,
    mode: 'merge' | 'replace'
  ) => void;
  onSyncFromDriveSourceOfTruth: (payload: {
    manifest: CrateSyncLibraryBackupPayload | null;
    driveAudioFiles: DriveFileItem[];
    folderLabel: string;
    mappedDriveFolderId?: string | null;
    replaceWithSourceOfTruth: boolean;
  }) => { addedSongs: number; updatedSongs: number; playlistCount: number; syncedTrackIds: string[] };
  onLinkUploadedDriveTracks: (
    updates: Array<{ trackId: string; driveFileId: string; driveModifiedTime: string; drivePath: string }>
  ) => void;
  onCacheDriveTrackAudio: (trackId: string, blob: Blob, driveFile?: DriveFileItem) => Promise<void>;
  /** Saves the fields a tag read changed, by track id. */
  onApplyTrackTagUpdates: (updates: TagReadUpdates) => void;
  onEvictTrackCache: (fileKeys: string[]) => Promise<void>;
  onClearAllDeviceCache: () => Promise<void>;
  onPlayTrack: (trackId: string, queueIds?: string[]) => void;
  onIngestLocalFolderEntries?: (
    entries: ScannedFileEntry[],
    folderRootName: string
  ) => Promise<void> | void;
  onNotify?: (payload: {
    title: string;
    description?: string;
    tone?: 'neutral' | 'success' | 'warning';
  }) => void;
}

type PendingDriveAction =
  | {
      kind: 'push-source-of-truth';
      existingManifestId: string | null;
      localSongsToUpload: LocalTrack[];
      trackCount: number;
      playlistCount: number;
      smartPlaylistCount: number;
    }
  | {
      kind: 'pull-source-of-truth';
      manifestFile: DriveFileItem | null;
      driveAudioCount: number;
      folderLabel: string;
      replaceMode: boolean;
    }
  | {
      kind: 'upload-playlist';
      playlist: Playlist;
      format: 'json' | 'm3u8' | 'csv';
      fileName: string;
      trackCount: number;
    }
  | {
      kind: 'delete-backup';
      file: DriveFileItem;
    }
  | {
      kind: 'restore-backup';
      fileName: string;
      backup: CrateSyncLibraryBackupPayload;
      mode: 'merge' | 'replace';
    }
  | {
      kind: 'clear-device-cache';
      cachedCount: number;
      /** Cached songs that Google Drive has no copy of. */
      withoutDriveCopyCount: number;
      totalBytes: number;
    }
  | {
      kind: 'create-drive-folder';
      folderName: string;
      parentFolderId: string | null;
      parentFolderLabel: string;
    }
  | {
      kind: 'sync-mapped-folders';
      mappings: DriveFolderMapping[];
      songsToUploadCount: number;
    };

function GoogleGLogo({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
      />
    </svg>
  );
}

function getFileExtensionLabel(file: DriveFileItem): string {
  const ext = file.name.split('.').pop()?.toUpperCase();
  if (ext && ext.length <= 5 && file.name.includes('.')) return ext;
  if (file.mimeType.includes('mpegurl')) return 'M3U8';
  if (file.mimeType.includes('csv') || file.mimeType.includes('spreadsheet')) return 'CSV';
  if (file.mimeType.includes('json')) return 'JSON';
  if (file.mimeType.includes('text') || file.mimeType.includes('document')) return 'TXT';
  return 'FILE';
}

function safeFileSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'playlist';
}

export function GoogleDriveTransferSection({
  tracks,
  playlists,
  smartPlaylists,
  syncHistory,
  watchedFolderName,
  availableLocalFolders,
  currentDevice,
  devices,
  folderMappings,
  trackMap,
  storedAudioKeys,
  deviceCacheBytes,
  hasPlayableFile,
  getCachedAudioBlob,
  onRenameCurrentDevice,
  onSaveFolderMapping,
  onUnbindDeviceFromMapping,
  onDeleteFolderMapping,
  onMarkMappingSynced,
  onPrepareManifestForPush,
  onImportPlaylist,
  onRestoreLibraryBackup,
  onSyncFromDriveSourceOfTruth,
  onLinkUploadedDriveTracks,
  onCacheDriveTrackAudio,
  onApplyTrackTagUpdates,
  onEvictTrackCache,
  onClearAllDeviceCache,
  onPlayTrack,
  onIngestLocalFolderEntries,
  onNotify,
}: GoogleDriveTransferSectionProps) {
  const [user, setUser] = useState<User | null>(null);
  const [hasAccessToken, setHasAccessToken] = useState<boolean>(Boolean(getDriveAccessToken()));
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<
    'songs-cache' | 'folder-mappings' | 'playlists-snapshots'
  >('songs-cache');

  // Drive remote state (persist only non-sensitive folder scope ID/label, never auth tokens)
  const [backups, setBackups] = useState<DriveFileItem[]>([]);
  const [driveFolders, setDriveFolders] = useState<DriveFolderItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>(() => {
    try {
      const raw = window.localStorage.getItem('cratesync_drive_folder_scope_v1');
      if (!raw) return '';
      const parsed = JSON.parse(raw) as { id?: string };
      return typeof parsed.id === 'string' ? parsed.id : '';
    } catch {
      return '';
    }
  });
  const [selectedFolderCustomLabel, setSelectedFolderCustomLabel] = useState<string | null>(() => {
    try {
      const raw = window.localStorage.getItem('cratesync_drive_folder_scope_v1');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { label?: string | null };
      return typeof parsed.label === 'string' ? parsed.label : null;
    } catch {
      return null;
    }
  });
  const [scopeBrowserOpen, setScopeBrowserOpen] = useState(false);
  const [localMirrorBrowserOpen, setLocalMirrorBrowserOpen] = useState(false);
  const [driveRefreshSignal, setDriveRefreshSignal] = useState(0);
  const [driveAudioFiles, setDriveAudioFiles] = useState<DriveFileItem[]>([]);
  const [drivePlaylists, setDrivePlaylists] = useState<DriveFileItem[]>([]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        'cratesync_drive_folder_scope_v1',
        JSON.stringify({ id: selectedFolderId, label: selectedFolderCustomLabel })
      );
    } catch {
      // Ignore storage quota restrictions
    }
  }, [selectedFolderId, selectedFolderCustomLabel]);

  // Search & selectors
  const [songSearchQuery, setSongSearchQuery] = useState('');
  const [visibleSongLimit, setVisibleSongLimit] = useState(150);
  const [playlistSearchQuery, setPlaylistSearchQuery] = useState('');
  const [targetPlaylistName, setTargetPlaylistName] = useState('');
  const [selectedCachePlaylistId, setSelectedCachePlaylistId] = useState(playlists[0]?.id ?? '');
  const [selectedUploadPlaylistId, setSelectedUploadPlaylistId] = useState(playlists[0]?.id ?? '');
  const [selectedUploadFormat, setSelectedUploadFormat] = useState<'json' | 'm3u8' | 'csv'>('m3u8');

  // Async progress states
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const [driveScanProgress, setDriveScanProgress] = useState<{
    folderLabel: string;
    scannedFolders: number;
    queuedFolders: number;
    foundAudio: number;
  } | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    label: string;
    current: number;
    total: number;
    activeItem: string;
  } | null>(null);
  const cancelBatchRef = useRef(false);
  const [tagReadProgress, setTagReadProgress] = useState<TagReadProgress | null>(null);
  const tagReadAbortRef = useRef<AbortController | null>(null);

  const [cachingTrackId, setCachingTrackId] = useState<string | null>(null);
  const [importingFileId, setImportingFileId] = useState<string | null>(null);
  const [restoringFileId, setRestoringFileId] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    tone: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingDriveAction | null>(null);

  useEffect(() => {
    if (!selectedUploadPlaylistId && playlists[0]?.id) {
      setSelectedUploadPlaylistId(playlists[0].id);
    } else if (selectedUploadPlaylistId && !playlists.some((p) => p.id === selectedUploadPlaylistId)) {
      setSelectedUploadPlaylistId(playlists[0]?.id ?? '');
    }
    if (!selectedCachePlaylistId && playlists[0]?.id) {
      setSelectedCachePlaylistId(playlists[0].id);
    } else if (selectedCachePlaylistId && !playlists.some((p) => p.id === selectedCachePlaylistId)) {
      setSelectedCachePlaylistId(playlists[0]?.id ?? '');
    }
  }, [playlists, selectedUploadPlaylistId, selectedCachePlaylistId]);

  // Subscribe to Firebase Auth state (clears in-memory token automatically on sign-out)
  useEffect(() => {
    const unsubscribe = initGoogleAuth((state) => {
      setUser(state.user);
      setHasAccessToken(state.hasAccessToken);
      if (!state.user) {
        clearDriveFolderCountsIndex();
        setBackups([]);
        setDriveFolders([]);
        setDriveAudioFiles([]);
        setDrivePlaylists([]);
        setLastRefreshedAt(null);
      }
    });
    return unsubscribe;
  }, []);

  const handleDriveApiError = useCallback((err: unknown, fallbackMessage: string) => {
    if (err instanceof DriveApiError && err.isAuthError) {
      clearDriveAccessToken();
      setHasAccessToken(false);
      setStatusMessage({
        tone: 'error',
        text: 'Your Google Drive session expired. Click "Sign in with Google" to reconnect.',
      });
      return;
    }
    const message = err instanceof Error ? err.message : fallbackMessage;
    setStatusMessage({ tone: 'error', text: message });
  }, []);

  const refreshDriveData = useCallback(
    async (overrides?: { folderId?: string; folderLabel?: string; playlistSearch?: string }) => {
      const token = getDriveAccessToken();
      if (!token) {
        setHasAccessToken(false);
        return;
      }

      // Cancel any in-flight Drive scan when switching folders or refreshing
      scanAbortRef.current?.abort();
      const abortController = new AbortController();
      scanAbortRef.current = abortController;

      const folderScope = overrides?.folderId !== undefined ? overrides.folderId : selectedFolderId;
      const resolvedLabel =
        overrides?.folderLabel ??
        (!folderScope
          ? 'All Google Drive'
          : folderScope === 'root'
            ? 'My Drive'
            : selectedFolderCustomLabel ||
              driveFolders.find((f) => f.id === folderScope)?.name ||
              'Google Drive');
      const plQuery =
        overrides?.playlistSearch !== undefined ? overrides.playlistSearch : playlistSearchQuery;

      setIsLoadingDrive(true);
      setDriveScanProgress({
        folderLabel: resolvedLabel,
        scannedFolders: 0,
        queuedFolders: 1,
        foundAudio: 0,
      });
      setAuthError(null);
      try {
        const [backupFiles, folders, audioFiles, playlistFiles] = await Promise.all([
          listCrateSyncBackups(token),
          listDriveFolders(token),
          listDriveAudioFiles(token, {
            folderId: folderScope || null,
            folderLabel: resolvedLabel,
            recursive: true,
            signal: abortController.signal,
            onProgress: (prog: DriveScanProgress) => {
              if (scanAbortRef.current !== abortController) return;
              setDriveScanProgress({
                folderLabel: resolvedLabel,
                ...prog,
              });
            },
          }),
          listDrivePlaylistFiles(token, plQuery),
        ]);

        if (scanAbortRef.current !== abortController) return;

        setBackups(backupFiles);
        setDriveFolders(folders);
        setDriveAudioFiles(audioFiles);
        setDrivePlaylists(playlistFiles);
        setLastRefreshedAt(Date.now());
        setDriveRefreshSignal((n) => n + 1);
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') {
          return;
        }
        handleDriveApiError(err, 'Could not refresh Google Drive catalog.');
      } finally {
        if (scanAbortRef.current === abortController) {
          setIsLoadingDrive(false);
          setDriveScanProgress(null);
        }
      }
    },
    [
      selectedFolderId,
      selectedFolderCustomLabel,
      driveFolders,
      playlistSearchQuery,
      handleDriveApiError,
    ]
  );

  // Abort any in-flight Drive scan or tag read on unmount
  useEffect(() => {
    return () => {
      scanAbortRef.current?.abort();
      tagReadAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (user && hasAccessToken) {
      void refreshDriveData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, hasAccessToken]);

  const handleGoogleSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    setStatusMessage(null);
    try {
      const { user: signedInUser } = await signInWithGoogleDrive();
      setUser(signedInUser);
      setHasAccessToken(true);
      onNotify?.({
        title: 'Google Drive connected',
        description:
          signedInUser.email ?? signedInUser.displayName ?? 'Ready to sync songs & playlists.',
        tone: 'success',
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user') {
        setAuthError('Sign-in popup was closed before completing.');
      } else if (code === 'auth/popup-blocked') {
        setAuthError('Browser blocked the sign-in popup. Allow popups for this site and try again.');
      } else {
        setAuthError(
          err instanceof Error ? err.message : 'Unable to sign in with Google Drive right now.'
        );
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    setAuthLoading(true);
    setStatusMessage(null);
    setAuthError(null);
    try {
      await signOutGoogleDrive();
      setUser(null);
      setHasAccessToken(false);
      setBackups([]);
      setDriveFolders([]);
      setDriveAudioFiles([]);
      setDrivePlaylists([]);
      setLastRefreshedAt(null);
      onNotify?.({
        title: 'Disconnected from Google Drive',
        description: 'Cached songs remain playable offline on this device.',
        tone: 'neutral',
      });
    } finally {
      setAuthLoading(false);
    }
  };

  /**
   * Reads the current Drive manifest and joins it with this device's library before a push
   * overwrites it. Otherwise a device that had not pulled would erase the songs, playlists,
   * bindings and deletions that other devices wrote since.
   */
  const mergeManifestBeforeWrite = async (
    token: string,
    manifestFileId: string | null,
    localTracks: LocalTrack[]
  ): Promise<ManifestFolderState & LibraryPushMerge> => {
    const local = { tracks: localTracks, playlists, smartPlaylists, syncHistory };
    if (!manifestFileId) return onPrepareManifestForPush(null, local);
    let remote: CrateSyncLibraryBackupPayload | null = null;
    try {
      const raw = await downloadDriveFileText(token, {
        id: manifestFileId,
        mimeType: 'application/json',
      });
      remote = parseLibraryBackupPayload(raw);
    } catch (err) {
      // The manifest was deleted since the last listing: nothing to merge.
      if (!(err instanceof DriveApiError && err.status === 404)) throw err;
    }
    return onPrepareManifestForPush(remote, local);
  };

  /** The manifest payload for a library already joined with what Drive holds. */
  const buildMergedManifestPayload = (
    merged: ManifestFolderState & LibraryPushMerge,
    musicFolder: { id: string; name: string }
  ): CrateSyncLibraryBackupPayload =>
    buildLibraryBackupPayload({
      tracks: merged.library.tracks,
      playlists: merged.library.playlists,
      smartPlaylists: merged.library.smartPlaylists,
      syncHistory: merged.library.syncHistory,
      libraryTombstones: merged.library.tombstones,
      watchedFolderName,
      driveMusicFolderId: musicFolder.id,
      driveMusicFolderName: musicFolder.name,
      devices: merged.devices,
      folderMappings: merged.folderMappings,
      folderMappingTombstones: merged.folderMappingTombstones,
    });

  // Canonical source-of-truth manifest file (prioritizes cratesync-source-of-truth.json)
  const canonicalManifest = useMemo(() => {
    return (
      backups.find(
        (b) =>
          b.appProperties?.cratesyncType === 'source-of-truth' ||
          b.name === CRATESYNC_CANONICAL_MANIFEST_NAME
      ) ??
      backups[0] ??
      null
    );
  }, [backups]);

  const canonicalManifestTime = canonicalManifest
    ? Date.parse(canonicalManifest.modifiedTime) || null
    : null;

  const selectedFolderLabel = useMemo(() => {
    if (!selectedFolderId) return 'Google Drive';
    if (selectedFolderId === 'root') return 'My Drive';
    return (
      selectedFolderCustomLabel ||
      driveFolders.find((f) => f.id === selectedFolderId)?.name ||
      'Google Drive'
    );
  }, [selectedFolderId, selectedFolderCustomLabel, driveFolders]);

  const activeMirrorDriveFolderId = selectedFolderId || 'root';
  const activeMirrorDriveFolderName = selectedFolderId ? selectedFolderLabel : 'My Drive';

  const activeMirrorBinding = useMemo(() => {
    const mapping = folderMappings.find((m) => m.driveFolderId === activeMirrorDriveFolderId);
    return mapping?.deviceBindings[currentDevice.id] ?? null;
  }, [folderMappings, activeMirrorDriveFolderId, currentDevice.id]);

  // Tracks categorized by Drive source-of-truth + device cache status
  const driveLinkedTracks = useMemo(
    () => tracks.filter((t) => Boolean(t.driveFileId)),
    [tracks]
  );

  const uncachedDriveTracks = useMemo(
    () => driveLinkedTracks.filter((t) => !hasPlayableFile(t.fileKey)),
    [driveLinkedTracks, hasPlayableFile]
  );

  const localOnlyTracksWithAudio = useMemo(
    () => tracks.filter((t) => !t.driveFileId && hasPlayableFile(t.fileKey)),
    [tracks, hasPlayableFile]
  );

  // Drive songs still holding what the listing guessed from their file name and folders
  const tagReadCount = useMemo(() => countTracksNeedingTagRead(tracks), [tracks]);

  const cachedSongsCount = useMemo(
    () => tracks.filter((t) => hasPlayableFile(t.fileKey)).length,
    [tracks, hasPlayableFile]
  );

  const mirroredLocalStats = useMemo(() => {
    const localPath = activeMirrorBinding?.localFolderPath ?? '';
    if (!localPath) {
      return {
        isLocalFolder: false,
        total: cachedSongsCount,
        playable: cachedSongsCount,
        linkedToDrive: driveLinkedTracks.filter((t) => hasPlayableFile(t.fileKey)).length,
      };
    }
    const matching = tracks.filter((t) => trackMatchesLocalFolder(t, localPath));
    return {
      isLocalFolder: true,
      total: matching.length,
      playable: matching.filter((t) => hasPlayableFile(t.fileKey)).length,
      linkedToDrive: matching.filter((t) => Boolean(t.driveFileId)).length,
    };
  }, [activeMirrorBinding?.localFolderPath, tracks, cachedSongsCount, driveLinkedTracks, hasPlayableFile]);

  const cacheCoveragePct =
    tracks.length > 0 ? Math.round((cachedSongsCount / tracks.length) * 100) : 0;

  // Map driveFileId -> LocalTrack for quick lookup in the Drive audio browser
  const localTrackByDriveId = useMemo(() => {
    const map = new Map<string, LocalTrack>();
    for (const t of tracks) {
      if (t.driveFileId) map.set(t.driveFileId, t);
    }
    return map;
  }, [tracks]);

  // Unified song rows shown in the Songs & Device Cache tab
  const matchingCatalogTracks = useMemo(() => {
    const q = songSearchQuery.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q) ||
        t.fileName.toLowerCase().includes(q)
    );
  }, [tracks, songSearchQuery]);

  const filteredCatalogTracks = useMemo(
    () => matchingCatalogTracks.slice(0, visibleSongLimit),
    [matchingCatalogTracks, visibleSongLimit]
  );

  // Drive audio files not yet pulled into local catalog
  const unsyncedRemoteDriveSongs = useMemo(
    () => driveAudioFiles.filter((f) => !localTrackByDriveId.has(f.id)),
    [driveAudioFiles, localTrackByDriveId]
  );

  // Source-of-truth sync status
  const syncStatus = useMemo(() => {
    if (!user) {
      return {
        label: 'Offline / Disconnected',
        detail:
          cachedSongsCount > 0
            ? `${cachedSongsCount} song${cachedSongsCount === 1 ? '' : 's'} cached offline on this playing device. Connect Google Drive to sync changes.`
            : 'Connect Google Drive as your source of truth for songs, playlists, and device caching.',
        tone: 'muted' as const,
      };
    }
    if (!hasAccessToken) {
      return {
        label: 'Session paused',
        detail: 'Sign in again to sync with Google Drive or cache new songs to this device.',
        tone: 'warning' as const,
      };
    }
    if (unsyncedRemoteDriveSongs.length > 0) {
      return {
        label: 'Drive has new songs',
        detail: `${unsyncedRemoteDriveSongs.length} song${unsyncedRemoteDriveSongs.length === 1 ? '' : 's'} in Google Drive ready to pull onto this device.`,
        tone: 'warning' as const,
      };
    }
    if (!canonicalManifest) {
      return {
        label: 'Not initialized in Drive',
        detail:
          tracks.length > 0 || playlists.length > 0
            ? 'Push your library to Google Drive to establish the cloud source of truth.'
            : 'Pull audio from Google Drive or scan local songs to begin.',
        tone: 'muted' as const,
      };
    }

    const backedTracks = Number(canonicalManifest.appProperties?.trackCount ?? NaN);
    const backedPlaylists = Number(canonicalManifest.appProperties?.playlistCount ?? NaN);
    const latestLocalMutation = Math.max(
      ...tracks.map((t) => t.addedAt || 0),
      ...playlists.map((p) => p.updatedAt || 0),
      ...smartPlaylists.map((sp) => sp.updatedAt || 0),
      0
    );

    const hasLocalUnpushed =
      localOnlyTracksWithAudio.length > 0 ||
      Number.isNaN(backedTracks) ||
      backedTracks !== tracks.length ||
      backedPlaylists !== playlists.length ||
      (canonicalManifestTime !== null && latestLocalMutation > canonicalManifestTime + 5000);

    if (hasLocalUnpushed) {
      return {
        label: 'Local changes to push',
        detail:
          localOnlyTracksWithAudio.length > 0
            ? `${localOnlyTracksWithAudio.length} local song${localOnlyTracksWithAudio.length === 1 ? '' : 's'} + catalog updates ready to push to Google Drive.`
            : 'Playlists or metadata changed locally since last Google Drive sync.',
        tone: 'warning' as const,
      };
    }

    return {
      label: 'Synced with Drive',
      detail: `This device matches Google Drive (${tracks.length} songs · ${playlists.length} playlists).`,
      tone: 'synced' as const,
    };
  }, [
    user,
    hasAccessToken,
    cachedSongsCount,
    unsyncedRemoteDriveSongs.length,
    canonicalManifest,
    canonicalManifestTime,
    localOnlyTracksWithAudio.length,
    tracks,
    playlists,
    smartPlaylists,
  ]);

  // Cache a single Drive track binary into this device's IndexedDB
  const handleCacheSingleTrack = async (track: LocalTrack) => {
    const token = getDriveAccessToken();
    if (!token || !track.driveFileId) {
      setHasAccessToken(Boolean(token));
      return;
    }

    setCachingTrackId(track.id);
    setStatusMessage(null);
    try {
      const blob = await downloadDriveAudioBlob(
        token,
        track.driveFileId,
        inferAudioMimeFromName(track.fileName)
      );
      const matchingDriveFile = driveAudioFiles.find((f) => f.id === track.driveFileId);
      await onCacheDriveTrackAudio(track.id, blob, matchingDriveFile);
      setStatusMessage({
        tone: 'success',
        text: `Cached "${track.title}" (${formatFileSize(blob.size)}) for offline playback on this device.`,
      });
    } catch (err) {
      handleDriveApiError(err, `Failed to cache "${track.title}" from Google Drive.`);
    } finally {
      setCachingTrackId(null);
    }
  };

  // Batch cache a list of uncached Drive songs onto this playing device
  const handleBatchCacheTracks = async (targets: LocalTrack[], label: string) => {
    const token = getDriveAccessToken();
    if (!token) {
      setHasAccessToken(false);
      return;
    }

    const queue = targets.filter((t) => Boolean(t.driveFileId) && !hasPlayableFile(t.fileKey));
    if (queue.length === 0) {
      setStatusMessage({
        tone: 'info',
        text: 'All songs in this selection are already cached offline on this device.',
      });
      return;
    }

    cancelBatchRef.current = false;
    setIsMutating(true);
    setStatusMessage(null);
    let cachedNow = 0;
    let totalBytesNow = 0;

    try {
      for (let i = 0; i < queue.length; i++) {
        if (cancelBatchRef.current) break;
        const track = queue[i];
        setBatchProgress({
          label,
          current: i + 1,
          total: queue.length,
          activeItem: track.title || track.fileName,
        });

        const blob = await downloadDriveAudioBlob(
          token,
          track.driveFileId!,
          inferAudioMimeFromName(track.fileName)
        );
        const matchingDriveFile = driveAudioFiles.find((f) => f.id === track.driveFileId);
        await onCacheDriveTrackAudio(track.id, blob, matchingDriveFile);
        cachedNow += 1;
        totalBytesNow += blob.size;
      }

      const wasCancelled = cancelBatchRef.current;
      setStatusMessage({
        tone: wasCancelled ? 'info' : 'success',
        text: wasCancelled
          ? `Paused offline caching after ${cachedNow} of ${queue.length} songs (${formatFileSize(totalBytesNow)} cached).`
          : `Cached ${cachedNow} song${cachedNow === 1 ? '' : 's'} (${formatFileSize(totalBytesNow)}) onto this playing device for offline playback.`,
      });
      onNotify?.({
        title: wasCancelled ? 'Offline caching paused' : 'Songs cached for offline playback',
        description: `${cachedNow} song${cachedNow === 1 ? '' : 's'} · ${formatFileSize(totalBytesNow)}`,
        tone: wasCancelled ? 'neutral' : 'success',
      });
    } catch (err) {
      handleDriveApiError(err, 'Batch offline caching interrupted.');
    } finally {
      setBatchProgress(null);
      setIsMutating(false);
      cancelBatchRef.current = false;
    }
  };

  // Read tags, cover art and duration from the first bytes of each Drive song
  const handleReadTags = async () => {
    if (!getDriveAccessToken()) {
      setHasAccessToken(false);
      return;
    }
    const targets = tracks.filter(needsTagRead);
    if (targets.length === 0) return;

    const controller = new AbortController();
    tagReadAbortRef.current = controller;
    setIsMutating(true);
    setStatusMessage(null);
    setTagReadProgress({ done: 0, total: targets.length, bytes: 0 });

    try {
      const result = await readDriveTrackTags({
        tracks: targets,
        signal: controller.signal,
        // Each read looks the token up again, so a long run picks up a renewed one.
        readRange: (fileId, start, end) => {
          const token = getDriveAccessToken();
          if (!token) {
            return Promise.reject(new DriveApiError('The Google Drive session ended.', 401));
          }
          return downloadDriveFileRange(token, fileId, start, end, undefined, controller.signal);
        },
        localBlob: async (track) =>
          hasPlayableFile(track.fileKey) ? getCachedAudioBlob(track.fileKey) : null,
        onProgress: setTagReadProgress,
        onBatch: onApplyTrackTagUpdates,
      });

      if (result.stopped?.reason === 'session-ended') {
        clearDriveAccessToken();
        setHasAccessToken(false);
      }
      const summary = describeTagReadResult(result);
      const stoppedByDrive = result.stopped !== null && result.stopped.reason !== 'stopped';
      setStatusMessage({
        tone: stoppedByDrive ? 'error' : result.stopped ? 'info' : 'success',
        text: summary,
      });
      onNotify?.({
        title: result.stopped ? 'Tag reading stopped' : 'Tags read from Google Drive',
        description: summary,
        tone: stoppedByDrive ? 'warning' : result.stopped ? 'neutral' : 'success',
      });
    } catch (err) {
      handleDriveApiError(err, 'Reading tags from Google Drive failed.');
    } finally {
      tagReadAbortRef.current = null;
      setTagReadProgress(null);
      setIsMutating(false);
    }
  };

  const handleCacheSelectedPlaylistOffline = () => {
    const playlist = playlists.find((p) => p.id === selectedCachePlaylistId);
    if (!playlist) return;
    const plTracks = playlist.trackIds
      .map((id) => trackMap.get(id))
      .filter((t): t is LocalTrack => Boolean(t));
    void handleBatchCacheTracks(plTracks, `Caching "${playlist.name}" offline`);
  };

  // Trigger Pull from Google Drive (Source of Truth)
  const handleRequestPullFromDrive = (replaceMode: boolean) => {
    setPendingAction({
      kind: 'pull-source-of-truth',
      manifestFile: canonicalManifest,
      driveAudioCount: driveAudioFiles.length,
      folderLabel: selectedFolderLabel,
      replaceMode,
    });
  };

  // Trigger Push to Google Drive (Update Source of Truth)
  const handleRequestPushToDrive = () => {
    setPendingAction({
      kind: 'push-source-of-truth',
      existingManifestId:
        canonicalManifest?.appProperties?.cratesyncType === 'source-of-truth' ||
        canonicalManifest?.name === CRATESYNC_CANONICAL_MANIFEST_NAME
          ? canonicalManifest.id
          : null,
      localSongsToUpload: localOnlyTracksWithAudio,
      trackCount: tracks.length,
      playlistCount: playlists.length,
      smartPlaylistCount: smartPlaylists.length,
    });
  };

  const handleRequestUploadPlaylist = () => {
    const playlist = playlists.find((p) => p.id === selectedUploadPlaylistId);
    if (!playlist) return;
    const fileName = `${safeFileSlug(playlist.name)}.${selectedUploadFormat}`;
    setPendingAction({
      kind: 'upload-playlist',
      playlist,
      format: selectedUploadFormat,
      fileName,
      trackCount: playlist.trackIds.length,
    });
  };

  const handlePrepareRestoreBackup = async (
    file: DriveFileItem,
    mode: 'merge' | 'replace'
  ) => {
    const token = getDriveAccessToken();
    if (!token) {
      setHasAccessToken(false);
      return;
    }

    setRestoringFileId(file.id);
    setStatusMessage(null);
    try {
      const rawText = await downloadDriveFileText(token, file);
      const parsed = parseLibraryBackupPayload(rawText);
      if (!parsed) {
        setStatusMessage({
          tone: 'error',
          text: `"${file.name}" is not a valid CrateSync library manifest.`,
        });
        return;
      }

      setPendingAction({
        kind: 'restore-backup',
        fileName: file.name,
        backup: parsed,
        mode,
      });
    } catch (err) {
      handleDriveApiError(err, `Failed to read "${file.name}" from Google Drive.`);
    } finally {
      setRestoringFileId(null);
    }
  };

  const handleImportDrivePlaylistFile = async (file: DriveFileItem) => {
    const token = getDriveAccessToken();
    if (!token) {
      setHasAccessToken(false);
      return;
    }

    setImportingFileId(file.id);
    setStatusMessage(null);
    try {
      const rawText = await downloadDriveFileText(token, file);
      const fullBackup = parseLibraryBackupPayload(rawText);
      if (fullBackup) {
        setPendingAction({
          kind: 'restore-backup',
          fileName: file.name,
          backup: fullBackup,
          mode: 'merge',
        });
        return;
      }

      const { suggestedName, tracks: seeds } = parseImportedText(rawText, file.name);
      if (seeds.length === 0) {
        setStatusMessage({
          tone: 'error',
          text: `No valid playlist tracks were detected in "${file.name}".`,
        });
        return;
      }

      const finalName = targetPlaylistName.trim() || suggestedName;
      onImportPlaylist(finalName, seeds);
      setTargetPlaylistName('');
      setStatusMessage({
        tone: 'success',
        text: `Imported ${seeds.length} tracks from Google Drive ("${file.name}") into "${finalName}".`,
      });
      onNotify?.({
        title: 'Playlist imported from Google Drive',
        description: `${finalName} · ${seeds.length} tracks`,
        tone: 'success',
      });
    } catch (err) {
      handleDriveApiError(err, `Failed to import "${file.name}" from Google Drive.`);
    } finally {
      setImportingFileId(null);
    }
  };

  const handleRequestSyncMappings = (targetMappings: DriveFolderMapping[]) => {
    const bound = targetMappings.filter((m) => Boolean(m.deviceBindings[currentDevice.id]));
    if (bound.length === 0) return;

    let songsToUploadCount = 0;
    for (const mapping of bound) {
      const binding = mapping.deviceBindings[currentDevice.id];
      if (!binding || binding.syncDirection === 'pull' || !binding.localFolderPath) continue;
      songsToUploadCount += localOnlyTracksWithAudio.filter((t) =>
        trackMatchesLocalFolder(t, binding.localFolderPath)
      ).length;
    }

    setPendingAction({
      kind: 'sync-mapped-folders',
      mappings: bound,
      songsToUploadCount,
    });
  };

  // Execute confirmed action (ALL Drive mutations & destructive actions pass through here)
  const handleConfirmPendingAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);

    if (action.kind === 'clear-device-cache') {
      await onClearAllDeviceCache();
      setStatusMessage({
        tone: 'info',
        text: 'Cleared cached audio from this device. Songs stored in Google Drive download again when played.',
      });
      return;
    }

    if (action.kind === 'restore-backup') {
      onRestoreLibraryBackup(action.backup, action.mode);
      setStatusMessage({
        tone: 'success',
        text: `Synced ${action.backup.stats.trackCount} songs and ${action.backup.stats.playlistCount} playlists from "${action.fileName}".`,
      });
      return;
    }

    const token = getDriveAccessToken();
    if (!token) {
      setHasAccessToken(false);
      return;
    }

    setIsMutating(true);
    setStatusMessage(null);
    cancelBatchRef.current = false;

    try {
      if (action.kind === 'create-drive-folder') {
        const targetParentId =
          action.parentFolderId && action.parentFolderId !== 'root'
            ? action.parentFolderId
            : null;
        const created = await createDriveFolder(token, action.folderName, targetParentId);
        setStatusMessage({
          tone: 'success',
          text: `Created Google Drive folder "${created.name}" inside "${action.parentFolderLabel}". You can now map it to any device folder.`,
        });
        onNotify?.({
          title: 'Google Drive folder created',
          description: `${action.parentFolderLabel}/${created.name}`,
          tone: 'success',
        });
        await refreshDriveData();
      } else if (action.kind === 'sync-mapped-folders') {
        let totalPulledNew = 0;
        let totalUploaded = 0;
        let totalCached = 0;
        const uploadedLinks: Array<{
          trackId: string;
          driveFileId: string;
          driveModifiedTime: string;
          drivePath: string;
        }> = [];
        const uploadedIdByTrackId = new Map<
          string,
          { driveFileId: string; driveModifiedTime: string; drivePath: string }
        >();

        for (let mIdx = 0; mIdx < action.mappings.length; mIdx++) {
          if (cancelBatchRef.current) break;
          const mapping = action.mappings[mIdx];
          const binding = mapping.deviceBindings[currentDevice.id];
          if (!binding) continue;

          // Step A: Push local-only songs in this mapped folder to its mapped Google Drive folder
          if (binding.syncDirection !== 'pull' && binding.localFolderPath) {
            const folderUploads = localOnlyTracksWithAudio.filter((t) =>
              trackMatchesLocalFolder(t, binding.localFolderPath)
            );
            for (let i = 0; i < folderUploads.length; i++) {
              if (cancelBatchRef.current) break;
              const track = folderUploads[i];
              setBatchProgress({
                label: `Pushing "${binding.localFolderPath}" → Drive "${mapping.driveFolderName}"`,
                current: i + 1,
                total: folderUploads.length,
                activeItem: track.fileName,
              });
              const blob =
                (await getCachedAudioBlob(track.fileKey)) ?? (await loadAudioBlob(track.fileKey));
              if (!blob) continue;

              const uploaded = await uploadAudioFileToDrive(token, blob, track.fileName, {
                folderId: mapping.driveFolderId,
                trackId: track.id,
              });
              const link = {
                trackId: track.id,
                driveFileId: uploaded.id,
                driveModifiedTime: uploaded.modifiedTime,
                drivePath: mapping.driveFolderName,
              };
              uploadedLinks.push(link);
              uploadedIdByTrackId.set(track.id, {
                driveFileId: uploaded.id,
                driveModifiedTime: uploaded.modifiedTime,
                drivePath: mapping.driveFolderName,
              });
              // Saved per file: if a later upload fails, the next sync skips the songs already up.
              onLinkUploadedDriveTracks([link]);
              totalUploaded += 1;
            }
          }

          // Step B: Pull Drive audio files from this mapped Drive folder onto this device's mapped path
          if (binding.syncDirection !== 'push') {
            setBatchProgress({
              label: `Pulling Drive "${mapping.driveFolderName}" → ${binding.localFolderPath || 'Offline Cache'}`,
              current: mIdx + 1,
              total: action.mappings.length,
              activeItem: mapping.driveFolderName,
            });
            const folderAudio = await listDriveAudioFiles(token, {
              folderId: mapping.driveFolderId,
              folderLabel: mapping.driveFolderName,
              recursive: true,
              onProgress: (prog) => {
                setBatchProgress({
                  label: `Scanning Drive "${mapping.driveFolderName}" subfolders`,
                  current: prog.scannedFolders,
                  total: Math.max(prog.scannedFolders + prog.queuedFolders, 1),
                  activeItem: `${prog.foundAudio.toLocaleString()} audio files found across ${prog.scannedFolders} folders`,
                });
              },
            });
            const syncResult = onSyncFromDriveSourceOfTruth({
              manifest: null,
              driveAudioFiles: folderAudio,
              folderLabel: mapping.driveFolderName,
              mappedDriveFolderId: mapping.driveFolderId,
              replaceWithSourceOfTruth: false,
            });
            totalPulledNew += syncResult.addedSongs;

            // Step C: Auto-cache offline audio on this playing device when enabled on the binding
            if (binding.autoCacheOffline && folderAudio.length > 0) {
              const audioById = new Map(folderAudio.map((f) => [f.id, f]));
              const toCacheIds = syncResult.syncedTrackIds;
              for (let cIdx = 0; cIdx < toCacheIds.length; cIdx++) {
                if (cancelBatchRef.current) break;
                const tid = toCacheIds[cIdx];
                const existingTrack = trackMap.get(tid);
                const matchingDriveFile = existingTrack?.driveFileId
                  ? audioById.get(existingTrack.driveFileId)
                  : folderAudio[cIdx];
                if (!matchingDriveFile) continue;

                const fileKeyCandidate = existingTrack?.fileKey ?? `gdrive::${matchingDriveFile.id}`;
                if (hasPlayableFile(fileKeyCandidate)) continue;

                setBatchProgress({
                  label: `Auto-caching "${mapping.driveFolderName}" offline`,
                  current: cIdx + 1,
                  total: toCacheIds.length,
                  activeItem: matchingDriveFile.name,
                });
                const blob = await downloadDriveAudioBlob(
                  token,
                  matchingDriveFile.id,
                  inferAudioMimeFromName(matchingDriveFile.name)
                );
                await onCacheDriveTrackAudio(tid, blob, matchingDriveFile);
                totalCached += 1;
              }
            }
          }

          onMarkMappingSynced(mapping.id, currentDevice.id);
        }

        if (uploadedLinks.length > 0) {
          // Also persist updated canonical manifest with new driveFileIds + folder mappings
          const rootFolder = await findOrCreateCrateSyncFolder(token);
          const updatedTracks = tracks.map((t) => {
            const link = uploadedIdByTrackId.get(t.id);
            return link ? { ...t, ...link } : t;
          });
          const existingManifestId =
            canonicalManifest?.appProperties?.cratesyncType === 'source-of-truth' ||
            canonicalManifest?.name === CRATESYNC_CANONICAL_MANIFEST_NAME
              ? canonicalManifest.id
              : null;
          const merged = await mergeManifestBeforeWrite(token, existingManifestId, updatedTracks);
          const payload = buildMergedManifestPayload(merged, {
            id: selectedFolderId || rootFolder.id,
            name: selectedFolderId ? selectedFolderLabel : rootFolder.name,
          });
          await syncCanonicalManifestToDrive(token, payload, {
            existingFileId: existingManifestId,
            parentFolderId: rootFolder.id,
          });
        }

        const folderCount = action.mappings.length;
        setStatusMessage({
          tone: 'success',
          text: `Synced ${folderCount} mapped folder${folderCount === 1 ? '' : 's'}: ${totalPulledNew} pulled · ${totalUploaded} pushed · ${totalCached} cached offline.`,
        });
        onNotify?.({
          title: 'Mapped folders synced',
          description: `${folderCount} folder${folderCount === 1 ? '' : 's'} · ${totalPulledNew} pulled · ${totalUploaded} uploaded · ${totalCached} cached`,
          tone: 'success',
        });
        await refreshDriveData();
      } else if (action.kind === 'pull-source-of-truth') {
        let parsedManifest: CrateSyncLibraryBackupPayload | null = null;
        if (action.manifestFile) {
          const rawManifest = await downloadDriveFileText(token, action.manifestFile);
          parsedManifest = parseLibraryBackupPayload(rawManifest);
        }

        let latestAudio = driveAudioFiles;
        if (latestAudio.length === 0) {
          latestAudio = await listDriveAudioFiles(token, {
            folderId: selectedFolderId || null,
            folderLabel: action.folderLabel,
            recursive: true,
            onProgress: (prog) => {
              setBatchProgress({
                label: `Scanning "${action.folderLabel}" in Google Drive`,
                current: prog.scannedFolders,
                total: Math.max(prog.scannedFolders + prog.queuedFolders, 1),
                activeItem: `${prog.foundAudio.toLocaleString()} audio files discovered`,
              });
            },
          });
          setDriveAudioFiles(latestAudio);
        }

        const summary = onSyncFromDriveSourceOfTruth({
          manifest: parsedManifest,
          driveAudioFiles: latestAudio,
          folderLabel: action.folderLabel,
          mappedDriveFolderId: selectedFolderId || (activeMirrorBinding ? 'root' : null),
          replaceWithSourceOfTruth: action.replaceMode,
        });

        setStatusMessage({
          tone: 'success',
          text: `Synced from Google Drive source of truth: ${summary.addedSongs} new song${summary.addedSongs === 1 ? '' : 's'}, ${summary.updatedSongs} linked, ${summary.playlistCount} playlist${summary.playlistCount === 1 ? '' : 's'}.`,
        });
        onNotify?.({
          title: 'Synced from Google Drive',
          description: `${latestAudio.length} Drive audio file${latestAudio.length === 1 ? '' : 's'} · ${summary.playlistCount} playlists`,
          tone: 'success',
        });
      } else if (action.kind === 'push-source-of-truth') {
        const defaultFolder = await findOrCreateCrateSyncFolder(token);
        const uploadedLinks: Array<{
          trackId: string;
          driveFileId: string;
          driveModifiedTime: string;
          drivePath: string;
        }> = [];
        const uploadedIdByTrackId = new Map<
          string,
          { driveFileId: string; driveModifiedTime: string; drivePath: string }
        >();

        // 1. Upload local-only audio files — routing mapped local folders to their mapped Drive folders
        const songsToUpload = action.localSongsToUpload;
        for (let i = 0; i < songsToUpload.length; i++) {
          if (cancelBatchRef.current) break;
          const track = songsToUpload[i];
          const mappedDest = resolveDriveMappingForLocalTrack(
            track,
            folderMappings,
            currentDevice.id
          );
          const targetDriveFolderId = mappedDest?.mapping.driveFolderId ?? defaultFolder.id;
          const targetDriveFolderName = mappedDest?.mapping.driveFolderName ?? defaultFolder.name;

          setBatchProgress({
            label: `Uploading songs to "${targetDriveFolderName}" in Google Drive`,
            current: i + 1,
            total: songsToUpload.length,
            activeItem: track.fileName,
          });

          const blob =
            (await getCachedAudioBlob(track.fileKey)) ?? (await loadAudioBlob(track.fileKey));
          if (!blob) continue;

          const uploadedFile = await uploadAudioFileToDrive(token, blob, track.fileName, {
            folderId: targetDriveFolderId,
            trackId: track.id,
          });
          const link = {
            trackId: track.id,
            driveFileId: uploadedFile.id,
            driveModifiedTime: uploadedFile.modifiedTime,
            drivePath: targetDriveFolderName,
          };
          uploadedLinks.push(link);
          uploadedIdByTrackId.set(track.id, {
            driveFileId: uploadedFile.id,
            driveModifiedTime: uploadedFile.modifiedTime,
            drivePath: targetDriveFolderName,
          });
          // Saved per file: if a later upload fails, the next push skips the songs already up.
          onLinkUploadedDriveTracks([link]);
        }

        // 2. Build canonical manifest including newly assigned driveFileIds + cross-device folder mappings
        const updatedTracksForManifest = tracks.map((t) => {
          const link = uploadedIdByTrackId.get(t.id);
          return link ? { ...t, ...link } : t;
        });

        setBatchProgress({
          label: 'Writing canonical catalog & folder mappings to Google Drive',
          current: 1,
          total: 1,
          activeItem: CRATESYNC_CANONICAL_MANIFEST_NAME,
        });

        const merged = await mergeManifestBeforeWrite(
          token,
          action.existingManifestId,
          updatedTracksForManifest
        );
        const payload = buildMergedManifestPayload(merged, {
          id: selectedFolderId || defaultFolder.id,
          name: selectedFolderId ? selectedFolderLabel : defaultFolder.name,
        });
        const mappingCount = merged.folderMappings.length;
        const keptFromOthers = describeCarriedOver(merged.carriedOver);

        const syncedManifest = await syncCanonicalManifestToDrive(token, payload, {
          existingFileId: action.existingManifestId,
          parentFolderId: defaultFolder.id,
        });

        setStatusMessage({
          tone: 'success',
          text:
            uploadedLinks.length > 0
              ? `Pushed ${uploadedLinks.length} song${uploadedLinks.length === 1 ? '' : 's'} and updated "${syncedManifest.name}" in Google Drive (${payload.stats.trackCount} songs · ${payload.stats.playlistCount} playlists · ${mappingCount} folder mapping${mappingCount === 1 ? '' : 's'}). ${keptFromOthers}`.trim()
              : `Updated "${syncedManifest.name}" in Google Drive (${payload.stats.trackCount} songs · ${payload.stats.playlistCount} playlists · ${mappingCount} folder mapping${mappingCount === 1 ? '' : 's'}). ${keptFromOthers}`.trim(),
        });
        onNotify?.({
          title: 'Google Drive source of truth updated',
          description:
            uploadedLinks.length > 0
              ? `Uploaded ${uploadedLinks.length} audio file${uploadedLinks.length === 1 ? '' : 's'} + synced ${payload.stats.playlistCount} playlists`
              : `${payload.stats.trackCount} songs · ${payload.stats.playlistCount} playlists`,
          tone: 'success',
        });
        await refreshDriveData();
      } else if (action.kind === 'upload-playlist') {
        const folder = await findOrCreateCrateSyncFolder(token);
        const playlistTracks = action.playlist.trackIds
          .map((id) => trackMap.get(id))
          .filter((t): t is LocalTrack => Boolean(t));

        let content: string;
        let mimeType: string;
        if (action.format === 'csv') {
          content = exportPlaylistToCSV(action.playlist, playlistTracks);
          mimeType = 'text/csv';
        } else if (action.format === 'm3u8') {
          content = exportPlaylistToM3U8(action.playlist, playlistTracks);
          mimeType = 'audio/x-mpegurl';
        } else {
          content = exportPlaylistToJSON(action.playlist, playlistTracks);
          mimeType = 'application/json';
        }

        const uploaded = await uploadPlaylistExportToDrive(token, {
          fileName: action.fileName,
          content,
          mimeType,
          playlistName: action.playlist.name,
          trackCount: playlistTracks.length,
          parentFolderId: folder.id,
        });

        setStatusMessage({
          tone: 'success',
          text: `Saved playlist "${uploaded.name}" inside "${folder.name}" on Google Drive (${playlistTracks.length} tracks).`,
        });
        onNotify?.({
          title: 'Playlist saved to Google Drive',
          description: `${uploaded.name} · ${playlistTracks.length} tracks`,
          tone: 'success',
        });
        await refreshDriveData();
      } else if (action.kind === 'delete-backup') {
        await deleteDriveFile(token, action.file.id);
        setStatusMessage({
          tone: 'info',
          text: `Deleted "${action.file.name}" from Google Drive.`,
        });
        onNotify?.({
          title: 'Cloud file deleted',
          description: action.file.name,
          tone: 'neutral',
        });
        await refreshDriveData();
      }
    } catch (err) {
      handleDriveApiError(err, 'Google Drive sync operation failed.');
    } finally {
      setBatchProgress(null);
      setIsMutating(false);
      cancelBatchRef.current = false;
    }
  };

  const confirmModalCopy = useMemo(() => {
    if (!pendingAction) {
      return { title: '', message: '', confirmLabel: 'Confirm', destructive: false };
    }
    switch (pendingAction.kind) {
      case 'push-source-of-truth':
        return {
          title: 'Push library to Google Drive source of truth?',
          message: `${
            pendingAction.localSongsToUpload.length > 0
              ? `Upload ${pendingAction.localSongsToUpload.length} local audio file${pendingAction.localSongsToUpload.length === 1 ? '' : 's'} into "${CRATESYNC_DRIVE_FOLDER_NAME}" in Google Drive and update "${CRATESYNC_CANONICAL_MANIFEST_NAME}" with ${pendingAction.trackCount} songs, ${pendingAction.playlistCount} playlists, and ${pendingAction.smartPlaylistCount} smart playlists so all playing devices stay in sync.`
              : `${pendingAction.existingManifestId ? 'Update' : 'Create'} "${CRATESYNC_CANONICAL_MANIFEST_NAME}" in "${CRATESYNC_DRIVE_FOLDER_NAME}" on Google Drive with ${pendingAction.trackCount} songs, ${pendingAction.playlistCount} playlists, and ${pendingAction.smartPlaylistCount} smart playlists.`
          } What other devices pushed stays in Drive. Where both changed the same song or playlist, the newer edit wins.`,
          confirmLabel:
            pendingAction.localSongsToUpload.length > 0
              ? `Upload ${pendingAction.localSongsToUpload.length} Song${pendingAction.localSongsToUpload.length === 1 ? '' : 's'} & Sync`
              : 'Push Catalog to Drive',
          destructive: false,
        };
      case 'pull-source-of-truth': {
        const localDestText = activeMirrorBinding?.localFolderPath
          ? ` into local folder "${activeMirrorBinding.localFolderPath}" on ${currentDevice.name}`
          : ` onto ${currentDevice.name} (IndexedDB offline cache)`;
        return {
          title: pendingAction.replaceMode
            ? 'Replace local catalog with Google Drive source of truth?'
            : 'Pull latest songs & playlists from Google Drive?',
          message: pendingAction.replaceMode
            ? `Mirror Google Drive (${pendingAction.driveAudioCount.toLocaleString()} audio file${pendingAction.driveAudioCount === 1 ? '' : 's'} in ${pendingAction.folderLabel}${pendingAction.manifestFile ? ` + "${pendingAction.manifestFile.name}"` : ''})${localDestText}. Existing cached offline audio files on this device will stay linked.`
            : `Pull ${pendingAction.driveAudioCount.toLocaleString()} Drive audio file${pendingAction.driveAudioCount === 1 ? '' : 's'} (${pendingAction.folderLabel})${pendingAction.manifestFile ? ` and playlists from "${pendingAction.manifestFile.name}"` : ''}${localDestText} without deleting local-only entries.`,
          confirmLabel: pendingAction.replaceMode ? 'Mirror from Drive' : 'Pull from Drive',
          destructive: false,
        };
      }
      case 'upload-playlist':
        return {
          title: `Save "${pendingAction.fileName}" to Google Drive?`,
          message: `Upload "${pendingAction.playlist.name}" (${pendingAction.trackCount} tracks) as a ${pendingAction.format.toUpperCase()} file inside "${CRATESYNC_DRIVE_FOLDER_NAME}" on Google Drive.`,
          confirmLabel: 'Save to Drive',
          destructive: false,
        };
      case 'delete-backup':
        return {
          title: `Delete "${pendingAction.file.name}" from Google Drive?`,
          message:
            'This permanently deletes this CrateSync file from Google Drive. Your local cached songs and device catalog remain untouched.',
          confirmLabel: 'Delete from Drive',
          destructive: true,
        };
      case 'restore-backup':
        return {
          title:
            pendingAction.mode === 'replace'
              ? `Replace device library with "${pendingAction.fileName}"?`
              : `Merge "${pendingAction.fileName}" into this device?`,
          message:
            pendingAction.mode === 'replace'
              ? `Replace this device's tracks and playlists with ${pendingAction.backup.stats.trackCount} songs and ${pendingAction.backup.stats.playlistCount} playlists from Google Drive.`
              : `Merge ${pendingAction.backup.stats.trackCount} songs, ${pendingAction.backup.stats.playlistCount} playlists, and ${pendingAction.backup.stats.smartPlaylistCount} smart playlists from Google Drive into this device.`,
          confirmLabel: pendingAction.mode === 'replace' ? 'Replace Catalog' : 'Merge Catalog',
          destructive: pendingAction.mode === 'replace',
        };
      case 'clear-device-cache':
        return {
          title: 'Clear cached offline audio on this playing device?',
          message: clearDeviceCacheMessage({
            cachedCount: pendingAction.cachedCount,
            withoutDriveCopyCount: pendingAction.withoutDriveCopyCount,
            sizeLabel: formatFileSize(pendingAction.totalBytes),
          }),
          confirmLabel: 'Clear Device Cache',
          destructive: true,
        };
      case 'create-drive-folder':
        return {
          title: `Create "${pendingAction.folderName}" in Google Drive?`,
          message: `Create a new folder named "${pendingAction.folderName}" inside "${pendingAction.parentFolderLabel}" in your Google Drive so you can map local device folders to it.`,
          confirmLabel: 'Create Drive Folder',
          destructive: false,
        };
      case 'sync-mapped-folders':
        return {
          title:
            pendingAction.mappings.length === 1
              ? `Sync mapped folder "${pendingAction.mappings[0].driveFolderName}"?`
              : `Sync ${pendingAction.mappings.length} mapped folders with Google Drive?`,
          message:
            pendingAction.songsToUploadCount > 0
              ? `Sync ${pendingAction.mappings.length} mapped folder${pendingAction.mappings.length === 1 ? '' : 's'} on ${currentDevice.name}, including uploading ${pendingAction.songsToUploadCount} local song${pendingAction.songsToUploadCount === 1 ? '' : 's'} into their mapped Google Drive folders and caching Drive audio offline where auto-cache is enabled.`
              : `Pull audio from ${pendingAction.mappings.length} mapped Google Drive folder${pendingAction.mappings.length === 1 ? '' : 's'} onto ${currentDevice.name}'s configured local paths and auto-cache offline audio where enabled.`,
          confirmLabel: 'Sync Mapped Folders',
          destructive: false,
        };
    }
  }, [pendingAction, currentDevice.name, activeMirrorBinding]);

  const isConnected = Boolean(user && hasAccessToken);

  return (
    <section
      aria-label="Google Drive Source of Truth Sync and Device Cache"
      className="rounded-lg border border-white/[0.08] bg-[#12141A] overflow-hidden"
    >
      {/* Top Source-of-Truth Header & Live Status Strip */}
      <div className="p-6 border-b border-white/[0.08] space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <Cloud className="h-5 w-5 text-[#FF1F3D] shrink-0" />
              <h2 className="font-display text-lg font-semibold text-white">
                Google Drive Source of Truth &amp; Device Cache
              </h2>
            </div>
            <p className="text-xs text-[#8B92A2] leading-relaxed max-w-2xl">
              Google Drive stores your master songs, playlists, smart playlists, and YouTube
              matches. Playing devices sync from Drive and cache audio locally in IndexedDB for
              instant offline playback.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {isConnected ? (
              <>
                <button
                  type="button"
                  onClick={() => void refreshDriveData()}
                  disabled={isLoadingDrive || isMutating}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-[#D1D5DB] bg-[#1B1F28] border border-white/[0.09] hover:text-white hover:bg-[#232834] disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoadingDrive ? 'animate-spin' : ''}`} />
                  <span>Refresh Drive</span>
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={authLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-[#9CA3AF] hover:text-white hover:bg-white/[0.06] disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Disconnect</span>
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={authLoading}
                  className="inline-flex items-center gap-2.5 px-4 py-2 rounded-md bg-[#131314] border border-[#8E918F] text-[#E3E3E3] hover:bg-[#1E1F21] text-xs font-medium transition-colors disabled:opacity-60 whitespace-nowrap"
                >
                  {authLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#E3E3E3]" />
                  ) : (
                    <GoogleGLogo className="h-4 w-4 shrink-0" />
                  )}
                  <span>Sign in with Google</span>
                </button>
                {user && !hasAccessToken && (
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={authLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-[#9CA3AF] hover:text-white hover:bg-white/[0.06] transition-colors whitespace-nowrap"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Sign out</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 3-Column Source-of-Truth & Playing Device Telemetry Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-white/[0.06]">
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-[#6B7280] font-medium">
              Source of Truth (Google Drive)
            </div>
            <div className="flex items-center gap-2 text-xs text-white min-w-0">
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  isConnected ? 'bg-[#22C55E]' : user ? 'bg-[#F59E0B]' : 'bg-[#525866]'
                }`}
              />
              <span className="font-medium truncate">
                {isConnected
                  ? user?.email || user?.displayName || 'Connected'
                  : user
                    ? `${user.email || user.displayName} (Reconnect needed)`
                    : 'Not connected'}
              </span>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-[#8B92A2]">
              {isConnected
                ? `${driveAudioFiles.length} Drive audio · ${canonicalManifestTime ? `Synced ${formatRelativeTime(canonicalManifestTime)}` : 'No manifest yet'}`
                : 'Local offline playback still active'}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-[#6B7280] font-medium">
              Sync Status
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              {syncStatus.tone === 'synced' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />
              ) : syncStatus.tone === 'warning' ? (
                <CloudUpload className="h-3.5 w-3.5 text-[#F59E0B] shrink-0" />
              ) : (
                <CloudOff className="h-3.5 w-3.5 text-[#6B7280] shrink-0" />
              )}
              <span
                className={
                  syncStatus.tone === 'synced'
                    ? 'text-[#22C55E] font-medium'
                    : syncStatus.tone === 'warning'
                      ? 'text-[#F59E0B] font-medium'
                      : 'text-[#9CA3AF]'
                }
              >
                {syncStatus.label}
              </span>
            </div>
            <div className="text-[11px] text-[#8B92A2] truncate" title={syncStatus.detail}>
              {syncStatus.detail}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wider text-[#6B7280] font-medium">
                This Playing Device Cache
              </span>
              <span className="text-[11px] font-mono tabular-nums text-[#D1D5DB]">
                {formatFileSize(deviceCacheBytes)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono tabular-nums">
              <span className="text-white">
                {cachedSongsCount} / {tracks.length} songs cached offline
              </span>
              <span className="text-[#8B92A2]">{cacheCoveragePct}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className="h-full bg-[#22C55E] transition-all duration-300"
                style={{ width: `${cacheCoveragePct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Live Recursive Google Drive Folder Scan Progress */}
        {isLoadingDrive && driveScanProgress && !batchProgress && (
          <div className="p-3.5 rounded-md bg-[#0B0C0E] border border-white/[0.1] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0 text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FF1F3D] shrink-0" />
              <span className="text-white font-medium truncate">
                Scanning &ldquo;{driveScanProgress.folderLabel}&rdquo; &amp; nested subfolders...
              </span>
              <span className="font-mono tabular-nums text-[#9CA3AF] shrink-0">
                {driveScanProgress.foundAudio.toLocaleString()} songs ·{' '}
                {driveScanProgress.scannedFolders.toLocaleString()} folders
              </span>
            </div>
            <button
              type="button"
              onClick={() => scanAbortRef.current?.abort()}
              className="inline-flex items-center gap-1 text-xs text-[#FCA5A5] hover:text-white transition-colors shrink-0 self-end sm:self-auto"
            >
              <X className="h-3.5 w-3.5" />
              <span>Stop Scan</span>
            </button>
          </div>
        )}

        {/* Batch Upload / Offline Caching Progress Bar */}
        {batchProgress && (
          <div className="p-3.5 rounded-md bg-[#0B0C0E] border border-white/[0.1] space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FF1F3D] shrink-0" />
                <span className="text-white font-medium truncate">{batchProgress.label}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono tabular-nums text-[#9CA3AF]">
                  {batchProgress.current} / {batchProgress.total}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    cancelBatchRef.current = true;
                  }}
                  className="inline-flex items-center gap-1 text-[#FCA5A5] hover:text-white transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Stop</span>
                </button>
              </div>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className="h-full bg-[#FF1F3D] transition-all duration-150"
                style={{
                  width: `${Math.round((batchProgress.current / Math.max(1, batchProgress.total)) * 100)}%`,
                }}
              />
            </div>
            <div className="text-[11px] font-mono text-[#8B92A2] truncate">
              {batchProgress.activeItem}
            </div>
          </div>
        )}

        {/* Tag read progress */}
        {tagReadProgress && (
          <div className="p-3.5 rounded-md bg-[#0B0C0E] border border-white/[0.1] space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FF1F3D] shrink-0" />
                <span className="text-white font-medium truncate">
                  {describeTagReadProgress(tagReadProgress)}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono tabular-nums text-[#9CA3AF]">
                  {formatFileSize(tagReadProgress.bytes)}
                </span>
                <button
                  type="button"
                  onClick={() => tagReadAbortRef.current?.abort()}
                  className="inline-flex items-center gap-1 text-[#FCA5A5] hover:text-white transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Stop</span>
                </button>
              </div>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className="h-full bg-[#FF1F3D] transition-all duration-150"
                style={{
                  width: `${Math.round((tagReadProgress.done / Math.max(1, tagReadProgress.total)) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        {authError && (
          <div className="px-3.5 py-2.5 rounded-md bg-[#2A1216] border border-[#FF1F3D]/30 text-xs text-[#FCA5A5]">
            {authError}
          </div>
        )}

        {statusMessage && (
          <div
            className={`px-3.5 py-2.5 rounded-md border text-xs ${
              statusMessage.tone === 'success'
                ? 'bg-[#0F2217] border-[#22C55E]/30 text-[#86EFAC]'
                : statusMessage.tone === 'error'
                  ? 'bg-[#2A1216] border-[#FF1F3D]/30 text-[#FCA5A5]'
                  : 'bg-[#161A22] border-white/[0.1] text-[#D1D5DB]'
            }`}
          >
            {statusMessage.text}
          </div>
        )}
      </div>

      {/* Connected Source-of-Truth Controls & Tabbed Workspace */}
      {isConnected ? (
        <div>
          {/* Primary Sync Action Bar */}
          <div className="px-6 py-4 bg-[#0E1015] border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={isMutating || isLoadingDrive}
                onClick={() => handleRequestPullFromDrive(false)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <CloudDownload className="h-3.5 w-3.5" />
                <span>Pull from Drive</span>
              </button>

              <button
                type="button"
                disabled={isMutating || isLoadingDrive}
                onClick={handleRequestPushToDrive}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.1] hover:bg-[#232834] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <CloudUpload className="h-3.5 w-3.5 text-[#9CA3AF]" />
                <span>
                  Push to Drive
                  {localOnlyTracksWithAudio.length > 0
                    ? ` (+${localOnlyTracksWithAudio.length} audio)`
                    : ''}
                </span>
              </button>

              <button
                type="button"
                disabled={isMutating || uncachedDriveTracks.length === 0}
                onClick={() =>
                  void handleBatchCacheTracks(
                    uncachedDriveTracks,
                    'Caching Google Drive songs onto this device'
                  )
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.1] hover:bg-[#232834] disabled:opacity-45 transition-colors whitespace-nowrap"
              >
                <HardDrive className="h-3.5 w-3.5 text-[#22C55E]" />
                <span>
                  Cache Offline ({uncachedDriveTracks.length})
                </span>
              </button>

              <button
                type="button"
                disabled={isMutating || tagReadCount === 0}
                onClick={() => void handleReadTags()}
                title="Reads the title, artist, album, cover art and length of each Google Drive song from the start of its file, without downloading the song."
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.1] hover:bg-[#232834] disabled:opacity-45 transition-colors whitespace-nowrap"
              >
                <Tags className="h-3.5 w-3.5 text-[#22C55E]" />
                <span>Read Tags ({tagReadCount})</span>
              </button>

              {storedAudioKeys.size > 0 && (
                <button
                  type="button"
                  disabled={isMutating}
                  onClick={() =>
                    setPendingAction({
                      kind: 'clear-device-cache',
                      ...summarizeDeviceCache(tracks, storedAudioKeys),
                      totalBytes: deviceCacheBytes,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-[#9CA3AF] hover:text-[#FCA5A5] hover:bg-[#2A1216] disabled:opacity-45 transition-colors whitespace-nowrap"
                >
                  <Database className="h-3.5 w-3.5" />
                  <span>Clear Device Cache</span>
                </button>
              )}
            </div>

            {/* Sub-Navigation Tabs */}
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-md bg-[#14171F] border border-white/[0.08]">
              <button
                type="button"
                onClick={() => setActiveTab('songs-cache')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'songs-cache'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                Songs &amp; Cache
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('folder-mappings')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'folder-mappings'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                Folder Mappings{folderMappings.length > 0 ? ` (${folderMappings.length})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('playlists-snapshots')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'playlists-snapshots'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                Playlists &amp; Snapshots
              </button>
            </div>
          </div>

          {activeTab === 'folder-mappings' ? (
            <FolderMappingsPanel
              accessToken={getDriveAccessToken()}
              currentDevice={currentDevice}
              devices={devices}
              folderMappings={folderMappings}
              driveFolders={driveFolders}
              driveRefreshSignal={driveRefreshSignal}
              availableLocalFolders={availableLocalFolders}
              tracks={tracks}
              isMutating={isMutating}
              onRenameCurrentDevice={onRenameCurrentDevice}
              onSaveFolderMapping={onSaveFolderMapping}
              onUnbindDeviceFromMapping={onUnbindDeviceFromMapping}
              onDeleteFolderMapping={onDeleteFolderMapping}
              onRequestCreateDriveFolder={({ folderName, parentFolderId, parentFolderLabel }) =>
                setPendingAction({
                  kind: 'create-drive-folder',
                  folderName,
                  parentFolderId,
                  parentFolderLabel,
                })
              }
              onRequestSyncMapping={(mapping) => handleRequestSyncMappings([mapping])}
              onRequestSyncAllMappings={() => handleRequestSyncMappings(folderMappings)}
              onDriveAuthError={(err) =>
                handleDriveApiError(err, 'Failed to browse Google Drive folders.')
              }
              onIngestLocalFolderEntries={onIngestLocalFolderEntries}
            />
          ) : activeTab === 'songs-cache' ? (
            <div className="p-6 space-y-5">
              {/* Drive Folder Scope + Playlist Offline Cache Bar */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="p-4 rounded-md bg-[#0B0C0E] border border-white/[0.07] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="drive-folder-scope"
                      className="text-xs font-medium text-[#D1D5DB] flex items-center gap-1.5"
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-[#9CA3AF]" />
                      <span>Google Drive Music Folder (My Drive)</span>
                    </label>
                    <span className="text-[11px] font-mono tabular-nums text-[#8B92A2]">
                      {driveAudioFiles.length.toLocaleString()} audio file
                      {driveAudioFiles.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      id="drive-folder-scope"
                      value={selectedFolderId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        const nextLabel =
                          !nextId
                            ? 'All Google Drive'
                            : nextId === 'root'
                              ? 'My Drive'
                              : driveFolders.find((f) => f.id === nextId)?.name || 'Google Drive';
                        setSelectedFolderId(nextId);
                        setSelectedFolderCustomLabel(null);
                        setDriveAudioFiles([]);
                        void refreshDriveData({ folderId: nextId, folderLabel: nextLabel });
                      }}
                      className="flex-1 min-w-0 px-3 py-2 rounded-md bg-[#12141A] border border-white/[0.1] text-xs text-white focus:border-[#FF1F3D] focus:outline-none"
                    >
                      <option value="">All Google Drive Audio</option>
                      <option value="root">My Drive (Root)</option>
                      {selectedFolderId &&
                        selectedFolderId !== 'root' &&
                        !driveFolders.some((f) => f.id === selectedFolderId) && (
                          <option value={selectedFolderId}>
                            {selectedFolderCustomLabel || selectedFolderId}
                          </option>
                        )}
                      {driveFolders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setScopeBrowserOpen(true)}
                      title="Browse My Drive subfolders and Shared with me"
                      className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md text-xs font-medium text-[#D1D5DB] bg-[#1B1F28] border border-white/[0.09] hover:text-white hover:bg-[#232834] transition-colors whitespace-nowrap"
                    >
                      <Cloud className="h-3.5 w-3.5 text-[#FF1F3D]" />
                      <span>Browse</span>
                    </button>
                    <button
                      type="button"
                      disabled={isMutating || isLoadingDrive}
                      onClick={() => handleRequestPullFromDrive(true)}
                      title="Replace local device catalog with Google Drive source of truth"
                      className="px-3 py-2 rounded-md text-xs font-medium text-[#D1D5DB] bg-[#1B1F28] border border-white/[0.09] hover:text-white hover:bg-[#232834] disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      Mirror Drive
                    </button>
                  </div>

                  {/* Mirrored Local Folder Selector & Count on This Device */}
                  <div className="pt-2.5 border-t border-white/[0.06] space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#D1D5DB] flex items-center gap-1.5">
                        <HardDrive className="h-3.5 w-3.5 text-[#9CA3AF] shrink-0" />
                        <span>Mirrored Local Folder</span>
                      </span>
                      <span className="text-[11px] font-mono tabular-nums text-[#8B92A2]">
                        {mirroredLocalStats.isLocalFolder
                          ? `${mirroredLocalStats.total.toLocaleString()} local file${mirroredLocalStats.total === 1 ? '' : 's'}${
                              mirroredLocalStats.linkedToDrive > 0
                                ? ` · ${mirroredLocalStats.linkedToDrive.toLocaleString()} synced`
                                : ''
                            }`
                          : `${mirroredLocalStats.total.toLocaleString()} cached file${mirroredLocalStats.total === 1 ? '' : 's'}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-mono truncate ${
                          activeMirrorBinding?.localFolderPath ? 'text-white' : 'text-[#6B7280]'
                        }`}
                        title={
                          activeMirrorBinding?.localFolderPath ||
                          'IndexedDB Offline Cache (no local folder bound yet)'
                        }
                      >
                        {activeMirrorBinding?.localFolderPath || 'IndexedDB Offline Cache'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setLocalMirrorBrowserOpen(true)}
                        title={`Select local folder on ${currentDevice.name} to mirror with ${activeMirrorDriveFolderName}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-[#D1D5DB] bg-[#1B1F28] border border-white/[0.09] hover:text-white hover:bg-[#232834] transition-colors whitespace-nowrap shrink-0"
                      >
                        <FolderOpen className="h-3 w-3 text-[#FF1F3D]" />
                        <span>
                          {activeMirrorBinding?.localFolderPath ? 'Change' : 'Select Local Folder'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Cache Specific Playlist Offline */}
                <div className="p-4 rounded-md bg-[#0B0C0E] border border-white/[0.07] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="cache-pl-offline"
                      className="text-xs font-medium text-[#D1D5DB] flex items-center gap-1.5"
                    >
                      <HardDrive className="h-3.5 w-3.5 text-[#22C55E]" />
                      <span>Cache Playlist to This Device</span>
                    </label>
                    <span className="text-[11px] font-mono tabular-nums text-[#8B92A2]">
                      Offline playback
                    </span>
                  </div>
                  {playlists.length === 0 ? (
                    <p className="text-xs text-[#6B7280] py-1">
                      Pull or create a playlist to cache its songs offline on this device.
                    </p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <select
                        id="cache-pl-offline"
                        value={selectedCachePlaylistId}
                        onChange={(e) => setSelectedCachePlaylistId(e.target.value)}
                        className="flex-1 min-w-0 px-3 py-2 rounded-md bg-[#12141A] border border-white/[0.1] text-xs text-white focus:border-[#FF1F3D] focus:outline-none"
                      >
                        {playlists.map((pl) => {
                          const plCached = pl.trackIds.filter((id) => {
                            const t = trackMap.get(id);
                            return Boolean(t && hasPlayableFile(t.fileKey));
                          }).length;
                          return (
                            <option key={pl.id} value={pl.id}>
                              {pl.name} ({plCached}/{pl.trackIds.length} cached)
                            </option>
                          );
                        })}
                      </select>
                      <button
                        type="button"
                        disabled={isMutating || !selectedCachePlaylistId}
                        onClick={handleCacheSelectedPlaylistOffline}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#232834] disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        <CloudDownload className="h-3.5 w-3.5 text-[#22C55E]" />
                        <span>Cache</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Unsynced Drive Audio Notice */}
              {unsyncedRemoteDriveSongs.length > 0 && (
                <div className="px-4 py-3 rounded-md bg-[#1B1710] border border-[#F59E0B]/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="text-xs text-[#FDE68A]">
                    Found{' '}
                    <span className="font-mono tabular-nums font-semibold">
                      {unsyncedRemoteDriveSongs.length}
                    </span>{' '}
                    audio file{unsyncedRemoteDriveSongs.length === 1 ? '' : 's'} in Google Drive (
                    {selectedFolderLabel}) not yet synced to this playing device.
                  </div>
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => handleRequestPullFromDrive(false)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#0B0C0E] bg-[#F59E0B] hover:bg-[#D97706] transition-colors whitespace-nowrap shrink-0"
                  >
                    <CloudDownload className="h-3.5 w-3.5" />
                    <span>Sync {unsyncedRemoteDriveSongs.length} Songs Down</span>
                  </button>
                </div>
              )}

              {/* Searchable Song Sync & Device Cache Table */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                  <div className="text-xs font-medium text-[#D1D5DB]">
                    Library Songs — Drive Sync &amp; Playing Device Cache{' '}
                    {matchingCatalogTracks.length > 0 && (
                      <span className="font-mono tabular-nums text-[#8B92A2] font-normal">
                        ({filteredCatalogTracks.length.toLocaleString()} of{' '}
                        {matchingCatalogTracks.length.toLocaleString()})
                      </span>
                    )}
                  </div>
                  <div className="relative w-full sm:w-72">
                    <Search className="h-3.5 w-3.5 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={songSearchQuery}
                      onChange={(e) => {
                        setSongSearchQuery(e.target.value);
                        setVisibleSongLimit(150);
                      }}
                      placeholder="Filter songs by title, artist, file..."
                      className="w-full pl-8 pr-3 py-1.5 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                    />
                  </div>
                </div>

                {filteredCatalogTracks.length === 0 ? (
                  <div className="py-8 px-4 rounded-md border border-dashed border-white/[0.1] bg-[#0B0C0E] text-center space-y-1.5">
                    <Music2 className="h-4 w-4 text-[#6B7280] mx-auto" />
                    <p className="text-xs text-[#9CA3AF]">
                      {tracks.length === 0
                        ? 'No songs synced on this device yet. Click "Pull from Drive" to sync your Google Drive music catalog.'
                        : 'No songs match your search filter.'}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-md border border-white/[0.07] bg-[#0B0C0E] divide-y divide-white/[0.06] max-h-80 overflow-y-auto">
                    {filteredCatalogTracks.map((track) => {
                      const isCached = hasPlayableFile(track.fileKey);
                      const inDrive = Boolean(track.driveFileId);
                      const isCachingThis = cachingTrackId === track.id;

                      return (
                        <div
                          key={track.id}
                          className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                        >
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] font-mono text-[#6B7280] shrink-0">
                                {track.format}
                              </span>
                              <span className="text-xs font-medium text-white truncate">
                                {track.title}
                              </span>
                            </div>
                            <div className="text-[11px] text-[#8B92A2] truncate flex items-center gap-1.5">
                              <span className="truncate">{track.artist}</span>
                              {track.fileSize > 0 && (
                                <span className="font-mono tabular-nums text-[#6B7280] shrink-0">
                                  · {formatFileSize(track.fileSize)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Crisp Monospace Sync/Cache State (zero pill spam) */}
                          <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono shrink-0">
                            {inDrive && isCached ? (
                              <span className="text-[#22C55E]">Drive · Cached Offline</span>
                            ) : inDrive && !isCached ? (
                              <span className="text-[#9CA3AF]">Drive · Cloud Only</span>
                            ) : isCached ? (
                              <span className="text-[#F59E0B]">Local Only (Unpushed)</span>
                            ) : (
                              <span className="text-[#6B7280]">Metadata Only</span>
                            )}
                          </div>

                          {/* Per-Song Actions */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {(isCached || inDrive) && (
                              <button
                                type="button"
                                onClick={() => onPlayTrack(track.id)}
                                title={
                                  isCached
                                    ? 'Play from local offline cache'
                                    : 'Stream & cache from Google Drive'
                                }
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-[#D1D5DB] hover:text-white hover:bg-white/[0.08] transition-colors"
                              >
                                <Play className="h-3 w-3 fill-current" />
                                <span className="hidden sm:inline">Play</span>
                              </button>
                            )}

                            {inDrive && !isCached && (
                              <button
                                type="button"
                                disabled={isCachingThis || isMutating}
                                onClick={() => void handleCacheSingleTrack(track)}
                                title="Download and cache song onto this device for offline playback"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#232834] disabled:opacity-50 transition-colors whitespace-nowrap"
                              >
                                {isCachingThis ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <CloudDownload className="h-3 w-3 text-[#22C55E]" />
                                )}
                                <span>Cache</span>
                              </button>
                            )}

                            {inDrive && isCached && (
                              <button
                                type="button"
                                disabled={isMutating}
                                onClick={() => void onEvictTrackCache([track.fileKey])}
                                title="Remove offline copy from this device (keeps song in Google Drive)"
                                aria-label={`Evict offline cache for ${track.title}`}
                                className="p-1.5 rounded text-[#6B7280] hover:text-[#FCA5A5] hover:bg-[#2A1216] transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {matchingCatalogTracks.length > visibleSongLimit && (
                      <div className="p-3 text-center bg-[#0E1015]">
                        <button
                          type="button"
                          onClick={() => setVisibleSongLimit((n) => n + 200)}
                          className="px-3.5 py-1.5 rounded text-xs font-medium text-[#D1D5DB] hover:text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#232834] transition-colors"
                        >
                          Show 200 More (
                          {(matchingCatalogTracks.length - visibleSongLimit).toLocaleString()}{' '}
                          remaining)
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Tab 2: Playlists Import/Export & Cloud Manifest Snapshots */
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-white/[0.08]">
              {/* Left: Export Single Playlist + Saved Manifest Snapshots */}
              <div className="p-6 space-y-5">
                {playlists.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="text-xs font-medium text-[#D1D5DB]">
                      Export Playlist File to Google Drive
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <select
                        aria-label="Playlist to save to Google Drive"
                        value={selectedUploadPlaylistId}
                        onChange={(e) => setSelectedUploadPlaylistId(e.target.value)}
                        className="flex-1 min-w-0 px-3 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-xs text-white focus:border-[#FF1F3D] focus:outline-none"
                      >
                        {playlists.map((pl) => (
                          <option key={pl.id} value={pl.id}>
                            {pl.name} ({pl.trackIds.length} tracks)
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Export file format"
                        value={selectedUploadFormat}
                        onChange={(e) =>
                          setSelectedUploadFormat(e.target.value as 'json' | 'm3u8' | 'csv')
                        }
                        className="px-2.5 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-xs font-mono text-white focus:border-[#FF1F3D] focus:outline-none"
                      >
                        <option value="m3u8">M3U8</option>
                        <option value="csv">CSV</option>
                        <option value="json">JSON</option>
                      </select>
                      <button
                        type="button"
                        disabled={isMutating || !selectedUploadPlaylistId}
                        onClick={handleRequestUploadPlaylist}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#232834] disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        <CloudUpload className="h-3.5 w-3.5 text-[#9CA3AF]" />
                        <span>Save</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-white/[0.07] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#D1D5DB]">
                      Source-of-Truth Manifests &amp; Snapshots
                    </span>
                    {lastRefreshedAt && (
                      <span className="text-[11px] font-mono tabular-nums text-[#6B7280]">
                        Checked {formatRelativeTime(lastRefreshedAt)}
                      </span>
                    )}
                  </div>

                  {isLoadingDrive && backups.length === 0 ? (
                    <div className="py-6 flex items-center justify-center gap-2 text-xs text-[#8B92A2]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Loading cloud manifests...</span>
                    </div>
                  ) : backups.length === 0 ? (
                    <p className="text-xs text-[#6B7280] py-3">
                      No CrateSync manifests saved in Google Drive yet. Click &ldquo;Push to
                      Drive&rdquo; above to create the canonical manifest.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {backups.map((file) => {
                        const modMs = Date.parse(file.modifiedTime) || null;
                        const trCount = file.appProperties?.trackCount;
                        const plCount = file.appProperties?.playlistCount;
                        const isCanonical =
                          file.appProperties?.cratesyncType === 'source-of-truth' ||
                          file.name === CRATESYNC_CANONICAL_MANIFEST_NAME;
                        const isRestoring = restoringFileId === file.id;

                        return (
                          <div
                            key={file.id}
                            className="flex items-center justify-between gap-3 p-3 rounded-md bg-[#0B0C0E] border border-white/[0.07]"
                          >
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs font-medium text-white truncate">
                                  {file.name}
                                </span>
                                {isCanonical && (
                                  <span className="text-[10px] font-mono text-[#22C55E] shrink-0">
                                    CANONICAL
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] font-mono tabular-nums text-[#8B92A2] flex flex-wrap items-center gap-x-2">
                                {trCount && <span>{trCount} songs</span>}
                                {plCount && <span>· {plCount} playlists</span>}
                                <span>· {formatFileSize(file.size)}</span>
                                {modMs && <span>· {formatRelativeTime(modMs)}</span>}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                disabled={isRestoring || isMutating}
                                onClick={() => void handlePrepareRestoreBackup(file, 'merge')}
                                title="Merge metadata & playlists into this device"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#232834] disabled:opacity-50 transition-colors whitespace-nowrap"
                              >
                                {isRestoring ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3 w-3 text-[#9CA3AF]" />
                                )}
                                <span>Merge</span>
                              </button>

                              {file.webViewLink && (
                                <a
                                  href={file.webViewLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Open in Google Drive"
                                  className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}

                              <button
                                type="button"
                                disabled={isMutating}
                                onClick={() => setPendingAction({ kind: 'delete-backup', file })}
                                title="Delete file from Google Drive"
                                aria-label={`Delete ${file.name} from Google Drive`}
                                className="p-1.5 rounded text-[#8B92A2] hover:text-[#FCA5A5] hover:bg-[#2A1216] disabled:opacity-50 transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Import External Playlist Files from Drive */}
              <div className="p-6 space-y-4">
                <div className="space-y-1">
                  <h3 className="font-display text-sm font-semibold text-white">
                    Import Playlists from Google Drive
                  </h3>
                  <p className="text-xs text-[#8B92A2] leading-relaxed">
                    Load M3U8, M3U, CSV, JSON, or plain-text playlists stored anywhere in your Drive.
                  </p>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void refreshDriveData({ playlistSearch: playlistSearchQuery });
                  }}
                  className="flex items-center gap-2"
                >
                  <div className="relative flex-1 min-w-0">
                    <Search className="h-3.5 w-3.5 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={playlistSearchQuery}
                      onChange={(e) => setPlaylistSearchQuery(e.target.value)}
                      placeholder="Filter Drive playlists by filename..."
                      className="w-full pl-8 pr-3 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoadingDrive}
                    className="px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#232834] disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    Search
                  </button>
                </form>

                <div className="space-y-1.5">
                  <label htmlFor="drive-import-pl-name" className="block text-xs text-[#9CA3AF]">
                    Imported Playlist Name Override (optional)
                  </label>
                  <input
                    id="drive-import-pl-name"
                    type="text"
                    value={targetPlaylistName}
                    onChange={(e) => setTargetPlaylistName(e.target.value)}
                    placeholder="Defaults to Drive file or playlist header name"
                    className="w-full px-3 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                  />
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {isLoadingDrive && drivePlaylists.length === 0 ? (
                    <div className="py-8 flex items-center justify-center gap-2 text-xs text-[#8B92A2]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Scanning Google Drive for playlists...</span>
                    </div>
                  ) : drivePlaylists.length === 0 ? (
                    <div className="py-6 px-4 rounded-md border border-dashed border-white/[0.1] bg-[#0B0C0E] text-center space-y-1">
                      <FileText className="h-4 w-4 text-[#6B7280] mx-auto" />
                      <p className="text-xs text-[#9CA3AF]">
                        No matching playlist files found in Google Drive.
                      </p>
                      <p className="text-[11px] text-[#6B7280]">
                        Supported: .m3u8, .m3u, .csv, .json, .txt
                      </p>
                    </div>
                  ) : (
                    drivePlaylists.map((file) => {
                      const modMs = Date.parse(file.modifiedTime) || null;
                      const isImporting = importingFileId === file.id;
                      const extLabel = getFileExtensionLabel(file);
                      const isLibraryManifest =
                        file.appProperties?.cratesyncType === 'source-of-truth' ||
                        file.appProperties?.cratesyncType === 'library-backup' ||
                        file.name === CRATESYNC_CANONICAL_MANIFEST_NAME ||
                        file.name.includes('cratesync-library-backup');

                      return (
                        <div
                          key={file.id}
                          className="flex items-center justify-between gap-3 p-3 rounded-md bg-[#0B0C0E] border border-white/[0.07] hover:border-white/[0.14] transition-colors"
                        >
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] font-mono font-semibold text-[#9CA3AF] shrink-0">
                                {extLabel}
                              </span>
                              <span className="text-xs font-medium text-white truncate">
                                {file.name}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-[#8B92A2]">
                              {formatFileSize(file.size)}
                              {modMs ? ` · Modified ${formatRelativeTime(modMs)}` : ''}
                              {isLibraryManifest ? ' · Library Manifest' : ''}
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={isImporting || isMutating}
                            onClick={() => void handleImportDrivePlaylistFile(file)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#FF1F3D] hover:border-[#FF1F3D] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                          >
                            {isImporting ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CloudDownload className="h-3.5 w-3.5" />
                            )}
                            <span>{isLibraryManifest ? 'Restore' : 'Import'}</span>
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="px-6 py-4 bg-[#0D0F13] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-xs text-[#8B92A2] leading-relaxed">
            {user && !hasAccessToken
              ? `Signed in as ${user.email || user.displayName}. For security, Google Drive access tokens live strictly in memory and reset on page reload — click "Sign in with Google" to reconnect in one click.`
              : 'Sign in with Google to use Google Drive as your master library source of truth and cache songs & playlists to each playing device.'}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {user && !hasAccessToken && (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={authLoading}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md bg-[#131314] border border-[#8E918F] text-[#E3E3E3] hover:bg-[#1E1F21] text-xs font-medium transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                {authLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#E3E3E3]" />
                ) : (
                  <GoogleGLogo className="h-3.5 w-3.5 shrink-0" />
                )}
                <span>Reconnect Google Drive</span>
              </button>
            )}
            {storedAudioKeys.size > 0 && (
              <button
                type="button"
                onClick={() =>
                  setPendingAction({
                    kind: 'clear-device-cache',
                    ...summarizeDeviceCache(tracks, storedAudioKeys),
                    totalBytes: deviceCacheBytes,
                  })
                }
                className="text-xs text-[#9CA3AF] hover:text-[#FCA5A5] transition-colors whitespace-nowrap shrink-0"
              >
                Clear {formatFileSize(deviceCacheBytes)} device cache
              </button>
            )}
          </div>
        </div>
      )}

      {/* Hierarchical Google Drive Folder Browser for Music Folder Scope */}
      <DriveFolderBrowserModal
        open={scopeBrowserOpen}
        accessToken={getDriveAccessToken()}
        title="Select Google Drive Music Folder"
        subtitle="Browse My Drive, Shared with me, or search across Google Drive to scope synced songs."
        allowSelectAllDrive
        isMutating={isMutating}
        refreshSignal={driveRefreshSignal}
        onClose={() => setScopeBrowserOpen(false)}
        onSelectFolder={(result) => {
          setSelectedFolderId(result.id);
          setSelectedFolderCustomLabel(result.id ? result.displayPath : null);
          setDriveAudioFiles([]);
          void refreshDriveData({
            folderId: result.id,
            folderLabel: result.id ? result.displayPath : 'All Google Drive',
          });
        }}
        onRequestCreateDriveFolder={({ folderName, parentFolderId, parentFolderLabel }) =>
          setPendingAction({
            kind: 'create-drive-folder',
            folderName,
            parentFolderId,
            parentFolderLabel,
          })
        }
        onAuthError={(err) =>
          handleDriveApiError(err, 'Failed to browse Google Drive folders.')
        }
      />

      {/* Local Folder Browser for Selecting the Mirrored Local Folder directly from Songs & Cache */}
      <LocalFolderBrowserModal
        open={localMirrorBrowserOpen}
        deviceName={currentDevice.name}
        initialPath={activeMirrorBinding?.localFolderPath ?? ''}
        availableLocalFolders={availableLocalFolders}
        tracks={tracks}
        onClose={() => setLocalMirrorBrowserOpen(false)}
        onSelectFolder={(localPath) => {
          const normalized = normalizeFolderPath(localPath);
          onSaveFolderMapping({
            driveFolderId: activeMirrorDriveFolderId,
            driveFolderName: activeMirrorDriveFolderName,
            binding: {
              deviceId: currentDevice.id,
              localFolderPath: normalized,
              syncDirection: activeMirrorBinding?.syncDirection ?? 'bidirectional',
              autoCacheOffline: activeMirrorBinding?.autoCacheOffline ?? true,
              lastSyncedAt: activeMirrorBinding?.lastSyncedAt ?? null,
            },
          });
          setStatusMessage({
            tone: 'success',
            text: normalized
              ? `Mirrored Google Drive "${activeMirrorDriveFolderName}" → local folder "${normalized}" on ${currentDevice.name}.`
              : `Set Google Drive "${activeMirrorDriveFolderName}" to mirror into IndexedDB offline cache on ${currentDevice.name}.`,
          });
          onNotify?.({
            title: 'Mirrored local folder updated',
            description: `${activeMirrorDriveFolderName} ↔ ${normalized || 'IndexedDB Offline Cache'}`,
            tone: 'success',
          });
        }}
        onIngestLocalFolderEntries={onIngestLocalFolderEntries}
      />

      {/* Mandatory Explicit User Confirmation Modal for All Drive Mutations & Destructive Actions */}
      <ConfirmModal
        isOpen={Boolean(pendingAction)}
        title={confirmModalCopy.title}
        message={confirmModalCopy.message}
        confirmLabel={confirmModalCopy.confirmLabel}
        destructive={confirmModalCopy.destructive}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void handleConfirmPendingAction()}
      />
    </section>
  );
}
