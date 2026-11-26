import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { X } from 'lucide-react';
import { BatchTagEditorModal, type BatchTrackPatch } from './components/BatchTagEditorModal';
import { DashboardView } from './components/DashboardView';
import { MiniPlayer } from './components/MiniPlayer';
import { ConfirmModal, CreatePlaylistModal } from './components/Modals';
import { PlaylistView } from './components/PlaylistView';
import { ScanLogView } from './components/ScanLogView';
import { ScannerView } from './components/ScannerView';
import { Sidebar } from './components/Sidebar';
import {
  SmartPlaylistModal,
  type SmartPlaylistFormPayload,
} from './components/SmartPlaylistModal';
import { SmartPlaylistView } from './components/SmartPlaylistView';
import { SmartSearchModal } from './components/SmartSearchModal';
import { SyncQueueView } from './components/SyncQueueView';
import { ToastContainer } from './components/ToastContainer';
import { YouTubePushDialog, type YouTubePushDialogState } from './components/YouTubePushDialog';
import { TopBar } from './components/TopBar';
import { TrackMatchDrawer } from './components/TrackMatchDrawer';
import { TransferView } from './components/TransferView';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useToasts, type ToastStat } from './hooks/useToasts';
import type {
  DeviceFolderBinding,
  DirectoryWatcherStatus,
  DriveFolderMapping,
  FolderMappingTombstone,
  LibraryTombstone,
  LocalTrack,
  Playlist,
  PlaylistDiff,
  ScanErrorEntry,
  ScanLogEntry,
  ScanTriggerSource,
  SmartPlaylist,
  SyncDeviceProfile,
  SyncEvent,
  SyncRule,
  WatchedFolderInfo,
  WorkspaceView,
} from './types/music';
import type { TrackIntegrityRepairPatch } from './components/AudioIntegrityPanel';
import { evaluateSmartPlaylist } from './utils/smartPlaylists';
import {
  loadWatchInterval,
  queryFolderPermission,
  resolveWatcherStatus,
  saveWatchInterval,
  type FolderPermission,
  type WatchIntervalSec,
} from './utils/folderWatch';
import {
  dropTombstoned,
  mergeLibraryForPush,
  mergeLibraryTombstones,
  newerTrackEdits,
  newestWins,
  parseLibraryTombstones,
  reviveTombstoned,
  stampEditedPlaylists,
  stampEditedTracks,
  trackTombstone,
  type LocalLibraryForPush,
} from './utils/libraryMerge';
import { planPlaylistImport } from './utils/playlistImport';
import { countDeviceFiles } from './utils/trackSource';
import {
  inspectAudioBlobIntegrity,
  summarizeIntegrityIssues,
  type TrackIntegrityScanResult,
} from './utils/audioIntegrity';
import { computeAudioHash, extractLocalTrack, isAudioFile, isSha256Hash } from './utils/audioMetadata';
import {
  clearAllAudioBlobs,
  deleteAudioBlobs,
  getAudioCacheStats,
  loadAudioBlob,
  loadDirectoryHandle,
  loadLibraryState,
  saveAudioBlob,
  saveDirectoryHandle,
  saveLibraryState,
} from './utils/storage';
import {
  computePlaylistDiff,
  extractDroppedEntries,
  isInFolderScope,
  supportsDirectoryPicker,
  walkDirectoryHandleWithReport,
  type ScannedFileEntry,
} from './utils/syncEngine';
import {
  buildTrackStubFromDriveAudio,
  type CrateSyncLibraryBackupPayload,
  type DriveFileItem,
} from './utils/googleDriveApi';
import {
  getOrCreateCurrentDeviceProfile,
  mergeDeviceProfiles,
  mergeFolderMappingState,
  mergeFolderMappingTombstones,
  resolveLocalBindingForDriveFolder,
  saveCurrentDeviceProfile,
  translateRelativePathForDevice,
} from './utils/folderMappings';
import type { ImportedTrackSeed } from './utils/youtubeLinks';
import {
  clearYouTubeAccessToken,
  connectYouTube,
  describeYouTubeConnectError,
  getYouTubeAccessToken,
} from './utils/googleAuth';
import { createYouTubeApi } from './utils/youtubeApi';
import {
  estimateYouTubePush,
  playlistAfterPush,
  pushPlaylistToYouTube,
} from './utils/youtubePush';

