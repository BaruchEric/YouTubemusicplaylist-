import { useMemo, useState } from 'react';
import {
  Check,
  Disc3,
  FolderOpen,
  ListPlus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type { LocalTrack, Playlist } from '../types/music';
import { generateTrackRecommendations } from '../utils/recommendations';
import { formatDuration } from '../utils/youtubeLinks';

interface RecommendedForYouProps {
  tracks: LocalTrack[];
  playlists: Playlist[];
  trackMap: Map<string, LocalTrack>;
  activeGenre: string;
  activePlayingTrackId: string | null;
  isAudioPlaying: boolean;
  onAddTracksToPlaylist: (playlistId: string, trackIds: string[]) => void;
  onCreatePlaylistFromTracks: (trackIds: string[]) => void;
  onPlayTrack: (trackId: string, queueIds: string[]) => void;
  onInspectTrack: (trackId: string) => void;
  onOpenPlaylist: (playlistId: string) => void;
  onMountFolder: () => void;
  onPickFilesFallback: () => void;
}

export function RecommendedForYou({
  tracks,
  playlists,
  trackMap,
  activeGenre,
  activePlayingTrackId,
  isAudioPlaying,
  onAddTracksToPlaylist,
  onCreatePlaylistFromTracks,
  onPlayTrack,
  onInspectTrack,
  onOpenPlaylist,
  onMountFolder,
  onPickFilesFallback,
}: RecommendedForYouProps) {
  const [selectedTarget, setSelectedTarget] = useState<string>('auto');
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const [rotationOffset, setRotationOffset] = useState(0);
  const [recentlyAddedIds, setRecentlyAddedIds] = useState<Set<string>>(() => new Set());

  // Keep target playlist valid if playlists are deleted
  const effectiveTarget = useMemo(() => {
    if (selectedTarget === 'auto') return 'auto';
    return playlists.some((p) => p.id === selectedTarget) ? selectedTarget : 'auto';
  }, [selectedTarget, playlists]);

  const targetPlaylistObj = useMemo(
    () =>
      effectiveTarget === 'auto'
        ? null
        : playlists.find((p) => p.id === effectiveTarget) ?? null,
    [effectiveTarget, playlists]
  );

  const summary = useMemo(
    () =>
      generateTrackRecommendations({
        tracks,
        playlists,
        trackMap,
        targetPlaylistId: effectiveTarget,
        activeGenre,
        dismissedIds,
        rotationOffset,
        limit: 6,
      }),
    [tracks, playlists, trackMap, effectiveTarget, activeGenre, dismissedIds, rotationOffset]
  );

  const queueIds = useMemo(
    () => summary.recommendations.map((r) => r.track.id),
    [summary.recommendations]
  );

  const handleAddSingle = (playlistId: string | null, trackId: string) => {
    if (!playlistId) {
      onCreatePlaylistFromTracks([trackId]);
      return;
    }
    onAddTracksToPlaylist(playlistId, [trackId]);
    setRecentlyAddedIds((prev) => {
      const next = new Set(prev);
      next.add(trackId);
      return next;
    });
  };

  const handleAddAllVisible = () => {
    if (summary.recommendations.length === 0) return;

    if (targetPlaylistObj) {
      onAddTracksToPlaylist(
        targetPlaylistObj.id,
        summary.recommendations.map((r) => r.track.id)
      );
      return;
    }

    if (playlists.length === 0) {
      onCreatePlaylistFromTracks(summary.recommendations.map((r) => r.track.id));
      return;
    }

    // In 'auto' mode, group recommendations by their best-fit playlist and add each batch
    const byPlaylist = new Map<string, string[]>();
    for (const rec of summary.recommendations) {
      if (!rec.targetPlaylist) continue;
      const list = byPlaylist.get(rec.targetPlaylist.id) ?? [];
      list.push(rec.track.id);
      byPlaylist.set(rec.targetPlaylist.id, list);
    }
    for (const [plId, ids] of byPlaylist.entries()) {
      onAddTracksToPlaylist(plId, ids);
    }
  };

  const handleDismiss = (trackId: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(trackId);
      return next;
    });
  };

  const profileSubtitle = useMemo(() => {
    if (tracks.length === 0) {
      return 'Personalized playlist additions based on the music genres in your library';
    }
    const topGenres = summary.topProfileGenres
      .filter((g) => g.genre !== 'Unclassified')
      .slice(0, 3)
      .map((g) => `${g.genre} ${Math.round(g.share * 100)}%`);

    if (topGenres.length === 0) {
      return 'Suggesting unadded tracks from your local library for your playlists';
    }
    const prefix = targetPlaylistObj ? `${targetPlaylistObj.name} profile` : 'Library genre profile';
    return `${prefix}: ${topGenres.join(' · ')}`;
  }, [tracks.length, summary.topProfileGenres, targetPlaylistObj]);

  return (
    <section
      aria-label="Recommended for You"
      className="rounded-lg border border-white/[0.08] bg-[#12141A] overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.07] flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#FF4D64] shrink-0" />
            <h2 className="font-display text-base font-semibold text-white truncate">
              Recommended for You
            </h2>
            {summary.totalCandidates > 0 && (
              <span className="text-xs font-mono tabular-nums text-[#717786] shrink-0">
                · {summary.totalCandidates} candidate{summary.totalCandidates === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <p className="text-xs text-[#717786] mt-0.5 truncate">{profileSubtitle}</p>
        </div>

        {tracks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {playlists.length > 0 && (
              <select
                value={effectiveTarget}
                onChange={(e) => {
                  setSelectedTarget(e.target.value);
                  setRotationOffset(0);
                }}
                aria-label="Target playlist for recommendations"
                className="px-2.5 py-1.5 rounded bg-[#0C0E13] border border-white/[0.08] text-xs font-medium text-[#E5E7EB] focus:outline-none focus:border-white/25 max-w-[200px] truncate"
              >
                <option value="auto">Best-fit playlist (Auto)</option>
                {playlists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    For: {pl.name}
                  </option>
                ))}
              </select>
            )}

            {summary.totalCandidates > summary.recommendations.length && (
              <button
                type="button"
                onClick={() => setRotationOffset((prev) => prev + 1)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#A1A7B5] bg-[#161920] border border-white/[0.08] hover:text-white hover:bg-[#1E222B] transition-colors whitespace-nowrap"
                title="Show next set of genre-matched tracks"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Refresh</span>
              </button>
            )}

            {summary.recommendations.length > 0 && (
              <button
                type="button"
                onClick={handleAddAllVisible}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
              >
                <ListPlus className="h-3.5 w-3.5" />
                <span>
                  {targetPlaylistObj
                    ? `Add ${summary.recommendations.length} to ${targetPlaylistObj.name}`
                    : playlists.length === 0
                      ? `Create Playlist (${summary.recommendations.length})`
                      : `Add All ${summary.recommendations.length}`}
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {tracks.length === 0 ? (
        <div className="p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left">
            <div className="text-sm font-medium text-[#E5E7EB]">
              Scan your local library to unlock genre-matched playlist suggestions
            </div>
            <p className="mt-1 text-xs text-[#717786] max-w-xl leading-relaxed">
              Once your audio files are indexed, CrateSync analyzes the genres in your library and
              playlists to surface tracks that fit your playlists without duplicating existing
              entries.
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onMountFolder}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>Scan Folder</span>
            </button>
            <button
              type="button"
              onClick={onPickFilesFallback}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[#D1D5DB] bg-[#1A1D24] border border-white/[0.08] hover:bg-[#232732] transition-colors whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Upload Audio</span>
            </button>
          </div>
        </div>
      ) : summary.recommendations.length === 0 ? (
        <div className="px-5 py-7 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <div>
            <div className="text-sm font-medium text-[#E5E7EB]">
              {targetPlaylistObj
                ? `All matching tracks are already in "${targetPlaylistObj.name}"`
                : 'Every eligible library track is already placed in your playlists'}
            </div>
            <p className="mt-1 text-[#717786]">
              {dismissedIds.size > 0
                ? `${dismissedIds.size} suggestion${dismissedIds.size === 1 ? '' : 's'} dismissed in this session.`
                : 'Scan more local folders or create a fresh playlist to explore new combinations.'}
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            {dismissedIds.size > 0 && (
              <button
                type="button"
                onClick={() => {
                  setDismissedIds(new Set());
                  setRotationOffset(0);
                }}
                className="px-3 py-1.5 rounded-md font-medium text-[#E5E7EB] bg-[#1A1D24] border border-white/[0.08] hover:bg-[#232732] transition-colors whitespace-nowrap"
              >
                Restore Dismissed
              </button>
            )}
            {targetPlaylistObj && (
              <button
                type="button"
                onClick={() => onOpenPlaylist(targetPlaylistObj.id)}
                className="px-3 py-1.5 rounded-md font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors whitespace-nowrap"
              >
                Open {targetPlaylistObj.name}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.05] text-xs">
          {summary.recommendations.map((rec) => {
            const { track, targetPlaylist, reason, genre } = rec;
            const isActive = activePlayingTrackId === track.id;
            const wasJustAdded = recentlyAddedIds.has(track.id);

            return (
              <div
                key={`${track.id}-${targetPlaylist?.id ?? 'new'}`}
                className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
              >
                {/* Left: Play + Cover + Track & Recommendation Reason */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onPlayTrack(track.id, queueIds)}
                    aria-label={
                      isActive && isAudioPlaying ? `Pause ${track.title}` : `Play ${track.title}`
                    }
                    className={`h-7 w-7 rounded flex items-center justify-center shrink-0 transition-colors ${
                      isActive
                        ? 'text-[#FF1F3D] bg-[#FF1F3D]/12'
                        : 'text-[#8B92A2] hover:text-white hover:bg-white/[0.07]'
                    }`}
                  >
                    {isActive && isAudioPlaying ? (
                      <Pause className="h-3.5 w-3.5 fill-current" />
                    ) : (
                      <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                    )}
                  </button>

                  <div className="h-9 w-9 rounded bg-[#181B22] border border-white/[0.07] overflow-hidden flex items-center justify-center shrink-0">
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

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => onInspectTrack(track.id)}
                        className="font-medium text-white hover:text-[#FF4D64] transition-colors truncate text-left"
                      >
                        {track.title}
                      </button>
                      <span className="text-[#4B5563] shrink-0" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-[#9CA3AF] truncate">{track.artist}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#717786]">
                      <span className="text-[#A1A7B5]">{reason}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {genre}
                        {track.duration > 0 ? ` · ${formatDuration(track.duration)}` : ''}
                        {track.youtubeVideoId ? ' · YT Matched' : ''}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: One-Click Add Action + Dismiss */}
                <div className="flex items-center justify-end gap-2 shrink-0 pl-10 sm:pl-0">
                  <button
                    type="button"
                    onClick={() => handleAddSingle(targetPlaylist?.id ?? null, track.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#E5E7EB] bg-[#1A1D24] border border-white/[0.09] hover:border-[#FF1F3D]/60 hover:text-white hover:bg-[#232732] transition-colors whitespace-nowrap"
                  >
                    {wasJustAdded ? (
                      <Check className="h-3.5 w-3.5 text-[#22C55E]" />
                    ) : (
                      <Plus className="h-3.5 w-3.5 text-[#FF4D64]" />
                    )}
                    <span className="max-w-[160px] truncate">
                      {targetPlaylist ? `Add to ${targetPlaylist.name}` : 'New Playlist'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDismiss(track.id)}
                    aria-label={`Dismiss ${track.title} recommendation`}
                    title="Dismiss suggestion"
                    className="p-1.5 rounded text-[#6B7280] hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
