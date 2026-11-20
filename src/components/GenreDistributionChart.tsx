import { useMemo, useState } from 'react';
import {
  ArrowRight,
  FolderOpen,
  Layers,
  PieChart as PieChartIcon,
  Play,
  Table2,
  Upload,
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { LocalTrack } from '../types/music';
import {
  cleanRawGenreTag,
  type GenreGroupSummary,
  type TrackStatistics,
} from '../utils/genreInference';
import { formatDuration, formatTotalRuntime } from '../utils/youtubeLinks';

const GENRE_PALETTE = [
  '#FF1F3D', // CrateSync Crimson
  '#3B82F6', // Studio Cobalt
  '#10B981', // Mastering Emerald
  '#F59E0B', // Warm Amber
  '#A855F7', // Analog Violet
  '#06B6D4', // Signal Cyan
  '#FB7185', // Coral Rose
  '#84CC16', // Acid Lime
  '#EC4899', // Magenta Tape
  '#6366F1', // Deep Indigo
];

const UNCLASSIFIED_COLOR = '#4B5563';
const OTHER_COLOR = '#64748B';

export interface GenrePieDatum {
  genre: string;
  count: number;
  sharePct: number;
  totalDuration: number;
  avgDuration: number;
  matchedCount: number;
  taggedCount: number;
  trackIds: string[];
  color: string;
  isRollup?: boolean;
  isFilterable: boolean;
}

interface GenreDistributionChartProps {
  tracks: LocalTrack[];
  allStats: TrackStatistics;
  activeGenre: string;
  onSelectGenre: (genre: string) => void;
  onOpenScanner: (
    filter?: 'all' | 'unmatched' | 'matched' | 'missing',
    options?: { genre?: string; groupByGenre?: boolean }
  ) => void;
  onPlayList: (trackIds: string[], options?: { shuffle?: boolean }) => void;
  onCreatePlaylistFromTracks: (trackIds: string[]) => void;
  onMountFolder: () => void;
  onPickFilesFallback: () => void;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: GenrePieDatum }>;
}

function GenrePieTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-md border border-white/[0.12] bg-[#0F1116]/95 px-3 py-2.5 shadow-xl text-xs">
      <div className="flex items-center gap-2 font-medium text-white">
        <span
          className="h-2.5 w-2.5 rounded-[2px] shrink-0"
          style={{ backgroundColor: item.color }}
          aria-hidden="true"
        />
        <span>{item.genre}</span>
      </div>
      <div className="mt-1.5 space-y-0.5 font-mono tabular-nums text-[11px] text-[#9CA3AF]">
        <div className="flex items-center justify-between gap-5">
          <span className="text-[#717786]">Tracks</span>
          <span className="text-white">
            {item.count} ({item.sharePct}%)
          </span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-[#717786]">Runtime</span>
          <span>{formatTotalRuntime(item.totalDuration)}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-[#717786]">Matched</span>
          <span className="text-[#22C55E]">
            {item.matchedCount}/{item.count}
          </span>
        </div>
      </div>
    </div>
  );
}

export function GenreDistributionChart({
  tracks,
  allStats,
  activeGenre,
  onSelectGenre,
  onOpenScanner,
  onPlayList,
  onCreatePlaylistFromTracks,
  onMountFolder,
  onPickFilesFallback,
}: GenreDistributionChartProps) {
  const [dataSource, setDataSource] = useState<'inferred' | 'embedded'>('inferred');
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [hoveredGenre, setHoveredGenre] = useState<string | null>(null);

  // Build strict embedded-tag distribution when user switches to "Embedded Tags"
  const embeddedGroups = useMemo<GenreGroupSummary[]>(() => {
    if (tracks.length === 0) return [];
    const buckets = new Map<
      string,
      {
        tracks: LocalTrack[];
        totalDuration: number;
        totalSize: number;
        matchedCount: number;
      }
    >();

    for (const track of tracks) {
      const cleaned = track.genre ? cleanRawGenreTag(track.genre) : '';
      const label =
        cleaned && cleaned.toLowerCase() !== 'unknown'
          ? cleaned.replace(/\b\w/g, (c) => c.toUpperCase())
          : 'Untagged';

      const entry = buckets.get(label) ?? {
        tracks: [],
        totalDuration: 0,
        totalSize: 0,
        matchedCount: 0,
      };
      entry.tracks.push(track);
      entry.totalDuration += track.duration || 0;
      entry.totalSize += track.fileSize || 0;
      if (track.youtubeVideoId) entry.matchedCount += 1;
      buckets.set(label, entry);
    }

    const total = tracks.length;
    return Array.from(buckets.entries())
      .map(([genre, data]) => ({
        genre,
        tracks: data.tracks,
        trackIds: data.tracks.map((t) => t.id),
        count: data.tracks.length,
        sharePct: total > 0 ? Math.round((data.tracks.length / total) * 100) : 0,
        totalDuration: data.totalDuration,
        avgDuration: data.tracks.length > 0 ? data.totalDuration / data.tracks.length : 0,
        totalSize: data.totalSize,
        avgBitrateKbps: null,
        matchedCount: data.matchedCount,
        taggedCount: genre === 'Untagged' ? 0 : data.tracks.length,
      }))
      .sort((a, b) => {
        if (a.genre === 'Untagged' && b.genre !== 'Untagged') return 1;
        if (b.genre === 'Untagged' && a.genre !== 'Untagged') return -1;
        return b.count - a.count || b.totalDuration - a.totalDuration;
      });
  }, [tracks]);

  const activeGroups = dataSource === 'inferred' ? allStats.genreGroups : embeddedGroups;

  const pieData = useMemo<GenrePieDatum[]>(() => {
    if (activeGroups.length === 0) return [];

    const maxDistinctSlices = 8;
    const shouldRollup = activeGroups.length > maxDistinctSlices;
    const primary = shouldRollup ? activeGroups.slice(0, maxDistinctSlices - 1) : activeGroups;
    const remainder = shouldRollup ? activeGroups.slice(maxDistinctSlices - 1) : [];

    let colorIdx = 0;
    const slices: GenrePieDatum[] = primary.map((group) => {
      const isMutedBucket = group.genre === 'Unclassified' || group.genre === 'Untagged';
      const color = isMutedBucket
        ? UNCLASSIFIED_COLOR
        : GENRE_PALETTE[colorIdx++ % GENRE_PALETTE.length];
      return {
        genre: group.genre,
        count: group.count,
        sharePct: group.sharePct,
        totalDuration: group.totalDuration,
        avgDuration: group.avgDuration,
        matchedCount: group.matchedCount,
        taggedCount: group.taggedCount,
        trackIds: group.trackIds,
        color,
        isFilterable: dataSource === 'inferred',
      };
    });

    if (remainder.length > 0) {
      const totalTracks = tracks.length;
      const count = remainder.reduce((acc, g) => acc + g.count, 0);
      const totalDuration = remainder.reduce((acc, g) => acc + g.totalDuration, 0);
      const matchedCount = remainder.reduce((acc, g) => acc + g.matchedCount, 0);
      const taggedCount = remainder.reduce((acc, g) => acc + g.taggedCount, 0);
      const trackIds = remainder.flatMap((g) => g.trackIds);

      slices.push({
        genre: `Other (${remainder.length})`,
        count,
        sharePct: totalTracks > 0 ? Math.round((count / totalTracks) * 100) : 0,
        totalDuration,
        avgDuration: count > 0 ? totalDuration / count : 0,
        matchedCount,
        taggedCount,
        trackIds,
        color: OTHER_COLOR,
        isRollup: true,
        isFilterable: false,
      });
    }

    return slices;
  }, [activeGroups, dataSource, tracks.length]);

  const highlightedSlice = useMemo(() => {
    if (hoveredGenre) {
      return pieData.find((d) => d.genre === hoveredGenre) ?? null;
    }
    if (dataSource === 'inferred' && activeGenre !== 'all') {
      return pieData.find((d) => d.genre === activeGenre) ?? null;
    }
    return null;
  }, [hoveredGenre, activeGenre, dataSource, pieData]);

  const handleSliceInteraction = (datum: GenrePieDatum) => {
    if (!datum.isFilterable) return;
    onSelectGenre(activeGenre === datum.genre ? 'all' : datum.genre);
  };

  return (
    <section
      aria-label="Genre Distribution"
      className="lg:col-span-7 rounded-lg border border-white/[0.08] bg-[#12141A] flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <PieChartIcon className="h-4 w-4 text-[#FF4D64] shrink-0" />
            <h2 className="font-display text-base font-semibold text-white truncate">
              Genre Distribution
            </h2>
          </div>
          <p className="text-xs text-[#717786] mt-0.5 font-mono tabular-nums">
            {tracks.length === 0
              ? 'Distribution of your music library by track genre metadata'
              : dataSource === 'inferred'
                ? `${allStats.uniqueGenres} genre${allStats.uniqueGenres === 1 ? '' : 's'} · ${allStats.withEmbeddedGenreCount} embedded tags, ${allStats.totalTracks - allStats.withEmbeddedGenreCount} inferred`
                : `${embeddedGroups.filter((g) => g.genre !== 'Untagged').length} embedded tag genre${embeddedGroups.filter((g) => g.genre !== 'Untagged').length === 1 ? '' : 's'} · ${allStats.withEmbeddedGenreCount}/${tracks.length} tracks tagged`}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {tracks.length > 0 && (
            <>
              <div
                className="inline-flex items-center p-0.5 rounded bg-[#0C0E13] border border-white/[0.08]"
                role="group"
                aria-label="Genre metadata source"
              >
                <button
                  type="button"
                  onClick={() => setDataSource('inferred')}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    dataSource === 'inferred'
                      ? 'bg-white/[0.12] text-white'
                      : 'text-[#8B92A2] hover:text-white'
                  }`}
                >
                  All Genres
                </button>
                <button
                  type="button"
                  onClick={() => setDataSource('embedded')}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    dataSource === 'embedded'
                      ? 'bg-white/[0.12] text-white'
                      : 'text-[#8B92A2] hover:text-white'
                  }`}
                >
                  Tag Only
                </button>
              </div>

              <div
                className="inline-flex items-center p-0.5 rounded bg-[#0C0E13] border border-white/[0.08]"
                role="group"
                aria-label="Genre view mode"
              >
                <button
                  type="button"
                  onClick={() => setViewMode('chart')}
                  aria-label="Pie chart view"
                  title="Pie chart view"
                  className={`p-1.5 rounded transition-colors ${
                    viewMode === 'chart'
                      ? 'bg-white/[0.12] text-white'
                      : 'text-[#8B92A2] hover:text-white'
                  }`}
                >
                  <PieChartIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  aria-label="Table breakdown view"
                  title="Table breakdown view"
                  className={`p-1.5 rounded transition-colors ${
                    viewMode === 'table'
                      ? 'bg-white/[0.12] text-white'
                      : 'text-[#8B92A2] hover:text-white'
                  }`}
                >
                  <Table2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      {tracks.length === 0 ? (
        <div className="flex-1 p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-center gap-6">
          <div
            className="h-36 w-36 rounded-full border-[14px] border-white/[0.05] flex flex-col items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <span className="font-mono text-lg font-medium tabular-nums text-[#525866]">0%</span>
            <span className="text-[11px] text-[#525866]">No tracks</span>
          </div>
          <div className="text-center sm:text-left max-w-xs">
            <div className="text-sm font-medium text-[#E5E7EB]">
              Scan your audio library to map genres
            </div>
            <p className="mt-1 text-xs text-[#717786] leading-relaxed">
              CrateSync reads embedded ID3, FLAC, and M4A genre frames and infers genre categories
              from track metadata to render an interactive breakdown here.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
              <button
                type="button"
                onClick={onMountFolder}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span>Mount Folder</span>
              </button>
              <button
                type="button"
                onClick={onPickFilesFallback}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[#D1D5DB] bg-[#1A1D24] border border-white/[0.08] hover:bg-[#232732] transition-colors whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Add Files</span>
              </button>
            </div>
          </div>
        </div>
      ) : viewMode === 'chart' ? (
        <div className="flex-1 p-5 flex flex-col justify-between gap-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center flex-1">
            {/* Recharts Donut Pie Chart */}
            <div className="md:col-span-6 relative h-[236px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="count"
                    nameKey="genre"
                    cx="50%"
                    cy="50%"
                    innerRadius={62}
                    outerRadius={98}
                    paddingAngle={pieData.length > 1 ? 2 : 0}
                    stroke="#12141A"
                    strokeWidth={2}
                    animationDuration={320}
                    onMouseEnter={(_, idx) => {
                      const item = pieData[idx];
                      if (item) setHoveredGenre(item.genre);
                    }}
                    onMouseLeave={() => setHoveredGenre(null)}
                    onClick={(_, idx) => {
                      const item = pieData[idx];
                      if (item) handleSliceInteraction(item);
                    }}
                  >
                    {pieData.map((entry) => {
                      const isActive =
                        (dataSource === 'inferred' && activeGenre === entry.genre) ||
                        hoveredGenre === entry.genre;
                      const isDimmed =
                        (hoveredGenre !== null && hoveredGenre !== entry.genre) ||
                        (hoveredGenre === null &&
                          dataSource === 'inferred' &&
                          activeGenre !== 'all' &&
                          activeGenre !== entry.genre);
                      return (
                        <Cell
                          key={entry.genre}
                          fill={entry.color}
                          fillOpacity={isDimmed ? 0.32 : isActive ? 1 : 0.9}
                          className={
                            entry.isFilterable
                              ? 'cursor-pointer outline-none transition-opacity duration-150'
                              : 'outline-none transition-opacity duration-150'
                          }
                        />
                      );
                    })}
                  </Pie>
                  <Tooltip content={<GenrePieTooltip />} />
                </PieChart>
              </ResponsiveContainer>

              {/* Center Metric Readout */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-4">
                {highlightedSlice ? (
                  <>
                    <span className="font-mono text-2xl font-semibold tabular-nums text-white leading-none">
                      {highlightedSlice.sharePct}%
                    </span>
                    <span className="mt-1.5 text-xs font-medium text-[#E5E7EB] max-w-[104px] truncate">
                      {highlightedSlice.genre}
                    </span>
                    <span className="mt-0.5 text-[11px] font-mono tabular-nums text-[#8B92A2]">
                      {highlightedSlice.count} track{highlightedSlice.count === 1 ? '' : 's'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-2xl font-semibold tabular-nums text-white leading-none">
                      {tracks.length}
                    </span>
                    <span className="mt-1.5 text-xs font-medium text-[#9CA3AF]">
                      {activeGroups.length} {activeGroups.length === 1 ? 'Genre' : 'Genres'}
                    </span>
                    <span className="mt-0.5 text-[11px] font-mono tabular-nums text-[#717786]">
                      {formatTotalRuntime(allStats.totalDuration)}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Interactive Genre Breakdown Legend */}
            <div className="md:col-span-6 space-y-1 max-h-[248px] overflow-y-auto pr-1">
              {pieData.map((entry) => {
                const isSelected = dataSource === 'inferred' && activeGenre === entry.genre;
                const isHovered = hoveredGenre === entry.genre;
                return (
                  <div
                    key={entry.genre}
                    onMouseEnter={() => setHoveredGenre(entry.genre)}
                    onMouseLeave={() => setHoveredGenre(null)}
                    className={`group flex items-center justify-between gap-2.5 px-2.5 py-2 rounded transition-colors text-xs ${
                      isSelected
                        ? 'bg-[#FF1F3D]/12 text-white'
                        : isHovered
                          ? 'bg-white/[0.05] text-white'
                          : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <button
                      type="button"
                      disabled={!entry.isFilterable}
                      onClick={() => handleSliceInteraction(entry)}
                      className={`flex items-center gap-2.5 min-w-0 flex-1 text-left ${
                        entry.isFilterable ? 'cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-[2px] shrink-0"
                        style={{ backgroundColor: entry.color }}
                        aria-hidden="true"
                      />
                      <span
                        className={`truncate font-medium ${
                          isSelected ? 'text-[#FF4D64]' : 'text-[#E5E7EB]'
                        }`}
                      >
                        {entry.genre}
                      </span>
                    </button>

                    <div className="flex items-center gap-2.5 shrink-0 font-mono tabular-nums text-[11px]">
                      <span className="text-[#A1A7B5]">{entry.count}</span>
                      <span className="text-[#717786] w-8 text-right">{entry.sharePct}%</span>
                      <button
                        type="button"
                        onClick={() => onPlayList(entry.trackIds, { shuffle: false })}
                        aria-label={`Play ${entry.genre} tracks`}
                        title={`Play ${entry.genre}`}
                        className="p-1 rounded text-[#717786] hover:text-white hover:bg-white/[0.08] transition-colors"
                      >
                        <Play className="h-3 w-3 fill-current" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer Action Strip */}
          <div className="pt-3 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-[#717786]">
              <Layers className="h-3.5 w-3.5 shrink-0" />
              <span>
                {dataSource === 'inferred'
                  ? activeGenre === 'all'
                    ? 'Click any slice or genre row to filter the dashboard'
                    : `Filtered by ${activeGenre}`
                  : 'Showing explicit embedded ID3 / FLAC / M4A genre tags'}
              </span>
              {dataSource === 'inferred' && activeGenre !== 'all' && (
                <button
                  type="button"
                  onClick={() => onSelectGenre('all')}
                  className="text-[#E5E7EB] hover:text-white underline underline-offset-2 ml-1 whitespace-nowrap"
                >
                  Clear filter
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                onOpenScanner('all', {
                  genre: activeGenre,
                  groupByGenre: true,
                })
              }
              className="inline-flex items-center gap-1 font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors whitespace-nowrap"
            >
              <span>Group in Storage</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        /* Detailed Table Breakdown View */
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#0F1116] border-b border-white/[0.07] text-[#717786]">
              <tr>
                <th className="py-2.5 pl-5 pr-3 font-medium">Genre</th>
                <th className="py-2.5 px-3 font-medium w-32">Share</th>
                <th className="py-2.5 px-3 font-medium">Runtime / Avg</th>
                <th className="py-2.5 pl-3 pr-5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {activeGroups.map((group) => {
                const isSelected = dataSource === 'inferred' && activeGenre === group.genre;
                return (
                  <tr
                    key={group.genre}
                    className={`transition-colors ${
                      isSelected ? 'bg-[#FF1F3D]/[0.08]' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <td className="py-2.5 pl-5 pr-3">
                      <button
                        type="button"
                        disabled={dataSource !== 'inferred'}
                        onClick={() =>
                          onSelectGenre(activeGenre === group.genre ? 'all' : group.genre)
                        }
                        className={`font-medium text-left transition-colors ${
                          isSelected
                            ? 'text-[#FF4D64]'
                            : dataSource === 'inferred'
                              ? 'text-white hover:text-[#FF4D64]'
                              : 'text-white cursor-default'
                        }`}
                      >
                        {group.genre}
                      </button>
                      <div className="text-[11px] font-mono tabular-nums text-[#6B7280] mt-0.5">
                        {group.matchedCount}/{group.count} matched
                        {group.avgBitrateKbps ? ` · ${group.avgBitrateKbps} kbps` : ''}
                      </div>
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-between font-mono tabular-nums text-[11px] text-[#A1A7B5] mb-1">
                        <span>{group.count} tracks</span>
                        <span>{group.sharePct}%</span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-white/[0.07] overflow-hidden">
                        <div
                          className="h-full bg-[#FF1F3D]/80"
                          style={{ width: `${Math.max(4, group.sharePct)}%` }}
                        />
                      </div>
                    </td>

                    <td className="py-2.5 px-3 font-mono tabular-nums text-[#A1A7B5] whitespace-nowrap">
                      <div>{formatTotalRuntime(group.totalDuration)}</div>
                      <div className="text-[11px] text-[#6B7280]">
                        {formatDuration(group.avgDuration)} avg
                      </div>
                    </td>

                    <td className="py-2.5 pl-3 pr-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => onPlayList(group.trackIds, { shuffle: false })}
                          aria-label={`Play ${group.genre} tracks`}
                          title={`Play ${group.genre}`}
                          className="text-[#9CA3AF] hover:text-white transition-colors"
                        >
                          <Play className="h-3.5 w-3.5 fill-current" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onCreatePlaylistFromTracks(group.trackIds)}
                          className="text-[#A1A7B5] hover:text-white transition-colors"
                        >
                          Playlist
                        </button>
                        {dataSource === 'inferred' && (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenScanner('all', {
                                genre: group.genre,
                                groupByGenre: false,
                              })
                            }
                            className="text-[#FF4D64] hover:text-[#FF7588] transition-colors"
                          >
                            Filter
                          </button>
                        )}
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
  );
}
