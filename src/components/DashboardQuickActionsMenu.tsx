import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  Download,
  Filter,
  Fingerprint,
  FolderOpen,
  FolderSync,
  Link2,
  RefreshCw,
  ShieldAlert,
  Tags,
  Upload,
  Zap,
} from 'lucide-react';
import type { LocalTrack, WatchedFolderInfo } from '../types/music';
import {
  summarizeIntegrityIssues,
  type TrackIntegrityScanResult,
} from '../utils/audioIntegrity';
import { isSha256Hash } from '../utils/audioMetadata';
import { hasValidYearTag, isTrackMissingGenre } from '../utils/dashboardSmartFilters';
import { exportCatalogToCSV, findDuplicateGroups } from '../utils/duplicateDetector';
import type { InferredGenreResult } from '../utils/genreInference';
import { formatFileSize, triggerFileDownload } from '../utils/youtubeLinks';
import type { DashboardSectionId } from './DashboardJumpMenu';

type QuickActionGroup = 'Library Maintenance' | 'Activity & Insights' | 'Sync & Catalog';

type QuickActionTone = 'default' | 'amber' | 'danger' | 'success';

interface QuickActionItem {
  id: string;
  label: string;
  description: string;
  group: QuickActionGroup;
  metric: string;
  tone: QuickActionTone;
  disabled?: boolean;
  icon:
    | 'tags'
    | 'duplicates'
    | 'integrity'
    | 'cleanup'
    | 'match'
    | 'activity'
    | 'daily'
    | 'filter'
    | 'folder'
    | 'sync'
    | 'export'
    | 'import';
  onTrigger: () => void;
}

interface DashboardQuickActionsMenuProps {
  tracks: LocalTrack[];
  trackGenreMap: Map<string, InferredGenreResult>;
  integrityResults?: Record<string, TrackIntegrityScanResult>;
  watchedFolder: WatchedFolderInfo | null;
  isScanning: boolean;
  playHistoryCount: number;
  totalPendingSyncs: number;
  onJumpToSection: (sectionId: DashboardSectionId) => void;
  onOpenScanner: (
    filter?: 'all' | 'unmatched' | 'matched' | 'missing',
    options?: {
      genre?: string;
      groupByGenre?: boolean;
      openCleanup?: boolean;
      openDuplicates?: boolean;
      openIntegrity?: boolean;
      query?: string;
    }
  ) => void;
  onOpenBatchTagEditor?: (trackIds: string[], contextLabel: string) => void;
  onInspectTrack: (trackId: string) => void;
  onMountFolder: () => void;
  onRescanFolder: () => void;
  onOpenSyncQueue: () => void;
  onOpenTransfer: () => void;
}

function renderActionIcon(
  icon: QuickActionItem['icon'],
  isActive: boolean,
  disabled?: boolean
) {
  const cls = `h-4 w-4 shrink-0 ${
    disabled ? 'text-[#4B5563]' : isActive ? 'text-[#FF4D64]' : 'text-[#8B92A2]'
  }`;
  switch (icon) {
    case 'tags':
      return <Tags className={cls} />;
    case 'duplicates':
      return <Fingerprint className={cls} />;
    case 'integrity':
      return <ShieldAlert className={cls} />;
    case 'cleanup':
      return <AlertTriangle className={cls} />;
    case 'match':
      return <Link2 className={cls} />;
    case 'activity':
      return <Activity className={cls} />;
    case 'daily':
      return <BarChart3 className={cls} />;
    case 'filter':
      return <Filter className={cls} />;
    case 'folder':
      return <FolderOpen className={cls} />;
    case 'sync':
      return <FolderSync className={cls} />;
    case 'export':
      return <Download className={cls} />;
    case 'import':
      return <Upload className={cls} />;
  }
}

const GROUP_ORDER: QuickActionGroup[] = [
  'Library Maintenance',
  'Activity & Insights',
  'Sync & Catalog',
];

