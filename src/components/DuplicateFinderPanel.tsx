import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Download,
  Fingerprint,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type { LocalTrack } from '../types/music';
import {
  exportDuplicatesReportToCSV,
  type DuplicateGroup,
} from '../utils/duplicateDetector';
import { formatDuration, formatFileSize, triggerFileDownload } from '../utils/youtubeLinks';

interface DuplicateFinderPanelProps {
  groups: DuplicateGroup[];
  totalTracks: number;
  unhashedCount: number;
  isHashing: boolean;
  hashProgress: { processed: number; total: number } | null;
  activePlayingTrackId: string | null;
  isAudioPlaying: boolean;
  onRunHashScan: () => void;
  onPlayTrack: (trackId: string, queueIds: string[]) => void;
  onRequestRemoveDuplicates: (removeIds: string[], remapToKeep: Record<string, string>) => void;
  onClose: () => void;
}

export function DuplicateFinderPanel({
  groups,
  totalTracks,
  unhashedCount,
  isHashing,
  hashProgress,
  activePlayingTrackId,
  isAudioPlaying,
  onRunHashScan,
  onPlayTrack,
  onRequestRemoveDuplicates,
  onClose,
}: DuplicateFinderPanelProps) {
  // Track which track ID is marked as the canonical "Keep" copy for each group
  const [keepByGroup, setKeepByGroup] = useState<Record<string, string>>({});
  // Allow user to exclude individual redundant tracks from removal if desired
  const [excludedFromRemoval, setExcludedFromRemoval] = useState<Set<string>>(new Set());

  // Initialize default recommended Keep IDs when groups update
  useEffect(() => {
    setKeepByGroup((prev) => {
      const next: Record<string, string> = {};
      for (const group of groups) {
        const existing = prev[group.key];
        const stillValid = existing && group.tracks.some((t) => t.id === existing);
        next[group.key] = stillValid ? existing : group.recommendedKeepId;
      }
      return next;
    });
  }, [groups]);

  const removalPlan = useMemo(() => {
    const removeIds: string[] = [];
    const remapToKeep: Record<string, string> = {};
    let reclaimableBytes = 0;

    for (const group of groups) {
      const keepId = keepByGroup[group.key] || group.recommendedKeepId;
      for (const track of group.tracks) {
        if (track.id === keepId) continue;
        if (excludedFromRemoval.has(track.id)) continue;
        removeIds.push(track.id);
        remapToKeep[track.id] = keepId;
        reclaimableBytes += track.fileSize || 0;
      }
    }

    return { removeIds, remapToKeep, reclaimableBytes };
  }, [groups, keepByGroup, excludedFromRemoval]);

  const handleSetKeep = (groupKey: string, trackId: string) => {
    setKeepByGroup((prev) => ({ ...prev, [groupKey]: trackId }));
    setExcludedFromRemoval((prev) => {
      if (!prev.has(trackId)) return prev;
      const next = new Set(prev);
      next.delete(trackId);
      return next;
    });
  };

  const handleToggleRemoval = (trackId: string) => {
    setExcludedFromRemoval((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const handleExportReport = () => {
    const csv = exportDuplicatesReportToCSV(groups);
    triggerFileDownload(csv, 'cratesync-duplicate-report.csv', 'text/csv;charset=utf-8');
  };

  return (
    <section
      aria-label="Duplicate audio track detector"
      className="mx-5 sm:mx-6 my-4 rounded-lg border border-white/[0.1] bg-[#11141B] overflow-hidden shrink-0"
    >
      {/* Panel Header */}
      <div className="px-5 py-3.5 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Fingerprint className="h-4 w-4 text-[#FF4D64] shrink-0" />
            <h2 className="font-display text-sm font-semibold text-white">
              Duplicate Audio Detector
            </h2>
          </div>
          <div className="mt-1 text-xs text-[#8B92A2] font-mono tabular-nums">
            {groups.length > 0 ? (
              <>
                <span className="text-[#F59E0B]">{groups.length} duplicate groups</span>
                <span className="mx-1.5 text-[#4B5563]" aria-hidden="true">
                  ·
                </span>
                <span>{removalPlan.removeIds.length} redundant selected</span>
                <span className="mx-1.5 text-[#4B5563]" aria-hidden="true">
                  ·
                </span>
                <span>{formatFileSize(removalPlan.reclaimableBytes)} reclaimable</span>
              </>
            ) : (
              <span>
                Scanned {totalTracks} track{totalTracks === 1 ? '' : 's'} by file size &amp; SHA-256
                hash
              </span>
            )}
            {unhashedCount > 0 && (
              <>
                <span className="mx-1.5 text-[#4B5563]" aria-hidden="true">
                  ·
                </span>
                <span className="text-[#9CA3AF]">{unhashedCount} unhashed</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {unhashedCount > 0 && (
            <button
              type="button"
              onClick={onRunHashScan}
              disabled={isHashing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[#E5E7EB] bg-[#191D26] border border-white/[0.09] hover:bg-[#222733] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isHashing ? 'animate-spin' : ''}`} />
              <span>
                {hashProgress
                  ? `Hashing ${hashProgress.processed}/${hashProgress.total}`
                  : `Verify ${unhashedCount} Hashes`}
              </span>
            </button>
          )}

          {groups.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleExportReport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[#D1D5DB] bg-[#191D26] border border-white/[0.09] hover:text-white hover:bg-[#222733] transition-colors whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Export Report</span>
              </button>

              <button
                type="button"
                disabled={removalPlan.removeIds.length === 0}
                onClick={() =>
                  onRequestRemoveDuplicates(removalPlan.removeIds, removalPlan.remapToKeep)
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium text-white bg-[#DC2626] hover:bg-[#B91C1C] disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Remove {removalPlan.removeIds.length} Redundant</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close duplicate detector"
            className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      {groups.length === 0 ? (
        <div className="px-5 py-5 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 text-[#22C55E] shrink-0" />
            <span className="text-[#D1D5DB]">
              No duplicate audio tracks found by file size or SHA-256 content hash.
            </span>
          </div>
          {unhashedCount > 0 && (
            <button
              type="button"
              onClick={onRunHashScan}
              disabled={isHashing}
              className="text-[#FF4D64] hover:text-[#FF7588] font-medium whitespace-nowrap"
            >
              Compute SHA-256 hashes for {unhashedCount} remaining file
              {unhashedCount === 1 ? '' : 's'}
            </button>
          )}
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto divide-y divide-white/[0.07]">
          {groups.map((group, groupIdx) => {
            const keepId = keepByGroup[group.key] || group.recommendedKeepId;
            const groupTrackIds = group.tracks.map((t) => t.id);

            return (
              <div key={group.key} className="px-5 py-3.5 space-y-2.5">
                {/* Group Metadata Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
                    <span className="text-white font-medium">
                      Group {String(groupIdx + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[#4B5563]" aria-hidden="true">
                      ·
                    </span>
                    <span
                      className={
                        group.matchKind === 'hash+size' ? 'text-[#22C55E]' : 'text-[#F59E0B]'
                      }
                    >
                      {group.matchKind === 'hash+size'
                        ? 'Exact SHA-256 + Size'
                        : 'Same File Size (unverified hash)'}
                    </span>
                    <span className="text-[#4B5563]" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-[#A1A7B5]">{formatFileSize(group.fileSize)}</span>
                    {group.contentHash && (
                      <>
                        <span className="text-[#4B5563]" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-[#717786]" title={group.contentHash}>
                          sha256:{group.contentHash.slice(0, 12)}
                        </span>
                      </>
                    )}
                  </div>
                  <span className="font-mono text-[11px] tabular-nums text-[#717786]">
                    {group.tracks.length} copies
                  </span>
                </div>

                {/* Copies Inside Group */}
                <div className="divide-y divide-white/[0.05] rounded-md border border-white/[0.07] bg-[#0C0E12]">
                  {group.tracks.map((track: LocalTrack) => {
                    const isKept = track.id === keepId;
                    const markedForRemoval = !isKept && !excludedFromRemoval.has(track.id);
                    const isPlaying = activePlayingTrackId === track.id && isAudioPlaying;

                    return (
                      <div
                        key={track.id}
                        className={`px-3.5 py-2 flex items-center justify-between gap-3 text-xs ${
                          markedForRemoval ? 'bg-[#DC2626]/[0.05]' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => onPlayTrack(track.id, groupTrackIds)}
                            aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
                            className="h-6 w-6 rounded flex items-center justify-center text-[#8B92A2] hover:text-white hover:bg-white/[0.07] shrink-0 transition-colors"
                          >
                            {isPlaying ? (
                              <Pause className="h-3 w-3 fill-current text-[#FF1F3D]" />
                            ) : (
                              <Play className="h-3 w-3 fill-current ml-0.5" />
                            )}
                          </button>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-medium truncate ${
                                  markedForRemoval ? 'text-[#9CA3AF] line-through' : 'text-white'
                                }`}
                              >
                                {track.title}
                              </span>
                              <span className="text-[#6B7280] truncate hidden sm:inline">
                                {track.artist}
                              </span>
                            </div>
                            <div
                              className="text-[11px] font-mono text-[#6B7280] truncate"
                              title={track.relativePath}
                            >
                              {track.relativePath}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {track.youtubeVideoId && (
                            <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-mono text-[#22C55E]">
                              <Check className="h-3 w-3" />
                              <span>Matched</span>
                            </span>
                          )}
                          <span className="font-mono text-[11px] tabular-nums text-[#717786] hidden sm:inline">
                            {formatDuration(track.duration)}
                          </span>

                          {isKept ? (
                            <span className="text-[11px] font-medium text-[#22C55E] w-20 text-right">
                              Keeping
                            </span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleSetKeep(group.key, track.id)}
                                className="text-[11px] text-[#9CA3AF] hover:text-white transition-colors whitespace-nowrap"
                              >
                                Keep instead
                              </button>
                              <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px]">
                                <input
                                  type="checkbox"
                                  checked={markedForRemoval}
                                  onChange={() => handleToggleRemoval(track.id)}
                                  aria-label={`Mark ${track.relativePath} for removal`}
                                  className="h-3.5 w-3.5 rounded accent-[#DC2626]"
                                />
                                <span
                                  className={
                                    markedForRemoval ? 'text-[#FCA5A5]' : 'text-[#717786]'
                                  }
                                >
                                  Remove
                                </span>
                              </label>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
