import { Clock, FileAudio, FolderPlus, Menu, Pause, Radio, RefreshCw, Search } from 'lucide-react';
import type { DirectoryWatcherStatus } from '../types/music';
import type { WatchIntervalSec } from '../utils/folderWatch';

interface TopBarProps {
  sectionLabel: string;
  subLabel?: string;
  isScanning: boolean;
  watcherStatus: DirectoryWatcherStatus;
  /**
   * The picked folders in words, such as `"Music"` or `2 folders`. While the watcher is
   * paused it names the folders that need access.
   */
  watchedFolderLabel: string;
  autoWatchIntervalSec: WatchIntervalSec;
  scanProgress?: { processed: number; total: number } | null;
  recentScanErrorCount?: number;
  pendingSyncCount: number;
  onOpenMobileMenu: () => void;
  onOpenSmartSearch: () => void;
  onOpenScanLogs: () => void;
  /**
   * Rescans from a click, which lets the browser ask for folder access again. It asks for
   * one folder at a time, in list order, while the click is still fresh.
   */
  onResumeWatch: () => void;
  onPickFolder: () => void;
  onPickFiles: () => void;
  onOpenSyncQueue: () => void;
}

function formatWatchCadence(sec: WatchIntervalSec): string {
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
  watchedFolderLabel,
  autoWatchIntervalSec,
  scanProgress,
  recentScanErrorCount = 0,
  pendingSyncCount,
  onOpenMobileMenu,
  onOpenSmartSearch,
  onOpenScanLogs,
  onResumeWatch,
  onPickFolder,
  onPickFiles,
  onOpenSyncQueue,
}: TopBarProps) {
  const watcherLabel =
    watcherStatus === 'syncing'
      ? 'Syncing'
      : watcherStatus === 'watching'
        ? 'Watching'
        : watcherStatus === 'paused'
          ? 'Paused'
          : 'Idle';

  const watcherTooltip =
    watcherStatus === 'syncing'
      ? scanProgress
        ? `Syncing files (${scanProgress.processed}/${scanProgress.total}) — click to view scan logs`
        : 'Background indexer is syncing files — click to view scan logs'
      : watcherStatus === 'watching'
        ? `Watching ${watchedFolderLabel} every ${formatWatchCadence(autoWatchIntervalSec)} — click to view scan logs`
        : watcherStatus === 'paused'
          ? `Folder watch is paused. Click to let CrateSync read ${watchedFolderLabel} again`
          : 'Background directory watcher is idle — click to view scan logs';

  return (
    <header className="h-14 px-3 sm:px-6 border-b border-white/[0.07] bg-[#0B0C0E] flex items-center justify-between gap-2 sm:gap-4 shrink-0">
      {/* Left: Mobile Menu + Contextual Breadcrumb */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 -ml-2 rounded-md text-[#9CA3AF] hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
        >
          <Menu className="h-5 w-5" />
        </button>

        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0">
          <span className="hidden sm:inline text-[#717786] whitespace-nowrap shrink-0">Library</span>
          <span className="hidden sm:inline text-[#4B5563]" aria-hidden="true">
            /
          </span>
          <span
            className={`${
              subLabel ? 'hidden sm:inline text-[#9CA3AF]' : 'text-white font-medium'
            } whitespace-nowrap truncate`}
          >
            {sectionLabel}
          </span>
          {subLabel && (
            <>
              <span className="hidden sm:inline text-[#4B5563]" aria-hidden="true">
                /
              </span>
              <span className="text-white font-medium truncate">{subLabel}</span>
            </>
          )}
        </nav>
      </div>

      {/* Right: Watcher Status Indicator + Clean Single-Line Action Controls */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button
          type="button"
          onClick={watcherStatus === 'paused' ? onResumeWatch : onOpenScanLogs}
          title={watcherTooltip}
          aria-label={
            watcherStatus === 'paused'
              ? 'Directory watcher status: Paused. Allow folder access and rescan'
              : `Directory watcher status: ${watcherLabel}. Open scan logs`
          }
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[#13151B] border border-white/[0.08] hover:border-white/[0.18] transition-colors whitespace-nowrap shrink-0"
        >
          {watcherStatus === 'syncing' ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#FF4D64] shrink-0" />
          ) : watcherStatus === 'watching' ? (
            <Radio className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />
          ) : watcherStatus === 'paused' ? (
            <Pause className="h-3.5 w-3.5 text-[#F59E0B] shrink-0" />
          ) : (
            <Clock className="h-3.5 w-3.5 text-[#6B7280] shrink-0" />
          )}
          <span
            className={`hidden sm:inline ${
              watcherStatus === 'syncing'
                ? 'text-white'
                : watcherStatus === 'watching'
                  ? 'text-[#E5E7EB]'
                  : watcherStatus === 'paused'
                    ? 'text-[#FCD34D]'
                    : 'text-[#8B92A2]'
            }`}
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
          aria-label="Open Smart Search"
          className="inline-flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-md text-xs text-[#9CA3AF] bg-[#13151B] border border-white/[0.08] hover:text-white hover:border-white/[0.18] transition-colors whitespace-nowrap shrink-0"
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
          title={isScanning ? 'Scanning...' : 'Scan Folder'}
          aria-label={isScanning ? 'Scanning' : 'Scan Folder'}
          className="inline-flex items-center gap-2 px-2.5 sm:px-3.5 py-2 rounded-md text-xs font-medium text-[#E5E7EB] bg-[#161920] border border-white/[0.09] hover:bg-[#1E222B] hover:border-white/[0.16] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <FolderPlus className="h-3.5 w-3.5 text-[#9CA3AF]" />
          <span className="hidden sm:inline">{isScanning ? 'Scanning...' : 'Scan Folder'}</span>
        </button>

        <button
          type="button"
          onClick={onOpenSyncQueue}
          title={pendingSyncCount > 0 ? `Sync Queue (${pendingSyncCount} pending)` : 'Sync Queue'}
          aria-label={pendingSyncCount > 0 ? `Sync Queue, ${pendingSyncCount} pending` : 'Sync Queue'}
          className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">
            {pendingSyncCount > 0 ? `Sync (${pendingSyncCount})` : 'Sync Queue'}
          </span>
          {pendingSyncCount > 0 && (
            <span className="sm:hidden font-mono tabular-nums">{pendingSyncCount}</span>
          )}
        </button>
      </div>
    </header>
  );
}
