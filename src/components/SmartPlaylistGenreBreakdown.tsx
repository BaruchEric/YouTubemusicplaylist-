import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, PieChart as PieChartIcon, Play, X } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { LocalTrack } from '../types/music';
import { computeTrackStatistics } from '../utils/genreInference';
import type { ShuffleMode } from '../hooks/useAudioPlayer';
import { formatTotalRuntime } from '../utils/youtubeLinks';

const GENRE_PIE_PALETTE = [
  '#FF1F3D',
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#A855F7',
  '#06B6D4',
  '#FB7185',
  '#84CC16',
  '#EC4899',
  '#6366F1',
  '#14B8A6',
  '#F97316',
];

const UNCLASSIFIED_COLOR = '#4B5563';
const OTHER_ROLLUP_COLOR = '#64748B';

type BreakdownWeight = 'tracks' | 'runtime';

interface SmartGenreSlice {
  genre: string;
  count: number;
  totalDuration: number;
  trackPct: number;
  runtimePct: number;
  pct: number;
  metricValue: number;
  trackIds: string[];
  color: string;
  isRollup?: boolean;
}

interface SmartPlaylistGenreBreakdownProps {
  tracks: LocalTrack[];
  selectedGenre: string | null;
  onSelectGenre: (genre: string | null) => void;
  onPlayList: (trackIds: string[], options?: { shuffle?: boolean | ShuffleMode }) => void;
}

function isUnclassified(label: string): boolean {
  const lower = label.trim().toLowerCase();
  return lower === 'unclassified' || lower === 'untagged' || lower === 'other';
}

function SmartGenreTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: SmartGenreSlice }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-md border border-white/[0.12] bg-[#0F1116]/95 px-3 py-2 shadow-xl text-xs min-w-[180px]">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 font-medium text-white truncate">
          <span
            className="h-2.5 w-2.5 rounded-sm shrink-0"
            style={{ backgroundColor: item.color }}
          />
          <span className="truncate">{item.genre}</span>
        </span>
        <span className="font-mono font-medium tabular-nums text-[#FF4D64] shrink-0">
          {item.pct.toFixed(1)}%
        </span>
      </div>
      <div className="mt-1.5 space-y-0.5 font-mono tabular-nums text-[11px] text-[#9CA3AF]">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#717786]">Tracks</span>
          <span className="text-white">
            {item.count} ({item.trackPct.toFixed(1)}%)
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#717786]">Runtime</span>
          <span>
            {formatTotalRuntime(item.totalDuration)} ({item.runtimePct.toFixed(1)}%)
          </span>
        </div>
      </div>
    </div>
  );
}

