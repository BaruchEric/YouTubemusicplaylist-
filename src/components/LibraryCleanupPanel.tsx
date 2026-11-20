import { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type { LocalTrack, Playlist } from '../types/music';
import {
  formatDuration,
  formatFileSize,
  formatRelativeTime,
  triggerFileDownload,
} from '../utils/youtubeLinks';

interface LibraryCleanupPanelProps {
  tracks: LocalTrack[];
  playlists: Playlist[];
  isScanning: boolean;
  hasLiveFolderHandle: boolean;
  onRemoveMissingTracks: (trackIds: string[]) => void;
  onRescanFolder: () => void;
  onClose: () => void;
}

function csvCell(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function LibraryCleanupPanel({
  tracks,
  playlists,
  isScanning,
  hasLiveFolderHandle,
  onRemoveMissingTracks,
  onRescanFolder,
  onClose,
}: LibraryCleanupPanelProps) {
  const missingTracks = useMemo(
    () => tracks.filter((t) => t.isMissingOnDevice),
    [tracks]
  );

  const missingIds = useMemo(() => missingTracks.map((t) => t.id), [missingTracks]);

  const affectedPlaylistsByTrack = useMemo(() => {
    const map = new Map<string, string[]>();
    const missingSet = new Set(missingIds);
    for (const pl of playlists) {
      for (const id of pl.trackIds) {
        if (!missingSet.has(id)) continue;
        const list = map.get(id) ?? [];
        list.push(pl.name);
        map.set(id, list);
      }
    }
    return map;
  }, [playlists, missingIds]);

  const summary = useMemo(() => {
    let totalSize = 0;
    let matchedCount = 0;
    const affectedPlaylists = new Set<string>();
    const missingSet = new Set(missingIds);

    for (const t of missingTracks) {
      totalSize += t.fileSize || 0;
      if (t.youtubeVideoId) matchedCount++;
    }
    for (const pl of playlists) {
      if (pl.trackIds.some((id) => missingSet.has(id))) {
        affectedPlaylists.add(pl.id);
      }
    }

    return {
      count: missingTracks.length,
      totalSize,
      matchedCount,
      affectedPlaylistCount: affectedPlaylists.size,
    };
  }, [missingTracks, missingIds, playlists]);

  const handleExportMissingCsv = () => {
    if (missingTracks.length === 0) return;
    const header = [
      'Title',
      'Artist',
      'Album',
      'Folder',
      'Relative Path',
      'Format',
      'Size Bytes',
      'YouTube Video ID',
      'Affected Playlists',
    ];
    const rows = missingTracks.map((t) => [
      csvCell(t.title),
      csvCell(t.artist),
      csvCell(t.album),
      csvCell(t.folderName),
      csvCell(t.relativePath),
      csvCell(t.format),
      String(t.fileSize || 0),
      csvCell(t.youtubeVideoId ?? ''),
      csvCell((affectedPlaylistsByTrack.get(t.id) ?? []).join('; ')),
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const dateStamp = new Date().toISOString().slice(0, 10);
    triggerFileDownload(csv, `cratesync-missing-files-${dateStamp}.csv`, 'text/csv;charset=utf-8');
  };

  return (
    <section
      aria-label="Library Cleanup Utility"
      className="mx-5 sm:mx-6 my-4 rounded-lg border border-white/[0.1] bg-[#11141B] overflow-hidden shrink-0"
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {summary.count > 0 ? (
            <AlertTriangle className="h-4 w-4 text-[#EF4444] shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-[#22C55E] shrink-0" />
          )}
          <div className="min-w-0">
            <h2 className="font-display text-sm font-semibold text-white truncate">
              Library Cleanup
            </h2>
            <p className="text-[11px] text-[#717786] font-mono tabular-nums truncate">
              {summary.count > 0
                ? `${summary.count} track${summary.count === 1 ? '' : 's'} missing on device · ${summary.affectedPlaylistCount} playlist${summary.affectedPlaylistCount === 1 ? '' : 's'} affected · ${formatFileSize(summary.totalSize)} stale catalog entries`
                : `All ${tracks.length} indexed track${tracks.length === 1 ? '' : 's'} are currently verified on device`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {hasLiveFolderHandle && (
            <button
              type="button"
              onClick={onRescanFolder}
              disabled={isScanning}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#D1D5DB] bg-[#181B24] border border-white/[0.09] hover:text-white hover:bg-[#222634] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'Re-verifying...' : 'Re-verify Folder'}</span>
            </button>
          )}

          {summary.count > 0 && (
            <>
              <button
                type="button"
                onClick={handleExportMissingCsv}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#D1D5DB] bg-[#181B24] border border-white/[0.09] hover:text-white hover:bg-[#222634] transition-colors whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Export List</span>
              </button>

              <button
                type="button"
                onClick={() => onRemoveMissingTracks(missingIds)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-medium text-white bg-[#DC2626] hover:bg-[#B91C1C] transition-colors whitespace-nowrap"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Remove All Missing ({summary.count})</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close library cleanup utility"
            className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      {summary.count === 0 ? (
        <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="text-[#9CA3AF]">
            No tracks with missing local files (<span className="font-mono text-[#D1D5DB]">isMissingOnDevice</span>) were found in your database. When files are moved or deleted from a watched folder, they will appear here for single-click cleanup.
          </div>
        </div>
      ) : (
        <>
          {/* Summary Metrics Strip */}
          <div className="px-5 py-3 border-b border-white/[0.07] bg-[#0D1016] grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <div className="text-[11px] text-[#717786]">Missing Files</div>
              <div className="mt-0.5 font-mono text-base font-medium tabular-nums text-[#EF4444]">
                {summary.count}
              </div>
            </div>
            <div className="sm:border-l sm:border-white/[0.07] sm:pl-4">
              <div className="text-[11px] text-[#717786]">Playlists Affected</div>
              <div className="mt-0.5 font-mono text-base font-medium tabular-nums text-white">
                {summary.affectedPlaylistCount}
              </div>
            </div>
            <div className="sm:border-l sm:border-white/[0.07] sm:pl-4">
              <div className="text-[11px] text-[#717786]">YouTube IDs Linked</div>
              <div className="mt-0.5 font-mono text-base font-medium tabular-nums text-[#F59E0B]">
                {summary.matchedCount}
              </div>
            </div>
            <div className="sm:border-l sm:border-white/[0.07] sm:pl-4">
              <div className="text-[11px] text-[#717786]">Previous Size</div>
              <div className="mt-0.5 font-mono text-base font-medium tabular-nums text-[#D1D5DB]">
                {formatFileSize(summary.totalSize)}
              </div>
            </div>
          </div>

          {/* Scrollable Missing Tracks Table */}
          <div className="max-h-64 overflow-y-auto divide-y divide-white/[0.05] text-xs">
            {missingTracks.map((track) => {
              const plNames = affectedPlaylistsByTrack.get(track.id) ?? [];
              return (
                <div
                  key={track.id}
                  className="px-5 py-2.5 flex items-center justify-between gap-4 hover:bg-white/[0.03] transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-[#E5E7EB] line-through truncate">
                        {track.title}
                      </span>
                      <span className="text-[#4B5563]" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-[#8B92A2] truncate">{track.artist}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] font-mono text-[#6B7280] truncate">
                      {track.relativePath || track.fileName}
                      {plNames.length > 0 ? ` · In ${plNames.join(', ')}` : ''}
                      {track.lastSeenAt ? ` · Last seen ${formatRelativeTime(track.lastSeenAt)}` : ''}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <span className="hidden sm:inline font-mono tabular-nums text-[11px] text-[#717786]">
                      {track.format} · {formatDuration(track.duration)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveMissingTracks([track.id])}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#FCA5A5] hover:text-[#EF4444] transition-colors whitespace-nowrap"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
