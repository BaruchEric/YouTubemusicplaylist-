import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  Database,
  Filter,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  Music2,
  Search,
  X,
} from 'lucide-react';
import type { LocalTrack } from '../types/music';
import { isAudioFile } from '../utils/audioMetadata';
import { normalizeFolderPath } from '../utils/folderMappings';
import {
  supportsDirectoryPicker,
  walkDirectoryHandle,
  type ScannedFileEntry,
} from '../utils/syncEngine';

interface LocalFolderBrowserModalProps {
  open: boolean;
  deviceName: string;
  initialPath?: string;
  availableLocalFolders: string[];
  tracks: LocalTrack[];
  onClose: () => void;
  onSelectFolder: (localFolderPath: string) => void;
  onIngestLocalFolderEntries?: (
    entries: ScannedFileEntry[],
    folderRootName: string
  ) => Promise<void> | void;
}

interface VirtualFolderNode {
  name: string;
  path: string;
  audioCount: number;
  subfolderCount: number;
  children: Map<string, VirtualFolderNode>;
}

interface LiveHandleCrumb {
  name: string;
  path: string;
  handle: FileSystemDirectoryHandle;
}

interface LiveSubdirEntry {
  name: string;
  path: string;
  handle: FileSystemDirectoryHandle;
}

interface LocalSubdirAudioCount {
  count: number;
  subfolderCount: number;
  done: boolean;
  capped: boolean;
}

const LOCAL_AUDIO_EXT_RE = /\.(mp3|flac|m4a|m4b|wav|ogg|oga|opus|aac|aiff|aif|wma|alac|webm)$/i;

async function countAudioInDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  signal: AbortSignal,
  options?: {
    maxDepth?: number;
    maxMusicDirs?: number;
    maxNonAudioDirs?: number;
    maxNonAudioFiles?: number;
    onProgress?: (partial: LocalSubdirAudioCount) => void;
  }
): Promise<LocalSubdirAudioCount> {
  const maxDepth = options?.maxDepth ?? 12;
  const maxMusicDirs = options?.maxMusicDirs ?? 10_000;
  const maxNonAudioDirs = options?.maxNonAudioDirs ?? 500;
  const maxNonAudioFiles = options?.maxNonAudioFiles ?? 3000;

  let count = 0;
  let subfolderCount = 0;
  let visitedDirs = 0;
  let nonAudioFiles = 0;
  let capped = false;
  let lastEmit = 0;

  const emitProgress = () => {
    if (!options?.onProgress) return;
    const now = Date.now();
    if (now - lastEmit >= 120) {
      lastEmit = now;
      options.onProgress({ count, subfolderCount, done: false, capped });
    }
  };

  const walk = async (dir: FileSystemDirectoryHandle, depth: number) => {
    if (signal.aborted) return;
    visitedDirs += 1;
    const entriesIterable = (
      dir as FileSystemDirectoryHandle & {
        entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
      }
    ).entries();

    const subdirs: FileSystemDirectoryHandle[] = [];
    try {
      for await (const [name, child] of entriesIterable) {
        if (signal.aborted) return;
        if (name.startsWith('.')) continue;
        if (child.kind === 'file') {
          if (LOCAL_AUDIO_EXT_RE.test(name)) {
            count += 1;
          } else {
            nonAudioFiles += 1;
          }
        } else if (child.kind === 'directory') {
          subfolderCount += 1;
          if (depth + 1 < maxDepth && visitedDirs + subdirs.length < maxMusicDirs) {
            subdirs.push(child as FileSystemDirectoryHandle);
          } else {
            capped = true;
          }
        }
      }
    } catch {
      // Ignore unreadable subdirectory
    }

    emitProgress();

    for (const sub of subdirs) {
      if (signal.aborted) return;
      if (
        (count === 0 && (visitedDirs >= maxNonAudioDirs || nonAudioFiles >= maxNonAudioFiles)) ||
        visitedDirs >= maxMusicDirs
      ) {
        capped = true;
        return;
      }
      await walk(sub, depth + 1);
    }
  };

  await walk(handle, 0);
  return { count, subfolderCount, done: true, capped };
}

function createVirtualNode(name: string, path: string): VirtualFolderNode {
  return {
    name,
    path,
    audioCount: 0,
    subfolderCount: 0,
    children: new Map(),
  };
}

function populateSubfolderCounts(node: VirtualFolderNode): number {
  let total = 0;
  for (const child of node.children.values()) {
    total += 1 + populateSubfolderCounts(child);
  }
  node.subfolderCount = total;
  return total;
}

