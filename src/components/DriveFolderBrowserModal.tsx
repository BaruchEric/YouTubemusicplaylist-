import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  Cloud,
  Filter,
  Folder,
  FolderPlus,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Users,
  X,
} from 'lucide-react';
import {
  countAudioInDriveFolders,
  deleteCachedDriveFolderCount,
  getCachedDriveFolderCount,
  listDriveFoldersInParent,
  setCachedDriveFolderCount,
  type DriveBrowseScope,
  type DriveFolderAudioCount,
  type DriveFolderItem,
} from '../utils/googleDriveApi';
import { formatRelativeTime } from '../utils/youtubeLinks';

export interface SelectedDriveFolderResult {
  id: string;
  name: string;
  displayPath: string;
}

interface BreadcrumbNode {
  id: string; // 'root' for My Drive root, '' for Shared with me root, or actual Drive folder ID
  name: string;
}

interface DriveFolderBrowserModalProps {
  open: boolean;
  accessToken: string | null;
  title?: string;
  subtitle?: string;
  allowSelectAllDrive?: boolean;
  isMutating?: boolean;
  refreshSignal?: number;
  onClose: () => void;
  onSelectFolder: (result: SelectedDriveFolderResult) => void;
  onRequestCreateDriveFolder?: (params: {
    folderName: string;
    parentFolderId: string | null;
    parentFolderLabel: string;
  }) => void;
  onAuthError?: (err: unknown) => void;
}

