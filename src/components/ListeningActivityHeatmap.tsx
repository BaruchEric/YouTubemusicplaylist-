import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { FolderOpen, Grid2x2, Pause, Play, X } from 'lucide-react';
import type { LocalTrack, PlayHistoryEntry } from '../types/music';
import { formatDuration } from '../utils/youtubeLinks';

type HeatmapMetric = 'duration' | 'plays';
type HeatmapWindow = '7d' | '30d' | 'all';
type HeatmapOutcome = 'all' | 'completed';

interface ListeningActivityHeatmapProps {
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

interface DayHourCell {
  key: string;
  dayIndex: number; // 0 = Mon ... 6 = Sun
  dayShort: string;
  dayFull: string;
  hour: number; // 0..23
  totalSeconds: number;
  minutes: number;
  plays: number;
  completedPlays: number;
  skippedPlays: number;
  uniqueTracks: number;
  topTrackLabel: string | null;
  entries: PlayHistoryEntry[];
}

interface HoveredTooltipState {
  cell: DayHourCell;
  x: number;
  y: number;
}

const WEEKDAYS = [
  { short: 'Mon', full: 'Monday' },
  { short: 'Tue', full: 'Tuesday' },
  { short: 'Wed', full: 'Wednesday' },
  { short: 'Thu', full: 'Thursday' },
  { short: 'Fri', full: 'Friday' },
  { short: 'Sat', full: 'Saturday' },
  { short: 'Sun', full: 'Sunday' },
] as const;

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function getEffectiveEntrySeconds(entry: PlayHistoryEntry): number {
  if (Number.isFinite(entry.listenedSeconds) && entry.listenedSeconds > 0) {
    return entry.listenedSeconds;
  }
  if (entry.outcome === 'completed' && Number.isFinite(entry.duration) && entry.duration > 0) {
    return entry.duration;
  }
  return 0;
}

function formatHourShort(hour: number): string {
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

function formatCompactDuration(seconds: number): string {
  const clean = Math.max(0, Math.round(seconds));
  if (clean === 0) return '0m';
  if (clean < 60) return `${clean}s`;
  const mins = Math.floor(clean / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

function getPeriodName(hour: number): string {
  if (hour < 6) return 'Late Night (00–06)';
  if (hour < 12) return 'Morning (06–12)';
  if (hour < 18) return 'Afternoon (12–18)';
  return 'Evening (18–24)';
}

export function ListeningActivityHeatmap({
  tracks,
  trackMap,
  activeGenre,
  playHistory,
  activePlayingTrackId,
  isAudioPlaying,
  onPlayTrack,
  onPlayList,
  onMountFolder,
}: ListeningActivityHeatmapProps) {
  const [metric, setMetric] = useState<HeatmapMetric>('duration');
  const [windowMode, setWindowMode] = useState<HeatmapWindow>('30d');
  const [outcomeScope, setOutcomeScope] = useState<HeatmapOutcome>('all');
  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null);
  const [hoveredTooltip, setHoveredTooltip] = useState<HoveredTooltipState | null>(null);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(860);

  // Track responsive container width for sharp D3 scaleBand rendering
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const updateWidth = () => {
      const next = Math.max(580, Math.floor(el.clientWidth));
      setContainerWidth((prev) => (Math.abs(prev - next) >= 4 ? next : prev));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scopedTrackIds = useMemo(() => new Set(tracks.map((t) => t.id)), [tracks]);

  const filteredEntries = useMemo(() => {
    const now = Date.now();
    const cutoff =
      windowMode === '7d'
        ? now - 7 * 86_400_000
        : windowMode === '30d'
          ? now - 30 * 86_400_000
          : 0;

    return playHistory.filter((entry) => {
      if (cutoff > 0 && entry.playedAt < cutoff) return false;
      if (outcomeScope === 'completed' && entry.outcome !== 'completed') return false;
      if (activeGenre !== 'all' && !scopedTrackIds.has(entry.trackId)) return false;
      return true;
    });
  }, [playHistory, windowMode, outcomeScope, activeGenre, scopedTrackIds]);

  const {
    cells,
    cellMap,
    dayTotals,
    hourTotals,
    maxValue,
    summary,
  } = useMemo(() => {
    const jsDayToMonIdx = (jsDay: number) => (jsDay === 0 ? 6 : jsDay - 1);

    const grid: Array<{
      dayIndex: number;
      hour: number;
      totalSeconds: number;
      plays: number;
      completedPlays: number;
      skippedPlays: number;
      trackSeconds: Map<string, { label: string; seconds: number }>;
      entries: PlayHistoryEntry[];
    }> = [];

    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        grid.push({
          dayIndex: d,
          hour: h,
          totalSeconds: 0,
          plays: 0,
          completedPlays: 0,
          skippedPlays: 0,
          trackSeconds: new Map(),
          entries: [],
        });
      }
    }

    for (const entry of filteredEntries) {
      const dt = new Date(entry.playedAt);
      if (Number.isNaN(dt.getTime())) continue;
      const d = jsDayToMonIdx(dt.getDay());
      const h = dt.getHours();
      const bucket = grid[d * 24 + h];
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

    const builtCells: DayHourCell[] = grid.map((b) => {
      let topTrackLabel: string | null = null;
      let topSec = -1;
      b.trackSeconds.forEach((info) => {
        if (info.seconds > topSec) {
          topSec = info.seconds;
          topTrackLabel = info.label;
        }
      });

      return {
        key: `${b.dayIndex}-${b.hour}`,
        dayIndex: b.dayIndex,
        dayShort: WEEKDAYS[b.dayIndex].short,
        dayFull: WEEKDAYS[b.dayIndex].full,
        hour: b.hour,
        totalSeconds: b.totalSeconds,
        minutes: Math.round((b.totalSeconds / 60) * 100) / 100,
        plays: b.plays,
        completedPlays: b.completedPlays,
        skippedPlays: b.skippedPlays,
        uniqueTracks: b.trackSeconds.size,
        topTrackLabel,
        entries: b.entries,
      };
    });

    const map = new Map<string, DayHourCell>();
    const dTotals = new Array<number>(7).fill(0);
    const hTotals = new Array<number>(24).fill(0);
    const periodTotals = [0, 0, 0, 0]; // 0-6, 6-12, 12-18, 18-24

    let maxVal = 0;
    let activeSlots = 0;
    let totalActiveMetric = 0;
    let hottestCell: DayHourCell | null = null;
    let hottestMetric = 0;

    for (const cell of builtCells) {
      map.set(cell.key, cell);
      const val = metric === 'duration' ? cell.totalSeconds : cell.plays;
      dTotals[cell.dayIndex] += val;
      hTotals[cell.hour] += val;
      periodTotals[Math.floor(cell.hour / 6)] += val;

      if (val > 0) {
        activeSlots += 1;
        totalActiveMetric += val;
        if (val > maxVal) maxVal = val;
        if (val > hottestMetric) {
          hottestMetric = val;
          hottestCell = cell;
        }
      }
    }

    let dominantPeriodIdx = -1;
    let dominantPeriodVal = 0;
    periodTotals.forEach((v, idx) => {
      if (v > dominantPeriodVal) {
        dominantPeriodVal = v;
        dominantPeriodIdx = idx;
      }
    });

    const periodLabels = [
      'Late Night (12a–6a)',
      'Morning (6a–12p)',
      'Afternoon (12p–6p)',
      'Evening (6p–12a)',
    ];

    const avgPerActiveSlot = activeSlots > 0 ? totalActiveMetric / activeSlots : 0;

    return {
      cells: builtCells,
      cellMap: map,
      dayTotals: dTotals,
      hourTotals: hTotals,
      maxValue: maxVal,
      summary: {
        activeSlots,
        totalSessions: filteredEntries.length,
        hottestCell,
        dominantPeriod: dominantPeriodIdx >= 0 ? periodLabels[dominantPeriodIdx] : null,
        dominantPeriodShare:
          totalActiveMetric > 0 && dominantPeriodVal > 0
            ? Math.round((dominantPeriodVal / totalActiveMetric) * 100)
            : 0,
        avgPerActiveSlot,
      },
    };
  }, [filteredEntries, metric]);

  // Render D3 7x24 Listening Activity Heatmap + Marginal Hourly & Weekday Summary Bars
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const marginTop = 44; // Space for marginal hourly spark-bars + top hour labels
    const marginRight = 76; // Space for marginal weekday total bars
    const marginBottom = 22;
    const marginLeft = 42;

    const gridWidth = Math.max(460, containerWidth - marginLeft - marginRight);
    const cellHeight = 26;
    const cellGap = 3;
    const gridHeight = WEEKDAYS.length * (cellHeight + cellGap) - cellGap;
    const totalHeight = marginTop + gridHeight + marginBottom;

    svg
      .attr('width', containerWidth)
      .attr('height', totalHeight)
      .attr('viewBox', `0 0 ${containerWidth} ${totalHeight}`);

    const xScale = d3
      .scaleBand<number>()
      .domain(HOURS)
      .range([0, gridWidth])
      .paddingInner(0.14)
      .paddingOuter(0.04);

    const yScale = d3
      .scaleBand<number>()
      .domain(d3.range(7))
      .range([0, gridHeight])
      .paddingInner(0.11)
      .paddingOuter(0.02);

    // Custom obsidian-to-crimson sequential color interpolator
    const intensityInterpolator = d3.interpolateRgbBasis([
      '#24141B',
      '#6E1728',
      '#BD1B36',
      '#FF1F3D',
      '#FF6B7E',
    ]);

    const colorScale = d3
      .scaleSequential(intensityInterpolator)
      .domain([0, Math.max(1, maxValue)]);

    const getCellValue = (cell: DayHourCell) =>
      metric === 'duration' ? cell.totalSeconds : cell.plays;

    // 1. Top Marginal Hourly Spark-Bars (quiet contextual volume per hour)
    const maxHourTotal = d3.max(hourTotals) ?? 0;
    const topSparkMaxH = 18;
    const topSparkGroup = svg
      .append('g')
      .attr('transform', `translate(${marginLeft}, 6)`);

    topSparkGroup
      .selectAll('rect')
      .data(HOURS)
      .join('rect')
      .attr('x', (h) => xScale(h) ?? 0)
      .attr('width', xScale.bandwidth())
      .attr('y', (h) => {
        if (maxHourTotal <= 0 || hourTotals[h] <= 0) return topSparkMaxH - 2;
        const barH = Math.max(2, (hourTotals[h] / maxHourTotal) * topSparkMaxH);
        return topSparkMaxH - barH;
      })
      .attr('height', (h) => {
        if (maxHourTotal <= 0 || hourTotals[h] <= 0) return 2;
        return Math.max(2, (hourTotals[h] / maxHourTotal) * topSparkMaxH);
      })
      .attr('rx', 1.5)
      .attr('fill', (h) =>
        maxHourTotal > 0 && hourTotals[h] > 0
          ? hourTotals[h] === maxHourTotal
            ? '#FF4D64'
            : 'rgba(209, 213, 219, 0.34)'
          : 'rgba(255, 255, 255, 0.05)'
      );

    // 2. Top Hour Labels (every 2 hours for crisp legibility)
    const xAxisGroup = svg
      .append('g')
      .attr('transform', `translate(${marginLeft}, ${marginTop - 8})`);

    xAxisGroup
      .selectAll('text')
      .data(HOURS.filter((h) => h % 2 === 0))
      .join('text')
      .attr('x', (h) => (xScale(h) ?? 0) + xScale.bandwidth() / 2)
      .attr('y', 0)
      .attr('text-anchor', 'middle')
      .attr('fill', '#717786')
      .attr('font-size', '10px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .text((h) => formatHourShort(h));

    // 3. Left Weekday Labels
    const yAxisGroup = svg
      .append('g')
      .attr('transform', `translate(${marginLeft - 10}, ${marginTop})`);

    yAxisGroup
      .selectAll('text')
      .data(WEEKDAYS)
      .join('text')
      .attr('x', 0)
      .attr('y', (_, idx) => (yScale(idx) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('fill', (_, idx) => (idx >= 5 ? '#D1D5DB' : '#8B92A2'))
      .attr('font-size', '11px')
      .attr('font-weight', (_, idx) => (idx >= 5 ? '500' : '400'))
      .text((d) => d.short);

    // 4. Main 7x24 Heatmap Matrix
    const matrixGroup = svg
      .append('g')
      .attr('transform', `translate(${marginLeft}, ${marginTop})`);

    // Subtle 6-hour quadrant guide lines (6a, 12p, 6p)
    const quadrantHours = [6, 12, 18];
    matrixGroup
      .selectAll('line.quadrant-guide')
      .data(quadrantHours)
      .join('line')
      .attr('class', 'quadrant-guide')
      .attr('x1', (h) => (xScale(h) ?? 0) - xScale.step() * 0.07)
      .attr('x2', (h) => (xScale(h) ?? 0) - xScale.step() * 0.07)
      .attr('y1', -3)
      .attr('y2', gridHeight + 3)
      .attr('stroke', 'rgba(255,255,255,0.08)')
      .attr('stroke-dasharray', '2 3');

    matrixGroup
      .selectAll('rect.heat-cell')
      .data(cells)
      .join('rect')
      .attr('class', 'heat-cell')
      .attr('x', (d) => xScale(d.hour) ?? 0)
      .attr('y', (d) => yScale(d.dayIndex) ?? 0)
      .attr('width', xScale.bandwidth())
      .attr('height', yScale.bandwidth())
      .attr('rx', 3)
      .attr('fill', (d) => {
        const v = getCellValue(d);
        if (v <= 0 || maxValue <= 0) return '#0D1016';
        // Apply mild gamma curve (0.78) so mid-range listening hours stay clearly distinguishable
        const normalized = Math.pow(v / maxValue, 0.78) * maxValue;
        return colorScale(normalized);
      })
      .attr('stroke', (d) => {
        if (selectedCellKey === d.key) return '#FFFFFF';
        return getCellValue(d) > 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)';
      })
      .attr('stroke-width', (d) => (selectedCellKey === d.key ? 1.5 : 1))
      .style('cursor', 'pointer')
      .on('mouseenter', function (_event, d) {
        d3.select(this)
          .attr('stroke', '#FFFFFF')
          .attr('stroke-width', 1.5);
        const cx = marginLeft + (xScale(d.hour) ?? 0) + xScale.bandwidth() / 2;
        const cy = marginTop + (yScale(d.dayIndex) ?? 0);
        setHoveredTooltip({ cell: d, x: cx, y: cy });
      })
      .on('mouseleave', function (_event, d) {
        d3.select(this)
          .attr('stroke', () => {
            if (selectedCellKey === d.key) return '#FFFFFF';
            return getCellValue(d) > 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)';
          })
          .attr('stroke-width', selectedCellKey === d.key ? 1.5 : 1);
        setHoveredTooltip(null);
      })
      .on('click', (_event, d) => {
        setSelectedCellKey((prev) => (prev === d.key ? null : d.key));
      });

    // 5. Right Marginal Weekday Totals (Horizontal D3 summary bar + tabular readout)
    const maxDayTotal = d3.max(dayTotals) ?? 0;
    const rightGroup = svg
      .append('g')
      .attr('transform', `translate(${marginLeft + gridWidth + 12}, ${marginTop})`);

    const barMaxW = Math.max(24, marginRight - 46);

    rightGroup
      .selectAll('rect.day-bar-bg')
      .data(dayTotals)
      .join('rect')
      .attr('x', 0)
      .attr('y', (_, idx) => (yScale(idx) ?? 0) + yScale.bandwidth() / 2 - 3)
      .attr('width', barMaxW)
      .attr('height', 6)
      .attr('rx', 2)
      .attr('fill', 'rgba(255,255,255,0.05)');

    rightGroup
      .selectAll('rect.day-bar-fill')
      .data(dayTotals)
      .join('rect')
      .attr('x', 0)
      .attr('y', (_, idx) => (yScale(idx) ?? 0) + yScale.bandwidth() / 2 - 3)
      .attr('width', (val) =>
        maxDayTotal > 0 && val > 0 ? Math.max(3, (val / maxDayTotal) * barMaxW) : 0
      )
      .attr('height', 6)
      .attr('rx', 2)
      .attr('fill', (val) => (val === maxDayTotal && val > 0 ? '#FF4D64' : '#9CA3AF'));

    rightGroup
      .selectAll('text.day-total-label')
      .data(dayTotals)
      .join('text')
      .attr('x', barMaxW + 6)
      .attr('y', (_, idx) => (yScale(idx) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('fill', (val) => (val > 0 ? '#9CA3AF' : '#4B5563'))
      .attr('font-size', '10px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .text((val) => {
        if (val <= 0) return '—';
        return metric === 'duration' ? formatCompactDuration(val) : `${val}`;
      });

    // 6. Subtle Period Footer Labels (Late Night / Morning / Afternoon / Evening)
    const footerPeriods = [
      { label: 'Late Night', centerHour: 2.5 },
      { label: 'Morning', centerHour: 8.5 },
      { label: 'Afternoon', centerHour: 14.5 },
      { label: 'Evening', centerHour: 20.5 },
    ];
    const footerGroup = svg
      .append('g')
      .attr('transform', `translate(${marginLeft}, ${marginTop + gridHeight + 16})`);

    footerGroup
      .selectAll('text')
      .data(footerPeriods)
      .join('text')
      .attr('x', (p) => {
        const base = xScale(Math.floor(p.centerHour)) ?? 0;
        return base + xScale.step() * 0.5;
      })
      .attr('y', 0)
      .attr('text-anchor', 'middle')
      .attr('fill', '#6B7280')
      .attr('font-size', '10px')
      .text((p) => p.label);
  }, [cells, dayTotals, hourTotals, maxValue, metric, containerWidth, selectedCellKey]);

  const selectedCell = selectedCellKey ? cellMap.get(selectedCellKey) ?? null : null;

  const selectedSlotTracks = useMemo(() => {
    if (!selectedCell || selectedCell.entries.length === 0) return [];
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

    for (const entry of selectedCell.entries) {
      const prev = byTrack.get(entry.trackId) ?? {
        trackId: entry.trackId,
        title: entry.title,
        artist: entry.artist,
        seconds: 0,
        plays: 0,
      };
      prev.seconds += getEffectiveEntrySeconds(entry);
      prev.plays += 1;
      byTrack.set(entry.trackId, prev);
    }

    return Array.from(byTrack.values())
      .sort((a, b) => b.seconds - a.seconds || b.plays - a.plays)
      .slice(0, 8);
  }, [selectedCell]);

  const playableSlotIds = useMemo(
    () => selectedSlotTracks.filter((t) => trackMap.has(t.trackId)).map((t) => t.trackId),
    [selectedSlotTracks, trackMap]
  );

  const windowLabel =
    windowMode === '7d'
      ? 'Last 7 days'
      : windowMode === '30d'
        ? 'Last 30 days'
        : 'All recorded history';

  return (
    <section
      aria-label="Listening Activity Day-by-Hour Heatmap"
      className="rounded-lg border border-white/[0.08] bg-[#12141A] p-5 sm:p-6 space-y-5"
    >
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Grid2x2 className="h-4 w-4 text-[#FF4D64] shrink-0" />
            <h2 className="font-display text-base font-semibold text-white">
              Listening Activity Heatmap
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-[#717786]">
            Granular 7-day × 24-hour play pattern matrix · {windowLabel}
            {activeGenre !== 'all' ? ` · ${activeGenre}` : ''}
          </p>
        </div>

        {/* Interactive Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Metric Selector */}
          <div
            role="tablist"
            aria-label="Heatmap intensity metric"
            className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B0D12] border border-white/[0.08]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={metric === 'duration'}
              onClick={() => setMetric('duration')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                metric === 'duration'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-[#8B92A2] hover:text-white'
              }`}
            >
              Time
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={metric === 'plays'}
              onClick={() => setMetric('plays')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                metric === 'plays'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-[#8B92A2] hover:text-white'
              }`}
            >
              Plays
            </button>
          </div>

          {/* Outcome Filter */}
          <div
            role="tablist"
            aria-label="Playback outcome filter"
            className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B0D12] border border-white/[0.08]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={outcomeScope === 'all'}
              onClick={() => setOutcomeScope('all')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                outcomeScope === 'all'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-[#8B92A2] hover:text-white'
              }`}
            >
              All
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={outcomeScope === 'completed'}
              onClick={() => setOutcomeScope('completed')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                outcomeScope === 'completed'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-[#8B92A2] hover:text-white'
              }`}
            >
              Completed
            </button>
          </div>

          {/* Time Window Selector */}
          <div
            role="tablist"
            aria-label="Heatmap date range"
            className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B0D12] border border-white/[0.08]"
          >
            {(
              [
                { id: '7d', label: '7D' },
                { id: '30d', label: '30D' },
                { id: 'all', label: 'All' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={windowMode === opt.id}
                onClick={() => {
                  setWindowMode(opt.id);
                  setSelectedCellKey(null);
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
        </div>
      </div>

      {/* 4-Column Granular Pattern Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 py-3.5 px-4 rounded-md bg-[#0D0F14] border border-white/[0.06]">
        <div>
          <div className="text-[11px] text-[#717786]">Active Hour Slots</div>
          <div className="mt-1 font-mono text-lg font-medium tabular-nums text-white">
            {summary.activeSlots}
            <span className="text-xs text-[#6B7280] font-normal ml-1">/ 168</span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6B7280]">
            {Math.round((summary.activeSlots / 168) * 100)}% weekly coverage
          </div>
        </div>

        <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
          <div className="text-[11px] text-[#717786]">Hottest Day &amp; Hour</div>
          <div className="mt-1 font-mono text-lg font-medium tabular-nums text-[#FF4D64] truncate">
            {summary.hottestCell
              ? `${summary.hottestCell.dayShort} · ${formatHourShort(summary.hottestCell.hour)}`
              : '—'}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6B7280] truncate">
            {summary.hottestCell
              ? `${formatCompactDuration(summary.hottestCell.totalSeconds)} · ${summary.hottestCell.plays} plays`
              : 'No plays recorded'}
          </div>
        </div>

        <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
          <div className="text-[11px] text-[#717786]">Dominant Time Block</div>
          <div className="mt-1 text-sm font-semibold text-white truncate pt-0.5">
            {summary.dominantPeriod ?? '—'}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6B7280]">
            {summary.dominantPeriodShare > 0
              ? `${summary.dominantPeriodShare}% of total ${metric === 'duration' ? 'time' : 'plays'}`
              : 'Waiting for activity'}
          </div>
        </div>

        <div className="lg:border-l lg:border-white/[0.07] lg:pl-4">
          <div className="text-[11px] text-[#717786]">Avg per Active Hour</div>
          <div className="mt-1 font-mono text-lg font-medium tabular-nums text-white">
            {summary.activeSlots > 0
              ? metric === 'duration'
                ? formatCompactDuration(summary.avgPerActiveSlot)
                : `${summary.avgPerActiveSlot.toFixed(1)} plays`
              : '—'}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-[#6B7280]">
            Across {summary.totalSessions} {summary.totalSessions === 1 ? 'session' : 'sessions'}
          </div>
        </div>
      </div>

      {/* D3 Matrix Viewport */}
      <div className="relative">
        <div
          ref={wrapperRef}
          className="relative overflow-x-auto pb-1"
        >
          <svg
            ref={svgRef}
            role="img"
            aria-label="Weekly listening activity heatmap by day of week and hour of day"
            className="block select-none"
          />

          {/* Floating Hover Tooltip */}
          {hoveredTooltip && (
            <div
              className="pointer-events-none absolute z-30 rounded-md border border-white/[0.14] bg-[#0F1116]/95 px-3 py-2.5 shadow-2xl text-xs w-[225px]"
              style={{
                left: `${Math.min(
                  Math.max(12, hoveredTooltip.x - 112),
                  Math.max(12, containerWidth - 236)
                )}px`,
                top: `${Math.max(4, hoveredTooltip.y - 96)}px`,
              }}
            >
              <div className="flex items-center justify-between gap-2 font-medium text-white">
                <span>{hoveredTooltip.cell.dayFull}</span>
                <span className="font-mono text-[11px] text-[#FF4D64]">
                  {formatHourShort(hoveredTooltip.cell.hour)}
                </span>
              </div>
              <div className="text-[11px] text-[#717786]">
                {formatHourRange(hoveredTooltip.cell.hour)} ·{' '}
                {getPeriodName(hoveredTooltip.cell.hour).split(' ')[0]}
              </div>

              {hoveredTooltip.cell.plays === 0 ? (
                <div className="mt-1.5 text-[11px] text-[#6B7280]">No plays in this hour</div>
              ) : (
                <div className="mt-2 space-y-1 font-mono tabular-nums text-[11px] text-[#9CA3AF]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[#717786]">Time Played</span>
                    <span className="text-white font-medium">
                      {formatCompactDuration(hoveredTooltip.cell.totalSeconds)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[#717786]">Sessions</span>
                    <span>
                      {hoveredTooltip.cell.plays} ({hoveredTooltip.cell.completedPlays} done)
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[#717786]">Unique Tracks</span>
                    <span>{hoveredTooltip.cell.uniqueTracks}</span>
                  </div>
                  {hoveredTooltip.cell.topTrackLabel && (
                    <div className="pt-1 mt-1 border-t border-white/[0.08] font-sans text-[11px] text-[#D1D5DB] truncate">
                      Top: <span className="text-white">{hoveredTooltip.cell.topTrackLabel}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Scale Legend & Hint Footer */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#717786]">
          <span>Click any day × hour cell to inspect songs played during that hour.</span>
          <div className="flex items-center gap-2 font-mono tabular-nums">
            <span>0</span>
            <div
              className="h-2.5 w-28 rounded-sm border border-white/[0.08]"
              style={{
                background:
                  'linear-gradient(90deg, #0D1016 0%, #24141B 20%, #6E1728 45%, #BD1B36 70%, #FF1F3D 88%, #FF6B7E 100%)',
              }}
            />
            <span>
              {maxValue > 0
                ? metric === 'duration'
                  ? formatCompactDuration(maxValue)
                  : `${maxValue} plays`
                : metric === 'duration'
                  ? '0m'
                  : '0 plays'}
            </span>
          </div>
        </div>
      </div>

      {/* Empty-State Inline Callout when no sessions match */}
      {summary.totalSessions === 0 && (
        <div className="rounded-md border border-white/[0.06] bg-[#0D0F14] px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="text-[#8B92A2]">
            No play history in <span className="text-white">{windowLabel.toLowerCase()}</span>.
            Play local tracks to populate each hourly slot across the week.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {windowMode !== 'all' && playHistory.length > 0 && (
              <button
                type="button"
                onClick={() => setWindowMode('all')}
                className="px-2.5 py-1.5 rounded text-xs font-medium text-white bg-[#181B24] border border-white/[0.1] hover:bg-[#222634] transition-colors whitespace-nowrap"
              >
                Show All History
              </button>
            )}
            {tracks.length > 0 ? (
              <button
                type="button"
                onClick={() => onPlayList(tracks.map((t) => t.id), { shuffle: false })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#0B0C0E] bg-white hover:bg-[#E5E7EB] transition-colors whitespace-nowrap"
              >
                <Play className="h-3 w-3 fill-current" />
                <span>Play Library</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onMountFolder}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
              >
                <FolderOpen className="h-3 w-3" />
                <span>Mount Folder</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Selected Day x Hour Drill-Down Panel */}
      {selectedCell && (
        <div className="pt-4 border-t border-white/[0.08] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-white">
                {selectedCell.dayFull} · {formatHourRange(selectedCell.hour)}
              </div>
              <div className="font-mono text-[11px] tabular-nums text-[#717786]">
                {formatCompactDuration(selectedCell.totalSeconds)} · {selectedCell.plays}{' '}
                {selectedCell.plays === 1 ? 'session' : 'sessions'} · {selectedCell.uniqueTracks}{' '}
                unique {selectedCell.uniqueTracks === 1 ? 'track' : 'tracks'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {playableSlotIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => onPlayList(playableSlotIds, { shuffle: false })}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-[#0B0C0E] bg-white hover:bg-[#E5E7EB] transition-colors whitespace-nowrap"
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>Play Hour ({playableSlotIds.length})</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedCellKey(null)}
                aria-label="Clear selected hour slot"
                className="p-1 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {selectedSlotTracks.length === 0 ? (
            <div className="text-xs text-[#717786]">
              No tracks were played during {selectedCell.dayFull} {formatHourRange(selectedCell.hour)}.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06] rounded-md border border-white/[0.07] bg-[#0D0F14]">
              {selectedSlotTracks.map((item) => {
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
                        onClick={() => track && onPlayTrack(track.id, playableSlotIds)}
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
