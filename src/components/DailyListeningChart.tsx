import { useMemo, useState } from 'react';
import {
  BarChart3,
  Clock,
  FolderOpen,
  Pause,
  Play,
  Table2,
  X,
} from 'lucide-react';
import {
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

const DAYS_WINDOW = 30;

interface DailyListeningChartProps {
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

export interface DailyListeningDatum {
  dateKey: string; // YYYY-MM-DD (local)
  shortLabel: string; // e.g., "Nov 19"
  axisLabel: string; // e.g., "Nov 19" or "Today"
  fullDateLabel: string; // e.g., "Thu, Nov 19, 2026"
  isToday: boolean;
  totalSeconds: number;
  minutes: number; // precise minutes (2 decimals) for Recharts plotting
  plays: number;
  completedPlays: number;
  skippedPlays: number;
  uniqueTrackCount: number;
  topTrackLabel: string | null;
  entries: PlayHistoryEntry[];
}

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatListeningTime(seconds: number): string {
  const clean = Math.max(0, Math.round(seconds));
  if (clean === 0) return '0m';
  if (clean < 60) return `${clean}s`;
  const totalMins = Math.floor(clean / 60);
  const remSecs = clean % 60;
  if (totalMins < 60) {
    return remSecs > 0 && totalMins < 10 ? `${totalMins}m ${remSecs}s` : `${totalMins}m`;
  }
  const hrs = Math.floor(totalMins / 60);
  const remMins = totalMins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

function formatYAxisTick(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes >= 60) {
    const hrs = minutes / 60;
    return Number.isInteger(hrs) ? `${hrs}h` : `${hrs.toFixed(1)}h`;
  }
  return `${Math.round(minutes)}m`;
}

function getEffectiveEntrySeconds(entry: PlayHistoryEntry): number {
  if (Number.isFinite(entry.listenedSeconds) && entry.listenedSeconds > 0) {
    return entry.listenedSeconds;
  }
  if (entry.outcome === 'completed' && Number.isFinite(entry.duration) && entry.duration > 0) {
    return entry.duration;
  }
  return 0;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: DailyListeningDatum }>;
}

function DailyListeningTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-md border border-white/[0.12] bg-[#0F1116]/95 px-3 py-2.5 shadow-xl text-xs max-w-[240px]">
      <div className="flex items-center justify-between gap-4 font-medium text-white">
        <span>{item.fullDateLabel}</span>
        {item.isToday && <span className="text-[11px] text-[#FF4D64] font-mono">Today</span>}
      </div>

      {item.totalSeconds === 0 ? (
        <div className="mt-1.5 text-[11px] text-[#717786]">No listening recorded</div>
      ) : (
        <div className="mt-2 space-y-1 font-mono tabular-nums text-[11px] text-[#9CA3AF]">
          <div className="flex items-center justify-between gap-5">
            <span className="text-[#717786]">Listening Time</span>
            <span className="text-white font-medium">{formatListeningTime(item.totalSeconds)}</span>
          </div>
          <div className="flex items-center justify-between gap-5">
            <span className="text-[#717786]">Sessions</span>
            <span>
              {item.plays} ({item.completedPlays} done · {item.skippedPlays} skip)
            </span>
          </div>
          <div className="flex items-center justify-between gap-5">
            <span className="text-[#717786]">Unique Tracks</span>
            <span>{item.uniqueTrackCount}</span>
          </div>
          {item.topTrackLabel && (
            <div className="pt-1.5 mt-1.5 border-t border-white/[0.08] font-sans text-[11px] text-[#D1D5DB] truncate">
              Most played: <span className="text-white">{item.topTrackLabel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DailyListeningChart({
  tracks,
  trackMap,
  activeGenre,
  playHistory,
  activePlayingTrackId,
  isAudioPlaying,
  onPlayTrack,
  onPlayList,
  onMountFolder,
}: DailyListeningChartProps) {
  const [outcomeScope, setOutcomeScope] = useState<'all' | 'completed'>('all');
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [hoveredDateKey, setHoveredDateKey] = useState<string | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

  const scopedTrackIds = useMemo(() => new Set(tracks.map((t) => t.id)), [tracks]);

  const dailyData = useMemo<DailyListeningDatum[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const shortFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    const fullFmt = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    const buckets = new Map<
      string,
      {
        date: Date;
        isToday: boolean;
        totalSeconds: number;
        plays: number;
        completedPlays: number;
        skippedPlays: number;
        trackSeconds: Map<string, { label: string; seconds: number }>;
        entries: PlayHistoryEntry[];
      }
    >();

    const orderedKeys: string[] = [];
    for (let offset = DAYS_WINDOW - 1; offset >= 0; offset--) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      const key = toLocalDateKey(d);
      orderedKeys.push(key);
      buckets.set(key, {
        date: d,
        isToday: offset === 0,
        totalSeconds: 0,
        plays: 0,
        completedPlays: 0,
        skippedPlays: 0,
        trackSeconds: new Map(),
        entries: [],
      });
    }

    for (const entry of playHistory) {
      if (outcomeScope === 'completed' && entry.outcome !== 'completed') continue;
      if (activeGenre !== 'all' && !scopedTrackIds.has(entry.trackId)) continue;

      const playedDate = new Date(entry.playedAt);
      if (Number.isNaN(playedDate.getTime())) continue;
      const key = toLocalDateKey(playedDate);
      const bucket = buckets.get(key);
      if (!bucket) continue;

      const sec = getEffectiveEntrySeconds(entry);
      bucket.totalSeconds += sec;
      bucket.plays += 1;
      if (entry.outcome === 'completed') bucket.completedPlays += 1;
      else bucket.skippedPlays += 1;
      bucket.entries.push(entry);

      const prevTrack = bucket.trackSeconds.get(entry.trackId) ?? {
        label: entry.title,
        seconds: 0,
      };
      prevTrack.seconds += Math.max(sec, 1);
      bucket.trackSeconds.set(entry.trackId, prevTrack);
    }

    return orderedKeys.map((key) => {
      const b = buckets.get(key)!;
      let topTrackLabel: string | null = null;
      let topSec = -1;
      b.trackSeconds.forEach((info) => {
        if (info.seconds > topSec) {
          topSec = info.seconds;
          topTrackLabel = info.label;
        }
      });

      const shortLabel = shortFmt.format(b.date);
      return {
        dateKey: key,
        shortLabel,
        axisLabel: b.isToday ? 'Today' : shortLabel,
        fullDateLabel: fullFmt.format(b.date),
        isToday: b.isToday,
        totalSeconds: b.totalSeconds,
        minutes: Math.round((b.totalSeconds / 60) * 100) / 100,
        plays: b.plays,
        completedPlays: b.completedPlays,
        skippedPlays: b.skippedPlays,
        uniqueTrackCount: b.trackSeconds.size,
        topTrackLabel,
        entries: b.entries,
      };
    });
  }, [playHistory, outcomeScope, activeGenre, scopedTrackIds]);

  const summary = useMemo(() => {
    let totalSeconds = 0;
    let totalPlays = 0;
    let activeDays = 0;
    let peakDay: DailyListeningDatum | null = null;

    for (const day of dailyData) {
      totalSeconds += day.totalSeconds;
      totalPlays += day.plays;
      if (day.totalSeconds > 0) {
        activeDays += 1;
        if (!peakDay || day.totalSeconds > peakDay.totalSeconds) {
          peakDay = day;
        }
      }
    }

    // Current consecutive active-day streak ending today (or yesterday if today hasn't started yet)
    let streak = 0;
    for (let i = dailyData.length - 1; i >= 0; i--) {
      if (dailyData[i].totalSeconds > 0) {
        streak += 1;
      } else if (i === dailyData.length - 1) {
        continue;
      } else {
        break;
      }
    }

    const avgPerDaySeconds = totalSeconds / DAYS_WINDOW;
    const avgPerActiveDaySeconds = activeDays > 0 ? totalSeconds / activeDays : 0;

    return {
      totalSeconds,
      totalPlays,
      activeDays,
      peakDay,
      streak,
      avgPerDaySeconds,
      avgPerActiveDaySeconds,
      avgMinutes: Math.round((avgPerDaySeconds / 60) * 100) / 100,
    };
  }, [dailyData]);

  const activeTableRows = useMemo(
    () => dailyData.filter((d) => d.totalSeconds > 0).reverse(),
    [dailyData]
  );

  const selectedDay = useMemo(
    () => (selectedDateKey ? dailyData.find((d) => d.dateKey === selectedDateKey) ?? null : null),
    [selectedDateKey, dailyData]
  );

  const selectedDayQueueIds = useMemo(() => {
    if (!selectedDay) return [];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const entry of selectedDay.entries) {
      if (trackMap.has(entry.trackId) && !seen.has(entry.trackId)) {
        seen.add(entry.trackId);
        ids.push(entry.trackId);
      }
    }
    return ids;
  }, [selectedDay, trackMap]);

  const hasData = summary.totalSeconds > 0;

  // Show clean, evenly-spaced date ticks across the 30 days (index 0, 5, 10, 15, 20, 25, 29)
  const xTickValues = useMemo(() => {
    const indices = [0, 5, 10, 15, 20, 25, DAYS_WINDOW - 1];
    return indices
      .map((i) => dailyData[i]?.dateKey)
      .filter((k): k is string => Boolean(k));
  }, [dailyData]);

  const dateKeyToAxisLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of dailyData) {
      map.set(d.dateKey, d.axisLabel);
    }
    return map;
  }, [dailyData]);

  return (
    <section
      aria-label="Daily Listening Time over the Last 30 Days"
      className="rounded-lg border border-white/[0.08] bg-[#12141A] overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[#FF4D64] shrink-0" />
            <h2 className="font-display text-base font-semibold text-white truncate">
              {activeGenre === 'all'
                ? 'Daily Listening Time (Last 30 Days)'
                : `Daily Listening Time · ${activeGenre} (30 Days)`}
            </h2>
          </div>
          <p className="text-xs text-[#717786] mt-0.5 font-mono tabular-nums">
            {hasData
              ? `${formatListeningTime(summary.totalSeconds)} total across ${summary.totalPlays} session${summary.totalPlays === 1 ? '' : 's'} · ${summary.activeDays} active day${summary.activeDays === 1 ? '' : 's'}${summary.streak >= 2 ? ` · ${summary.streak}-day streak` : ''}`
              : 'Total playback duration aggregated by calendar day over the last 30 days'}
          </p>
        </div>

        {/* Interactive Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="inline-flex items-center p-0.5 rounded bg-[#0C0E13] border border-white/[0.08]"
            role="group"
            aria-label="Listening session filter"
          >
            <button
              type="button"
              onClick={() => setOutcomeScope('all')}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                outcomeScope === 'all'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-[#8B92A2] hover:text-white'
              }`}
            >
              All Plays
            </button>
            <button
              type="button"
              onClick={() => setOutcomeScope('completed')}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                outcomeScope === 'completed'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-[#8B92A2] hover:text-white'
              }`}
            >
              Finished Only
            </button>
          </div>

          <div
            className="inline-flex items-center p-0.5 rounded bg-[#0C0E13] border border-white/[0.08]"
            role="group"
            aria-label="Listening time view mode"
          >
            <button
              type="button"
              onClick={() => setViewMode('chart')}
              aria-label="Bar chart view"
              title="Bar chart view"
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'chart'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-[#8B92A2] hover:text-white'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-label="Daily breakdown table"
              title="Daily breakdown table"
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'table'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-[#8B92A2] hover:text-white'
              }`}
            >
              <Table2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Unboxed 4-Column Summary Strip (hairline divided, tabular-nums) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 px-5 py-4 border-b border-white/[0.07] bg-[#0F1116]/60">
        <div>
          <div className="text-[11px] text-[#717786]">30-Day Total</div>
          <div className="mt-0.5 font-mono text-lg font-medium tabular-nums text-white">
            {formatListeningTime(summary.totalSeconds)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#6B7280]">
            {summary.totalPlays} recorded {summary.totalPlays === 1 ? 'play' : 'plays'}
          </div>
        </div>

        <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
          <div className="text-[11px] text-[#717786]">Daily Average</div>
          <div className="mt-0.5 font-mono text-lg font-medium tabular-nums text-white">
            {formatListeningTime(summary.avgPerDaySeconds)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#6B7280]">
            {summary.activeDays > 0
              ? `${formatListeningTime(summary.avgPerActiveDaySeconds)} per active day`
              : '30-day rolling mean'}
          </div>
        </div>

        <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
          <div className="text-[11px] text-[#717786]">Peak Day</div>
          <div className="mt-0.5 font-mono text-lg font-medium tabular-nums text-white">
            {summary.peakDay ? formatListeningTime(summary.peakDay.totalSeconds) : '—'}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#6B7280]">
            {summary.peakDay
              ? `${summary.peakDay.axisLabel} · ${summary.peakDay.plays} ${summary.peakDay.plays === 1 ? 'play' : 'plays'}`
              : 'No peak recorded yet'}
          </div>
        </div>

        <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
          <div className="text-[11px] text-[#717786]">Active Days</div>
          <div className="mt-0.5 font-mono text-lg font-medium tabular-nums text-white">
            {summary.activeDays}
            <span className="text-xs text-[#6B7280] font-normal"> / {DAYS_WINDOW}</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#6B7280]">
            {summary.streak > 0
              ? `${summary.streak}-day current streak`
              : 'Play audio to start streak'}
          </div>
        </div>
      </div>

      {/* Main Visualization Body */}
      {viewMode === 'chart' ? (
        <div className="p-5 space-y-4">
          <div className="relative h-[240px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={dailyData}
                margin={{ top: 10, right: 8, left: -12, bottom: 2 }}
                barCategoryGap="22%"
                onMouseLeave={() => setHoveredDateKey(null)}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="rgba(255, 255, 255, 0.06)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="dateKey"
                  ticks={xTickValues}
                  tickFormatter={(val: string) => dateKeyToAxisLabel.get(val) ?? val}
                  axisLine={{ stroke: 'rgba(255, 255, 255, 0.08)' }}
                  tickLine={false}
                  tick={{ fill: '#717786', fontSize: 11, fontFamily: 'monospace' }}
                  dy={6}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  allowDecimals={summary.peakDay ? summary.peakDay.minutes < 5 : false}
                  domain={hasData ? [0, 'auto'] : [0, 30]}
                  tickFormatter={formatYAxisTick}
                  tick={{ fill: '#717786', fontSize: 11, fontFamily: 'monospace' }}
                />
                <Tooltip
                  content={<DailyListeningTooltip />}
                  cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
                />
                {hasData && summary.avgMinutes > 0 && (
                  <ReferenceLine
                    y={summary.avgMinutes}
                    stroke="rgba(255, 255, 255, 0.22)"
                    strokeDasharray="4 4"
                    label={{
                      value: `Avg ${formatListeningTime(summary.avgPerDaySeconds)}`,
                      position: 'insideTopRight',
                      fill: '#8B92A2',
                      fontSize: 10,
                      fontFamily: 'monospace',
                    }}
                  />
                )}
                <Bar
                  dataKey="minutes"
                  name="Listening Time"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={22}
                  animationDuration={280}
                  onMouseEnter={(_, idx) => {
                    const item = dailyData[idx];
                    if (item) setHoveredDateKey(item.dateKey);
                  }}
                  onClick={(_, idx) => {
                    const datum = dailyData[idx];
                    if (!datum || datum.totalSeconds <= 0) return;
                    setSelectedDateKey((prev) => (prev === datum.dateKey ? null : datum.dateKey));
                  }}
                >
                  {dailyData.map((entry) => {
                    const isPeak = summary.peakDay?.dateKey === entry.dateKey && entry.totalSeconds > 0;
                    const isSelected = selectedDateKey === entry.dateKey;
                    const isHovered = hoveredDateKey === entry.dateKey;
                    const isDimmed =
                      selectedDateKey !== null &&
                      selectedDateKey !== entry.dateKey &&
                      hoveredDateKey !== entry.dateKey;

                    const fill =
                      entry.totalSeconds === 0
                        ? 'rgba(255, 255, 255, 0.04)'
                        : isSelected || isHovered
                          ? '#FF4D64'
                          : isPeak
                            ? '#FF1F3D'
                            : '#E11D48';

                    return (
                      <Cell
                        key={entry.dateKey}
                        fill={fill}
                        fillOpacity={
                          entry.totalSeconds === 0
                            ? 1
                            : isDimmed
                              ? 0.35
                              : isSelected || isHovered || isPeak
                                ? 1
                                : 0.82
                        }
                        className={
                          entry.totalSeconds > 0
                            ? 'cursor-pointer transition-opacity duration-150'
                            : 'transition-opacity duration-150'
                        }
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Empty-state overlay inside the chart frame when no plays exist in the 30-day window */}
            {!hasData && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 bg-[#12141A]/55">
                <div className="pointer-events-auto text-center max-w-sm px-4 py-3">
                  <div className="text-sm font-medium text-[#E5E7EB]">
                    No listening activity in the last 30 days
                  </div>
                  <p className="mt-1 text-xs text-[#8B92A2] leading-relaxed">
                    Play songs in the audio player to build your daily listening timeline. Each
                    completed or skipped track logs its listening duration here.
                  </p>
                  <div className="mt-3.5 flex items-center justify-center gap-2">
                    {tracks.length > 0 ? (
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
                    ) : (
                      <button
                        type="button"
                        onClick={onMountFolder}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        <span>Mount Folder</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Interactive Selected Day Breakdown (appears when user clicks a bar) */}
          {selectedDay && selectedDay.entries.length > 0 && (
            <div className="pt-4 border-t border-white/[0.07] space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span className="font-medium text-white">{selectedDay.fullDateLabel}</span>
                  <span className="text-[#4B5563]" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono tabular-nums text-[#FF4D64]">
                    {formatListeningTime(selectedDay.totalSeconds)}
                  </span>
                  <span className="text-[#4B5563]" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono tabular-nums text-[#8B92A2]">
                    {selectedDay.plays} {selectedDay.plays === 1 ? 'session' : 'sessions'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDateKey(null)}
                  className="inline-flex items-center gap-1 text-xs text-[#8B92A2] hover:text-white transition-colors whitespace-nowrap"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Close</span>
                </button>
              </div>

              <div className="divide-y divide-white/[0.05] max-h-48 overflow-y-auto text-xs">
                {selectedDay.entries.map((entry) => {
                  const liveTrack = trackMap.get(entry.trackId);
                  const isActive = activePlayingTrackId === entry.trackId;
                  const listened = getEffectiveEntrySeconds(entry);
                  return (
                    <div
                      key={entry.id}
                      className="py-2 flex items-center justify-between gap-3 hover:bg-white/[0.02]"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {liveTrack ? (
                          <button
                            type="button"
                            onClick={() => onPlayTrack(liveTrack.id, selectedDayQueueIds)}
                            aria-label={
                              isActive && isAudioPlaying
                                ? `Pause ${entry.title}`
                                : `Play ${entry.title}`
                            }
                            className={`h-6 w-6 rounded flex items-center justify-center shrink-0 transition-colors ${
                              isActive
                                ? 'text-[#FF1F3D] bg-[#FF1F3D]/12'
                                : 'text-[#8B92A2] hover:text-white hover:bg-white/[0.07]'
                            }`}
                          >
                            {isActive && isAudioPlaying ? (
                              <Pause className="h-3 w-3 fill-current" />
                            ) : (
                              <Play className="h-3 w-3 fill-current ml-0.5" />
                            )}
                          </button>
                        ) : (
                          <span className="h-6 w-6 flex items-center justify-center text-[#525866] shrink-0">
                            <Clock className="h-3 w-3" />
                          </span>
                        )}
                        <div className="min-w-0">
                          <span className="font-medium text-white truncate block">
                            {entry.title}
                          </span>
                          <span className="text-[11px] text-[#717786] truncate block">
                            {entry.artist} · {entry.outcome === 'completed' ? 'Finished' : 'Skipped'}
                          </span>
                        </div>
                      </div>
                      <span className="font-mono tabular-nums text-[11px] text-[#A1A7B5] shrink-0">
                        {formatDuration(listened)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quiet Footer Guidance */}
          {hasData && !selectedDay && (
            <div className="pt-3 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-2 text-xs text-[#717786]">
              <span>Click any active bar to inspect tracks played on that day</span>
              <span className="font-mono tabular-nums">
                {dailyData[0]?.shortLabel} – {dailyData[dailyData.length - 1]?.shortLabel}
              </span>
            </div>
          )}
        </div>
      ) : (
        /* Daily Log Table View */
        <div className="overflow-x-auto">
          {activeTableRows.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#717786]">
              No active listening days recorded in the last 30 days.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#0F1116] border-b border-white/[0.07] text-[#717786]">
                <tr>
                  <th className="py-2.5 pl-5 pr-3 font-medium">Date</th>
                  <th className="py-2.5 px-3 font-medium">Listening Time</th>
                  <th className="py-2.5 px-3 font-medium text-right">Sessions</th>
                  <th className="py-2.5 px-3 font-medium text-right">Unique Tracks</th>
                  <th className="py-2.5 pl-3 pr-5 font-medium">Top Track</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {activeTableRows.map((day) => {
                  const pct =
                    summary.peakDay && summary.peakDay.totalSeconds > 0
                      ? Math.max(4, Math.round((day.totalSeconds / summary.peakDay.totalSeconds) * 100))
                      : 0;
                  return (
                    <tr
                      key={day.dateKey}
                      onClick={() => {
                        setSelectedDateKey(day.dateKey);
                        setViewMode('chart');
                      }}
                      className="hover:bg-white/[0.03] transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 pl-5 pr-3 font-medium text-white whitespace-nowrap">
                        {day.fullDateLabel}
                        {day.isToday && (
                          <span className="ml-2 text-[11px] font-mono text-[#FF4D64]">Today</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 w-48">
                        <div className="flex items-center justify-between font-mono tabular-nums text-[11px] mb-1">
                          <span className="text-white">{formatListeningTime(day.totalSeconds)}</span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-white/[0.07] overflow-hidden">
                          <div
                            className="h-full bg-[#FF1F3D]/85"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#A1A7B5] whitespace-nowrap">
                        {day.plays}{' '}
                        <span className="text-[#6B7280]">
                          ({day.completedPlays}/{day.skippedPlays})
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#A1A7B5]">
                        {day.uniqueTrackCount}
                      </td>
                      <td className="py-2.5 pl-3 pr-5 text-[#D1D5DB] truncate max-w-[220px]">
                        {day.topTrackLabel ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
