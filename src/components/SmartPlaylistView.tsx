import { useMemo, useState } from 'react';
import {
  Copy,
  Disc3,
  ExternalLink,
  FolderPlus,
  Pause,
  Pencil,
  Play,
  Search,
  Shuffle,
  SlidersHorizontal,
  Tag,
  Trash2,
} from 'lucide-react';
import type { ShuffleMode } from '../hooks/useAudioPlayer';
import type { LocalTrack, SmartPlaylist, TrackPlayStats } from '../types/music';
import { computeTrackStatistics, inferTrackGenre } from '../utils/genreInference';
import { SMART_SORT_OPTIONS, summarizeSmartRule } from '../utils/smartPlaylists';
import {
  buildInstantQueueBatches,
  buildTrackYouTubeMusicUrl,
  formatDuration,
  formatRelativeTime,
} from '../utils/youtubeLinks';
import { SmartPlaylistGenreBreakdown } from './SmartPlaylistGenreBreakdown';

interface SmartPlaylistViewProps {
  smartPlaylist: SmartPlaylist;
  tracks: LocalTrack[];
  playStats: Record<string, TrackPlayStats>;
  activePlayingTrackId: string | null;
  isAudioPlaying: boolean;
  shuffleMode: ShuffleMode;
  hasPlayableFile: (fileKey: string) => boolean;
  onEditRules: (smartPlaylist: SmartPlaylist) => void;
  onDuplicate: (smartPlaylistId: string) => void;
  onConvertToStaticPlaylist: (smartPlaylist: SmartPlaylist, tracks: LocalTrack[]) => void;
  onRequestDelete: (smartPlaylist: SmartPlaylist) => void;
  onPlayTrack: (trackId: string, queueIds?: string[]) => void;
  onPlayList: (trackIds: string[], options?: { shuffle?: boolean | ShuffleMode }) => void;
  onInspectTrack: (trackId: string) => void;
  onOpenBatchTagEditor: (trackIds: string[], contextLabel: string) => void;
}

