import { useMemo, useState } from 'react';
import {
  CalendarClock,
  Clock,
  FolderOpen,
  Grid2x2,
  Pause,
  Play,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LocalTrack, PlayHistoryEntry } from '../types/music';
import { formatDuration } from '../utils/youtubeLinks';

type HabitWindow = '7d' | '28d' | 'all';
type HabitViewMode = 'charts' | 'heatmap';

interface WeeklyListeningHabitsChartProps {
  tracks: LocalTrack[];
  trackMap: Map<string, LocalTrack>;
  activeGenre: string;
  playHistory: PlayHistoryEntry[];
  activePlayingTrackId: string | null;
  isAudioPlaying: boolean;
  onPlayTrack: (trackId: string, queueIds: string[]) => void;
  onPlayList: (trackIds: string[], options?: { shuffle?: boolean }) => void;
  onMountFolder: () => void;
}

interface WeekdayDatum {
  dayIndex: number; // 0 = Mon ... 6 = Sun
  shortLabel: string;
  fullLabel: string;
  isWeekend: boolean;
  totalSeconds: number;
  hours: number;
  plays: number;
  completedPlays: number;
  uniqueTracks: number;
  peakHour: number | null;
  entries: PlayHistoryEntry[];
}

interface HourlyDatum {
  hour: number; // 0..23
  axisLabel: string;
  rangeLabel: string;
  periodLabel: string;
  totalSeconds: number;
  hours: number;
  plays: number;
  entries: PlayHistoryEntry[];
}

interface HeatmapCell {
  dayIndex: number;
  blockIndex: number;
  dayLabel: string;
  blockLabel: string;
  totalSeconds: number;
  plays: number;
  entries: PlayHistoryEntry[];
}

const WEEKDAYS: Array<{ short: string; full: string; jsDay: number; isWeekend: boolean }> = [
  { short: 'Mon', full: 'Monday', jsDay: 1, isWeekend: false },
  { short: 'Tue', full: 'Tuesday', jsDay: 2, isWeekend: false },
  { short: 'Wed', full: 'Wednesday', jsDay: 3, isWeekend: false },
  { short: 'Thu', full: 'Thursday', jsDay: 4, isWeekend: false },
  { short: 'Fri', full: 'Friday', jsDay: 5, isWeekend: false },
  { short: 'Sat', full: 'Saturday', jsDay: 6, isWeekend: true },
  { short: 'Sun', full: 'Sunday', jsDay: 0, isWeekend: true },
];

const TIME_BLOCKS: Array<{ label: string; shortRange: string; startHour: number; endHour: number }> =
  [
    { label: 'Late Night', shortRange: '12a–4a', startHour: 0, endHour: 4 },
    { label: 'Early', shortRange: '4a–8a', startHour: 4, endHour: 8 },
    { label: 'Morning', shortRange: '8a–12p', startHour: 8, endHour: 12 },
    { label: 'Afternoon', shortRange: '12p–4p', startHour: 12, endHour: 16 },
    { label: 'Evening', shortRange: '4p–8p', startHour: 16, endHour: 20 },
    { label: 'Night', shortRange: '8p–12a', startHour: 20, endHour: 24 },
  ];

function getEffectiveEntrySeconds(entry: PlayHistoryEntry): number {
  if (Number.isFinite(entry.listenedSeconds) && entry.listenedSeconds > 0) {
    return entry.listenedSeconds;
  }
  if (entry.outcome === 'completed' && Number.isFinite(entry.duration) && entry.duration > 0) {
    return entry.duration;
  }
  return 0;
}

function formatHoursCompact(seconds: number): string {
  const clean = Math.max(0, Math.round(seconds));
  if (clean === 0) return '0m';
  if (clean < 60) return `${clean}s`;
  const totalMins = Math.floor(clean / 60);
  if (totalMins < 60) return `${totalMins}m`;
  const hrs = clean / 3600;
  return hrs >= 10 ? `${hrs.toFixed(1)}h` : `${hrs.toFixed(2).replace(/\.?0+$/, '')}h`;
}

