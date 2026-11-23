import { useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  FolderOpen,
  ListPlus,
  Play,
  Upload,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LocalTrack } from '../types/music';
import type { TrackStatistics } from '../utils/genreInference';
import type { ShuffleMode } from '../utils/smartShuffle';
import { formatDuration, formatTotalRuntime } from '../utils/youtubeLinks';

const BAR_PALETTE = [
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
  '#8B5CF6',
  '#22D3EE',
];

const UNCLASSIFIED_COLOR = '#4B5563';

type WeightMode = 'tracks' | 'runtime';
type ChartOrientation = 'horizontal' | 'vertical';
type ScopeLimit = 'top12' | 'all';

interface GlobalGenreBarDatum {
  genre: string;
  shortLabel: string;
  count: number;
  totalTracks: number;
  trackPct: number;
  runtimePct: number;
  pct: number;
  totalDuration: number;
  avgDuration: number;
  matchedCount: number;
  matchRatePct: number;
  trackIds: string[];
  color: string;
}

interface GlobalGenreDistributionChartProps {
  tracks: LocalTrack[];
  allStats: TrackStatistics;
  activeGenre: string;
  onSelectGenre: (genre: string) => void;
  onPlayList: (trackIds: string[], options?: { shuffle?: boolean | ShuffleMode }) => void;
  onCreatePlaylistFromTracks: (trackIds: string[]) => void;
  onOpenScanner: (
    filter?: 'all' | 'unmatched' | 'matched' | 'missing',
    options?: { genre?: string; groupByGenre?: boolean }
  ) => void;
  onMountFolder: () => void;
  onPickFilesFallback: () => void;
}

function isUnclassifiedGenre(label: string): boolean {
  const lower = label.trim().toLowerCase();
  return lower === 'unclassified' || lower === 'untagged' || lower === 'other';
}

function truncateLabel(label: string, maxLen: number): string {
  if (label.length <= maxLen) return label;
  return `${label.slice(0, maxLen - 1)}…`;
}