export function DriveFolderBrowserModal({
  open,
  accessToken,
  title = 'Browse Google Drive Folders',
  subtitle = 'Navigate My Drive or Shared with me, or search across all Drive folders.',
  allowSelectAllDrive = false,
  isMutating = false,
  refreshSignal = 0,
  onClose,
  onSelectFolder,
  onRequestCreateDriveFolder,
  onAuthError,
}: DriveFolderBrowserModalProps) {
  const [scope, setScope] = useState<'my-drive' | 'shared-with-me'>('my-drive');
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbNode[]>([
    { id: 'root', name: 'My Drive' },
  ]);
  const [folders, setFolders] = useState<DriveFolderItem[]>([]);
  const [folderAudioCounts, setFolderAudioCounts] = useState<
    Record<string, DriveFolderAudioCount>
  >({});
  const [isCountingAudio, setIsCountingAudio] = useState(false);
  const [hideZeroAudio, setHideZeroAudio] = useState(false);
  const countAbortRef = useRef<AbortController | null>(null);

  const [highlightedFolder, setHighlightedFolder] = useState<DriveFolderItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter current folder or run global Drive search
  const [searchInput, setSearchInput] = useState('');
  const [activeGlobalSearch, setActiveGlobalSearch] = useState('');

  // Inline create folder inside current browsed folder
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Keep callback ref stable so parent re-renders never restart folder loading or counting
  const onAuthErrorRef = useRef(onAuthError);
  onAuthErrorRef.current = onAuthError;
  const lastRefreshSignalRef = useRef(refreshSignal);

  const currentCrumb = breadcrumbs[breadcrumbs.length - 1];

  const loadFolders = useCallback(
    async (options?: { forceRecount?: boolean }) => {
      if (!open || !accessToken) return;
      const forceRecount = Boolean(options?.forceRecount);
      countAbortRef.current?.abort();
      setIsLoading(true);
      setError(null);
      setHighlightedFolder(null);
      setIsCountingAudio(false);
      try {
        let browseScope: DriveBrowseScope = scope;
        let parentId: string | null = currentCrumb?.id ?? 'root';
        if (activeGlobalSearch.trim()) {
          browseScope = 'search';
          parentId = null;
        } else if (scope === 'shared-with-me' && parentId === '') {
          parentId = null;
        }

        const items = await listDriveFoldersInParent(accessToken, {
          scope: browseScope,
          parentId,
          searchTerm: activeGlobalSearch.trim() || undefined,
        });
        setFolders(items);

        // Hydrate cached counts immediately (including descendant subfolders cached by parent scans!)
        const cachedSnapshot: Record<string, DriveFolderAudioCount> = {};
        const uncachedIds: string[] = [];

        for (const item of items) {
          if (forceRecount) {
            deleteCachedDriveFolderCount(item.id);
            uncachedIds.push(item.id);
          } else {
            const cached = getCachedDriveFolderCount(item.id);
            if (cached) {
              cachedSnapshot[item.id] = cached;
            } else {
              uncachedIds.push(item.id);
            }
          }
        }

        setFolderAudioCounts(cachedSnapshot);

        // Count ONLY uncached folders using the proven parent-based DFS scanner
        if (uncachedIds.length > 0) {
          const controller = new AbortController();
          countAbortRef.current = controller;
          setIsCountingAudio(true);
          void countAudioInDriveFolders(accessToken, uncachedIds, {
            signal: controller.signal,
            onUpdate: (snapshot) => {
              if (countAbortRef.current !== controller) return;
              setFolderAudioCounts({ ...cachedSnapshot, ...snapshot });
            },
          })
            .catch((countErr) => {
              if ((countErr as { name?: string })?.name === 'AbortError') return;
              onAuthErrorRef.current?.(countErr);
            })
            .finally(() => {
              if (countAbortRef.current === controller) {
                setIsCountingAudio(false);
              }
            });
        }
      } catch (err) {
        onAuthErrorRef.current?.(err);
        setError(err instanceof Error ? err.message : 'Failed to load Google Drive folders.');
      } finally {
        setIsLoading(false);
      }
    },
    [open, accessToken, scope, currentCrumb?.id, activeGlobalSearch]
  );

  useEffect(() => {
    if (open && accessToken) {
      const signalChanged = lastRefreshSignalRef.current !== refreshSignal;
      lastRefreshSignalRef.current = refreshSignal;
      void loadFolders({ forceRecount: signalChanged });
    }
    return () => {
      countAbortRef.current?.abort();
    };
  }, [open, accessToken, loadFolders, refreshSignal]);

  // Reset transient form state on close
  useEffect(() => {
    if (!open) {
      countAbortRef.current?.abort();
      setShowCreateForm(false);
      setNewFolderName('');
    }
  }, [open]);

  const getFolderCount = useCallback(
    (folderId: string): DriveFolderAudioCount | null => {
      return folderAudioCounts[folderId] ?? null;
    },
    [folderAudioCounts]
  );

  const handleSwitchScope = (nextScope: 'my-drive' | 'shared-with-me') => {
    setScope(nextScope);
    setActiveGlobalSearch('');
    setSearchInput('');
    setHighlightedFolder(null);
    setBreadcrumbs(
      nextScope === 'my-drive'
        ? [{ id: 'root', name: 'My Drive' }]
        : [{ id: '', name: 'Shared with me' }]
    );
  };

  const handleOpenFolder = (folder: DriveFolderItem) => {
    if (activeGlobalSearch) {
      setActiveGlobalSearch('');
      setSearchInput('');
      setBreadcrumbs([
        { id: 'root', name: 'My Drive' },
        { id: folder.id, name: folder.name },
      ]);
      setScope('my-drive');
      return;
    }
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setSearchInput('');
  };

  const handleJumpBreadcrumb = (index: number) => {
    setActiveGlobalSearch('');
    setSearchInput('');
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  };

  const handleGlobalSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveGlobalSearch(searchInput.trim());
  };

  // Search filter + optional "Hide 0 audio" filter flag
  const { displayedFolders, hiddenZeroCount } = useMemo(() => {
    const q = !activeGlobalSearch ? searchInput.trim().toLowerCase() : '';
    const searchFiltered = q
      ? folders.filter((f) => f.name.toLowerCase().includes(q))
      : folders;

    let zeroCount = 0;
    for (const f of searchFiltered) {
      const info = getFolderCount(f.id);
      if (info && info.done && info.count === 0) {
        zeroCount += 1;
      }
    }

    if (!hideZeroAudio) {
      return { displayedFolders: searchFiltered, hiddenZeroCount: zeroCount };
    }

    const nonZero = searchFiltered.filter((f) => {
      const info = getFolderCount(f.id);
      // Keep folders visible until the one-time index finishes
      if (!info || !info.done) return true;
      return info.count > 0;
    });
    return { displayedFolders: nonZero, hiddenZeroCount: zeroCount };
  }, [folders, searchInput, activeGlobalSearch, getFolderCount, hideZeroAudio]);

  const buildPathForFolder = (folder: DriveFolderItem | null): SelectedDriveFolderResult | null => {
    if (folder) {
      if (activeGlobalSearch) {
        return {
          id: folder.id,
          name: folder.name,
          displayPath: folder.name,
        };
      }
      const prefix = breadcrumbs
        .filter((b) => b.id !== '' && b.id !== 'root')
        .map((b) => b.name);
      const fullSegments = [...prefix, folder.name];
      return {
        id: folder.id,
        name: folder.name,
        displayPath: fullSegments.join('/'),
      };
    }

    if (activeGlobalSearch) return null;
    if (!currentCrumb) return null;
    if (currentCrumb.id === '') return null;

    if (currentCrumb.id === 'root') {
      return {
        id: 'root',
        name: 'My Drive',
        displayPath: 'My Drive',
      };
    }

    const segments = breadcrumbs
      .filter((b) => b.id !== '' && b.id !== 'root')
      .map((b) => b.name);
    return {
      id: currentCrumb.id,
      name: currentCrumb.name,
      displayPath: segments.join('/') || currentCrumb.name,
    };
  };

  const selectionTarget = buildPathForFolder(highlightedFolder);

  const handleConfirmSelection = () => {
    if (!selectionTarget) return;
    onSelectFolder(selectionTarget);
    onClose();
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newFolderName.trim();
    if (!cleaned || !onRequestCreateDriveFolder) return;
    const parentId =
      !activeGlobalSearch && currentCrumb && currentCrumb.id !== ''
        ? currentCrumb.id
        : 'root';
    const parentLabel =
      !activeGlobalSearch && currentCrumb && currentCrumb.id !== ''
        ? breadcrumbs.map((b) => b.name).join(' / ')
        : 'My Drive';
    onRequestCreateDriveFolder({
      folderName: cleaned,
      parentFolderId: parentId,
      parentFolderLabel: parentLabel,
    });
    setNewFolderName('');
    setShowCreateForm(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-2xl rounded-lg border border-white/[0.12] bg-[#12141A] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-start justify-between gap-4">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <Cloud className="h-4 w-4 text-[#FF1F3D] shrink-0" />
              <h3 className="font-display text-sm font-semibold text-white truncate">{title}</h3>
            </div>
            <p className="text-xs text-[#8B92A2]">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Google Drive folder browser"
            className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scope Switcher + Filter Flag + Search + New Folder */}
        <div className="px-5 py-3 bg-[#0E1015] border-b border-white/[0.08] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 p-1 rounded-md bg-[#14171F] border border-white/[0.08]">
              <button
                type="button"
                onClick={() => handleSwitchScope('my-drive')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  scope === 'my-drive' && !activeGlobalSearch
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                <HardDrive className="h-3.5 w-3.5" />
                <span>My Drive</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchScope('shared-with-me')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  scope === 'shared-with-me' && !activeGlobalSearch
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                <span>Shared with me</span>
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Filter Flag: Hide 0-audio folders */}
              <button
                type="button"
                aria-pressed={hideZeroAudio}
                onClick={() => setHideZeroAudio((prev) => !prev)}
                title="Filter out folders with 0 audio files"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors whitespace-nowrap ${
                  hideZeroAudio
                    ? 'bg-[#FF1F3D]/15 border-[#FF1F3D]/50 text-white'
                    : 'bg-[#1B1F28] border-white/[0.09] text-[#D1D5DB] hover:text-white hover:bg-[#232834]'
                }`}
              >
                <Filter className={`h-3.5 w-3.5 ${hideZeroAudio ? 'text-[#FF1F3D]' : 'text-[#9CA3AF]'}`} />
                <span>
                  Hide 0 audio
                  {hiddenZeroCount > 0 ? ` (${hiddenZeroCount})` : ''}
                </span>
              </button>

              {onRequestCreateDriveFolder && currentCrumb?.id !== '' && (
                <button
                  type="button"
                  onClick={() => setShowCreateForm((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-[#D1D5DB] hover:text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#232834] transition-colors whitespace-nowrap"
                >
                  <FolderPlus className="h-3.5 w-3.5 text-[#9CA3AF]" />
                  <span>New Folder</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void loadFolders({ forceRecount: true })}
                disabled={isLoading}
                title="Refresh current Drive folder and recount"
                className="p-1.5 rounded text-[#9CA3AF] hover:text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#232834] disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <form onSubmit={handleGlobalSearchSubmit} className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="h-3.5 w-3.5 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  if (!e.target.value.trim() && activeGlobalSearch) {
                    setActiveGlobalSearch('');
                  }
                }}
                placeholder="Filter current folder or press Enter to search all Google Drive..."
                className="w-full pl-8 pr-8 py-1.5 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    setActiveGlobalSearch('');
                  }}
                  aria-label="Clear folder search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={!searchInput.trim() || isLoading}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.1] hover:bg-[#232834] disabled:opacity-45 transition-colors whitespace-nowrap"
            >
              Search All Drive
            </button>
          </form>

          {showCreateForm && (
            <form
              onSubmit={handleCreateSubmit}
              className="p-2.5 rounded-md bg-[#0B0C0E] border border-white/[0.1] flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
            >
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={`New folder inside ${breadcrumbs.map((b) => b.name).join(' / ')}...`}
                autoFocus
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded bg-[#12141A] border border-white/[0.1] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!newFolderName.trim() || isMutating}
                  className="px-3 py-1.5 rounded text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-45 transition-colors whitespace-nowrap"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="px-2 py-1.5 rounded text-xs text-[#9CA3AF] hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Breadcrumb Trail + Counting Status */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-xs overflow-x-auto pb-0.5 min-w-0">
              {activeGlobalSearch ? (
                <div className="flex items-center gap-2 text-[#9CA3AF]">
                  <span>
                    Search results across Google Drive for{' '}
                    <span className="text-white font-medium">&ldquo;{activeGlobalSearch}&rdquo;</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveGlobalSearch('');
                      setSearchInput('');
                    }}
                    className="text-[#FF1F3D] hover:underline text-[11px]"
                  >
                    Back to My Drive
                  </button>
                </div>
              ) : (
                breadcrumbs.map((crumb, idx) => {
                  const isLast = idx === breadcrumbs.length - 1;
                  return (
                    <div key={`${crumb.id}-${idx}`} className="flex items-center gap-1 shrink-0">
                      {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-[#525866]" />}
                      <button
                        type="button"
                        onClick={() => handleJumpBreadcrumb(idx)}
                        className={`px-1.5 py-0.5 rounded transition-colors ${
                          isLast
                            ? 'text-white font-medium bg-white/[0.06]'
                            : 'text-[#9CA3AF] hover:text-white hover:bg-white/[0.04]'
                        }`}
                      >
                        {crumb.name}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {!isLoading && folders.length > 0 && (
                <span className="text-[11px] font-mono tabular-nums text-[#8B92A2]">
                  {displayedFolders.length !== folders.length
                    ? `${displayedFolders.length.toLocaleString()} / ${folders.length.toLocaleString()} folders`
                    : `${folders.length.toLocaleString()} ${folders.length === 1 ? 'folder' : 'folders'}`}
                </span>
              )}
              {isCountingAudio && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#8B92A2]">
                  <Loader2 className="h-3 w-3 animate-spin text-[#FF1F3D]" />
                  <span>
                    Counting{' '}
                    {folders.filter((f) => folderAudioCounts[f.id]?.done).length}/{folders.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      countAbortRef.current?.abort();
                      countAbortRef.current = null;
                      setIsCountingAudio(false);
                      setFolderAudioCounts((prev) => {
                        const finalized: Record<string, DriveFolderAudioCount> = {};
                        for (const f of folders) {
                          const existing = prev[f.id];
                          if (existing) {
                            const next: DriveFolderAudioCount = existing.done
                              ? existing
                              : { ...existing, done: true, capped: true };
                            finalized[f.id] = next;
                            setCachedDriveFolderCount(f.id, next);
                          }
                        }
                        return finalized;
                      });
                    }}
                    className="ml-0.5 px-1.5 py-0.5 rounded text-[10px] text-[#D1D5DB] hover:text-white bg-white/[0.06] hover:bg-white/[0.12] transition-colors"
                  >
                    Stop
                  </button>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Folder List Body */}
        <div className="flex-1 min-h-[240px] max-h-[380px] overflow-y-auto bg-[#0B0C0E] divide-y divide-white/[0.05]">
          {allowSelectAllDrive &&
            !activeGlobalSearch &&
            breadcrumbs.length === 1 &&
            scope === 'my-drive' && (
              <button
                type="button"
                onClick={() => {
                  onSelectFolder({
                    id: '',
                    name: 'All Google Drive Audio',
                    displayPath: 'All Google Drive Audio',
                  });
                  onClose();
                }}
                className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Cloud className="h-4 w-4 text-[#FF1F3D] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-white">All Google Drive Audio</div>
                    <div className="text-[11px] text-[#8B92A2]">
                      Scan audio across every folder in your Google Drive
                    </div>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-[#9CA3AF] shrink-0">Select</span>
              </button>
            )}

          {isLoading ? (
            <div className="py-12 flex items-center justify-center gap-2 text-xs text-[#8B92A2]">
              <Loader2 className="h-4 w-4 animate-spin text-[#FF1F3D]" />
              <span>Loading folders from Google Drive...</span>
            </div>
          ) : error ? (
            <div className="p-6 text-center space-y-2">
              <p className="text-xs text-[#FCA5A5]">{error}</p>
              <button
                type="button"
                onClick={() => void loadFolders()}
                className="px-3 py-1.5 rounded text-xs text-white bg-[#1B1F28] border border-white/[0.1] hover:bg-[#232834]"
              >
                Retry
              </button>
            </div>
          ) : displayedFolders.length === 0 ? (
            <div className="py-12 px-4 text-center space-y-2">
              <Folder className="h-5 w-5 text-[#525866] mx-auto" />
              <p className="text-xs text-[#9CA3AF]">
                {hideZeroAudio && hiddenZeroCount > 0
                  ? `All ${hiddenZeroCount} folder${hiddenZeroCount === 1 ? '' : 's'} here have 0 audio files.`
                  : activeGlobalSearch
                    ? `No folders found matching "${activeGlobalSearch}".`
                    : searchInput.trim()
                      ? `No subfolders in "${currentCrumb?.name}" match "${searchInput.trim()}". Press Enter to search all Google Drive.`
                      : `No subfolders inside "${currentCrumb?.name}".`}
              </p>
              {hideZeroAudio && hiddenZeroCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setHideZeroAudio(false)}
                  className="px-3 py-1.5 rounded text-xs text-white bg-[#1B1F28] border border-white/[0.1] hover:bg-[#232834]"
                >
                  Show 0-audio folders
                </button>
              ) : (
                !activeGlobalSearch &&
                currentCrumb &&
                currentCrumb.id !== '' && (
                  <p className="text-[11px] text-[#6B7280]">
                    Click &ldquo;Select Folder&rdquo; below to map{' '}
                    <span className="font-mono text-[#D1D5DB]">{currentCrumb.name}</span>.
                  </p>
                )
              )}
            </div>
          ) : (
            displayedFolders.map((folder) => {
              const isSelected = highlightedFolder?.id === folder.id;
              const modMs = Date.parse(folder.modifiedTime) || null;
              const countInfo = getFolderCount(folder.id);

              return (
                <div
                  key={folder.id}
                  onClick={() => setHighlightedFolder(isSelected ? null : folder)}
                  onDoubleClick={() => handleOpenFolder(folder)}
                  className={`px-4 py-2.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#FF1F3D]/15' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <Folder
                      className={`h-4 w-4 shrink-0 ${
                        isSelected
                          ? 'text-[#FF1F3D]'
                          : countInfo && countInfo.count > 0
                            ? 'text-[#22C55E]'
                            : 'text-[#9CA3AF]'
                      }`}
                    />
                    <span className="text-xs font-medium text-white truncate">{folder.name}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-[#FF1F3D] shrink-0" />}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {/* Subfolder count per folder */}
                    <span
                      className={`text-[11px] font-mono tabular-nums ${
                        !countInfo
                          ? 'text-[#525866]'
                          : countInfo.subfolderCount > 0
                            ? 'text-[#9CA3AF]'
                            : 'text-[#525866]'
                      }`}
                      title="Subfolders inside this folder"
                    >
                      {!countInfo
                        ? '…'
                        : `${countInfo.subfolderCount.toLocaleString()}${countInfo.capped || !countInfo.done ? '+' : ''} ${countInfo.subfolderCount === 1 && !countInfo.capped && countInfo.done ? 'folder' : 'folders'}`}
                    </span>

                    {/* Audio count per folder */}
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-mono tabular-nums ${
                        !countInfo
                          ? 'text-[#525866]'
                          : countInfo.count > 0
                            ? 'text-[#22C55E]'
                            : 'text-[#6B7280]'
                      }`}
                    >
                      {countInfo && !countInfo.done && (
                        <Loader2 className="h-2.5 w-2.5 animate-spin text-[#8B92A2]" />
                      )}
                      {!countInfo
                        ? '…'
                        : `${countInfo.count.toLocaleString()}${countInfo.capped || !countInfo.done ? '+' : ''} audio`}
                    </span>

                    {modMs && (
                      <span className="hidden md:inline text-[11px] font-mono tabular-nums text-[#525866]">
                        {formatRelativeTime(modMs)}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenFolder(folder);
                      }}
                      title={`Open "${folder.name}"`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#9CA3AF] hover:text-white hover:bg-white/[0.08] transition-colors"
                    >
                      <span>Open</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Selection Bar */}
        <div className="px-5 py-3.5 bg-[#0E1015] border-t border-white/[0.08] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-[#6B7280] font-medium">
              Selected Google Drive Folder
            </div>
            <div className="text-xs font-mono text-white truncate">
              {selectionTarget ? selectionTarget.displayPath : 'Click a folder to select'}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-md text-xs text-[#9CA3AF] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectionTarget}
              onClick={handleConfirmSelection}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-45 transition-colors whitespace-nowrap"
            >
              <Check className="h-3.5 w-3.5" />
              <span>Select Folder</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
