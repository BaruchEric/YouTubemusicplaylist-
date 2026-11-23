import {
  Cloud,
  Disc3,
  ExternalLink,
  FolderSync,
  HardDrive,
  LayoutDashboard,
  ListMusic,
  Pencil,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type {
  Playlist,
  PlaylistDiff,
  SmartPlaylist,
  WatchedFolderInfo,
  WorkspaceView,
} from '../types/music';
import { formatRelativeTime } from '../utils/youtubeLinks';

interface SidebarProps {
  activeView: WorkspaceView;
  activePlaylistId: string | null;
  activeSmartPlaylistId: string | null;
  playlists: Playlist[];
  smartPlaylists: SmartPlaylist[];
  smartPlaylistCountMap: Map<string, number>;
  diffMap: Map<string, PlaylistDiff>;
  totalLocalTracks: number;
  totalPendingSyncs: number;
  watchedFolder: WatchedFolderInfo | null;
  isScanning: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onSelectView: (view: WorkspaceView) => void;
  onSelectPlaylist: (playlistId: string) => void;
  onSelectSmartPlaylist: (smartPlaylistId: string) => void;
  onOpenCreatePlaylist: () => void;
  onOpenCreateSmartPlaylist: () => void;
  onEditSmartPlaylist: (smartPlaylist: SmartPlaylist) => void;
  onRescanWatchedFolder: () => void;
}

export function Sidebar({
  activeView,
  activePlaylistId,
  activeSmartPlaylistId,
  playlists,
  smartPlaylists,
  smartPlaylistCountMap,
  diffMap,
  totalLocalTracks,
  totalPendingSyncs,
  watchedFolder,
  isScanning,
  mobileOpen,
  onCloseMobile,
  onSelectView,
  onSelectPlaylist,
  onSelectSmartPlaylist,
  onOpenCreatePlaylist,
  onOpenCreateSmartPlaylist,
  onEditSmartPlaylist,
  onRescanWatchedFolder,
}: SidebarProps) {
  const navItems: Array<{
    id: WorkspaceView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
    highlightCount?: boolean;
  }> = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
    },
    {
      id: 'scanner',
      label: 'Device Storage',
      icon: HardDrive,
      count: totalLocalTracks > 0 ? totalLocalTracks : undefined,
    },
    {
      id: 'sync',
      label: 'Sync Queue',
      icon: FolderSync,
      count: totalPendingSyncs > 0 ? totalPendingSyncs : undefined,
      highlightCount: totalPendingSyncs > 0,
    },
    {
      id: 'transfer',
      label: 'Drive Sync & Transfer',
      icon: Cloud,
    },
  ];

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#111317] border-r border-white/[0.07]">
      {/* Brand Wordmark */}
      <div className="flex items-center justify-between h-14 px-5 border-b border-white/[0.07] shrink-0">
        <button
          type="button"
          onClick={() => {
            onSelectView('dashboard');
            onCloseMobile();
          }}
          className="flex items-center gap-2.5 text-left group"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#FF1F3D] text-white shrink-0">
            <Disc3 className="h-4 w-4" />
          </span>
          <span className="font-display text-[17px] font-semibold tracking-tight text-white whitespace-nowrap">
            CrateSync
          </span>
        </button>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation"
          className="lg:hidden p-1.5 rounded-md text-[#9CA3AF] hover:text-white hover:bg-white/[0.06] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Primary Workspace Navigation */}
      <nav aria-label="Workspace" className="px-3 pt-4 pb-3 space-y-1 shrink-0">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectView(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-[13.5px] font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-white/[0.09] text-white'
                  : 'text-[#9CA3AF] hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-[#FF1F3D]' : 'text-[#717786]'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {item.count !== undefined && (
                <span
                  className={`font-mono text-xs tabular-nums ${
                    item.highlightCount ? 'text-[#F59E0B] font-medium' : 'text-[#717786]'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Scrollable Smart Playlists & Standard Playlists */}
      <div className="flex-1 overflow-y-auto min-h-0 border-t border-white/[0.06]">
        {/* Smart Playlists Section */}
        <div className="pt-4 pb-2">
          <div className="flex items-center justify-between px-5 pb-2">
            <span className="text-xs font-medium text-[#8B92A2]">Smart Playlists</span>
            <button
              type="button"
              onClick={() => {
                onOpenCreateSmartPlaylist();
                onCloseMobile();
              }}
              aria-label="Create smart playlist"
              className="flex items-center gap-1 text-xs font-medium text-[#D1D5DB] hover:text-white transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New</span>
            </button>
          </div>

          <div className="px-3 space-y-0.5">
            {smartPlaylists.length === 0 ? (
              <div className="px-2 py-2.5 text-xs text-[#6B7280] leading-relaxed">
                Auto-updating rule playlists. Click New to build one.
              </div>
            ) : (
              smartPlaylists.map((sp) => {
                const isSelected =
                  activeView === 'smart-playlist' && activeSmartPlaylistId === sp.id;
                const matchCount = smartPlaylistCountMap.get(sp.id) ?? 0;

                return (
                  <div
                    key={sp.id}
                    className={`group flex items-center justify-between gap-1 rounded-md transition-colors ${
                      isSelected
                        ? 'bg-white/[0.09] text-white'
                        : 'text-[#A1A7B5] hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectSmartPlaylist(sp.id);
                        onCloseMobile();
                      }}
                      className="flex-1 flex items-center gap-2.5 min-w-0 px-3 py-2 text-left"
                    >
                      <SlidersHorizontal
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isSelected ? 'text-[#FF1F3D]' : 'text-[#6B7280]'
                        }`}
                      />
                      <span className="text-[13.5px] font-medium truncate">{sp.name}</span>
                    </button>

                    <div className="flex items-center gap-1 pr-2 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditSmartPlaylist(sp);
                          onCloseMobile();
                        }}
                        aria-label={`Edit ${sp.name} rules`}
                        title="Edit rules"
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.08] transition-all"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <span className="font-mono text-xs tabular-nums text-[#6B7280] pr-1">
                        {matchCount}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Standard Playlists Section */}
        <div className="border-t border-white/[0.06] pt-4 pb-4">
          <div className="flex items-center justify-between px-5 pb-2">
            <span className="text-xs font-medium text-[#8B92A2]">Playlists</span>
            <button
              type="button"
              onClick={() => {
                onOpenCreatePlaylist();
                onCloseMobile();
              }}
              aria-label="Create playlist"
              className="flex items-center gap-1 text-xs font-medium text-[#D1D5DB] hover:text-white transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New</span>
            </button>
          </div>

          <div className="px-3 space-y-0.5">
            {playlists.length === 0 ? (
              <div className="px-2 py-3 text-xs text-[#6B7280] leading-relaxed">
                No playlists yet. Scan a music folder or create your first playlist.
              </div>
            ) : (
              playlists.map((pl) => {
                const isSelected = activeView === 'playlist' && activePlaylistId === pl.id;
                const diff = diffMap.get(pl.id);
                const pendingChanges = (diff?.toAdd.length ?? 0) + (diff?.toRemove.length ?? 0);

                return (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => {
                      onSelectPlaylist(pl.id);
                      onCloseMobile();
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                      isSelected
                        ? 'bg-white/[0.09] text-white'
                        : 'text-[#A1A7B5] hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <ListMusic
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isSelected ? 'text-[#FF1F3D]' : 'text-[#6B7280]'
                        }`}
                      />
                      <span className="text-[13.5px] font-medium truncate">{pl.name}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0 font-mono text-xs tabular-nums">
                      {pendingChanges > 0 && (
                        <span
                          className="text-[#F59E0B]"
                          title={`${pendingChanges} pending sync change${pendingChanges === 1 ? '' : 's'}`}
                        >
                          +{pendingChanges}
                        </span>
                      )}
                      <span className="text-[#6B7280]">{pl.trackIds.length}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Direct YouTube Music Launcher */}
      <div className="px-3 py-3 border-t border-white/[0.06] shrink-0">
        <a
          href="https://music.youtube.com/library/playlists"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-xs font-medium text-[#E5E7EB] bg-[#181B22] border border-white/[0.08] hover:border-[#FF1F3D]/50 hover:text-white transition-colors whitespace-nowrap"
        >
          <span>Open YouTube Music</span>
          <ExternalLink className="h-3.5 w-3.5 text-[#FF4D64] shrink-0" />
        </a>
      </div>

      {/* Watched Folder Summary (only rendered when a real folder has been scanned) */}
      {watchedFolder && (
        <div className="p-4 border-t border-white/[0.07] bg-[#0D0F12] shrink-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs font-medium text-[#E5E7EB] truncate">
              {watchedFolder.name}
            </span>
            {watchedFolder.hasLiveHandle && (
              <button
                type="button"
                onClick={onRescanWatchedFolder}
                disabled={isScanning}
                aria-label="Re-scan mounted folder"
                className="p-1 rounded text-[#9CA3AF] hover:text-white hover:bg-white/[0.06] disabled:opacity-40 transition-colors shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
          <div className="text-xs text-[#6B7280] font-mono tabular-nums truncate">
            {watchedFolder.trackCount} files · {formatRelativeTime(watchedFolder.lastScannedAt)}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[260px] shrink-0 h-full">{sidebarContent}</aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 w-[280px] max-w-[85vw] h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
}
