import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FolderOpen,
  Pause,
  Radio,
  RefreshCw,
  ScrollText,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import type {
  DirectoryWatcherStatus,
  ScanErrorCode,
  ScanLogEntry,
  ScanTriggerSource,
  WatchedFolderInfo,
} from '../types/music';
import { parseWatchInterval, type WatchIntervalSec } from '../utils/folderWatch';
import { buildScanLogExport } from '../utils/scanLogExport';
import { formatRelativeTime, triggerFileDownload } from '../utils/youtubeLinks';

type LogFilter = 'all' | 'errors' | 'background' | 'manual';

interface ScanLogViewProps {
  scanLogs: ScanLogEntry[];
  watcherStatus: DirectoryWatcherStatus;
  watchedFolder: WatchedFolderInfo | null;
  autoWatchIntervalSec: WatchIntervalSec;
  isScanning: boolean;
  scanProgress: { processed: number; total: number } | null;
  onChangeAutoWatch: (sec: WatchIntervalSec) => void;
  onRescanFolder: () => void;
  onMountFolder: () => void;
  onRequestClearLogs: () => void;
}

const SOURCE_LABELS: Record<ScanTriggerSource, string> = {
  'background-watch': 'Background Watcher',
  'manual-folder': 'Manual Folder Scan',
  'file-picker': 'File Selection',
  'drag-drop': 'Drag & Drop',
  'drive-mapping': 'Drive Folder Mapping',
};

const ERROR_CODE_LABELS: Record<ScanErrorCode, string> = {
  permission: 'Permission Denied',
  'unreadable-file': 'Unreadable File',
  'inaccessible-folder': 'Inaccessible Folder',
  'metadata-parse': 'Metadata Parse',
  unknown: 'Scan Error',
};

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const rem = Math.round(secs % 60);
  return `${mins}m ${rem}s`;
}

function formatWatchInterval(sec: WatchIntervalSec): string {
  if (sec === 0) return 'Manual only';
  if (sec === 30) return 'Every 30s';
  if (sec === 120) return 'Every 2m';
  return 'Every 5m';
}