type PendingConfirm =
  | { kind: 'delete-playlist'; playlistId: string; name: string }
  | { kind: 'delete-smart-playlist'; smartPlaylistId: string; name: string }
  | { kind: 'delete-tracks'; trackIds: string[] }
  | { kind: 'remove-duplicates'; trackIds: string[]; remapToKeep: Record<string, string> }
  | { kind: 'apply-sync'; playlistId: string; name: string; addCount: number; removeCount: number }
  | { kind: 'clear-scan-logs' };

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  const [tracks, setTracksRaw] = useState<LocalTrack[]>([]);
  const [playlists, setPlaylistsRaw] = useState<Playlist[]>([]);
  // Every change to songs and playlists passes through these two setters, so an edit gets its
  // updatedAt in one place. Devices settle a record both of them changed by that time.
  const setTracks = useCallback<Dispatch<SetStateAction<LocalTrack[]>>>((update) => {
    setTracksRaw((prev) =>
      stampEditedTracks(prev, typeof update === 'function' ? update(prev) : update, Date.now())
    );
  }, []);
  const setPlaylists = useCallback<Dispatch<SetStateAction<Playlist[]>>>((update) => {
    setPlaylistsRaw((prev) =>
      stampEditedPlaylists(prev, typeof update === 'function' ? update(prev) : update, Date.now())
    );
  }, []);
  const [smartPlaylists, setSmartPlaylists] = useState<SmartPlaylist[]>([]);
  const [syncHistory, setSyncHistory] = useState<SyncEvent[]>([]);
  const [scanLogs, setScanLogs] = useState<ScanLogEntry[]>([]);
  const [watchedFolderName, setWatchedFolderName] = useState<string | null>(null);
  const [lastScannedAt, setLastScannedAt] = useState<number | null>(null);
  const [currentDevice, setCurrentDevice] = useState<SyncDeviceProfile>(() =>
    getOrCreateCurrentDeviceProfile()
  );
  const [devices, setDevices] = useState<SyncDeviceProfile[]>(() => [
    getOrCreateCurrentDeviceProfile(),
  ]);
  const devicesRef = useRef<SyncDeviceProfile[]>(devices);
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);
  const [folderMappings, setFolderMappings] = useState<DriveFolderMapping[]>([]);
  const folderMappingsRef = useRef<DriveFolderMapping[]>(folderMappings);
  useEffect(() => {
    folderMappingsRef.current = folderMappings;
  }, [folderMappings]);
  const [folderMappingTombstones, setFolderMappingTombstones] = useState<FolderMappingTombstone[]>(
    []
  );
  const folderMappingTombstonesRef = useRef<FolderMappingTombstone[]>(folderMappingTombstones);
  useEffect(() => {
    folderMappingTombstonesRef.current = folderMappingTombstones;
  }, [folderMappingTombstones]);
  const [libraryTombstones, setLibraryTombstones] = useState<LibraryTombstone[]>([]);
  const libraryTombstonesRef = useRef<LibraryTombstone[]>(libraryTombstones);
  useEffect(() => {
    libraryTombstonesRef.current = libraryTombstones;
  }, [libraryTombstones]);
  /** Records deletions, so a merge with Drive does not bring the records back. */
  const addLibraryTombstones = useCallback((added: LibraryTombstone[]) => {
    if (added.length === 0) return;
    setLibraryTombstones((prev) => mergeLibraryTombstones([prev, added], Date.now()));
  }, []);
  const currentDeviceRef = useRef<SyncDeviceProfile>(currentDevice);
  useEffect(() => {
    currentDeviceRef.current = currentDevice;
  }, [currentDevice]);
  const { toasts, pushToast, dismissToast } = useToasts({ maxVisible: 3 });

  const [activeView, setActiveView] = useState<WorkspaceView>('dashboard');
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [activeSmartPlaylistId, setActiveSmartPlaylistId] = useState<string | null>(null);
  const [smartPlaylistModal, setSmartPlaylistModal] = useState<{
    open: boolean;
    editing: SmartPlaylist | null;
  }>({ open: false, editing: null });
  const [scannerFilterPreset, setScannerFilterPreset] = useState<
    'all' | 'unmatched' | 'matched' | 'missing'
  >('all');
  const [scannerGenrePreset, setScannerGenrePreset] = useState<string>('all');
  const [scannerGroupByGenrePreset, setScannerGroupByGenrePreset] = useState<boolean>(false);
  const [scannerSearchPreset, setScannerSearchPreset] = useState<string>('');
  const [scannerOpenCleanupPreset, setScannerOpenCleanupPreset] = useState<boolean>(false);
  const [scannerOpenDuplicatesPreset, setScannerOpenDuplicatesPreset] = useState<boolean>(false);
  const [scannerOpenIntegrityPreset, setScannerOpenIntegrityPreset] = useState<boolean>(false);
  const [smartSearchOpen, setSmartSearchOpen] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // One interval for the whole app, because there is one watched folder. Saved, so a reload keeps it.
  const [autoWatchIntervalSec, setAutoWatchIntervalSec] = useState<WatchIntervalSec>(loadWatchInterval);
  const [folderPermission, setFolderPermission] = useState<FolderPermission>('granted');
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ processed: number; total: number } | null>(
    null
  );
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [isHashingDuplicates, setIsHashingDuplicates] = useState(false);
  const [hashProgress, setHashProgress] = useState<{ processed: number; total: number } | null>(
    null
  );
  const [integrityResults, setIntegrityResults] = useState<
    Record<string, TrackIntegrityScanResult>
  >({});
  const [isScanningIntegrity, setIsScanningIntegrity] = useState(false);
  const [integrityProgress, setIntegrityProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);

  const [inspectedTrackId, setInspectedTrackId] = useState<string | null>(null);
  const [createModalState, setCreateModalState] = useState<{
    open: boolean;
    seedTrackIds: string[];
  }>({ open: false, seedTrackIds: [] });
  const [batchTagModal, setBatchTagModal] = useState<{
    open: boolean;
    trackIds: string[];
    contextLabel: string;
  }>({ open: false, trackIds: [], contextLabel: '' });
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  /** The open "Push to YouTube" dialog and the playlist it is about. */
  const [youtubePush, setYouTubePush] = useState<{
    playlistId: string;
    state: YouTubePushDialogState;
  } | null>(null);
  const youtubePushAbortRef = useRef<AbortController | null>(null);

  // Live in-memory references (audio Blobs for playback + FileSystemDirectoryHandle for auto-watch)
  const fileMapRef = useRef<Map<string, Blob>>(new Map());
  const [storedAudioKeys, setStoredAudioKeys] = useState<Set<string>>(new Set());
  const [deviceCacheBytes, setDeviceCacheBytes] = useState<number>(0);
  const storedAudioKeysRef = useRef<Set<string>>(storedAudioKeys);
  useEffect(() => {
    storedAudioKeysRef.current = storedAudioKeys;
  }, [storedAudioKeys]);
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const [hasLiveHandle, setHasLiveHandle] = useState(false);

  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const tracksRef = useRef<LocalTrack[]>(tracks);
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);
  const playlistsRef = useRef<Playlist[]>(playlists);
  useEffect(() => {
    playlistsRef.current = playlists;
  }, [playlists]);
  const smartPlaylistsRef = useRef<SmartPlaylist[]>(smartPlaylists);
  useEffect(() => {
    smartPlaylistsRef.current = smartPlaylists;
  }, [smartPlaylists]);

  const handlePlayRecorded = useCallback(
    (event: {
      trackId: string;
      outcome: 'completed' | 'skipped';
      listenedSeconds: number;
      playedAt: number;
    }) => {
      setTracks((prev) =>
        prev.map((track) => {
          if (track.id !== event.trackId) return track;
          return {
            ...track,
            playCount: (track.playCount ?? 0) + 1,
            skipCount: (track.skipCount ?? 0) + (event.outcome === 'skipped' ? 1 : 0),
            lastPlayedAt: event.playedAt,
          };
        })
      );
    },
    []
  );

  const refreshDeviceCacheStats = useCallback(async () => {
    const stats = await getAudioCacheStats();
    setStoredAudioKeys(stats.cachedKeys);
    setDeviceCacheBytes(stats.totalBytes);
  }, []);

  const handleCacheDriveTrackAudio = useCallback(
    async (trackId: string, blob: Blob, driveFile?: DriveFileItem) => {
      const target = tracksRef.current.find((t) => t.id === trackId);
      if (!target) return;

      fileMapRef.current.set(target.fileKey, blob);
      await saveAudioBlob(target.fileKey, blob);
      const cachedAt = Date.now();

      // If this Drive song was synced as a lightweight catalog stub, parse real embedded ID3/FLAC/MP4 tags & duration now
      let enriched: Partial<LocalTrack> = {
        fileSize: blob.size || target.fileSize,
        cachedOnDeviceAt: cachedAt,
        isMissingOnDevice: false,
        ...(driveFile
          ? {
              driveFileId: driveFile.id,
              driveModifiedTime: driveFile.modifiedTime,
            }
          : {}),
      };

      if (target.duration === 0 || target.artist === 'Unknown Artist' || !target.coverArtUrl) {
        try {
          const virtualFile = new File([blob], target.fileName, {
            type: blob.type || 'audio/mpeg',
          });
          const parsed = await extractLocalTrack(virtualFile, target.relativePath);
          enriched = {
            ...enriched,
            title:
              target.title && target.title !== target.fileName.replace(/\.[^.]+$/, '')
                ? target.title
                : parsed.title,
            artist: target.artist !== 'Unknown Artist' ? target.artist : parsed.artist,
            album:
              target.album !== 'Unknown Album' && target.album !== 'Google Drive Library'
                ? target.album
                : parsed.album,
            genre: target.genre || parsed.genre,
            year: target.year || parsed.year,
            trackNumber: target.trackNumber ?? parsed.trackNumber,
            duration: parsed.duration > 0 ? parsed.duration : target.duration,
            coverArtUrl: target.coverArtUrl || parsed.coverArtUrl,
            // Prefer the SHA-256 of the downloaded bytes; older Drive stubs stored Drive's MD5 here
            contentHash: parsed.contentHash || target.contentHash,
          };
        } catch {
          // Keep existing Drive stub metadata if binary tag parsing fails
        }
      }

      setTracks((prev) =>
        prev.map((t) => (t.id === trackId ? { ...t, ...enriched } : t))
      );
      await refreshDeviceCacheStats();
    },
    [refreshDeviceCacheStats]
  );

  const hasCachedAudio = useCallback(
    (fileKey: string) => storedAudioKeysRef.current.has(fileKey),
    []
  );

  const audioPlayer = useAudioPlayer(tracks, fileMapRef, {
    hasCachedAudio,
    onPlayRecorded: handlePlayRecorded,
    onTrackCachedFromDrive: ({ trackId, blob }) => {
      void handleCacheDriveTrackAudio(trackId, blob);
    },
  });

  // Hydrate library state, stored audio cache stats & directory handle from IndexedDB
  useEffect(() => {
    let active = true;
    (async () => {
      const [savedState, savedHandle, cacheStats] = await Promise.all([
        loadLibraryState(),
        loadDirectoryHandle(),
        getAudioCacheStats(),
      ]);
      if (!active) return;
      setTracks(savedState.tracks);
      setPlaylists(savedState.playlists);
      setSmartPlaylists(
        (savedState.smartPlaylists ?? []).map((sp) => {
          const { limit: _legacyLimit, ...rest } = sp as SmartPlaylist & { limit?: number | null };
          void _legacyLimit;
          return rest;
        })
      );
      setSyncHistory(savedState.syncHistory);
      setScanLogs(savedState.scanLogs ?? []);
      setWatchedFolderName(savedState.watchedFolderName);
      setLastScannedAt(savedState.lastScannedAt);
      setDevices(mergeDeviceProfiles(savedState.devices ?? [], [], currentDeviceRef.current));
      setFolderMappings(savedState.folderMappings ?? []);
      setFolderMappingTombstones(mergeFolderMappingTombstones([savedState.folderMappingTombstones]));
      setLibraryTombstones(
        mergeLibraryTombstones([parseLibraryTombstones(savedState.libraryTombstones)], Date.now())
      );
      setStoredAudioKeys(cacheStats.cachedKeys);
      setDeviceCacheBytes(cacheStats.totalBytes);
      if (savedHandle) {
        dirHandleRef.current = savedHandle;
        setHasLiveHandle(true);
        setFolderPermission(await queryFolderPermission(savedHandle));
      }
      setHydrated(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Global Cmd+K / Ctrl+K shortcut for Smart Search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSmartSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Persist state whenever library mutates
  useEffect(() => {
    if (!hydrated) return;
    saveLibraryState({
      tracks,
      playlists,
      smartPlaylists,
      syncHistory,
      scanLogs,
      watchedFolderName,
      lastScannedAt,
      devices,
      folderMappings,
      folderMappingTombstones,
      libraryTombstones,
    });
  }, [
    hydrated,
    tracks,
    playlists,
    smartPlaylists,
    syncHistory,
    scanLogs,
    watchedFolderName,
    lastScannedAt,
    devices,
    folderMappings,
    folderMappingTombstones,
    libraryTombstones,
  ]);

  const trackMap = useMemo(() => {
    const map = new Map<string, LocalTrack>();
    for (const t of tracks) {
      map.set(t.id, t);
    }
    return map;
  }, [tracks]);

  const availableFolders = useMemo(() => {
    const set = new Set<string>();
    for (const t of tracks) {
      if (t.folderName) set.add(t.folderName);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tracks]);

  const diffMap = useMemo(() => {
    const map = new Map<string, PlaylistDiff>();
    for (const pl of playlists) {
      map.set(pl.id, computePlaylistDiff(pl, trackMap));
    }
    return map;
  }, [playlists, trackMap]);

  const totalPendingSyncs = useMemo(() => {
    let total = 0;
    for (const diff of diffMap.values()) {
      total += diff.toAdd.length + diff.toRemove.length;
    }
    return total;
  }, [diffMap]);

  const watchedFolder: WatchedFolderInfo | null = useMemo(() => {
    const deviceFileCount = countDeviceFiles(tracks);
    if (!watchedFolderName && deviceFileCount === 0) return null;
    return {
      name: watchedFolderName || 'Device Audio',
      lastScannedAt,
      trackCount: deviceFileCount,
      hasLiveHandle,
    };
  }, [watchedFolderName, lastScannedAt, tracks, hasLiveHandle]);

  const watcherStatus: DirectoryWatcherStatus = useMemo(
    () =>
      resolveWatcherStatus({
        isScanning,
        hasLiveHandle,
        intervalSec: autoWatchIntervalSec,
        permission: folderPermission,
      }),
    [isScanning, hasLiveHandle, autoWatchIntervalSec, folderPermission]
  );

  useEffect(() => {
    saveWatchInterval(autoWatchIntervalSec);
  }, [autoWatchIntervalSec]);

  const recentScanErrorCount = scanLogs[0]?.errors.length ?? 0;
  const totalScanErrorCount = useMemo(
    () => scanLogs.reduce((sum, entry) => sum + entry.errors.length, 0),
    [scanLogs]
  );

  const appendScanLog = useCallback((entry: ScanLogEntry) => {
    setScanLogs((prev) => [entry, ...prev].slice(0, 200));
  }, []);

  /**
   * Core ingestion pipeline for scanned local audio entries.
   * Preserves existing YouTube matches and edited metadata for known files,
   * detects missing files when doing a full directory scan, and records a ScanLogEntry.
   */
  const ingestAudioEntries = useCallback(
    async (
      entries: ScannedFileEntry[],
      options: {
        folderRootName?: string;
        isFullFolderScan: boolean;
        quiet?: boolean;
        source?: ScanTriggerSource;
        startedAt?: number;
        totalEncountered?: number;
        walkErrors?: ScanErrorEntry[];
      }
    ) => {
      const startedAt = options.startedAt ?? Date.now();
      const source: ScanTriggerSource =
        options.source ?? (options.quiet ? 'background-watch' : 'manual-folder');
      const folderLabelForLog = options.folderRootName || 'Local Files';
      const errors: ScanErrorEntry[] = [...(options.walkErrors ?? [])];
      const audioEntries = entries.filter((e) => isAudioFile(e.file));
      const totalFilesEncountered = Math.max(options.totalEncountered ?? entries.length, entries.length);
      const skippedNonAudioCount = Math.max(0, totalFilesEncountered - audioEntries.length);

      if (audioEntries.length === 0) {
        const folderScope = options.folderRootName?.toLowerCase() ?? '';
        let newlyMissingCount = 0;
        let totalMissingInFolder = 0;

        if (options.isFullFolderScan && folderScope) {
          const matchingTracks = tracksRef.current.filter(
            (track) =>
              track.folderName.toLowerCase() === folderScope ||
              track.relativePath.toLowerCase().startsWith(`${folderScope}/`)
          );
          if (matchingTracks.length > 0) {
            for (const t of matchingTracks) {
              if (!t.isMissingOnDevice) newlyMissingCount++;
              totalMissingInFolder++;
            }
            const missingIds = new Set(matchingTracks.map((t) => t.id));
            setTracks((prev) =>
              prev.map((track) =>
                missingIds.has(track.id) ? { ...track, isMissingOnDevice: true } : track
              )
            );
          }
          setLastScannedAt(Date.now());
        }

        const completedAt = Date.now();
        appendScanLog({
          id: crypto.randomUUID(),
          startedAt,
          completedAt,
          durationMs: Math.max(1, completedAt - startedAt),
          source,
          folderName: folderLabelForLog,
          totalFilesEncountered,
          audioFilesProcessed: 0,
          addedCount: 0,
          updatedCount: 0,
          restoredCount: 0,
          missingCount: newlyMissingCount > 0 ? newlyMissingCount : totalMissingInFolder,
          skippedNonAudioCount,
          status: errors.length > 0 ? 'completed-with-errors' : 'completed',
          errors,
        });

        if (options.quiet) {
          const stats: ToastStat[] = [
            { label: 'new', value: 0, tone: 'neutral' },
            {
              label: 'missing',
              value: newlyMissingCount > 0 ? newlyMissingCount : totalMissingInFolder,
              tone: newlyMissingCount > 0 || totalMissingInFolder > 0 ? 'missing' : 'neutral',
            },
          ];
          pushToast({
            dedupeKey: 'background-scan',
            title: 'Background scan complete',
            description: options.folderRootName
              ? `${options.folderRootName} · 0 audio files found`
              : '0 audio files found',
            stats,
            tone: newlyMissingCount > 0 || errors.length > 0 ? 'warning' : 'neutral',
            durationMs: newlyMissingCount > 0 || errors.length > 0 ? 6000 : 4000,
            action:
              newlyMissingCount > 0 || totalMissingInFolder > 0
                ? {
                    label: 'Review missing',
                    onClick: () => {
                      setScannerFilterPreset('all');
                      setScannerOpenCleanupPreset(true);
                      setActivePlaylistId(null);
                      setActiveView('scanner');
                    },
                  }
                : errors.length > 0
                  ? {
                      label: 'View scan log',
                      onClick: () => {
                        setActivePlaylistId(null);
                        setActiveView('scan-logs');
                      },
                    }
                  : undefined,
          });
        } else {
          setScanNotice(
            newlyMissingCount > 0
              ? `${newlyMissingCount} track${newlyMissingCount === 1 ? '' : 's'} detected as missing on device (0 audio files found).`
              : entries.length > 0
                ? `Scanned ${entries.length} file(s), but none were supported audio formats (.mp3, .flac, .m4a, .wav, .ogg, .aac, .opus).`
                : 'No audio files were found in the selected location.'
          );
        }
        return;
      }

      setIsScanning(true);
      if (!options.quiet) {
        setScanNotice(null);
        setScanProgress({ processed: 0, total: audioEntries.length });
      }

      try {
        const now = Date.now();
        const existingByKey = new Map<string, LocalTrack>();
        const existingByNameSize = new Map<string, LocalTrack>();
        // Drive tracks keep a gdrive:: fileKey but sync rewrites relativePath to this device's
        // mapped folder, so match on path + size too or a scan re-imports them as new tracks.
        const existingByPathSize = new Map<string, LocalTrack>();
        tracksRef.current.forEach((t) => {
          existingByKey.set(t.fileKey, t);
          existingByNameSize.set(`${t.fileName.toLowerCase()}::${t.fileSize}`, t);
          if (t.fileSize > 0) {
            existingByPathSize.set(`${t.relativePath.toLowerCase()}::${t.fileSize}`, t);
          }
        });

        const seenKeys = new Set<string>();
        const newlyParsed: LocalTrack[] = [];
        const updatedExistingIds = new Map<string, LocalTrack>();
        const newlyCachedKeys: string[] = [];

        for (let i = 0; i < audioEntries.length; i++) {
          const { file, relativePath } = audioEntries[i];
          const computedFileKey = `${relativePath.toLowerCase()}::${file.size}`;
          const nameSizeCandidate = existingByNameSize.get(
            `${file.name.toLowerCase()}::${file.size}`
          );
          const canRelinkByNameSize =
            Boolean(nameSizeCandidate) &&
            !relativePath.includes('/') &&
            (nameSizeCandidate!.isMissingOnDevice ||
              (!fileMapRef.current.has(nameSizeCandidate!.fileKey) &&
                !storedAudioKeysRef.current.has(nameSizeCandidate!.fileKey)));
          const existing =
            existingByKey.get(computedFileKey) ??
            existingByPathSize.get(computedFileKey) ??
            (canRelinkByNameSize ? nameSizeCandidate : undefined);
          const targetKey = existing ? existing.fileKey : computedFileKey;

          seenKeys.add(targetKey);
          fileMapRef.current.set(targetKey, file);
          // Persist audio blob in IndexedDB so playback survives reloads. Skip keys already
          // stored (the key includes the byte size): auto-watch rescans every 30 s and would
          // otherwise rewrite the whole library into IndexedDB on every tick.
          if (!storedAudioKeysRef.current.has(targetKey)) {
            newlyCachedKeys.push(targetKey);
            void saveAudioBlob(targetKey, file);
          }

          if (existing) {
            let contentHash = isSha256Hash(existing.contentHash) ? existing.contentHash : null;
            if (!contentHash) {
              try {
                contentHash = await computeAudioHash(file);
              } catch (hashErr) {
                errors.push({
                  path: relativePath,
                  message:
                    hashErr instanceof Error && hashErr.message
                      ? `Hash computation failed: ${hashErr.message}`
                      : 'Failed to compute audio fingerprint.',
                  code: 'unreadable-file',
                });
              }
            }
            updatedExistingIds.set(existing.id, {
              ...existing,
              contentHash,
              lastSeenAt: now,
              isMissingOnDevice: false,
              // A Drive track whose local copy was just scanned now has its audio on this device
              ...(existing.driveFileId
                ? { cachedOnDeviceAt: existing.cachedOnDeviceAt ?? now }
                : {}),
            });
          } else {
            try {
              const parsed = await extractLocalTrack(file, relativePath);
              newlyParsed.push(parsed);
            } catch (parseErr) {
              errors.push({
                path: relativePath,
                message:
                  parseErr instanceof Error && parseErr.message
                    ? `Metadata parse fallback used: ${parseErr.message}`
                    : 'Audio metadata tags could not be parsed; imported using filename fallback.',
                code: 'metadata-parse',
              });
              const ext = file.name.split('.').pop()?.toUpperCase() || 'AUDIO';
              let fallbackHash: string | null = null;
              try {
                fallbackHash = await computeAudioHash(file);
              } catch {
                fallbackHash = null;
              }
              newlyParsed.push({
                id: crypto.randomUUID(),
                fileKey: targetKey,
                fileName: file.name,
                relativePath,
                folderName: options.folderRootName || 'Local Files',
                title: file.name.replace(/\.[^.]+$/, '') || file.name,
                artist: 'Unknown Artist',
                album: 'Unknown Album',
                year: '',
                trackNumber: null,
                duration: 0,
                format: ext,
                fileSize: file.size,
                contentHash: fallbackHash,
                coverArtUrl: null,
                addedAt: now,
                lastSeenAt: now,
                isMissingOnDevice: false,
                youtubeVideoId: null,
                youtubeTitle: null,
                matchStatus: 'unmatched',
              });
            }
          }

          if (!options.quiet && ((i + 1) % 3 === 0 || i === audioEntries.length - 1)) {
            setScanProgress({ processed: i + 1, total: audioEntries.length });
          }
        }

        const folderScope = options.folderRootName?.toLowerCase() ?? '';
        const restoredCount = Array.from(updatedExistingIds.values()).reduce((count, refreshed) => {
          const prevTrack = existingByKey.get(refreshed.fileKey);
          return count + (prevTrack?.isMissingOnDevice ? 1 : 0);
        }, 0);

        let newlyMissingCount = 0;
        let totalMissingInFolder = 0;
        const missingIds = new Set<string>();

        if (options.isFullFolderScan && folderScope) {
          for (const track of tracksRef.current) {
            if (updatedExistingIds.has(track.id)) continue;
            const belongsToFolder =
              track.folderName.toLowerCase() === folderScope ||
              track.relativePath.toLowerCase().startsWith(`${folderScope}/`);
            if (belongsToFolder && !seenKeys.has(track.fileKey)) {
              missingIds.add(track.id);
              totalMissingInFolder++;
              if (!track.isMissingOnDevice) {
                newlyMissingCount++;
              }
            }
          }
        }

        setTracks((prev) => {
          const merged = prev.map((track) => {
            const refreshed = updatedExistingIds.get(track.id);
            if (refreshed) return refreshed;

            if (missingIds.has(track.id)) {
              return { ...track, isMissingOnDevice: true };
            }
            return track;
          });

          return [...newlyParsed, ...merged];
        });

        if (newlyCachedKeys.length > 0) {
          void refreshDeviceCacheStats();
        }

        if (options.folderRootName) {
          setWatchedFolderName(options.folderRootName);
        }
        setLastScannedAt(now);

        const addedCount = newlyParsed.length;
        const completedAt = Date.now();
        appendScanLog({
          id: crypto.randomUUID(),
          startedAt,
          completedAt,
          durationMs: Math.max(1, completedAt - startedAt),
          source,
          folderName: folderLabelForLog,
          totalFilesEncountered,
          audioFilesProcessed: audioEntries.length,
          addedCount,
          updatedCount: updatedExistingIds.size,
          restoredCount,
          missingCount: newlyMissingCount > 0 ? newlyMissingCount : totalMissingInFolder,
          skippedNonAudioCount,
          status: errors.length > 0 ? 'completed-with-errors' : 'completed',
          errors,
        });

        if (options.quiet) {
          const stats: ToastStat[] = [];
          const hasDelta = addedCount > 0 || newlyMissingCount > 0 || restoredCount > 0;

          if (hasDelta) {
            if (addedCount > 0) {
              stats.push({
                label: addedCount === 1 ? 'new track' : 'new tracks',
                value: addedCount,
                prefix: '+',
                tone: 'added',
              });
            }
            if (newlyMissingCount > 0) {
              stats.push({
                label: 'missing',
                value: newlyMissingCount,
                tone: 'missing',
              });
            }
            if (restoredCount > 0) {
              stats.push({
                label: 'restored',
                value: restoredCount,
                prefix: '+',
                tone: 'reconnected',
              });
            }
          } else {
            stats.push(
              { label: 'new', value: 0, tone: 'neutral' },
              {
                label: 'missing',
                value: totalMissingInFolder,
                tone: totalMissingInFolder > 0 ? 'missing' : 'neutral',
              }
            );
          }

          const folderLabel = options.folderRootName ? `${options.folderRootName} · ` : '';
          pushToast({
            dedupeKey: 'background-scan',
            title:
              errors.length > 0
                ? `Background scan finished (${errors.length} error${errors.length === 1 ? '' : 's'})`
                : 'Background scan complete',
            description: `${folderLabel}${audioEntries.length} file${audioEntries.length === 1 ? '' : 's'} checked`,
            stats,
            tone:
              newlyMissingCount > 0 || errors.length > 0
                ? 'warning'
                : addedCount > 0 || restoredCount > 0
                  ? 'success'
                  : 'neutral',
            durationMs: hasDelta || errors.length > 0 ? 6000 : 4000,
            action:
              errors.length > 0
                ? {
                    label: 'View scan log',
                    onClick: () => {
                      setActivePlaylistId(null);
                      setActiveView('scan-logs');
                    },
                  }
                : newlyMissingCount > 0
                  ? {
                      label: 'Review missing',
                      onClick: () => {
                        setScannerFilterPreset('all');
                        setScannerOpenCleanupPreset(true);
                        setActivePlaylistId(null);
                        setActiveView('scanner');
                      },
                    }
                  : addedCount > 0
                    ? {
                        label: 'View library',
                        onClick: () => {
                          setScannerFilterPreset('all');
                          setActivePlaylistId(null);
                          setActiveView('scanner');
                        },
                      }
                    : undefined,
          });
        } else {
          const parts: string[] = [];
          if (addedCount > 0) {
            parts.push(`Added ${addedCount} audio file${addedCount === 1 ? '' : 's'}`);
          }
          if (restoredCount > 0) {
            parts.push(`Restored ${restoredCount} previously missing`);
          }
          if (totalMissingInFolder > 0) {
            parts.push(`${totalMissingInFolder} missing on device`);
          }
          if (errors.length > 0) {
            parts.push(`${errors.length} error${errors.length === 1 ? '' : 's'} logged`);
          }
          const summary =
            parts.length > 0
              ? `${parts.join(' · ')} (${audioEntries.length} total scanned).`
              : `All ${audioEntries.length} audio file${audioEntries.length === 1 ? '' : 's'} already in your library.`;
          setScanNotice(summary);
        }
      } finally {
        setIsScanning(false);
        setScanProgress(null);
      }
    },
    [appendScanLog, pushToast, refreshDeviceCacheStats]
  );

  // Re-scan active mounted FileSystemDirectoryHandle
  const handleRescanWatchedFolder = useCallback(
    async (quiet = false) => {
      const handle = dirHandleRef.current;
      if (!handle) {
        folderInputRef.current?.click();
        return;
      }

      const startedAt = Date.now();
      const source: ScanTriggerSource = quiet ? 'background-watch' : 'manual-folder';

      try {
        // Request read permission if handle was restored from IndexedDB
        const handleWithPerm = handle as FileSystemDirectoryHandle & {
          queryPermission?: (desc: { mode: 'read' }) => Promise<string>;
          requestPermission?: (desc: { mode: 'read' }) => Promise<string>;
        };
        if (handleWithPerm.queryPermission) {
          const perm = await handleWithPerm.queryPermission({ mode: 'read' });
          if (perm !== 'granted') {
            if (quiet) {
              // Only a click can ask the browser. Say the watch is paused; do not look busy.
              setFolderPermission('needs-permission');
              return;
            }
            const granted = await handleWithPerm.requestPermission?.({ mode: 'read' });
            if (granted !== 'granted') {
              setFolderPermission('needs-permission');
              const completedAt = Date.now();
              appendScanLog({
                id: crypto.randomUUID(),
                startedAt,
                completedAt,
                durationMs: Math.max(1, completedAt - startedAt),
                source,
                folderName: handle.name,
                totalFilesEncountered: 0,
                audioFilesProcessed: 0,
                addedCount: 0,
                updatedCount: 0,
                restoredCount: 0,
                missingCount: 0,
                skippedNonAudioCount: 0,
                status: 'failed',
                errors: [
                  {
                    path: handle.name,
                    message: 'Folder read permission was not granted by the browser.',
                    code: 'permission',
                  },
                ],
              });
              setScanNotice('Folder read permission was not granted.');
              return;
            }
          }
        }

        setFolderPermission('granted');
        setIsScanning(true);
        const report = await walkDirectoryHandleWithReport(handle);
        await ingestAudioEntries(report.entries, {
          folderRootName: handle.name,
          isFullFolderScan: true,
          quiet,
          source,
          startedAt,
          totalEncountered: report.totalFilesEncountered,
          walkErrors: report.errors,
        });
      } catch (err) {
        const completedAt = Date.now();
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Could not re-scan the mounted folder. Select the folder again to refresh.';
        appendScanLog({
          id: crypto.randomUUID(),
          startedAt,
          completedAt,
          durationMs: Math.max(1, completedAt - startedAt),
          source,
          folderName: handle.name,
          totalFilesEncountered: 0,
          audioFilesProcessed: 0,
          addedCount: 0,
          updatedCount: 0,
          restoredCount: 0,
          missingCount: 0,
          skippedNonAudioCount: 0,
          status: 'failed',
          errors: [
            {
              path: handle.name,
              message,
              code: 'unknown',
            },
          ],
        });
        if (!quiet) {
          setScanNotice('Could not re-scan the mounted folder. Select the folder again to refresh.');
        }
      } finally {
        setIsScanning(false);
      }
    },
    [appendScanLog, ingestAudioEntries]
  );

  // Auto-watch interval effect when a live directory handle is active
  useEffect(() => {
    if (!hasLiveHandle || autoWatchIntervalSec === 0 || folderPermission !== 'granted') return;

    const timer = window.setInterval(() => {
      if (!isScanning && document.visibilityState === 'visible') {
        handleRescanWatchedFolder(true);
      }
    }, autoWatchIntervalSec * 1000);

    return () => window.clearInterval(timer);
  }, [hasLiveHandle, autoWatchIntervalSec, folderPermission, isScanning, handleRescanWatchedFolder]);

  // Mount local folder: synchronous webkitdirectory picker in iframes/Safari/Firefox,
  // or File System Access API in top-level Chromium windows.
  const handleMountFolder = () => {
    if (!supportsDirectoryPicker()) {
      folderInputRef.current?.click();
      return;
    }

    (async () => {
      try {
        const picker = (
          window as unknown as {
            showDirectoryPicker: (opts?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;
          }
        ).showDirectoryPicker;
        const handle = await picker({ mode: 'read' });
        const startedAt = Date.now();
        dirHandleRef.current = handle;
        setHasLiveHandle(true);
        setFolderPermission('granted');
        await saveDirectoryHandle(handle);
        setIsScanning(true);
        try {
          const report = await walkDirectoryHandleWithReport(handle);
          await ingestAudioEntries(report.entries, {
            folderRootName: handle.name,
            isFullFolderScan: true,
            source: 'manual-folder',
            startedAt,
            totalEncountered: report.totalFilesEncountered,
            walkErrors: report.errors,
          });
        } finally {
          setIsScanning(false);
        }
      } catch (err: unknown) {
        const domErr = err as { name?: string };
        if (domErr?.name === 'AbortError') {
          return;
        }
        folderInputRef.current?.click();
      }
    })();
  };

  const handleFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const startedAt = Date.now();
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    const firstPath =
      (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    const folderRootName = firstPath.includes('/') ? firstPath.split('/')[0] : 'Local Folder';

    const entries: ScannedFileEntry[] = files.map((file) => ({
      file,
      relativePath:
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }));

    await ingestAudioEntries(entries, {
      folderRootName,
      isFullFolderScan: Boolean(firstPath),
      source: 'manual-folder',
      startedAt,
      totalEncountered: files.length,
    });
  };

  const handleFilesInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const startedAt = Date.now();
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    await ingestAudioEntries(
      files.map((file) => ({ file, relativePath: file.name })),
      {
        isFullFolderScan: false,
        source: 'file-picker',
        startedAt,
        totalEncountered: files.length,
      }
    );
  };

  const handleDropTransfer = async (dataTransfer: DataTransfer) => {
    const startedAt = Date.now();
    const { entries, folderRootName, errors } = await extractDroppedEntries(dataTransfer);
    if (entries.length === 0 && errors.length === 0) return;
    await ingestAudioEntries(entries, {
      folderRootName,
      isFullFolderScan: Boolean(folderRootName),
      source: 'drag-drop',
      startedAt,
      totalEncountered: entries.length + errors.length,
      walkErrors: errors,
    });
  };

  // Compute missing SHA-256 content hashes for previously scanned tracks cached in memory/IndexedDB
  const handleComputeMissingHashes = useCallback(async () => {
    if (isHashingDuplicates) return;
    const targets = tracksRef.current.filter((t) => t.fileSize > 0 && !isSha256Hash(t.contentHash));
    if (targets.length === 0) return;

    setIsHashingDuplicates(true);
    setHashProgress({ processed: 0, total: targets.length });

    try {
      const computedHashes = new Map<string, string>();
      let missingBlobCount = 0;

      for (let i = 0; i < targets.length; i++) {
        const track = targets[i];
        let blob = fileMapRef.current.get(track.fileKey) ?? null;
        if (!blob) {
          blob = await loadAudioBlob(track.fileKey);
          if (blob) {
            fileMapRef.current.set(track.fileKey, blob);
          }
        }
        if (blob) {
          const hash = await computeAudioHash(blob);
          if (hash) {
            computedHashes.set(track.id, hash);
          }
        } else {
          missingBlobCount++;
        }

        if ((i + 1) % 3 === 0 || i === targets.length - 1) {
          setHashProgress({ processed: i + 1, total: targets.length });
        }
      }

      if (computedHashes.size > 0) {
        setTracks((prev) =>
          prev.map((t) => {
            const hash = computedHashes.get(t.id);
            return hash ? { ...t, contentHash: hash } : t;
          })
        );
      }

      if (computedHashes.size > 0 && missingBlobCount === 0) {
        setScanNotice(
          `Verified SHA-256 content hashes for ${computedHashes.size} audio file${computedHashes.size === 1 ? '' : 's'}.`
        );
      } else if (missingBlobCount > 0) {
        setScanNotice(
          computedHashes.size > 0
            ? `Verified ${computedHashes.size} hash(es); ${missingBlobCount} older track(s) need re-scanning to compute hashes.`
            : `${missingBlobCount} track(s) are not cached locally — re-scan their folder or re-add files to compute SHA-256 hashes.`
        );
      }
    } finally {
      setIsHashingDuplicates(false);
      setHashProgress(null);
    }
  }, [isHashingDuplicates]);

  // Deep Audio Integrity scan: validates raw binary container headers & probes real playable duration
  const handleRunIntegrityScan = useCallback(async () => {
    if (isScanningIntegrity) return;
    const targets = tracksRef.current;
    if (targets.length === 0) return;

    setIsScanningIntegrity(true);
    setIntegrityProgress({ processed: 0, total: targets.length });

    try {
      const nextResults: Record<string, TrackIntegrityScanResult> = {};
      let verifiedBlobCount = 0;

      for (let i = 0; i < targets.length; i++) {
        const track = targets[i];
        let blob = fileMapRef.current.get(track.fileKey) ?? null;
        if (!blob) {
          blob = await loadAudioBlob(track.fileKey);
          if (blob) {
            fileMapRef.current.set(track.fileKey, blob);
          }
        }
        if (blob) verifiedBlobCount += 1;

        const result = await inspectAudioBlobIntegrity(track, blob);
        nextResults[track.id] = result;

        if ((i + 1) % 3 === 0 || i === targets.length - 1) {
          setIntegrityProgress({ processed: i + 1, total: targets.length });
        }
      }

      setIntegrityResults(nextResults);
      const summary = summarizeIntegrityIssues(targets, nextResults);
      if (summary.totalFlagged === 0) {
        setScanNotice(
          `Audio Integrity scan passed: all ${targets.length} track${targets.length === 1 ? '' : 's'} healthy (${verifiedBlobCount} binary header${verifiedBlobCount === 1 ? '' : 's'} verified).`
        );
      } else {
        setScanNotice(
          `Audio Integrity found ${summary.totalFlagged} track${summary.totalFlagged === 1 ? '' : 's'} needing attention (${summary.headerIssueCount} header · ${summary.durationIssueCount} duration).`
        );
      }
    } finally {
      setIsScanningIntegrity(false);
      setIntegrityProgress(null);
    }
  }, [isScanningIntegrity]);

  // Apply one-click or manual Audio Integrity metadata fixes (duration & detected container format)
  const handleRepairTrackMetadata = useCallback(
    (patches: Record<string, TrackIntegrityRepairPatch>) => {
      const ids = Object.keys(patches);
      if (ids.length === 0) return;

      setTracks((prev) =>
        prev.map((track) => {
          const patch = patches[track.id];
          if (!patch) return track;
          return {
            ...track,
            duration: patch.duration !== undefined ? patch.duration : track.duration,
            format: patch.format !== undefined ? patch.format : track.format,
          };
        })
      );

      setIntegrityResults((prev) => {
        const next = { ...prev };
        for (const id of ids) {
          const existing = next[id];
          const patch = patches[id];
          if (!existing || !patch) continue;
          next[id] = {
            ...existing,
            suggestedFormat: patch.format ? null : existing.suggestedFormat,
            issues: existing.issues.filter((issue) => {
              if (patch.duration !== undefined && issue.code === 'duration-mismatch') return false;
              if (patch.format !== undefined && issue.code === 'container-mismatch') return false;
              return true;
            }),
          };
        }
        return next;
      });

      pushToast({
        title: 'Audio metadata repaired',
        description: `Updated ${ids.length} track${ids.length === 1 ? '' : 's'} from integrity diagnostics.`,
        tone: 'success',
      });
    },
    [pushToast]
  );

  // Playlist & Track Mutations
  const handleCreatePlaylist = (payload: {
    name: string;
    description: string;
    youtubePlaylistUrl: string;
    syncRule: SyncRule;
  }) => {
    const now = Date.now();
    let initialTrackIds = [...createModalState.seedTrackIds];

    // If no explicit seed tracks selected, populate from matching folder filter
    if (initialTrackIds.length === 0) {
      initialTrackIds = tracks
        .filter((t) => isInFolderScope(t, payload.syncRule.folderFilter))
        .map((t) => t.id);
    }

    const newPlaylist: Playlist = {
      id: crypto.randomUUID(),
      name: payload.name,
      description: payload.description,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: null,
      trackIds: initialTrackIds,
      syncedTrackIds: [],
      youtubePlaylistUrl: payload.youtubePlaylistUrl,
      watchedFolderName: payload.syncRule.folderFilter || watchedFolderName,
      syncRule: payload.syncRule,
    };

    setPlaylists((prev) => [newPlaylist, ...prev]);
    setActivePlaylistId(newPlaylist.id);
    setActiveSmartPlaylistId(null);
    setActiveView('playlist');
  };

  // Smart Playlist CRUD
  const handleSaveSmartPlaylist = (payload: SmartPlaylistFormPayload, editingId?: string) => {
    const now = Date.now();
    if (editingId) {
      setSmartPlaylists((prev) =>
        prev.map((sp) => (sp.id === editingId ? { ...sp, ...payload, updatedAt: now } : sp))
      );
      setActiveSmartPlaylistId(editingId);
      setActivePlaylistId(null);
      setActiveView('smart-playlist');
      pushToast({
        title: 'Smart playlist updated',
        description: payload.name,
        tone: 'success',
        durationMs: 3500,
      });
      return;
    }

    const created: SmartPlaylist = {
      id: crypto.randomUUID(),
      ...payload,
      createdAt: now,
      updatedAt: now,
    };
    setSmartPlaylists((prev) => [created, ...prev]);
    setActiveSmartPlaylistId(created.id);
    setActivePlaylistId(null);
    setActiveView('smart-playlist');
    pushToast({
      title: 'Smart playlist created',
      description: created.name,
      tone: 'success',
      durationMs: 3500,
    });
  };

  const handleDuplicateSmartPlaylist = (smartPlaylistId: string) => {
    const source = smartPlaylists.find((sp) => sp.id === smartPlaylistId);
    if (!source) return;
    const now = Date.now();
    const copy: SmartPlaylist = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} (Copy)`,
      rules: source.rules.map((r) => ({ ...r, id: crypto.randomUUID() })),
      createdAt: now,
      updatedAt: now,
    };
    setSmartPlaylists((prev) => [copy, ...prev]);
    setActiveSmartPlaylistId(copy.id);
    setActivePlaylistId(null);
    setActiveView('smart-playlist');
    pushToast({
      title: 'Smart playlist duplicated',
      description: copy.name,
      tone: 'neutral',
      durationMs: 3200,
    });
  };

  const handleConvertSmartToStaticPlaylist = (
    smartPlaylist: SmartPlaylist,
    matchedTracks: LocalTrack[]
  ) => {
    const now = Date.now();
    const snapshot: Playlist = {
      id: crypto.randomUUID(),
      name: `${smartPlaylist.name} Snapshot`,
      description:
        smartPlaylist.description || `Static snapshot saved from smart playlist "${smartPlaylist.name}".`,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: null,
      trackIds: matchedTracks.map((t) => t.id),
      syncedTrackIds: [],
      youtubePlaylistUrl: '',
      watchedFolderName,
      syncRule: {
        autoAddNewFiles: false,
        removeMissingFiles: true,
        folderFilter: '',
      },
    };
    setPlaylists((prev) => [snapshot, ...prev]);
    setActivePlaylistId(snapshot.id);
    setActiveSmartPlaylistId(null);
    setActiveView('playlist');
    pushToast({
      title: 'Saved as standard playlist',
      description: `${snapshot.name} · ${matchedTracks.length} track${matchedTracks.length === 1 ? '' : 's'}`,
      tone: 'success',
      durationMs: 4000,
    });
  };

  const handleUpdatePlaylist = (playlistId: string, updates: Partial<Playlist>) => {
    setPlaylists((prev) =>
      prev.map((pl) =>
        pl.id === playlistId ? { ...pl, ...updates, updatedAt: Date.now() } : pl
      )
    );
  };

  const handleUpdateSyncRule = (playlistId: string, syncRule: SyncRule) => {
    handleUpdatePlaylist(playlistId, { syncRule });
  };

  const handleAddTracksToPlaylist = (playlistId: string, trackIdsToAdd: string[]) => {
    setPlaylists((prev) =>
      prev.map((pl) => {
        if (pl.id !== playlistId) return pl;
        const existing = new Set(pl.trackIds);
        const merged = [...pl.trackIds];
        for (const id of trackIdsToAdd) {
          if (!existing.has(id)) {
            merged.push(id);
            existing.add(id);
          }
        }
        return { ...pl, trackIds: merged, updatedAt: Date.now() };
      })
    );
    setScanNotice(
      `Added ${trackIdsToAdd.length} track${trackIdsToAdd.length === 1 ? '' : 's'} to playlist.`
    );
  };

  const handleUpdateAlbumCoverArt = (trackIds: string[], coverArtUrl: string | null) => {
    const idSet = new Set(trackIds);
    setTracks((prev) =>
      prev.map((t) => (idSet.has(t.id) ? { ...t, coverArtUrl } : t))
    );
    setScanNotice(
      coverArtUrl
        ? `Updated cover art for ${trackIds.length} track${trackIds.length === 1 ? '' : 's'}.`
        : `Removed cover art for ${trackIds.length} track${trackIds.length === 1 ? '' : 's'}.`
    );
  };

  const handleApplyTrackGenres = useCallback(
    (updates: Record<string, string>) => {
      const entries = Object.entries(updates);
      if (entries.length === 0) return;
      const updateMap = new Map(entries);
      setTracks((prev) =>
        prev.map((t) => {
          const nextGenre = updateMap.get(t.id);
          return nextGenre ? { ...t, genre: nextGenre } : t;
        })
      );
      const uniqueGenres = new Set(entries.map(([, g]) => g)).size;
      pushToast({
        title: 'Genre analysis complete',
        description: `Classified ${entries.length} track${entries.length === 1 ? '' : 's'} across ${uniqueGenres} genre${uniqueGenres === 1 ? '' : 's'}.`,
        tone: 'success',
      });
    },
    [pushToast]
  );

  /**
   * Single-click Library Cleanup removal of missing on-device tracks from the database,
   * pruning orphaned IndexedDB blobs and playlist references cleanly.
   */
  const handleRemoveMissingTracks = (trackIds: string[]) => {
    if (trackIds.length === 0) return;
    const delSet = new Set(trackIds);
    const removedTracks = tracks.filter((t) => delSet.has(t.id));
    const removedKeys = removedTracks.map((t) => t.fileKey);
    addLibraryTombstones(removedTracks.map((t) => trackTombstone(t, Date.now())));

    for (const key of removedKeys) {
      fileMapRef.current.delete(key);
    }
    void deleteAudioBlobs(removedKeys);
    setStoredAudioKeys((prev) => {
      const next = new Set(prev);
      for (const key of removedKeys) next.delete(key);
      return next;
    });

    setTracks((prev) => prev.filter((t) => !delSet.has(t.id)));
    setPlaylists((prev) =>
      prev.map((pl) => ({
        ...pl,
        trackIds: pl.trackIds.filter((id) => !delSet.has(id)),
        syncedTrackIds: pl.syncedTrackIds.filter((id) => !delSet.has(id)),
      }))
    );

    if (audioPlayer.state.activeTrackId && delSet.has(audioPlayer.state.activeTrackId)) {
      audioPlayer.stop();
    }
    if (inspectedTrackId && delSet.has(inspectedTrackId)) {
      setInspectedTrackId(null);
    }

    setScanNotice(
      `Library Cleanup removed ${trackIds.length} missing track${trackIds.length === 1 ? '' : 's'} from your database.`
    );
  };

  const handleReorderTrack = (playlistId: string, fromIdx: number, toIdx: number) => {
    setPlaylists((prev) =>
      prev.map((pl) => {
        if (pl.id !== playlistId) return pl;
        if (toIdx < 0 || toIdx >= pl.trackIds.length) return pl;
        const nextIds = [...pl.trackIds];
        const [moved] = nextIds.splice(fromIdx, 1);
        nextIds.splice(toIdx, 0, moved);
        return { ...pl, trackIds: nextIds, updatedAt: Date.now() };
      })
    );
  };

  const handleRemoveTrackFromPlaylist = (playlistId: string, trackId: string) => {
    setPlaylists((prev) =>
      prev.map((pl) =>
        pl.id === playlistId
          ? {
              ...pl,
              trackIds: pl.trackIds.filter((id) => id !== trackId),
              updatedAt: Date.now(),
            }
          : pl
      )
    );
  };

  const executeApplySync = (playlistId: string) => {
    const playlist = playlists.find((p) => p.id === playlistId);
    const diff = diffMap.get(playlistId);
    if (!playlist || !diff) return;

    const removeSet = new Set(diff.toRemove.map((t) => t.id));
    const nextTrackIds = Array.from(
      new Set([
        ...playlist.trackIds.filter((id) => !removeSet.has(id)),
        ...diff.toAdd.map((t) => t.id),
      ])
    );

    const matchedCount = nextTrackIds.filter((id) => Boolean(trackMap.get(id)?.youtubeVideoId))
      .length;
    const now = Date.now();

    setPlaylists((prev) =>
      prev.map((pl) =>
        pl.id === playlistId
          ? {
              ...pl,
              trackIds: nextTrackIds,
              syncedTrackIds: nextTrackIds,
              lastSyncedAt: now,
              updatedAt: now,
            }
          : pl
      )
    );

    const event: SyncEvent = {
      id: crypto.randomUUID(),
      playlistId: playlist.id,
      playlistName: playlist.name,
      timestamp: now,
      addedCount: diff.toAdd.length,
      removedCount: diff.toRemove.length,
      matchedCount,
      totalTracks: nextTrackIds.length,
      summary: `Synced ${nextTrackIds.length} tracks (+${diff.toAdd.length}, -${diff.toRemove.length})`,
    };

    setSyncHistory((prev) => [event, ...prev].slice(0, 50));
  };

  const handleOpenYouTubePush = (playlistId: string) => {
    setYouTubePush({ playlistId, state: { phase: 'review', connectError: null } });
  };

  /**
   * Runs from the dialog's button. connectYouTube has to be called before the first await,
   * or the browser no longer ties Google's popup to the click and blocks it.
   */
  const handleStartYouTubePush = async () => {
    if (!youtubePush || youtubePush.state.phase !== 'review') return;
    const playlistId = youtubePush.playlistId;
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist) return;
    const playlistTracks = playlist.trackIds
      .map((id) => trackMap.get(id))
      .filter((t): t is LocalTrack => Boolean(t));

    setYouTubePush({ playlistId, state: { phase: 'working', progress: null } });

    let accessToken: string;
    try {
      accessToken = getYouTubeAccessToken() ?? (await connectYouTube());
    } catch (err) {
      setYouTubePush({
        playlistId,
        state: { phase: 'review', connectError: describeYouTubeConnectError(err) },
      });
      return;
    }

    const controller = new AbortController();
    youtubePushAbortRef.current = controller;
    const now = Date.now();
    const outcome = await pushPlaylistToYouTube({
      api: createYouTubeApi(accessToken),
      playlist,
      tracks: playlistTracks,
      now,
      signal: controller.signal,
      onProgress: (progress) =>
        setYouTubePush((current) =>
          current && current.playlistId === playlistId && current.state.phase === 'working'
            ? { playlistId, state: { phase: 'working', progress } }
            : current
        ),
    });
    youtubePushAbortRef.current = null;

    if (outcome.stopped?.failure === 'auth') clearYouTubeAccessToken();

    setPlaylists((prev) =>
      prev.map((pl) => (pl.id === playlistId ? playlistAfterPush(pl, outcome, now) : pl))
    );

    if (outcome.inserted.length + outcome.removed.length + outcome.moved.length > 0) {
      const event: SyncEvent = {
        id: crypto.randomUUID(),
        playlistId,
        playlistName: playlist.name,
        timestamp: now,
        addedCount: outcome.inserted.length,
        removedCount: outcome.removed.length,
        matchedCount: playlistTracks.filter((t) => Boolean(t.youtubeVideoId)).length,
        totalTracks: playlistTracks.length,
        summary: `Pushed to YouTube (+${outcome.inserted.length}, -${outcome.removed.length}${
          outcome.moved.length > 0 ? `, ${outcome.moved.length} moved` : ''
        })`,
      };
      setSyncHistory((prev) => [event, ...prev].slice(0, 50));
    }

    setYouTubePush({ playlistId, state: { phase: 'done', outcome } });
  };

  const handleRequestApplySync = (playlistId: string) => {
    const playlist = playlists.find((p) => p.id === playlistId);
    const diff = diffMap.get(playlistId);
    if (!playlist || !diff) return;

    if (diff.toRemove.length > 0) {
      setPendingConfirm({
        kind: 'apply-sync',
        playlistId,
        name: playlist.name,
        addCount: diff.toAdd.length,
        removeCount: diff.toRemove.length,
      });
    } else {
      executeApplySync(playlistId);
    }
  };

  const handleSaveTrackInspection = (
    trackId: string,
    updates: Partial<
      Pick<
        LocalTrack,
        'title' | 'artist' | 'album' | 'genre' | 'year' | 'youtubeVideoId' | 'matchStatus'
      >
    >,
    advanceToNext = false
  ) => {
    const nextTracks = tracks.map((t) => (t.id === trackId ? { ...t, ...updates } : t));
    setTracks(nextTracks);

    if (advanceToNext) {
      const currentIdx = nextTracks.findIndex((t) => t.id === trackId);
      const nextUnmatched =
        nextTracks
          .slice(currentIdx + 1)
          .find((t) => !t.youtubeVideoId && t.matchStatus === 'unmatched') ||
        nextTracks.find(
          (t) => t.id !== trackId && !t.youtubeVideoId && t.matchStatus === 'unmatched'
        );
      setInspectedTrackId(nextUnmatched ? nextUnmatched.id : null);
    } else {
      setInspectedTrackId(null);
    }
  };

  const handleApplyBatchTagEdits = (patchesById: Record<string, BatchTrackPatch>) => {
    const ids = Object.keys(patchesById);
    if (ids.length === 0) return;

    setTracks((prev) =>
      prev.map((track) => {
        const patch = patchesById[track.id];
        if (!patch) return track;
        const nextTrack: LocalTrack = { ...track, ...patch };
        // Keep youtubeVideoId consistent if batch explicitly changed matchStatus to unmatched/skipped
        if (patch.matchStatus === 'skipped' || patch.matchStatus === 'unmatched') {
          nextTrack.youtubeVideoId = null;
        }
        return nextTrack;
      })
    );
    setScanNotice(
      `Updated metadata tags on ${ids.length} track${ids.length === 1 ? '' : 's'}.`
    );
  };

  const handleImportPlaylist = (name: string, seeds: ImportedTrackSeed[]) => {
    const plan = planPlaylistImport({
      name,
      seeds,
      existingTracks: tracks,
      now: Date.now(),
      newId: () => crypto.randomUUID(),
    });

    if (plan.newTracks.length > 0 || plan.videoIdsToLink.size > 0) {
      setTracks((prev) => [
        ...plan.newTracks,
        ...prev.map((track): LocalTrack => {
          const videoId = plan.videoIdsToLink.get(track.id);
          return videoId ? { ...track, youtubeVideoId: videoId, matchStatus: 'matched' } : track;
        }),
      ]);
    }

    setPlaylists((prev) => [plan.playlist, ...prev]);
    setActivePlaylistId(plan.playlist.id);
    setActiveView('playlist');
  };

  const handleRestoreLibraryBackup = useCallback(
    (backup: CrateSyncLibraryBackupPayload, mode: 'merge' | 'replace') => {
      const now = Date.now();

      if (mode === 'replace') {
        // A restore brings records back on purpose, so an earlier deletion must not remove
        // them again at the next Drive merge.
        const restored = reviveTombstoned({
          tracks: backup.tracks,
          playlists: backup.playlists,
          smartPlaylists: backup.smartPlaylists,
          tombstones: libraryTombstonesRef.current,
          now,
        });
        setTracks(restored.tracks);
        setPlaylists(restored.playlists);
        setSmartPlaylists(restored.smartPlaylists);
        setSyncHistory(backup.syncHistory);
        if (backup.watchedFolderName) {
          setWatchedFolderName(backup.watchedFolderName);
        }
        pushToast({
          title: 'Library restored from Google Drive',
          description: `${backup.tracks.length} tracks · ${backup.playlists.length} playlists`,
          tone: 'success',
        });
        return;
      }

      const existingTracks = tracksRef.current;
      const byId = new Map<string, LocalTrack>();
      const byFileKey = new Map<string, LocalTrack>();
      const byArtistTitle = new Map<string, LocalTrack>();

      for (const t of existingTracks) {
        byId.set(t.id, t);
        byFileKey.set(t.fileKey.toLowerCase(), t);
        byArtistTitle.set(`${t.artist.toLowerCase()}::${t.title.toLowerCase()}`, t);
      }

      const idRemap = new Map<string, string>();
      const enrichedExisting = new Map<string, LocalTrack>();
      const tracksToAdd: LocalTrack[] = [];

      for (const incoming of backup.tracks) {
        const matched =
          byId.get(incoming.id) ??
          byFileKey.get(incoming.fileKey.toLowerCase()) ??
          byArtistTitle.get(`${incoming.artist.toLowerCase()}::${incoming.title.toLowerCase()}`);

        if (matched) {
          idRemap.set(incoming.id, matched.id);
          const mergedTrack: LocalTrack = {
            ...matched,
            genre: matched.genre || incoming.genre,
            year: matched.year || incoming.year,
            youtubeVideoId: matched.youtubeVideoId || incoming.youtubeVideoId,
            youtubeTitle: matched.youtubeTitle || incoming.youtubeTitle,
            matchStatus:
              matched.youtubeVideoId || incoming.youtubeVideoId
                ? 'matched'
                : matched.matchStatus,
            playCount: Math.max(matched.playCount ?? 0, incoming.playCount ?? 0) || undefined,
            skipCount: Math.max(matched.skipCount ?? 0, incoming.skipCount ?? 0) || undefined,
            lastPlayedAt:
              Math.max(matched.lastPlayedAt ?? 0, incoming.lastPlayedAt ?? 0) || null,
          };
          enrichedExisting.set(matched.id, mergedTrack);
        } else {
          idRemap.set(incoming.id, incoming.id);
          tracksToAdd.push({
            ...incoming,
            addedAt: incoming.addedAt || now,
            lastSeenAt: incoming.lastSeenAt || now,
          });
        }
      }

      const restored = reviveTombstoned({
        tracks: tracksToAdd,
        playlists: [],
        smartPlaylists: backup.smartPlaylists,
        tombstones: libraryTombstonesRef.current,
        now,
      });
      setTracks((prev) => [
        ...restored.tracks,
        ...prev.map((t) => enrichedExisting.get(t.id) ?? t),
      ]);

      const remapTrackIds = (ids: string[]): string[] => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const id of ids) {
          const mapped = idRemap.get(id) ?? id;
          if (!seen.has(mapped)) {
            seen.add(mapped);
            out.push(mapped);
          }
        }
        return out;
      };

      // Count outside the updater: React runs queued updaters during the next render, so a
      // counter incremented inside setPlaylists is still 0 when the toast below is built.
      const knownPlaylistIds = new Set(playlistsRef.current.map((p) => p.id));
      const addedPlaylists = backup.playlists.filter((p) => !knownPlaylistIds.has(p.id)).length;
      setPlaylists((prev) => {
        const existingById = new Map(prev.map((p) => [p.id, p]));
        const next = [...prev];
        for (const incomingPl of backup.playlists) {
          const remappedTrackIds = remapTrackIds(incomingPl.trackIds);
          const remappedSyncedIds = remapTrackIds(incomingPl.syncedTrackIds ?? []);
          const existing = existingById.get(incomingPl.id);
          if (existing) {
            const mergedTrackIds = Array.from(
              new Set([...existing.trackIds, ...remappedTrackIds])
            );
            const idx = next.findIndex((p) => p.id === existing.id);
            if (idx !== -1) {
              next[idx] = {
                ...existing,
                trackIds: mergedTrackIds,
                youtubePlaylistUrl: existing.youtubePlaylistUrl || incomingPl.youtubePlaylistUrl,
                // The record names the YouTube playlist it is about, so one that does not
                // match the link kept above is ignored.
                youtubePush: existing.youtubePush ?? incomingPl.youtubePush,
                updatedAt: now,
              };
            }
          } else {
            next.unshift({
              ...incomingPl,
              trackIds: remappedTrackIds,
              syncedTrackIds: remappedSyncedIds,
              updatedAt: now,
            });
          }
        }
        return next;
      });

      if (backup.smartPlaylists.length > 0) {
        setSmartPlaylists((prev) => {
          const existingIds = new Set(prev.map((sp) => sp.id));
          const existingNames = new Set(prev.map((sp) => sp.name.toLowerCase()));
          const additions = restored.smartPlaylists.filter(
            (sp) => !existingIds.has(sp.id) && !existingNames.has(sp.name.toLowerCase())
          );
          return additions.length > 0 ? [...additions, ...prev] : prev;
        });
      }

      if (backup.syncHistory.length > 0) {
        setSyncHistory((prev) => {
          const byEventId = new Map(prev.map((ev) => [ev.id, ev]));
          for (const ev of backup.syncHistory) {
            if (!byEventId.has(ev.id)) {
              byEventId.set(ev.id, ev);
            }
          }
          return Array.from(byEventId.values())
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 50);
        });
      }

      if (backup.devices && backup.devices.length > 0) {
        setDevices((prev) => mergeDeviceProfiles(prev, backup.devices ?? [], currentDeviceRef.current));
      }
      if (
        (backup.folderMappings?.length ?? 0) > 0 ||
        (backup.folderMappingTombstones?.length ?? 0) > 0
      ) {
        const merged = mergeFolderMappingState(
          {
            folderMappings: folderMappingsRef.current,
            folderMappingTombstones: folderMappingTombstonesRef.current,
          },
          backup,
          currentDeviceRef.current.id
        );
        folderMappingsRef.current = merged.folderMappings;
        folderMappingTombstonesRef.current = merged.folderMappingTombstones;
        setFolderMappings(merged.folderMappings);
        setFolderMappingTombstones(merged.folderMappingTombstones);
      }

      pushToast({
        title: 'Google Drive backup restored',
        description: `Merged ${tracksToAdd.length} new track${tracksToAdd.length === 1 ? '' : 's'} & ${addedPlaylists} playlist${addedPlaylists === 1 ? '' : 's'} (enriched ${enrichedExisting.size} existing).`,
        tone: 'success',
        durationMs: 5000,
      });
    },
    [pushToast]
  );

  const handleRenameCurrentDevice = useCallback(
    (newName: string) => {
      const updated = saveCurrentDeviceProfile({
        ...currentDeviceRef.current,
        name: newName,
      });
      setCurrentDevice(updated);
      setDevices((prev) => mergeDeviceProfiles(prev, [], updated));
      pushToast({
        title: 'Playing device renamed',
        description: updated.name,
        tone: 'success',
      });
    },
    [pushToast]
  );

  const handleSaveFolderMapping = useCallback(
    (params: {
      driveFolderId: string;
      driveFolderName: string;
      binding: DeviceFolderBinding;
    }) => {
      const now = Date.now();
      // updatedAt lets this binding outlive any earlier tombstone for the same mapping.
      const binding: DeviceFolderBinding = { ...params.binding, updatedAt: now };
      setFolderMappings((prev) => {
        const existingIdx = prev.findIndex((m) => m.driveFolderId === params.driveFolderId);
        if (existingIdx !== -1) {
          const existing = prev[existingIdx];
          const updated: DriveFolderMapping = {
            ...existing,
            driveFolderName: params.driveFolderName || existing.driveFolderName,
            updatedAt: now,
            deviceBindings: {
              ...existing.deviceBindings,
              [binding.deviceId]: binding,
            },
          };
          const next = [...prev];
          next[existingIdx] = updated;
          return next;
        }

        const created: DriveFolderMapping = {
          id: crypto.randomUUID(),
          driveFolderId: params.driveFolderId,
          driveFolderName: params.driveFolderName,
          createdAt: now,
          updatedAt: now,
          deviceBindings: {
            [binding.deviceId]: binding,
          },
        };
        return [created, ...prev];
      });
      pushToast({
        title: 'Folder mapping saved',
        description: `Drive "${params.driveFolderName}" ↔ ${params.binding.localFolderPath || 'IndexedDB Offline Cache'}`,
        tone: 'success',
      });
    },
    [pushToast]
  );

  const addFolderMappingTombstone = useCallback((tombstone: FolderMappingTombstone) => {
    const next = mergeFolderMappingTombstones([folderMappingTombstonesRef.current, [tombstone]]);
    folderMappingTombstonesRef.current = next;
    setFolderMappingTombstones(next);
  }, []);

  const handleUnbindDeviceFromMapping = useCallback(
    (mappingId: string, deviceId: string) => {
      const mapping = folderMappingsRef.current.find((m) => m.id === mappingId);
      if (mapping) {
        addFolderMappingTombstone({
          driveFolderId: mapping.driveFolderId,
          deviceId,
          deletedAt: Date.now(),
        });
      }
      setFolderMappings((prev) =>
        prev
          .map((m) => {
            if (m.id !== mappingId) return m;
            const nextBindings = { ...m.deviceBindings };
            delete nextBindings[deviceId];
            return {
              ...m,
              updatedAt: Date.now(),
              deviceBindings: nextBindings,
            };
          })
          .filter((m) => Object.keys(m.deviceBindings).length > 0)
      );
      pushToast({
        title: 'Device unbound from folder mapping',
        description: 'Other synced devices keep their own folder bindings.',
        tone: 'neutral',
      });
    },
    [pushToast, addFolderMappingTombstone]
  );

  const handleDeleteFolderMapping = useCallback(
    (mappingId: string) => {
      const mapping = folderMappingsRef.current.find((m) => m.id === mappingId);
      if (mapping) {
        addFolderMappingTombstone({ driveFolderId: mapping.driveFolderId, deletedAt: Date.now() });
      }
      setFolderMappings((prev) => prev.filter((m) => m.id !== mappingId));
      pushToast({
        title: 'Folder mapping removed',
        tone: 'neutral',
      });
    },
    [pushToast, addFolderMappingTombstone]
  );

  /** Whether this device has the audio of a song, in memory or in its cache. */
  const holdsAudioOnDevice = useCallback(
    (track: LocalTrack) =>
      fileMapRef.current.has(track.fileKey) || storedAudioKeysRef.current.has(track.fileKey),
    []
  );

  /**
   * Works out what a push writes to the Drive manifest. It joins this device's library, devices
   * and folder mappings with what the manifest already holds, so a push from a device that had
   * not pulled does not erase what other devices wrote since. The library on screen stays as it
   * is. Only the merged deletions and folder state are taken into this device.
   */
  const handlePrepareManifestForPush = useCallback(
    (
      remote: CrateSyncLibraryBackupPayload | null,
      local: LocalLibraryForPush
    ) => {
      const now = Date.now();
      const merged = mergeLibraryForPush({
        local: { ...local, tombstones: libraryTombstonesRef.current },
        remote: remote
          ? {
              tracks: remote.tracks,
              playlists: remote.playlists,
              smartPlaylists: remote.smartPlaylists,
              syncHistory: remote.syncHistory,
              tombstones: remote.libraryTombstones ?? [],
            }
          : null,
        holdsAudio: holdsAudioOnDevice,
        now,
      });
      libraryTombstonesRef.current = merged.library.tombstones;
      setLibraryTombstones(merged.library.tombstones);
      if (merged.revivedTrackIds.length > 0) {
        // Another device deleted these songs, but this one holds the files. They stay, and the
        // same time goes on this device's copy so later pushes do not mark them again.
        const revived = new Set(merged.revivedTrackIds);
        setTracks((prev) =>
          prev.map((track) => (revived.has(track.id) ? { ...track, updatedAt: now } : track))
        );
      }

      if (!remote) {
        return {
          ...merged,
          devices: devicesRef.current,
          folderMappings: folderMappingsRef.current,
          folderMappingTombstones: folderMappingTombstonesRef.current,
        };
      }
      const devicesNext = mergeDeviceProfiles(
        devicesRef.current,
        remote.devices ?? [],
        currentDeviceRef.current
      );
      const folderState = mergeFolderMappingState(
        {
          folderMappings: folderMappingsRef.current,
          folderMappingTombstones: folderMappingTombstonesRef.current,
        },
        remote,
        currentDeviceRef.current.id
      );
      devicesRef.current = devicesNext;
      folderMappingsRef.current = folderState.folderMappings;
      folderMappingTombstonesRef.current = folderState.folderMappingTombstones;
      setDevices(devicesNext);
      setFolderMappings(folderState.folderMappings);
      setFolderMappingTombstones(folderState.folderMappingTombstones);
      return { ...merged, devices: devicesNext, ...folderState };
    },
    [holdsAudioOnDevice, setTracks]
  );

  const handleMarkMappingSynced = useCallback((mappingId: string, deviceId: string) => {
    const now = Date.now();
    setFolderMappings((prev) =>
      prev.map((m) => {
        if (m.id !== mappingId) return m;
        const binding = m.deviceBindings[deviceId];
        if (!binding) return m;
        return {
          ...m,
          updatedAt: now,
          deviceBindings: {
            ...m.deviceBindings,
            [deviceId]: {
              ...binding,
              lastSyncedAt: now,
            },
          },
        };
      })
    );
  }, []);

  /**
   * Reconciles this playing device's catalog with Google Drive as the authoritative source of truth
   * (canonical manifest playlists/songs/mappings + all Drive audio files), translating paths to this device's folder mappings.
   */
  const handleSyncFromDriveSourceOfTruth = useCallback(
    (payload: {
      manifest: CrateSyncLibraryBackupPayload | null;
      driveAudioFiles: DriveFileItem[];
      folderLabel: string;
      mappedDriveFolderId?: string | null;
      replaceWithSourceOfTruth: boolean;
    }): {
      addedSongs: number;
      updatedSongs: number;
      playlistCount: number;
      syncedTrackIds: string[];
    } => {
      const now = Date.now();
      const existingTracks = tracksRef.current;

      // Merge remote device profiles & cross-device folder mappings first so path translation uses latest bindings
      const manifestHasFolderState =
        (payload.manifest?.folderMappings?.length ?? 0) > 0 ||
        (payload.manifest?.folderMappingTombstones?.length ?? 0) > 0;
      const mergedFolderState =
        payload.manifest && manifestHasFolderState
          ? mergeFolderMappingState(
              {
                folderMappings: folderMappingsRef.current,
                folderMappingTombstones: folderMappingTombstonesRef.current,
              },
              payload.manifest,
              currentDeviceRef.current.id
            )
          : null;
      const effectiveMappings = mergedFolderState?.folderMappings ?? folderMappingsRef.current;

      if (payload.manifest?.devices && payload.manifest.devices.length > 0) {
        setDevices((prev) =>
          mergeDeviceProfiles(prev, payload.manifest!.devices ?? [], currentDeviceRef.current)
        );
      }
      if (mergedFolderState) {
        folderMappingsRef.current = mergedFolderState.folderMappings;
        folderMappingTombstonesRef.current = mergedFolderState.folderMappingTombstones;
        setFolderMappings(mergedFolderState.folderMappings);
        setFolderMappingTombstones(mergedFolderState.folderMappingTombstones);
      }

      const activeDeviceId = currentDeviceRef.current.id;
      const explicitBinding = payload.mappedDriveFolderId
        ? resolveLocalBindingForDriveFolder(
            payload.mappedDriveFolderId,
            effectiveMappings,
            activeDeviceId
          )
        : null;

      const existingByDriveId = new Map<string, LocalTrack>();
      const existingById = new Map<string, LocalTrack>();
      const existingByFileKey = new Map<string, LocalTrack>();
      const existingByNameSize = new Map<string, LocalTrack>();

      for (const t of existingTracks) {
        if (t.driveFileId) existingByDriveId.set(t.driveFileId, t);
        existingById.set(t.id, t);
        existingByFileKey.set(t.fileKey.toLowerCase(), t);
        if (t.fileSize > 0) {
          existingByNameSize.set(`${t.fileName.toLowerCase()}::${t.fileSize}`, t);
        }
      }

      const idRemap = new Map<string, string>();
      const nextById = new Map<string, LocalTrack>();
      const syncedTrackIds: string[] = [];
      let addedSongs = 0;
      let updatedSongs = 0;

      if (!payload.replaceWithSourceOfTruth) {
        for (const t of existingTracks) {
          nextById.set(t.id, t);
        }
      }

      const resolveCachedKey = (candidate: LocalTrack, existing?: LocalTrack): string => {
        if (
          existing &&
          (fileMapRef.current.has(existing.fileKey) ||
            storedAudioKeysRef.current.has(existing.fileKey))
        ) {
          return existing.fileKey;
        }
        return candidate.fileKey;
      };

      // Helper to resolve mapped local path for a Drive track on this playing device
      const resolveDeviceMappedLocation = (
        fileName: string,
        drivePath: string | null | undefined,
        parentFolderIds?: string[]
      ): { folderName: string; relativePath: string } | null => {
        if (explicitBinding) {
          return translateRelativePathForDevice(
            fileName,
            explicitBinding.binding.localFolderPath,
            explicitBinding.mapping.driveFolderName
          );
        }
        if (parentFolderIds && parentFolderIds.length > 0) {
          for (const pid of parentFolderIds) {
            const matchedBind = resolveLocalBindingForDriveFolder(
              pid,
              effectiveMappings,
              activeDeviceId
            );
            if (matchedBind) {
              return translateRelativePathForDevice(
                fileName,
                matchedBind.binding.localFolderPath,
                matchedBind.mapping.driveFolderName
              );
            }
          }
        }
        if (drivePath) {
          const byName = effectiveMappings.find(
            (m) =>
              m.driveFolderName.toLowerCase() === drivePath.toLowerCase() &&
              Boolean(m.deviceBindings[activeDeviceId])
          );
          if (byName) {
            return translateRelativePathForDevice(
              fileName,
              byName.deviceBindings[activeDeviceId].localFolderPath,
              byName.driveFolderName
            );
          }
        }
        return null;
      };

      // 1. Reconcile tracks from the canonical Drive manifest
      if (payload.manifest) {
        for (const incoming of payload.manifest.tracks) {
          const mappedLoc = resolveDeviceMappedLocation(
            incoming.fileName,
            incoming.drivePath
          );
          const matched =
            (incoming.driveFileId ? existingByDriveId.get(incoming.driveFileId) : undefined) ??
            existingById.get(incoming.id) ??
            existingByFileKey.get(incoming.fileKey.toLowerCase()) ??
            (incoming.fileSize > 0
              ? existingByNameSize.get(`${incoming.fileName.toLowerCase()}::${incoming.fileSize}`)
              : undefined);

          if (matched) {
            const keptFileKey = resolveCachedKey(incoming, matched);
            const isCachedHere =
              fileMapRef.current.has(keptFileKey) || storedAudioKeysRef.current.has(keptFileKey);
            idRemap.set(incoming.id, matched.id);
            nextById.set(matched.id, {
              ...matched,
              ...incoming,
              id: matched.id,
              fileKey: keptFileKey,
              folderName: mappedLoc?.folderName ?? matched.folderName ?? incoming.folderName,
              relativePath: mappedLoc?.relativePath ?? matched.relativePath ?? incoming.relativePath,
              coverArtUrl: incoming.coverArtUrl || matched.coverArtUrl,
              cachedOnDeviceAt: isCachedHere ? matched.cachedOnDeviceAt ?? now : null,
              isMissingOnDevice: false,
              ...(payload.replaceWithSourceOfTruth
                ? {}
                : newerTrackEdits(matched, incoming, 'remote')),
            });
            updatedSongs += 1;
          } else {
            idRemap.set(incoming.id, incoming.id);
            const isCachedHere =
              fileMapRef.current.has(incoming.fileKey) ||
              storedAudioKeysRef.current.has(incoming.fileKey);
            nextById.set(incoming.id, {
              ...incoming,
              folderName: mappedLoc?.folderName ?? incoming.folderName,
              relativePath: mappedLoc?.relativePath ?? incoming.relativePath,
              cachedOnDeviceAt: isCachedHere ? now : null,
              isMissingOnDevice: false,
            });
            addedSongs += 1;
          }
        }
      }

      // Index current reconciled set by driveFileId & fileName+size so Drive audio files attach cleanly
      const reconciledByDriveId = new Map<string, LocalTrack>();
      const reconciledByNameSize = new Map<string, LocalTrack>();
      for (const t of nextById.values()) {
        if (t.driveFileId) reconciledByDriveId.set(t.driveFileId, t);
        if (t.fileSize > 0) {
          reconciledByNameSize.set(`${t.fileName.toLowerCase()}::${t.fileSize}`, t);
        }
      }

      // 2. Reconcile actual audio files discovered in Google Drive
      for (const driveFile of payload.driveAudioFiles) {
        const effectiveDrivePath = driveFile.folderPath || payload.folderLabel;
        const mappedLoc = resolveDeviceMappedLocation(
          driveFile.name,
          effectiveDrivePath,
          driveFile.parents
        );
        // Preserve nested subfolder hierarchy inside mapped Drive folder (e.g. Music/Artist/Album -> LocalMusic/Artist/Album)
        let finalMappedLoc = mappedLoc;
        if (explicitBinding && driveFile.folderPath && explicitBinding.binding.localFolderPath) {
          const rootNorm = payload.folderLabel.replace(/^\/+|\/+$/g, '');
          const filePathNorm = driveFile.folderPath.replace(/^\/+|\/+$/g, '');
          if (
            rootNorm &&
            filePathNorm.toLowerCase().startsWith(`${rootNorm.toLowerCase()}/`)
          ) {
            const subSuffix = filePathNorm.slice(rootNorm.length + 1);
            const localRoot = explicitBinding.binding.localFolderPath.replace(/^\/+|\/+$/g, '');
            const combinedLocalDir = subSuffix ? `${localRoot}/${subSuffix}` : localRoot;
            const leafFolder = combinedLocalDir.split('/').pop() || localRoot;
            finalMappedLoc = {
              folderName: leafFolder,
              relativePath: `${combinedLocalDir}/${driveFile.name}`,
            };
          }
        }
        const matched =
          reconciledByDriveId.get(driveFile.id) ??
          existingByDriveId.get(driveFile.id) ??
          (driveFile.size > 0
            ? reconciledByNameSize.get(`${driveFile.name.toLowerCase()}::${driveFile.size}`) ??
              existingByNameSize.get(`${driveFile.name.toLowerCase()}::${driveFile.size}`)
            : undefined);

        if (matched) {
          const isCachedHere =
            fileMapRef.current.has(matched.fileKey) ||
            storedAudioKeysRef.current.has(matched.fileKey);
          nextById.set(matched.id, {
            ...matched,
            driveFileId: driveFile.id,
            driveModifiedTime: driveFile.modifiedTime,
            drivePath: effectiveDrivePath,
            folderName: finalMappedLoc?.folderName ?? matched.folderName,
            relativePath: finalMappedLoc?.relativePath ?? matched.relativePath,
            fileSize: driveFile.size || matched.fileSize,
            cachedOnDeviceAt: isCachedHere ? matched.cachedOnDeviceAt ?? now : null,
            isMissingOnDevice: false,
            lastSeenAt: now,
          });
          syncedTrackIds.push(matched.id);
          updatedSongs += 1;
        } else {
          const stub = buildTrackStubFromDriveAudio(driveFile, effectiveDrivePath);
          const isCachedHere =
            fileMapRef.current.has(stub.fileKey) || storedAudioKeysRef.current.has(stub.fileKey);
          nextById.set(stub.id, {
            ...stub,
            folderName: finalMappedLoc?.folderName ?? stub.folderName,
            relativePath: finalMappedLoc?.relativePath ?? stub.relativePath,
            cachedOnDeviceAt: isCachedHere ? now : null,
          });
          syncedTrackIds.push(stub.id);
          addedSongs += 1;
        }
      }

      const finalTracks = Array.from(nextById.values()).sort((a, b) => b.addedAt - a.addedAt);

      const remapTrackIds = (ids: string[]): string[] => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const id of ids) {
          const mapped = idRemap.get(id) ?? id;
          if (!seen.has(mapped) && nextById.has(mapped)) {
            seen.add(mapped);
            out.push(mapped);
          }
        }
        return out;
      };

      let nextPlaylists = playlistsRef.current;
      let nextSmartPlaylists = smartPlaylistsRef.current;
      let playlistCount = 0;
      if (payload.manifest) {
        const incomingPlaylists = payload.manifest.playlists.map((pl) => ({
          ...pl,
          trackIds: remapTrackIds(pl.trackIds),
          syncedTrackIds: remapTrackIds(pl.syncedTrackIds ?? []),
        }));
        playlistCount = incomingPlaylists.length;

        if (payload.replaceWithSourceOfTruth) {
          nextPlaylists = incomingPlaylists;
          nextSmartPlaylists = payload.manifest.smartPlaylists;
          setSyncHistory(payload.manifest.syncHistory);
        } else {
          // A playlist both sides have is taken whole from the side that changed it last. Joining
          // the two track lists, as this used to, brought back every song removed on one device.
          nextPlaylists = newestWins(nextPlaylists, incomingPlaylists, 'remote');

          // A smart playlist from Drive is skipped when a local one already uses its name.
          const localSmartIds = new Set(nextSmartPlaylists.map((sp) => sp.id));
          const localSmartNames = new Set(nextSmartPlaylists.map((sp) => sp.name.toLowerCase()));
          nextSmartPlaylists = newestWins(
            nextSmartPlaylists,
            payload.manifest.smartPlaylists.filter(
              (sp) => localSmartIds.has(sp.id) || !localSmartNames.has(sp.name.toLowerCase())
            ),
            'remote'
          );
        }
      }

      // Deletions made on other devices apply here too. Replacing the library with Drive's copy
      // applies none: whatever Drive holds comes back, marked as changed now so the next merge
      // does not delete it again.
      const tombstones = mergeLibraryTombstones(
        [libraryTombstonesRef.current, payload.manifest?.libraryTombstones],
        now
      );
      const merging = {
        tracks: finalTracks,
        playlists: nextPlaylists,
        smartPlaylists: nextSmartPlaylists,
        tombstones,
        now,
      };
      const next = payload.replaceWithSourceOfTruth
        ? reviveTombstoned(merging)
        : dropTombstoned({ ...merging, holdsAudio: holdsAudioOnDevice });

      libraryTombstonesRef.current = tombstones;
      setLibraryTombstones(tombstones);
      setTracks(next.tracks);
      setPlaylists(next.playlists);
      setSmartPlaylists(next.smartPlaylists);

      return { addedSongs, updatedSongs, playlistCount, syncedTrackIds };
    },
    [holdsAudioOnDevice, setTracks, setPlaylists]
  );

  const handleLinkUploadedDriveTracks = useCallback(
    (
      updates: Array<{
        trackId: string;
        driveFileId: string;
        driveModifiedTime: string;
        drivePath: string;
      }>
    ) => {
      if (updates.length === 0) return;
      const byTrackId = new Map(updates.map((u) => [u.trackId, u]));
      setTracks((prev) =>
        prev.map((t) => {
          const link = byTrackId.get(t.id);
          return link
            ? {
                ...t,
                driveFileId: link.driveFileId,
                driveModifiedTime: link.driveModifiedTime,
                drivePath: link.drivePath,
              }
            : t;
        })
      );
    },
    []
  );

  const handleEvictTrackCache = useCallback(
    async (fileKeys: string[]) => {
      if (fileKeys.length === 0) return;
      for (const key of fileKeys) {
        fileMapRef.current.delete(key);
      }
      await deleteAudioBlobs(fileKeys);
      const evictedSet = new Set(fileKeys);
      setTracks((prev) =>
        prev.map((t) =>
          evictedSet.has(t.fileKey) ? { ...t, cachedOnDeviceAt: null } : t
        )
      );
      await refreshDeviceCacheStats();
      pushToast({
        title: 'Removed from device cache',
        description: 'Original song remains stored in Google Drive.',
        tone: 'neutral',
      });
    },
    [refreshDeviceCacheStats, pushToast]
  );

  const handleClearAllDeviceCache = useCallback(async () => {
    fileMapRef.current.clear();
    await clearAllAudioBlobs();
    setTracks((prev) => prev.map((t) => ({ ...t, cachedOnDeviceAt: null })));
    await refreshDeviceCacheStats();
    pushToast({
      title: 'Device audio cache cleared',
      description:
        'Songs stored in Google Drive download again when played. Rescan the folder to play the rest.',
      tone: 'neutral',
    });
  }, [refreshDeviceCacheStats, pushToast]);

  const handleConfirmPendingAction = () => {
    if (!pendingConfirm) return;

    if (pendingConfirm.kind === 'delete-playlist') {
      addLibraryTombstones([
        { kind: 'playlist', id: pendingConfirm.playlistId, deletedAt: Date.now() },
      ]);
      setPlaylists((prev) => prev.filter((p) => p.id !== pendingConfirm.playlistId));
      if (activePlaylistId === pendingConfirm.playlistId) {
        setActivePlaylistId(null);
        setActiveView('dashboard');
      }
    } else if (pendingConfirm.kind === 'delete-smart-playlist') {
      addLibraryTombstones([
        { kind: 'smart-playlist', id: pendingConfirm.smartPlaylistId, deletedAt: Date.now() },
      ]);
      setSmartPlaylists((prev) => prev.filter((sp) => sp.id !== pendingConfirm.smartPlaylistId));
      if (activeSmartPlaylistId === pendingConfirm.smartPlaylistId) {
        setActiveSmartPlaylistId(null);
        setActiveView('dashboard');
      }
      pushToast({
        title: 'Smart playlist deleted',
        description: pendingConfirm.name,
        tone: 'neutral',
        durationMs: 3200,
      });
    } else if (pendingConfirm.kind === 'delete-tracks') {
      const delSet = new Set(pendingConfirm.trackIds);
      const removedTracks = tracks.filter((t) => delSet.has(t.id));
      const removedKeys = removedTracks.map((t) => t.fileKey);
      addLibraryTombstones(removedTracks.map((t) => trackTombstone(t, Date.now())));
      for (const key of removedKeys) {
        fileMapRef.current.delete(key);
      }
      void deleteAudioBlobs(removedKeys);
      setStoredAudioKeys((prev) => {
        const next = new Set(prev);
        for (const key of removedKeys) next.delete(key);
        return next;
      });
      setTracks((prev) => prev.filter((t) => !delSet.has(t.id)));
      setPlaylists((prev) =>
        prev.map((pl) => ({
          ...pl,
          trackIds: pl.trackIds.filter((id) => !delSet.has(id)),
          syncedTrackIds: pl.syncedTrackIds.filter((id) => !delSet.has(id)),
        }))
      );
      if (audioPlayer.state.activeTrackId && delSet.has(audioPlayer.state.activeTrackId)) {
        audioPlayer.stop();
      }
    } else if (pendingConfirm.kind === 'remove-duplicates') {
      const delSet = new Set(pendingConfirm.trackIds);
      const { remapToKeep } = pendingConfirm;
      const removedTracks = tracks.filter((t) => delSet.has(t.id));
      const removedKeys = removedTracks.map((t) => t.fileKey);
      addLibraryTombstones(removedTracks.map((t) => trackTombstone(t, Date.now())));
      for (const key of removedKeys) {
        fileMapRef.current.delete(key);
      }
      void deleteAudioBlobs(removedKeys);
      setStoredAudioKeys((prev) => {
        const next = new Set(prev);
        for (const key of removedKeys) next.delete(key);
        return next;
      });
      setTracks((prev) => prev.filter((t) => !delSet.has(t.id)));
      const remapIds = (ids: string[]) => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const id of ids) {
          const targetId = delSet.has(id) ? remapToKeep[id] : id;
          if (!targetId || delSet.has(targetId) || seen.has(targetId)) continue;
          seen.add(targetId);
          out.push(targetId);
        }
        return out;
      };
      setPlaylists((prev) =>
        prev.map((pl) => ({
          ...pl,
          trackIds: remapIds(pl.trackIds),
          syncedTrackIds: remapIds(pl.syncedTrackIds),
        }))
      );
      if (audioPlayer.state.activeTrackId && delSet.has(audioPlayer.state.activeTrackId)) {
        audioPlayer.stop();
      }
      setScanNotice(
        `Removed ${pendingConfirm.trackIds.length} redundant duplicate file${pendingConfirm.trackIds.length === 1 ? '' : 's'} from your library.`
      );
    } else if (pendingConfirm.kind === 'apply-sync') {
      executeApplySync(pendingConfirm.playlistId);
    } else if (pendingConfirm.kind === 'clear-scan-logs') {
      setScanLogs([]);
      pushToast({
        title: 'Scan history cleared',
        description: 'All recorded file system scan logs have been removed.',
        tone: 'neutral',
      });
    }

    setPendingConfirm(null);
  };

  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) ?? null,
    [playlists, activePlaylistId]
  );

  const youtubePushPlaylist = youtubePush
    ? (playlists.find((p) => p.id === youtubePush.playlistId) ?? null)
    : null;

  const activePlaylistTracks = useMemo(() => {
    if (!activePlaylist) return [];
    return activePlaylist.trackIds
      .map((id) => trackMap.get(id))
      .filter((t): t is LocalTrack => Boolean(t));
  }, [activePlaylist, trackMap]);

  const smartPlaylistTracksMap = useMemo(() => {
    const map = new Map<string, LocalTrack[]>();
    for (const sp of smartPlaylists) {
      map.set(sp.id, evaluateSmartPlaylist(sp, tracks, audioPlayer.playStats));
    }
    return map;
  }, [smartPlaylists, tracks, audioPlayer.playStats]);

  const smartPlaylistCountMap = useMemo(() => {
    const map = new Map<string, number>();
    smartPlaylistTracksMap.forEach((list, id) => {
      map.set(id, list.length);
    });
    return map;
  }, [smartPlaylistTracksMap]);

  const activeSmartPlaylist = useMemo(
    () => smartPlaylists.find((sp) => sp.id === activeSmartPlaylistId) ?? null,
    [smartPlaylists, activeSmartPlaylistId]
  );

  const activeSmartPlaylistTracks = useMemo(() => {
    if (!activeSmartPlaylist) return [];
    return smartPlaylistTracksMap.get(activeSmartPlaylist.id) ?? [];
  }, [activeSmartPlaylist, smartPlaylistTracksMap]);

  const inspectedTrack = useMemo(
    () => (inspectedTrackId ? trackMap.get(inspectedTrackId) ?? null : null),
    [inspectedTrackId, trackMap]
  );

  const batchTagTracks = useMemo(
    () =>
      batchTagModal.trackIds
        .map((id) => trackMap.get(id))
        .filter((t): t is LocalTrack => Boolean(t)),
    [batchTagModal.trackIds, trackMap]
  );

  const hasNextUnmatched = useMemo(
    () =>
      tracks.some(
        (t) => t.id !== inspectedTrackId && !t.youtubeVideoId && t.matchStatus === 'unmatched'
      ),
    [tracks, inspectedTrackId]
  );

  const breadcrumb = useMemo(() => {
    if (activeView === 'dashboard') return { section: 'Dashboard' };
    if (activeView === 'playlist' && activePlaylist) {
      return { section: 'Playlists', sub: activePlaylist.name };
    }
    if (activeView === 'smart-playlist' && activeSmartPlaylist) {
      return { section: 'Smart Playlists', sub: activeSmartPlaylist.name };
    }
    if (activeView === 'sync') return { section: 'Sync Queue' };
    if (activeView === 'scan-logs') return { section: 'Scan Logs' };
    if (activeView === 'transfer') return { section: 'Drive Sync & Transfer' };
    return { section: 'Device Storage' };
  }, [activeView, activePlaylist, activeSmartPlaylist]);

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-[#0B0C0E] text-[#F4F5F7]">
      {/* Hidden Universal File & Folder Inputs */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is supported by Chromium/Safari/Firefox for directory picking
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={handleFolderInputChange}
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.flac,.m4a,.m4b,.wav,.ogg,.opus,.aac,.wma,.aiff,.aif,.alac,.webm"
        className="hidden"
        onChange={handleFilesInputChange}
      />

      {/* Sidebar */}
      <Sidebar
        activeView={activeView}
        activePlaylistId={activePlaylistId}
        activeSmartPlaylistId={activeSmartPlaylistId}
        playlists={playlists}
        smartPlaylists={smartPlaylists}
        smartPlaylistCountMap={smartPlaylistCountMap}
        diffMap={diffMap}
        totalLocalTracks={tracks.length}
        totalPendingSyncs={totalPendingSyncs}
        scanLogsCount={scanLogs.length}
        scanErrorCount={totalScanErrorCount}
        watchedFolder={watchedFolder}
        isScanning={isScanning}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onSelectView={(view) => {
          setActiveView(view);
          if (view === 'scanner') {
            setScannerFilterPreset('all');
            setScannerGenrePreset('all');
            setScannerGroupByGenrePreset(false);
            setScannerSearchPreset('');
            setScannerOpenCleanupPreset(false);
            setScannerOpenDuplicatesPreset(false);
            setScannerOpenIntegrityPreset(false);
          }
          if (view !== 'playlist') setActivePlaylistId(null);
          if (view !== 'smart-playlist') setActiveSmartPlaylistId(null);
        }}
        onSelectPlaylist={(id) => {
          setActivePlaylistId(id);
          setActiveSmartPlaylistId(null);
          setActiveView('playlist');
        }}
        onSelectSmartPlaylist={(id) => {
          setActiveSmartPlaylistId(id);
          setActivePlaylistId(null);
          setActiveView('smart-playlist');
        }}
        onOpenCreatePlaylist={() => setCreateModalState({ open: true, seedTrackIds: [] })}
        onOpenCreateSmartPlaylist={() => setSmartPlaylistModal({ open: true, editing: null })}
        onEditSmartPlaylist={(sp) => setSmartPlaylistModal({ open: true, editing: sp })}
        onRescanWatchedFolder={() => handleRescanWatchedFolder(false)}
      />

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <TopBar
          sectionLabel={breadcrumb.section}
          subLabel={breadcrumb.sub}
          isScanning={isScanning}
          watcherStatus={watcherStatus}
          watchedFolderName={watchedFolder?.name ?? null}
          autoWatchIntervalSec={autoWatchIntervalSec}
          scanProgress={scanProgress}
          recentScanErrorCount={recentScanErrorCount}
          pendingSyncCount={totalPendingSyncs}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenSmartSearch={() => setSmartSearchOpen(true)}
          onOpenScanLogs={() => {
            setActiveView('scan-logs');
            setActivePlaylistId(null);
            setActiveSmartPlaylistId(null);
          }}
          onResumeWatch={() => handleRescanWatchedFolder(false)}
          onPickFolder={handleMountFolder}
          onPickFiles={() => filesInputRef.current?.click()}
          onOpenSyncQueue={() => {
            setActiveView('sync');
            setActivePlaylistId(null);
          }}
        />

        {/* Global Upload & Scan Feedback Bar (visible across Dashboard and all views) */}
        {(scanProgress || scanNotice) && (
          <div className="px-4 sm:px-6 py-2 bg-[#141720] border-b border-white/[0.08] flex items-center justify-between gap-4 text-xs shrink-0">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {scanProgress ? (
                <>
                  <span className="text-white font-medium whitespace-nowrap">
                    Scanning local audio files...
                  </span>
                  <div className="w-32 sm:w-48 h-1.5 rounded-full bg-white/10 overflow-hidden shrink-0">
                    <div
                      className="h-full bg-[#FF1F3D] transition-all duration-150"
                      style={{
                        width: `${Math.round((scanProgress.processed / Math.max(1, scanProgress.total)) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="font-mono tabular-nums text-[#9CA3AF] whitespace-nowrap">
                    {scanProgress.processed} / {scanProgress.total}
                  </span>
                </>
              ) : (
                <span className="text-[#E5E7EB] truncate">{scanNotice}</span>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {!scanProgress && activeView !== 'scanner' && tracks.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setScannerFilterPreset('all');
                    setActivePlaylistId(null);
                    setActiveView('scanner');
                  }}
                  className="text-xs font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors whitespace-nowrap"
                >
                  Open Device Storage
                </button>
              )}
              {!scanProgress && scanNotice && (
                <button
                  type="button"
                  onClick={() => setScanNotice(null)}
                  aria-label="Dismiss notice"
                  className="p-1 rounded text-[#717786] hover:text-white transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {activeView === 'dashboard' && (
          <DashboardView
            tracks={tracks}
            playlists={playlists}
            trackMap={trackMap}
            diffMap={diffMap}
            syncHistory={syncHistory}
            watchedFolder={watchedFolder}
            autoWatchIntervalSec={autoWatchIntervalSec}
            isScanning={isScanning}
            activePlayingTrackId={audioPlayer.state.activeTrackId}
            isAudioPlaying={audioPlayer.state.isPlaying}
            playStats={audioPlayer.playStats}
            playHistory={audioPlayer.playHistory}
            onClearPlayHistory={audioPlayer.clearPlayHistory}
            onMountFolder={handleMountFolder}
            onPickFilesFallback={() => filesInputRef.current?.click()}
            onDropTransfer={handleDropTransfer}
            onRescanFolder={() => handleRescanWatchedFolder(false)}
            onOpenScanner={(preset = 'all', options) => {
              setScannerFilterPreset(preset);
              setScannerGenrePreset(options?.genre ?? 'all');
              setScannerGroupByGenrePreset(Boolean(options?.groupByGenre));
              setScannerSearchPreset(options?.query ?? '');
              setScannerOpenCleanupPreset(Boolean(options?.openCleanup));
              setScannerOpenDuplicatesPreset(Boolean(options?.openDuplicates));
              setScannerOpenIntegrityPreset(Boolean(options?.openIntegrity));
              setActivePlaylistId(null);
              setActiveView('scanner');
            }}
            integrityResults={integrityResults}
            onOpenPlaylist={(id) => {
              setActivePlaylistId(id);
              setActiveView('playlist');
            }}
            onOpenCreatePlaylist={() => setCreateModalState({ open: true, seedTrackIds: [] })}
            onCreatePlaylistFromTracks={(seedTrackIds) =>
              setCreateModalState({ open: true, seedTrackIds })
            }
            onAddTracksToPlaylist={handleAddTracksToPlaylist}
            onOpenSyncQueue={() => {
              setActivePlaylistId(null);
              setActiveView('sync');
            }}
            onOpenTransfer={() => {
              setActivePlaylistId(null);
              setActiveView('transfer');
            }}
            onApplySync={handleRequestApplySync}
            onPlayTrack={audioPlayer.playTrack}
            onPlayList={audioPlayer.playList}
            onInspectTrack={setInspectedTrackId}
            onUpdateAlbumCoverArt={handleUpdateAlbumCoverArt}
            onOpenBatchTagEditor={(trackIds, contextLabel) =>
              setBatchTagModal({ open: true, trackIds, contextLabel })
            }
            onApplyTrackGenres={handleApplyTrackGenres}
          />
        )}

        {activeView === 'scanner' && (
          <ScannerView
            tracks={tracks}
            playlists={playlists}
            playStats={audioPlayer.playStats}
            initialFilter={scannerFilterPreset}
            initialGenre={scannerGenrePreset}
            initialGroupByGenre={scannerGroupByGenrePreset}
            initialSearchQuery={scannerSearchPreset}
            initialOpenCleanup={scannerOpenCleanupPreset}
            initialOpenDuplicates={scannerOpenDuplicatesPreset}
            initialOpenIntegrity={scannerOpenIntegrityPreset}
            watchedFolder={watchedFolder}
            autoWatchIntervalSec={autoWatchIntervalSec}
            isScanning={isScanning}
            scanProgress={scanProgress}
            scanNotice={scanNotice}
            isHashingDuplicates={isHashingDuplicates}
            hashProgress={hashProgress}
            integrityResults={integrityResults}
            isScanningIntegrity={isScanningIntegrity}
            integrityProgress={integrityProgress}
            activePlayingTrackId={audioPlayer.state.activeTrackId}
            isAudioPlaying={audioPlayer.state.isPlaying}
            hasPlayableFile={(fileKey) =>
              fileMapRef.current.has(fileKey) || storedAudioKeys.has(fileKey)
            }
            onMountFolder={handleMountFolder}
            onPickFilesFallback={() => filesInputRef.current?.click()}
            onDropTransfer={handleDropTransfer}
            onRescanFolder={() => handleRescanWatchedFolder(false)}
            onChangeAutoWatch={setAutoWatchIntervalSec}
            onComputeMissingHashes={handleComputeMissingHashes}
            onRunIntegrityScan={handleRunIntegrityScan}
            onRepairTrackMetadata={handleRepairTrackMetadata}
            onRequestRemoveDuplicates={(trackIds, remapToKeep) =>
              setPendingConfirm({ kind: 'remove-duplicates', trackIds, remapToKeep })
            }
            onRemoveMissingTracks={handleRemoveMissingTracks}
            onPlayTrack={audioPlayer.playTrack}
            onPlayList={audioPlayer.playList}
            onInspectTrack={setInspectedTrackId}
            onOpenBatchTagEditor={(trackIds, contextLabel) =>
              setBatchTagModal({ open: true, trackIds, contextLabel })
            }
            onCreatePlaylistFromTracks={(seedTrackIds) =>
              setCreateModalState({ open: true, seedTrackIds })
            }
            onAddTracksToPlaylist={handleAddTracksToPlaylist}
            onRequestDeleteTracks={(trackIds) =>
              setPendingConfirm({ kind: 'delete-tracks', trackIds })
            }
            onGoToImport={() => setActiveView('transfer')}
          />
        )}

        {activeView === 'playlist' && activePlaylist && (
          <PlaylistView
            playlist={activePlaylist}
            tracks={activePlaylistTracks}
            diff={diffMap.get(activePlaylist.id)!}
            playStats={audioPlayer.playStats}
            availableFolders={availableFolders}
            autoWatchIntervalSec={autoWatchIntervalSec}
            onChangeAutoWatch={setAutoWatchIntervalSec}
            activePlayingTrackId={audioPlayer.state.activeTrackId}
            isAudioPlaying={audioPlayer.state.isPlaying}
            shuffleMode={audioPlayer.state.shuffleMode}
            hasPlayableFile={(fileKey) =>
              fileMapRef.current.has(fileKey) || storedAudioKeys.has(fileKey)
            }
            onUpdatePlaylist={handleUpdatePlaylist}
            onUpdateSyncRule={handleUpdateSyncRule}
            onReorderTrack={handleReorderTrack}
            onRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
            onRequestDeletePlaylist={(playlistId) =>
              setPendingConfirm({
                kind: 'delete-playlist',
                playlistId,
                name: activePlaylist.name,
              })
            }
            onApplySync={handleRequestApplySync}
            onPushToYouTube={handleOpenYouTubePush}
            onInspectTrack={setInspectedTrackId}
            onOpenBatchTagEditor={(trackIds, contextLabel) =>
              setBatchTagModal({ open: true, trackIds, contextLabel })
            }
            onPlayTrack={audioPlayer.playTrack}
            onPlayList={audioPlayer.playList}
            onGoToScanner={() => {
              setActiveView('scanner');
              setActivePlaylistId(null);
            }}
          />
        )}

        {activeView === 'smart-playlist' && activeSmartPlaylist && (
          <SmartPlaylistView
            smartPlaylist={activeSmartPlaylist}
            tracks={activeSmartPlaylistTracks}
            playStats={audioPlayer.playStats}
            activePlayingTrackId={audioPlayer.state.activeTrackId}
            isAudioPlaying={audioPlayer.state.isPlaying}
            shuffleMode={audioPlayer.state.shuffleMode}
            hasPlayableFile={(fileKey) =>
              fileMapRef.current.has(fileKey) || storedAudioKeys.has(fileKey)
            }
            onEditRules={(sp) => setSmartPlaylistModal({ open: true, editing: sp })}
            onDuplicate={handleDuplicateSmartPlaylist}
            onConvertToStaticPlaylist={handleConvertSmartToStaticPlaylist}
            onRequestDelete={(sp) =>
              setPendingConfirm({
                kind: 'delete-smart-playlist',
                smartPlaylistId: sp.id,
                name: sp.name,
              })
            }
            onPlayTrack={audioPlayer.playTrack}
            onPlayList={audioPlayer.playList}
            onInspectTrack={setInspectedTrackId}
            onOpenBatchTagEditor={(trackIds, contextLabel) =>
              setBatchTagModal({ open: true, trackIds, contextLabel })
            }
          />
        )}

        {activeView === 'sync' && (
          <SyncQueueView
            playlists={playlists}
            trackMap={trackMap}
            diffMap={diffMap}
            syncHistory={syncHistory}
            isScanning={isScanning}
            hasLiveFolderHandle={hasLiveHandle}
            onRescanFolder={() => handleRescanWatchedFolder(false)}
            onRequestApplySync={handleRequestApplySync}
            onOpenPlaylist={(id) => {
              setActivePlaylistId(id);
              setActiveView('playlist');
            }}
            onOpenCreatePlaylist={() => setCreateModalState({ open: true, seedTrackIds: [] })}
          />
        )}

        {activeView === 'scan-logs' && (
          <ScanLogView
            scanLogs={scanLogs}
            watcherStatus={watcherStatus}
            watchedFolder={watchedFolder}
            autoWatchIntervalSec={autoWatchIntervalSec}
            isScanning={isScanning}
            scanProgress={scanProgress}
            onChangeAutoWatch={setAutoWatchIntervalSec}
            onRescanFolder={() => handleRescanWatchedFolder(false)}
            onMountFolder={handleMountFolder}
            onRequestClearLogs={() => setPendingConfirm({ kind: 'clear-scan-logs' })}
          />
        )}

        {activeView === 'transfer' && (
          <TransferView
            tracks={tracks}
            playlists={playlists}
            smartPlaylists={smartPlaylists}
            syncHistory={syncHistory}
            watchedFolderName={watchedFolderName}
            availableLocalFolders={availableFolders}
            currentDevice={currentDevice}
            devices={devices}
            folderMappings={folderMappings}
            trackMap={trackMap}
            storedAudioKeys={storedAudioKeys}
            deviceCacheBytes={deviceCacheBytes}
            hasPlayableFile={(fileKey) =>
              fileMapRef.current.has(fileKey) || storedAudioKeys.has(fileKey)
            }
            getCachedAudioBlob={async (fileKey) =>
              fileMapRef.current.get(fileKey) ?? (await loadAudioBlob(fileKey))
            }
            onRenameCurrentDevice={handleRenameCurrentDevice}
            onSaveFolderMapping={handleSaveFolderMapping}
            onUnbindDeviceFromMapping={handleUnbindDeviceFromMapping}
            onDeleteFolderMapping={handleDeleteFolderMapping}
            onMarkMappingSynced={handleMarkMappingSynced}
            onPrepareManifestForPush={handlePrepareManifestForPush}
            onImportPlaylist={handleImportPlaylist}
            onRestoreLibraryBackup={handleRestoreLibraryBackup}
            onSyncFromDriveSourceOfTruth={handleSyncFromDriveSourceOfTruth}
            onLinkUploadedDriveTracks={handleLinkUploadedDriveTracks}
            onCacheDriveTrackAudio={handleCacheDriveTrackAudio}
            onEvictTrackCache={handleEvictTrackCache}
            onClearAllDeviceCache={handleClearAllDeviceCache}
            onPlayTrack={audioPlayer.playTrack}
            onIngestLocalFolderEntries={(entries, folderRootName) =>
              ingestAudioEntries(entries, {
                folderRootName,
                isFullFolderScan: false,
                source: 'drive-mapping',
              })
            }
            onNotify={(payload) =>
              pushToast({
                title: payload.title,
                description: payload.description,
                tone: payload.tone ?? 'neutral',
              })
            }
          />
        )}

        {/* Persistent Studio Audio Transport Bar (visible whenever library has tracks) */}
        {(tracks.length > 0 || audioPlayer.activeTrack) && (
          <MiniPlayer
            track={audioPlayer.activeTrack}
            queueTracks={(audioPlayer.state.queueIds.length > 0
              ? audioPlayer.state.queueIds
              : tracks.map((t) => t.id)
            )
              .map((id) => trackMap.get(id))
              .filter((t): t is LocalTrack => Boolean(t))}
            totalLibraryCount={tracks.length}
            state={audioPlayer.state}
            activeTrackReplayGain={audioPlayer.activeTrackReplayGain}
            analyzedTrackCount={audioPlayer.analyzedTrackCount}
            loudnessScanProgress={audioPlayer.loudnessScanProgress}
            onTogglePlay={audioPlayer.togglePlay}
            onSelectTrack={(trackId) =>
              audioPlayer.playTrack(
                trackId,
                audioPlayer.state.queueIds.length > 0
                  ? audioPlayer.state.queueIds
                  : tracks.map((t) => t.id)
              )
            }
            onSeek={audioPlayer.seek}
            onVolumeChange={audioPlayer.setVolume}
            onToggleMute={audioPlayer.toggleMute}
            onToggleShuffle={audioPlayer.toggleShuffle}
            onCycleRepeat={audioPlayer.cycleRepeatMode}
            onSetCrossfadeSeconds={audioPlayer.setCrossfadeSeconds}
            onSetCrossfadeCurve={audioPlayer.setCrossfadeCurve}
            onSetManualSkipCrossfade={audioPlayer.setManualSkipCrossfade}
            onSetGaplessPlayback={audioPlayer.setGaplessPlayback}
            onSetGaplessAlbumContinuity={audioPlayer.setGaplessAlbumContinuity}
            onResetTransitionSettings={audioPlayer.resetTransitionSettings}
            onSetReplayGainMode={audioPlayer.setReplayGainMode}
            onSetReplayGainTargetLufs={audioPlayer.setReplayGainTargetLufs}
            onSetReplayGainPreampDb={audioPlayer.setReplayGainPreampDb}
            onSetReplayGainPreventClipping={audioPlayer.setReplayGainPreventClipping}
            onAnalyzeLibraryLoudness={audioPlayer.analyzeLibraryLoudness}
            onCancelLibraryLoudnessScan={audioPlayer.cancelLibraryLoudnessScan}
            onClearLoudnessCache={audioPlayer.clearLoudnessCache}
            onPrev={audioPlayer.prevTrack}
            onNext={audioPlayer.nextTrack}
            onRelinkFiles={() => filesInputRef.current?.click()}
            onInspectTrack={setInspectedTrackId}
          />
        )}
      </div>

      {/* Track Metadata & YouTube Music Match Drawer */}
      <TrackMatchDrawer
        track={inspectedTrack}
        hasNextUnmatched={hasNextUnmatched}
        onClose={() => setInspectedTrackId(null)}
        onSave={handleSaveTrackInspection}
      />

      {/* Global Smart Search Command Palette (Cmd+K / Ctrl+K) */}
      <SmartSearchModal
        open={smartSearchOpen}
        tracks={tracks}
        playlists={playlists}
        playStats={audioPlayer.playStats}
        activePlayingTrackId={audioPlayer.state.activeTrackId}
        isAudioPlaying={audioPlayer.state.isPlaying}
        onClose={() => setSmartSearchOpen(false)}
        onPlayTrack={audioPlayer.playTrack}
        onPlayList={audioPlayer.playList}
        onInspectTrack={setInspectedTrackId}
        onOpenPlaylist={(playlistId) => {
          setActivePlaylistId(playlistId);
          setActiveView('playlist');
        }}
        onOpenScannerWithQuery={(opts) => {
          setScannerFilterPreset(opts.openCleanup ? 'missing' : 'all');
          setScannerGenrePreset(opts.genre ?? 'all');
          setScannerGroupByGenrePreset(Boolean(opts.groupByGenre));
          setScannerSearchPreset(opts.query ?? '');
          setScannerOpenCleanupPreset(Boolean(opts.openCleanup));
          setActivePlaylistId(null);
          setActiveView('scanner');
        }}
      />

      {/* Batch Tag Editor Modal */}
      <BatchTagEditorModal
        isOpen={batchTagModal.open}
        tracks={batchTagTracks}
        contextLabel={batchTagModal.contextLabel}
        onClose={() => setBatchTagModal({ open: false, trackIds: [], contextLabel: '' })}
        onApply={handleApplyBatchTagEdits}
      />

      {/* Create / Edit Smart Playlist Modal */}
      <SmartPlaylistModal
        isOpen={smartPlaylistModal.open}
        editingPlaylist={smartPlaylistModal.editing}
        tracks={tracks}
        playStats={audioPlayer.playStats}
        availableFolders={availableFolders}
        onClose={() => setSmartPlaylistModal({ open: false, editing: null })}
        onSave={handleSaveSmartPlaylist}
      />

      {/* Create Playlist Modal */}
      <CreatePlaylistModal
        isOpen={createModalState.open}
        defaultFolderName={watchedFolderName}
        availableFolders={availableFolders}
        initialTrackCount={createModalState.seedTrackIds.length}
        onClose={() => setCreateModalState({ open: false, seedTrackIds: [] })}
        onCreate={handleCreatePlaylist}
      />

      {/* Confirmation Modal for Destructive Operations */}
      {youtubePush && youtubePushPlaylist && (
        <YouTubePushDialog
          playlistName={youtubePushPlaylist.name}
          estimate={estimateYouTubePush(
            youtubePushPlaylist,
            youtubePushPlaylist.trackIds
              .map((id) => trackMap.get(id))
              .filter((t): t is LocalTrack => Boolean(t))
          )}
          state={youtubePush.state}
          isConnected={getYouTubeAccessToken() !== null}
          onStart={handleStartYouTubePush}
          onStop={() => youtubePushAbortRef.current?.abort()}
          onClose={() => setYouTubePush(null)}
        />
      )}

      <ConfirmModal
        isOpen={Boolean(pendingConfirm)}
        title={
          pendingConfirm?.kind === 'delete-playlist'
            ? `Delete "${pendingConfirm.name}"?`
            : pendingConfirm?.kind === 'delete-smart-playlist'
              ? `Delete smart playlist "${pendingConfirm.name}"?`
              : pendingConfirm?.kind === 'delete-tracks'
                ? `Remove ${pendingConfirm.trackIds.length} track${pendingConfirm.trackIds.length === 1 ? '' : 's'}?`
                : pendingConfirm?.kind === 'remove-duplicates'
                  ? `Remove ${pendingConfirm.trackIds.length} redundant duplicate${pendingConfirm.trackIds.length === 1 ? '' : 's'}?`
                  : pendingConfirm?.kind === 'apply-sync'
                    ? `Apply sync changes to "${pendingConfirm.name}"?`
                    : pendingConfirm?.kind === 'clear-scan-logs'
                      ? 'Clear all scan logs?'
                      : ''
        }
        message={
          pendingConfirm?.kind === 'delete-playlist'
            ? 'This removes the playlist and its sync rules from CrateSync. Your original audio files on device storage are never modified.'
            : pendingConfirm?.kind === 'delete-smart-playlist'
              ? 'This removes the smart playlist and its saved filter rules from CrateSync. Your tracks and original audio files remain untouched.'
              : pendingConfirm?.kind === 'delete-tracks'
                ? 'This removes the selected entries from your CrateSync catalog and playlists. Your original audio files on device storage will not be deleted.'
                : pendingConfirm?.kind === 'remove-duplicates'
                  ? 'This removes the redundant duplicate copies from your CrateSync library and automatically remaps any affected playlists to keep the primary copy. Original files on your device are not deleted.'
                  : pendingConfirm?.kind === 'apply-sync'
                    ? `This will add ${pendingConfirm.addCount} track(s) and remove ${pendingConfirm.removeCount} track(s) from the synced playlist snapshot.`
                    : pendingConfirm?.kind === 'clear-scan-logs'
                      ? 'This clears the recorded history of local file system scans and error diagnostics from CrateSync. Your audio library and playlists are not affected.'
                      : ''
        }
        confirmLabel={
          pendingConfirm?.kind === 'apply-sync'
            ? 'Apply Sync'
            : pendingConfirm?.kind === 'remove-duplicates'
              ? 'Remove Duplicates'
              : pendingConfirm?.kind === 'clear-scan-logs'
                ? 'Clear Logs'
                : 'Confirm Removal'
        }
        destructive={pendingConfirm?.kind !== 'apply-sync'}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={handleConfirmPendingAction}
      />

      {/* Non-intrusive background scan toast notifications */}
      <ToastContainer
        toasts={toasts}
        onDismiss={dismissToast}
        hasMiniPlayer={tracks.length > 0 || Boolean(audioPlayer.activeTrack)}
      />
    </div>
  );
}
