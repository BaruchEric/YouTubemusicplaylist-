import { FileAudio, FolderPlus, Menu, RefreshCw, Search } from 'lucide-react';

interface TopBarProps {
  sectionLabel: string;
  subLabel?: string;
  isScanning: boolean;
  pendingSyncCount: number;
  onOpenMobileMenu: () => void;
  onOpenSmartSearch: () => void;
  onPickFolder: () => void;
  onPickFiles: () => void;
  onOpenSyncQueue: () => void;
}

export function TopBar({
  sectionLabel,
  subLabel,
  isScanning,
  pendingSyncCount,
  onOpenMobileMenu,
  onOpenSmartSearch,
  onPickFolder,
  onPickFiles,
  onOpenSyncQueue,
}: TopBarProps) {
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

      {/* Right: Clean Single-Line Action Controls */}
      <div className="flex items-center gap-2 shrink-0">
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
