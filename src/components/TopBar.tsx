import { Clock, FileAudio, FolderPlus, Menu, Radio, RefreshCw, Search } from 'lucide-react';
import type { DirectoryWatcherStatus } from '../types/music';

interface TopBarProps {
  sectionLabel: string;
  subLabel?: string;
  isScanning: boolean;
  watcherStatus: DirectoryWatcherStatus;
  watchedFolderName?: string | null;
  autoWatchIntervalSec: 0 | 30 | 120 | 300;
  scanProgress?: { processed: number; total: number } | null;
  recentScanErrorCount?: number;
  pendingSyncCount: number;
  onOpenMobileMenu: () => void;
  onOpenSmartSearch: () => void;
  onOpenScanLogs: () => void;
  onPickFolder: () => void;
  onPickFiles: () => void;
  onOpenSyncQueue: () => void;
}

function formatWatchCadence(sec: 0 | 30 | 120 | 300): string {
  if (sec === 30) return '30s';
  if (sec === 120) return '2m';
  if (sec === 300) return '5m';
  return 'manual';
}

export function TopBar({
  sectionLabel,
  subLabel,
  isScanning,
  watcherStatus,
  watchedFolderName,
  autoWatchIntervalSec,
  scanProgress,
  recentScanErrorCount = 0,
  pendingSyncCount,
  onOpenMobileMenu,
  onOpenSmartSearch,
  onOpenScanLogs,
  onPickFolder,
  onPickFiles,
  onOpenSyncQueue,
}: TopBarProps) {
  const watcherLabel =
    watcherStatus === 'syncing'
      ? 'Syncing'
      : watcherStatus === 'watching'
        ? 'Watching'
        : 'Idle';

  const watcherTooltip =
    watcherStatus === 'syncing'
      ? scanProgress
        ? `Syncing files (${scanProgress.processed}/${scanProgress.total}) — click to view scan logs`
        : 'Background indexer is syncing files — click to view scan logs'
      : watcherStatus === 'watching'
        ? `Watching "${watchedFolderName ?? 'folder'}" every ${formatWatchCadence(autoWatchIntervalSec)} — click to view scan logs`
        : 'Background directory watcher is idle — click to view scan logs';

  return (
    <header className="h-14 px-4 sm:px-6 border-b border-white/[0.07] bg-[#0B0C0E] flex items-center justify-between gap-4 shrink-0">
      {/* Left: Mobile Menu + Contextual Breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 -ml-2 rounded-md text-[#9CA3AF] hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
        >
          <Menu className="h-5 w-5" />
        </button>

        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-[#717786] whitespace-nowrap shrink-0">Library</span>
          <span className="text-[#4B5563]" aria-hidden="true">
            /
          </span>
          <span
            className={`${
              subLabel ? 'text-[#9CA3AF]' : 'text-white font-medium'
            } whitespace-nowrap shrink-0`}
          >
            {sectionLabel}
          </span>
          {subLabel && (
            <>
              <span className="text-[#4B5563]" aria-hidden="true">
                /
              </span>
              <span className="text-white font-medium truncate">{subLabel}</span>
            </>
          )}
        </nav>
      </div>

      {/* Right: Watcher Status Indicator + Clean Single-Line Action Controls */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onOpenScanLogs}
          title={watcherTooltip}
          aria-label={`Directory watcher status: ${watcherLabel}. Open scan logs`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[#13151B] border border-white/[0.08] hover:border-white/[0.18] transition-colors whitespace-nowrap shrink-0"
        >
          {watcherStatus === 'syncing' ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#FF4D64] shrink-0" />
          ) : watcherStatus === 'watching' ? (
            <Radio className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />
          ) : (
            <Clock className="h-3.5 w-3.5 text-[#6B7280] shrink-0" />
          )}
          <span
            className={
              watcherStatus === 'syncing'
                ? 'text-white'
                : watcherStatus === 'watching'
                  ? 'text-[#E5E7EB]'
                  : 'text-[#8B92A2]'
            }
          >
            {watcherLabel}
          </span>
          {watcherStatus === 'syncing' && scanProgress && (
            <span className="hidden sm:inline font-mono tabular-nums text-[#9CA3AF]">
              {scanProgress.processed}/{scanProgress.total}
            </span>
          )}
          {watcherStatus !== 'syncing' && recentScanErrorCount > 0 && (
            <span className="hidden sm:inline font-mono tabular-nums text-[#EF4444]">
              · {recentScanErrorCount} err
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onOpenSmartSearch}
          title="Open Smart Search (⌘K / Ctrl+K)"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-[#9CA3AF] bg-[#13151B] border border-white/[0.08] hover:text-white hover:border-white/[0.18] transition-colors whitespace-nowrap shrink-0"
        >
          <Search className="h-3.5 w-3.5 text-[#717786]" />
          <span className="hidden md:inline">Smart Search</span>
          <kbd className="hidden sm:inline font-mono text-[10px] text-[#6B7280] pl-1">⌘K</kbd>
        </button>

        <button
          type="button"
          onClick={onPickFiles}
          disabled={isScanning}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-[#D1D5DB] hover:text-white hover:bg-white/[0.06] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <FileAudio className="h-3.5 w-3.5 text-[#8B92A2]" />
          <span>Add Files</span>
        </button>

        <button
          type="button"
          onClick={onPickFolder}
          disabled={isScanning}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium text-[#E5E7EB] bg-[#161920] border border-white/[0.09] hover:bg-[#1E222B] hover:border-white/[0.16] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <FolderPlus className="h-3.5 w-3.5 text-[#9CA3AF]" />
          <span>{isScanning ? 'Scanning...' : 'Scan Folder'}</span>
        </button>

        <button
          type="button"
          onClick={onOpenSyncQueue}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>
            {pendingSyncCount > 0 ? `Sync (${pendingSyncCount})` : 'Sync Queue'}
          </span>
        </button>
      </div>
    </header>
  );
}
