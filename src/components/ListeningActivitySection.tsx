import { useMemo } from 'react';
import {
  Clock,
  Disc3,
  Flame,
  ListPlus,
  Pause,
  Play,
  SkipForward,
  Trash2,
} from 'lucide-react';
import type { LocalTrack, PlayHistoryEntry, TrackPlayStats } from '../types/music';
import { formatDuration, formatRelativeTime } from '../utils/youtubeLinks';

interface ListeningActivitySectionProps {
  tracks: LocalTrack[];
  trackMap: Map<string, LocalTrack>;
  activeGenre: string;
  playStats: Record<string, TrackPlayStats>;
  playHistory: PlayHistoryEntry[];
  activePlayingTrackId: string | null;
  isAudioPlaying: boolean;
  onPlayTrack: (trackId: string, queueIds: string[]) => void;
  onPlayList: (trackIds: string[], options?: { shuffle?: boolean }) => void;
  onCreatePlaylistFromTracks: (trackIds: string[]) => void;
  onInspectTrack: (trackId: string) => void;
  onClearPlayHistory: () => void;
}

interface RankedTrack {
  track: LocalTrack;
  playCount: number;
  completedCount: number;
  skipCount: number;
  lastPlayedAt: number | null;
}

export function ListeningActivitySection({
  tracks,
  trackMap,
  activeGenre,
  playStats,
  playHistory,
  activePlayingTrackId,
  isAudioPlaying,
  onPlayTrack,
  onPlayList,
  onCreatePlaylistFromTracks,
  onInspectTrack,
  onClearPlayHistory,
}: ListeningActivitySectionProps) {
  const mostPlayed = useMemo<RankedTrack[]>(() => {
    const ranked: RankedTrack[] = [];
    for (const track of tracks) {
      const stats = playStats[track.id];
      const playCount = stats?.playCount ?? track.playCount ?? 0;
      if (playCount <= 0) continue;
      ranked.push({
        track,
        playCount,
        completedCount: stats?.completedCount ?? Math.max(0, playCount - (track.skipCount ?? 0)),
        skipCount: stats?.skipCount ?? track.skipCount ?? 0,
        lastPlayedAt: stats?.lastPlayedAt ?? track.lastPlayedAt ?? null,
      });
    }

    return ranked
      .sort((a, b) => {
        if (b.playCount !== a.playCount) return b.playCount - a.playCount;
        if (b.completedCount !== a.completedCount) return b.completedCount - a.completedCount;
        return (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0);
      })
      .slice(0, 8);
  }, [tracks, playStats]);

  const maxPlayCount = mostPlayed[0]?.playCount ?? 1;
  const mostPlayedIds = useMemo(() => mostPlayed.map((item) => item.track.id), [mostPlayed]);

  const totalScopedPlays = useMemo(() => {
    let sum = 0;
    for (const track of tracks) {
      sum += playStats[track.id]?.playCount ?? track.playCount ?? 0;
    }
    return sum;
  }, [tracks, playStats]);

  const visibleHistory = useMemo(() => {
    if (activeGenre === 'all') return playHistory.slice(0, 12);
    const scopedIdSet = new Set(tracks.map((t) => t.id));
    return playHistory.filter((entry) => scopedIdSet.has(entry.trackId)).slice(0, 12);
  }, [playHistory, activeGenre, tracks]);

  const historyQueueIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const entry of visibleHistory) {
      if (trackMap.has(entry.trackId) && !seen.has(entry.trackId)) {
        seen.add(entry.trackId);
        ids.push(entry.trackId);
      }
    }
    return ids;
  }, [visibleHistory, trackMap]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
      {/* Left (6 cols): Most Frequently Played Songs */}
      <section
        aria-label="Most Played Songs"
        className="lg:col-span-6 rounded-lg border border-white/[0.08] bg-[#12141A] overflow-hidden flex flex-col"
      >
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-[#FF4D64] shrink-0" />
              <h2 className="font-display text-base font-semibold text-white truncate">
                {activeGenre === 'all' ? 'Most Played Songs' : `Most Played · ${activeGenre}`}
              </h2>
            </div>
            <p className="text-xs text-[#717786] mt-0.5 font-mono tabular-nums">
              {mostPlayed.length > 0
                ? `${totalScopedPlays} total play${totalScopedPlays === 1 ? '' : 's'} tracked across ${mostPlayed.length} top track${mostPlayed.length === 1 ? '' : 's'}`
                : 'Updated automatically whenever a track finishes or is skipped'}
            </p>
          </div>

          {mostPlayedIds.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onPlayList(mostPlayedIds, { shuffle: false })}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#0B0C0E] bg-white hover:bg-[#E5E7EB] transition-colors whitespace-nowrap"
              >
                <Play className="h-3 w-3 fill-current" />
                <span>Play Top</span>
              </button>
              <button
                type="button"
                onClick={() => onCreatePlaylistFromTracks(mostPlayedIds)}
                title="Create playlist from most played tracks"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-[#D1D5DB] bg-[#161920] border border-white/[0.08] hover:text-white hover:bg-[#1E222B] transition-colors whitespace-nowrap"
              >
                <ListPlus className="h-3.5 w-3.5" />
                <span>Playlist</span>
              </button>
            </div>
          )}
        </div>

        {mostPlayed.length === 0 ? (
          <div className="flex-1 p-6 flex flex-col justify-center">
            <div className="text-sm font-medium text-[#E5E7EB]">No play counts recorded yet</div>
            <p className="mt-1 text-xs text-[#717786] leading-relaxed max-w-md">
              Play tracks from your library or playlists. Each completed playback or track skip
              increments play counts here and inside Device Storage.
            </p>
            {tracks.length > 0 && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() =>
                    onPlayList(
                      tracks.map((t) => t.id),
                      { shuffle: false }
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Start Listening</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05] text-xs flex-1">
            {mostPlayed.map((item, idx) => {
              const { track, playCount, completedCount, skipCount, lastPlayedAt } = item;
              const isActive = activePlayingTrackId === track.id;
              const barWidth = Math.max(8, Math.round((playCount / maxPlayCount) * 100));

              return (
                <div
                  key={track.id}
                  className="px-5 py-2.5 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="font-mono tabular-nums text-[#6B7280] w-5 shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>

                    <button
                      type="button"
                      onClick={() => onPlayTrack(track.id, mostPlayedIds)}
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

                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onInspectTrack(track.id)}
                        className={`font-medium truncate block max-w-full text-left transition-colors ${
                          isActive ? 'text-[#FF4D64]' : 'text-white hover:text-[#FF4D64]'
                        }`}
                      >
                        {track.title}
                      </button>
                      <div className="text-[11px] text-[#717786] truncate">
                        {track.artist}
                        {lastPlayedAt ? ` · ${formatRelativeTime(lastPlayedAt)}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="w-28 sm:w-32 shrink-0 text-right">
                    <div
                      className="font-mono tabular-nums text-white font-medium"
                      title={`${completedCount} finished · ${skipCount} skipped`}
                    >
                      {playCount} {playCount === 1 ? 'play' : 'plays'}
                    </div>
                    <div className="mt-1 h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className="h-full bg-[#FF1F3D]/80"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Right (6 cols): Recent Play History */}
      <section
        aria-label="Recent Play History"
        className="lg:col-span-6 rounded-lg border border-white/[0.08] bg-[#12141A] overflow-hidden flex flex-col"
      >
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-[#717786] shrink-0" />
              <h2 className="font-display text-base font-semibold text-white truncate">
                Recent Play History
              </h2>
            </div>
            <p className="text-xs text-[#717786] mt-0.5 font-mono tabular-nums">
              {visibleHistory.length > 0
                ? `${visibleHistory.length} recent session${visibleHistory.length === 1 ? '' : 's'} · finished & skipped`
                : 'Chronological log of completed and skipped tracks'}
            </p>
          </div>

          {playHistory.length > 0 && (
            <button
              type="button"
              onClick={onClearPlayHistory}
              className="inline-flex items-center gap-1 text-xs text-[#8B92A2] hover:text-[#EF4444] transition-colors whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear</span>
            </button>
          )}
        </div>

        {visibleHistory.length === 0 ? (
          <div className="flex-1 p-6 flex flex-col justify-center">
            <div className="text-sm font-medium text-[#E5E7EB]">No recent play history</div>
            <p className="mt-1 text-xs text-[#717786] leading-relaxed max-w-md">
              Tracks appear here in chronological order as soon as a song finishes playing or you
              skip to another track.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05] text-xs flex-1 max-h-[372px] overflow-y-auto">
            {visibleHistory.map((entry) => {
              const liveTrack = trackMap.get(entry.trackId);
              // Persisted history drops cover data URLs to stay under the localStorage quota
              const coverArtUrl = entry.coverArtUrl ?? liveTrack?.coverArtUrl ?? null;
              const isActive = activePlayingTrackId === entry.trackId;
              const isSkipped = entry.outcome === 'skipped';

              return (
                <div
                  key={entry.id}
                  className="px-5 py-2.5 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {liveTrack ? (
                      <button
                        type="button"
                        onClick={() => onPlayTrack(liveTrack.id, historyQueueIds)}
                        aria-label={
                          isActive && isAudioPlaying
                            ? `Pause ${entry.title}`
                            : `Replay ${entry.title}`
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
                    ) : (
                      <div className="h-7 w-7 rounded flex items-center justify-center shrink-0 text-[#4B5563]">
                        <Disc3 className="h-3.5 w-3.5" />
                      </div>
                    )}

                    <div className="h-8 w-8 rounded bg-[#181B22] border border-white/[0.06] overflow-hidden flex items-center justify-center shrink-0">
                      {coverArtUrl ? (
                        <img
                          src={coverArtUrl}
                          alt={`${entry.title} cover`}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Disc3 className="h-3.5 w-3.5 text-[#525866]" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-white truncate">{entry.title}</div>
                      <div className="text-[11px] text-[#717786] truncate flex items-center gap-1.5">
                        <span className="truncate">{entry.artist}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`inline-flex items-center gap-1 shrink-0 ${
                            isSkipped ? 'text-[#F59E0B]' : 'text-[#22C55E]'
                          }`}
                        >
                          {isSkipped && <SkipForward className="h-3 w-3" />}
                          <span>{isSkipped ? 'Skipped' : 'Finished'}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right font-mono tabular-nums shrink-0">
                    <div className="text-[11px] text-[#A1A7B5]">
                      {entry.duration > 0
                        ? `${formatDuration(entry.listenedSeconds)} / ${formatDuration(entry.duration)}`
                        : entry.listenedSeconds > 0
                          ? formatDuration(entry.listenedSeconds)
                          : '—'}
                    </div>
                    <div className="text-[11px] text-[#6B7280] mt-0.5">
                      {formatRelativeTime(entry.playedAt)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
