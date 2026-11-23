import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowLeft,
  ArrowRight,
  Check,
  Cloud,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Laptop,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type {
  DeviceFolderBinding,
  DriveFolderMapping,
  FolderSyncDirection,
  LocalTrack,
  SyncDeviceProfile,
} from '../types/music';
import type { DriveFolderItem } from '../utils/googleDriveApi';
import { normalizeFolderPath, trackMatchesLocalFolder } from '../utils/folderMappings';
import type { ScannedFileEntry } from '../utils/syncEngine';
import { formatRelativeTime } from '../utils/youtubeLinks';
import {
  DriveFolderBrowserModal,
  type SelectedDriveFolderResult,
} from './DriveFolderBrowserModal';
import { LocalFolderBrowserModal } from './LocalFolderBrowserModal';

interface FolderMappingsPanelProps {
  accessToken: string | null;
  currentDevice: SyncDeviceProfile;
  devices: SyncDeviceProfile[];
  folderMappings: DriveFolderMapping[];
  driveFolders: DriveFolderItem[];
  driveRefreshSignal: number;
  availableLocalFolders: string[];
  tracks: LocalTrack[];
  isMutating: boolean;
  onRenameCurrentDevice: (newName: string) => void;
  onSaveFolderMapping: (params: {
    driveFolderId: string;
    driveFolderName: string;
    binding: DeviceFolderBinding;
  }) => void;
  onUnbindDeviceFromMapping: (mappingId: string, deviceId: string) => void;
  onDeleteFolderMapping: (mappingId: string) => void;
  onRequestCreateDriveFolder: (params: {
    folderName: string;
    parentFolderId: string | null;
    parentFolderLabel: string;
  }) => void;
  onRequestSyncMapping: (mapping: DriveFolderMapping) => void;
  onRequestSyncAllMappings: () => void;
  onDriveAuthError?: (err: unknown) => void;
  onIngestLocalFolderEntries?: (
    entries: ScannedFileEntry[],
    folderRootName: string
  ) => Promise<void> | void;
}

const DIRECTION_OPTIONS: Array<{
  value: FolderSyncDirection;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: 'pull',
    label: 'Pull & Cache (Playing Device)',
    shortLabel: 'Pull from Drive',
    description: 'Drive → This device only',
  },
  {
    value: 'bidirectional',
    label: 'Bidirectional (Sync Both Ways)',
    shortLabel: 'Two-Way Sync',
    description: 'Drive ↔ This device',
  },
  {
    value: 'push',
    label: 'Push to Drive (Source Upload)',
    shortLabel: 'Push to Drive',
    description: 'This device → Drive',
  },
];

function DirectionIcon({ direction }: { direction: FolderSyncDirection }) {
  if (direction === 'pull') {
    return <ArrowRight className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />;
  }
  if (direction === 'push') {
    return <ArrowLeft className="h-3.5 w-3.5 text-[#F59E0B] shrink-0" />;
  }
  return <ArrowLeftRight className="h-3.5 w-3.5 text-[#93C5FD] shrink-0" />;
}

function getDirectionLabel(direction: FolderSyncDirection): string {
  return DIRECTION_OPTIONS.find((opt) => opt.value === direction)?.shortLabel ?? direction;
}