export function SmartPlaylistView({
  smartPlaylist,
  tracks,
  playStats,
  activePlayingTrackId,
  isAudioPlaying,
  shuffleMode,
  hasPlayableFile,
  onEditRules,
  onDuplicate,
  onConvertToStaticPlaylist,
  onRequestDelete,
  onPlayTrack,
  onPlayList,
  onInspectTrack,
  onOpenBatchTagEditor,
}: SmartPlaylistViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenreFilter, setSelectedGenreFilter] = useState<string | null>(null);

  const trackGenreMap = useMemo(
    () => computeTrackStatistics(tracks).trackGenreMap,
    [tracks]
  );

  const searchFilteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) => {
      const resolvedGenre = (trackGenreMap.get(t.id)?.genre ?? inferTrackGenre(t).genre).toLowerCase();
      return (
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q) ||
        resolvedGenre.includes(q) ||
        t.format.toLowerCase().includes(q)
      );
    });
  }, [tracks, searchQuery, trackGenreMap]);

  const effectiveSelectedGenre = useMemo(() => {
    if (!selectedGenreFilter) return null;
    const exists = searchFilteredTracks.some(
      (t) => (trackGenreMap.get(t.id)?.genre ?? inferTrackGenre(t).genre) === selectedGenreFilter
    );
    return exists ? selectedGenreFilter : null;
  }, [selectedGenreFilter, searchFilteredTracks, trackGenreMap]);

  const filteredTracks = useMemo(() => {
    if (!effectiveSelectedGenre) return searchFilteredTracks;
    return searchFilteredTracks.filter(
      (t) => (trackGenreMap.get(t.id)?.genre ?? inferTrackGenre(t).genre) === effectiveSelectedGenre
    );
  }, [searchFilteredTracks, effectiveSelectedGenre, trackGenreMap]);

  const totalDurationSec = useMemo(
    () => tracks.reduce((sum, t) => sum + (t.duration || 0), 0),
    [tracks]
  );

  const matchedVideoIds = useMemo(
    () => tracks.map((t) => t.youtubeVideoId).filter((id): id is string => Boolean(id)),
    [tracks]
  );

  const queueBatches = useMemo(
    () => buildInstantQueueBatches(matchedVideoIds),
    [matchedVideoIds]
  );
  const youtubeQueueUrl = queueBatches[0]?.url ?? null;

  const sortLabel =
    SMART_SORT_OPTIONS.find((opt) => opt.value === smartPlaylist.sortBy)?.label ??
    smartPlaylist.sortBy;

  const trackIds = useMemo(() => filteredTracks.map((t) => t.id), [filteredTracks]);

  const totalRuntimeLabel = useMemo(() => {
    const mins = Math.round(totalDurationSec / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
  }, [totalDurationSec]);

  return (
    <main className="flex-1 overflow-y-auto px-5 sm:px-8 py-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 pb-6 border-b border-white/[0.08]">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-2 text-xs text-[#FF4D64] font-medium">
              <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
              <span>Smart Playlist · Auto-updated</span>
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white truncate">
              {smartPlaylist.name}
            </h1>

            {smartPlaylist.description && (
              <p className="text-sm text-[#9CA3AF] max-w-2xl">{smartPlaylist.description}</p>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#8B92A2] font-mono tabular-nums pt-0.5">
              <span className="text-white font-medium">
                {tracks.length} track{tracks.length === 1 ? '' : 's'}
              </span>
              <span className="text-[#4B5563]" aria-hidden="true">
                ·
              </span>
              <span>{totalRuntimeLabel}</span>
              <span className="text-[#4B5563]" aria-hidden="true">
                ·
              </span>
              <span>{matchedVideoIds.length} YouTube matched</span>
              <span className="text-[#4B5563]" aria-hidden="true">
                ·
              </span>
              <span>Updated {formatRelativeTime(smartPlaylist.updatedAt)}</span>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={tracks.length === 0}
              onClick={() => onPlayList(tracks.map((t) => t.id), { shuffle: 'off' })}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-40 disabled:pointer-events-none transition-colors whitespace-nowrap"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>Play All</span>
            </button>

            <button
              type="button"
              disabled={tracks.length < 2}
              onClick={() => onPlayList(tracks.map((t) => t.id), { shuffle: 'smart' })}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border transition-colors whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none ${
                shuffleMode === 'smart'
                  ? 'bg-[#FF1F3D]/15 border-[#FF1F3D]/40 text-[#FF4D64]'
                  : 'bg-white/[0.05] border-white/[0.09] text-[#E5E7EB] hover:bg-white/[0.1] hover:text-white'
              }`}
            >
              <Shuffle className="h-3.5 w-3.5" />
              <span>Smart Shuffle</span>
            </button>

            <button
              type="button"
              onClick={() => onEditRules(smartPlaylist)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-white/[0.05] border border-white/[0.09] text-[#E5E7EB] hover:bg-white/[0.1] hover:text-white transition-colors whitespace-nowrap"
            >
              <Pencil className="h-3.5 w-3.5" />
              <span>Edit Rules</span>
            </button>

            {youtubeQueueUrl && (
              <a
                href={youtubeQueueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-white/[0.05] border border-white/[0.09] text-[#E5E7EB] hover:border-[#FF1F3D]/50 hover:text-white transition-colors whitespace-nowrap"
              >
                <span>Open in YouTube</span>
                <ExternalLink className="h-3.5 w-3.5 text-[#FF4D64]" />
              </a>
            )}

            <button
              type="button"
              disabled={tracks.length === 0}
              onClick={() => onConvertToStaticPlaylist(smartPlaylist, tracks)}
              title="Save current matched tracks as a standard editable playlist"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-[#D1D5DB] hover:bg-white/[0.09] hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-colors whitespace-nowrap"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              <span>Save Snapshot</span>
            </button>

            <button
              type="button"
              onClick={() => onDuplicate(smartPlaylist.id)}
              title="Duplicate this smart playlist"
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-[#D1D5DB] hover:bg-white/[0.09] hover:text-white transition-colors whitespace-nowrap"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Duplicate</span>
            </button>

            <button
              type="button"
              onClick={() => onRequestDelete(smartPlaylist)}
              title="Delete smart playlist"
              className="p-2 rounded-md text-[#8B92A2] hover:text-[#EF4444] hover:bg-[#EF4444]/10 border border-transparent hover:border-[#EF4444]/25 transition-colors"
              aria-label={`Delete ${smartPlaylist.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>

        {/* Active Rule Summary Strip */}
        <section className="rounded-lg bg-[#12141A] border border-white/[0.08] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-[#D1D5DB]">
            <span className="font-mono uppercase text-[11px] tracking-wider text-[#8B92A2]">
              Match {smartPlaylist.matchMode === 'all' ? 'ALL' : 'ANY'}:
            </span>
            {smartPlaylist.rules.length === 0 ? (
              <span className="text-[#9CA3AF]">All library tracks</span>
            ) : (
              smartPlaylist.rules.map((rule, idx) => (
                <span key={rule.id} className="inline-flex items-center gap-2">
                  {idx > 0 && (
                    <span className="text-[10px] font-mono uppercase text-[#6B7280]">
                      {smartPlaylist.matchMode === 'all' ? 'AND' : 'OR'}
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded bg-white/[0.05] border border-white/[0.07] text-[#E5E7EB]">
                    {summarizeSmartRule(rule)}
                  </span>
                </span>
              ))
            )}
          </div>

          <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums text-[#8B92A2] shrink-0">
            <span>
              Sort: {sortLabel} ({smartPlaylist.sortDir === 'desc' ? 'Desc' : 'Asc'})
            </span>
            {smartPlaylist.excludeMissing && <span>· Available only</span>}
          </div>
        </section>

        {/* Multi-Batch Instant YouTube Queue Strip (when > 50 matched tracks) */}
        {queueBatches.length > 1 && (
          <section className="rounded-lg bg-[#12141A] border border-white/[0.08] px-4 py-3 flex flex-wrap items-center gap-3 text-xs">
            <span className="text-[#8B92A2]">
              YouTube queue batches (all {matchedVideoIds.length} matched tracks):
            </span>
            {queueBatches.map((batch) => (
              <a
                key={batch.label}
                href={batch.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[#E5E7EB] hover:text-[#FF4D64] underline underline-offset-2 whitespace-nowrap"
              >
                <span>{batch.label}</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </section>
        )}

        {/* Genre Breakdown Pie Chart (Recharts) for current smart playlist's filtered tracks */}
        {searchFilteredTracks.length > 0 && (
          <SmartPlaylistGenreBreakdown
            tracks={searchFilteredTracks}
            selectedGenre={effectiveSelectedGenre}
            onSelectGenre={setSelectedGenreFilter}
            onPlayList={onPlayList}
          />
        )}

        {/* Search & Batch Actions Bar */}
        {tracks.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="h-3.5 w-3.5 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter matched tracks..."
                className="w-full pl-9 pr-3 py-2 rounded-md bg-[#12141A] border border-white/[0.08] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenBatchTagEditor(trackIds, smartPlaylist.name)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-[#D1D5DB] hover:bg-white/[0.09] hover:text-white transition-colors whitespace-nowrap"
              >
                <Tag className="h-3.5 w-3.5" />
                <span>Batch Edit Tags ({filteredTracks.length})</span>
              </button>
            </div>
          </div>
        )}

        {/* Track Table or Empty State */}
        {filteredTracks.length === 0 ? (
          <div className="rounded-lg bg-[#12141A] border border-white/[0.08] px-6 py-14 text-center space-y-3">
            <SlidersHorizontal className="h-7 w-7 text-[#6B7280] mx-auto" />
            <div className="text-sm font-medium text-white">
              {tracks.length === 0
                ? 'No tracks currently match these smart rules'
                : 'No tracks match your filter'}
            </div>
            <p className="text-xs text-[#8B92A2] max-w-md mx-auto">
              {tracks.length === 0
                ? 'Adjust the criteria or match mode to broaden this smart playlist, or scan additional folders.'
                : 'Try clearing the search query above.'}
            </p>
            <div className="pt-1">
              {tracks.length === 0 ? (
                <button
                  type="button"
                  onClick={() => onEditRules(smartPlaylist)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>Edit Rules</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="px-3.5 py-2 rounded-md text-xs font-medium text-white bg-white/[0.08] hover:bg-white/[0.14] transition-colors"
                >
                  Clear Filter
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-[#12141A] border border-white/[0.08] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.07] text-[11px] font-medium uppercase tracking-wider text-[#717786]">
                    <th className="py-3 pl-4 pr-2 w-12">#</th>
                    <th className="py-3 px-3">Track</th>
                    <th className="py-3 px-3 hidden md:table-cell">Genre</th>
                    <th className="py-3 px-3 hidden lg:table-cell">Format</th>
                    <th className="py-3 px-3 text-right hidden sm:table-cell">Plays</th>
                    <th className="py-3 px-3 text-right">Duration</th>
                    <th className="py-3 pl-2 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {filteredTracks.map((track, idx) => {
                    const isActive = activePlayingTrackId === track.id;
                    const isPlayingRow = isActive && isAudioPlaying;
                    const genre = trackGenreMap.get(track.id)?.genre ?? inferTrackGenre(track).genre;
                    const plays = playStats[track.id]?.playCount ?? track.playCount ?? 0;
                    const playable = hasPlayableFile(track.fileKey) || Boolean(track.youtubeVideoId);

                    return (
                      <tr
                        key={track.id}
                        className={`group transition-colors ${
                          isActive ? 'bg-[#FF1F3D]/[0.07]' : 'hover:bg-white/[0.03]'
                        }`}
                      >
                        <td className="py-2.5 pl-4 pr-2">
                          <button
                            type="button"
                            onClick={() => onPlayTrack(track.id, trackIds)}
                            aria-label={
                              isPlayingRow ? `Pause ${track.title}` : `Play ${track.title}`
                            }
                            className={`h-7 w-7 rounded flex items-center justify-center transition-colors ${
                              isActive
                                ? 'text-[#FF4D64] bg-[#FF1F3D]/15'
                                : playable
                                  ? 'text-[#8B92A2] hover:text-white hover:bg-white/[0.08]'
                                  : 'text-[#4B5563]'
                            }`}
                          >
                            {isPlayingRow ? (
                              <Pause className="h-3.5 w-3.5 fill-current" />
                            ) : (
                              <>
                                <span className="font-mono text-xs tabular-nums group-hover:hidden">
                                  {idx + 1}
                                </span>
                                <Play className="h-3.5 w-3.5 fill-current hidden group-hover:block" />
                              </>
                            )}
                          </button>
                        </td>

                        <td className="py-2.5 px-3 max-w-[300px]">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-9 w-9 rounded bg-[#1A1D25] border border-white/[0.07] overflow-hidden flex items-center justify-center shrink-0">
                              {track.coverArtUrl ? (
                                <img
                                  src={track.coverArtUrl}
                                  alt={`${track.title} cover`}
                                  referrerPolicy="no-referrer"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <Disc3 className="h-4 w-4 text-[#5A6070]" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div
                                className={`text-[13px] font-medium truncate ${
                                  isActive ? 'text-[#FF4D64]' : 'text-white'
                                }`}
                              >
                                {track.title}
                              </div>
                              <div className="text-xs text-[#8B92A2] truncate">
                                {track.artist}
                                {track.album !== 'Unknown Album' && (
                                  <>
                                    <span className="mx-1 text-[#4B5563]" aria-hidden="true">
                                      ·
                                    </span>
                                    <span>{track.album}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-2.5 px-3 hidden md:table-cell text-xs text-[#9CA3AF] whitespace-nowrap">
                          {genre}
                        </td>

                        <td className="py-2.5 px-3 hidden lg:table-cell font-mono text-xs text-[#8B92A2] whitespace-nowrap">
                          {track.format}
                          {track.youtubeVideoId && (
                            <span className="ml-2 text-[#22C55E]">· YT</span>
                          )}
                        </td>

                        <td className="py-2.5 px-3 text-right hidden sm:table-cell font-mono text-xs tabular-nums text-[#9CA3AF]">
                          {plays > 0 ? plays : '—'}
                        </td>

                        <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-[#8B92A2] whitespace-nowrap">
                          {formatDuration(track.duration)}
                        </td>

                        <td className="py-2.5 pl-2 pr-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onInspectTrack(track.id)}
                              className="px-2 py-1 rounded text-[11px] font-medium text-[#9CA3AF] hover:text-white hover:bg-white/[0.06] transition-colors"
                            >
                              {track.youtubeVideoId ? 'Details' : 'Match YT'}
                            </button>
                            <a
                              href={buildTrackYouTubeMusicUrl(track)}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open ${track.title} in YouTube Music`}
                              title="Open in YouTube Music"
                              className="p-1.5 rounded text-[#8B92A2] hover:text-[#FF4D64] hover:bg-white/[0.06] transition-colors"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
