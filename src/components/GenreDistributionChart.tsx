import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  FolderOpen,
  Layers,
  Loader2,
  PieChart as PieChartIcon,
  Play,
  Shuffle,
  Table2,
  Tags,
  Upload,
  Wand2,
  X,
  ZoomIn,
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { LocalTrack, TrackPlayStats } from '../types/music';
import { classifyTracksDeeply } from '../utils/genreClassifier';
import {
  analyzeTrackBucket,
  cleanRawGenreTag,
  computeGenreDiversity,
  type DeepBreakdownDimension,
  type DiversityProfileLabel,
  type GenreGroupSummary,
  type TrackStatistics,
} from '../utils/genreInference';
import type { ShuffleMode } from '../utils/smartShuffle';
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
  '#14B8A6', // Studio Teal
  '#F97316', // Signal Orange
  '#8B5CF6', // Deep Purple
  '#22D3EE', // Electric Sky
];

const UNCLASSIFIED_COLOR = '#4B5563';
const OTHER_COLOR = '#64748B';

export type GenreMetricMode = 'tracks' | 'runtime' | 'plays';

type DrillTarget =
  | null
  | { kind: 'other-rollup' }
  | { kind: 'bucket'; genre: string };

const DEEP_DIMENSIONS: Array<{ id: DeepBreakdownDimension; label: string }> = [
  { id: 'artist', label: 'Artist' },
  { id: 'folder', label: 'Folder' },
  { id: 'era', label: 'Era' },
  { id: 'format', label: 'Format' },
  { id: 'duration', label: 'Length' },
];

interface EnrichedGenreGroup extends GenreGroupSummary {
  playCount: number;
  trackSharePct: number;
  runtimeSharePct: number;
  playSharePct: number;
  metricValue: number;
  activeSharePct: number;
}

export interface GenrePieDatum {
  genre: string;
  count: number;
  sharePct: number;
  librarySharePct?: number;
  trackSharePct: number;
  runtimeSharePct: number;
  playSharePct: number;
  playCount: number;
  metricValue: number;
  totalDuration: number;
  avgDuration: number;
  matchedCount: number;
  taggedCount: number;
  trackIds: string[];
  color: string;
  isRollup?: boolean;
  isDeepInspectable?: boolean;
  isFilterable: boolean;
  sampleTitles?: string[];
}

interface GenreDistributionChartProps {
  tracks: LocalTrack[];
  allStats: TrackStatistics;
  playStats: Record<string, TrackPlayStats>;
  activeGenre: string;
  onSelectGenre: (genre: string) => void;
  onOpenScanner: (
    filter?: 'all' | 'unmatched' | 'matched' | 'missing',
    options?: { genre?: string; groupByGenre?: boolean }
  ) => void;
  onPlayList: (trackIds: string[], options?: { shuffle?: boolean | ShuffleMode }) => void;
  onCreatePlaylistFromTracks: (trackIds: string[]) => void;
  onOpenBatchTagEditor?: (trackIds: string[], contextLabel: string) => void;
  onApplyTrackGenres?: (updates: Record<string, string>) => void;
  onMountFolder: () => void;
  onPickFilesFallback: () => void;
}

function isBroadUncategorizedLabel(label: string): boolean {
  const lower = label.trim().toLowerCase();
  return lower === 'unclassified' || lower === 'untagged' || lower === 'other';
}

function formatMetricCompact(
  datum: Pick<GenrePieDatum, 'count' | 'totalDuration' | 'playCount'>,
  mode: GenreMetricMode
): string {
  if (mode === 'runtime') return formatTotalRuntime(datum.totalDuration);
  if (mode === 'plays') return `${datum.playCount} ${datum.playCount === 1 ? 'play' : 'plays'}`;
  return `${datum.count} ${datum.count === 1 ? 'track' : 'tracks'}`;
}

function getProfileToneClass(profile: DiversityProfileLabel): string {
  switch (profile) {
    case 'Eclectic':
    case 'Balanced':
      return 'text-[#22C55E]';
    case 'Moderate':
    case 'Focused':
      return 'text-[#F59E0B]';
    default:
      return 'text-[#9CA3AF]';
  }
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: GenrePieDatum }>;
  hasPlays: boolean;
  isDrilled: boolean;
}

