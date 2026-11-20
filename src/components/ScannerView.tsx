import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  Disc3,
  Download,
  ExternalLink,
  FileAudio,
  Fingerprint,
  FolderOpen,
  Layers,
  Link2,
  List,
  ListPlus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tags,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { LocalTrack, Playlist, TrackPlayStats, WatchedFolderInfo } from '../types/music';
import {
  exportCatalogToCSV,
  exportCatalogToJSON,
  exportCatalogToM3U8,
  findDuplicateGroups,
} from '../utils/duplicateDetector';
import {
  computeTrackStatistics,
  inferTrackGenre,
  type InferredGenreResult,
} from '../utils/genreInference';
import { evaluateSmartTrackSearch } from '../utils/smartSearch';
import {
  buildTrackYouTubeMusicUrl,
  formatDuration,
  formatFileSize,
  formatRelativeTime,
  formatTotalRuntime,
  triggerFileDownload,
} from '../utils/youtubeLinks';
import { DuplicateFinderPanel } from './DuplicateFinderPanel';
import { LibraryCleanupPanel } from './LibraryCleanupPanel';
import { TrackStatisticsPanel } from './TrackStatisticsPanel';

const STUDIO_BANNER_SRC = '/src/assets/images/studio_audio_banner_1795114389740.jpg';

type TrackFilter = 'all' | 'unmatched' | 'matched' | 'missing';
type TrackSort = 'default' | 'most-played' | 'recently-played' | 'title';

interface ScannerViewProps {
  tracks: LocalTrack[];
  playlists: Playlist[];
  playStats: Record<string, TrackPlayStats>;
  initialFilter?: TrackFilter;
  initialGenre?: string;
  initialGroupByGenre?: boolean;
  initialSearchQuery?: string;
  initialOpenCleanup?: boolean;
  watchedFolder: WatchedFolderInfo | null;
  autoWatchIntervalSec: 0 | 30 | 120 | 300;
  isScanning: boolean;
  scanProgress: { processed: number; total: number } | null;
  scanNotice: string | null;
  isHashingDuplicates: boolean;
  hashProgress: { processed: number; total: number } | null;
  activePlayingTrackId: string | null;
  isAudioPlaying: boolean;
  hasPlayableFile: (fileKey: string) => boolean;
  onMountFolder: () => void;
  onPickFilesFallback: () => void;
  onDropTransfer: (dataTransfer: DataTransfer) => void;
  onRescanFolder: () => void;
  onChangeAutoWatch: (sec: 0 | 30 | 120 | 300) => void;
  onComputeMissingHashes: () => void;
  onRequestRemoveDuplicates: (removeIds: string[], remapToKeep: Record<string, string>) => void;
  onRemoveMissingTracks: (trackIds: string[]) => void;
  onPlayTrack: (trackId: string, queueIds: string[]) => void;
  onPlayList: (trackIds: string[], options?: { shuffle?: boolean }) => void;
  onInspectTrack: (trackId: string) => void;
  onOpenBatchTagEditor: (trackIds: string[], contextLabel: string) => void;
  onCreatePlaylistFromTracks: (trackIds: string[]) => void;
  onAddTracksToPlaylist: (playlistId: string, trackIds: string[]) => void;
  onRequestDeleteTracks: (trackIds: string[]) => void;
  onGoToImport: () => void;
}

