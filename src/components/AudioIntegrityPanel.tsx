import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Link2,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Tags,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type { LocalTrack } from '../types/music';
import {
  parseDurationInput,
  summarizeIntegrityIssues,
  type TrackIntegrityReport,
  type TrackIntegrityScanResult,
} from '../utils/audioIntegrity';
import {
  formatDuration,
  formatFileSize,
  triggerFileDownload,
} from '../utils/youtubeLinks';

type IntegrityFilterTab = 'all' | 'headers' | 'duration' | 'fixable';

export interface TrackIntegrityRepairPatch {
  duration?: number;
  format?: string;
}

interface AudioIntegrityPanelProps {
  tracks: LocalTrack[];
  deepResults: Record<string, TrackIntegrityScanResult>;
  isScanning: boolean;
  scanProgress: { processed: number; total: number } | null;
  activePlayingTrackId: string | null;
  isAudioPlaying: boolean;
  hasPlayableFile: (fileKey: string) => boolean;
  onRunDeepScan: () => void;
  onRepairTracks: (patches: Record<string, TrackIntegrityRepairPatch>) => void;
  onPlayTrack: (trackId: string, queueIds: string[]) => void;
  onInspectTrack: (trackId: string) => void;
  onOpenBatchTagEditor: (trackIds: string[], contextLabel: string) => void;
  onRequestDeleteTracks: (trackIds: string[]) => void;
  onClose: () => void;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function AudioIntegrityPanel({
  tracks,
  deepResults,
  isScanning,
  scanProgress,
  activePlayingTrackId,
  isAudioPlaying,
  hasPlayableFile,
  onRunDeepScan,
  onRepairTracks,
  onPlayTrack,
  onInspectTrack,
  onOpenBatchTagEditor,
  onRequestDeleteTracks,
  onClose,
}: AudioIntegrityPanelProps) {
  const [activeTab, setActiveTab] = useState<IntegrityFilterTab>('all');
  const [editingDurationTrackId, setEditingDurationTrackId] = useState<string | null>(null);
  const [durationDraft, setDurationDraft] = useState<string>('');
  const [durationError, setDurationError] = useState<string | null>(null);

  const summary = useMemo(
    () => summarizeIntegrityIssues(tracks, deepResults),
    [tracks, deepResults]
  );

  const visibleReports = useMemo<TrackIntegrityReport[]>(() => {
    switch (activeTab) {
      case 'headers':
        return summary.reports.filter((r) => r.hasHeaderIssue);
      case 'duration':
        return summary.reports.filter((r) => r.hasDurationIssue);
      case 'fixable':
        return summary.reports.filter((r) => r.canAutoFix);
      default:
        return summary.reports;
    }
  }, [summary.reports, activeTab]);

  const queueIds = useMemo(() => visibleReports.map((r) => r.track.id), [visibleReports]);

  const handleApplyAllAutoFixes = () => {
    const patches: Record<string, TrackIntegrityRepairPatch> = {};
    for (const report of summary.reports) {
      if (!report.canAutoFix) continue;
      const patch: TrackIntegrityRepairPatch = {};
      if (report.suggestedDuration) patch.duration = report.suggestedDuration;
      if (report.suggestedFormat) patch.format = report.suggestedFormat;
      if (patch.duration !== undefined || patch.format !== undefined) {
        patches[report.track.id] = patch;
      }
    }
    if (Object.keys(patches).length > 0) {
      onRepairTracks(patches);
    }
  };

  const handleApplySingleAutoFix = (report: TrackIntegrityReport) => {
    const patch: TrackIntegrityRepairPatch = {};
    if (report.suggestedDuration) patch.duration = report.suggestedDuration;
    if (report.suggestedFormat) patch.format = report.suggestedFormat;
    if (patch.duration !== undefined || patch.format !== undefined) {
      onRepairTracks({ [report.track.id]: patch });
    }
  };

  const openDurationEditor = (report: TrackIntegrityReport) => {
    setEditingDurationTrackId(report.track.id);
    const seed = report.suggestedDuration ?? (report.track.duration > 0 ? report.track.duration : 0);
    setDurationDraft(seed > 0 ? formatDuration(seed) : '');
    setDurationError(null);
  };

  const handleSaveManualDuration = (trackId: string) => {
    const parsed = parseDurationInput(durationDraft);
    if (!parsed) {
      setDurationError('Use mm:ss or seconds (e.g. 3:45)');
      return;
    }
    onRepairTracks({ [trackId]: { duration: parsed } });
    setEditingDurationTrackId(null);
    setDurationDraft('');
    setDurationError(null);
  };

  const handleExportReportCsv = () => {
    if (summary.reports.length === 0) return;
    const header = [
      'Title',
      'Artist',
      'Album',
      'Format',
      'Detected Container',
      'Size Bytes',
      'Catalog Duration (s)',
      'Probed Duration (s)',
      'Relative Path',
      'Issues',
    ];
    const rows = summary.reports.map((r) => [
      csvCell(r.track.title),
      csvCell(r.track.artist),
      csvCell(r.track.album),
      csvCell(r.track.format),
      csvCell(r.detectedContainer ?? ''),
      String(r.track.fileSize || 0),
      String(Math.round(r.track.duration || 0)),
      r.suggestedDuration ? String(r.suggestedDuration) : '',
      csvCell(r.track.relativePath),
      csvCell(r.issues.map((i) => `${i.label}: ${i.detail}`).join(' | ')),
    ]);
    const csv = [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const stamp = new Date().toISOString().slice(0, 10);
    triggerFileDownload({
      content: csv,
      fileName: `cratesync-audio-integrity-${stamp}.csv`,
      mimeType: 'text/csv;charset=utf-8',
    });
  };

  const progressPct =
    scanProgress && scanProgress.total > 0
      ? Math.round((scanProgress.processed / scanProgress.total) * 100)
      : 0;

  return (
    <section
      aria-label="Audio Integrity Diagnostics"
      className="mx-5 sm:mx-6 my-4 rounded-lg border border-white/[0.1] bg-[#11141B] overflow-hidden shrink-0"
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {summary.totalFlagged > 0 ? (
            <ShieldAlert
              className={`h-4 w-4 shrink-0 ${
                summary.headerIssueCount > 0 ? 'text-[#EF4444]' : 'text-[#F59E0B]'
              }`}
            />
          ) : (
            <ShieldCheck className="h-4 w-4 text-[#22C55E] shrink-0" />
          )}
          <div className="min-w-0">
            <h2 className="font-display text-sm font-semibold text-white truncate">
              Audio Integrity
            </h2>
            <p className="text-[11px] text-[#717786] font-mono tabular-nums truncate">
              {isScanning && scanProgress
                ? `Verifying binary headers & probing durations · ${scanProgress.processed} / ${scanProgress.total} (${progressPct}%)`
                : summary.totalFlagged > 0
                  ? `${summary.totalFlagged} flagged · ${summary.headerIssueCount} header issue${summary.headerIssueCount === 1 ? '' : 's'} · ${summary.durationIssueCount} incomplete duration${summary.durationIssueCount === 1 ? '' : 's'}`
                  : `All ${tracks.length} indexed track${tracks.length === 1 ? '' : 's'} passed header & duration checks`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onRunDeepScan}
            disabled={isScanning || tracks.length === 0}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#D1D5DB] bg-[#181B24] border border-white/[0.09] hover:text-white hover:bg-[#222634] disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            <span>
              {isScanning
                ? 'Scanning Headers...'
                : summary.deepScannedCount > 0
                  ? 'Re-scan Headers'
                  : 'Deep Header Scan'}
            </span>
          </button>

          {summary.autoFixableCount > 0 && (
            <button
              type="button"
              onClick={handleApplyAllAutoFixes}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-[#16A34A] hover:bg-[#15803D] transition-colors whitespace-nowrap"
            >
              <Wrench className="h-3.5 w-3.5" />
              <span>Auto-Fix ({summary.autoFixableCount})</span>
            </button>
          )}

          {summary.totalFlagged > 0 && (
            <button
              type="button"
              onClick={handleExportReportCsv}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#D1D5DB] bg-[#181B24] border border-white/[0.09] hover:text-white hover:bg-[#222634] transition-colors whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close audio integrity panel"
            className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Live Scan Progress Bar */}
      {isScanning && scanProgress && (
        <div className="h-1 w-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full bg-[#FF1F3D] transition-all duration-150"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* 4-Column Summary Strip */}
      <div className="px-5 py-3 border-b border-white/[0.07] bg-[#0D1016] grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
        <div>
          <div className="text-[11px] text-[#717786]">Corrupt / Mismatched Headers</div>
          <div
            className={`mt-0.5 font-mono text-base font-medium tabular-nums ${
              summary.headerIssueCount > 0 ? 'text-[#EF4444]' : 'text-[#22C55E]'
            }`}
          >
            {summary.headerIssueCount}
          </div>
        </div>
        <div className="sm:border-l sm:border-white/[0.07] sm:pl-4">
          <div className="text-[11px] text-[#717786]">Incomplete Duration</div>
          <div
            className={`mt-0.5 font-mono text-base font-medium tabular-nums ${
              summary.durationIssueCount > 0 ? 'text-[#F59E0B]' : 'text-[#22C55E]'
            }`}
          >
            {summary.durationIssueCount}
          </div>
        </div>
        <div className="sm:border-l sm:border-white/[0.07] sm:pl-4">
          <div className="text-[11px] text-[#717786]">Auto-Fixable</div>
          <div
            className={`mt-0.5 font-mono text-base font-medium tabular-nums ${
              summary.autoFixableCount > 0 ? 'text-[#22C55E]' : 'text-[#D1D5DB]'
            }`}
          >
            {summary.autoFixableCount}
          </div>
        </div>
        <div className="sm:border-l sm:border-white/[0.07] sm:pl-4">
          <div className="text-[11px] text-[#717786]">Binary Headers Verified</div>
          <div className="mt-0.5 font-mono text-base font-medium tabular-nums text-white">
            {summary.deepScannedCount}
            <span className="text-xs text-[#6B7280] font-normal ml-1">/ {tracks.length}</span>
          </div>
        </div>
      </div>

      {/* Body */}
      {summary.totalFlagged === 0 ? (
        <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2 text-[#9CA3AF]">
            <CheckCircle2 className="h-4 w-4 text-[#22C55E] shrink-0 mt-0.5" />
            <span>
              {summary.deepScannedCount > 0
                ? `All ${summary.deepScannedCount} verified local audio files have valid container headers (ID3, FLAC, MP4/M4A, WAV, OGG) and complete duration metadata.`
                : 'No missing durations or truncated file anomalies detected in catalog metadata. Run Deep Header Scan to inspect raw binary headers and probe playback duration on cached files.'}
            </span>
          </div>
        </div>
      ) : (
        <>
          {/* Filter Tabs & Batch Actions */}
          <div className="px-5 py-2.5 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3 bg-[#12151D]">
            <div
              role="tablist"
              aria-label="Filter integrity issues"
              className="flex items-center gap-1 p-0.5 rounded-md bg-[#0B0D12] border border-white/[0.07]"
            >
              {(
                [
                  { id: 'all', label: 'All Issues', count: summary.totalFlagged },
                  { id: 'headers', label: 'Headers', count: summary.headerIssueCount },
                  { id: 'duration', label: 'Duration', count: summary.durationIssueCount },
                  { id: 'fixable', label: 'Auto-Fixable', count: summary.autoFixableCount },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-white/[0.12] text-white'
                      : 'text-[#8B92A2] hover:text-white'
                  }`}
                >
                  {tab.label}{' '}
                  <span className="font-mono tabular-nums text-[11px] opacity-75">
                    ({tab.count})
                  </span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() =>
                  onOpenBatchTagEditor(
                    visibleReports.map((r) => r.track.id),
                    `Audio Integrity (${visibleReports.length} flagged)`
                  )
                }
                disabled={visibleReports.length === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#D1D5DB] bg-[#181B24] border border-white/[0.09] hover:text-white hover:bg-[#222634] disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                <Tags className="h-3.5 w-3.5" />
                <span>Batch Edit Tags ({visibleReports.length})</span>
              </button>

              {summary.corruptUnrecoverableIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => onRequestDeleteTracks(summary.corruptUnrecoverableIds)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#FCA5A5] bg-[#181B24] border border-[#EF4444]/35 hover:text-white hover:bg-[#DC2626]/25 transition-colors whitespace-nowrap"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Remove Corrupt ({summary.corruptUnrecoverableIds.length})</span>
                </button>
              )}
            </div>
          </div>

          {/* Issue Rows */}
          {visibleReports.length === 0 ? (
            <div className="px-5 py-6 text-center text-xs text-[#717786]">
              No tracks match this integrity filter.
            </div>
          ) : (
            <div className="max-h-[340px] overflow-y-auto divide-y divide-white/[0.06]">
              {visibleReports.map((report) => {
                const { track } = report;
                const isPlayingRow = activePlayingTrackId === track.id && isAudioPlaying;
                const canPlay = hasPlayableFile(track.fileKey);
                const isEditingDur = editingDurationTrackId === track.id;

                return (
                  <div
                    key={track.id}
                    className="px-5 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-white/[0.025] transition-colors"
                  >
                    {/* Left: Playback + Track Metadata + Diagnostics */}
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <button
                        type="button"
                        disabled={!canPlay}
                        onClick={() => onPlayTrack(track.id, queueIds)}
                        aria-label={isPlayingRow ? `Pause ${track.title}` : `Preview ${track.title}`}
                        title={
                          canPlay
                            ? 'Test audio playback'
                            : 'Local audio blob not cached — re-scan folder to test playback'
                        }
                        className="mt-0.5 h-7 w-7 rounded flex items-center justify-center bg-[#181B24] border border-white/[0.08] text-[#D1D5DB] hover:text-white hover:border-white/[0.2] disabled:opacity-35 disabled:cursor-not-allowed transition-colors shrink-0"
                      >
                        {isPlayingRow ? (
                          <Pause className="h-3.5 w-3.5 text-[#FF4D64] fill-current" />
                        ) : (
                          <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-xs font-medium text-white truncate max-w-[260px]">
                            {track.title}
                          </span>
                          <span className="text-[11px] text-[#8B92A2] truncate max-w-[200px]">
                            {track.artist}
                          </span>
                          <span className="text-[11px] text-[#4B5563]" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-[#717786]">
                            {track.format} · {formatFileSize(track.fileSize)} ·{' '}
                            {track.duration > 0 ? formatDuration(track.duration) : '0:00'}
                          </span>
                        </div>

                        <div className="mt-0.5 font-mono text-[11px] text-[#6B7280] truncate">
                          {track.relativePath}
                        </div>

                        {/* Diagnostic Issues (unboxed semantic text) */}
                        <div className="mt-1.5 space-y-1">
                          {report.issues.map((issue) => (
                            <div
                              key={issue.code}
                              className="flex items-start gap-1.5 text-[11px] leading-snug"
                            >
                              <AlertTriangle
                                className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${
                                  issue.severity === 'error'
                                    ? 'text-[#EF4444]'
                                    : 'text-[#F59E0B]'
                                }`}
                              />
                              <span
                                className={
                                  issue.severity === 'error'
                                    ? 'text-[#FCA5A5]'
                                    : 'text-[#FCD34D]'
                                }
                              >
                                <strong className="font-medium">{issue.label}:</strong>{' '}
                                <span className="text-[#9CA3AF]">{issue.detail}</span>
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Inline Manual Duration Fix Input */}
                        {isEditingDur && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={durationDraft}
                              onChange={(e) => {
                                setDurationDraft(e.target.value);
                                setDurationError(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveManualDuration(track.id);
                                if (e.key === 'Escape') setEditingDurationTrackId(null);
                              }}
                              placeholder="mm:ss (e.g. 3:45)"
                              aria-label="Enter track duration in mm:ss"
                              className="w-36 px-2.5 py-1 rounded bg-[#0B0D12] border border-white/[0.15] text-xs font-mono tabular-nums text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveManualDuration(track.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
                            >
                              <Check className="h-3 w-3" />
                              <span>Save</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingDurationTrackId(null)}
                              className="px-2 py-1 rounded text-xs text-[#8B92A2] hover:text-white transition-colors"
                            >
                              Cancel
                            </button>
                            {durationError && (
                              <span className="text-[11px] text-[#FCA5A5]">{durationError}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: One-Click Repair & Fix Actions */}
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0 pl-10 lg:pl-0">
                      {report.canAutoFix && (
                        <button
                          type="button"
                          onClick={() => handleApplySingleAutoFix(report)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-white bg-[#16A34A] hover:bg-[#15803D] transition-colors whitespace-nowrap"
                        >
                          <Wrench className="h-3 w-3" />
                          <span>
                            Fix
                            {report.suggestedDuration
                              ? ` (${formatDuration(report.suggestedDuration)})`
                              : report.suggestedFormat
                                ? ` (${report.suggestedFormat})`
                                : ''}
                          </span>
                        </button>
                      )}

                      {report.hasDurationIssue && !isEditingDur && (
                        <button
                          type="button"
                          onClick={() => openDurationEditor(report)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-[#D1D5DB] bg-[#181B24] border border-white/[0.09] hover:text-white hover:bg-[#222634] transition-colors whitespace-nowrap"
                        >
                          <Clock className="h-3 w-3" />
                          <span>Set Duration</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          onOpenBatchTagEditor([track.id], `Fix tags: ${track.title}`)
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-[#D1D5DB] bg-[#181B24] border border-white/[0.09] hover:text-white hover:bg-[#222634] transition-colors whitespace-nowrap"
                      >
                        <Tags className="h-3 w-3" />
                        <span>Edit Tags</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onInspectTrack(track.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-[#D1D5DB] bg-[#181B24] border border-white/[0.09] hover:text-white hover:bg-[#222634] transition-colors whitespace-nowrap"
                      >
                        <Link2 className="h-3 w-3" />
                        <span>Inspect</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onRequestDeleteTracks([track.id])}
                        aria-label={`Remove ${track.title} from catalog`}
                        title="Remove file from catalog"
                        className="p-1.5 rounded text-[#8B92A2] hover:text-[#FCA5A5] hover:bg-[#DC2626]/20 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
