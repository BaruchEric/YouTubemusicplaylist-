import { useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  Disc3,
  ExternalLink,
  FileAudio,
  FolderOpen,
  FolderSync,
  History,
  Link2,
  ListMusic,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Upload,
} from 'lucide-react';
import type {
  LocalTrack,
  PlayHistoryEntry,
  Playlist,
  PlaylistDiff,
  SyncEvent,
  TrackPlayStats,
  WatchedFolderInfo,
} from '../types/music';
import { computeTrackStatistics, inferTrackGenre } from '../utils/genreInference';
import type { ShuffleMode } from '../utils/smartShuffle';
import {
  buildPlaylistYouTubeMusicUrl,
  buildTrackYouTubeMusicUrl,
  formatDuration,
  formatFileSize,
  formatRelativeTime,
  formatTotalRuntime,
} from '../utils/youtubeLinks';
import { AlbumArtGallery } from './AlbumArtGallery';
import { GenreDistributionChart } from './GenreDistributionChart';
import { ListeningActivitySection } from './ListeningActivitySection';
import { RecommendedForYou } from './RecommendedForYou';

const STUDIO_BANNER_SRC = '/src/assets/images/studio_audio_banner_1795114389740.jpg';

interface DashboardViewProps {
  tracks: LocalTrack[];
  playlists: Playlist[];
  trackMap: Map<string, LocalTrack>;
  diffMap: Map<string, PlaylistDiff>;
  syncHistory: SyncEvent[];
  watchedFolder: WatchedFolderInfo | null;
  autoWatchIntervalSec: 0 | 30 | 120 | 300;
  isScanning: boolean;
  activePlayingTrackId: string | null;
  isAudioPlaying: boolean;
  playStats: Record<string, TrackPlayStats>;
  playHistory: PlayHistoryEntry[];
  onClearPlayHistory: () => void;
  onMountFolder: () => void;
  onPickFilesFallback: () => void;
  onDropTransfer: (dataTransfer: DataTransfer) => void;
  onRescanFolder: () => void;
  onOpenScanner: (
    filter?: 'all' | 'unmatched' | 'matched' | 'missing',
    options?: { genre?: string; groupByGenre?: boolean; openCleanup?: boolean; query?: string }
  ) => void;
  onOpenPlaylist: (playlistId: string) => void;
  onOpenCreatePlaylist: () => void;
  onCreatePlaylistFromTracks: (trackIds: string[]) => void;
  onAddTracksToPlaylist: (playlistId: string, trackIds: string[]) => void;
  onOpenSyncQueue: () => void;
  onOpenTransfer: () => void;
  onApplySync: (playlistId: string) => void;
  onPlayTrack: (trackId: string, queueIds: string[]) => void;
  onPlayList: (trackIds: string[], options?: { shuffle?: boolean | ShuffleMode }) => void;
  onInspectTrack: (trackId: string) => void;
  onUpdateAlbumCoverArt?: (trackIds: string[], coverArtUrl: string | null) => void;
  onOpenBatchTagEditor?: (trackIds: string[], contextLabel: string) => void;
}