export function ScannerView({
  tracks,
  playlists,
  playStats,
  initialFilter = 'all',
  initialGenre = 'all',
  initialGroupByGenre = false,
  initialSearchQuery = '',
  initialOpenCleanup = false,
  watchedFolder,
  autoWatchIntervalSec,
  isScanning,
  scanProgress,
  scanNotice,
  isHashingDuplicates,
  hashProgress,
  activePlayingTrackId,
  isAudioPlaying,
  hasPlayableFile,
  onMountFolder,
  onPickFilesFallback,
  onDropTransfer,
  onRescanFolder,
  onChangeAutoWatch,
  onComputeMissingHashes,
  onRequestRemoveDuplicates,
  onRemoveMissingTracks,
  onPlayTrack,
  onPlayList,
  onInspectTrack,
  onOpenBatchTagEditor,
  onCreatePlaylistFromTracks,
  onAddTracksToPlaylist,
  onRequestDeleteTracks,
  onGoToImport,
}: ScannerViewProps) {
  const [search, setSearch] = useState(initialSearchQuery);
  const [filter, setFilter] = useState<TrackFilter>(initialFilter);
  const [genreFilter, setGenreFilter] = useState<string>(initialGenre);
  const [sortBy, setSortBy] = useState<TrackSort>('default');
  const [groupByGenre, setGroupByGenre] = useState<boolean>(initialGroupByGenre);
  const [collapsedGenres, setCollapsedGenres] = useState<Set<string>>(new Set());
  const [showTrackStats, setShowTrackStats] = useState<boolean>(false);
  const [showLibraryCleanup, setShowLibraryCleanup] = useState<boolean>(initialOpenCleanup);

  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  useEffect(() => {
    setGenreFilter(initialGenre);
  }, [initialGenre]);

  useEffect(() => {
    setGroupByGenre(initialGroupByGenre);
  }, [initialGroupByGenre]);

  useEffect(() => {
    setSearch(initialSearchQuery);
  }, [initialSearchQuery]);

  useEffect(() => {
    if (initialOpenCleanup) {
      setShowLibraryCleanup(true);
    }
  }, [initialOpenCleanup]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [bannerFailed, setBannerFailed] = useState(false);
  const [targetPlaylistId, setTargetPlaylistId] = useState('');
  const [showDuplicateFinder, setShowDuplicateFinder] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [exportMenuOpen]);

  const duplicateGroups = useMemo(() => findDuplicateGroups(tracks), [tracks]);
  const redundantCount = useMemo(
    () => duplicateGroups.reduce((acc, g) => acc + (g.tracks.length - 1), 0),
    [duplicateGroups]
  );
  const duplicateTrackIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of duplicateGroups) {
      for (const t of g.tracks) ids.add(t.id);
    }
    return ids;
  }, [duplicateGroups]);
  const unhashedCount = useMemo(
    () => tracks.filter((t) => t.fileSize > 0 && !t.contentHash).length,
    [tracks]
  );

  const trackGenreMap = useMemo(() => {
    const map = new Map<string, InferredGenreResult>();
    for (const t of tracks) {
      map.set(t.id, inferTrackGenre(t));
    }
    return map;
  }, [tracks]);

  const allStats = useMemo(() => computeTrackStatistics(tracks), [tracks]);

  const effectiveGenreFilter = useMemo(() => {
    if (genreFilter === 'all') return 'all';
    const exists = allStats.genreGroups.some((g) => g.genre === genreFilter);
    return exists ? genreFilter : 'all';
  }, [genreFilter, allStats.genreGroups]);

  const trackGenreNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, res] of trackGenreMap.entries()) {
      map.set(id, res.genre);
    }
    return map;
  }, [trackGenreMap]);

  const smartSearchEval = useMemo(
    () => evaluateSmartTrackSearch(tracks, search, playStats, trackGenreNameMap),
    [tracks, search, playStats, trackGenreNameMap]
  );

  const filteredTracks = useMemo(() => {
    const baseTracks = search.trim()
      ? smartSearchEval.results.map((r) => r.track)
      : tracks;

    const matched = baseTracks.filter((t) => {
      if (filter === 'matched' && !t.youtubeVideoId) return false;
      if (filter === 'unmatched' && (Boolean(t.youtubeVideoId) || t.matchStatus === 'skipped')) {
        return false;
      }
      if (filter === 'missing' && !t.isMissingOnDevice) return false;
      const inferred = trackGenreMap.get(t.id)?.genre ?? 'Unclassified';
      if (effectiveGenreFilter !== 'all' && inferred !== effectiveGenreFilter) {
        return false;
      }
      return true;
    });

    if (sortBy === 'default') return matched;

    return [...matched].sort((a, b) => {
      const aPlays = playStats[a.id]?.playCount ?? a.playCount ?? 0;
      const bPlays = playStats[b.id]?.playCount ?? b.playCount ?? 0;
      const aLast = playStats[a.id]?.lastPlayedAt ?? a.lastPlayedAt ?? 0;
      const bLast = playStats[b.id]?.lastPlayedAt ?? b.lastPlayedAt ?? 0;

      if (sortBy === 'most-played') {
        return bPlays - aPlays || bLast - aLast || a.title.localeCompare(b.title);
      }
      if (sortBy === 'recently-played') {
        return bLast - aLast || bPlays - aPlays || a.title.localeCompare(b.title);
      }
      return a.title.localeCompare(b.title);
    });
  }, [
    tracks,
    search,
    smartSearchEval,
    filter,
    effectiveGenreFilter,
    trackGenreMap,
    sortBy,
    playStats,
  ]);

  const filteredStats = useMemo(
    () =>
      filteredTracks.length === tracks.length
        ? allStats
        : computeTrackStatistics(filteredTracks),
    [filteredTracks, tracks.length, allStats]
  );

  const stats = useMemo(
    () => ({
      total: filteredStats.totalTracks,
      matched: filteredStats.matchedTracks,
      unmatched: filteredStats.unmatchedTracks,
      missing: allStats.missingTracks,
      totalDuration: filteredStats.totalDuration,
    }),
    [filteredStats, allStats.missingTracks]
  );

  const toggleGenreCollapsed = (genre: string) => {
    setCollapsedGenres((prev) => {
      const next = new Set(prev);
      if (next.has(genre)) next.delete(genre);
      else next.add(genre);
      return next;
    });
  };

  const selectGenreTracks = (trackIds: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = trackIds.every((id) => next.has(id));
      for (const id of trackIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const filteredIds = useMemo(() => filteredTracks.map((t) => t.id), [filteredTracks]);

  const allFilteredSelected =
    filteredTracks.length > 0 && filteredTracks.every((t) => selectedIds.has(t.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredIds));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    onDropTransfer(e.dataTransfer);
  };

  const selectedArray = useMemo(
    () => Array.from(selectedIds).filter((id) => tracks.some((t) => t.id === id)),
    [selectedIds, tracks]
  );

  const exportTargetTracks = useMemo(() => {
    if (selectedArray.length > 0) {
      const selectedSet = new Set(selectedArray);
      return tracks.filter((t) => selectedSet.has(t.id));
    }
    return filteredTracks;
  }, [selectedArray, tracks, filteredTracks]);

  const handleToggleDuplicateFinder = () => {
    const nextOpen = !showDuplicateFinder;
    setShowDuplicateFinder(nextOpen);
    if (nextOpen && unhashedCount > 0 && !isHashingDuplicates) {
      onComputeMissingHashes();
    }
  };

  const handleExportCatalog = (format: 'csv' | 'm3u8' | 'json') => {
    if (exportTargetTracks.length === 0) return;
    const scopeSlug = selectedArray.length > 0 ? 'selected' : 'library';
    if (format === 'csv') {
      triggerFileDownload(
        exportCatalogToCSV(exportTargetTracks),
        `cratesync-${scopeSlug}.csv`,
        'text/csv;charset=utf-8'
      );
    } else if (format === 'm3u8') {
      triggerFileDownload(
        exportCatalogToM3U8(exportTargetTracks, watchedFolder?.name || 'Device Storage Catalog'),
        `cratesync-${scopeSlug}.m3u8`,
        'audio/x-mpegurl;charset=utf-8'
      );
    } else {
      triggerFileDownload(
        exportCatalogToJSON(exportTargetTracks),
        `cratesync-${scopeSlug}.json`,
        'application/json;charset=utf-8'
      );
    }
    setExportMenuOpen(false);
  };

  // Empty Workspace State
  if (tracks.length === 0) {
    return (
      <div
        className="flex-1 overflow-y-auto px-5 py-8 sm:px-8 lg:px-10"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="max-w-5xl mx-auto space-y-8">
          {/* Editorial Hero Visual Container */}
          <div className="relative rounded-xl overflow-hidden border border-white/[0.08] bg-[#13151A]">
            <div className="relative h-56 sm:h-64 w-full overflow-hidden">
              {!bannerFailed ? (
                <img
                  src={STUDIO_BANNER_SRC}
                  alt="Matte black studio vinyl turntable and precision tonearm"
                  referrerPolicy="no-referrer"
                  onError={() => setBannerFailed(true)}
                  className="h-full w-full object-cover object-center"
                />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-[#1A1D24] via-[#111318] to-[#0B0C0E]" />
              )}
              <div
                className="absolute inset-0 bg-gradient-to-t from-[#0B0C0E] via-[#0B0C0E]/65 to-transparent"
                aria-hidden="true"
              />
              <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="max-w-xl">
                  <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white [text-wrap:balance]">
                    Turn local audio folders into synced YouTube Music playlists
                  </h1>
                  <p className="mt-2 text-sm text-[#C2C8D4] leading-relaxed">
                    Scan MP3, FLAC, M4A, WAV, or OGG files directly from your device. Extract ID3
                    metadata locally, match tracks on YouTube Music, and launch instant playlists as
                    your folder changes.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Primary Drop Zone & Folder Actions */}
          <div
            className={`rounded-xl border border-dashed transition-colors p-8 sm:p-10 text-center ${
              isDragging
                ? 'border-[#FF1F3D] bg-[#FF1F3D]/[0.06]'
                : 'border-white/[0.14] bg-[#12141A]'
            }`}
          >
            <div className="mx-auto h-11 w-11 rounded-lg bg-[#1A1D25] border border-white/[0.08] flex items-center justify-center text-[#E5E7EB]">
              <FolderOpen className="h-5 w-5" />
            </div>

            <h2 className="mt-4 font-display text-lg font-semibold text-white">
              {isScanning
                ? 'Scanning audio files from device storage...'
                : 'Select a music folder or drop audio files here'}
            </h2>
            <p className="mt-1.5 text-sm text-[#8B92A2] max-w-md mx-auto">
              All metadata reading happens privately inside your browser. Nothing is uploaded to a
              remote server.
            </p>

            {scanProgress && (
              <div className="mt-4 max-w-xs mx-auto">
                <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-[#FF1F3D] transition-all duration-150"
                    style={{
                      width: `${Math.round((scanProgress.processed / Math.max(1, scanProgress.total)) * 100)}%`,
                    }}
                  />
                </div>
                <div className="mt-1.5 font-mono text-xs tabular-nums text-[#9CA3AF]">
                  {scanProgress.processed} / {scanProgress.total} files parsed
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onMountFolder}
                disabled={isScanning}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md text-sm font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <FolderOpen className="h-4 w-4" />
                <span>Mount Local Folder</span>
              </button>

              <button
                type="button"
                onClick={onPickFilesFallback}
                disabled={isScanning}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md text-sm font-medium text-[#E5E7EB] bg-[#1C2029] border border-white/[0.09] hover:bg-[#242935] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <FileAudio className="h-4 w-4 text-[#9CA3AF]" />
                <span>Choose Audio Files</span>
              </button>

              <button
                type="button"
                onClick={onGoToImport}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium text-[#A1A7B5] hover:text-white hover:bg-white/[0.05] transition-colors whitespace-nowrap"
              >
                <Upload className="h-4 w-4" />
                <span>Import M3U / CSV</span>
              </button>
            </div>

            {scanNotice && (
              <p className="mt-4 text-xs text-[#F59E0B] max-w-lg mx-auto">{scanNotice}</p>
            )}
          </div>

          {/* 3-Step Workflow Explanation (Unboxed horizontal grid with subtle dividers) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2 border-t border-white/[0.07]">
            <div className="pt-4">
              <div className="font-mono text-xs text-[#717786] mb-1.5">01. Scan &amp; Extract</div>
              <h3 className="text-sm font-semibold text-white">Local ID3 &amp; FLAC tag parser</h3>
              <p className="mt-1 text-xs text-[#8B92A2] leading-relaxed">
                Reads embedded title, artist, album, duration, and cover art directly from MP3,
                FLAC, M4A, and WAV files.
              </p>
            </div>
            <div className="pt-4 md:border-l md:border-white/[0.07] md:pl-6">
              <div className="font-mono text-xs text-[#717786] mb-1.5">02. Match &amp; Build</div>
              <h3 className="text-sm font-semibold text-white">Bind tracks to YouTube Music</h3>
              <p className="mt-1 text-xs text-[#8B92A2] leading-relaxed">
                Verify exact YouTube Music tracks with one-click search, then open an instant
                multi-track queue ready to save to your library.
              </p>
            </div>
            <div className="pt-4 md:border-l md:border-white/[0.07] md:pl-6">
              <div className="font-mono text-xs text-[#717786] mb-1.5">03. Auto-Watch Sync</div>
              <h3 className="text-sm font-semibold text-white">Detect folder additions &amp; removals</h3>
              <p className="mt-1 text-xs text-[#8B92A2] leading-relaxed">
                Periodic local folder re-scans detect newly dropped files and removed tracks,
                queueing clean playlist diffs automatically.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Populated Device Storage Table View
  return (
    <div
      className="flex-1 flex flex-col min-h-0 overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay notice */}
      {isDragging && (
        <div className="px-6 py-2.5 bg-[#FF1F3D]/15 border-b border-[#FF1F3D]/40 text-xs font-medium text-white text-center shrink-0">
          Drop audio files anywhere to add them to your device storage catalog
        </div>
      )}

      {/* 4-Column Summary Strip with Live Track Statistics */}
      <div className="px-5 sm:px-6 py-4 border-b border-white/[0.07] bg-[#0E1014] grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        <div>
          <div className="text-xs text-[#717786]">
            {effectiveGenreFilter === 'all' ? 'Local Audio Files' : `${effectiveGenreFilter} Files`}
          </div>
          <div className="mt-1 font-mono text-xl font-medium tabular-nums text-white">
            {stats.total}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6B7280]">
            {filteredStats.uniqueArtists} artists · {filteredStats.uniqueGenres} genre
            {filteredStats.uniqueGenres === 1 ? '' : 's'}
          </div>
        </div>
        <div className="lg:border-l lg:border-white/[0.07] lg:pl-5">
          <div className="text-xs text-[#717786]">Matched on YouTube Music</div>
          <div className="mt-1 font-mono text-xl font-medium tabular-nums text-[#22C55E]">
            {stats.matched}
            <span className="text-xs text-[#6B7280] font-normal ml-1.5">
              / {stats.total}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6B7280]">
            {filteredStats.matchRatePct}% matched · {stats.unmatched} pending
          </div>
        </div>
        <div className="lg:border-l lg:border-white/[0.07] lg:pl-5">
          <div className="text-xs text-[#717786]">Avg Duration / Bitrate</div>
          <div className="mt-1 font-mono text-xl font-medium tabular-nums text-white">
            {formatDuration(filteredStats.avgDuration)}
            {filteredStats.avgBitrateKbps && (
              <span className="text-xs text-[#8B92A2] font-normal ml-2">
                {filteredStats.avgBitrateKbps} kbps
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6B7280]">
            {filteredStats.losslessPct}% lossless · {formatFileSize(filteredStats.avgSize)} avg
          </div>
        </div>
        <div className="lg:border-l lg:border-white/[0.07] lg:pl-5">
          <div className="text-xs text-[#717786]">Total Runtime &amp; Size</div>
          <div className="mt-1 font-mono text-xl font-medium tabular-nums text-white">
            {formatTotalRuntime(stats.totalDuration)}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6B7280]">
            {formatFileSize(filteredStats.totalSize)} total
          </div>
        </div>
      </div>

      {/* Controls & Auto-Watch Toolbar */}
      <div className="px-5 sm:px-6 py-3 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
          {/* Smart Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="h-3.5 w-3.5 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Smart search (genre:rock, is:missing, plays:>1...)"
              aria-label="Smart search device tracks"
              title="Supports fuzzy search plus operators: genre:, artist:, format:, year:, plays:, duration:, is:missing, is:unmatched, lossless, -exclude"
              className="w-full pl-8 pr-7 py-1.5 rounded-md bg-[#13151B] border border-white/[0.09] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[#6B7280] hover:text-white transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Segmented Match-State Filter Control */}
          <div
            className="inline-flex items-center p-0.5 rounded-md bg-[#13151B] border border-white/[0.08]"
            role="tablist"
            aria-label="Filter tracks by match state"
          >
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'unmatched', label: 'Unmatched' },
                { id: 'matched', label: 'Matched' },
                { id: 'missing', label: `Missing (${stats.missing})` },
              ] as Array<{ id: TrackFilter; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filter === tab.id}
                onClick={() => setFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  filter === tab.id
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Inferred Genre Filter Select */}
          <select
            aria-label="Filter tracks by inferred genre"
            value={effectiveGenreFilter}
            onChange={(e) => setGenreFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-md bg-[#13151B] border border-white/[0.09] text-xs text-[#E5E7EB] focus:border-[#FF1F3D] focus:outline-none"
          >
            <option value="all">All Genres ({tracks.length})</option>
            {allStats.genreGroups.map((g) => (
              <option key={g.genre} value={g.genre}>
                {g.genre} ({g.count})
              </option>
            ))}
          </select>

          {/* Sort Order Select (Most Played / Recently Played / Title) */}
          <select
            aria-label="Sort library tracks"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as TrackSort)}
            className="px-2.5 py-1.5 rounded-md bg-[#13151B] border border-white/[0.09] text-xs text-[#E5E7EB] focus:border-[#FF1F3D] focus:outline-none"
          >
            <option value="default">Sort: Recent Scan</option>
            <option value="most-played">Sort: Most Played</option>
            <option value="recently-played">Sort: Recently Played</option>
            <option value="title">Sort: Title A–Z</option>
          </select>

          {/* Flat vs Grouped by Genre Toggle */}
          <div
            className="inline-flex items-center p-0.5 rounded-md bg-[#13151B] border border-white/[0.08]"
            role="group"
            aria-label="Catalog grouping mode"
          >
            <button
              type="button"
              onClick={() => setGroupByGenre(false)}
              aria-pressed={!groupByGenre}
              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                !groupByGenre ? 'bg-white/[0.12] text-white' : 'text-[#8B92A2] hover:text-white'
              }`}
            >
              <List className="h-3 w-3" />
              <span>List</span>
            </button>
            <button
              type="button"
              onClick={() => setGroupByGenre(true)}
              aria-pressed={groupByGenre}
              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                groupByGenre ? 'bg-white/[0.12] text-white' : 'text-[#8B92A2] hover:text-white'
              }`}
            >
              <Layers className="h-3 w-3" />
              <span>By Genre</span>
            </button>
          </div>
        </div>

        {/* Right: Folder Watch Controls + Add More Files */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {watchedFolder?.hasLiveHandle && (
            <div className="flex items-center gap-2 mr-1">
              <label htmlFor="auto-watch-select" className="text-xs text-[#717786] whitespace-nowrap">
                Auto-watch:
              </label>
              <select
                id="auto-watch-select"
                value={autoWatchIntervalSec}
                onChange={(e) =>
                  onChangeAutoWatch(Number(e.target.value) as 0 | 30 | 120 | 300)
                }
                className="px-2 py-1 rounded bg-[#13151B] border border-white/[0.09] text-xs font-mono text-[#D1D5DB] focus:border-[#FF1F3D] focus:outline-none"
              >
                <option value={0}>Manual</option>
                <option value={30}>30s</option>
                <option value={120}>2m</option>
                <option value={300}>5m</option>
              </select>
              <button
                type="button"
                onClick={onRescanFolder}
                disabled={isScanning}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[#D1D5DB] bg-[#161920] border border-white/[0.09] hover:text-white hover:bg-[#1E222B] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                <span>Re-scan</span>
              </button>
            </div>
          )}

          {filteredIds.length > 0 && (
            <button
              type="button"
              onClick={() =>
                onPlayList(selectedArray.length > 0 ? selectedArray : filteredIds, {
                  shuffle: false,
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[#0B0C0E] bg-white hover:bg-[#E5E7EB] transition-colors whitespace-nowrap"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>{selectedArray.length > 0 ? 'Play Selected' : 'Play All'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowTrackStats((prev) => !prev)}
            aria-expanded={showTrackStats}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
              showTrackStats
                ? 'text-white bg-[#1E222D] border-[#FF1F3D]/60'
                : 'text-[#D1D5DB] bg-[#161920] border-white/[0.09] hover:text-white hover:bg-[#1E222B]'
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>Stats</span>
          </button>

          <button
            type="button"
            disabled={selectedArray.length === 0 && filteredIds.length === 0}
            onClick={() =>
              onOpenBatchTagEditor(
                selectedArray.length > 0 ? selectedArray : filteredIds,
                selectedArray.length > 0
                  ? `${selectedArray.length} selected`
                  : effectiveGenreFilter !== 'all'
                    ? effectiveGenreFilter
                    : 'Filtered catalog'
              )
            }
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[#D1D5DB] bg-[#161920] border border-white/[0.09] hover:text-white hover:bg-[#1E222B] disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            <Tags className="h-3.5 w-3.5" />
            <span>
              {selectedArray.length > 0 ? `Edit Tags (${selectedArray.length})` : 'Batch Tags'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowLibraryCleanup((prev) => !prev)}
            aria-expanded={showLibraryCleanup}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
              showLibraryCleanup
                ? 'text-white bg-[#1E222D] border-[#EF4444]/60'
                : stats.missing > 0
                  ? 'text-[#FCA5A5] bg-[#161920] border-[#EF4444]/40 hover:bg-[#1E222B]'
                  : 'text-[#D1D5DB] bg-[#161920] border-white/[0.09] hover:text-white hover:bg-[#1E222B]'
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>{stats.missing > 0 ? `Cleanup (${stats.missing})` : 'Cleanup'}</span>
          </button>

          <button
            type="button"
            onClick={handleToggleDuplicateFinder}
            aria-expanded={showDuplicateFinder}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
              showDuplicateFinder
                ? 'text-white bg-[#1E222D] border-[#FF1F3D]/60'
                : redundantCount > 0
                  ? 'text-[#F59E0B] bg-[#161920] border-[#F59E0B]/35 hover:bg-[#1E222B]'
                  : 'text-[#D1D5DB] bg-[#161920] border-white/[0.09] hover:text-white hover:bg-[#1E222B]'
            }`}
          >
            <Fingerprint className="h-3.5 w-3.5" />
            <span>
              {redundantCount > 0 ? `Duplicates (${redundantCount})` : 'Duplicates'}
            </span>
          </button>

          <div className="relative" ref={exportMenuRef}>
            <button
              type="button"
              onClick={() => setExportMenuOpen((prev) => !prev)}
              disabled={exportTargetTracks.length === 0}
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[#D1D5DB] bg-[#161920] border border-white/[0.09] hover:text-white hover:bg-[#1E222B] disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export</span>
              <ChevronDown className="h-3 w-3 text-[#717786]" />
            </button>

            {exportMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-1.5 w-60 rounded-lg border border-white/[0.1] bg-[#13161E] shadow-2xl py-1.5 z-30"
              >
                <div className="px-3 py-1.5 border-b border-white/[0.07] text-[11px] font-mono tabular-nums text-[#717786]">
                  {selectedArray.length > 0
                    ? `Exporting ${exportTargetTracks.length} selected`
                    : `Exporting ${exportTargetTracks.length} visible track${exportTargetTracks.length === 1 ? '' : 's'}`}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleExportCatalog('csv')}
                  className="w-full px-3 py-2 text-left hover:bg-white/[0.05] transition-colors"
                >
                  <div className="text-xs font-medium text-white">Export CSV (.csv)</div>
                  <div className="text-[11px] text-[#717786]">
                    Tags, file sizes, SHA-256 &amp; YouTube URLs
                  </div>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleExportCatalog('m3u8')}
                  className="w-full px-3 py-2 text-left hover:bg-white/[0.05] transition-colors"
                >
                  <div className="text-xs font-medium text-white">Export M3U8 (.m3u8)</div>
                  <div className="text-[11px] text-[#717786]">
                    Standard playlist file for audio players
                  </div>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleExportCatalog('json')}
                  className="w-full px-3 py-2 text-left hover:bg-white/[0.05] transition-colors"
                >
                  <div className="text-xs font-medium text-white">Export JSON (.json)</div>
                  <div className="text-[11px] text-[#717786]">
                    Structured catalog metadata backup
                  </div>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onPickFilesFallback}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[#D1D5DB] bg-[#161920] border border-white/[0.09] hover:text-white hover:bg-[#1E222B] transition-colors whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Files</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onCreatePlaylistFromTracks(selectedArray.length > 0 ? selectedArray : filteredIds)
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
          >
            <ListPlus className="h-3.5 w-3.5" />
            <span>
              {selectedArray.length > 0
                ? `Playlist from ${selectedArray.length}`
                : 'Create Playlist'}
            </span>
          </button>
        </div>
      </div>

      {/* Bulk Selection Bar */}
      {selectedArray.length > 0 && (
        <div className="px-5 sm:px-6 py-2.5 bg-[#151821] border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-mono tabular-nums text-white font-medium">
              {selectedArray.length} selected
            </span>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-[#8B92A2] hover:text-white transition-colors"
            >
              Clear selection
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {playlists.length > 0 && (
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Target playlist for selected tracks"
                  value={targetPlaylistId || playlists[0].id}
                  onChange={(e) => setTargetPlaylistId(e.target.value)}
                  className="px-2.5 py-1.5 rounded-md bg-[#0D0F13] border border-white/[0.1] text-xs text-white focus:border-[#FF1F3D] focus:outline-none"
                >
                  {playlists.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const pid = targetPlaylistId || playlists[0].id;
                    onAddTracksToPlaylist(pid, selectedArray);
                    setSelectedIds(new Set());
                  }}
                  className="px-3 py-1.5 rounded-md text-xs font-medium text-white bg-white/[0.1] hover:bg-white/[0.16] transition-colors whitespace-nowrap"
                >
                  Add to Playlist
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() =>
                onOpenBatchTagEditor(selectedArray, `${selectedArray.length} selected`)
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-white/[0.1] hover:bg-white/[0.16] transition-colors whitespace-nowrap"
            >
              <Tags className="h-3.5 w-3.5" />
              <span>Edit Tags</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onRequestDeleteTracks(selectedArray);
                setSelectedIds(new Set());
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[#FCA5A5] hover:text-white hover:bg-[#DC2626]/20 transition-colors whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Remove</span>
            </button>
          </div>
        </div>
      )}



      {/* Active Smart Search Operator Bar */}
      {smartSearchEval.parsed.activeDescriptors.length > 0 && (
        <div className="px-5 sm:px-6 py-2 bg-[#101219] border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center gap-2 text-[#9CA3AF] min-w-0">
            <Sparkles className="h-3.5 w-3.5 text-[#FF4D64] shrink-0" />
            <span className="text-[#D1D5DB] font-medium shrink-0">Smart Search:</span>
            <span className="truncate">{smartSearchEval.parsed.activeDescriptors.join(' · ')}</span>
          </div>
          <button
            type="button"
            onClick={() => setSearch('')}
            className="text-[#8B92A2] hover:text-white transition-colors whitespace-nowrap"
          >
            Clear query
          </button>
        </div>
      )}

      {/* Library Cleanup Utility Panel (Missing on Device Tracks) */}
      {showLibraryCleanup && (
        <LibraryCleanupPanel
          tracks={tracks}
          playlists={playlists}
          isScanning={isScanning}
          hasLiveFolderHandle={Boolean(watchedFolder?.hasLiveHandle)}
          onRemoveMissingTracks={onRemoveMissingTracks}
          onRescanFolder={onRescanFolder}
          onClose={() => setShowLibraryCleanup(false)}
        />
      )}

      {/* Live Track Statistics Panel */}
      {showTrackStats && (
        <TrackStatisticsPanel
          stats={filteredStats}
          scopeLabel={
            effectiveGenreFilter !== 'all'
              ? effectiveGenreFilter
              : filter !== 'all'
                ? `${filter[0].toUpperCase()}${filter.slice(1)} tracks`
                : 'Full library'
          }
          onSelectGenre={(genre) => setGenreFilter((prev) => (prev === genre ? 'all' : genre))}
          onPlayTrack={onPlayTrack}
          queueIds={filteredIds}
          onClose={() => setShowTrackStats(false)}
        />
      )}

      {/* Duplicate Audio Detector Panel */}
      {showDuplicateFinder && (
        <DuplicateFinderPanel
          groups={duplicateGroups}
          totalTracks={tracks.length}
          unhashedCount={unhashedCount}
          isHashing={isHashingDuplicates}
          hashProgress={hashProgress}
          activePlayingTrackId={activePlayingTrackId}
          isAudioPlaying={isAudioPlaying}
          onRunHashScan={onComputeMissingHashes}
          onPlayTrack={onPlayTrack}
          onRequestRemoveDuplicates={onRequestRemoveDuplicates}
          onClose={() => setShowDuplicateFinder(false)}
        />
      )}

      {/* High-Density Track Data Table */}
      <div className="flex-1 overflow-auto">
        {filteredTracks.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <p className="text-sm text-[#9CA3AF]">No local tracks match your current filter.</p>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setFilter('all');
                setGenreFilter('all');
              }}
              className="mt-3 text-xs font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead className="sticky top-0 z-10 bg-[#0D0F13] border-b border-white/[0.08] text-[11px] font-medium text-[#717786]">
              <tr>
                <th className="py-2.5 pl-5 pr-2 w-10">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all visible tracks"
                    className="h-3.5 w-3.5 rounded accent-[#FF1F3D] cursor-pointer"
                  />
                </th>
                <th className="py-2.5 px-2 w-10 text-center">#</th>
                <th className="py-2.5 px-3">Track</th>
                <th className="py-2.5 px-3">Album &amp; Genre</th>
                <th className="py-2.5 px-3 w-48">YouTube Music</th>
                <th className="py-2.5 px-3 w-20 text-right">
                  <button
                    type="button"
                    onClick={() =>
                      setSortBy((prev) => (prev === 'most-played' ? 'default' : 'most-played'))
                    }
                    className={`inline-flex items-center gap-1 transition-colors ${
                      sortBy === 'most-played' ? 'text-[#FF4D64]' : 'hover:text-white'
                    }`}
                    title="Sort by most played"
                  >
                    <span>Plays</span>
                  </button>
                </th>
                <th className="py-2.5 pl-3 pr-5 w-28 text-right">Format / Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] text-sm">
              {(() => {
                const renderTrackRow = (track: LocalTrack, idx: number, rowQueueIds: string[]) => {
                  const isSelected = selectedIds.has(track.id);
                  const isActivePlay = activePlayingTrackId === track.id;
                  const playable = hasPlayableFile(track.fileKey);
                  const inferredGenre = trackGenreMap.get(track.id)?.genre ?? 'Unclassified';
                  const pStats = playStats[track.id];
                  const playCount = pStats?.playCount ?? track.playCount ?? 0;
                  const skipCount = pStats?.skipCount ?? track.skipCount ?? 0;
                  const completedCount =
                    pStats?.completedCount ?? Math.max(0, playCount - skipCount);
                  const lastPlayedAt = pStats?.lastPlayedAt ?? track.lastPlayedAt ?? null;

                  return (
                    <tr
                      key={track.id}
                      className={`group transition-colors ${
                        isSelected ? 'bg-[#FF1F3D]/[0.07]' : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <td className="py-2.5 pl-5 pr-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(track.id)}
                          aria-label={`Select ${track.title}`}
                          className="h-3.5 w-3.5 rounded accent-[#FF1F3D] cursor-pointer"
                        />
                      </td>

                      <td className="py-2.5 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => onPlayTrack(track.id, rowQueueIds)}
                          title={
                            playable
                              ? 'Preview local audio file'
                              : 'Re-scan folder in this session to preview audio'
                          }
                          aria-label={
                            isActivePlay && isAudioPlaying
                              ? `Pause ${track.title}`
                              : `Play ${track.title}`
                          }
                          className={`h-7 w-7 mx-auto rounded flex items-center justify-center transition-colors ${
                            isActivePlay
                              ? 'text-[#FF1F3D]'
                              : playable
                                ? 'text-[#717786] hover:text-white hover:bg-white/[0.07]'
                                : 'text-[#4B5563]'
                          }`}
                        >
                          {isActivePlay && isAudioPlaying ? (
                            <Pause className="h-3.5 w-3.5 fill-current" />
                          ) : (
                            <>
                              <span className="font-mono text-xs tabular-nums group-hover:hidden">
                                {idx + 1}
                              </span>
                              <Play className="h-3.5 w-3.5 fill-current hidden group-hover:block ml-0.5" />
                            </>
                          )}
                        </button>
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-9 w-9 rounded bg-[#181B22] border border-white/[0.06] overflow-hidden flex items-center justify-center shrink-0">
                            {track.coverArtUrl ? (
                              <img
                                src={track.coverArtUrl}
                                alt={`${track.title} cover`}
                                referrerPolicy="no-referrer"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <Disc3 className="h-4 w-4 text-[#525866]" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[13.5px] font-medium truncate ${
                                  track.isMissingOnDevice
                                    ? 'text-[#717786] line-through'
                                    : isActivePlay
                                      ? 'text-[#FF4D64]'
                                      : 'text-white'
                                }`}
                              >
                                {track.title}
                              </span>
                              {track.isMissingOnDevice && (
                                <span className="text-[11px] text-[#EF4444] whitespace-nowrap shrink-0">
                                  Missing
                                </span>
                              )}
                              {duplicateTrackIds.has(track.id) && (
                                <button
                                  type="button"
                                  onClick={() => setShowDuplicateFinder(true)}
                                  className="text-[11px] text-[#F59E0B] hover:underline whitespace-nowrap shrink-0"
                                >
                                  Duplicate
                                </button>
                              )}
                            </div>
                            <div className="text-xs text-[#8B92A2] truncate">{track.artist}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 max-w-[240px]">
                        <div className="text-xs text-[#C2C8D4] truncate">{track.album}</div>
                        <div className="text-[11px] text-[#6B7280] truncate flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setGenreFilter((prev) =>
                                prev === inferredGenre ? 'all' : inferredGenre
                              )
                            }
                            className={`hover:text-[#FF4D64] transition-colors shrink-0 ${
                              effectiveGenreFilter === inferredGenre
                                ? 'text-[#FF4D64]'
                                : 'text-[#8B92A2]'
                            }`}
                          >
                            {inferredGenre}
                          </button>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{track.folderName}</span>
                        </div>
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          {track.youtubeVideoId ? (
                            <button
                              type="button"
                              onClick={() => onInspectTrack(track.id)}
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#22C55E] hover:text-[#4ADE80] transition-colors whitespace-nowrap"
                            >
                              <Check className="h-3.5 w-3.5 shrink-0" />
                              <span className="font-mono">{track.youtubeVideoId}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onInspectTrack(track.id)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#D1D5DB] hover:text-white transition-colors whitespace-nowrap"
                            >
                              <Link2 className="h-3.5 w-3.5 text-[#8B92A2]" />
                              <span>
                                {track.matchStatus === 'skipped' ? 'Skipped' : 'Match ID'}
                              </span>
                            </button>
                          )}
                          <span className="text-[#3F4554]" aria-hidden="true">
                            ·
                          </span>
                          <a
                            href={buildTrackYouTubeMusicUrl(track)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-[#A1A7B5] hover:text-[#FF4D64] transition-colors whitespace-nowrap"
                            title={
                              track.youtubeVideoId
                                ? 'Open matched song in YouTube Music'
                                : 'Open in YouTube Music'
                            }
                          >
                            <span>Open</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </td>

                      <td
                        className="py-2.5 px-3 text-right font-mono text-xs tabular-nums whitespace-nowrap"
                        title={
                          playCount > 0
                            ? `${completedCount} finished · ${skipCount} skipped${lastPlayedAt ? ` · Last played ${formatRelativeTime(lastPlayedAt)}` : ''}`
                            : 'Not played yet'
                        }
                      >
                        {playCount > 0 ? (
                          <div>
                            <span className="text-white font-medium">{playCount}</span>
                            {lastPlayedAt && (
                              <div className="text-[10px] text-[#6B7280]">
                                {formatRelativeTime(lastPlayedAt)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[#4B5563]">—</span>
                        )}
                      </td>

                      <td className="py-2.5 pl-3 pr-5 text-right font-mono text-xs tabular-nums text-[#8B92A2] whitespace-nowrap">
                        <div>
                          <span className="text-[#6B7280]">{track.format}</span>
                          <span className="mx-1.5 text-[#3F4554]" aria-hidden="true">
                            ·
                          </span>
                          <span>{formatDuration(track.duration)}</span>
                        </div>
                        {track.fileSize > 0 && (
                          <div className="text-[11px] text-[#525866]">
                            {formatFileSize(track.fileSize)}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                };

                if (!groupByGenre) {
                  return filteredTracks.map((track, idx) =>
                    renderTrackRow(track, idx, filteredIds)
                  );
                }

                return filteredStats.genreGroups.map((group) => {
                  const isCollapsed = collapsedGenres.has(group.genre);
                  const allInGroupSelected =
                    group.trackIds.length > 0 &&
                    group.trackIds.every((id) => selectedIds.has(id));

                  return (
                    <Fragment key={group.genre}>
                      <tr className="bg-[#11141B] border-y border-white/[0.08]">
                        <td colSpan={7} className="px-5 py-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => toggleGenreCollapsed(group.genre)}
                              className="inline-flex items-center gap-2 text-left group/hdr"
                            >
                              {isCollapsed ? (
                                <ChevronRight className="h-4 w-4 text-[#717786] group-hover/hdr:text-white" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-[#717786] group-hover/hdr:text-white" />
                              )}
                              <span className="font-display text-sm font-semibold text-white">
                                {group.genre}
                              </span>
                              <span className="font-mono text-xs tabular-nums text-[#8B92A2]">
                                {group.count} track{group.count === 1 ? '' : 's'} ·{' '}
                                {formatTotalRuntime(group.totalDuration)} ·{' '}
                                {formatDuration(group.avgDuration)} avg
                                {group.avgBitrateKbps ? ` · ${group.avgBitrateKbps} kbps` : ''}
                              </span>
                            </button>

                            <div className="flex items-center gap-3 text-xs shrink-0">
                              <button
                                type="button"
                                onClick={() => onPlayList(group.trackIds, { shuffle: false })}
                                className="inline-flex items-center gap-1 text-[#D1D5DB] hover:text-white transition-colors whitespace-nowrap"
                              >
                                <Play className="h-3 w-3 fill-current" />
                                <span>Play Genre</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => onCreatePlaylistFromTracks(group.trackIds)}
                                className="text-[#A1A7B5] hover:text-white transition-colors whitespace-nowrap"
                              >
                                Create Playlist
                              </button>
                              <button
                                type="button"
                                onClick={() => selectGenreTracks(group.trackIds)}
                                className="text-[#8B92A2] hover:text-[#FF4D64] transition-colors whitespace-nowrap"
                              >
                                {allInGroupSelected ? 'Deselect' : 'Select All'}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                      {!isCollapsed &&
                        group.tracks.map((track, idx) =>
                          renderTrackRow(track, idx, group.trackIds)
                        )}
                    </Fragment>
                  );
                });
              })()}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