function buildTreeFromScannedLibrary(
  availableLocalFolders: string[],
  tracks: LocalTrack[]
): VirtualFolderNode {
  const root = createVirtualNode('Scanned Local Folders', '');

  const ensurePath = (rawPath: string): VirtualFolderNode | null => {
    const norm = normalizeFolderPath(rawPath);
    if (!norm) return null;
    const parts = norm.split('/').filter(Boolean);
    let cursor = root;
    let accum = '';
    for (const part of parts) {
      accum = accum ? `${accum}/${part}` : part;
      let child = cursor.children.get(part);
      if (!child) {
        child = createVirtualNode(part, accum);
        cursor.children.set(part, child);
      }
      cursor = child;
    }
    return cursor;
  };

  for (const folder of availableLocalFolders) {
    ensurePath(folder);
  }

  for (const track of tracks) {
    if (track.driveFileId && track.fileKey.startsWith('gdrive::')) continue;
    const rel = normalizeFolderPath(track.relativePath || '');
    const dirPart = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : track.folderName || '';
    const normDir = normalizeFolderPath(dirPart);
    if (!normDir) continue;

    const parts = normDir.split('/').filter(Boolean);
    let cursor = root;
    let accum = '';
    for (const part of parts) {
      accum = accum ? `${accum}/${part}` : part;
      let child = cursor.children.get(part);
      if (!child) {
        child = createVirtualNode(part, accum);
        cursor.children.set(part, child);
      }
      child.audioCount += 1;
      cursor = child;
    }
  }

  populateSubfolderCounts(root);
  return root;
}

function buildTreeFromPickedFiles(files: File[]): {
  root: VirtualFolderNode;
  rootFolderName: string;
  audioEntries: ScannedFileEntry[];
} {
  const root = createVirtualNode('Picked Local Folder', '');
  const audioEntries: ScannedFileEntry[] = [];
  let rootFolderName = '';

  for (const file of files) {
    const rawRel =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const normRel = normalizeFolderPath(rawRel);
    const segments = normRel.split('/').filter(Boolean);
    if (segments.length >= 2) {
      if (!rootFolderName) rootFolderName = segments[0];
      const dirSegments = segments.slice(0, -1);
      const isAudio = isAudioFile(file);
      if (isAudio) {
        audioEntries.push({ file, relativePath: normRel });
      }
      let cursor = root;
      let accum = '';
      for (const seg of dirSegments) {
        accum = accum ? `${accum}/${seg}` : seg;
        let child = cursor.children.get(seg);
        if (!child) {
          child = createVirtualNode(seg, accum);
          cursor.children.set(seg, child);
        }
        if (isAudio) child.audioCount += 1;
        cursor = child;
      }
    }
  }

  populateSubfolderCounts(root);
  return { root, rootFolderName, audioEntries };
}

function findNodeAtPath(root: VirtualFolderNode, path: string): VirtualFolderNode {
  const norm = normalizeFolderPath(path);
  if (!norm) return root;
  let cursor = root;
  for (const part of norm.split('/').filter(Boolean)) {
    const next = cursor.children.get(part);
    if (!next) return cursor;
    cursor = next;
  }
  return cursor;
}

