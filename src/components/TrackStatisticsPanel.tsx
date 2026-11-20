import { BarChart3, Play, X } from 'lucide-react';
import type { TrackStatistics } from '../utils/genreInference';
import { formatDuration, formatFileSize, formatTotalRuntime } from '../utils/youtubeLinks';

interface TrackStatisticsPanelProps {
  stats: TrackStatistics;
  scopeLabel: string;
  onSelectGenre: (genre: string) => void;
  onPlayTrack: (trackId: string, queueIds: string[]) => void;
  queueIds: string[];
  onClose: () => void;
}

export function TrackStatisticsPanel({
  stats,
  scopeLabel,
  onSelectGenre,
  onPlayTrack,
  queueIds,
  onClose,
}: TrackStatisticsPanelProps) {
  const topGenres = stats.genreGroups.slice(0, 5);
  const topFormats = stats.formats.slice(0, 4);

  return (
    <section
      aria-label="Filtered track statistics"
      className="mx-5 sm:mx-6 my-4 rounded-lg border border-white/[0.1] bg-[#11141B] overflow-hidden shrink-0"
    >
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/[0.08] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 className="h-4 w-4 text-[#FF4D64] shrink-0" />
          <h2 className="font-display text-sm font-semibold text-white truncate">
            Track Statistics
          </h2>
          <span className="text-[#4B5563]" aria-hidden="true">
            ·
          </span>
          <span className="text-xs text-[#8B92A2] font-mono tabular-nums truncate">
            {scopeLabel} ({stats.totalTracks} track{stats.totalTracks === 1 ? '' : 's'})
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close track statistics"
          className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Primary Quantitative Metric Strip */}
      <div className="px-5 py-3.5 border-b border-white/[0.07] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div>
          <div className="text-[11px] text-[#717786]">Average Length</div>
          <div className="mt-1 font-mono text-base font-medium tabular-nums text-white">
            {formatDuration(stats.avgDuration)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#6B7280]">
            {formatTotalRuntime(stats.totalDuration)} total
          </div>
        </div>

        <div className="sm:border-l sm:border-white/[0.07] sm:pl-4">
          <div className="text-[11px] text-[#717786]">Est. Avg Bitrate</div>
          <div className="mt-1 font-mono text-base font-medium tabular-nums text-white">
            {stats.avgBitrateKbps ? `${stats.avgBitrateKbps} kbps` : '—'}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#6B7280]">
            {stats.losslessPct}% lossless ({stats.losslessCount})
          </div>
        </div>

        <div className="sm:border-l sm:border-white/[0.07] sm:pl-4">
          <div className="text-[11px] text-[#717786]">Storage Footprint</div>
          <div className="mt-1 font-mono text-base font-medium tabular-nums text-white">
            {formatFileSize(stats.totalSize)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#6B7280]">
            {formatFileSize(stats.avgSize)} avg
          </div>
        </div>

        <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
          <div className="text-[11px] text-[#717786]">Catalog Diversity</div>
          <div className="mt-1 font-mono text-base font-medium tabular-nums text-white">
            {stats.uniqueArtists} artists
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#6B7280]">
            {stats.uniqueAlbums} albums · {stats.uniqueGenres} genres
          </div>
        </div>

        <div className="sm:border-l sm:border-white/[0.07] sm:pl-4">
          <div className="text-[11px] text-[#717786]">Release Span</div>
          <div className="mt-1 font-mono text-base font-medium tabular-nums text-white">
            {stats.yearRange
              ? stats.yearRange.min === stats.yearRange.max
                ? String(stats.yearRange.min)
                : `${stats.yearRange.min}–${stats.yearRange.max}`
              : '—'}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#6B7280]">
            {stats.withYearCount}/{stats.totalTracks} year tags
          </div>
        </div>

        <div className="sm:border-l sm:border-white/[0.07] sm:pl-4">
          <div className="text-[11px] text-[#717786]">Metadata Coverage</div>
          <div className="mt-1 font-mono text-base font-medium tabular-nums text-[#22C55E]">
            {stats.matchRatePct}% matched
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#6B7280]">
            {stats.withCoverArtCount} artwork · {stats.withEmbeddedGenreCount} tagged
          </div>
        </div>
      </div>

      {/* 3-Column Analytical Breakdown: Genres, Duration Distribution, Extremes & Formats */}
      <div className="px-5 py-4 grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
        {/* Inferred Genre Breakdown */}
        <div className="space-y-2">
          <div className="text-[11px] font-medium text-[#9CA3AF]">Top Inferred Genres</div>
          {topGenres.length === 0 ? (
            <div className="text-[#6B7280]">No tracks in current filter.</div>
          ) : (
            <div className="space-y-2">
              {topGenres.map((group) => (
                <button
                  key={group.genre}
                  type="button"
                  onClick={() => onSelectGenre(group.genre)}
                  className="w-full text-left group space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#E5E7EB] group-hover:text-[#FF4D64] transition-colors truncate">
                      {group.genre}
                    </span>
                    <span className="font-mono tabular-nums text-[#8B92A2] shrink-0">
                      {group.count} ({group.sharePct}%)
                    </span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full bg-[#FF1F3D]/80"
                      style={{ width: `${Math.max(4, group.sharePct)}%` }}
                    />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Duration Distribution */}
        <div className="space-y-2 lg:border-l lg:border-white/[0.07] lg:pl-6">
          <div className="text-[11px] font-medium text-[#9CA3AF]">Track Length Distribution</div>
          <div className="space-y-2">
            {stats.durationBuckets.map((bucket) => (
              <div key={bucket.label} className="space-y-1">
                <div className="flex items-center justify-between font-mono tabular-nums">
                  <span className="text-[#D1D5DB]">{bucket.label}</span>
                  <span className="text-[#8B92A2]">
                    {bucket.count} · {bucket.pct}%
                  </span>
                </div>
                <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full bg-[#E5E7EB]/75"
                    style={{ width: `${bucket.count > 0 ? Math.max(4, bucket.pct) : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Track Extremes & Format Mix */}
        <div className="space-y-3 lg:border-l lg:border-white/[0.07] lg:pl-6">
          <div className="text-[11px] font-medium text-[#9CA3AF]">Notable Tracks &amp; Codecs</div>
          <div className="space-y-2">
            {stats.longestTrack && (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onPlayTrack(stats.longestTrack!.id, queueIds)}
                    aria-label={`Play longest track ${stats.longestTrack.title}`}
                    className="p-1 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.07] shrink-0"
                  >
                    <Play className="h-3 w-3 fill-current" />
                  </button>
                  <span className="text-[#717786] shrink-0">Longest:</span>
                  <span className="text-white truncate">{stats.longestTrack.title}</span>
                </div>
                <span className="font-mono tabular-nums text-[#A1A7B5] shrink-0">
                  {formatDuration(stats.longestTrack.duration)}
                </span>
              </div>
            )}

            {stats.shortestTrack && stats.shortestTrack.id !== stats.longestTrack?.id && (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onPlayTrack(stats.shortestTrack!.id, queueIds)}
                    aria-label={`Play shortest track ${stats.shortestTrack.title}`}
                    className="p-1 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.07] shrink-0"
                  >
                    <Play className="h-3 w-3 fill-current" />
                  </button>
                  <span className="text-[#717786] shrink-0">Shortest:</span>
                  <span className="text-white truncate">{stats.shortestTrack.title}</span>
                </div>
                <span className="font-mono tabular-nums text-[#A1A7B5] shrink-0">
                  {formatDuration(stats.shortestTrack.duration)}
                </span>
              </div>
            )}
          </div>

          {topFormats.length > 0 && (
            <div className="pt-2 border-t border-white/[0.06] flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-[#8B92A2]">
              {topFormats.map((fmt) => (
                <span key={fmt.format}>
                  <span className="text-[#D1D5DB]">{fmt.format}</span> {fmt.count} ({fmt.pct}%)
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