export function FolderMappingsPanel({
  accessToken,
  currentDevice,
  devices,
  folderMappings,
  driveFolders,
  driveRefreshSignal,
  availableLocalFolders,
  tracks,
  isMutating,
  onRenameCurrentDevice,
  onSaveFolderMapping,
  onUnbindDeviceFromMapping,
  onDeleteFolderMapping,
  onRequestCreateDriveFolder,
  onRequestSyncMapping,
  onRequestSyncAllMappings,
  onDriveAuthError,
  onIngestLocalFolderEntries,
}: FolderMappingsPanelProps) {
  // Device rename state
  const [editingDeviceName, setEditingDeviceName] = useState(false);
  const [deviceNameDraft, setDeviceNameDraft] = useState(currentDevice.name);

  // Add new mapping form state
  const [selectedDriveFolder, setSelectedDriveFolder] =
    useState<SelectedDriveFolderResult | null>(null);
  const [localPathDraft, setLocalPathDraft] = useState('');
  const [directionDraft, setDirectionDraft] = useState<FolderSyncDirection>('bidirectional');
  const [autoCacheDraft, setAutoCacheDraft] = useState(true);

  // Create new Drive folder inline helper
  const [creatingDriveFolder, setCreatingDriveFolder] = useState(false);
  const [newDriveFolderName, setNewDriveFolderName] = useState('');

  // Inline edit/bind state for an existing mapping row
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [editLocalPath, setEditLocalPath] = useState('');
  const [editDirection, setEditDirection] = useState<FolderSyncDirection>('pull');
  const [editAutoCache, setEditAutoCache] = useState(true);

  // Folder browser modals
  const [driveBrowserOpen, setDriveBrowserOpen] = useState(false);
  const [localBrowserTarget, setLocalBrowserTarget] = useState<'create' | 'edit' | null>(null);

  const deviceById = useMemo(() => {
    const map = new Map<string, SyncDeviceProfile>();
    for (const dev of devices) map.set(dev.id, dev);
    map.set(currentDevice.id, currentDevice);
    return map;
  }, [devices, currentDevice]);

  const boundMappingsCount = useMemo(
    () => folderMappings.filter((m) => Boolean(m.deviceBindings[currentDevice.id])).length,
    [folderMappings, currentDevice.id]
  );

  const resolvedSelectedDriveFolder = useMemo<SelectedDriveFolderResult | null>(() => {
    if (selectedDriveFolder) return selectedDriveFolder;
    if (driveFolders[0]) {
      return {
        id: driveFolders[0].id,
        name: driveFolders[0].name,
        displayPath: driveFolders[0].name,
      };
    }
    return null;
  }, [driveFolders, selectedDriveFolder]);

  // Include a custom browsed nested Drive folder in the quick select list if it isn't in My Drive root
  const selectDriveOptions = useMemo(() => {
    const list: Array<{ id: string; label: string }> = [
      { id: 'root', label: 'My Drive (Root)' },
      ...driveFolders.map((f) => ({ id: f.id, label: f.name })),
    ];
    if (
      resolvedSelectedDriveFolder &&
      !list.some((item) => item.id === resolvedSelectedDriveFolder.id)
    ) {
      list.unshift({
        id: resolvedSelectedDriveFolder.id,
        label: resolvedSelectedDriveFolder.displayPath,
      });
    }
    return list;
  }, [driveFolders, resolvedSelectedDriveFolder]);

  const handleSaveDeviceName = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = deviceNameDraft.trim();
    if (!cleaned) return;
    onRenameCurrentDevice(cleaned);
    setEditingDeviceName(false);
  };

  const handleCreateMappingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedSelectedDriveFolder) return;

    onSaveFolderMapping({
      driveFolderId: resolvedSelectedDriveFolder.id,
      driveFolderName: resolvedSelectedDriveFolder.displayPath,
      binding: {
        deviceId: currentDevice.id,
        localFolderPath: normalizeFolderPath(localPathDraft),
        syncDirection: directionDraft,
        autoCacheOffline: autoCacheDraft,
        lastSyncedAt: null,
      },
    });
    setLocalPathDraft('');
  };

  const startEditingMapping = (mapping: DriveFolderMapping) => {
    const existing = mapping.deviceBindings[currentDevice.id];
    setEditingMappingId(mapping.id);
    setEditLocalPath(existing?.localFolderPath ?? '');
    setEditDirection(existing?.syncDirection ?? 'pull');
    setEditAutoCache(existing?.autoCacheOffline ?? true);
  };

  const handleSaveInlineEdit = (mapping: DriveFolderMapping) => {
    const existing = mapping.deviceBindings[currentDevice.id];
    onSaveFolderMapping({
      driveFolderId: mapping.driveFolderId,
      driveFolderName: mapping.driveFolderName,
      binding: {
        deviceId: currentDevice.id,
        localFolderPath: normalizeFolderPath(editLocalPath),
        syncDirection: editDirection,
        autoCacheOffline: editAutoCache,
        lastSyncedAt: existing?.lastSyncedAt ?? null,
      },
    });
    setEditingMappingId(null);
  };

  const handleCreateDriveFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newDriveFolderName.trim();
    if (!cleaned) return;
    onRequestCreateDriveFolder({
      folderName: cleaned,
      parentFolderId: 'root',
      parentFolderLabel: 'My Drive',
    });
    setNewDriveFolderName('');
    setCreatingDriveFolder(false);
  };

  return (
    <div className="p-6 space-y-6">
      {/* 1. Device Identity & Registered Playing Devices Strip */}
      <div className="p-4 rounded-md bg-[#0B0C0E] border border-white/[0.08] flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-[#6B7280] font-medium">
            This Playing Device
          </div>
          {editingDeviceName ? (
            <form onSubmit={handleSaveDeviceName} className="flex items-center gap-2">
              <input
                type="text"
                value={deviceNameDraft}
                onChange={(e) => setDeviceNameDraft(e.target.value)}
                placeholder="e.g. Studio MacBook, Living Room iPad"
                autoFocus
                className="px-2.5 py-1 rounded bg-[#12141A] border border-[#FF1F3D] text-xs text-white focus:outline-none w-56"
              />
              <button
                type="submit"
                aria-label="Save device name"
                className="p-1.5 rounded bg-[#FF1F3D] text-white hover:bg-[#E11934] transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeviceNameDraft(currentDevice.name);
                  setEditingDeviceName(false);
                }}
                aria-label="Cancel rename"
                className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <Laptop className="h-4 w-4 text-[#FF1F3D] shrink-0" />
              <span className="text-sm font-medium text-white">{currentDevice.name}</span>
              <span className="text-[11px] font-mono text-[#8B92A2]">
                {currentDevice.platform} · #{currentDevice.id.slice(0, 6)}
              </span>
              <button
                type="button"
                onClick={() => {
                  setDeviceNameDraft(currentDevice.name);
                  setEditingDeviceName(true);
                }}
                title="Rename this playing device"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-[#9CA3AF] hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                <Pencil className="h-3 w-3" />
                <span>Rename</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:items-end gap-1.5">
          <div className="text-[11px] uppercase tracking-wider text-[#6B7280] font-medium">
            Registered Devices ({devices.length || 1})
          </div>
          <div className="text-xs font-mono text-[#9CA3AF] flex flex-wrap items-center gap-x-2 gap-y-1">
            {(devices.length > 0 ? devices : [currentDevice]).map((dev, idx) => (
              <span key={dev.id} className={dev.id === currentDevice.id ? 'text-white' : ''}>
                {idx > 0 ? '· ' : ''}
                {dev.name}
                {dev.id === currentDevice.id ? ' (this device)' : ''}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Add / Update Folder Mapping Form */}
      <div className="p-4 rounded-md bg-[#0E1015] border border-white/[0.08] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-white">
              Map a Google Drive Folder to This Device
            </h3>
            <p className="text-[11px] text-[#8B92A2] mt-0.5">
              Browse My Drive (or Shared with me) and bind each Google Drive music folder to a local
              folder on {currentDevice.name}. Push to Drive to share mappings across all playing
              devices.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreatingDriveFolder((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-[#D1D5DB] hover:text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#232834] transition-colors whitespace-nowrap self-start sm:self-auto"
          >
            <FolderPlus className="h-3.5 w-3.5 text-[#9CA3AF]" />
            <span>New Drive Folder</span>
          </button>
        </div>

        {creatingDriveFolder && (
          <form
            onSubmit={handleCreateDriveFolderSubmit}
            className="p-3 rounded-md bg-[#0B0C0E] border border-white/[0.1] flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
          >
            <input
              type="text"
              value={newDriveFolderName}
              onChange={(e) => setNewDriveFolderName(e.target.value)}
              placeholder="New folder name in My Drive (e.g. FLAC Vinyl Rips)"
              className="flex-1 min-w-0 px-3 py-1.5 rounded bg-[#12141A] border border-white/[0.1] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={!newDriveFolderName.trim() || isMutating}
                className="px-3 py-1.5 rounded text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-45 transition-colors whitespace-nowrap"
              >
                Create in My Drive
              </button>
              <button
                type="button"
                onClick={() => setCreatingDriveFolder(false)}
                className="px-2.5 py-1.5 rounded text-xs text-[#9CA3AF] hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <form onSubmit={handleCreateMappingSubmit} className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Drive Folder Picker + Hierarchical Drive Browser */}
            <div className="space-y-1">
              <label htmlFor="map-drive-folder" className="block text-[11px] text-[#9CA3AF]">
                Google Drive Folder (My Drive)
              </label>
              <div className="flex items-center gap-1.5">
                <select
                  id="map-drive-folder"
                  value={resolvedSelectedDriveFolder?.id ?? ''}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    if (nextId === 'root') {
                      setSelectedDriveFolder({
                        id: 'root',
                        name: 'My Drive',
                        displayPath: 'My Drive',
                      });
                      return;
                    }
                    const match = driveFolders.find((f) => f.id === nextId);
                    if (match) {
                      setSelectedDriveFolder({
                        id: match.id,
                        name: match.name,
                        displayPath: match.name,
                      });
                    }
                  }}
                  className="flex-1 min-w-0 px-3 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-xs text-white focus:border-[#FF1F3D] focus:outline-none"
                >
                  {selectDriveOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setDriveBrowserOpen(true)}
                  title="Browse My Drive subfolders and Shared with me"
                  className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md text-xs font-medium text-[#D1D5DB] hover:text-white bg-[#1B1F28] border border-white/[0.1] hover:bg-[#232834] transition-colors whitespace-nowrap shrink-0"
                >
                  <Cloud className="h-3.5 w-3.5 text-[#FF1F3D]" />
                  <span>Browse</span>
                </button>
              </div>
            </div>

            {/* Local Folder Path on This Device + Local Folder Browser */}
            <div className="space-y-1">
              <label htmlFor="map-local-folder" className="block text-[11px] text-[#9CA3AF]">
                Local Folder on {currentDevice.name}
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="map-local-folder"
                  type="text"
                  list="cratesync-local-folders-list"
                  value={localPathDraft}
                  onChange={(e) => setLocalPathDraft(e.target.value)}
                  placeholder="e.g. Music/FLAC (blank = Cache Only)"
                  className="flex-1 min-w-0 px-3 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-xs font-mono text-white placeholder-[#525866] focus:border-[#FF1F3D] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setLocalBrowserTarget('create')}
                  title="Browse local folders on this device"
                  className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md text-xs font-medium text-[#D1D5DB] hover:text-white bg-[#1B1F28] border border-white/[0.1] hover:bg-[#232834] transition-colors whitespace-nowrap shrink-0"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-[#9CA3AF]" />
                  <span>Browse</span>
                </button>
              </div>
              <datalist id="cratesync-local-folders-list">
                {availableLocalFolders.map((folder) => (
                  <option key={folder} value={folder} />
                ))}
              </datalist>
            </div>

            {/* Sync Direction */}
            <div className="space-y-1">
              <label htmlFor="map-sync-direction" className="block text-[11px] text-[#9CA3AF]">
                Sync Direction
              </label>
              <select
                id="map-sync-direction"
                value={directionDraft}
                onChange={(e) => setDirectionDraft(e.target.value as FolderSyncDirection)}
                className="w-full px-3 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-xs text-white focus:border-[#FF1F3D] focus:outline-none"
              >
                {DIRECTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 text-xs text-[#D1D5DB] cursor-pointer">
              <input
                type="checkbox"
                checked={autoCacheDraft}
                onChange={(e) => setAutoCacheDraft(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-[#FF1F3D]"
              />
              <span>Automatically cache audio files offline on this playing device when syncing</span>
            </label>

            <button
              type="submit"
              disabled={!resolvedSelectedDriveFolder || isMutating}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-45 transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Save Folder Mapping</span>
            </button>
          </div>
        </form>
      </div>

      {/* 3. Active Cross-Device Folder Mappings List */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-medium text-[#D1D5DB]">
            Cross-Device Folder Mappings ({folderMappings.length})
          </div>
          {boundMappingsCount > 0 && (
            <button
              type="button"
              disabled={isMutating}
              onClick={onRequestSyncAllMappings}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.1] hover:bg-[#232834] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isMutating ? 'animate-spin' : ''}`} />
              <span>Sync All Mapped Folders ({boundMappingsCount})</span>
            </button>
          )}
        </div>

        {folderMappings.length === 0 ? (
          <div className="py-8 px-4 rounded-md border border-dashed border-white/[0.1] bg-[#0B0C0E] text-center space-y-1.5">
            <FolderOpen className="h-4 w-4 text-[#6B7280] mx-auto" />
            <p className="text-xs text-[#9CA3AF]">
              No cross-device folder mappings configured yet.
            </p>
            <p className="text-[11px] text-[#6B7280] max-w-md mx-auto">
              Browse My Drive and a local folder above so desktop machines push organized local
              folders into Drive and mobile/living-room playing devices pull &amp; cache them to
              their own paths.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {folderMappings.map((mapping) => {
              const thisBinding = mapping.deviceBindings[currentDevice.id] ?? null;
              const otherBindings = Object.values(mapping.deviceBindings).filter(
                (b) => b.deviceId !== currentDevice.id
              );
              const isEditing = editingMappingId === mapping.id;

              const matchedLocalTracks = thisBinding?.localFolderPath
                ? tracks.filter((t) => trackMatchesLocalFolder(t, thisBinding.localFolderPath))
                : tracks.filter(
                    (t) =>
                      t.drivePath?.toLowerCase() === mapping.driveFolderName.toLowerCase() ||
                      t.drivePath
                        ?.toLowerCase()
                        .startsWith(`${mapping.driveFolderName.toLowerCase()}/`)
                  );
              const matchedLocalTrackCount = matchedLocalTracks.length;
              const syncedInMappingCount = matchedLocalTracks.filter((t) =>
                Boolean(t.driveFileId)
              ).length;

              return (
                <div
                  key={mapping.id}
                  className="rounded-md bg-[#0B0C0E] border border-white/[0.08] overflow-hidden"
                >
                  {/* Mapping Row Header */}
                  <div className="p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 min-w-0 flex-1">
                      {/* Source-of-Truth Drive Folder */}
                      <div className="flex items-center gap-2 min-w-0">
                        <Cloud className="h-4 w-4 text-[#FF1F3D] shrink-0" />
                        <span className="text-xs font-semibold text-white truncate">
                          {mapping.driveFolderName}
                        </span>
                      </div>

                      {thisBinding ? (
                        <>
                          <div className="hidden sm:flex items-center gap-1 text-[#6B7280] shrink-0">
                            <DirectionIcon direction={thisBinding.syncDirection} />
                          </div>

                          {/* Local Folder on This Device */}
                          <div className="flex items-center gap-2 min-w-0">
                            <HardDrive className="h-3.5 w-3.5 text-[#9CA3AF] shrink-0" />
                            <span className="text-xs font-mono text-[#E5E7EB] truncate">
                              {thisBinding.localFolderPath || 'IndexedDB Offline Cache'}
                            </span>
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-[#F59E0B]">
                          Not mapped on {currentDevice.name} yet
                        </span>
                      )}
                    </div>

                    {/* Row Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {thisBinding ? (
                        <button
                          type="button"
                          disabled={isMutating}
                          onClick={() => onRequestSyncMapping(mapping)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#FF1F3D] hover:border-[#FF1F3D] disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          <RefreshCw className="h-3 w-3" />
                          <span>Sync Folder</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEditingMapping(mapping)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#0B0C0E] bg-[#F59E0B] hover:bg-[#D97706] transition-colors whitespace-nowrap"
                        >
                          <Plus className="h-3 w-3" />
                          <span>Bind on This Device</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          isEditing ? setEditingMappingId(null) : startEditingMapping(mapping)
                        }
                        title="Edit folder mapping on this device"
                        className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          thisBinding && otherBindings.length > 0
                            ? onUnbindDeviceFromMapping(mapping.id, currentDevice.id)
                            : onDeleteFolderMapping(mapping.id)
                        }
                        title={
                          thisBinding && otherBindings.length > 0
                            ? 'Unbind this device (keeps other devices mapped)'
                            : 'Delete folder mapping'
                        }
                        aria-label={`Remove mapping for ${mapping.driveFolderName}`}
                        className="p-1.5 rounded text-[#8B92A2] hover:text-[#FCA5A5] hover:bg-[#2A1216] transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Metadata Summary Bar */}
                  {thisBinding && !isEditing && (
                    <div className="px-4 py-2 bg-[#101319] border-t border-white/[0.05] flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono tabular-nums text-[#8B92A2]">
                      <span>{getDirectionLabel(thisBinding.syncDirection)}</span>
                      <span>
                        · Auto-cache:{' '}
                        <span
                          className={
                            thisBinding.autoCacheOffline ? 'text-[#22C55E]' : 'text-[#6B7280]'
                          }
                        >
                          {thisBinding.autoCacheOffline ? 'ON' : 'OFF'}
                        </span>
                      </span>
                      <span>
                        · {matchedLocalTrackCount.toLocaleString()} local song
                        {matchedLocalTrackCount === 1 ? '' : 's'}
                        {syncedInMappingCount > 0
                          ? ` (${syncedInMappingCount.toLocaleString()} synced)`
                          : ''}
                      </span>
                      <span>· Last synced: {formatRelativeTime(thisBinding.lastSyncedAt)}</span>
                    </div>
                  )}

                  {/* Inline Edit / Bind Form */}
                  {isEditing && (
                    <div className="p-4 bg-[#101319] border-t border-white/[0.08] space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="block text-[11px] text-[#9CA3AF]">
                            Local Folder Path on {currentDevice.name}
                          </label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              list="cratesync-local-folders-list"
                              value={editLocalPath}
                              onChange={(e) => setEditLocalPath(e.target.value)}
                              placeholder="Blank = IndexedDB Offline Cache Only"
                              className="flex-1 min-w-0 px-3 py-1.5 rounded bg-[#0B0C0E] border border-white/[0.12] text-xs font-mono text-white placeholder-[#525866] focus:border-[#FF1F3D] focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => setLocalBrowserTarget('edit')}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#D1D5DB] hover:text-white bg-[#1B1F28] border border-white/[0.1] hover:bg-[#232834] transition-colors whitespace-nowrap shrink-0"
                            >
                              <FolderOpen className="h-3.5 w-3.5 text-[#9CA3AF]" />
                              <span>Browse</span>
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] text-[#9CA3AF]">Sync Direction</label>
                          <select
                            value={editDirection}
                            onChange={(e) =>
                              setEditDirection(e.target.value as FolderSyncDirection)
                            }
                            className="w-full px-3 py-1.5 rounded bg-[#0B0C0E] border border-white/[0.12] text-xs text-white focus:border-[#FF1F3D] focus:outline-none"
                          >
                            {DIRECTION_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <label className="inline-flex items-center gap-2 text-xs text-[#D1D5DB] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editAutoCache}
                            onChange={(e) => setEditAutoCache(e.target.checked)}
                            className="h-3.5 w-3.5 rounded accent-[#FF1F3D]"
                          />
                          <span>Auto-cache offline audio on this device</span>
                        </label>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingMappingId(null)}
                            className="px-3 py-1.5 rounded text-xs text-[#9CA3AF] hover:text-white transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveInlineEdit(mapping)}
                            className="px-3.5 py-1.5 rounded text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors"
                          >
                            Save Binding
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Other Devices Mapped to This Exact Drive Folder */}
                  {otherBindings.length > 0 && (
                    <div className="px-4 py-2.5 bg-[#0D1016] border-t border-white/[0.06] space-y-1.5">
                      <div className="text-[10px] uppercase tracking-wider text-[#6B7280] font-medium">
                        Mapped on Other Devices
                      </div>
                      <div className="space-y-1">
                        {otherBindings.map((binding) => {
                          const dev = deviceById.get(binding.deviceId);
                          return (
                            <div
                              key={binding.deviceId}
                              className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#9CA3AF]"
                            >
                              <span className="flex items-center gap-1.5 text-[#D1D5DB]">
                                <Laptop className="h-3 w-3 text-[#6B7280] shrink-0" />
                                <span>{dev?.name ?? `Device #${binding.deviceId.slice(0, 6)}`}</span>
                                {dev?.platform && (
                                  <span className="text-[#6B7280]">({dev.platform})</span>
                                )}
                              </span>
                              <span className="truncate">
                                → {binding.localFolderPath || 'Offline Cache'} ·{' '}
                                {getDirectionLabel(binding.syncDirection)}
                                {binding.autoCacheOffline ? ' · Auto-cache' : ''}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hierarchical Google Drive Folder Browser Modal */}
      <DriveFolderBrowserModal
        open={driveBrowserOpen}
        accessToken={accessToken}
        title="Select Google Drive Folder to Map"
        subtitle="Browse your My Drive hierarchy, Shared with me, or search across Drive."
        isMutating={isMutating}
        refreshSignal={driveRefreshSignal}
        onClose={() => setDriveBrowserOpen(false)}
        onSelectFolder={(result) => setSelectedDriveFolder(result)}
        onRequestCreateDriveFolder={onRequestCreateDriveFolder}
        onAuthError={onDriveAuthError}
      />

      {/* Local Device Folder Browser Modal */}
      <LocalFolderBrowserModal
        open={localBrowserTarget !== null}
        deviceName={currentDevice.name}
        initialPath={localBrowserTarget === 'edit' ? editLocalPath : localPathDraft}
        availableLocalFolders={availableLocalFolders}
        tracks={tracks}
        onClose={() => setLocalBrowserTarget(null)}
        onSelectFolder={(path) => {
          if (localBrowserTarget === 'edit') {
            setEditLocalPath(path);
          } else {
            setLocalPathDraft(path);
          }
        }}
        onIngestLocalFolderEntries={onIngestLocalFolderEntries}
      />
    </div>
  );
}