function GenrePieTooltip({ active, payload, hasPlays, isDrilled }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-md border border-white/[0.12] bg-[#0F1116]/95 px-3 py-2.5 shadow-xl text-xs min-w-[204px] max-w-[260px]">
      <div className="flex items-center gap-2 font-medium text-white">
        <span
          className="h-2.5 w-2.5 rounded-[2px] shrink-0"
          style={{ backgroundColor: item.color }}
          aria-hidden="true"
        />
        <span className="truncate">{item.genre}</span>
      </div>
      <div className="mt-2 space-y-1 font-mono tabular-nums text-[11px] text-[#9CA3AF]">
        <div className="flex items-center justify-between gap-5">
          <span className="text-[#717786]">Tracks</span>
          <span className="text-white">
            {item.count} ({item.trackSharePct}%)
          </span>
        </div>
        {isDrilled && typeof item.librarySharePct === 'number' && (
          <div className="flex items-center justify-between gap-5">
            <span className="text-[#717786]">Full Library</span>
            <span>{item.librarySharePct}%</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-5">
          <span className="text-[#717786]">Runtime</span>
          <span>
            {formatTotalRuntime(item.totalDuration)} ({item.runtimeSharePct}%)
          </span>
        </div>
        {hasPlays && (
          <div className="flex items-center justify-between gap-5">
            <span className="text-[#717786]">Plays</span>
            <span className="text-[#FF4D64]">
              {item.playCount} ({item.playSharePct}%)
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-5 pt-1 border-t border-white/[0.07]">
          <span className="text-[#717786]">YT Matched</span>
          <span className="text-[#22C55E]">
            {item.matchedCount}/{item.count}
          </span>
        </div>
      </div>
      {item.sampleTitles && item.sampleTitles.length > 0 && (
        <div className="mt-2 pt-1.5 border-t border-white/[0.07] text-[11px] text-[#8B92A2] space-y-0.5">
          <div className="text-[10px] text-[#6B7280]">Sample tracks</div>
          {item.sampleTitles.map((title, idx) => (
            <div key={`${title}-${idx}`} className="truncate text-[#D1D5DB]">
              {title}
            </div>
          ))}
        </div>
      )}
      {item.isRollup && (
        <div className="mt-1.5 pt-1.5 border-t border-white/[0.07] text-[11px] text-[#FF4D64]">
          Click slice to inspect sub-genres
        </div>
      )}
    </div>
  );
}

export function GenreDistributionChart({
  tracks,
  allStats,
  playStats,
  activeGenre,
  onSelectGenre,
  onOpenScanner,
  onPlayList,
  onCreatePlaylistFromTracks,
  onOpenBatchTagEditor,
  onApplyTrackGenres,
  onMountFolder,
  onPickFilesFallback,
}: GenreDistributionChartProps) {
  const [dataSource, setDataSource] = useState<'inferred' | 'embedded'>('inferred');
  const [metricMode, setMetricMode] = useState<GenreMetricMode>('tracks');
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [hoveredGenre, setHoveredGenre] = useState<string | null>(null);
  const [drillTarget, setDrillTarget] = useState<DrillTarget>(null);
  const [deepDimension, setDeepDimension] = useState<DeepBreakdownDimension>('artist');
  const [isClassifying, setIsClassifying] = useState(false);
  const [classifyProgress, setClassifyProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);
  const [classifyError, setClassifyError] = useState<string | null>(null);
  const [classifyNotice, setClassifyNotice] = useState<string | null>(null);

  // Build strict embedded-tag distribution when user switches to "Tag Only"
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

  const baseGroups = dataSource === 'inferred' ? allStats.genreGroups : embeddedGroups;

  // Enrich each genre group with play stats and shares across tracks, runtime, and plays
  const { enrichedGroups, totalPlays, totalDurationAll, playedGenreCount, topPlayedGenre } =
    useMemo(() => {
      const totalTrackCount = tracks.length;
      const totalDur = baseGroups.reduce((acc, g) => acc + g.totalDuration, 0);

      const withPlays = baseGroups.map((group) => {
        let groupPlays = 0;
        for (const t of group.tracks) {
          groupPlays += playStats[t.id]?.playCount ?? t.playCount ?? 0;
        }
        return { group, groupPlays };
      });

      const sumPlays = withPlays.reduce((acc, item) => acc + item.groupPlays, 0);

      const enriched: EnrichedGenreGroup[] = withPlays.map(({ group, groupPlays }) => {
        const trackSharePct =
          totalTrackCount > 0 ? Math.round((group.count / totalTrackCount) * 100) : 0;
        const runtimeSharePct =
          totalDur > 0 ? Math.round((group.totalDuration / totalDur) * 100) : 0;
        const playSharePct = sumPlays > 0 ? Math.round((groupPlays / sumPlays) * 100) : 0;

        const metricValue =
          metricMode === 'runtime'
            ? Math.round(group.totalDuration)
            : metricMode === 'plays'
              ? groupPlays
              : group.count;

        const activeSharePct =
          metricMode === 'runtime'
            ? runtimeSharePct
            : metricMode === 'plays'
              ? playSharePct
              : trackSharePct;

        return {
          ...group,
          playCount: groupPlays,
          trackSharePct,
          runtimeSharePct,
          playSharePct,
          metricValue,
          activeSharePct,
        };
      });

      enriched.sort((a, b) => {
        const aMuted = isBroadUncategorizedLabel(a.genre);
        const bMuted = isBroadUncategorizedLabel(b.genre);
        if (aMuted && !bMuted) return 1;
        if (bMuted && !aMuted) return -1;
        return b.metricValue - a.metricValue || b.count - a.count || b.totalDuration - a.totalDuration;
      });

      let playedCount = 0;
      let topPlayed: EnrichedGenreGroup | null = null;
      for (const g of enriched) {
        if (g.playCount > 0) {
          playedCount += 1;
          if (!topPlayed || g.playCount > topPlayed.playCount) {
            topPlayed = g;
          }
        }
      }

      return {
        enrichedGroups: enriched,
        totalPlays: sumPlays,
        totalDurationAll: totalDur,
        playedGenreCount: playedCount,
        topPlayedGenre: topPlayed,
      };
    }, [baseGroups, playStats, tracks.length, metricMode]);

  // Split top-level groups into primary slices vs tiny long-tail "Other (N)" rollup
  // Keep every genre >= 4% share (up to 14 slices) or at least top 10 so "Other" never balloons artificially
  const { primaryGroups, otherRollupGroups } = useMemo(() => {
    const eligible = enrichedGroups.filter((g) => g.metricValue > 0);
    if (eligible.length <= 10) {
      return { primaryGroups: eligible, otherRollupGroups: [] as EnrichedGenreGroup[] };
    }

    const primary: EnrichedGenreGroup[] = [];
    const remainder: EnrichedGenreGroup[] = [];

    for (let i = 0; i < eligible.length; i++) {
      const g = eligible[i];
      const keepAsPrimary = primary.length < 10 || (g.activeSharePct >= 4 && primary.length < 13);
      if (keepAsPrimary) {
        primary.push(g);
      } else {
        remainder.push(g);
      }
    }

    // Never create a 1-item "Other (1)" bucket; just show that genre directly
    if (remainder.length === 1) {
      primary.push(remainder[0]);
      return { primaryGroups: primary, otherRollupGroups: [] as EnrichedGenreGroup[] };
    }

    return { primaryGroups: primary, otherRollupGroups: remainder };
  }, [enrichedGroups]);

  // Validate active drill target (auto-exit if underlying tracks/dataSource changed)
  const effectiveDrill = useMemo<DrillTarget>(() => {
    if (!drillTarget) return null;
    if (drillTarget.kind === 'other-rollup') {
      return otherRollupGroups.length > 0 ? drillTarget : null;
    }
    const exists = enrichedGroups.some((g) => g.genre === drillTarget.genre);
    return exists ? drillTarget : null;
  }, [drillTarget, otherRollupGroups.length, enrichedGroups]);

  const drilledBucketGroup = useMemo(() => {
    if (effectiveDrill?.kind !== 'bucket') return null;
    return enrichedGroups.find((g) => g.genre === effectiveDrill.genre) ?? null;
  }, [effectiveDrill, enrichedGroups]);

  // Compute pieData depending on whether we are in top-level, Other-rollup drilldown, or structural bucket drilldown
  const pieData = useMemo<GenrePieDatum[]>(() => {
    // 1. Deep Structural Analysis of a specific bucket (Unclassified / Untagged / Other / or any genre)
    if (effectiveDrill?.kind === 'bucket' && drilledBucketGroup) {
      const deepSlices = analyzeTrackBucket(
        drilledBucketGroup.tracks,
        deepDimension,
        tracks.length,
        (t) => playStats[t.id]?.playCount ?? t.playCount ?? 0,
        10
      );

      const bucketTotalDuration = deepSlices.reduce((acc, s) => acc + s.totalDuration, 0);
      const bucketTotalPlays = deepSlices.reduce((acc, s) => acc + s.playCount, 0);

      let colorIdx = 0;
      const mapped = deepSlices
        .map((slice) => {
          const runtimeSharePct =
            bucketTotalDuration > 0
              ? Math.round((slice.totalDuration / bucketTotalDuration) * 100)
              : 0;
          const playSharePct =
            bucketTotalPlays > 0 ? Math.round((slice.playCount / bucketTotalPlays) * 100) : 0;

          const metricValue =
            metricMode === 'runtime'
              ? Math.round(slice.totalDuration)
              : metricMode === 'plays'
                ? slice.playCount
                : slice.count;

          const sharePct =
            metricMode === 'runtime'
              ? runtimeSharePct
              : metricMode === 'plays'
                ? playSharePct
                : slice.sharePct;

          const isMuted =
            slice.isResidual ||
            slice.label === 'Unknown Artist' ||
            slice.label === 'No Year Tag' ||
            slice.label === 'Unknown Length';

          const color = slice.isResidual
            ? OTHER_COLOR
            : isMuted
              ? UNCLASSIFIED_COLOR
              : GENRE_PALETTE[colorIdx++ % GENRE_PALETTE.length];

          return {
            genre: slice.label,
            count: slice.count,
            sharePct,
            librarySharePct: slice.librarySharePct,
            trackSharePct: slice.sharePct,
            runtimeSharePct,
            playSharePct,
            playCount: slice.playCount,
            metricValue,
            totalDuration: slice.totalDuration,
            avgDuration: slice.count > 0 ? slice.totalDuration / slice.count : 0,
            matchedCount: slice.matchedCount,
            taggedCount: 0,
            trackIds: slice.trackIds,
            color,
            isFilterable: false,
            sampleTitles: slice.sampleTitles,
          };
        })
        .filter((s) => s.metricValue > 0)
        .sort((a, b) => b.metricValue - a.metricValue);

      return mapped;
    }

    // 2. Drill-Down inside "Other (N)" Rollup -> show every rolled-up sub-genre
    if (effectiveDrill?.kind === 'other-rollup') {
      const subTotalTracks = otherRollupGroups.reduce((acc, g) => acc + g.count, 0);
      const subTotalDuration = otherRollupGroups.reduce((acc, g) => acc + g.totalDuration, 0);
      const subTotalPlays = otherRollupGroups.reduce((acc, g) => acc + g.playCount, 0);

      let colorIdx = 0;
      return otherRollupGroups.map((group) => {
        const isMuted = isBroadUncategorizedLabel(group.genre);
        const color = isMuted
          ? UNCLASSIFIED_COLOR
          : GENRE_PALETTE[colorIdx++ % GENRE_PALETTE.length];

        const trackShareOfOther =
          subTotalTracks > 0 ? Math.round((group.count / subTotalTracks) * 100) : 0;
        const runtimeShareOfOther =
          subTotalDuration > 0 ? Math.round((group.totalDuration / subTotalDuration) * 100) : 0;
        const playShareOfOther =
          subTotalPlays > 0 ? Math.round((group.playCount / subTotalPlays) * 100) : 0;

        const sharePct =
          metricMode === 'runtime'
            ? runtimeShareOfOther
            : metricMode === 'plays'
              ? playShareOfOther
              : trackShareOfOther;

        return {
          genre: group.genre,
          count: group.count,
          sharePct,
          librarySharePct: group.activeSharePct,
          trackSharePct: trackShareOfOther,
          runtimeSharePct: runtimeShareOfOther,
          playSharePct: playShareOfOther,
          playCount: group.playCount,
          metricValue: group.metricValue,
          totalDuration: group.totalDuration,
          avgDuration: group.avgDuration,
          matchedCount: group.matchedCount,
          taggedCount: group.taggedCount,
          trackIds: group.trackIds,
          color,
          isDeepInspectable: true,
          isFilterable: dataSource === 'inferred',
        };
      });
    }

    // 3. Top-level Library Genre Distribution
    let colorIdx = 0;
    const slices: GenrePieDatum[] = primaryGroups.map((group) => {
      const isMuted = isBroadUncategorizedLabel(group.genre);
      const color = isMuted
        ? UNCLASSIFIED_COLOR
        : GENRE_PALETTE[colorIdx++ % GENRE_PALETTE.length];
      return {
        genre: group.genre,
        count: group.count,
        sharePct: group.activeSharePct,
        trackSharePct: group.trackSharePct,
        runtimeSharePct: group.runtimeSharePct,
        playSharePct: group.playSharePct,
        playCount: group.playCount,
        metricValue: group.metricValue,
        totalDuration: group.totalDuration,
        avgDuration: group.avgDuration,
        matchedCount: group.matchedCount,
        taggedCount: group.taggedCount,
        trackIds: group.trackIds,
        color,
        isDeepInspectable: true,
        isFilterable: dataSource === 'inferred',
      };
    });

    if (otherRollupGroups.length > 0) {
      const count = otherRollupGroups.reduce((acc, g) => acc + g.count, 0);
      const totalDuration = otherRollupGroups.reduce((acc, g) => acc + g.totalDuration, 0);
      const playCount = otherRollupGroups.reduce((acc, g) => acc + g.playCount, 0);
      const metricValue = otherRollupGroups.reduce((acc, g) => acc + g.metricValue, 0);
      const matchedCount = otherRollupGroups.reduce((acc, g) => acc + g.matchedCount, 0);
      const taggedCount = otherRollupGroups.reduce((acc, g) => acc + g.taggedCount, 0);
      const trackIds = otherRollupGroups.flatMap((g) => g.trackIds);

      const trackSharePct = tracks.length > 0 ? Math.round((count / tracks.length) * 100) : 0;
      const runtimeSharePct =
        totalDurationAll > 0 ? Math.round((totalDuration / totalDurationAll) * 100) : 0;
      const playSharePct = totalPlays > 0 ? Math.round((playCount / totalPlays) * 100) : 0;
      const sharePct =
        metricMode === 'runtime'
          ? runtimeSharePct
          : metricMode === 'plays'
            ? playSharePct
            : trackSharePct;

      slices.push({
        genre: `Other (${otherRollupGroups.length})`,
        count,
        sharePct,
        trackSharePct,
        runtimeSharePct,
        playSharePct,
        playCount,
        metricValue,
        totalDuration,
        avgDuration: count > 0 ? totalDuration / count : 0,
        matchedCount,
        taggedCount,
        trackIds,
        color: OTHER_COLOR,
        isRollup: true,
        isDeepInspectable: true,
        isFilterable: false,
      });
    }

    return slices;
  }, [
    effectiveDrill,
    drilledBucketGroup,
    deepDimension,
    tracks.length,
    playStats,
    metricMode,
    otherRollupGroups,
    dataSource,
    primaryGroups,
    totalDurationAll,
    totalPlays,
  ]);

  // Compute transparent Simpson's Diversity Index & Shannon Effective Genres for current view
  const diversity = useMemo(() => {
    if (effectiveDrill) {
      return computeGenreDiversity(
        pieData.map((d) => ({ genre: d.genre, weight: d.metricValue }))
      );
    }
    return computeGenreDiversity(
      enrichedGroups.map((g) => ({ genre: g.genre, weight: g.metricValue }))
    );
  }, [effectiveDrill, pieData, enrichedGroups]);

  // All tracks currently sitting in Unclassified / Untagged / generic Other buckets
  const unclassifiedTracks = useMemo(() => {
    const bucketTracks: LocalTrack[] = [];
    for (const group of enrichedGroups) {
      if (isBroadUncategorizedLabel(group.genre)) {
        bucketTracks.push(...group.tracks);
      }
    }
    return bucketTracks;
  }, [enrichedGroups]);

  const handleDeepClassify = async (targetTracks: LocalTrack[]) => {
    if (isClassifying || targetTracks.length === 0 || !onApplyTrackGenres) return;
    setIsClassifying(true);
    setClassifyError(null);
    setClassifyNotice(null);
    setClassifyProgress({ processed: 0, total: targetTracks.length });

    try {
      const result = await classifyTracksDeeply(targetTracks, (processed, total) => {
        setClassifyProgress({ processed, total });
      });
      if (result.classifiedCount > 0) {
        onApplyTrackGenres(result.updates);
        setClassifyNotice(
          `Resolved ${result.classifiedCount} of ${result.totalRequested} tracks across ${result.genresDiscovered.length} genre${result.genresDiscovered.length === 1 ? '' : 's'}.`
        );
      } else {
        setClassifyNotice(
          'No additional genres could be inferred from the available filenames or tags. Use Batch Tag Editor to assign genres manually.'
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Deep genre classification failed.';
      setClassifyError(msg);
    } finally {
      setIsClassifying(false);
      setClassifyProgress(null);
    }
  };

  // Detect if an "Other", "Unclassified", or "Untagged" slice warrants proactive deep classification / drill-down
  const largeOtherInsight = useMemo(() => {
    if (effectiveDrill) return null;
    const rollupSlice = pieData.find((d) => d.isRollup);
    const broadSlice = pieData.find((d) => isBroadUncategorizedLabel(d.genre));

    const candidates: Array<{
      label: string;
      sharePct: number;
      count: number;
      target: DrillTarget;
      canAutoClassify: boolean;
      tracksToClassify: LocalTrack[];
      description: string;
    }> = [];

    if (broadSlice && broadSlice.count > 0) {
      candidates.push({
        label: broadSlice.genre,
        sharePct: broadSlice.sharePct,
        count: broadSlice.count,
        target: { kind: 'bucket', genre: broadSlice.genre },
        canAutoClassify: true,
        tracksToClassify: unclassifiedTracks,
        description: `${broadSlice.genre}: ${broadSlice.count} track${broadSlice.count === 1 ? '' : 's'} (${broadSlice.sharePct}%) — classify by artist/title or inspect breakdown`,
      });
    }

    if (rollupSlice && rollupSlice.sharePct >= 10) {
      candidates.push({
        label: rollupSlice.genre,
        sharePct: rollupSlice.sharePct,
        count: rollupSlice.count,
        target: { kind: 'other-rollup' },
        canAutoClassify: false,
        tracksToClassify: [],
        description: `${rollupSlice.genre} groups ${otherRollupGroups.length} genres (${rollupSlice.sharePct}% share) — inspect individual genres`,
      });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.sharePct - a.sharePct);
    return candidates[0];
  }, [effectiveDrill, pieData, otherRollupGroups.length, unclassifiedTracks]);

  const highlightedSlice = useMemo(() => {
    if (hoveredGenre) {
      return pieData.find((d) => d.genre === hoveredGenre) ?? null;
    }
    if (!effectiveDrill && dataSource === 'inferred' && activeGenre !== 'all') {
      return pieData.find((d) => d.genre === activeGenre) ?? null;
    }
    return null;
  }, [hoveredGenre, effectiveDrill, activeGenre, dataSource, pieData]);

  const handleSliceInteraction = (datum: GenrePieDatum) => {
    if (datum.isRollup) {
      setHoveredGenre(null);
      setDrillTarget({ kind: 'other-rollup' });
      return;
    }
    if (effectiveDrill?.kind === 'bucket') {
      // In structural bucket drill-down, clicking a slice opens Batch Tag Editor for that artist/folder if available
      if (onOpenBatchTagEditor && datum.trackIds.length > 0) {
        onOpenBatchTagEditor(
          datum.trackIds,
          `${drilledBucketGroup?.genre ?? 'Unclassified'} · ${datum.genre}`
        );
      }
      return;
    }
    if (isBroadUncategorizedLabel(datum.genre) && !effectiveDrill) {
      setHoveredGenre(null);
      setDrillTarget({ kind: 'bucket', genre: datum.genre });
      return;
    }
    if (!datum.isFilterable) return;
    onSelectGenre(activeGenre === datum.genre ? 'all' : datum.genre);
  };

  const handleInspectBucket = (genreName: string, isRollup?: boolean) => {
    setHoveredGenre(null);
    if (isRollup) {
      setDrillTarget({ kind: 'other-rollup' });
    } else {
      setDrillTarget({ kind: 'bucket', genre: genreName });
    }
  };

  const drillTotalTracks = useMemo(
    () => pieData.reduce((acc, s) => acc + s.count, 0),
    [pieData]
  );
  const drillTotalDuration = useMemo(
    () => pieData.reduce((acc, s) => acc + s.totalDuration, 0),
    [pieData]
  );
  const drillTotalPlays = useMemo(
    () => pieData.reduce((acc, s) => acc + s.playCount, 0),
    [pieData]
  );

  const activeTotalPlays = effectiveDrill ? drillTotalPlays : totalPlays;
  const activeTotalDuration = effectiveDrill ? drillTotalDuration : totalDurationAll;
  const activeTotalTracks = effectiveDrill ? drillTotalTracks : tracks.length;

  const isPlaysEmpty = metricMode === 'plays' && activeTotalPlays === 0;
  const isRuntimeEmpty = metricMode === 'runtime' && activeTotalDuration === 0;
  const maxLegendShare = useMemo(() => Math.max(1, ...pieData.map((d) => d.sharePct)), [pieData]);

  const drillTitle =
    effectiveDrill?.kind === 'other-rollup'
      ? `Other (${otherRollupGroups.length} Genres)`
      : effectiveDrill?.kind === 'bucket'
        ? `${effectiveDrill.genre} Breakdown`
        : null;

  return (
    <section
      aria-label="Genre Distribution and Listening Diversity"
      className="lg:col-span-7 rounded-lg border border-white/[0.08] bg-[#12141A] flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {effectiveDrill ? (
              <button
                type="button"
                onClick={() => {
                  setHoveredGenre(null);
                  setDrillTarget(null);
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors shrink-0 whitespace-nowrap"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>All Genres</span>
              </button>
            ) : (
              <PieChartIcon className="h-4 w-4 text-[#FF4D64] shrink-0" />
            )}
            {effectiveDrill && (
              <span className="text-[#4B5563]" aria-hidden="true">
                /
              </span>
            )}
            <h2 className="font-display text-base font-semibold text-white truncate">
              {drillTitle ?? 'Genre Distribution & Diversity'}
            </h2>
          </div>
          <p className="text-xs text-[#717786] mt-0.5 font-mono tabular-nums">
            {tracks.length === 0
              ? 'Visualize music genre spread across your library to measure listening diversity'
              : effectiveDrill?.kind === 'other-rollup'
                ? `${otherRollupGroups.length} long-tail genres · ${drillTotalTracks} tracks (${Math.round((drillTotalTracks / Math.max(1, tracks.length)) * 100)}% of library)`
                : effectiveDrill?.kind === 'bucket' && drilledBucketGroup
                  ? `${drilledBucketGroup.count} tracks (${drilledBucketGroup.trackSharePct}% of library) analyzed by ${deepDimension}`
                  : dataSource === 'inferred'
                    ? `${allStats.uniqueGenres} genre${allStats.uniqueGenres === 1 ? '' : 's'} · ${allStats.withEmbeddedGenreCount} embedded tags, ${allStats.totalTracks - allStats.withEmbeddedGenreCount} inferred`
                    : `${embeddedGroups.filter((g) => g.genre !== 'Untagged').length} embedded tag genre${embeddedGroups.filter((g) => g.genre !== 'Untagged').length === 1 ? '' : 's'} · ${allStats.withEmbeddedGenreCount}/${tracks.length} tracks tagged`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {tracks.length > 0 && (
            <>
              {/* Weighting Mode Segmented Control */}
              <div
                className="inline-flex items-center p-0.5 rounded bg-[#0C0E13] border border-white/[0.08]"
                role="group"
                aria-label="Pie chart weighting metric"
              >
                <button
                  type="button"
                  onClick={() => setMetricMode('tracks')}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    metricMode === 'tracks'
                      ? 'bg-white/[0.12] text-white'
                      : 'text-[#8B92A2] hover:text-white'
                  }`}
                >
                  Tracks
                </button>
                <button
                  type="button"
                  onClick={() => setMetricMode('runtime')}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    metricMode === 'runtime'
                      ? 'bg-white/[0.12] text-white'
                      : 'text-[#8B92A2] hover:text-white'
                  }`}
                >
                  Runtime
                </button>
                <button
                  type="button"
                  onClick={() => setMetricMode('plays')}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    metricMode === 'plays'
                      ? 'bg-white/[0.12] text-white'
                      : 'text-[#8B92A2] hover:text-white'
                  }`}
                >
                  Plays
                </button>
              </div>

              {/* Metadata Source Toggle (top-level only) */}
              {!effectiveDrill && (
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
              )}

              {/* Chart / Table Toggle */}
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

      {/* Deep Analysis Dimension Switcher (shown when drilling into Unclassified / Untagged / Genre bucket) */}
      {effectiveDrill?.kind === 'bucket' && drilledBucketGroup && (
        <div className="px-5 py-2.5 border-b border-white/[0.07] bg-[#0F1116] flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] text-[#717786] shrink-0">Group by</span>
            <div
              className="inline-flex items-center p-0.5 rounded bg-[#161922] border border-white/[0.08]"
              role="group"
              aria-label="Deep analysis grouping dimension"
            >
              {DEEP_DIMENSIONS.map((dim) => (
                <button
                  key={dim.id}
                  type="button"
                  onClick={() => {
                    setHoveredGenre(null);
                    setDeepDimension(dim.id);
                  }}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    deepDimension === dim.id
                      ? 'bg-[#FF1F3D]/20 text-white'
                      : 'text-[#8B92A2] hover:text-white'
                  }`}
                >
                  {dim.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onApplyTrackGenres && (
              <button
                type="button"
                disabled={isClassifying}
                onClick={() => void handleDeepClassify(drilledBucketGroup.tracks)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {isClassifying ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="font-mono tabular-nums">
                      {classifyProgress
                        ? `${classifyProgress.processed}/${classifyProgress.total}`
                        : 'Classifying...'}
                    </span>
                  </>
                ) : (
                  <>
                    <Wand2 className="h-3 w-3" />
                    <span>Deep Classify ({drilledBucketGroup.count})</span>
                  </>
                )}
              </button>
            )}
            {onOpenBatchTagEditor && (
              <button
                type="button"
                onClick={() =>
                  onOpenBatchTagEditor(
                    drilledBucketGroup.trackIds,
                    `${drilledBucketGroup.genre} (${drilledBucketGroup.count} tracks)`
                  )
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium text-[#E5E7EB] bg-[#161922] border border-white/[0.09] hover:bg-[#1E222E] transition-colors whitespace-nowrap"
              >
                <Tags className="h-3 w-3" />
                <span>Batch Tag</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Proactive Large Other / Unclassified Insight Bar */}
      {tracks.length > 0 && largeOtherInsight && (
        <div className="px-5 py-2.5 border-b border-white/[0.07] bg-[#0F1116] flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-2 text-[#D1D5DB] min-w-0">
            <ZoomIn className="h-3.5 w-3.5 text-[#F59E0B] shrink-0" />
            <span className="truncate">{largeOtherInsight.description}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {largeOtherInsight.canAutoClassify && onApplyTrackGenres && (
              <button
                type="button"
                disabled={isClassifying}
                onClick={() => void handleDeepClassify(largeOtherInsight.tracksToClassify)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {isClassifying ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="font-mono tabular-nums">
                      {classifyProgress
                        ? `Classifying ${classifyProgress.processed}/${classifyProgress.total}`
                        : 'Classifying...'}
                    </span>
                  </>
                ) : (
                  <>
                    <Wand2 className="h-3 w-3" />
                    <span>Deep Classify ({largeOtherInsight.count})</span>
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setHoveredGenre(null);
                setDrillTarget(largeOtherInsight.target);
              }}
              className="inline-flex items-center gap-1 font-medium text-[#F59E0B] hover:text-[#FDE68A] transition-colors whitespace-nowrap"
            >
              <span>Inspect</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Classification Feedback / Error Banner */}
      {(classifyError || classifyNotice) && (
        <div
          className={`px-5 py-2 border-b border-white/[0.07] flex items-center justify-between gap-3 text-xs ${
            classifyError ? 'bg-[#EF4444]/10 text-[#FCA5A5]' : 'bg-[#22C55E]/10 text-[#86EFAC]'
          }`}
        >
          <span className="min-w-0 truncate">{classifyError ?? classifyNotice}</span>
          <button
            type="button"
            onClick={() => {
              setClassifyError(null);
              setClassifyNotice(null);
            }}
            aria-label="Dismiss message"
            className="p-0.5 rounded hover:bg-white/10 shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Unboxed Listening Diversity Strip (hairline-divided, tabular-nums) */}
      {tracks.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 px-5 py-3.5 border-b border-white/[0.07] bg-[#0F1116]/60">
          <div className="min-w-0">
            <div className="text-[11px] text-[#717786]">
              {effectiveDrill ? 'Sub-Spread Index' : 'Diversity Index'}{' '}
              <span className="text-[#525866]">
                ({metricMode === 'tracks' ? 'catalog' : metricMode})
              </span>
            </div>
            <div className="mt-0.5 flex items-baseline gap-2 font-mono tabular-nums">
              <span
                className={`text-sm font-semibold ${getProfileToneClass(diversity.profileLabel)}`}
              >
                {diversity.profileLabel}
              </span>
              {diversity.activeGenreCount > 0 && (
                <span className="text-xs text-[#A1A7B5]">{diversity.simpsonIndexPct}%</span>
              )}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-[#6B7280] truncate">
              {diversity.activeGenreCount > 1
                ? `${diversity.effectiveGenreCount} effective ${
                    effectiveDrill?.kind === 'bucket' ? `${deepDimension}s` : 'genres'
                  }`
                : diversity.activeGenreCount === 1
                  ? `Concentrated in 1 ${
                      effectiveDrill?.kind === 'bucket' ? deepDimension : 'genre'
                    }`
                  : 'Play tracks to measure spread'}
            </div>
          </div>

          <div className="sm:border-l sm:border-white/[0.07] sm:pl-4 min-w-0">
            <div className="text-[11px] text-[#717786]">
              {effectiveDrill?.kind === 'bucket' ? `Top ${deepDimension}` : 'Dominant Genre'}
            </div>
            <div className="mt-0.5 flex items-baseline gap-2 min-w-0">
              <span className="text-sm font-medium text-white truncate">
                {diversity.topGenre ? diversity.topGenre.genre : '—'}
              </span>
              {diversity.topGenre && (
                <span className="font-mono text-xs tabular-nums text-[#FF4D64] shrink-0">
                  {diversity.topGenre.sharePct}%
                </span>
              )}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-[#6B7280] truncate">
              {diversity.activeGenreCount >= 2
                ? `Top 2 cover ${diversity.topTwoSharePct}%`
                : 'Single-group concentration'}
            </div>
          </div>

          <div className="sm:border-l sm:border-white/[0.07] sm:pl-4 min-w-0">
            <div className="text-[11px] text-[#717786]">
              {effectiveDrill
                ? 'Share of Library'
                : totalPlays > 0
                  ? 'Listening Coverage'
                  : 'Genre Breadth'}
            </div>
            <div className="mt-0.5 font-mono text-sm font-medium tabular-nums text-white truncate">
              {effectiveDrill ? (
                <>
                  {Math.round((activeTotalTracks / Math.max(1, tracks.length)) * 100)}%
                  <span className="text-xs text-[#6B7280] font-normal">
                    {' '}
                    ({activeTotalTracks}/{tracks.length})
                  </span>
                </>
              ) : totalPlays > 0 ? (
                <>
                  {playedGenreCount}
                  <span className="text-xs text-[#6B7280] font-normal">
                    {' '}
                    / {enrichedGroups.length} played
                  </span>
                </>
              ) : (
                <>
                  {diversity.activeGenreCount}{' '}
                  <span className="text-xs text-[#6B7280] font-normal">
                    {diversity.activeGenreCount === 1 ? 'genre' : 'genres'}
                  </span>
                </>
              )}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-[#6B7280] truncate">
              {effectiveDrill
                ? `${formatTotalRuntime(activeTotalDuration)} total runtime`
                : totalPlays > 0 && topPlayedGenre
                  ? `Most played: ${topPlayedGenre.genre} (${topPlayedGenre.playSharePct}%)`
                  : diversity.longTailCount > 0
                    ? `${diversity.longTailCount} niche genre${diversity.longTailCount === 1 ? '' : 's'} (<10%)`
                    : 'Evenly distributed catalog'}
            </div>
          </div>
        </div>
      )}

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
              from track metadata to visualize your library diversity here.
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
          {isPlaysEmpty || isRuntimeEmpty ? (
            <div className="flex-1 py-8 flex flex-col items-center justify-center text-center">
              <div
                className="h-28 w-28 rounded-full border-[12px] border-white/[0.05] flex flex-col items-center justify-center"
                aria-hidden="true"
              >
                <span className="font-mono text-base font-medium tabular-nums text-[#525866]">
                  0
                </span>
                <span className="text-[11px] text-[#525866]">
                  {isPlaysEmpty ? 'plays' : 'runtime'}
                </span>
              </div>
              <div className="mt-4 text-sm font-medium text-[#E5E7EB]">
                {isPlaysEmpty
                  ? 'No plays logged in this view yet'
                  : 'Track durations unavailable for runtime chart'}
              </div>
              <p className="mt-1 text-xs text-[#717786] max-w-sm leading-relaxed">
                {isPlaysEmpty
                  ? 'Start playing tracks in the audio player to compare your real listening habits against your library genre balance.'
                  : 'Switch back to track count to inspect distribution across your catalog.'}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                {isPlaysEmpty && (
                  <button
                    type="button"
                    onClick={() =>
                      onPlayList(
                        tracks.map((t) => t.id),
                        { shuffle: 'smart' }
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>Play Library</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMetricMode('tracks')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[#D1D5DB] bg-[#1A1D24] border border-white/[0.08] hover:bg-[#232732] transition-colors whitespace-nowrap"
                >
                  <span>View by Tracks</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center flex-1">
              {/* Recharts Donut Pie Chart */}
              <div className="md:col-span-6 relative h-[236px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="metricValue"
                      nameKey="genre"
                      cx="50%"
                      cy="50%"
                      innerRadius={62}
                      outerRadius={98}
                      paddingAngle={pieData.length > 1 ? 2 : 0}
                      stroke="#12141A"
                      strokeWidth={2}
                      animationDuration={300}
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
                          (!effectiveDrill &&
                            dataSource === 'inferred' &&
                            activeGenre === entry.genre) ||
                          hoveredGenre === entry.genre;
                        const isDimmed =
                          (hoveredGenre !== null && hoveredGenre !== entry.genre) ||
                          (hoveredGenre === null &&
                            !effectiveDrill &&
                            dataSource === 'inferred' &&
                            activeGenre !== 'all' &&
                            activeGenre !== entry.genre);
                        const isInteractive =
                          entry.isRollup ||
                          entry.isFilterable ||
                          isBroadUncategorizedLabel(entry.genre) ||
                          (effectiveDrill?.kind === 'bucket' && Boolean(onOpenBatchTagEditor));

                        return (
                          <Cell
                            key={entry.genre}
                            fill={entry.color}
                            fillOpacity={isDimmed ? 0.3 : isActive ? 1 : 0.9}
                            stroke={isActive ? '#FFFFFF' : '#12141A'}
                            strokeWidth={isActive ? 1.5 : 2}
                            className={
                              isInteractive
                                ? 'cursor-pointer outline-none transition-opacity duration-150'
                                : 'outline-none transition-opacity duration-150'
                            }
                          />
                        );
                      })}
                    </Pie>
                    <Tooltip
                      content={
                        <GenrePieTooltip
                          hasPlays={activeTotalPlays > 0}
                          isDrilled={Boolean(effectiveDrill)}
                        />
                      }
                    />
                  </PieChart>
                </ResponsiveContainer>

                {/* Center Metric Readout */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-4">
                  {highlightedSlice ? (
                    <>
                      <span className="font-mono text-2xl font-semibold tabular-nums text-white leading-none">
                        {highlightedSlice.sharePct}%
                      </span>
                      <span className="mt-1.5 text-xs font-medium text-[#E5E7EB] max-w-[106px] truncate">
                        {highlightedSlice.genre}
                      </span>
                      <span className="mt-0.5 text-[11px] font-mono tabular-nums text-[#8B92A2]">
                        {formatMetricCompact(highlightedSlice, metricMode)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-mono text-xl font-semibold tabular-nums text-white leading-none">
                        {metricMode === 'runtime'
                          ? formatTotalRuntime(activeTotalDuration)
                          : metricMode === 'plays'
                            ? activeTotalPlays
                            : activeTotalTracks}
                      </span>
                      <span className="mt-1.5 text-xs font-medium text-[#9CA3AF] max-w-[106px] truncate">
                        {effectiveDrill?.kind === 'bucket'
                          ? `${pieData.length} ${deepDimension}${pieData.length === 1 ? '' : 's'}`
                          : `${pieData.length} ${pieData.length === 1 ? 'Genre' : 'Genres'}`}
                      </span>
                      <span className="mt-0.5 text-[11px] font-mono tabular-nums text-[#717786]">
                        {diversity.profileLabel}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Interactive Breakdown Legend */}
              <div className="md:col-span-6 space-y-1 max-h-[248px] overflow-y-auto pr-1">
                {pieData.map((entry) => {
                  const isSelected =
                    !effectiveDrill && dataSource === 'inferred' && activeGenre === entry.genre;
                  const isHovered = hoveredGenre === entry.genre;
                  const barWidthPct = Math.max(
                    4,
                    Math.round((entry.sharePct / maxLegendShare) * 100)
                  );
                  const canInspectRow =
                    entry.isRollup ||
                    (effectiveDrill?.kind !== 'bucket' && entry.isDeepInspectable);

                  return (
                    <div
                      key={entry.genre}
                      onMouseEnter={() => setHoveredGenre(entry.genre)}
                      onMouseLeave={() => setHoveredGenre(null)}
                      className={`group flex items-center justify-between gap-2 px-2.5 py-2 rounded transition-colors text-xs ${
                        isSelected
                          ? 'bg-[#FF1F3D]/12 text-white'
                          : isHovered
                            ? 'bg-white/[0.05] text-white'
                            : 'hover:bg-white/[0.04]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSliceInteraction(entry)}
                        className="flex flex-col gap-1 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-2.5 w-2.5 rounded-[2px] shrink-0"
                            style={{ backgroundColor: entry.color }}
                            aria-hidden="true"
                          />
                          <span
                            className={`truncate font-medium ${
                              isSelected
                                ? 'text-[#FF4D64]'
                                : entry.isRollup
                                  ? 'text-[#FDE68A]'
                                  : 'text-[#E5E7EB]'
                            }`}
                          >
                            {entry.genre}
                          </span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-white/[0.05] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-150"
                            style={{
                              width: `${barWidthPct}%`,
                              backgroundColor: entry.color,
                              opacity: isSelected || isHovered ? 0.95 : 0.6,
                            }}
                          />
                        </div>
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0 font-mono tabular-nums text-[11px]">
                        <span className="text-[#A1A7B5]">
                          {metricMode === 'runtime'
                            ? formatTotalRuntime(entry.totalDuration)
                            : metricMode === 'plays'
                              ? entry.playCount
                              : entry.count}
                        </span>
                        <span className="text-[#717786] w-8 text-right">{entry.sharePct}%</span>

                        {canInspectRow && (
                          <button
                            type="button"
                            onClick={() => handleInspectBucket(entry.genre, entry.isRollup)}
                            aria-label={`Analyze ${entry.genre} deeper`}
                            title={`Analyze ${entry.genre} deeper`}
                            className="p-1 rounded text-[#717786] hover:text-[#F59E0B] hover:bg-white/[0.08] transition-colors"
                          >
                            <ZoomIn className="h-3 w-3" />
                          </button>
                        )}

                        {effectiveDrill?.kind === 'bucket' && onOpenBatchTagEditor && (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenBatchTagEditor(
                                entry.trackIds,
                                `${drilledBucketGroup?.genre ?? 'Unclassified'} · ${entry.genre}`
                              )
                            }
                            aria-label={`Batch tag ${entry.genre}`}
                            title={`Batch tag ${entry.genre} (${entry.count} tracks)`}
                            className="p-1 rounded text-[#717786] hover:text-[#FF4D64] hover:bg-white/[0.08] transition-colors"
                          >
                            <Tags className="h-3 w-3" />
                          </button>
                        )}

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
          )}

          {/* Footer Action Strip */}
          <div className="pt-3 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-[#717786]">
              <Layers className="h-3.5 w-3.5 shrink-0" />
              <span>
                {effectiveDrill?.kind === 'other-rollup'
                  ? 'Click any sub-genre to filter the dashboard or zoom icon to break it down'
                  : effectiveDrill?.kind === 'bucket'
                    ? 'Click any slice or tag icon to assign genres via Batch Tag Editor & Auto-Fetch'
                    : dataSource === 'inferred'
                      ? activeGenre === 'all'
                        ? 'Click a genre to filter, or click Unclassified / Other to analyze deeper'
                        : `Filtered by ${activeGenre}`
                      : 'Showing explicit embedded ID3 / FLAC / M4A genre tags'}
              </span>
              {!effectiveDrill && dataSource === 'inferred' && activeGenre !== 'all' && (
                <button
                  type="button"
                  onClick={() => onSelectGenre('all')}
                  className="text-[#E5E7EB] hover:text-white underline underline-offset-2 ml-1 whitespace-nowrap"
                >
                  Clear filter
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {!effectiveDrill && tracks.length > 1 && diversity.activeGenreCount > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    onPlayList(
                      tracks.map((t) => t.id),
                      { shuffle: 'smart' }
                    )
                  }
                  className="inline-flex items-center gap-1.5 text-[#A1A7B5] hover:text-white transition-colors whitespace-nowrap"
                  title="Smart shuffle across all genres in your library"
                >
                  <Shuffle className="h-3 w-3" />
                  <span>Mix Library</span>
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  onOpenScanner('all', {
                    genre:
                      effectiveDrill?.kind === 'bucket' && dataSource === 'inferred'
                        ? effectiveDrill.genre
                        : activeGenre,
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
        </div>
      ) : (
        /* Detailed Table Breakdown View */
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#0F1116] border-b border-white/[0.07] text-[#717786]">
              <tr>
                <th className="py-2.5 pl-5 pr-3 font-medium">
                  {effectiveDrill?.kind === 'bucket'
                    ? deepDimension.charAt(0).toUpperCase() + deepDimension.slice(1)
                    : 'Genre'}
                </th>
                <th className="py-2.5 px-3 font-medium w-32">
                  {metricMode === 'runtime'
                    ? 'Runtime Share'
                    : metricMode === 'plays'
                      ? 'Play Share'
                      : 'Catalog Share'}
                </th>
                <th className="py-2.5 px-3 font-medium">Runtime / Plays</th>
                <th className="py-2.5 pl-3 pr-5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {(effectiveDrill ? pieData : enrichedGroups.map((g) => ({
                genre: g.genre,
                count: g.count,
                sharePct: g.activeSharePct,
                totalDuration: g.totalDuration,
                avgDuration: g.avgDuration,
                playCount: g.playCount,
                playSharePct: g.playSharePct,
                matchedCount: g.matchedCount,
                trackIds: g.trackIds,
                avgBitrateKbps: g.avgBitrateKbps,
              }))).map((row) => {
                const isSelected =
                  !effectiveDrill && dataSource === 'inferred' && activeGenre === row.genre;
                return (
                  <tr
                    key={row.genre}
                    className={`transition-colors ${
                      isSelected ? 'bg-[#FF1F3D]/[0.08]' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <td className="py-2.5 pl-5 pr-3">
                      <button
                        type="button"
                        disabled={effectiveDrill?.kind === 'bucket' || dataSource !== 'inferred'}
                        onClick={() =>
                          onSelectGenre(activeGenre === row.genre ? 'all' : row.genre)
                        }
                        className={`font-medium text-left transition-colors ${
                          isSelected
                            ? 'text-[#FF4D64]'
                            : !effectiveDrill && dataSource === 'inferred'
                              ? 'text-white hover:text-[#FF4D64]'
                              : 'text-white cursor-default'
                        }`}
                      >
                        {row.genre}
                      </button>
                      <div className="text-[11px] font-mono tabular-nums text-[#6B7280] mt-0.5">
                        {row.matchedCount}/{row.count} matched
                      </div>
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-between font-mono tabular-nums text-[11px] text-[#A1A7B5] mb-1">
                        <span>
                          {metricMode === 'runtime'
                            ? formatTotalRuntime(row.totalDuration)
                            : metricMode === 'plays'
                              ? `${row.playCount} plays`
                              : `${row.count} tracks`}
                        </span>
                        <span>{row.sharePct}%</span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-white/[0.07] overflow-hidden">
                        <div
                          className="h-full bg-[#FF1F3D]/80"
                          style={{
                            width: `${row.sharePct > 0 ? Math.max(4, row.sharePct) : 0}%`,
                          }}
                        />
                      </div>
                    </td>

                    <td className="py-2.5 px-3 font-mono tabular-nums text-[#A1A7B5] whitespace-nowrap">
                      <div>
                        {formatTotalRuntime(row.totalDuration)} · {formatDuration(row.avgDuration)}{' '}
                        avg
                      </div>
                      <div className="text-[11px] text-[#6B7280]">
                        {row.playCount} {row.playCount === 1 ? 'play' : 'plays'}
                        {activeTotalPlays > 0 ? ` (${row.playSharePct}%)` : ''}
                      </div>
                    </td>

                    <td className="py-2.5 pl-3 pr-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => onPlayList(row.trackIds, { shuffle: false })}
                          aria-label={`Play ${row.genre} tracks`}
                          title={`Play ${row.genre}`}
                          className="text-[#9CA3AF] hover:text-white transition-colors"
                        >
                          <Play className="h-3.5 w-3.5 fill-current" />
                        </button>
                        {effectiveDrill?.kind !== 'bucket' && (
                          <button
                            type="button"
                            onClick={() => handleInspectBucket(row.genre, false)}
                            className="text-[#F59E0B] hover:text-[#FDE68A] transition-colors"
                          >
                            Analyze
                          </button>
                        )}
                        {effectiveDrill?.kind === 'bucket' && onOpenBatchTagEditor && (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenBatchTagEditor(
                                row.trackIds,
                                `${drilledBucketGroup?.genre ?? 'Unclassified'} · ${row.genre}`
                              )
                            }
                            className="text-[#FF4D64] hover:text-[#FF7588] transition-colors"
                          >
                            Batch Tag
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onCreatePlaylistFromTracks(row.trackIds)}
                          className="text-[#A1A7B5] hover:text-white transition-colors"
                        >
                          Playlist
                        </button>
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