export function SmartPlaylistGenreBreakdown({
  tracks,
  selectedGenre,
  onSelectGenre,
  onPlayList,
}: SmartPlaylistGenreBreakdownProps) {
  const [weightMode, setWeightMode] = useState<BreakdownWeight>('tracks');
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredGenre, setHoveredGenre] = useState<string | null>(null);

  const { slices, uniqueGenreCount } = useMemo(() => {
    if (tracks.length === 0) {
      return { slices: [] as SmartGenreSlice[], uniqueGenreCount: 0 };
    }

    const stats = computeTrackStatistics(tracks);
    const totalTracks = tracks.length;
    const totalDuration = stats.totalDuration || 0;

    let colorIdx = 0;
    const raw: SmartGenreSlice[] = stats.genreGroups.map((group) => {
      const trackPct = totalTracks > 0 ? (group.count / totalTracks) * 100 : 0;
      const runtimePct =
        totalDuration > 0 ? (group.totalDuration / totalDuration) * 100 : trackPct;
      const pct = weightMode === 'runtime' ? runtimePct : trackPct;
      const metricValue = weightMode === 'runtime' ? Math.max(group.totalDuration, 1) : group.count;

      const color = isUnclassified(group.genre)
        ? UNCLASSIFIED_COLOR
        : GENRE_PIE_PALETTE[colorIdx++ % GENRE_PIE_PALETTE.length];

      return {
        genre: group.genre,
        count: group.count,
        totalDuration: group.totalDuration,
        trackPct: Math.round(trackPct * 10) / 10,
        runtimePct: Math.round(runtimePct * 10) / 10,
        pct: Math.round(pct * 10) / 10,
        metricValue,
        trackIds: group.trackIds,
        color,
      };
    });

    raw.sort((a, b) => b.pct - a.pct || b.count - a.count);

    // Keep top 9 genres cleanly distinct; roll long tail into an explicit "Other (N)" slice
    const MAX_SLICES = 9;
    let displaySlices = raw;
    if (raw.length > MAX_SLICES) {
      const head = raw.slice(0, MAX_SLICES - 1);
      const tail = raw.slice(MAX_SLICES - 1);
      const tailCount = tail.reduce((acc, g) => acc + g.count, 0);
      const tailDuration = tail.reduce((acc, g) => acc + g.totalDuration, 0);
      const tailTrackPct = totalTracks > 0 ? (tailCount / totalTracks) * 100 : 0;
      const tailRuntimePct =
        totalDuration > 0 ? (tailDuration / totalDuration) * 100 : tailTrackPct;
      const tailPct = weightMode === 'runtime' ? tailRuntimePct : tailTrackPct;

      displaySlices = [
        ...head,
        {
          genre: `Other (${tail.length})`,
          count: tailCount,
          totalDuration: tailDuration,
          trackPct: Math.round(tailTrackPct * 10) / 10,
          runtimePct: Math.round(tailRuntimePct * 10) / 10,
          pct: Math.round(tailPct * 10) / 10,
          metricValue: weightMode === 'runtime' ? Math.max(tailDuration, 1) : tailCount,
          trackIds: tail.flatMap((g) => g.trackIds),
          color: OTHER_ROLLUP_COLOR,
          isRollup: true,
        },
      ];
    }

    return {
      slices: displaySlices,
      uniqueGenreCount: raw.length,
    };
  }, [tracks, weightMode]);

  if (tracks.length === 0) return null;

  const focusSlice =
    (hoveredGenre ? slices.find((s) => s.genre === hoveredGenre) : null) ??
    (selectedGenre ? slices.find((s) => s.genre === selectedGenre) : null) ??
    null;

  const selectedSliceObj = selectedGenre
    ? slices.find((s) => s.genre === selectedGenre) ?? null
    : null;

  return (
    <section
      aria-label="Smart Playlist Genre Breakdown"
      className="rounded-lg bg-[#12141A] border border-white/[0.08] overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 sm:px-5 py-3 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <PieChartIcon className="h-4 w-4 text-[#FF4D64] shrink-0" />
          <div className="min-w-0">
            <h2 className="font-display text-sm font-semibold text-white truncate">
              Genre Breakdown
            </h2>
            <p className="text-[11px] text-[#717786] font-mono tabular-nums truncate">
              {uniqueGenreCount} {uniqueGenreCount === 1 ? 'genre' : 'genres'} across{' '}
              {tracks.length} filtered {tracks.length === 1 ? 'track' : 'tracks'}
              {selectedGenre ? ` · Filtered to ${selectedGenre}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {selectedSliceObj && (
            <>
              <button
                type="button"
                onClick={() => onPlayList(selectedSliceObj.trackIds, { shuffle: 'off' })}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-[#0B0C0E] bg-white hover:bg-[#E5E7EB] transition-colors whitespace-nowrap"
              >
                <Play className="h-3 w-3 fill-current" />
                <span>Play {selectedSliceObj.genre}</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectGenre(null)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-[#9CA3AF] hover:text-white bg-white/[0.05] hover:bg-white/[0.1] transition-colors whitespace-nowrap"
              >
                <X className="h-3 w-3" />
                <span>All Genres</span>
              </button>
            </>
          )}

          {!collapsed && (
            <div
              role="tablist"
              aria-label="Genre breakdown metric"
              className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B0D12] border border-white/[0.08]"
            >
              <button
                type="button"
                role="tab"
                aria-selected={weightMode === 'tracks'}
                onClick={() => setWeightMode('tracks')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  weightMode === 'tracks'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                Tracks
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={weightMode === 'runtime'}
                onClick={() => setWeightMode('runtime')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  weightMode === 'runtime'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                Runtime
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand genre breakdown' : 'Collapse genre breakdown'}
            className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Left (5 cols): Recharts Donut PieChart */}
          <div className="lg:col-span-5 relative h-[210px] w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="metricValue"
                  nameKey="genre"
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={88}
                  paddingAngle={slices.length > 1 ? 2 : 0}
                  stroke="#12141A"
                  strokeWidth={2}
                  onMouseEnter={(_, idx) => {
                    const item = slices[idx];
                    if (item) setHoveredGenre(item.genre);
                  }}
                  onMouseLeave={() => setHoveredGenre(null)}
                  onClick={(_, idx) => {
                    const item = slices[idx];
                    if (!item || item.isRollup) return;
                    onSelectGenre(selectedGenre === item.genre ? null : item.genre);
                  }}
                >
                  {slices.map((slice) => {
                    const isSelected = selectedGenre === slice.genre;
                    const isDimmed = selectedGenre !== null && !isSelected;
                    return (
                      <Cell
                        key={slice.genre}
                        fill={slice.color}
                        fillOpacity={isDimmed ? 0.3 : 0.95}
                        className={slice.isRollup ? 'cursor-default' : 'cursor-pointer'}
                      />
                    );
                  })}
                </Pie>
                <Tooltip content={<SmartGenreTooltip />} />
              </PieChart>
            </ResponsiveContainer>

            {/* Center Metric Readout */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-6">
              {focusSlice ? (
                <>
                  <div className="font-mono text-lg font-semibold tabular-nums text-white leading-none">
                    {focusSlice.pct.toFixed(1)}%
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-[#D1D5DB] truncate max-w-[104px]">
                    {focusSlice.genre}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] tabular-nums text-[#717786]">
                    {focusSlice.count} {focusSlice.count === 1 ? 'track' : 'tracks'}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-mono text-xl font-semibold tabular-nums text-white leading-none">
                    {uniqueGenreCount}
                  </div>
                  <div className="mt-1 text-[11px] text-[#8B92A2]">
                    {uniqueGenreCount === 1 ? 'Genre' : 'Genres'}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right (7 cols): Interactive Genre Breakdown Legend */}
          <div className="lg:col-span-7 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-[#717786] pb-1 border-b border-white/[0.06]">
              <span>Click a genre slice or row to filter the playlist table</span>
              <span className="font-mono tabular-nums">
                {weightMode === 'runtime' ? 'Share (Runtime)' : 'Share (Tracks)'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2">
              {slices.map((slice) => {
                const isSelected = selectedGenre === slice.genre;
                const isDimmed = selectedGenre !== null && !isSelected;
                return (
                  <button
                    key={slice.genre}
                    type="button"
                    disabled={slice.isRollup}
                    onMouseEnter={() => setHoveredGenre(slice.genre)}
                    onMouseLeave={() => setHoveredGenre(null)}
                    onClick={() => {
                      if (slice.isRollup) return;
                      onSelectGenre(isSelected ? null : slice.genre);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md border transition-colors ${
                      isSelected
                        ? 'bg-white/[0.08] border-[#FF4D64]/60'
                        : 'bg-[#0D0F14] border-white/[0.05] hover:border-white/[0.14]'
                    } ${isDimmed ? 'opacity-50 hover:opacity-100' : ''} ${
                      slice.isRollup ? 'cursor-default' : 'cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: slice.color }}
                        />
                        <span className="text-white font-medium truncate">{slice.genre}</span>
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[#D1D5DB] shrink-0">
                        {slice.pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(3, slice.pct)}%`,
                            backgroundColor: slice.color,
                          }}
                        />
                      </div>
                      <span className="font-mono text-[10px] tabular-nums text-[#717786] shrink-0">
                        {slice.count} · {formatTotalRuntime(slice.totalDuration)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