export function DashboardQuickActionsMenu({
  tracks,
  trackGenreMap,
  integrityResults = {},
  watchedFolder,
  isScanning,
  playHistoryCount,
  totalPendingSyncs,
  onJumpToSection,
  onOpenScanner,
  onOpenBatchTagEditor,
  onInspectTrack,
  onMountFolder,
  onRescanFolder,
  onOpenSyncQueue,
  onOpenTransfer,
}: DashboardQuickActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Compute live library health metrics for Quick Actions
  const healthMetrics = useMemo(() => {
    const metadataIssueTrackIds: string[] = [];
    let missingFileCount = 0;
    let firstUnmatchedId: string | null = null;
    let unmatchedCount = 0;
    let unhashedCount = 0;

    for (const track of tracks) {
      const missingGenre = isTrackMissingGenre(track, trackGenreMap);
      const missingYear = !hasValidYearTag(track);
      const missingArtwork = !track.coverArtUrl;
      const unknownArtistOrAlbum =
        !track.artist ||
        track.artist.trim().toLowerCase() === 'unknown artist' ||
        !track.album ||
        track.album.trim().toLowerCase() === 'unknown album';

      if (missingGenre || missingYear || missingArtwork || unknownArtistOrAlbum) {
        metadataIssueTrackIds.push(track.id);
      }

      if (track.isMissingOnDevice) {
        missingFileCount += 1;
      }

      if (!track.youtubeVideoId && track.matchStatus !== 'skipped') {
        unmatchedCount += 1;
        if (!firstUnmatchedId) {
          firstUnmatchedId = track.id;
        }
      }

      if (track.fileSize > 0 && !isSha256Hash(track.contentHash)) {
        unhashedCount += 1;
      }
    }

    const duplicateGroups = findDuplicateGroups(tracks);
    const redundantCount = duplicateGroups.reduce((acc, g) => acc + (g.tracks.length - 1), 0);
    const redundantBytes = duplicateGroups.reduce((acc, g) => acc + g.redundantBytes, 0);
    const integritySummary = summarizeIntegrityIssues(tracks, integrityResults);

    return {
      metadataIssueTrackIds,
      missingFileCount,
      firstUnmatchedId,
      unmatchedCount,
      unhashedCount,
      redundantCount,
      redundantBytes,
      integrityFlaggedCount: integritySummary.totalFlagged,
      integrityHeaderCount: integritySummary.headerIssueCount,
    };
  }, [tracks, trackGenreMap, integrityResults]);

  const actions = useMemo<QuickActionItem[]>(() => {
    const hasTracks = tracks.length > 0;
    const {
      metadataIssueTrackIds,
      missingFileCount,
      firstUnmatchedId,
      unmatchedCount,
      unhashedCount,
      redundantCount,
      redundantBytes,
      integrityFlaggedCount,
      integrityHeaderCount,
    } = healthMetrics;

    const list: QuickActionItem[] = [
      {
        id: 'audio-integrity',
        label: 'Audio Integrity',
        description:
          'Detect corrupt headers or incomplete duration metadata and fix them in Scanner',
        group: 'Library Maintenance',
        metric: !hasTracks
          ? 'No tracks'
          : integrityFlaggedCount > 0
            ? `${integrityFlaggedCount} ${integrityFlaggedCount === 1 ? 'issue' : 'issues'}`
            : 'Healthy',
        tone: !hasTracks
          ? 'default'
          : integrityHeaderCount > 0
            ? 'danger'
            : integrityFlaggedCount > 0
              ? 'amber'
              : 'success',
        disabled: !hasTracks,
        icon: 'integrity',
        onTrigger: () => {
          onOpenScanner('all', { openIntegrity: true });
        },
      },
      {
        id: 'optimize-metadata',
        label: 'Optimize Metadata',
        description:
          metadataIssueTrackIds.length > 0
            ? 'Batch-fix tracks missing genre, year, cover art, or artist/album tags'
            : 'Review and refine metadata tags across your library',
        group: 'Library Maintenance',
        metric: !hasTracks
          ? 'No tracks'
          : metadataIssueTrackIds.length > 0
            ? `${metadataIssueTrackIds.length} need tags`
            : 'All tagged',
        tone: !hasTracks
          ? 'default'
          : metadataIssueTrackIds.length > 0
            ? 'amber'
            : 'success',
        disabled: !hasTracks || !onOpenBatchTagEditor,
        icon: 'tags',
        onTrigger: () => {
          if (!onOpenBatchTagEditor || !hasTracks) return;
          if (metadataIssueTrackIds.length > 0) {
            onOpenBatchTagEditor(
              metadataIssueTrackIds,
              `Metadata optimization (${metadataIssueTrackIds.length} tracks)`
            );
          } else {
            onOpenBatchTagEditor(
              tracks.map((t) => t.id),
              `Full library (${tracks.length} tracks)`
            );
          }
        },
      },
      {
        id: 'scan-duplicates',
        label: 'Scan for Duplicates',
        description: 'Open Duplicate Finder and verify identical files via SHA-256 hash',
        group: 'Library Maintenance',
        metric: !hasTracks
          ? 'No tracks'
          : redundantCount > 0
            ? `${redundantCount} dupes · ${formatFileSize(redundantBytes)}`
            : unhashedCount > 0
              ? `${unhashedCount} to hash`
              : '0 found',
        tone: !hasTracks
          ? 'default'
          : redundantCount > 0
            ? 'amber'
            : 'success',
        disabled: !hasTracks,
        icon: 'duplicates',
        onTrigger: () => {
          onOpenScanner('all', { openDuplicates: true });
        },
      },
      {
        id: 'cleanup-missing',
        label: 'Clean Up Missing Files',
        description: 'Inspect and prune tracks whose source files moved or disappeared',
        group: 'Library Maintenance',
        metric: !hasTracks
          ? 'No tracks'
          : missingFileCount > 0
            ? `${missingFileCount} missing`
            : 'Clean',
        tone: !hasTracks
          ? 'default'
          : missingFileCount > 0
            ? 'danger'
            : 'success',
        disabled: !hasTracks,
        icon: 'cleanup',
        onTrigger: () => {
          onOpenScanner(missingFileCount > 0 ? 'missing' : 'all', { openCleanup: true });
        },
      },
      {
        id: 'match-unmatched',
        label: 'Match Unmatched Tracks',
        description: 'Bind local audio tracks to YouTube Music for playlist sync',
        group: 'Library Maintenance',
        metric: !hasTracks
          ? 'No tracks'
          : unmatchedCount > 0
            ? `${unmatchedCount} unmatched`
            : 'All matched',
        tone: !hasTracks
          ? 'default'
          : unmatchedCount > 0
            ? 'amber'
            : 'success',
        disabled: !hasTracks,
        icon: 'match',
        onTrigger: () => {
          if (firstUnmatchedId) {
            onInspectTrack(firstUnmatchedId);
          } else {
            onOpenScanner('all');
          }
        },
      },
      {
        id: 'view-recent-activity',
        label: 'View Recent Activity',
        description: 'Jump to your recent playback log and top-played songs',
        group: 'Activity & Insights',
        metric: `${playHistoryCount} ${playHistoryCount === 1 ? 'play' : 'plays'}`,
        tone: 'default',
        icon: 'activity',
        onTrigger: () => {
          onJumpToSection('top-played');
        },
      },
      {
        id: 'view-daily-listening',
        label: 'Daily Listening Trends',
        description: 'Jump to your 30-day daily playback duration chart',
        group: 'Activity & Insights',
        metric: '30 days',
        tone: 'default',
        icon: 'daily',
        onTrigger: () => {
          onJumpToSection('daily-listening');
        },
      },
    ];

    if (hasTracks) {
      list.push({
        id: 'open-smart-filter',
        label: 'Run Smart Filter',
        description: 'Filter inline by No Genre, Missing Year, 10m+ tracks, or custom rules',
        group: 'Activity & Insights',
        metric: `${tracks.length} tracks`,
        tone: 'default',
        icon: 'filter',
        onTrigger: () => {
          onJumpToSection('smart-filter');
        },
      });
    }

    list.push(
      {
        id: 'scan-or-mount-folder',
        label: watchedFolder?.hasLiveHandle ? 'Re-scan Watched Folder' : 'Mount Local Folder',
        description: watchedFolder?.hasLiveHandle
          ? 'Scan watched directory for newly added or removed audio files'
          : 'Connect a local audio folder from your device storage',
        group: 'Sync & Catalog',
        metric: isScanning
          ? 'Scanning...'
          : watchedFolder?.name
            ? watchedFolder.name
            : 'Not mounted',
        tone: 'default',
        disabled: isScanning,
        icon: 'folder',
        onTrigger: () => {
          if (watchedFolder?.hasLiveHandle) {
            onRescanFolder();
          } else {
            onMountFolder();
          }
        },
      },
      {
        id: 'open-sync-queue',
        label: 'Open Sync Queue',
        description: 'Review and apply pending playlist additions and removals',
        group: 'Sync & Catalog',
        metric: totalPendingSyncs > 0 ? `${totalPendingSyncs} pending` : 'Up to date',
        tone: totalPendingSyncs > 0 ? 'amber' : 'success',
        icon: 'sync',
        onTrigger: () => {
          onOpenSyncQueue();
        },
      },
      {
        id: 'export-catalog-csv',
        label: 'Export Library CSV',
        description: 'Download complete track metadata and YouTube Music links',
        group: 'Sync & Catalog',
        metric: hasTracks ? `${tracks.length} rows` : 'Empty',
        tone: 'default',
        disabled: !hasTracks,
        icon: 'export',
        onTrigger: () => {
          if (!hasTracks) return;
          triggerFileDownload(
            exportCatalogToCSV(tracks),
            'cratesync-library.csv',
            'text/csv;charset=utf-8'
          );
        },
      },
      {
        id: 'import-m3u-csv',
        label: 'Import M3U / CSV Playlist',
        description: 'Bring external playlists or track lists into CrateSync',
        group: 'Sync & Catalog',
        metric: 'Transfer',
        tone: 'default',
        icon: 'import',
        onTrigger: () => {
          onOpenTransfer();
        },
      }
    );

    return list;
  }, [
    tracks,
    healthMetrics,
    playHistoryCount,
    watchedFolder,
    isScanning,
    totalPendingSyncs,
    onOpenBatchTagEditor,
    onOpenScanner,
    onInspectTrack,
    onJumpToSection,
    onRescanFolder,
    onMountFolder,
    onOpenSyncQueue,
    onOpenTransfer,
  ]);

  const enabledIndices = useMemo(
    () => actions.map((a, idx) => (a.disabled ? -1 : idx)).filter((idx) => idx >= 0),
    [actions]
  );

  // Global keyboard shortcut: 'Q' (outside text inputs) toggles Quick Actions menu
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (!isTyping && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        setIsOpen((prev) => {
          const next = !prev;
          if (next) {
            setHighlightedIndex(enabledIndices[0] ?? 0);
          }
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [enabledIndices]);

  // Close on click-outside and support keyboard navigation while open
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
        return;
      }

      if (enabledIndices.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          const pos = enabledIndices.indexOf(prev);
          const nextPos = pos === -1 ? 0 : (pos + 1) % enabledIndices.length;
          return enabledIndices[nextPos];
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          const pos = enabledIndices.indexOf(prev);
          const nextPos =
            pos <= 0 ? enabledIndices.length - 1 : (pos - 1) % enabledIndices.length;
          return enabledIndices[nextPos];
        });
      } else if (e.key === 'Enter') {
        const chosen = actions[highlightedIndex];
        if (chosen && !chosen.disabled) {
          e.preventDefault();
          setIsOpen(false);
          chosen.onTrigger();
        }
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, actions, enabledIndices, highlightedIndex]);

  const groupedActions = useMemo(() => {
    return GROUP_ORDER.map((group) => ({
      group,
      items: actions
        .map((action, flatIndex) => ({ action, flatIndex }))
        .filter(({ action }) => action.group === group),
    })).filter((g) => g.items.length > 0);
  }, [actions]);

  const attentionCount =
    (healthMetrics.integrityFlaggedCount > 0 ? 1 : 0) +
    (healthMetrics.metadataIssueTrackIds.length > 0 ? 1 : 0) +
    (healthMetrics.redundantCount > 0 ? 1 : 0) +
    (healthMetrics.missingFileCount > 0 ? 1 : 0);

  const metricColorClass = (tone: QuickActionTone, disabled?: boolean) => {
    if (disabled) return 'text-[#4B5563]';
    switch (tone) {
      case 'amber':
        return 'text-[#F59E0B]';
      case 'danger':
        return 'text-[#F87171]';
      case 'success':
        return 'text-[#22C55E]';
      default:
        return 'text-[#717786]';
    }
  };

  const handleToggle = () => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        setHighlightedIndex(enabledIndices[0] ?? 0);
      }
      return next;
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title="One-click library productivity actions (Shortcut: Q)"
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
          isOpen
            ? 'text-white bg-[#1E222B] border-[#FF1F3D]/55'
            : 'text-[#E5E7EB] bg-[#161920] border-white/[0.09] hover:bg-[#1E222B]'
        }`}
      >
        <Zap className="h-3.5 w-3.5 text-[#FF4D64] shrink-0" />
        <span>Quick Actions</span>
        {attentionCount > 0 && (
          <span className="font-mono tabular-nums text-[11px] text-[#F59E0B]">
            ({attentionCount})
          </span>
        )}
        <span className="hidden sm:inline font-mono text-[10px] text-[#717786] border border-white/[0.09] rounded px-1 py-0.5 leading-none">
          Q
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-[#717786] transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-white' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Dashboard quick actions"
          className="absolute right-0 mt-2 z-40 w-[min(390px,calc(100vw-2.5rem))] rounded-lg border border-white/[0.11] bg-[#111319] shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-white/[0.07] flex items-center justify-between gap-3 bg-[#141720]">
            <div className="flex items-center gap-2 min-w-0">
              <Zap className="h-3.5 w-3.5 text-[#FF4D64] shrink-0" />
              <span className="text-xs font-semibold text-white truncate">
                Quick Actions
              </span>
            </div>
            <span className="font-mono text-[11px] tabular-nums text-[#717786] shrink-0">
              {tracks.length > 0 ? `${tracks.length} tracks indexed` : 'Empty library'}
            </span>
          </div>

          {/* Grouped Action List */}
          <div className="max-h-[min(68vh,460px)] overflow-y-auto py-1.5 divide-y divide-white/[0.06]">
            {groupedActions.map(({ group, items }) => (
              <div key={group} className="py-1.5 first:pt-1 last:pb-1">
                <div className="px-4 py-1 text-[11px] font-medium text-[#717786]">
                  {group}
                </div>
                {items.map(({ action, flatIndex }) => {
                  const isHighlighted = flatIndex === highlightedIndex && !action.disabled;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      role="menuitem"
                      disabled={action.disabled}
                      onMouseEnter={() => {
                        if (!action.disabled) setHighlightedIndex(flatIndex);
                      }}
                      onClick={() => {
                        if (action.disabled) return;
                        setIsOpen(false);
                        action.onTrigger();
                      }}
                      className={`w-full px-4 py-2 text-left flex items-center justify-between gap-3 transition-colors ${
                        action.disabled
                          ? 'opacity-45 cursor-not-allowed'
                          : isHighlighted
                            ? 'bg-white/[0.07] text-white'
                            : 'text-[#D1D5DB] hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className="mt-0.5">
                          {action.id === 'scan-or-mount-folder' && isScanning ? (
                            <RefreshCw className="h-4 w-4 text-[#FF4D64] animate-spin shrink-0" />
                          ) : (
                            renderActionIcon(action.icon, isHighlighted, action.disabled)
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-white truncate">
                            {action.label}
                          </div>
                          <div className="text-[11px] text-[#717786] truncate mt-0.5">
                            {action.description}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`font-mono text-[11px] tabular-nums shrink-0 max-w-[115px] truncate ${metricColorClass(
                          action.tone,
                          action.disabled
                        )}`}
                      >
                        {action.metric}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Quiet Keyboard Footer */}
          <div className="px-4 py-2 border-t border-white/[0.07] bg-[#0D0F14] flex items-center justify-between gap-3 text-[11px] text-[#6B7280]">
            <span>↑↓ Navigate · Enter Run · Esc Close</span>
            <span className="font-mono text-[10px] text-[#717786]">Shortcut: Q</span>
          </div>
        </div>
      )}
    </div>
  );
}