function GlobalGenreTooltip({
  active,
  payload,
  weightMode,
}: {
  active?: boolean;
  payload?: Array<{ payload: GlobalGenreBarDatum }>;
  weightMode: WeightMode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-md border border-white/[0.12] bg-[#0F1116]/95 px-3 py-2.5 shadow-xl text-xs min-w-[210px]">
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

      <div className="mt-2 space-y-1 font-mono tabular-nums text-[11px] text-[#9CA3AF]">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#717786]">
            {weightMode === 'runtime' ? 'Runtime Share' : 'Track Share'}
          </span>
          <span className="text-white font-medium">{item.pct.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#717786]">Tracks</span>
          <span>
            {item.count} / {item.totalTracks} ({item.trackPct.toFixed(1)}%)
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#717786]">Total Runtime</span>
          <span>
            {formatTotalRuntime(item.totalDuration)} ({item.runtimePct.toFixed(1)}%)
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#717786]">Avg Length</span>
          <span>{formatDuration(item.avgDuration)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#717786]">YT Match Rate</span>
          <span>{item.matchRatePct}%</span>
        </div>
      </div>
    </div>
  );
}

export function GlobalGenreDistributionChart({
  tracks,
  allStats,
  activeGenre,
  onSelectGenre,
  onPlayList,
  onCreatePlaylistFromTracks,
  onOpenScanner,
  onMountFolder,
  onPickFilesFallback,
}: GlobalGenreDistributionChartProps) {
  const [weightMode, setWeightMode] = useState<WeightMode>('tracks');
  const [orientation, setOrientation] = useState<ChartOrientation>('horizontal');
  const [scopeLimit, setScopeLimit] = useState<ScopeLimit>('top12');

  const { allData, visibleData, summary } = useMemo(() => {
    const totalTracks = tracks.length;
    const totalDuration = allStats.totalDuration || 0;

    let paletteCursor = 0;
    const items: GlobalGenreBarDatum[] = allStats.genreGroups.map((group) => {
      const trackPct = totalTracks > 0 ? (group.count / totalTracks) * 100 : 0;
      const runtimePct =
        totalDuration > 0 ? (group.totalDuration / totalDuration) * 100 : trackPct;
      const pct = weightMode === 'runtime' ? runtimePct : trackPct;

      const color = isUnclassifiedGenre(group.genre)
        ? UNCLASSIFIED_COLOR
        : BAR_PALETTE[paletteCursor++ % BAR_PALETTE.length];

      return {
        genre: group.genre,
        shortLabel: truncateLabel(group.genre, 16),
        count: group.count,
        totalTracks,
        trackPct: Math.round(trackPct * 10) / 10,
        runtimePct: Math.round(runtimePct * 10) / 10,
        pct: Math.round(pct * 10) / 10,
        totalDuration: group.totalDuration,
        avgDuration: group.avgDuration,
        matchedCount: group.matchedCount,
        matchRatePct: group.count > 0 ? Math.round((group.matchedCount / group.count) * 100) : 0,
        trackIds: group.trackIds,
        color,
      };
    });

    items.sort((a, b) => b.pct - a.pct || b.count - a.count);

    const topGenre = items[0] ?? null;
    const top3Pct = Math.min(
      100,
      Math.round(items.slice(0, 3).reduce((acc, g) => acc + g.pct, 0) * 10) / 10
    );

    const unclassifiedCount = items
      .filter((g) => isUnclassifiedGenre(g.genre))
      .reduce((acc, g) => acc + g.count, 0);
    const classifiedPct =
      totalTracks > 0 ? Math.round(((totalTracks - unclassifiedCount) / totalTracks) * 100) : 0;

    const displayed = scopeLimit === 'top12' ? items.slice(0, 12) : items;

    return {
      allData: items,
      visibleData: displayed,
      summary: {
        topGenre,
        top3Pct,
        classifiedPct,
        totalGenres: items.length,
        maxPct: items[0]?.pct ?? 0,
      },
    };
  }, [tracks.length, allStats, weightMode, scopeLimit]);

  const selectedGenreDatum = useMemo(
    () => (activeGenre === 'all' ? null : allData.find((d) => d.genre === activeGenre) ?? null),
    [activeGenre, allData]
  );

  const horizontalHeight = Math.max(230, visibleData.length * 32 + 24);
  const maxAxisPct = Math.min(100, Math.max(10, Math.ceil((summary.maxPct + 8) / 10) * 10));

  return (
    <section
      aria-label="Global Genre Distribution"
      className="rounded-lg border border-white/[0.08] bg-[#12141A] p-5 sm:p-6 space-y-5"
    >
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[#FF4D64] shrink-0" />
            <h2 className="font-display text-base font-semibold text-white">
              Global Genre Distribution
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-[#717786]">
            Library-wide genre share percentages across all {tracks.length} indexed{' '}
            {tracks.length === 1 ? 'track' : 'tracks'} · Click any bar to scope the Dashboard
          </p>
        </div>

        {/* Interactive Segmented Controls */}
        {tracks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div
              role="tablist"
              aria-label="Percentage weighting basis"
              className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B0D12] border border-white/[0.08]"
            >
              <button
                type="button"
                role="tab"
                aria-selected={weightMode === 'tracks'}
                onClick={() => setWeightMode('tracks')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  weightMode === 'tracks'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                % Tracks
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={weightMode === 'runtime'}
                onClick={() => setWeightMode('runtime')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  weightMode === 'runtime'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                % Runtime
              </button>
            </div>

            <div
              role="tablist"
              aria-label="Bar chart orientation"
              className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B0D12] border border-white/[0.08]"
            >
              <button
                type="button"
                role="tab"
                aria-selected={orientation === 'horizontal'}
                onClick={() => setOrientation('horizontal')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  orientation === 'horizontal'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                Horizontal
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={orientation === 'vertical'}
                onClick={() => setOrientation('vertical')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  orientation === 'vertical'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                Vertical
              </button>
            </div>

            {allData.length > 12 && (
              <div
                role="tablist"
                aria-label="Displayed genre count"
                className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B0D12] border border-white/[0.08]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={scopeLimit === 'top12'}
                  onClick={() => setScopeLimit('top12')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                    scopeLimit === 'top12'
                      ? 'bg-white/[0.12] text-white'
                      : 'text-[#8B92A2] hover:text-white'
                  }`}
                >
                  Top 12
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={scopeLimit === 'all'}
                  onClick={() => setScopeLimit('all')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                    scopeLimit === 'all'
                      ? 'bg-white/[0.12] text-white'
                      : 'text-[#8B92A2] hover:text-white'
                  }`}
                >
                  All ({allData.length})
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {tracks.length === 0 ? (
        <div className="rounded-md border border-white/[0.06] bg-[#0D0F14] px-5 py-8 text-center">
          <p className="text-sm font-medium text-[#D1D5DB]">No library tracks indexed yet</p>
          <p className="mt-1 text-xs text-[#717786] max-w-md mx-auto">
            Mount a local folder or upload audio files to compare genre percentages across your
            entire collection.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={onMountFolder}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>Mount Local Folder</span>
            </button>
            <button
              type="button"
              onClick={onPickFilesFallback}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[#D1D5DB] bg-[#181B24] border border-white/[0.09] hover:text-white hover:bg-[#222634] transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Upload Audio Files</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 4-Column Library-Wide Genre Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 py-3.5 px-4 rounded-md bg-[#0D0F14] border border-white/[0.06]">
            <div>
              <div className="text-[11px] text-[#717786]">Leading Genre</div>
              <div className="mt-1 text-sm font-semibold text-white truncate">
                {summary.topGenre ? summary.topGenre.genre : '—'}
              </div>
              <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#FF4D64]">
                {summary.topGenre
                  ? `${summary.topGenre.pct.toFixed(1)}% · ${summary.topGenre.count} tracks`
                  : '—'}
              </div>
            </div>

            <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
              <div className="text-[11px] text-[#717786]">Top 3 Concentration</div>
              <div className="mt-1 font-mono text-lg font-medium tabular-nums text-white">
                {summary.top3Pct.toFixed(1)}%
              </div>
              <div className="mt-0.5 text-[11px] text-[#6B7280]">
                Combined share of top 3 genres
              </div>
            </div>

            <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
              <div className="text-[11px] text-[#717786]">Classified Coverage</div>
              <div className="mt-1 font-mono text-lg font-medium tabular-nums text-[#22C55E]">
                {summary.classifiedPct}%
              </div>
              <div className="mt-0.5 text-[11px] text-[#6B7280]">
                Excluding unclassified / other
              </div>
            </div>

            <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
              <div className="text-[11px] text-[#717786]">Distinct Genres</div>
              <div className="mt-1 font-mono text-lg font-medium tabular-nums text-white">
                {summary.totalGenres}
              </div>
              <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6B7280]">
                Showing {visibleData.length} of {allData.length}
              </div>
            </div>
          </div>

          {/* Recharts BarChart */}
          <div className="w-full" style={{ height: orientation === 'horizontal' ? horizontalHeight : 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              {orientation === 'horizontal' ? (
                <BarChart
                  data={visibleData}
                  layout="vertical"
                  margin={{ top: 6, right: 54, left: 6, bottom: 6 }}
                >
                  <CartesianGrid
                    horizontal={false}
                    stroke="rgba(255,255,255,0.06)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    type="number"
                    domain={[0, maxAxisPct]}
                    tickFormatter={(v: number) => `${v}%`}
                    tick={{ fill: '#717786', fontSize: 11 }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="shortLabel"
                    width={126}
                    tick={{ fill: '#D1D5DB', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={<GlobalGenreTooltip weightMode={weightMode} />}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  />
                  <Bar
                    dataKey="pct"
                    radius={[0, 4, 4, 0]}
                    barSize={18}
                    className="cursor-pointer"
                    onClick={(barData) => {
                      const genre = (barData as unknown as { genre?: string })?.genre;
                      if (!genre) return;
                      onSelectGenre(activeGenre === genre ? 'all' : genre);
                    }}
                  >
                    {visibleData.map((entry) => {
                      const isSelected = activeGenre === entry.genre;
                      const isDimmed = activeGenre !== 'all' && !isSelected;
                      return (
                        <Cell
                          key={entry.genre}
                          fill={entry.color}
                          fillOpacity={isDimmed ? 0.3 : 0.92}
                          stroke={isSelected ? '#FFFFFF' : 'none'}
                          strokeWidth={isSelected ? 1.5 : 0}
                        />
                      );
                    })}
                    <LabelList
                      dataKey="pct"
                      position="right"
                      formatter={(val: unknown) => `${Number(val ?? 0).toFixed(1)}%`}
                      style={{
                        fill: '#9CA3AF',
                        fontSize: 11,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      }}
                    />
                  </Bar>
                </BarChart>
              ) : (
                <BarChart
                  data={visibleData}
                  margin={{ top: 18, right: 12, left: -12, bottom: 26 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="rgba(255,255,255,0.06)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="shortLabel"
                    interval={0}
                    angle={visibleData.length > 7 ? -26 : 0}
                    textAnchor={visibleData.length > 7 ? 'end' : 'middle'}
                    height={visibleData.length > 7 ? 56 : 30}
                    tick={{ fill: '#9CA3AF', fontSize: 11 }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, maxAxisPct]}
                    tickFormatter={(v: number) => `${v}%`}
                    tick={{ fill: '#717786', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip
                    content={<GlobalGenreTooltip weightMode={weightMode} />}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  />
                  <Bar
                    dataKey="pct"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={42}
                    className="cursor-pointer"
                    onClick={(barData) => {
                      const genre = (barData as unknown as { genre?: string })?.genre;
                      if (!genre) return;
                      onSelectGenre(activeGenre === genre ? 'all' : genre);
                    }}
                  >
                    {visibleData.map((entry) => {
                      const isSelected = activeGenre === entry.genre;
                      const isDimmed = activeGenre !== 'all' && !isSelected;
                      return (
                        <Cell
                          key={entry.genre}
                          fill={entry.color}
                          fillOpacity={isDimmed ? 0.3 : 0.92}
                          stroke={isSelected ? '#FFFFFF' : 'none'}
                          strokeWidth={isSelected ? 1.5 : 0}
                        />
                      );
                    })}
                    <LabelList
                      dataKey="pct"
                      position="top"
                      formatter={(val: unknown) => `${Number(val ?? 0).toFixed(1)}%`}
                      style={{
                        fill: '#9CA3AF',
                        fontSize: 10,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      }}
                    />
                  </Bar>
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>

          {/* Active Selected Genre Quick Action Strip */}
          {selectedGenreDatum && (
            <div className="pt-3.5 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: selectedGenreDatum.color }}
                />
                <span className="font-semibold text-white truncate">
                  {selectedGenreDatum.genre}
                </span>
                <span className="font-mono tabular-nums text-[#8B92A2]">
                  {selectedGenreDatum.pct.toFixed(1)}% · {selectedGenreDatum.count} tracks ·{' '}
                  {formatTotalRuntime(selectedGenreDatum.totalDuration)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    onPlayList(selectedGenreDatum.trackIds, { shuffle: false })
                  }
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#0B0C0E] bg-white hover:bg-[#E5E7EB] transition-colors whitespace-nowrap"
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>Play Genre</span>
                </button>
                <button
                  type="button"
                  onClick={() => onCreatePlaylistFromTracks(selectedGenreDatum.trackIds)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#D1D5DB] bg-[#181B24] border border-white/[0.09] hover:text-white hover:bg-[#222634] transition-colors whitespace-nowrap"
                >
                  <ListPlus className="h-3 w-3" />
                  <span>Playlist</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onOpenScanner('all', { genre: selectedGenreDatum.genre, groupByGenre: false })
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors whitespace-nowrap"
                >
                  <span>Open in Storage</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onSelectGenre('all')}
                  aria-label="Clear selected genre filter"
                  className="p-1 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