export function ScanLogView({
  scanLogs,
  watcherStatus,
  watchedFolder,
  autoWatchIntervalSec,
  isScanning,
  scanProgress,
  onChangeAutoWatch,
  onRescanFolder,
  onMountFolder,
  onRequestClearLogs,
}: ScanLogViewProps) {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const summary = useMemo(() => {
    let totalProcessed = 0;
    let totalAdded = 0;
    let totalErrors = 0;
    let scansWithErrors = 0;
    let backgroundScans = 0;
    let manualScans = 0;

    for (const log of scanLogs) {
      totalProcessed += log.audioFilesProcessed;
      totalAdded += log.addedCount;
      totalErrors += log.errors.length;
      if (log.errors.length > 0 || log.status === 'failed') {
        scansWithErrors += 1;
      }
      if (log.source === 'background-watch') {
        backgroundScans += 1;
      } else {
        manualScans += 1;
      }
    }

    return {
      totalScans: scanLogs.length,
      totalProcessed,
      totalAdded,
      totalErrors,
      scansWithErrors,
      backgroundScans,
      manualScans,
    };
  }, [scanLogs]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scanLogs.filter((log) => {
      if (filter === 'errors' && log.errors.length === 0 && log.status !== 'failed') {
        return false;
      }
      if (filter === 'background' && log.source !== 'background-watch') {
        return false;
      }
      if (filter === 'manual' && log.source === 'background-watch') {
        return false;
      }
      if (!q) return true;
      const inFolder = log.folderName.toLowerCase().includes(q);
      const inSource = SOURCE_LABELS[log.source].toLowerCase().includes(q);
      const inErrors = log.errors.some(
        (err) =>
          err.path.toLowerCase().includes(q) ||
          err.message.toLowerCase().includes(q) ||
          ERROR_CODE_LABELS[err.code].toLowerCase().includes(q)
      );
      return inFolder || inSource || inErrors;
    });
  }, [scanLogs, filter, search]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleExportLogs = () => {
    if (scanLogs.length === 0) return;
    triggerFileDownload(
      buildScanLogExport({
        scanLogs,
        watcherStatus,
        watchedFolderName: watchedFolder?.name ?? null,
        autoWatchIntervalSec,
        now: new Date(),
      })
    );
  };

  const watcherLabel =
    watcherStatus === 'syncing'
      ? 'Syncing'
      : watcherStatus === 'watching'
        ? 'Watching'
        : watcherStatus === 'paused'
          ? 'Paused'
          : 'Idle';

  return (
    <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-white/[0.08]">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
              Scan History &amp; Watcher Logs
            </h1>
            <p className="mt-1 text-sm text-[#8B92A2]">
              Chronological audit log of local directory scans, audio files processed, and any file
              system or metadata errors encountered.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {watchedFolder?.hasLiveHandle && (
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-xs text-[#9CA3AF] bg-[#13151B] border border-white/[0.08]">
                <span className="whitespace-nowrap">Auto-watch</span>
                <select
                  aria-label="Background watcher interval"
                  value={autoWatchIntervalSec}
                  onChange={(e) => onChangeAutoWatch(parseWatchInterval(e.target.value))}
                  className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
                >
                  <option value={0} className="bg-[#13151B] text-white">
                    Manual only
                  </option>
                  <option value={30} className="bg-[#13151B] text-white">
                    Every 30s
                  </option>
                  <option value={120} className="bg-[#13151B] text-white">
                    Every 2m
                  </option>
                  <option value={300} className="bg-[#13151B] text-white">
                    Every 5m
                  </option>
                </select>
              </label>
            )}

            {watchedFolder?.hasLiveHandle ? (
              <button
                type="button"
                onClick={onRescanFolder}
                disabled={isScanning}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium text-[#E5E7EB] bg-[#161920] border border-white/[0.1] hover:bg-[#1F232D] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                <span>{isScanning ? 'Scanning...' : 'Scan Now'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onMountFolder}
                disabled={isScanning}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span>Scan Folder</span>
              </button>
            )}

            {scanLogs.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleExportLogs}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-[#D1D5DB] bg-[#13151B] border border-white/[0.08] hover:text-white hover:border-white/[0.16] transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5 text-[#8B92A2]" />
                  <span>Export JSON</span>
                </button>
                <button
                  type="button"
                  onClick={onRequestClearLogs}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-[#9CA3AF] hover:text-[#EF4444] hover:bg-white/[0.04] transition-colors whitespace-nowrap shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Clear</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Single-Elevation Summary Metrics Strip */}
        <section
          aria-label="Scan history summary"
          className="rounded-lg border border-white/[0.08] bg-[#12141A] grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-white/[0.06]"
        >
          <div className="px-5 py-4">
            <div className="text-xs text-[#8B92A2]">Watcher Status</div>
            <div className="mt-1.5 flex items-center gap-2 text-base font-semibold text-white">
              {watcherStatus === 'syncing' ? (
                <RefreshCw className="h-4 w-4 animate-spin text-[#FF4D64] shrink-0" />
              ) : watcherStatus === 'watching' ? (
                <Radio className="h-4 w-4 text-[#22C55E] shrink-0" />
              ) : watcherStatus === 'paused' ? (
                <Pause className="h-4 w-4 text-[#F59E0B] shrink-0" />
              ) : (
                <Clock className="h-4 w-4 text-[#6B7280] shrink-0" />
              )}
              <span>{watcherLabel}</span>
            </div>
            <div className="mt-1 text-xs text-[#6B7280] truncate font-mono tabular-nums">
              {watcherStatus === 'paused'
                ? 'Press Scan Now to allow folder access'
                : watchedFolder?.hasLiveHandle
                ? `${watchedFolder.name} · ${formatWatchInterval(autoWatchIntervalSec)}`
                : watchedFolder
                  ? `${watchedFolder.name} · Manual`
                  : 'No folder mounted'}
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="text-xs text-[#8B92A2]">Total Scans</div>
            <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-white">
              {summary.totalScans.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-[#6B7280] font-mono tabular-nums">
              {summary.backgroundScans} auto · {summary.manualScans} manual
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="text-xs text-[#8B92A2]">Audio Files Processed</div>
            <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-white">
              {summary.totalProcessed.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-[#6B7280] font-mono tabular-nums">
              +{summary.totalAdded.toLocaleString()} added to catalog
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="text-xs text-[#8B92A2]">Errors Encountered</div>
            <div
              className={`mt-1.5 font-mono text-xl font-semibold tabular-nums ${
                summary.totalErrors > 0 ? 'text-[#EF4444]' : 'text-white'
              }`}
            >
              {summary.totalErrors.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-[#6B7280] font-mono tabular-nums">
              {summary.scansWithErrors === 0
                ? 'All scans clean'
                : `Across ${summary.scansWithErrors} scan${summary.scansWithErrors === 1 ? '' : 's'}`}
            </div>
          </div>
        </section>

        {/* Active Scan Row Banner */}
        {isScanning && (
          <div className="rounded-lg border border-[#FF1F3D]/30 bg-[#181318] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <RefreshCw className="h-4 w-4 animate-spin text-[#FF4D64] shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-white">
                  File system scan in progress
                </div>
                <div className="text-xs text-[#9CA3AF] truncate">
                  {watchedFolder ? `Indexing ${watchedFolder.name}` : 'Reading selected audio files'}
                </div>
              </div>
            </div>
            {scanProgress && (
              <div className="flex items-center gap-3 shrink-0">
                <div className="w-32 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-[#FF1F3D] transition-all duration-150"
                    style={{
                      width: `${Math.round((scanProgress.processed / Math.max(1, scanProgress.total)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="font-mono text-xs tabular-nums text-[#E5E7EB]">
                  {scanProgress.processed} / {scanProgress.total}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Filter & Search Controls */}
        {scanLogs.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="Filter scan logs"
              className="inline-flex items-center gap-1 p-1 rounded-md bg-[#12141A] border border-white/[0.07] self-start"
            >
              {(
                [
                  { id: 'all', label: `All (${scanLogs.length})` },
                  { id: 'errors', label: `With Errors (${summary.scansWithErrors})` },
                  { id: 'background', label: `Background (${summary.backgroundScans})` },
                  { id: 'manual', label: `Manual (${summary.manualScans})` },
                ] as Array<{ id: LogFilter; label: string }>
              ).map((tab) => {
                const active = filter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setFilter(tab.id)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-white/[0.1] text-white'
                        : 'text-[#8B92A2] hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="h-3.5 w-3.5 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by folder or error path..."
                className="w-full pl-9 pr-3 py-2 rounded-md text-xs text-white placeholder-[#6B7280] bg-[#12141A] border border-white/[0.08] focus:outline-none focus:border-white/[0.22]"
              />
            </div>
          </div>
        )}

        {/* Log Entries Table / Empty State */}
        {scanLogs.length === 0 ? (
          <div className="rounded-lg border border-white/[0.08] bg-[#12141A] px-6 py-12 text-center">
            <ScrollText className="h-7 w-7 text-[#6B7280] mx-auto" />
            <h2 className="mt-3 text-base font-semibold text-white">No file system scans recorded yet</h2>
            <p className="mt-1.5 text-sm text-[#8B92A2] max-w-md mx-auto">
              Every folder scan, file import, drag-and-drop batch, and background directory check is
              logged here with timestamps, processed counts, and error diagnostics.
            </p>
            <button
              type="button"
              onClick={onMountFolder}
              disabled={isScanning}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-50 transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>Scan Music Folder</span>
            </button>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="rounded-lg border border-white/[0.08] bg-[#12141A] px-6 py-10 text-center">
            <p className="text-sm text-[#A1A7B5]">No scan entries match your current filter.</p>
            <button
              type="button"
              onClick={() => {
                setFilter('all');
                setSearch('');
              }}
              className="mt-3 px-3.5 py-1.5 rounded-md text-xs font-medium text-white bg-white/[0.08] hover:bg-white/[0.14] transition-colors"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-white/[0.08] bg-[#12141A] overflow-hidden">
            {/* Table Column Header */}
            <div className="hidden md:grid md:grid-cols-[minmax(180px,1.2fr)_minmax(180px,1.3fr)_minmax(190px,1.2fr)_minmax(150px,1fr)] gap-4 px-5 py-3 border-b border-white/[0.07] text-xs font-medium text-[#717786] bg-[#0F1116]">
              <div>Timestamp</div>
              <div>Source &amp; Folder</div>
              <div className="text-right">Files Processed</div>
              <div className="text-right">Outcome</div>
            </div>

            <div className="divide-y divide-white/[0.06]">
              {filteredLogs.map((log) => {
                const hasErrors = log.errors.length > 0;
                const isExpanded = expandedIds.has(log.id);
                const statusLabel =
                  log.status === 'failed'
                    ? 'Failed'
                    : log.status === 'completed-with-errors'
                      ? `${log.errors.length} error${log.errors.length === 1 ? '' : 's'}`
                      : 'Completed';

                return (
                  <div key={log.id} className="transition-colors hover:bg-white/[0.02]">
                    <div className="px-5 py-3.5 grid grid-cols-1 md:grid-cols-[minmax(180px,1.2fr)_minmax(180px,1.3fr)_minmax(190px,1.2fr)_minmax(150px,1fr)] gap-3 md:gap-4 items-center">
                      {/* Timestamp & Duration */}
                      <div className="min-w-0">
                        <div className="font-mono text-xs tabular-nums text-white">
                          {formatTimestamp(log.completedAt)}
                        </div>
                        <div className="mt-0.5 text-xs text-[#717786] font-mono tabular-nums">
                          <span>{formatRelativeTime(log.completedAt)}</span>
                          <span className="mx-1.5 text-[#4B5563]" aria-hidden="true">
                            ·
                          </span>
                          <span>{formatDurationMs(log.durationMs)}</span>
                        </div>
                      </div>

                      {/* Folder & Trigger Source */}
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white truncate">
                          {log.folderName}
                        </div>
                        <div className="mt-0.5 text-xs text-[#8B92A2] truncate">
                          {SOURCE_LABELS[log.source]}
                        </div>
                      </div>

                      {/* Files Processed Breakdown */}
                      <div className="md:text-right font-mono text-xs tabular-nums">
                        <div className="text-white">
                          {log.audioFilesProcessed.toLocaleString()} audio file
                          {log.audioFilesProcessed === 1 ? '' : 's'}
                        </div>
                        <div className="mt-0.5 text-[#717786] flex flex-wrap md:justify-end gap-x-2">
                          {log.addedCount > 0 && (
                            <span className="text-[#22C55E]">+{log.addedCount} new</span>
                          )}
                          {log.restoredCount > 0 && (
                            <span className="text-[#38BDF8]">+{log.restoredCount} restored</span>
                          )}
                          {log.missingCount > 0 && (
                            <span className="text-[#F59E0B]">{log.missingCount} missing</span>
                          )}
                          {log.addedCount === 0 &&
                            log.restoredCount === 0 &&
                            log.missingCount === 0 && (
                              <span>
                                {log.updatedCount > 0
                                  ? `${log.updatedCount} verified`
                                  : 'No changes'}
                              </span>
                            )}
                          {log.skippedNonAudioCount > 0 && (
                            <span>
                              · {log.skippedNonAudioCount.toLocaleString()} non-audio
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Status & Expand Errors Action */}
                      <div className="flex items-center md:justify-end gap-2">
                        {log.status === 'failed' ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#EF4444]">
                            <XCircle className="h-3.5 w-3.5 shrink-0" />
                            <span>{statusLabel}</span>
                          </span>
                        ) : log.status === 'completed-with-errors' ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#F59E0B]">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            <span>{statusLabel}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#22C55E]">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            <span>{statusLabel}</span>
                          </span>
                        )}

                        {hasErrors && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(log.id)}
                            aria-expanded={isExpanded}
                            aria-label={
                              isExpanded
                                ? 'Hide scan error details'
                                : `Inspect ${log.errors.length} scan error${log.errors.length === 1 ? '' : 's'}`
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-[#D1D5DB] hover:text-white hover:bg-white/[0.08] transition-colors whitespace-nowrap shrink-0"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                            <span>Details</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded Error Diagnostics List */}
                    {hasErrors && isExpanded && (
                      <div className="px-5 pb-4 pt-1 bg-[#0E1015] border-t border-white/[0.05]">
                        <div className="text-xs font-medium text-[#9CA3AF] py-2">
                          Errors encountered ({log.errors.length})
                        </div>
                        <div className="divide-y divide-white/[0.05] rounded-md border border-white/[0.06] bg-[#12141A]">
                          {log.errors.map((err, index) => (
                            <div
                              key={`${log.id}-err-${index}`}
                              className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2 text-xs"
                            >
                              <div className="min-w-0 space-y-0.5">
                                <div className="font-mono text-[#E5E7EB] break-all">
                                  {err.path}
                                </div>
                                <div className="text-[#9CA3AF]">{err.message}</div>
                              </div>
                              <span className="text-[#F59E0B] font-mono shrink-0 whitespace-nowrap">
                                {ERROR_CODE_LABELS[err.code]}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
