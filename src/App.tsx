import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { BatchTagEditorModal, type BatchTrackPatch } from './components/BatchTagEditorModal';
import { DashboardView } from './components/DashboardView';
import { MiniPlayer } from './components/MiniPlayer';
import { ConfirmModal, CreatePlaylistModal } from './components/Modals';
import { PlaylistView } from './components/PlaylistView';
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
import { TopBar } from './components/TopBar';
import { TrackMatchDrawer } from './components/TrackMatchDrawer';
import { TransferView } from './components/TransferView';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useToasts, type ToastStat } from './hooks/useToasts';
import type {
  LocalTrack,
  Playlist,
  PlaylistDiff,
  SmartPlaylist,
  SyncEvent,
  SyncRule,
  WatchedFolderInfo,
  WorkspaceView,
} from './types/music';
import { evaluateSmartPlaylist } from './utils/smartPlaylists';
import { computeAudioHash, extractLocalTrack, isAudioFile } from './utils/audioMetadata';
import {
  deleteAudioBlobs,
  listStoredAudioKeys,
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
  supportsDirectoryPicker,
  walkDirectoryHandle,
  type ScannedFileEntry,
} from './utils/syncEngine';
import type { ImportedTrackSeed } from './utils/youtubeLinks';

type PendingConfirm =
  | { kind: 'delete-playlist'; playlistId: string; name: string }
  | { kind: 'delete-smart-playlist'; smartPlaylistId: string; name: string }
  | { kind: 'delete-tracks'; trackIds: string[] }
  | { kind: 'remove-duplicates'; trackIds: string[]; remapToKeep: Record<string, string> }
  | { kind: 'apply-sync'; playlistId: string; name: string; addCount: number; removeCount: number };

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [smartPlaylists, setSmartPlaylists] = useState<SmartPlaylist[]>([]);
  const [syncHistory, setSyncHistory] = useState<SyncEvent[]>([]);
  const [watchedFolderName, setWatchedFolderName] = useState<string | null>(null);
  const [lastScannedAt, setLastScannedAt] = useState<number | null>(null);
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
  const [smartSearchOpen, setSmartSearchOpen] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [autoWatchIntervalSec, setAutoWatchIntervalSec] = useState<0 | 30 | 120 | 300>(120);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ processed: number; total: number } | null>(
    null
  );
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [isHashingDuplicates, setIsHashingDuplicates] = useState(false);
  const [hashProgress, setHashProgress] = useState<{ processed: number; total: number } | null>(
    null
  );

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

  // Live in-memory references (audio Blobs for playback + FileSystemDirectoryHandle for auto-watch)
  const fileMapRef = useRef<Map<string, Blob>>(new Map());
  const [storedAudioKeys, setStoredAudioKeys] = useState<Set<string>>(new Set());
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

  const audioPlayer = useAudioPlayer(tracks, fileMapRef, {
    onPlayRecorded: handlePlayRecorded,
  });

  // Hydrate library state, stored audio keys & directory handle from IndexedDB
  useEffect(() => {
    let active = true;
    (async () => {
      const [savedState, savedHandle, blobKeys] = await Promise.all([
        loadLibraryState(),
        loadDirectoryHandle(),
        listStoredAudioKeys(),
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
      setWatchedFolderName(savedState.watchedFolderName);
      setLastScannedAt(savedState.lastScannedAt);
      setStoredAudioKeys(blobKeys);
      if (savedHandle) {
        dirHandleRef.current = savedHandle;
        setHasLiveHandle(true);
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
      watchedFolderName,
      lastScannedAt,
    });
  }, [hydrated, tracks, playlists, smartPlaylists, syncHistory, watchedFolderName, lastScannedAt]);

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
    if (!watchedFolderName && tracks.length === 0) return null;
    return {
      name: watchedFolderName || 'Device Audio',
      lastScannedAt,
      trackCount: tracks.filter((t) => !t.isMissingOnDevice).length,
      hasLiveHandle,
    };
  }, [watchedFolderName, lastScannedAt, tracks, hasLiveHandle]);

  /**
   * Core ingestion pipeline for scanned local audio entries.
   * Preserves existing YouTube matches and edited metadata for known files,
   * and detects missing files when doing a full directory scan.
   */
  const ingestAudioEntries = useCallback(
    async (
      entries: ScannedFileEntry[],
      options: { folderRootName?: string; isFullFolderScan: boolean; quiet?: boolean }
    ) => {
      const audioEntries = entries.filter((e) => isAudioFile(e.file));
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
            tone: newlyMissingCount > 0 ? 'warning' : 'neutral',
            durationMs: newlyMissingCount > 0 ? 6000 : 4000,
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
        tracksRef.current.forEach((t) => {
          existingByKey.set(t.fileKey, t);
          existingByNameSize.set(`${t.fileName.toLowerCase()}::${t.fileSize}`, t);
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
            (canRelinkByNameSize ? nameSizeCandidate : undefined);
          const targetKey = existing ? existing.fileKey : computedFileKey;

          seenKeys.add(targetKey);
          fileMapRef.current.set(targetKey, file);
          newlyCachedKeys.push(targetKey);
          // Persist audio blob in IndexedDB so playback survives reloads
          void saveAudioBlob(targetKey, file);

          if (existing) {
            const contentHash = existing.contentHash ?? (await computeAudioHash(file));
            updatedExistingIds.set(existing.id, {
              ...existing,
              contentHash,
              lastSeenAt: now,
              isMissingOnDevice: false,
            });
          } else {
            try {
              const parsed = await extractLocalTrack(file, relativePath);
              newlyParsed.push(parsed);
            } catch {
              const ext = file.name.split('.').pop()?.toUpperCase() || 'AUDIO';
              const fallbackHash = await computeAudioHash(file);
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
          setStoredAudioKeys((prev) => {
            const next = new Set(prev);
            for (const k of newlyCachedKeys) next.add(k);
            return next;
          });
        }

        if (options.folderRootName) {
          setWatchedFolderName(options.folderRootName);
        }
        setLastScannedAt(now);

        const addedCount = newlyParsed.length;

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
                label: newlyMissingCount === 1 ? 'missing' : 'missing',
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
            title: 'Background scan complete',
            description: `${folderLabel}${audioEntries.length} file${audioEntries.length === 1 ? '' : 's'} checked`,
            stats,
            tone:
              newlyMissingCount > 0
                ? 'warning'
                : addedCount > 0 || restoredCount > 0
                  ? 'success'
                  : 'neutral',
            durationMs: hasDelta ? 6000 : 4000,
            action:
              newlyMissingCount > 0
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
    [pushToast]
  );

  // Re-scan active mounted FileSystemDirectoryHandle
  const handleRescanWatchedFolder = useCallback(
    async (quiet = false) => {
      const handle = dirHandleRef.current;
      if (!handle) {
        folderInputRef.current?.click();
        return;
      }

      try {
        // Request read permission if handle was restored from IndexedDB
        const handleWithPerm = handle as FileSystemDirectoryHandle & {
          queryPermission?: (desc: { mode: 'read' }) => Promise<string>;
          requestPermission?: (desc: { mode: 'read' }) => Promise<string>;
        };
        if (handleWithPerm.queryPermission) {
          const perm = await handleWithPerm.queryPermission({ mode: 'read' });
          if (perm !== 'granted') {
            if (quiet) return; // Don't prompt on background timer
            const granted = await handleWithPerm.requestPermission?.({ mode: 'read' });
            if (granted !== 'granted') {
              setScanNotice('Folder read permission was not granted.');
              return;
            }
          }
        }

        const entries = await walkDirectoryHandle(handle);
        await ingestAudioEntries(entries, {
          folderRootName: handle.name,
          isFullFolderScan: true,
          quiet,
        });
      } catch {
        if (!quiet) {
          setScanNotice('Could not re-scan the mounted folder. Select the folder again to refresh.');
        }
      }
    },
    [ingestAudioEntries]
  );

  // Auto-watch interval effect when a live directory handle is active
  useEffect(() => {
    if (!hasLiveHandle || autoWatchIntervalSec === 0) return;

    const timer = window.setInterval(() => {
      if (!isScanning && document.visibilityState === 'visible') {
        handleRescanWatchedFolder(true);
      }
    }, autoWatchIntervalSec * 1000);

    return () => window.clearInterval(timer);
  }, [hasLiveHandle, autoWatchIntervalSec, isScanning, handleRescanWatchedFolder]);

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
        dirHandleRef.current = handle;
        setHasLiveHandle(true);
        await saveDirectoryHandle(handle);
        const entries = await walkDirectoryHandle(handle);
        await ingestAudioEntries(entries, {
          folderRootName: handle.name,
          isFullFolderScan: true,
        });
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
    });
  };

  const handleFilesInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    await ingestAudioEntries(
      files.map((file) => ({ file, relativePath: file.name })),
      { isFullFolderScan: false }
    );
  };

  const handleDropTransfer = async (dataTransfer: DataTransfer) => {
    const { entries, folderRootName } = await extractDroppedEntries(dataTransfer);
    if (entries.length === 0) return;
    await ingestAudioEntries(entries, {
      folderRootName,
      isFullFolderScan: Boolean(folderRootName),
    });
  };

  // Compute missing SHA-256 content hashes for previously scanned tracks cached in memory/IndexedDB
  const handleComputeMissingHashes = useCallback(async () => {
    if (isHashingDuplicates) return;
    const targets = tracksRef.current.filter((t) => t.fileSize > 0 && !t.contentHash);
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
    if (initialTrackIds.length === 0 && tracks.length > 0) {
      const filter = payload.syncRule.folderFilter.toLowerCase();
      initialTrackIds = tracks
        .filter((t) => {
          if (t.isMissingOnDevice) return false;
          if (!filter) return true;
          return (
            t.folderName.toLowerCase() === filter ||
            t.relativePath.toLowerCase().startsWith(filter)
          );
        })
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
        autoScanIntervalSec: autoWatchIntervalSec,
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
    setAutoWatchIntervalSec(syncRule.autoScanIntervalSec);
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

  /**
   * Single-click Library Cleanup removal of missing on-device tracks from the database,
   * pruning orphaned IndexedDB blobs and playlist references cleanly.
   */
  const handleRemoveMissingTracks = (trackIds: string[]) => {
    if (trackIds.length === 0) return;
    const delSet = new Set(trackIds);
    const removedKeys = tracks
      .filter((t) => delSet.has(t.id))
      .map((t) => t.fileKey);

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
        updatedAt: Date.now(),
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
    const now = Date.now();
    const existingByTitleArtist = new Map<string, LocalTrack>();
    for (const t of tracks) {
      existingByTitleArtist.set(`${t.artist.toLowerCase()}::${t.title.toLowerCase()}`, t);
    }

    const newTracks: LocalTrack[] = [];
    const playlistTrackIds: string[] = [];

    for (const seed of seeds) {
      const matchKey = `${seed.artist.toLowerCase()}::${seed.title.toLowerCase()}`;
      const existing = existingByTitleArtist.get(matchKey);

      if (existing) {
        playlistTrackIds.push(existing.id);
        // Enrich existing local track if the imported playlist carried a YouTube video ID
        if (!existing.youtubeVideoId && seed.youtubeVideoId) {
          setTracks((prev) =>
            prev.map((t) =>
              t.id === existing.id
                ? { ...t, youtubeVideoId: seed.youtubeVideoId, matchStatus: 'matched' }
                : t
            )
          );
        }
      } else {
        const created: LocalTrack = {
          id: crypto.randomUUID(),
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
        playlistTrackIds.push(created.id);
      }
    }

    if (newTracks.length > 0) {
      setTracks((prev) => [...newTracks, ...prev]);
    }

    const newPlaylist: Playlist = {
      id: crypto.randomUUID(),
      name,
      description: `Imported ${seeds.length} tracks`,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: now,
      trackIds: playlistTrackIds,
      syncedTrackIds: playlistTrackIds,
      youtubePlaylistUrl: '',
      watchedFolderName: null,
      syncRule: {
        autoAddNewFiles: false,
        removeMissingFiles: false,
        autoScanIntervalSec: 0,
        folderFilter: '',
      },
    };

    setPlaylists((prev) => [newPlaylist, ...prev]);
    setActivePlaylistId(newPlaylist.id);
    setActiveView('playlist');
  };

  const handleConfirmPendingAction = () => {
    if (!pendingConfirm) return;

    if (pendingConfirm.kind === 'delete-playlist') {
      setPlaylists((prev) => prev.filter((p) => p.id !== pendingConfirm.playlistId));
      if (activePlaylistId === pendingConfirm.playlistId) {
        setActivePlaylistId(null);
        setActiveView('dashboard');
      }
    } else if (pendingConfirm.kind === 'delete-smart-playlist') {
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
      const removedKeys = tracks
        .filter((t) => delSet.has(t.id))
        .map((t) => t.fileKey);
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
      const removedKeys = tracks
        .filter((t) => delSet.has(t.id))
        .map((t) => t.fileKey);
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
          updatedAt: Date.now(),
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
    }

    setPendingConfirm(null);
  };

  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) ?? null,
    [playlists, activePlaylistId]
  );

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
    if (activeView === 'transfer') return { section: 'Import & Export' };
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
          pendingSyncCount={totalPendingSyncs}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenSmartSearch={() => setSmartSearchOpen(true)}
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
              setActivePlaylistId(null);
              setActiveView('scanner');
            }}
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
            watchedFolder={watchedFolder}
            autoWatchIntervalSec={autoWatchIntervalSec}
            isScanning={isScanning}
            scanProgress={scanProgress}
            scanNotice={scanNotice}
            isHashingDuplicates={isHashingDuplicates}
            hashProgress={hashProgress}
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

        {activeView === 'transfer' && (
          <TransferView
            playlists={playlists}
            trackMap={trackMap}
            onImportPlaylist={handleImportPlaylist}
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
            onCycleCrossfade={audioPlayer.cycleCrossfade}
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
                    : ''
        }
        confirmLabel={
          pendingConfirm?.kind === 'apply-sync'
            ? 'Apply Sync'
            : pendingConfirm?.kind === 'remove-duplicates'
              ? 'Remove Duplicates'
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