function formatHour12(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function formatHourRange(hour: number): string {
  const start = ((hour % 24) + 24) % 24;
  const end = (start + 1) % 24;
  const fmt = (h: number) => {
    if (h === 0) return '12:00 AM';
    if (h === 12) return '12:00 PM';
    return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

function getTimePeriodLabel(hour: number): string {
  if (hour < 4) return 'Late Night';
  if (hour < 8) return 'Early Morning';
  if (hour < 12) return 'Morning';
  if (hour < 16) return 'Afternoon';
  if (hour < 20) return 'Evening';
  return 'Night';
}

function formatHourYAxis(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0';
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return mins > 0 ? `${mins}m` : '0';
  }
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function WeekdayTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: WeekdayDatum }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-md border border-white/[0.12] bg-[#0F1116]/95 px-3 py-2.5 shadow-xl text-xs min-w-[185px]">
      <div className="flex items-center justify-between gap-4 font-medium text-white">
        <span>{item.fullLabel}</span>
        {item.isWeekend && <span className="text-[10px] font-mono text-[#FF4D64]">Weekend</span>}
      </div>
      {item.totalSeconds === 0 ? (
        <div className="mt-1.5 text-[11px] text-[#717786]">No listening recorded</div>
      ) : (
        <div className="mt-2 space-y-1 font-mono tabular-nums text-[11px] text-[#9CA3AF]">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[#717786]">Hours Played</span>
            <span className="text-white font-medium">{formatHoursCompact(item.totalSeconds)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[#717786]">Sessions</span>
            <span>{item.plays}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[#717786]">Unique Tracks</span>
            <span>{item.uniqueTracks}</span>
          </div>
          {item.peakHour !== null && (
            <div className="flex items-center justify-between gap-4 pt-1 border-t border-white/[0.08]">
              <span className="text-[#717786]">Peak Hour</span>
              <span className="text-[#D1D5DB]">{formatHour12(item.peakHour)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HourlyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: HourlyDatum }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-md border border-white/[0.12] bg-[#0F1116]/95 px-3 py-2.5 shadow-xl text-xs min-w-[195px]">
      <div className="font-medium text-white">{item.rangeLabel}</div>
      <div className="text-[11px] text-[#717786] mt-0.5">{item.periodLabel}</div>
      {item.totalSeconds === 0 ? (
        <div className="mt-1.5 text-[11px] text-[#717786]">No listening in this hour</div>
      ) : (
        <div className="mt-2 space-y-1 font-mono tabular-nums text-[11px] text-[#9CA3AF]">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[#717786]">Time Played</span>
            <span className="text-white font-medium">{formatHoursCompact(item.totalSeconds)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[#717786]">Sessions</span>
            <span>{item.plays}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function WeeklyListeningHabitsChart({
  tracks,
  trackMap,
  activeGenre,
  playHistory,
  activePlayingTrackId,
  isAudioPlaying,
  onPlayTrack,
  onPlayList,
  onMountFolder,
}: WeeklyListeningHabitsChartProps) {
  const [windowMode, setWindowMode] = useState<HabitWindow>('28d');
  const [viewMode, setViewMode] = useState<HabitViewMode>('charts');
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<{ dayIndex: number; blockIndex: number } | null>(
    null
  );

  const scopedTrackIds = useMemo(() => new Set(tracks.map((t) => t.id)), [tracks]);

  const filteredEntries = useMemo(() => {
    const now = Date.now();
    const cutoff =
      windowMode === '7d'
        ? now - 7 * 86_400_000
        : windowMode === '28d'
          ? now - 28 * 86_400_000
          : 0;

    return playHistory.filter((entry) => {
      if (cutoff > 0 && entry.playedAt < cutoff) return false;
      if (activeGenre !== 'all' && !scopedTrackIds.has(entry.trackId)) return false;
      return true;
    });
  }, [playHistory, windowMode, activeGenre, scopedTrackIds]);

  const {
    weekdayData,
    hourlyData,
    heatmapGrid,
    maxHeatmapSeconds,
    summary,
  } = useMemo(() => {
    const jsDayToMondayIndex = (jsDay: number) => (jsDay === 0 ? 6 : jsDay - 1);

    const dayBuckets = WEEKDAYS.map((w, idx) => ({
      dayIndex: idx,
      shortLabel: w.short,
      fullLabel: w.full,
      isWeekend: w.isWeekend,
      totalSeconds: 0,
      plays: 0,
      completedPlays: 0,
      trackSet: new Set<string>(),
      hourTotals: new Array<number>(24).fill(0),
      entries: [] as PlayHistoryEntry[],
    }));

    const hourBuckets = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      totalSeconds: 0,
      plays: 0,
      entries: [] as PlayHistoryEntry[],
    }));

    const matrix: HeatmapCell[][] = WEEKDAYS.map((w, dayIdx) =>
      TIME_BLOCKS.map((b, blockIdx) => ({
        dayIndex: dayIdx,
        blockIndex: blockIdx,
        dayLabel: w.full,
        blockLabel: `${b.label} (${b.shortRange})`,
        totalSeconds: 0,
        plays: 0,
        entries: [],
      }))
    );

    let totalSeconds = 0;
    let weekdaySeconds = 0;
    let weekendSeconds = 0;

    for (const entry of filteredEntries) {
      const date = new Date(entry.playedAt);
      if (Number.isNaN(date.getTime())) continue;

      const sec = getEffectiveEntrySeconds(entry);
      const dayIdx = jsDayToMondayIndex(date.getDay());
      const hour = date.getHours();
      const blockIdx = Math.min(TIME_BLOCKS.length - 1, Math.floor(hour / 4));

      totalSeconds += sec;
      if (WEEKDAYS[dayIdx].isWeekend) weekendSeconds += sec;
      else weekdaySeconds += sec;

      const dBucket = dayBuckets[dayIdx];
      dBucket.totalSeconds += sec;
      dBucket.plays += 1;
      if (entry.outcome === 'completed') dBucket.completedPlays += 1;
      dBucket.trackSet.add(entry.trackId);
      dBucket.hourTotals[hour] += Math.max(sec, 1);
      dBucket.entries.push(entry);

      const hBucket = hourBuckets[hour];
      hBucket.totalSeconds += sec;
      hBucket.plays += 1;
      hBucket.entries.push(entry);

      const cell = matrix[dayIdx][blockIdx];
      cell.totalSeconds += sec;
      cell.plays += 1;
      cell.entries.push(entry);
    }

    const weekdaySeries: WeekdayDatum[] = dayBuckets.map((b) => {
      let peakHour: number | null = null;
      let peakSec = 0;
      for (let h = 0; h < 24; h++) {
        if (b.hourTotals[h] > peakSec) {
          peakSec = b.hourTotals[h];
          peakHour = h;
        }
      }
      return {
        dayIndex: b.dayIndex,
        shortLabel: b.shortLabel,
        fullLabel: b.fullLabel,
        isWeekend: b.isWeekend,
        totalSeconds: b.totalSeconds,
        hours: Math.round((b.totalSeconds / 3600) * 1000) / 1000,
        plays: b.plays,
        completedPlays: b.completedPlays,
        uniqueTracks: b.trackSet.size,
        peakHour,
        entries: b.entries,
      };
    });

    const hourlySeries: HourlyDatum[] = hourBuckets.map((b) => ({
      hour: b.hour,
      axisLabel: formatHour12(b.hour),
      rangeLabel: formatHourRange(b.hour),
      periodLabel: getTimePeriodLabel(b.hour),
      totalSeconds: b.totalSeconds,
      hours: Math.round((b.totalSeconds / 3600) * 1000) / 1000,
      plays: b.plays,
      entries: b.entries,
    }));

    let maxCellSec = 0;
    for (const row of matrix) {
      for (const cell of row) {
        if (cell.totalSeconds > maxCellSec) maxCellSec = cell.totalSeconds;
      }
    }

    let topDay: WeekdayDatum | null = null;
    for (const d of weekdaySeries) {
      if (d.totalSeconds > 0 && (!topDay || d.totalSeconds > topDay.totalSeconds)) {
        topDay = d;
      }
    }

    // Find peak 2-hour listening window for cleaner human insight
    let peakStartHour: number | null = null;
    let peakWindowSec = 0;
    for (let h = 0; h < 24; h++) {
      const twoHr = hourBuckets[h].totalSeconds + hourBuckets[(h + 1) % 24].totalSeconds;
      if (twoHr > peakWindowSec) {
        peakWindowSec = twoHr;
        peakStartHour = h;
      }
    }

    const avgDayHours = totalSeconds > 0 ? totalSeconds / 7 / 3600 : 0;
    const weekdayPct =
      totalSeconds > 0 ? Math.round((weekdaySeconds / totalSeconds) * 100) : 0;
    const weekendPct = totalSeconds > 0 ? 100 - weekdayPct : 0;

    return {
      weekdayData: weekdaySeries,
      hourlyData: hourlySeries,
      heatmapGrid: matrix,
      maxHeatmapSeconds: maxCellSec,
      summary: {
        totalSeconds,
        totalSessions: filteredEntries.length,
        avgDayHours,
        topDay,
        peakStartHour,
        peakPeriodLabel: peakStartHour !== null ? getTimePeriodLabel(peakStartHour) : null,
        peakRangeLabel:
          peakStartHour !== null
            ? `${formatHour12(peakStartHour)} – ${formatHour12((peakStartHour + 2) % 24)}`
            : null,
        weekdayPct,
        weekendPct,
      },
    };
  }, [filteredEntries]);

  // Resolve active drill-down entries (either from clicked weekday bar or clicked heatmap cell)
  const activeSelection = useMemo(() => {
    if (selectedBlock) {
      const cell = heatmapGrid[selectedBlock.dayIndex]?.[selectedBlock.blockIndex];
      if (cell) {
        return {
          title: `${cell.dayLabel} · ${cell.blockLabel}`,
          totalSeconds: cell.totalSeconds,
          plays: cell.plays,
          entries: cell.entries,
        };
      }
    }
    if (selectedDayIndex !== null) {
      const day = weekdayData[selectedDayIndex];
      if (day) {
        return {
          title: `${day.fullLabel} Listening Breakdown`,
          totalSeconds: day.totalSeconds,
          plays: day.plays,
          entries: day.entries,
        };
      }
    }
    return null;
  }, [selectedBlock, selectedDayIndex, heatmapGrid, weekdayData]);

  // Aggregate top tracks inside the active drill-down selection
  const selectionTopTracks = useMemo(() => {
    if (!activeSelection || activeSelection.entries.length === 0) return [];
    const byTrack = new Map<
      string,
      {
        trackId: string;
        title: string;
        artist: string;
        seconds: number;
        plays: number;
      }
    >();

    for (const entry of activeSelection.entries) {
      const existing = byTrack.get(entry.trackId) ?? {
        trackId: entry.trackId,
        title: entry.title,
        artist: entry.artist,
        seconds: 0,
        plays: 0,
      };
      existing.seconds += getEffectiveEntrySeconds(entry);
      existing.plays += 1;
      byTrack.set(entry.trackId, existing);
    }

    return Array.from(byTrack.values())
      .sort((a, b) => b.seconds - a.seconds || b.plays - a.plays)
      .slice(0, 6);
  }, [activeSelection]);

  const playableSelectionIds = useMemo(
    () => selectionTopTracks.filter((t) => trackMap.has(t.trackId)).map((t) => t.trackId),
    [selectionTopTracks, trackMap]
  );

  const windowCaption =
    windowMode === '7d'
      ? 'Last 7 days'
      : windowMode === '28d'
        ? 'Last 4 weeks'
        : 'All recorded history';

  const getHeatmapCellColor = (seconds: number, isSelected: boolean): string => {
    if (seconds <= 0 || maxHeatmapSeconds <= 0) {
      return isSelected
        ? 'bg-white/[0.08] border-[#FF4D64]/70'
        : 'bg-[#0D1016] border-white/[0.05] hover:border-white/[0.15]';
    }
    const ratio = seconds / maxHeatmapSeconds;
    const ring = isSelected ? 'border-[#FF4D64] ring-1 ring-[#FF4D64]/50' : 'border-white/[0.08] hover:border-white/[0.25]';
    if (ratio >= 0.78) return `bg-[#FF1F3D]/85 text-white ${ring}`;
    if (ratio >= 0.5) return `bg-[#FF1F3D]/55 text-white ${ring}`;
    if (ratio >= 0.25) return `bg-[#FF1F3D]/30 text-[#F3F4F6] ${ring}`;
    return `bg-[#FF1F3D]/14 text-[#D1D5DB] ${ring}`;
  };

  return (
    <section
      aria-label="Weekly listening habits breakdown"
      className="rounded-lg border border-white/[0.08] bg-[#12141A] p-5 sm:p-6 space-y-5"
    >
      {/* Header Row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-[#FF4D64] shrink-0" />
            <h2 className="font-display text-base font-semibold text-white">
              Weekly Listening Habits
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-[#717786]">
            Hours played by day of week and peak listening times · {windowCaption}
            {activeGenre !== 'all' ? ` · ${activeGenre}` : ''}
          </p>
        </div>

        {/* Interactive Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            role="tablist"
            aria-label="Listening habit time range"
            className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B0D12] border border-white/[0.08]"
          >
            {(
              [
                { id: '7d', label: '7D' },
                { id: '28d', label: '4W' },
                { id: 'all', label: 'All Time' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={windowMode === opt.id}
                onClick={() => {
                  setWindowMode(opt.id);
                  setSelectedDayIndex(null);
                  setSelectedBlock(null);
                }}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  windowMode === opt.id
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div
            role="tablist"
            aria-label="Habit visualization mode"
            className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B0D12] border border-white/[0.08]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'charts'}
              onClick={() => {
                setViewMode('charts');
                setSelectedBlock(null);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === 'charts'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-[#8B92A2] hover:text-white'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Day &amp; Peak</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'heatmap'}
              onClick={() => {
                setViewMode('heatmap');
                setSelectedDayIndex(null);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === 'heatmap'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-[#8B92A2] hover:text-white'
              }`}
            >
              <Grid2x2 className="h-3.5 w-3.5" />
              <span>Heatmap</span>
            </button>
          </div>
        </div>
      </div>

      {/* 4-Column Habit KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 py-3.5 px-4 rounded-md bg-[#0D0F14] border border-white/[0.06]">
        <div>
          <div className="text-[11px] text-[#717786]">Total Listening</div>
          <div className="mt-1 font-mono text-lg font-medium tabular-nums text-white">
            {formatHoursCompact(summary.totalSeconds)}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6B7280]">
            {summary.totalSessions} {summary.totalSessions === 1 ? 'session' : 'sessions'}
          </div>
        </div>

        <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
          <div className="text-[11px] text-[#717786]">Most Active Day</div>
          <div className="mt-1 font-mono text-lg font-medium tabular-nums text-white truncate">
            {summary.topDay ? summary.topDay.fullLabel : '—'}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6B7280]">
            {summary.topDay
              ? `${formatHoursCompact(summary.topDay.totalSeconds)} · ${summary.topDay.plays} plays`
              : 'No plays yet'}
          </div>
        </div>

        <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
          <div className="text-[11px] text-[#717786]">Peak Listening Window</div>
          <div className="mt-1 font-mono text-lg font-medium tabular-nums text-[#FF4D64] truncate">
            {summary.peakRangeLabel ?? '—'}
          </div>
          <div className="mt-0.5 text-[11px] text-[#6B7280] truncate">
            {summary.peakPeriodLabel ?? 'Play tracks to detect peak hours'}
          </div>
        </div>

        <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
          <div className="text-[11px] text-[#717786]">Weekday vs Weekend</div>
          <div className="mt-1 font-mono text-lg font-medium tabular-nums text-white">
            {summary.totalSeconds > 0
              ? `${summary.weekdayPct}% / ${summary.weekendPct}%`
              : '—'}
          </div>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden flex">
            {summary.totalSeconds > 0 && (
              <>
                <div
                  className="h-full bg-[#D1D5DB]/80"
                  style={{ width: `${summary.weekdayPct}%` }}
                />
                <div
                  className="h-full bg-[#FF1F3D]"
                  style={{ width: `${summary.weekendPct}%` }}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Visualization Body */}
      {summary.totalSessions === 0 ? (
        <div className="rounded-md border border-white/[0.06] bg-[#0D0F14] px-5 py-8 text-center">
          <p className="text-sm font-medium text-[#D1D5DB]">
            No weekly listening activity recorded for {windowCaption.toLowerCase()}
          </p>
          <p className="mt-1 text-xs text-[#717786] max-w-md mx-auto">
            Play tracks from your local audio library to populate hours played by weekday, peak
            listening hours, and your day-by-time listening heatmap.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            {windowMode !== 'all' && playHistory.length > 0 && (
              <button
                type="button"
                onClick={() => setWindowMode('all')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[#181B24] border border-white/[0.1] hover:bg-[#222634] transition-colors"
              >
                Show All-Time History
              </button>
            )}
            {tracks.length > 0 ? (
              <button
                type="button"
                onClick={() => onPlayList(tracks.map((t) => t.id), { shuffle: false })}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium text-[#0B0C0E] bg-white hover:bg-[#E5E7EB] transition-colors"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Start Listening</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onMountFolder}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span>Mount Local Folder</span>
              </button>
            )}
          </div>
        </div>
      ) : viewMode === 'charts' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left (6 cols): Hours Played by Day of Week (Mon-Sun Bar Chart) */}
          <div className="lg:col-span-6 flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-xs font-semibold text-white">Hours Played by Weekday</h3>
                <p className="text-[11px] text-[#717786]">
                  Click a day bar to inspect top tracks played
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-[#717786]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-[#D1D5DB]/75" />
                  Weekday
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-[#FF1F3D]" />
                  Peak / Weekend
                </span>
              </div>
            </div>

            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={weekdayData}
                  margin={{ top: 10, right: 8, left: -12, bottom: 0 }}
                  onClick={(state) => {
                    const idx =
                      typeof state?.activeTooltipIndex === 'number'
                        ? state.activeTooltipIndex
                        : null;
                    if (idx !== null && weekdayData[idx]) {
                      setSelectedBlock(null);
                      setSelectedDayIndex((prev) => (prev === idx ? null : idx));
                    }
                  }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="rgba(255,255,255,0.06)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="shortLabel"
                    tick={{ fill: '#8B92A2', fontSize: 11 }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={formatHourYAxis}
                    tick={{ fill: '#717786', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={46}
                  />
                  <Tooltip
                    content={<WeekdayTooltip />}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  />
                  {summary.avgDayHours > 0 && (
                    <ReferenceLine
                      y={summary.avgDayHours}
                      stroke="rgba(255,255,255,0.22)"
                      strokeDasharray="4 4"
                    />
                  )}
                  <Bar dataKey="hours" radius={[4, 4, 0, 0]} maxBarSize={38} className="cursor-pointer">
                    {weekdayData.map((entry, idx) => {
                      const isPeak = summary.topDay?.dayIndex === entry.dayIndex;
                      const isSelected = selectedDayIndex === idx;
                      let fill = entry.isWeekend
                        ? 'rgba(255, 77, 100, 0.72)'
                        : 'rgba(209, 213, 219, 0.65)';
                      if (isPeak) fill = '#FF1F3D';
                      if (selectedDayIndex !== null && !isSelected) {
                        fill = 'rgba(139, 146, 162, 0.28)';
                      }
                      if (isSelected) fill = '#FF4D64';
                      return <Cell key={entry.shortLabel} fill={fill} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right (6 cols): Peak Listening Times (24-Hour Curve AreaChart) */}
          <div className="lg:col-span-6 lg:border-l lg:border-white/[0.07] lg:pl-6 flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-xs font-semibold text-white">Peak Listening Times (24h)</h3>
                <p className="text-[11px] text-[#717786]">
                  When you listen most throughout the day
                </p>
              </div>
              {summary.peakRangeLabel && (
                <span className="font-mono text-[11px] tabular-nums text-[#FF4D64]">
                  Peak: {summary.peakRangeLabel}
                </span>
              )}
            </div>

            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={hourlyData}
                  margin={{ top: 10, right: 8, left: -12, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="weeklyPeakAreaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#FF1F3D" stopOpacity={0.42} />
                      <stop offset="95%" stopColor="#FF1F3D" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    vertical={false}
                    stroke="rgba(255,255,255,0.06)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="axisLabel"
                    interval={3}
                    tick={{ fill: '#8B92A2', fontSize: 11 }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={formatHourYAxis}
                    tick={{ fill: '#717786', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={46}
                  />
                  <Tooltip
                    content={<HourlyTooltip />}
                    cursor={{ stroke: 'rgba(255,255,255,0.18)', strokeDasharray: '3 3' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="hours"
                    stroke="#FF4D64"
                    strokeWidth={2}
                    fill="url(#weeklyPeakAreaFill)"
                    activeDot={{ r: 4, fill: '#FF1F3D', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ) : (
        /* Day x Time-of-Day Interactive Heatmap */
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-[#8B92A2]">
              Click any time slot to inspect the songs played during that window.
            </span>
            <div className="flex items-center gap-1.5 text-[11px] text-[#717786]">
              <span>Less</span>
              <span className="h-2.5 w-2.5 rounded-sm bg-[#0D1016] border border-white/[0.08]" />
              <span className="h-2.5 w-2.5 rounded-sm bg-[#FF1F3D]/18" />
              <span className="h-2.5 w-2.5 rounded-sm bg-[#FF1F3D]/45" />
              <span className="h-2.5 w-2.5 rounded-sm bg-[#FF1F3D]/85" />
              <span>More</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[540px] grid grid-cols-[64px_repeat(6,minmax(0,1fr))] gap-1.5">
              {/* Header row */}
              <div />
              {TIME_BLOCKS.map((block) => (
                <div key={block.label} className="text-center pb-1">
                  <div className="text-[11px] font-medium text-[#D1D5DB]">{block.label}</div>
                  <div className="font-mono text-[10px] text-[#6B7280]">{block.shortRange}</div>
                </div>
              ))}

              {/* Day rows */}
              {heatmapGrid.map((row, dayIdx) => (
                <div key={WEEKDAYS[dayIdx].short} className="contents">
                  <div className="flex items-center text-xs font-medium text-[#9CA3AF] pr-2">
                    <span>{WEEKDAYS[dayIdx].short}</span>
                  </div>
                  {row.map((cell) => {
                    const isSelected =
                      selectedBlock?.dayIndex === cell.dayIndex &&
                      selectedBlock?.blockIndex === cell.blockIndex;
                    return (
                      <button
                        key={`${cell.dayIndex}-${cell.blockIndex}`}
                        type="button"
                        onClick={() => {
                          setSelectedDayIndex(null);
                          setSelectedBlock((prev) =>
                            prev &&
                            prev.dayIndex === cell.dayIndex &&
                            prev.blockIndex === cell.blockIndex
                              ? null
                              : { dayIndex: cell.dayIndex, blockIndex: cell.blockIndex }
                          );
                        }}
                        title={`${cell.dayLabel} ${cell.blockLabel}: ${formatHoursCompact(cell.totalSeconds)} (${cell.plays} plays)`}
                        className={`h-9 rounded border text-[11px] font-mono tabular-nums transition-colors flex items-center justify-center ${getHeatmapCellColor(
                          cell.totalSeconds,
                          isSelected
                        )}`}
                      >
                        {cell.totalSeconds > 0 ? formatHoursCompact(cell.totalSeconds) : '·'}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Drill-down panel for selected weekday or heatmap cell */}
      {activeSelection && (
        <div className="pt-4 border-t border-white/[0.08] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-white">{activeSelection.title}</div>
              <div className="font-mono text-[11px] tabular-nums text-[#717786]">
                {formatHoursCompact(activeSelection.totalSeconds)} · {activeSelection.plays}{' '}
                {activeSelection.plays === 1 ? 'session' : 'sessions'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {playableSelectionIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => onPlayList(playableSelectionIds, { shuffle: false })}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-[#0B0C0E] bg-white hover:bg-[#E5E7EB] transition-colors whitespace-nowrap"
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>Play Top ({playableSelectionIds.length})</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setSelectedDayIndex(null);
                  setSelectedBlock(null);
                }}
                aria-label="Clear selection"
                className="p-1 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {selectionTopTracks.length === 0 ? (
            <div className="text-xs text-[#717786]">No tracks recorded in this slot.</div>
          ) : (
            <div className="divide-y divide-white/[0.06] rounded-md border border-white/[0.07] bg-[#0D0F14]">
              {selectionTopTracks.map((item) => {
                const track = trackMap.get(item.trackId);
                const isPlayingRow = activePlayingTrackId === item.trackId && isAudioPlaying;
                return (
                  <div
                    key={item.trackId}
                    className="px-3.5 py-2 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button
                        type="button"
                        disabled={!track}
                        onClick={() =>
                          track && onPlayTrack(track.id, playableSelectionIds)
                        }
                        aria-label={isPlayingRow ? `Pause ${item.title}` : `Play ${item.title}`}
                        className="h-6 w-6 rounded flex items-center justify-center bg-[#181B24] text-[#D1D5DB] hover:text-white disabled:opacity-35 transition-colors shrink-0"
                      >
                        {isPlayingRow ? (
                          <Pause className="h-3 w-3 text-[#FF4D64] fill-current" />
                        ) : (
                          <Play className="h-3 w-3 fill-current ml-0.5" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <div className="text-white font-medium truncate">{item.title}</div>
                        <div className="text-[11px] text-[#717786] truncate">{item.artist}</div>
                      </div>
                    </div>
                    <div className="font-mono text-[11px] tabular-nums text-[#8B92A2] shrink-0">
                      {formatDuration(item.seconds)} · {item.plays}×
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