export function DashboardView({
  tracks,
  playlists,
  trackMap,
  diffMap,
  syncHistory,
  watchedFolder,
  autoWatchIntervalSec,
  isScanning,
  activePlayingTrackId,
  isAudioPlaying,
  playStats,
  playHistory,
  onClearPlayHistory,
  onMountFolder,
  onPickFilesFallback,
  onDropTransfer,
  onRescanFolder,
  onOpenScanner,
  onOpenPlaylist,
  onOpenCreatePlaylist,
  onCreatePlaylistFromTracks,
  onAddTracksToPlaylist,
  onOpenSyncQueue,
  onOpenTransfer,
  onApplySync,
  onPlayTrack,
  onPlayList,
  onInspectTrack,
  onUpdateAlbumCoverArt,
  onOpenBatchTagEditor,
}: DashboardViewProps) {
  const [bannerFailed, setBannerFailed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedGenre, setSelectedGenre] = useState<string>('all');

  const allStats = useMemo(() => computeTrackStatistics(tracks), [tracks]);

  const activeGenre = useMemo(() => {
    if (selectedGenre === 'all') return 'all';
    const exists = allStats.genreGroups.some((g) => g.genre === selectedGenre);
    return exists ? selectedGenre : 'all';
  }, [selectedGenre, allStats.genreGroups]);

  const scopedTracks = useMemo(() => {
    if (activeGenre === 'all') return tracks;
    return tracks.filter((t) => inferTrackGenre(t).genre === activeGenre);
  }, [tracks, activeGenre]);

  const scopedStats = useMemo(
    () => (activeGenre === 'all' ? allStats : computeTrackStatistics(scopedTracks)),
    [activeGenre, allStats, scopedTracks]
  );

  const recentTracks = useMemo(() => scopedTracks.slice(0, 6), [scopedTracks]);
  const recentTrackIds = useMemo(() => recentTracks.map((t) => t.id), [recentTracks]);

  const metrics = useMemo(() => {
    const artistTotals = new Map<
      string,
      { artist: string; count: number; duration: number; trackIds: string[] }
    >();

    for (const track of scopedTracks) {
      if (!track.isMissingOnDevice) {
        const artistName = track.artist || 'Unknown Artist';
        const existingArtist = artistTotals.get(artistName) ?? {
          artist: artistName,
          count: 0,
          duration: 0,
          trackIds: [],
        };
        existingArtist.count += 1;
        existingArtist.duration += track.duration || 0;
        existingArtist.trackIds.push(track.id);
        artistTotals.set(artistName, existingArtist);
      }
    }

    let pendingAdd = 0;
    let pendingRemove = 0;
    let linkedPlaylists = 0;
    for (const pl of playlists) {
      if (pl.youtubePlaylistUrl.trim()) linkedPlaylists++;
      const d = diffMap.get(pl.id);
      if (d) {
        pendingAdd += d.toAdd.length;
        pendingRemove += d.toRemove.length;
      }
    }

    const topArtists = Array.from(artistTotals.values())
      .sort((a, b) => b.count - a.count || b.duration - a.duration)
      .slice(0, 6);

    return {
      totalTracks: scopedStats.totalTracks,
      matched: scopedStats.matchedTracks,
      unmatched: scopedStats.unmatchedTracks,
      skipped: scopedStats.skippedTracks,
      missing: scopedStats.missingTracks,
      matchPercent: scopedStats.matchRatePct,
      totalSize: scopedStats.totalSize,
      totalDuration: scopedStats.totalDuration,
      pendingAdd,
      pendingRemove,
      totalPending: pendingAdd + pendingRemove,
      linkedPlaylists,
      formats: scopedStats.formats.slice(0, 6),
      topArtists,
    };
  }, [scopedTracks, scopedStats, playlists, diffMap]);

  const cadenceLabel =
    autoWatchIntervalSec === 0
      ? 'Manual'
      : autoWatchIntervalSec === 30
        ? 'Every 30s'
        : autoWatchIntervalSec === 120
          ? 'Every 2m'
          : 'Every 5m';

  const isLibraryEmpty = tracks.length === 0 && playlists.length === 0;

  return (
    <div
      className="flex-1 overflow-y-auto px-5 py-6 sm:px-8"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        onDropTransfer(e.dataTransfer);
      }}
    >
      <div className="max-w-6xl mx-auto space-y-8">
        {isDragging && (
          <div className="rounded-lg border border-dashed border-[#FF1F3D] bg-[#FF1F3D]/10 px-5 py-4 text-center text-sm font-medium text-white">
            Drop audio files or a music folder here to add them to your library
          </div>
        )}
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-white/[0.08]">
          <div>
            <h1 className="font-display text-2xl sm:text-[28px] font-semibold tracking-tight text-white">
              Library Dashboard
            </h1>
            <p className="mt-1 text-sm text-[#8B92A2]">
              Monitor local audio folders, YouTube Music track match coverage, and playlist sync
              status in one view.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {scopedTracks.length > 0 && (
              <button
                type="button"
                onClick={() => onPlayList(scopedTracks.map((t) => t.id), { shuffle: false })}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-[#0B0C0E] bg-white hover:bg-[#E5E7EB] transition-colors whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>{activeGenre === 'all' ? 'Play Library' : `Play ${activeGenre}`}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenCreatePlaylist}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-[#E5E7EB] bg-[#161920] border border-white/[0.09] hover:bg-[#1E222B] transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Playlist</span>
            </button>
            {watchedFolder?.hasLiveHandle ? (
              <button
                type="button"
                onClick={onRescanFolder}
                disabled={isScanning}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                <span>{isScanning ? 'Scanning...' : 'Re-scan Folder'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onMountFolder}
                disabled={isScanning}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span>Mount Local Folder</span>
              </button>
            )}
          </div>
        </div>

        {/* Interactive Genre Filter Bar (shown when library has tracks) */}
        {tracks.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className="flex items-center gap-1 p-1 rounded-md bg-[#12141A] border border-white/[0.08] overflow-x-auto max-w-full"
              role="tablist"
              aria-label="Filter dashboard by inferred music genre"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeGenre === 'all'}
                onClick={() => setSelectedGenre('all')}
                className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeGenre === 'all'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                All Genres{' '}
                <span className="font-mono tabular-nums text-[11px] opacity-75">
                  ({tracks.length})
                </span>
              </button>
              {allStats.genreGroups.map((group) => (
                <button
                  key={group.genre}
                  type="button"
                  role="tab"
                  aria-selected={activeGenre === group.genre}
                  onClick={() => setSelectedGenre(group.genre)}
                  className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    activeGenre === group.genre
                      ? 'bg-[#FF1F3D]/20 text-white'
                      : 'text-[#8B92A2] hover:text-white'
                  }`}
                >
                  {group.genre}{' '}
                  <span className="font-mono tabular-nums text-[11px] opacity-75">
                    ({group.count})
                  </span>
                </button>
              ))}
            </div>

            {activeGenre !== 'all' && (
              <div className="flex items-center gap-3 text-xs shrink-0">
                <button
                  type="button"
                  onClick={() => onCreatePlaylistFromTracks(scopedTracks.map((t) => t.id))}
                  className="text-[#D1D5DB] hover:text-white transition-colors whitespace-nowrap"
                >
                  Create {activeGenre} playlist
                </button>
                <span className="text-[#3F4554]" aria-hidden="true">
                  ·
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onOpenScanner('all', { genre: activeGenre, groupByGenre: false })
                  }
                  className="inline-flex items-center gap-1 font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors whitespace-nowrap"
                >
                  <span>Open in Storage</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* 4-Column KPI Metric Strip (Single-level hairline divided grid, tabular-nums) */}
        <section
          aria-label="Library summary metrics"
          className="grid grid-cols-2 lg:grid-cols-4 gap-5 py-5 px-5 sm:px-6 rounded-lg bg-[#12141A] border border-white/[0.08]"
        >
          <div>
            <div className="text-xs text-[#717786]">
              {activeGenre === 'all' ? 'Device Audio Library' : `${activeGenre} Tracks`}
            </div>
            <div className="mt-1.5 font-mono text-2xl font-medium tabular-nums text-white">
              {metrics.totalTracks}
            </div>
            <div className="mt-1 text-xs text-[#8B92A2] font-mono tabular-nums">
              {formatTotalRuntime(metrics.totalDuration)} · {formatFileSize(metrics.totalSize)}
            </div>
          </div>

          <div className="lg:border-l lg:border-white/[0.07] lg:pl-5">
            <div className="text-xs text-[#717786]">YouTube Match Coverage</div>
            <div className="mt-1.5 font-mono text-2xl font-medium tabular-nums text-white">
              {metrics.matchPercent}%
            </div>
            <div className="mt-1 text-xs text-[#8B92A2] font-mono tabular-nums">
              <span className="text-[#22C55E]">{metrics.matched} matched</span> ·{' '}
              {metrics.unmatched} pending
            </div>
          </div>

          <div className="lg:border-l lg:border-white/[0.07] lg:pl-5">
            <div className="text-xs text-[#717786]">Playlists</div>
            <div className="mt-1.5 font-mono text-2xl font-medium tabular-nums text-white">
              {playlists.length}
            </div>
            <div className="mt-1 text-xs text-[#8B92A2] font-mono tabular-nums">
              {metrics.linkedPlaylists} linked to YouTube Music
            </div>
          </div>

          <div className="lg:border-l lg:border-white/[0.07] lg:pl-5">
            <div className="text-xs text-[#717786]">Sync Status</div>
            <div
              className={`mt-1.5 font-mono text-2xl font-medium tabular-nums ${
                metrics.totalPending > 0 ? 'text-[#F59E0B]' : 'text-[#22C55E]'
              }`}
            >
              {metrics.totalPending > 0 ? `${metrics.totalPending} pending` : 'In sync'}
            </div>
            <div className="mt-1 text-xs text-[#8B92A2] font-mono tabular-nums">
              {metrics.totalPending > 0
                ? `+${metrics.pendingAdd} add · -${metrics.pendingRemove} remove`
                : `${syncHistory.length} sync checkpoint${syncHistory.length === 1 ? '' : 's'}`}
            </div>
          </div>
        </section>

        {/* First-Run Onboarding Banner (only when library has no tracks & no playlists yet) */}
        {isLibraryEmpty && (
          <section className="rounded-xl overflow-hidden border border-white/[0.08] bg-[#12141A]">
            <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
              <div className="lg:col-span-5 relative min-h-[200px] overflow-hidden">
                {!bannerFailed ? (
                  <img
                    src={STUDIO_BANNER_SRC}
                    alt="Matte black studio vinyl turntable"
                    referrerPolicy="no-referrer"
                    onError={() => setBannerFailed(true)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-[#1A1D24] to-[#0B0C0E]" />
                )}
                <div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[#12141A]/90 hidden lg:block"
                  aria-hidden="true"
                />
              </div>
              <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-center">
                <h2 className="font-display text-xl font-semibold text-white [text-wrap:balance]">
                  Start by scanning a local music folder on your device
                </h2>
                <p className="mt-2 text-sm text-[#9CA3AF] leading-relaxed">
                  CrateSync reads ID3, FLAC, and M4A tags locally in your browser, tracks folder
                  additions and removals, and generates instant YouTube Music queues without
                  requiring account linking.
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={onMountFolder}
                    disabled={isScanning}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>Scan Local Folder</span>
                  </button>
                  <button
                    type="button"
                    onClick={onPickFilesFallback}
                    disabled={isScanning}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium text-[#E5E7EB] bg-[#1C2029] border border-white/[0.09] hover:bg-[#242935] transition-colors whitespace-nowrap"
                  >
                    <FileAudio className="h-3.5 w-3.5 text-[#9CA3AF]" />
                    <span>Upload Audio Files</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenTransfer}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-[#9CA3AF] hover:text-white transition-colors whitespace-nowrap"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>Import M3U / CSV</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Genre Distribution (Recharts Pie Chart) & Track Statistics 2-Column Section */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left (7 cols): Recharts Genre Distribution Pie Chart */}
          <GenreDistributionChart
            tracks={tracks}
            allStats={allStats}
            activeGenre={activeGenre}
            onSelectGenre={setSelectedGenre}
            onOpenScanner={onOpenScanner}
            onPlayList={onPlayList}
            onCreatePlaylistFromTracks={onCreatePlaylistFromTracks}
            onMountFolder={onMountFolder}
            onPickFilesFallback={onPickFilesFallback}
          />

          {/* Right (5 cols): Track Statistics */}
          <section className="lg:col-span-5 rounded-lg border border-white/[0.08] bg-[#12141A] p-5 flex flex-col justify-between gap-5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-[#717786]" />
                  <h2 className="font-display text-base font-semibold text-white">
                    Track Statistics
                  </h2>
                </div>
                <span className="text-xs font-mono tabular-nums text-[#717786]">
                  {activeGenre === 'all' ? 'Full library' : activeGenre}
                </span>
              </div>

              {tracks.length === 0 ? (
                <div className="mt-4 pt-4 border-t border-white/[0.07] text-xs text-[#717786] leading-relaxed">
                  Average track length, estimated bitrate, lossless ratio, release span, and
                  duration distribution will populate as soon as local audio files are scanned.
                </div>
              ) : (
                /* 2x3 Quantitative Metric Grid */
                <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 pt-4 border-t border-white/[0.07]">
                  <div>
                    <div className="text-[11px] text-[#717786]">Average Duration</div>
                    <div className="mt-0.5 font-mono text-base font-medium tabular-nums text-white">
                      {formatDuration(scopedStats.avgDuration)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#717786]">Est. Average Bitrate</div>
                    <div className="mt-0.5 font-mono text-base font-medium tabular-nums text-white">
                      {scopedStats.avgBitrateKbps ? `${scopedStats.avgBitrateKbps} kbps` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#717786]">Average File Size</div>
                    <div className="mt-0.5 font-mono text-base font-medium tabular-nums text-white">
                      {formatFileSize(scopedStats.avgSize)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#717786]">Artists / Albums</div>
                    <div className="mt-0.5 font-mono text-base font-medium tabular-nums text-white">
                      {scopedStats.uniqueArtists}{' '}
                      <span className="text-xs text-[#6B7280] font-normal">
                        / {scopedStats.uniqueAlbums}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#717786]">Lossless Share</div>
                    <div className="mt-0.5 font-mono text-base font-medium tabular-nums text-white">
                      {scopedStats.losslessPct}%{' '}
                      <span className="text-xs text-[#6B7280] font-normal">
                        ({scopedStats.losslessCount})
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#717786]">Release Span</div>
                    <div className="mt-0.5 font-mono text-base font-medium tabular-nums text-white">
                      {scopedStats.yearRange
                        ? scopedStats.yearRange.min === scopedStats.yearRange.max
                          ? scopedStats.yearRange.min
                          : `${scopedStats.yearRange.min}–${scopedStats.yearRange.max}`
                        : 'No year tags'}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {tracks.length > 0 && (
              <>
                {/* Track Length Distribution */}
                <div className="pt-4 border-t border-white/[0.07] space-y-2.5">
                  <div className="text-xs font-medium text-[#D1D5DB]">
                    Track Duration Distribution
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {scopedStats.durationBuckets.map((bucket) => (
                      <div key={bucket.label} className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                          <span className="text-[#A1A7B5]">{bucket.label}</span>
                          <span className="text-[#717786]">
                            {bucket.count} · {bucket.pct}%
                          </span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className="h-full bg-[#E5E7EB]/75"
                            style={{ width: `${bucket.count > 0 ? Math.max(5, bucket.pct) : 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Extremes & Tag Completeness */}
                <div className="pt-4 border-t border-white/[0.07] space-y-2 text-xs">
                  {scopedStats.longestTrack && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#717786] shrink-0">Longest</span>
                      <button
                        type="button"
                        onClick={() =>
                          onPlayTrack(
                            scopedStats.longestTrack!.id,
                            scopedTracks.map((t) => t.id)
                          )
                        }
                        className="min-w-0 flex items-center gap-2 text-right hover:text-[#FF4D64] transition-colors"
                      >
                        <span className="text-[#E5E7EB] truncate">
                          {scopedStats.longestTrack.title}
                        </span>
                        <span className="font-mono tabular-nums text-[#8B92A2] shrink-0">
                          {formatDuration(scopedStats.longestTrack.duration)}
                        </span>
                      </button>
                    </div>
                  )}
                  {scopedStats.shortestTrack &&
                    scopedStats.shortestTrack.id !== scopedStats.longestTrack?.id && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#717786] shrink-0">Shortest</span>
                        <button
                          type="button"
                          onClick={() =>
                            onPlayTrack(
                              scopedStats.shortestTrack!.id,
                              scopedTracks.map((t) => t.id)
                            )
                          }
                          className="min-w-0 flex items-center gap-2 text-right hover:text-[#FF4D64] transition-colors"
                        >
                          <span className="text-[#E5E7EB] truncate">
                            {scopedStats.shortestTrack.title}
                          </span>
                          <span className="font-mono tabular-nums text-[#8B92A2] shrink-0">
                            {formatDuration(scopedStats.shortestTrack.duration)}
                          </span>
                        </button>
                      </div>
                    )}
                  <div className="pt-1 flex items-center justify-between text-[11px] font-mono tabular-nums text-[#717786]">
                    <span>
                      Artwork: {scopedStats.withCoverArtCount}/{scopedStats.totalTracks}
                    </span>
                    <span>
                      Year tags: {scopedStats.withYearCount}/{scopedStats.totalTracks}
                    </span>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>

        {/* Recommended for You (Genre-Matched Playlist Suggestions) */}
        <RecommendedForYou
          tracks={tracks}
          playlists={playlists}
          trackMap={trackMap}
          activeGenre={activeGenre}
          activePlayingTrackId={activePlayingTrackId}
          isAudioPlaying={isAudioPlaying}
          onAddTracksToPlaylist={onAddTracksToPlaylist}
          onCreatePlaylistFromTracks={onCreatePlaylistFromTracks}
          onPlayTrack={onPlayTrack}
          onInspectTrack={onInspectTrack}
          onOpenPlaylist={onOpenPlaylist}
          onMountFolder={onMountFolder}
          onPickFilesFallback={onPickFilesFallback}
        />

        {/* Most Played Songs & Recent Play History */}
        <ListeningActivitySection
          tracks={scopedTracks}
          trackMap={trackMap}
          activeGenre={activeGenre}
          playStats={playStats}
          playHistory={playHistory}
          activePlayingTrackId={activePlayingTrackId}
          isAudioPlaying={isAudioPlaying}
          onPlayTrack={onPlayTrack}
          onPlayList={onPlayList}
          onCreatePlaylistFromTracks={onCreatePlaylistFromTracks}
          onInspectTrack={onInspectTrack}
          onClearPlayHistory={onClearPlayHistory}
        />

        {/* Album Art Gallery */}
        <AlbumArtGallery
          tracks={scopedTracks}
          activeGenre={activeGenre}
          activePlayingTrackId={activePlayingTrackId}
          isAudioPlaying={isAudioPlaying}
          onPlayTrack={onPlayTrack}
          onPlayList={onPlayList}
          onCreatePlaylistFromTracks={onCreatePlaylistFromTracks}
          onInspectTrack={onInspectTrack}
          onUpdateAlbumCoverArt={onUpdateAlbumCoverArt}
          onOpenBatchTagEditor={onOpenBatchTagEditor}
          onMountFolder={onMountFolder}
          onPickFilesFallback={onPickFilesFallback}
        />

        {/* Recently Added Local Files (visible immediately once any files are uploaded/scanned) */}
        {recentTracks.length > 0 && (
          <section className="rounded-lg border border-white/[0.08] bg-[#12141A] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/[0.07] flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-white">
                  {activeGenre === 'all'
                    ? 'Recently Added Audio Files'
                    : `Recent ${activeGenre} Tracks`}
                </h2>
                <p className="text-xs text-[#717786] mt-0.5">
                  Latest tracks scanned from your device storage
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  onOpenScanner('all', { genre: activeGenre, groupByGenre: false })
                }
                className="inline-flex items-center gap-1 text-xs font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors whitespace-nowrap"
              >
                <span>
                  View all {scopedTracks.length}{' '}
                  {activeGenre === 'all' ? 'tracks' : `${activeGenre} tracks`}
                </span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="divide-y divide-white/[0.05] text-xs">
              {recentTracks.map((track) => {
                const isActive = activePlayingTrackId === track.id;
                return (
                  <div
                    key={track.id}
                    className="px-5 py-2.5 flex items-center justify-between gap-4 hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onPlayTrack(track.id, recentTrackIds)}
                        aria-label={isActive && isAudioPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
                        className={`h-7 w-7 rounded flex items-center justify-center shrink-0 transition-colors ${
                          isActive
                            ? 'text-[#FF1F3D] bg-[#FF1F3D]/10'
                            : 'text-[#8B92A2] hover:text-white hover:bg-white/[0.07]'
                        }`}
                      >
                        {isActive && isAudioPlaying ? (
                          <Pause className="h-3.5 w-3.5 fill-current" />
                        ) : (
                          <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                        )}
                      </button>
                      <div className="h-8 w-8 rounded bg-[#181B22] border border-white/[0.06] overflow-hidden flex items-center justify-center shrink-0">
                        {track.coverArtUrl ? (
                          <img
                            src={track.coverArtUrl}
                            alt={`${track.title} cover`}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Disc3 className="h-3.5 w-3.5 text-[#525866]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">{track.title}</div>
                        <div className="text-[11px] text-[#8B92A2] truncate">
                          {track.artist} · {track.album} · {inferTrackGenre(track).genre}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <a
                        href={buildTrackYouTubeMusicUrl(track)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[#A1A7B5] hover:text-[#FF4D64] transition-colors whitespace-nowrap"
                        title="Open in YouTube Music"
                      >
                        <span>YT Music</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <button
                        type="button"
                        onClick={() => onInspectTrack(track.id)}
                        className={`inline-flex items-center gap-1 whitespace-nowrap transition-colors ${
                          track.youtubeVideoId
                            ? 'text-[#22C55E] font-mono'
                            : 'text-[#D1D5DB] hover:text-white'
                        }`}
                      >
                        {track.youtubeVideoId ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span>{track.youtubeVideoId}</span>
                          </>
                        ) : (
                          <>
                            <Link2 className="h-3.5 w-3.5 text-[#8B92A2]" />
                            <span>Match ID</span>
                          </>
                        )}
                      </button>
                      <span className="font-mono tabular-nums text-[#717786] hidden sm:inline">
                        {track.format} · {formatDuration(track.duration)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Primary 2-Column Overview Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left (7 cols): Playlist Sync Health Table */}
          <section className="lg:col-span-7 rounded-lg border border-white/[0.08] bg-[#12141A] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-white">
                  Playlists &amp; Sync Readiness
                </h2>
                <p className="text-xs text-[#717786] mt-0.5">
                  Track match progress and pending folder deltas per playlist
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenCreatePlaylist}
                className="text-xs font-medium text-[#D1D5DB] hover:text-white transition-colors whitespace-nowrap"
              >
                + New playlist
              </button>
            </div>

            {playlists.length === 0 ? (
              <div className="flex-1 p-8 flex flex-col items-center justify-center text-center">
                <ListMusic className="h-6 w-6 text-[#525866]" />
                <p className="mt-3 text-sm text-[#9CA3AF]">No playlists created yet.</p>
                <p className="mt-1 text-xs text-[#6B7280] max-w-xs">
                  Create a playlist from your scanned local folders to track YouTube Music matches
                  and folder changes.
                </p>
                <button
                  type="button"
                  onClick={onOpenCreatePlaylist}
                  className="mt-4 px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors"
                >
                  Create Playlist
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-[#0F1116] border-b border-white/[0.07] text-[#717786]">
                    <tr>
                      <th className="py-2.5 pl-5 pr-3 font-medium">Playlist</th>
                      <th className="py-2.5 px-3 font-medium">Matched</th>
                      <th className="py-2.5 px-3 font-medium">Sync State</th>
                      <th className="py-2.5 pl-3 pr-5 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {playlists.map((pl) => {
                      const diff = diffMap.get(pl.id);
                      const pendingCount = (diff?.toAdd.length ?? 0) + (diff?.toRemove.length ?? 0);
                      const plTracks = pl.trackIds
                        .map((id) => trackMap.get(id))
                        .filter((t): t is LocalTrack => Boolean(t));
                      const matchedCount = plTracks.filter((t) => Boolean(t.youtubeVideoId)).length;
                      const pct =
                        pl.trackIds.length > 0
                          ? Math.round((matchedCount / pl.trackIds.length) * 100)
                          : 0;
                      const ytTarget = buildPlaylistYouTubeMusicUrl(pl, plTracks);

                      return (
                        <tr key={pl.id} className="hover:bg-white/[0.03] transition-colors">
                          <td className="py-3 pl-5 pr-3 max-w-[200px]">
                            <button
                              type="button"
                              onClick={() => onOpenPlaylist(pl.id)}
                              className="font-medium text-white hover:text-[#FF4D64] transition-colors truncate block max-w-full text-left"
                            >
                              {pl.name}
                            </button>
                            <div className="text-[11px] text-[#6B7280] font-mono tabular-nums mt-0.5">
                              {pl.trackIds.length} tracks · {formatRelativeTime(pl.lastSyncedAt)}
                            </div>
                          </td>

                          <td className="py-3 px-3 w-36">
                            <div className="flex items-center justify-between font-mono tabular-nums text-[11px] text-[#A1A7B5] mb-1">
                              <span>
                                {matchedCount}/{pl.trackIds.length}
                              </span>
                              <span>{pct}%</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
                              <div
                                className="h-full bg-[#22C55E] transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </td>

                          <td className="py-3 px-3 whitespace-nowrap">
                            {pendingCount > 0 ? (
                              <span className="font-mono tabular-nums text-[#F59E0B]">
                                {pendingCount} pending
                              </span>
                            ) : pl.lastSyncedAt ? (
                              <span className="text-[#22C55E]">In sync</span>
                            ) : (
                              <span className="text-[#717786]">Not synced</span>
                            )}
                          </td>

                          <td className="py-3 pl-3 pr-5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-3">
                              {pendingCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => onApplySync(pl.id)}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-[#FDE68A] hover:text-white transition-colors"
                                >
                                  <RefreshCw className="h-3 w-3" />
                                  <span>Sync</span>
                                </button>
                              )}
                              <a
                                href={ytTarget.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors"
                                title="Open in YouTube Music"
                              >
                                <span>YT Music</span>
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Right (5 cols): Match Breakdown, Audio Formats & Watched Folder */}
          <section className="lg:col-span-5 rounded-lg border border-white/[0.08] bg-[#12141A] p-5 flex flex-col justify-between gap-6">
            {/* Match Distribution */}
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-white">
                  Track Match Breakdown
                </h2>
                <button
                  type="button"
                  onClick={() => onOpenScanner('all', { genre: activeGenre })}
                  className="text-xs text-[#8B92A2] hover:text-white transition-colors"
                >
                  Inspect catalog
                </button>
              </div>

              {/* Stacked Progress Track */}
              <div className="h-2 w-full rounded-full bg-white/[0.07] overflow-hidden flex">
                {metrics.totalTracks > 0 && (
                  <>
                    <div
                      className="h-full bg-[#22C55E]"
                      style={{ width: `${(metrics.matched / metrics.totalTracks) * 100}%` }}
                    />
                    <div
                      className="h-full bg-[#F59E0B]"
                      style={{ width: `${(metrics.unmatched / metrics.totalTracks) * 100}%` }}
                    />
                    <div
                      className="h-full bg-[#6B7280]"
                      style={{ width: `${(metrics.skipped / metrics.totalTracks) * 100}%` }}
                    />
                  </>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => onOpenScanner('matched', { genre: activeGenre })}
                  className="text-left group"
                >
                  <div className="text-[11px] text-[#8B92A2] group-hover:text-white transition-colors">
                    Matched
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-medium tabular-nums text-[#22C55E]">
                    {metrics.matched}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenScanner('unmatched', { genre: activeGenre })}
                  className="text-left group"
                >
                  <div className="text-[11px] text-[#8B92A2] group-hover:text-white transition-colors">
                    Unmatched
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-medium tabular-nums text-[#F59E0B]">
                    {metrics.unmatched}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onOpenScanner('missing', {
                      genre: activeGenre,
                      openCleanup: metrics.missing > 0,
                    })
                  }
                  className="text-left group"
                  title={
                    metrics.missing > 0
                      ? 'Open Library Cleanup to remove missing files'
                      : 'View missing files'
                  }
                >
                  <div className="text-[11px] text-[#8B92A2] group-hover:text-white transition-colors">
                    {metrics.missing > 0 ? 'Missing · Clean up' : 'Missing'}
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-medium tabular-nums text-[#EF4444]">
                    {metrics.missing}
                  </div>
                </button>
              </div>
            </div>

            {/* Audio Format Distribution */}
            <div className="pt-5 border-t border-white/[0.07] space-y-3">
              <div className="text-xs font-medium text-[#D1D5DB]">Audio Formats on Device</div>
              {metrics.formats.length === 0 ? (
                <p className="text-xs text-[#6B7280]">
                  Scan local audio files to see format and storage breakdown.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {metrics.formats.map((item) => {
                    const widthPct = Math.max(
                      4,
                      Math.round((item.count / Math.max(1, metrics.totalTracks)) * 100)
                    );
                    return (
                      <div key={item.format} className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                          <span className="text-[#E5E7EB]">{item.format}</span>
                          <span className="text-[#8B92A2]">
                            {item.count} files · {formatFileSize(item.size)}
                          </span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className="h-full bg-[#FF1F3D]/80"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Mounted Folder Watch Status */}
            <div className="pt-5 border-t border-white/[0.07] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-[#D1D5DB] truncate">
                  {watchedFolder ? watchedFolder.name : 'No folder mounted'}
                </div>
                <div className="mt-0.5 text-[11px] text-[#717786] font-mono tabular-nums truncate">
                  {watchedFolder
                    ? `${cadenceLabel} · Scanned ${formatRelativeTime(watchedFolder.lastScannedAt)}`
                    : 'Mount a folder for periodic auto-watch'}
                </div>
              </div>
              <button
                type="button"
                onClick={watchedFolder?.hasLiveHandle ? onRescanFolder : onMountFolder}
                disabled={isScanning}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-[#E5E7EB] bg-[#1A1D24] border border-white/[0.09] hover:bg-[#232732] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                {watchedFolder?.hasLiveHandle ? 'Re-scan' : 'Mount'}
              </button>
            </div>
          </section>
        </div>

        {/* Bottom 2-Column Row: Top Local Artists + Recent Sync History */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left (6 cols): Top Artists in Device Storage */}
          <section className="lg:col-span-6 rounded-lg border border-white/[0.08] bg-[#12141A] overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-white">
                Top Artists on Device
              </h2>
              <button
                type="button"
                onClick={() => onOpenScanner('all')}
                className="text-xs text-[#8B92A2] hover:text-white transition-colors"
              >
                View all
              </button>
            </div>

            {metrics.topArtists.length === 0 ? (
              <div className="p-6 text-xs text-[#6B7280]">
                Artists extracted from your local ID3 and FLAC metadata will appear here.
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05] text-xs">
                {metrics.topArtists.map((entry, idx) => (
                  <div
                    key={entry.artist}
                    className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono tabular-nums text-[#6B7280] w-5 shrink-0">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span className="font-medium text-white truncate">{entry.artist}</span>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className="font-mono tabular-nums text-[#8B92A2]">
                        {entry.count} tracks · {formatTotalRuntime(entry.duration)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onCreatePlaylistFromTracks(entry.trackIds)}
                        className="text-[#A1A7B5] hover:text-[#FF4D64] transition-colors whitespace-nowrap"
                      >
                        Playlist
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Right (6 cols): Recent Sync Activity */}
          <section className="lg:col-span-6 rounded-lg border border-white/[0.08] bg-[#12141A] overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-[#717786]" />
                <h2 className="font-display text-base font-semibold text-white">
                  Recent Sync Checkpoints
                </h2>
              </div>
              <button
                type="button"
                onClick={onOpenSyncQueue}
                className="text-xs text-[#8B92A2] hover:text-white transition-colors"
              >
                Open Sync Queue
              </button>
            </div>

            {syncHistory.length === 0 ? (
              <div className="p-6 flex items-start gap-3 text-xs text-[#8B92A2]">
                <FolderSync className="h-4 w-4 text-[#525866] shrink-0 mt-0.5" />
                <div>
                  <div className="text-[#D1D5DB] font-medium">No sync activity yet</div>
                  <p className="mt-1 text-[#6B7280] leading-relaxed">
                    When you apply playlist diffs from the Sync Queue, timestamped checkpoints will
                    be recorded here.
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05] text-xs">
                {syncHistory.slice(0, 6).map((evt) => (
                  <div
                    key={evt.id}
                    className="px-5 py-3 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">{evt.playlistName}</div>
                        <div className="font-mono tabular-nums text-[11px] text-[#717786]">
                          +{evt.addedCount} added · -{evt.removedCount} removed · {evt.matchedCount}
                          /{evt.totalTracks} matched
                        </div>
                      </div>
                    </div>
                    <span className="font-mono tabular-nums text-[#6B7280] whitespace-nowrap shrink-0">
                      {formatRelativeTime(evt.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
