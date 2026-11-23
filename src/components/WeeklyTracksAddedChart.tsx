import { useMemo, useState } from 'react';
import {
  FolderOpen,
  ListPlus,
  Pause,
  Play,
  TrendingUp,
  Upload,
  X,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LocalTrack } from '../types/music';
import { inferTrackGenre, type InferredGenreResult } from '../utils/genreInference';
import type { ShuffleMode } from '../utils/smartShuffle';
import {
  formatDuration,
  formatTotalRuntime,
} from '../utils/youtubeLinks';

const WEEKS_WINDOW = 13; // ~3 months (91 days)
const LOSSLESS_FORMATS = new Set(['FLAC', 'WAV', 'AIFF', 'AIF', 'AIFC', 'ALAC']);

type SeriesMode = 'weekly' | 'cumulative';
type FormatFilter = 'all' | 'lossless' | 'compressed';

interface WeeklyAddedDatum {
  weekKey: string;
  weekStartMs: number;
  weekEndMs: number;
  axisLabel: string;
  rangeLabel: string;
  isCurrentWeek: boolean;
  addedCount: number;
  cumulativeCount: number;
  totalDuration: number;
  topGenre: string | null;
  tracks: LocalTrack[];
}

interface WeeklyTracksAddedChartProps {
  tracks: LocalTrack[];
  trackGenreMap: Map<string, InferredGenreResult>;
  activeGenre: string;
  activePlayingTrackId: string | null;
  isAudioPlaying: boolean;
  onPlayTrack: (trackId: string, queueIds: string[]) => void;
  onPlayList: (trackIds: string[], options?: { shuffle?: boolean | ShuffleMode }) => void;
  onCreatePlaylistFromTracks: (trackIds: string[]) => void;
  onMountFolder: () => void;
  onPickFilesFallback: () => void;
}

/**
 * Returns local Monday 00:00:00.000 of the week containing `date`.
 */
function startOfIsoWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const jsDay = d.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toWeekKey(monday: Date): string {
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function WeeklyAddedTooltip({
  active,
  payload,
  seriesMode,
}: {
  active?: boolean;
  payload?: Array<{ payload: WeeklyAddedDatum }>;
  seriesMode: SeriesMode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-md border border-white/[0.12] bg-[#0F1116]/95 px-3 py-2.5 shadow-xl text-xs min-w-[215px]">
      <div className="flex items-center justify-between gap-3 font-medium text-white">
        <span>{item.rangeLabel}</span>
        {item.isCurrentWeek && (
          <span className="font-mono text-[10px] text-[#FF4D64]">This week</span>
        )}
      </div>

      <div className="mt-2 space-y-1 font-mono tabular-nums text-[11px] text-[#9CA3AF]">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#717786]">New Tracks Added</span>
          <span className="text-white font-medium">
            {item.addedCount} {item.addedCount === 1 ? 'track' : 'tracks'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[#717786]">
            {seriesMode === 'cumulative' ? 'Cumulative Total' : 'Library Total'}
          </span>
          <span>{item.cumulativeCount}</span>
        </div>
        {item.addedCount > 0 && (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[#717786]">Runtime Added</span>
              <span>{formatTotalRuntime(item.totalDuration)}</span>
            </div>
            {item.topGenre && (
              <div className="pt-1 mt-1 border-t border-white/[0.08] font-sans text-[11px] text-[#D1D5DB] truncate">
                Top genre: <span className="text-white">{item.topGenre}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function WeeklyTracksAddedChart({
  tracks,
  trackGenreMap,
  activeGenre,
  activePlayingTrackId,
  isAudioPlaying,
  onPlayTrack,
  onPlayList,
  onCreatePlaylistFromTracks,
  onMountFolder,
  onPickFilesFallback,
}: WeeklyTracksAddedChartProps) {
  const [seriesMode, setSeriesMode] = useState<SeriesMode>('weekly');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');
  const [selectedWeekKey, setSelectedWeekKey] = useState<string | null>(null);

  const filteredTracks = useMemo(() => {
    if (formatFilter === 'all') return tracks;
    return tracks.filter((t) => {
      const isLossless = LOSSLESS_FORMATS.has((t.format || '').toUpperCase());
      return formatFilter === 'lossless' ? isLossless : !isLossless;
    });
  }, [tracks, formatFilter]);

  const { weeklyData, summary } = useMemo(() => {
    const currentMonday = startOfIsoWeek(new Date());
    const shortFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

    const buckets: Array<{
      weekKey: string;
      weekStart: Date;
      weekEnd: Date;
      isCurrentWeek: boolean;
      tracks: LocalTrack[];
      totalDuration: number;
      genreCounts: Map<string, number>;
    }> = [];

    const bucketByKey = new Map<string, (typeof buckets)[number]>();

    for (let offset = WEEKS_WINDOW - 1; offset >= 0; offset--) {
      const start = new Date(currentMonday);
      start.setDate(currentMonday.getDate() - offset * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);

      const key = toWeekKey(start);
      const bucket = {
        weekKey: key,
        weekStart: start,
        weekEnd: end,
        isCurrentWeek: offset === 0,
        tracks: [] as LocalTrack[],
        totalDuration: 0,
        genreCounts: new Map<string, number>(),
      };
      buckets.push(bucket);
      bucketByKey.set(key, bucket);
    }

    const windowStartMs = buckets[0].weekStart.getTime();
    let priorCount = 0;

    for (const track of filteredTracks) {
      if (!Number.isFinite(track.addedAt) || track.addedAt <= 0) continue;
      if (track.addedAt < windowStartMs) {
        priorCount += 1;
        continue;
      }

      const addedDate = new Date(track.addedAt);
      if (Number.isNaN(addedDate.getTime())) continue;
      const monday = startOfIsoWeek(addedDate);
      const key = toWeekKey(monday);
      const bucket = bucketByKey.get(key);
      if (!bucket) continue;

      bucket.tracks.push(track);
      bucket.totalDuration += track.duration || 0;
      const genre = trackGenreMap.get(track.id)?.genre ?? inferTrackGenre(track).genre;
      bucket.genreCounts.set(genre, (bucket.genreCounts.get(genre) ?? 0) + 1);
    }

    let runningTotal = priorCount;
    let totalAddedInWindow = 0;

    const series: WeeklyAddedDatum[] = buckets.map((b) => {
      // Sort tracks newest first inside each week
      b.tracks.sort((a, bTrack) => bTrack.addedAt - a.addedAt);
      runningTotal += b.tracks.length;
      totalAddedInWindow += b.tracks.length;

      let topGenre: string | null = null;
      let topGenreCount = 0;
      b.genreCounts.forEach((cnt, g) => {
        if (cnt > topGenreCount) {
          topGenreCount = cnt;
          topGenre = g;
        }
      });

      const startLabel = shortFmt.format(b.weekStart);
      const endLabel = shortFmt.format(b.weekEnd);
      return {
        weekKey: b.weekKey,
        weekStartMs: b.weekStart.getTime(),
        weekEndMs: b.weekEnd.getTime(),
        axisLabel: b.isCurrentWeek ? 'This Wk' : startLabel,
        rangeLabel: `${startLabel} – ${endLabel}`,
        isCurrentWeek: b.isCurrentWeek,
        addedCount: b.tracks.length,
        cumulativeCount: runningTotal,
        totalDuration: b.totalDuration,
        topGenre,
        tracks: b.tracks,
      };
    });

    let peakWeek: WeeklyAddedDatum | null = null;
    for (const datum of series) {
      if (datum.addedCount > 0 && (!peakWeek || datum.addedCount > peakWeek.addedCount)) {
        peakWeek = datum;
      }
    }

    // Recent momentum: compare last 4 weeks vs preceding 4 weeks
    const recent4 = series.slice(-4).reduce((sum, w) => sum + w.addedCount, 0);
    const prev4 = series.slice(-8, -4).reduce((sum, w) => sum + w.addedCount, 0);
    const momentumDelta = recent4 - prev4;

    const weeklyAvg = totalAddedInWindow / WEEKS_WINDOW;
    const shareOfLibraryPct =
      filteredTracks.length > 0
        ? Math.round((totalAddedInWindow / filteredTracks.length) * 100)
        : 0;

    return {
      weeklyData: series,
      summary: {
        totalAddedInWindow,
        shareOfLibraryPct,
        weeklyAvg,
        peakWeek,
        recent4,
        momentumDelta,
        activeWeeks: series.filter((w) => w.addedCount > 0).length,
      },
    };
  }, [filteredTracks, trackGenreMap]);

  const selectedWeek = useMemo(
    () => (selectedWeekKey ? weeklyData.find((w) => w.weekKey === selectedWeekKey) ?? null : null),
    [selectedWeekKey, weeklyData]
  );

  const selectedWeekIds = useMemo(
    () => selectedWeek?.tracks.map((t) => t.id) ?? [],
    [selectedWeek]
  );

  const dataKey = seriesMode === 'cumulative' ? 'cumulativeCount' : 'addedCount';

  return (
    <section
      aria-label="New Tracks Added Weekly Trend"
      className="rounded-lg border border-white/[0.08] bg-[#12141A] p-5 sm:p-6 space-y-5"
    >
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#FF4D64] shrink-0" />
            <h2 className="font-display text-base font-semibold text-white">
              New Tracks Added
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-[#717786]">
            Weekly additions trend over the last 3 months (13 weeks)
            {activeGenre !== 'all' ? ` · ${activeGenre}` : ''} · Click any week point to inspect
            added tracks
          </p>
        </div>

        {/* Interactive Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            role="tablist"
            aria-label="Line chart series mode"
            className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B0D12] border border-white/[0.08]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={seriesMode === 'weekly'}
              onClick={() => setSeriesMode('weekly')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                seriesMode === 'weekly'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-[#8B92A2] hover:text-white'
              }`}
            >
              Weekly
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={seriesMode === 'cumulative'}
              onClick={() => setSeriesMode('cumulative')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                seriesMode === 'cumulative'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-[#8B92A2] hover:text-white'
              }`}
            >
              Cumulative
            </button>
          </div>

          <div
            role="tablist"
            aria-label="Audio format filter"
            className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B0D12] border border-white/[0.08]"
          >
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'lossless', label: 'Lossless' },
                { id: 'compressed', label: 'Compressed' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={formatFilter === opt.id}
                onClick={() => {
                  setFormatFilter(opt.id);
                  setSelectedWeekKey(null);
                }}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  formatFilter === opt.id
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4-Column Trend KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 py-3.5 px-4 rounded-md bg-[#0D0F14] border border-white/[0.06]">
        <div>
          <div className="text-[11px] text-[#717786]">Added (Last 3 Months)</div>
          <div className="mt-1 font-mono text-lg font-medium tabular-nums text-white">
            {summary.totalAddedInWindow}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6B7280]">
            {summary.shareOfLibraryPct}% of{' '}
            {formatFilter === 'all' ? 'scoped library' : `${formatFilter} tracks`}
          </div>
        </div>

        <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
          <div className="text-[11px] text-[#717786]">Weekly Average</div>
          <div className="mt-1 font-mono text-lg font-medium tabular-nums text-white">
            {summary.weeklyAvg >= 10
              ? Math.round(summary.weeklyAvg)
              : summary.weeklyAvg.toFixed(1)}
            <span className="text-xs text-[#6B7280] font-normal ml-1">/ wk</span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6B7280]">
            {summary.activeWeeks} of {WEEKS_WINDOW} weeks active
          </div>
        </div>

        <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
          <div className="text-[11px] text-[#717786]">Peak Week</div>
          <div className="mt-1 font-mono text-lg font-medium tabular-nums text-[#FF4D64] truncate">
            {summary.peakWeek ? `${summary.peakWeek.addedCount} tracks` : '—'}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6B7280] truncate">
            {summary.peakWeek ? summary.peakWeek.rangeLabel : 'No additions in window'}
          </div>
        </div>

        <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
          <div className="text-[11px] text-[#717786]">Last 4 Weeks vs Prior</div>
          <div
            className={`mt-1 font-mono text-lg font-medium tabular-nums ${
              summary.momentumDelta > 0
                ? 'text-[#22C55E]'
                : summary.momentumDelta < 0
                  ? 'text-[#F59E0B]'
                  : 'text-[#D1D5DB]'
            }`}
          >
            {summary.momentumDelta > 0
              ? `+${summary.momentumDelta}`
              : summary.momentumDelta < 0
                ? `${summary.momentumDelta}`
                : '0'}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6B7280]">
            {summary.recent4} added in last 4w
          </div>
        </div>
      </div>

      {/* Recharts LineChart */}
      {tracks.length === 0 ? (
        <div className="rounded-md border border-white/[0.06] bg-[#0D0F14] px-5 py-8 text-center">
          <p className="text-sm font-medium text-[#D1D5DB]">No tracks added yet</p>
          <p className="mt-1 text-xs text-[#717786] max-w-md mx-auto">
            Scan a local music folder or upload audio files to visualize your weekly library growth
            over the last 3 months.
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
        <div className="h-[245px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={weeklyData}
              margin={{ top: 14, right: 14, left: -12, bottom: 4 }}
              onClick={(state) => {
                const idx =
                  typeof state?.activeTooltipIndex === 'number'
                    ? state.activeTooltipIndex
                    : null;
                if (idx !== null && weeklyData[idx]) {
                  const wk = weeklyData[idx].weekKey;
                  setSelectedWeekKey((prev) => (prev === wk ? null : wk));
                }
              }}
            >
              <CartesianGrid
                vertical={false}
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="axisLabel"
                interval="preserveStartEnd"
                tick={{ fill: '#8B92A2', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: '#717786', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              <Tooltip
                content={<WeeklyAddedTooltip seriesMode={seriesMode} />}
                cursor={{ stroke: 'rgba(255,255,255,0.18)', strokeDasharray: '3 3' }}
              />
              {seriesMode === 'weekly' && summary.weeklyAvg > 0 && (
                <ReferenceLine
                  y={summary.weeklyAvg}
                  stroke="rgba(255,255,255,0.2)"
                  strokeDasharray="4 4"
                />
              )}
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke="#FF1F3D"
                strokeWidth={2.25}
                dot={(dotProps) => {
                  const { cx, cy, payload } = dotProps as {
                    cx?: number;
                    cy?: number;
                    payload?: WeeklyAddedDatum;
                  };
                  if (cx === undefined || cy === undefined || !payload) {
                    return <g key="empty" />;
                  }
                  const isSelected = selectedWeekKey === payload.weekKey;
                  const isActive = payload.addedCount > 0;
                  return (
                    <circle
                      key={payload.weekKey}
                      cx={cx}
                      cy={cy}
                      r={isSelected ? 5.5 : isActive ? 3.5 : 2}
                      fill={isSelected ? '#FFFFFF' : isActive ? '#FF4D64' : '#3F4554'}
                      stroke={isSelected ? '#FF1F3D' : '#12141A'}
                      strokeWidth={isSelected ? 2 : 1.25}
                      className="cursor-pointer"
                    />
                  );
                }}
                activeDot={{
                  r: 5.5,
                  fill: '#FF1F3D',
                  stroke: '#FFFFFF',
                  strokeWidth: 1.75,
                  className: 'cursor-pointer',
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Selected Week Drill-Down Tray */}
      {selectedWeek && (
        <div className="pt-4 border-t border-white/[0.08] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-white">
                Week of {selectedWeek.rangeLabel}
              </div>
              <div className="font-mono text-[11px] tabular-nums text-[#717786]">
                {selectedWeek.addedCount}{' '}
                {selectedWeek.addedCount === 1 ? 'track' : 'tracks'} added
                {selectedWeek.addedCount > 0
                  ? ` · ${formatTotalRuntime(selectedWeek.totalDuration)}`
                  : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selectedWeekIds.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => onPlayList(selectedWeekIds, { shuffle: false })}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-[#0B0C0E] bg-white hover:bg-[#E5E7EB] transition-colors whitespace-nowrap"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    <span>Play Week ({selectedWeekIds.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onCreatePlaylistFromTracks(selectedWeekIds)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-[#D1D5DB] bg-[#181B24] border border-white/[0.09] hover:text-white hover:bg-[#222634] transition-colors whitespace-nowrap"
                  >
                    <ListPlus className="h-3 w-3" />
                    <span>Playlist</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setSelectedWeekKey(null)}
                aria-label="Close week breakdown"
                className="p-1 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {selectedWeek.tracks.length === 0 ? (
            <div className="text-xs text-[#717786]">
              No tracks were added during this week.
            </div>
          ) : (
            <div className="max-h-[240px] overflow-y-auto divide-y divide-white/[0.06] rounded-md border border-white/[0.07] bg-[#0D0F14]">
              {selectedWeek.tracks.slice(0, 20).map((track) => {
                const isPlayingRow = activePlayingTrackId === track.id && isAudioPlaying;
                const genre = trackGenreMap.get(track.id)?.genre ?? inferTrackGenre(track).genre;
                return (
                  <div
                    key={track.id}
                    className="px-3.5 py-2 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => onPlayTrack(track.id, selectedWeekIds)}
                        aria-label={isPlayingRow ? `Pause ${track.title}` : `Play ${track.title}`}
                        className="h-6 w-6 rounded flex items-center justify-center bg-[#181B24] text-[#D1D5DB] hover:text-white transition-colors shrink-0"
                      >
                        {isPlayingRow ? (
                          <Pause className="h-3 w-3 text-[#FF4D64] fill-current" />
                        ) : (
                          <Play className="h-3 w-3 fill-current ml-0.5" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <div className="text-white font-medium truncate">{track.title}</div>
                        <div className="text-[11px] text-[#717786] truncate">
                          {track.artist} · {genre}
                        </div>
                      </div>
                    </div>
                    <div className="font-mono text-[11px] tabular-nums text-[#8B92A2] shrink-0">
                      {track.format} · {formatDuration(track.duration)}
                    </div>
                  </div>
                );
              })}
              {selectedWeek.tracks.length > 20 && (
                <div className="px-3.5 py-2 text-[11px] font-mono tabular-nums text-[#717786] text-center">
                  +{selectedWeek.tracks.length - 20} more tracks added this week
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