export function LocalFolderBrowserModal({
  open,
  deviceName,
  initialPath = '',
  availableLocalFolders,
  tracks,
  onClose,
  onSelectFolder,
  onIngestLocalFolderEntries,
}: LocalFolderBrowserModalProps) {
  const webkitInputRef = useRef<HTMLInputElement | null>(null);
  const liveCountAbortRef = useRef<AbortController | null>(null);
  const liveCountCacheRef = useRef<Map<string, LocalSubdirAudioCount>>(new Map());

  // Mode: browsing scanned CrateSync folders OR a newly OS-picked local directory
  const [sourceTab, setSourceTab] = useState<'device-picker' | 'scanned-library'>('device-picker');

  // OS Picker mode A: FileSystemDirectoryHandle (top-level Chromium)
  const [liveBreadcrumbs, setLiveBreadcrumbs] = useState<LiveHandleCrumb[]>([]);
  const [liveSubdirs, setLiveSubdirs] = useState<LiveSubdirEntry[]>([]);
  const [liveSubdirCounts, setLiveSubdirCounts] = useState<Record<string, LocalSubdirAudioCount>>(
    {}
  );
  const [isCountingLiveSubdirs, setIsCountingLiveSubdirs] = useState(false);
  const [liveDirectAudioCount, setLiveDirectAudioCount] = useState(0);
  const [loadingLiveDir, setLoadingLiveDir] = useState(false);

  // OS Picker mode B: webkitdirectory file tree (iframe / Firefox / Safari)
  const [pickedTree, setPickedTree] = useState<VirtualFolderNode | null>(null);
  const [pickedRootName, setPickedRootName] = useState('');
  const [pickedAudioEntries, setPickedAudioEntries] = useState<ScannedFileEntry[]>([]);
  const [pickedCurrentPath, setPickedCurrentPath] = useState('');

  // Scanned library tree navigation
  const [scannedCurrentPath, setScannedCurrentPath] = useState('');

  // Shared selection + filter state
  const [highlightedPath, setHighlightedPath] = useState<string | null>(null);
  const [manualPathDraft, setManualPathDraft] = useState(normalizeFolderPath(initialPath));
  const [searchQuery, setSearchQuery] = useState('');
  const [hideZeroAudio, setHideZeroAudio] = useState(false);
  const [scanAudioOnSelect, setScanAudioOnSelect] = useState(true);
  const [isScanningSelection, setIsScanningSelection] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const scannedTree = useMemo(
    () => buildTreeFromScannedLibrary(availableLocalFolders, tracks),
    [availableLocalFolders, tracks]
  );

  const hasScannedFolders = scannedTree.children.size > 0;

  useEffect(() => {
    if (open) {
      setManualPathDraft(normalizeFolderPath(initialPath));
      setHighlightedPath(null);
      setSearchQuery('');
      setPickerError(null);
      if (hasScannedFolders && liveBreadcrumbs.length === 0 && !pickedTree) {
        setSourceTab('scanned-library');
      } else {
        setSourceTab('device-picker');
      }
    } else {
      liveCountAbortRef.current?.abort();
    }
  }, [open, initialPath, hasScannedFolders, liveBreadcrumbs.length, pickedTree]);

  useEffect(() => {
    return () => {
      liveCountAbortRef.current?.abort();
    };
  }, []);

  const inspectDirectoryHandle = async (handle: FileSystemDirectoryHandle, basePath: string) => {
    liveCountAbortRef.current?.abort();
    setLoadingLiveDir(true);
    setLiveSubdirCounts({});
    setIsCountingLiveSubdirs(false);
    setPickerError(null);
    try {
      const subdirs: LiveSubdirEntry[] = [];
      let audioCount = 0;

      const entriesIterable = (
        handle as FileSystemDirectoryHandle & {
          entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
        }
      ).entries();

      for await (const [name, child] of entriesIterable) {
        if (name.startsWith('.')) continue;
        if (child.kind === 'directory') {
          subdirs.push({
            name,
            path: basePath ? `${basePath}/${name}` : name,
            handle: child as FileSystemDirectoryHandle,
          });
        } else if (child.kind === 'file') {
          if (LOCAL_AUDIO_EXT_RE.test(name)) {
            audioCount += 1;
          }
        }
      }

      subdirs.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
      );
      setLiveSubdirs(subdirs);
      setLiveDirectAudioCount(audioCount);

      // Hydrate cached counts and only scan uncached subdirectories
      const cachedSnapshot: Record<string, LocalSubdirAudioCount> = {};
      const uncachedSubdirs: LiveSubdirEntry[] = [];
      for (const sub of subdirs) {
        const cached = liveCountCacheRef.current.get(sub.path);
        if (cached) {
          cachedSnapshot[sub.path] = cached;
        } else {
          uncachedSubdirs.push(sub);
        }
      }
      setLiveSubdirCounts(cachedSnapshot);

      // Count recursive audio files & subfolders only for uncached subdirectories
      if (uncachedSubdirs.length > 0) {
        const controller = new AbortController();
        liveCountAbortRef.current = controller;
        setIsCountingLiveSubdirs(true);
        (async () => {
          for (const sub of uncachedSubdirs) {
            if (controller.signal.aborted) return;
            const res = await countAudioInDirectoryHandle(sub.handle, controller.signal, {
              onProgress: (partial) => {
                if (controller.signal.aborted) return;
                setLiveSubdirCounts((prev) => ({
                  ...prev,
                  [sub.path]: partial,
                }));
              },
            });
            if (controller.signal.aborted) return;
            liveCountCacheRef.current.set(sub.path, res);
            setLiveSubdirCounts((prev) => ({
              ...prev,
              [sub.path]: res,
            }));
          }
        })().finally(() => {
          if (liveCountAbortRef.current === controller) {
            setIsCountingLiveSubdirs(false);
          }
        });
      }
    } catch (err) {
      setPickerError(
        err instanceof Error ? err.message : 'Unable to read subfolders inside that directory.'
      );
    } finally {
      setLoadingLiveDir(false);
    }
  };

  const handleBrowseFromDevice = () => {
    setPickerError(null);
    setSourceTab('device-picker');

    if (!supportsDirectoryPicker()) {
      webkitInputRef.current?.click();
      return;
    }

    (async () => {
      try {
        const picker = (
          window as unknown as {
            showDirectoryPicker: (opts?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;
          }
        ).showDirectoryPicker;
        const rootHandle = await picker({ mode: 'read' });
        const rootPath = normalizeFolderPath(rootHandle.name);
        liveCountCacheRef.current.clear();
        setPickedTree(null);
        setPickedAudioEntries([]);
        setPickedCurrentPath('');
        setLiveBreadcrumbs([{ name: rootHandle.name, path: rootPath, handle: rootHandle }]);
        setHighlightedPath(null);
        setManualPathDraft(rootPath);
        await inspectDirectoryHandle(rootHandle, rootPath);
      } catch (err: unknown) {
        const domErr = err as { name?: string };
        if (domErr?.name === 'AbortError') return;
        webkitInputRef.current?.click();
      }
    })();
  };

  const handleWebkitFolderSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    liveCountAbortRef.current?.abort();
    const { root, rootFolderName, audioEntries } = buildTreeFromPickedFiles(files);
    setLiveBreadcrumbs([]);
    setLiveSubdirs([]);
    setLiveSubdirCounts({});
    setPickedTree(root);
    setPickedRootName(rootFolderName);
    setPickedAudioEntries(audioEntries);
    setPickedCurrentPath(rootFolderName);
    setHighlightedPath(null);
    setManualPathDraft(normalizeFolderPath(rootFolderName));
    setSourceTab('device-picker');
  };

  const handleOpenLiveSubdir = (entry: LiveSubdirEntry) => {
    setLiveBreadcrumbs((prev) => [
      ...prev,
      { name: entry.name, path: entry.path, handle: entry.handle },
    ]);
    setHighlightedPath(null);
    setManualPathDraft(entry.path);
    setSearchQuery('');
    void inspectDirectoryHandle(entry.handle, entry.path);
  };

  const handleJumpLiveCrumb = (idx: number) => {
    const target = liveBreadcrumbs[idx];
    if (!target) return;
    setLiveBreadcrumbs((prev) => prev.slice(0, idx + 1));
    setHighlightedPath(null);
    setManualPathDraft(target.path);
    setSearchQuery('');
    void inspectDirectoryHandle(target.handle, target.path);
  };

  // Virtual tree helpers for both webkitdirectory picked tree & scanned library tree
  const activeVirtualTree = sourceTab === 'scanned-library' ? scannedTree : pickedTree;
  const activeVirtualPath =
    sourceTab === 'scanned-library' ? scannedCurrentPath : pickedCurrentPath;

  const currentVirtualNode = useMemo(() => {
    if (!activeVirtualTree) return null;
    return findNodeAtPath(activeVirtualTree, activeVirtualPath);
  }, [activeVirtualTree, activeVirtualPath]);

  const { virtualChildren, hiddenZeroVirtualCount } = useMemo(() => {
    if (!currentVirtualNode) return { virtualChildren: [], hiddenZeroVirtualCount: 0 };
    const allSorted = Array.from(currentVirtualNode.children.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    );
    const q = searchQuery.trim().toLowerCase();
    const searched = q ? allSorted.filter((n) => n.name.toLowerCase().includes(q)) : allSorted;
    const zeroCount = searched.filter((n) => n.audioCount === 0).length;
    if (!hideZeroAudio) {
      return { virtualChildren: searched, hiddenZeroVirtualCount: zeroCount };
    }
    return {
      virtualChildren: searched.filter((n) => n.audioCount > 0),
      hiddenZeroVirtualCount: zeroCount,
    };
  }, [currentVirtualNode, searchQuery, hideZeroAudio]);

  const { filteredLiveSubdirs, hiddenZeroLiveCount } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const searched = q
      ? liveSubdirs.filter((d) => d.name.toLowerCase().includes(q))
      : liveSubdirs;
    let zeroCount = 0;
    for (const d of searched) {
      const info = liveSubdirCounts[d.path];
      if (info && info.done && info.count === 0) {
        zeroCount += 1;
      }
    }
    if (!hideZeroAudio) {
      return { filteredLiveSubdirs: searched, hiddenZeroLiveCount: zeroCount };
    }
    const nonZero = searched.filter((d) => {
      const info = liveSubdirCounts[d.path];
      if (!info || !info.done) return true;
      return info.count > 0;
    });
    return { filteredLiveSubdirs: nonZero, hiddenZeroLiveCount: zeroCount };
  }, [liveSubdirs, liveSubdirCounts, searchQuery, hideZeroAudio]);

  const virtualBreadcrumbs = useMemo(() => {
    const crumbs: Array<{ label: string; path: string }> = [
      {
        label: sourceTab === 'scanned-library' ? 'Scanned Library' : pickedRootName || 'Picked Folder',
        path: sourceTab === 'scanned-library' ? '' : pickedRootName,
      },
    ];
    const norm = normalizeFolderPath(activeVirtualPath);
    if (!norm) return crumbs;
    const parts = norm.split('/').filter(Boolean);
    if (sourceTab === 'scanned-library') {
      let accum = '';
      for (const p of parts) {
        accum = accum ? `${accum}/${p}` : p;
        crumbs.push({ label: p, path: accum });
      }
    } else {
      let accum = parts[0] ?? '';
      for (let i = 1; i < parts.length; i++) {
        accum = `${accum}/${parts[i]}`;
        crumbs.push({ label: parts[i], path: accum });
      }
    }
    return crumbs;
  }, [sourceTab, activeVirtualPath, pickedRootName]);

  const handleOpenVirtualNode = (node: VirtualFolderNode) => {
    if (sourceTab === 'scanned-library') {
      setScannedCurrentPath(node.path);
    } else {
      setPickedCurrentPath(node.path);
    }
    setHighlightedPath(null);
    setManualPathDraft(node.path);
    setSearchQuery('');
  };

  const handleJumpVirtualCrumb = (path: string) => {
    if (sourceTab === 'scanned-library') {
      setScannedCurrentPath(path);
    } else {
      setPickedCurrentPath(path);
    }
    setHighlightedPath(null);
    if (path) setManualPathDraft(path);
    setSearchQuery('');
  };

  const discoveredAudioUnderSelection = useMemo(() => {
    if (sourceTab !== 'device-picker') return 0;
    const targetPath = normalizeFolderPath(highlightedPath ?? manualPathDraft);
    if (!targetPath) return 0;
    if (pickedTree && pickedAudioEntries.length > 0) {
      return pickedAudioEntries.filter((entry) => {
        const normRel = normalizeFolderPath(entry.relativePath);
        return normRel === targetPath || normRel.startsWith(`${targetPath}/`);
      }).length;
    }
    if (liveBreadcrumbs.length > 0) {
      if (highlightedPath && liveSubdirCounts[highlightedPath]) {
        return liveSubdirCounts[highlightedPath].count;
      }
      const subSum = Object.values(liveSubdirCounts).reduce((acc, item) => acc + item.count, 0);
      return liveDirectAudioCount + subSum;
    }
    return 0;
  }, [
    sourceTab,
    highlightedPath,
    manualPathDraft,
    pickedTree,
    pickedAudioEntries,
    liveBreadcrumbs.length,
    liveDirectAudioCount,
    liveSubdirCounts,
  ]);

  const handleConfirm = async () => {
    const finalPath = normalizeFolderPath(highlightedPath ?? manualPathDraft);

    if (
      sourceTab === 'device-picker' &&
      scanAudioOnSelect &&
      onIngestLocalFolderEntries &&
      finalPath
    ) {
      try {
        setIsScanningSelection(true);
        if (pickedTree && pickedAudioEntries.length > 0) {
          const matching = pickedAudioEntries.filter((entry) => {
            const normRel = normalizeFolderPath(entry.relativePath);
            return normRel.startsWith(`${finalPath}/`);
          });
          if (matching.length > 0) {
            await onIngestLocalFolderEntries(matching, pickedRootName || finalPath.split('/')[0]);
          }
        } else if (liveBreadcrumbs.length > 0) {
          const highlightedSubdir = liveSubdirs.find((d) => d.path === highlightedPath);
          const targetHandle =
            highlightedSubdir?.handle ?? liveBreadcrumbs[liveBreadcrumbs.length - 1]?.handle;
          const targetPrefix =
            highlightedSubdir?.path ?? liveBreadcrumbs[liveBreadcrumbs.length - 1]?.path;
          if (targetHandle && targetPrefix) {
            const entries = await walkDirectoryHandle(targetHandle, targetPrefix);
            if (entries.length > 0) {
              await onIngestLocalFolderEntries(entries, liveBreadcrumbs[0].name);
            }
          }
        }
      } finally {
        setIsScanningSelection(false);
      }
    }

    onSelectFolder(finalPath);
    onClose();
  };

  if (!open) return null;

  const isLiveMode = sourceTab === 'device-picker' && liveBreadcrumbs.length > 0;
  const isPickedVirtualMode = sourceTab === 'device-picker' && Boolean(pickedTree);
  const activeHiddenZeroCount = isLiveMode ? hiddenZeroLiveCount : hiddenZeroVirtualCount;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Browse Local Folders on ${deviceName}`}
    >
      {/* Hidden native directory picker fallback (works reliably inside iframes & all browsers) */}
      <input
        ref={webkitInputRef}
        type="file"
        multiple
        onChange={handleWebkitFolderSelected}
        className="hidden"
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
      />

      <div className="w-full max-w-2xl rounded-lg border border-white/[0.12] bg-[#12141A] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-start justify-between gap-4">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-[#FF1F3D] shrink-0" />
              <h3 className="font-display text-sm font-semibold text-white truncate">
                Browse Local Folders on {deviceName}
              </h3>
            </div>
            <p className="text-xs text-[#8B92A2]">
              Pick a folder directly from your device&apos;s filesystem or browse folders already
              scanned in CrateSync.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close local folder browser"
            className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Source Switcher + OS Folder Picker Trigger */}
        <div className="px-5 py-3 bg-[#0E1015] border-b border-white/[0.08] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 p-1 rounded-md bg-[#14171F] border border-white/[0.08]">
              <button
                type="button"
                onClick={() => {
                  setSourceTab('device-picker');
                  setHighlightedPath(null);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  sourceTab === 'device-picker'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span>Device Filesystem</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSourceTab('scanned-library');
                  setHighlightedPath(null);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  sourceTab === 'scanned-library'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                <Music2 className="h-3.5 w-3.5" />
                <span>Scanned Library ({availableLocalFolders.length})</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleBrowseFromDevice}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span>
                  {isLiveMode || isPickedVirtualMode
                    ? 'Choose Another Folder...'
                    : 'Choose Folder from Device...'}
                </span>
              </button>
            </div>
          </div>

          {/* Search + Hide 0 Audio Filter Flag + Breadcrumbs when a tree is open */}
          {(sourceTab === 'scanned-library' || isLiveMode || isPickedVirtualMode) && (
            <>
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="h-3.5 w-3.5 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter subfolders in this view..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  aria-pressed={hideZeroAudio}
                  onClick={() => setHideZeroAudio((prev) => !prev)}
                  title="Filter out local folders with 0 audio files"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                    hideZeroAudio
                      ? 'bg-[#FF1F3D]/15 border-[#FF1F3D]/50 text-white'
                      : 'bg-[#1B1F28] border-white/[0.09] text-[#D1D5DB] hover:text-white hover:bg-[#232834]'
                  }`}
                >
                  <Filter
                    className={`h-3.5 w-3.5 ${hideZeroAudio ? 'text-[#FF1F3D]' : 'text-[#9CA3AF]'}`}
                  />
                  <span>
                    Hide 0 audio
                    {activeHiddenZeroCount > 0 ? ` (${activeHiddenZeroCount})` : ''}
                  </span>
                </button>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 text-xs overflow-x-auto pb-0.5 min-w-0">
                  {isLiveMode
                    ? liveBreadcrumbs.map((crumb, idx) => {
                        const isLast = idx === liveBreadcrumbs.length - 1;
                        return (
                          <div
                            key={`${crumb.path}-${idx}`}
                            className="flex items-center gap-1 shrink-0"
                          >
                            {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-[#525866]" />}
                            <button
                              type="button"
                              onClick={() => handleJumpLiveCrumb(idx)}
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
                    : virtualBreadcrumbs.map((crumb, idx) => {
                        const isLast = idx === virtualBreadcrumbs.length - 1;
                        return (
                          <div
                            key={`${crumb.path}-${idx}`}
                            className="flex items-center gap-1 shrink-0"
                          >
                            {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-[#525866]" />}
                            <button
                              type="button"
                              onClick={() => handleJumpVirtualCrumb(crumb.path)}
                              className={`px-1.5 py-0.5 rounded transition-colors ${
                                isLast
                                  ? 'text-white font-medium bg-white/[0.06]'
                                  : 'text-[#9CA3AF] hover:text-white hover:bg-white/[0.04]'
                              }`}
                            >
                              {crumb.label}
                            </button>
                          </div>
                        );
                      })}
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  {(() => {
                    const totalHere = isLiveMode
                      ? liveSubdirs.length
                      : currentVirtualNode?.children.size ?? 0;
                    const shownHere = isLiveMode
                      ? filteredLiveSubdirs.length
                      : virtualChildren.length;
                    if (totalHere === 0) return null;
                    return (
                      <span className="text-[11px] font-mono tabular-nums text-[#8B92A2]">
                        {shownHere !== totalHere
                          ? `${shownHere.toLocaleString()} / ${totalHere.toLocaleString()} folders`
                          : `${totalHere.toLocaleString()} ${totalHere === 1 ? 'folder' : 'folders'}`}
                      </span>
                    );
                  })()}
                  {isLiveMode && isCountingLiveSubdirs && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#8B92A2]">
                      <Loader2 className="h-3 w-3 animate-spin text-[#FF1F3D]" />
                      <span>Counting...</span>
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Folder Browser List Body */}
        <div className="flex-1 min-h-[220px] max-h-[340px] overflow-y-auto bg-[#0B0C0E] divide-y divide-white/[0.05]">
          {pickerError && (
            <div className="p-4 text-xs text-[#FCA5A5] bg-[#2A1216]/60">{pickerError}</div>
          )}

          {sourceTab === 'device-picker' && !isLiveMode && !isPickedVirtualMode ? (
            <div className="py-12 px-6 text-center space-y-3">
              <FolderOpen className="h-7 w-7 text-[#6B7280] mx-auto" />
              <div className="space-y-1">
                <p className="text-xs font-medium text-white">
                  Browse a local folder on {deviceName}
                </p>
                <p className="text-[11px] text-[#8B92A2] max-w-md mx-auto">
                  Click &ldquo;Choose Folder from Device...&rdquo; to open your system folder
                  picker. Once chosen, you can see audio counts per subfolder, hide 0-audio folders,
                  and select the exact local folder to mirror.
                </p>
              </div>
              <button
                type="button"
                onClick={handleBrowseFromDevice}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.12] hover:bg-[#232834] transition-colors"
              >
                <FolderOpen className="h-3.5 w-3.5 text-[#FF1F3D]" />
                <span>Open System Folder Picker</span>
              </button>
            </div>
          ) : isLiveMode ? (
            loadingLiveDir ? (
              <div className="py-12 flex items-center justify-center gap-2 text-xs text-[#8B92A2]">
                <Loader2 className="h-4 w-4 animate-spin text-[#FF1F3D]" />
                <span>Reading local directory...</span>
              </div>
            ) : filteredLiveSubdirs.length === 0 ? (
              <div className="py-10 px-4 text-center space-y-2">
                <Folder className="h-5 w-5 text-[#525866] mx-auto" />
                <p className="text-xs text-[#9CA3AF]">
                  {hideZeroAudio && hiddenZeroLiveCount > 0
                    ? `All ${hiddenZeroLiveCount} subfolder${hiddenZeroLiveCount === 1 ? '' : 's'} here have 0 audio files.`
                    : `No subfolders inside ${liveBreadcrumbs[liveBreadcrumbs.length - 1]?.path}`}
                </p>
                {hideZeroAudio && hiddenZeroLiveCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setHideZeroAudio(false)}
                    className="px-3 py-1.5 rounded text-xs text-white bg-[#1B1F28] border border-white/[0.1] hover:bg-[#232834]"
                  >
                    Show 0-audio folders
                  </button>
                ) : (
                  <p className="text-[11px] text-[#6B7280]">
                    {liveDirectAudioCount > 0
                      ? `${liveDirectAudioCount.toLocaleString()} audio file${liveDirectAudioCount === 1 ? '' : 's'} detected in this folder. Click "Select Local Folder" below to map it.`
                      : 'Click "Select Local Folder" below to bind this directory.'}
                  </p>
                )}
              </div>
            ) : (
              filteredLiveSubdirs.map((subdir) => {
                const isSelected = highlightedPath === subdir.path;
                const countInfo = liveSubdirCounts[subdir.path];
                return (
                  <div
                    key={subdir.path}
                    onClick={() => {
                      const next = isSelected ? null : subdir.path;
                      setHighlightedPath(next);
                      setManualPathDraft(
                        next ?? liveBreadcrumbs[liveBreadcrumbs.length - 1]?.path ?? ''
                      );
                    }}
                    onDoubleClick={() => handleOpenLiveSubdir(subdir)}
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
                      <span className="text-xs font-medium text-white truncate">{subdir.name}</span>
                      {isSelected && <Check className="h-3.5 w-3.5 text-[#FF1F3D] shrink-0" />}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
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
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-mono tabular-nums ${
                          !countInfo
                            ? 'text-[#525866]'
                            : countInfo.count > 0
                              ? 'text-[#22C55E]'
                              : 'text-[#6B7280]'
                        }`}
                      >
                        {(!countInfo || !countInfo.done) && (
                          <Loader2 className="h-2.5 w-2.5 animate-spin text-[#8B92A2]" />
                        )}
                        {!countInfo
                          ? ''
                          : `${countInfo.count.toLocaleString()}${countInfo.capped || !countInfo.done ? '+' : ''} audio`}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenLiveSubdir(subdir);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#9CA3AF] hover:text-white hover:bg-white/[0.08] transition-colors shrink-0"
                      >
                        <span>Open</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )
          ) : virtualChildren.length === 0 ? (
            <div className="py-10 px-4 text-center space-y-2">
              <Folder className="h-5 w-5 text-[#525866] mx-auto" />
              <p className="text-xs text-[#9CA3AF]">
                {hideZeroAudio && hiddenZeroVirtualCount > 0
                  ? `All ${hiddenZeroVirtualCount} subfolder${hiddenZeroVirtualCount === 1 ? '' : 's'} here have 0 audio files.`
                  : sourceTab === 'scanned-library' && !hasScannedFolders
                    ? 'No local folders have been scanned yet. Click "Choose Folder from Device..." above.'
                    : activeVirtualPath
                      ? `No deeper subfolders inside "${activeVirtualPath}".`
                      : 'No matching subfolders found.'}
              </p>
              {hideZeroAudio && hiddenZeroVirtualCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setHideZeroAudio(false)}
                  className="px-3 py-1.5 rounded text-xs text-white bg-[#1B1F28] border border-white/[0.1] hover:bg-[#232834]"
                >
                  Show 0-audio folders
                </button>
              ) : (
                currentVirtualNode &&
                currentVirtualNode.audioCount > 0 && (
                  <p className="text-[11px] font-mono text-[#22C55E]">
                    {currentVirtualNode.audioCount.toLocaleString()} audio file
                    {currentVirtualNode.audioCount === 1 ? '' : 's'} in this folder
                  </p>
                )
              )}
            </div>
          ) : (
            virtualChildren.map((node) => {
              const isSelected = highlightedPath === node.path;
              const hasNested = node.children.size > 0;
              return (
                <div
                  key={node.path}
                  onClick={() => {
                    const next = isSelected ? null : node.path;
                    setHighlightedPath(next);
                    setManualPathDraft(next ?? activeVirtualPath);
                  }}
                  onDoubleClick={() => {
                    if (hasNested) handleOpenVirtualNode(node);
                  }}
                  className={`px-4 py-2.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#FF1F3D]/15' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <Folder
                      className={`h-4 w-4 shrink-0 ${
                        isSelected
                          ? 'text-[#FF1F3D]'
                          : node.audioCount > 0
                            ? 'text-[#22C55E]'
                            : 'text-[#9CA3AF]'
                      }`}
                    />
                    <span className="text-xs font-medium text-white truncate">{node.name}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-[#FF1F3D] shrink-0" />}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`text-[11px] font-mono tabular-nums ${
                        node.subfolderCount > 0 ? 'text-[#9CA3AF]' : 'text-[#525866]'
                      }`}
                      title="Subfolders inside this folder"
                    >
                      {node.subfolderCount.toLocaleString()}{' '}
                      {node.subfolderCount === 1 ? 'folder' : 'folders'}
                    </span>
                    <span
                      className={`text-[11px] font-mono tabular-nums ${
                        node.audioCount > 0 ? 'text-[#22C55E]' : 'text-[#6B7280]'
                      }`}
                    >
                      {node.audioCount.toLocaleString()} audio
                    </span>
                    {hasNested && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenVirtualNode(node);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#9CA3AF] hover:text-white hover:bg-white/[0.08] transition-colors"
                      >
                        <span>Open</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Selected Path Preview + Optional Auto-Scan + Footer */}
        <div className="px-5 py-3.5 bg-[#0E1015] border-t border-white/[0.08] space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex-1 min-w-0 space-y-1">
              <label
                htmlFor="local-browser-path-preview"
                className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-medium"
              >
                Mapped Local Folder Path on {deviceName}
              </label>
              <input
                id="local-browser-path-preview"
                type="text"
                value={highlightedPath ?? manualPathDraft}
                onChange={(e) => {
                  setHighlightedPath(null);
                  setManualPathDraft(e.target.value);
                }}
                placeholder="Blank = IndexedDB Offline Cache Only"
                className="w-full px-3 py-1.5 rounded bg-[#0B0C0E] border border-white/[0.1] text-xs font-mono text-white placeholder-[#525866] focus:border-[#FF1F3D] focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                onSelectFolder('');
                onClose();
              }}
              title="Use IndexedDB offline cache only with no local folder path"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs text-[#9CA3AF] hover:text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#232834] transition-colors whitespace-nowrap sm:self-end"
            >
              <Database className="h-3.5 w-3.5 text-[#22C55E]" />
              <span>Cache Only</span>
            </button>
          </div>

          {sourceTab === 'device-picker' &&
            onIngestLocalFolderEntries &&
            (isLiveMode || (isPickedVirtualMode && discoveredAudioUnderSelection > 0)) && (
              <label className="inline-flex items-center gap-2 text-xs text-[#D1D5DB] cursor-pointer">
                <input
                  type="checkbox"
                  checked={scanAudioOnSelect}
                  onChange={(e) => setScanAudioOnSelect(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-[#FF1F3D]"
                />
                <span>
                  Also index audio files from this folder into CrateSync Library
                  {discoveredAudioUnderSelection > 0
                    ? ` (${discoveredAudioUnderSelection.toLocaleString()} detected)`
                    : ''}
                </span>
              </label>
            )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isScanningSelection}
              className="px-3.5 py-2 rounded-md text-xs text-[#9CA3AF] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isScanningSelection}
              onClick={() => void handleConfirm()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {isScanningSelection ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              <span>{isScanningSelection ? 'Scanning Folder...' : 'Select Local Folder'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
