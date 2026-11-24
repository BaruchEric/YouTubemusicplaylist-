import type {
  DeviceFolderBinding,
  DriveFolderMapping,
  FolderMappingTombstone,
  LocalTrack,
  SyncDeviceProfile,
} from '../types/music';

const DEVICE_PROFILE_STORAGE_KEY = 'cratesync_device_profile_v1';

export function detectDevicePlatform(): string {
  if (typeof navigator === 'undefined') return 'Web Player';
  const ua = navigator.userAgent || '';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Web Player';
}

export function getOrCreateCurrentDeviceProfile(): SyncDeviceProfile {
  const platform = detectDevicePlatform();
  const now = Date.now();

  try {
    const raw = window.localStorage.getItem(DEVICE_PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SyncDeviceProfile>;
      if (parsed && typeof parsed.id === 'string' && parsed.id.trim()) {
        const refreshed: SyncDeviceProfile = {
          id: parsed.id,
          name:
            typeof parsed.name === 'string' && parsed.name.trim()
              ? parsed.name.trim()
              : `${platform} Player`,
          platform: parsed.platform || platform,
          lastSeenAt: now,
        };
        window.localStorage.setItem(DEVICE_PROFILE_STORAGE_KEY, JSON.stringify(refreshed));
        return refreshed;
      }
    }
  } catch {
    // Fall back to generating a fresh profile
  }

  const created: SyncDeviceProfile = {
    id:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `dev-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${platform} Player`,
    platform,
    lastSeenAt: now,
  };

  try {
    window.localStorage.setItem(DEVICE_PROFILE_STORAGE_KEY, JSON.stringify(created));
  } catch {
    // Ignore storage quota restrictions
  }

  return created;
}

export function saveCurrentDeviceProfile(profile: SyncDeviceProfile): SyncDeviceProfile {
  const cleaned: SyncDeviceProfile = {
    ...profile,
    name: profile.name.trim() || `${profile.platform} Player`,
    lastSeenAt: Date.now(),
  };
  try {
    window.localStorage.setItem(DEVICE_PROFILE_STORAGE_KEY, JSON.stringify(cleaned));
  } catch {
    // Ignore
  }
  return cleaned;
}

/**
 * Normalizes local folder paths across Windows/macOS/Linux/mobile devices
 * (converts backslashes to forward slashes and strips leading/trailing slashes).
 */
export function normalizeFolderPath(rawPath: string): string {
  return rawPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
}

/**
 * Checks whether a local track lives inside a device's mapped local folder path.
 */
export function trackMatchesLocalFolder(track: LocalTrack, localFolderPath: string): boolean {
  const normalizedTarget = normalizeFolderPath(localFolderPath).toLowerCase();
  if (!normalizedTarget) return false;

  const trackFolder = normalizeFolderPath(track.folderName || '').toLowerCase();
  const trackRel = normalizeFolderPath(track.relativePath || '').toLowerCase();

  if (trackFolder === normalizedTarget) return true;
  if (trackRel === normalizedTarget) return true;
  if (trackRel.startsWith(`${normalizedTarget}/`)) return true;

  // Also match trailing folder segment when user bound a nested path like "Music/FLAC" to scanned folder "FLAC"
  const lastSegment = normalizedTarget.split('/').pop() || '';
  if (lastSegment && trackFolder === lastSegment) return true;

  return false;
}

/**
 * Translates a Google Drive song's relative path onto a specific playing device's mapped local folder.
 */
export function translateRelativePathForDevice(
  fileName: string,
  localFolderPath: string,
  fallbackDriveFolderName: string
): { folderName: string; relativePath: string } {
  const normalizedLocal = normalizeFolderPath(localFolderPath);
  if (normalizedLocal) {
    const leafFolder = normalizedLocal.split('/').pop() || normalizedLocal;
    return {
      folderName: leafFolder,
      relativePath: `${normalizedLocal}/${fileName}`,
    };
  }
  const cleanDrive = normalizeFolderPath(fallbackDriveFolderName) || 'Google Drive';
  return {
    folderName: cleanDrive,
    relativePath: `${cleanDrive}/${fileName}`,
  };
}

/**
 * Finds the mapped Google Drive destination folder for a local track on the current device
 * (used when pushing local songs to Google Drive so files land in their mapped Drive folder).
 */
export function resolveDriveMappingForLocalTrack(
  track: LocalTrack,
  mappings: DriveFolderMapping[],
  deviceId: string
): { mapping: DriveFolderMapping; binding: DeviceFolderBinding } | null {
  let bestMatch: { mapping: DriveFolderMapping; binding: DeviceFolderBinding; specificity: number } | null =
    null;

  for (const mapping of mappings) {
    const binding = mapping.deviceBindings[deviceId];
    if (!binding) continue;
    if (binding.syncDirection === 'pull') continue;
    if (!binding.localFolderPath) continue;

    if (trackMatchesLocalFolder(track, binding.localFolderPath)) {
      const specificity = normalizeFolderPath(binding.localFolderPath).length;
      if (!bestMatch || specificity > bestMatch.specificity) {
        bestMatch = { mapping, binding, specificity };
      }
    }
  }

  return bestMatch ? { mapping: bestMatch.mapping, binding: bestMatch.binding } : null;
}

/**
 * Finds this playing device's local folder binding for a given Google Drive folder ID.
 */
export function resolveLocalBindingForDriveFolder(
  driveFolderId: string,
  mappings: DriveFolderMapping[],
  deviceId: string
): { mapping: DriveFolderMapping; binding: DeviceFolderBinding } | null {
  const mapping = mappings.find((m) => m.driveFolderId === driveFolderId);
  if (!mapping) return null;
  const binding = mapping.deviceBindings[deviceId];
  if (!binding) return null;
  return { mapping, binding };
}

/**
 * Merges synced device registries across multiple playing devices.
 */
export function mergeDeviceProfiles(
  localDevices: SyncDeviceProfile[],
  remoteDevices: SyncDeviceProfile[],
  currentDevice: SyncDeviceProfile
): SyncDeviceProfile[] {
  const byId = new Map<string, SyncDeviceProfile>();

  for (const dev of remoteDevices) {
    if (dev && dev.id) byId.set(dev.id, dev);
  }
  for (const dev of localDevices) {
    if (!dev || !dev.id) continue;
    const prev = byId.get(dev.id);
    if (!prev || dev.lastSeenAt >= prev.lastSeenAt) {
      byId.set(dev.id, dev);
    }
  }
  byId.set(currentDevice.id, currentDevice);

  return Array.from(byId.values()).sort((a, b) => {
    if (a.id === currentDevice.id) return -1;
    if (b.id === currentDevice.id) return 1;
    return b.lastSeenAt - a.lastSeenAt;
  });
}

/**
 * Merges DriveFolderMappings across devices keyed by driveFolderId,
 * preserving each device's independent local folder binding.
 */
export function mergeFolderMappings(
  localMappings: DriveFolderMapping[],
  remoteMappings: DriveFolderMapping[],
  preferRemoteForConflicts = true,
  /**
   * This device's id. Only a device writes its own binding, so the local copy is never older
   * than the one in a Drive manifest; keep it instead of letting the manifest revert it.
   */
  localDeviceId?: string
): DriveFolderMapping[] {
  const localBindingsByFolder = new Map<string, DeviceFolderBinding>();
  if (localDeviceId) {
    for (const m of localMappings) {
      const own = m?.deviceBindings?.[localDeviceId];
      if (m?.driveFolderId && own) localBindingsByFolder.set(m.driveFolderId, own);
    }
  }

  const byDriveFolderId = new Map<string, DriveFolderMapping>();

  const seedList = preferRemoteForConflicts ? localMappings : remoteMappings;
  const overlayList = preferRemoteForConflicts ? remoteMappings : localMappings;

  for (const m of seedList) {
    if (!m || !m.driveFolderId) continue;
    byDriveFolderId.set(m.driveFolderId, {
      ...m,
      deviceBindings: { ...(m.deviceBindings ?? {}) },
    });
  }

  for (const incoming of overlayList) {
    if (!incoming || !incoming.driveFolderId) continue;
    const existing = byDriveFolderId.get(incoming.driveFolderId);
    if (!existing) {
      byDriveFolderId.set(incoming.driveFolderId, {
        ...incoming,
        deviceBindings: { ...(incoming.deviceBindings ?? {}) },
      });
    } else {
      const mergedBindings: Record<string, DeviceFolderBinding> = {
        ...existing.deviceBindings,
      };
      for (const [devId, binding] of Object.entries(incoming.deviceBindings ?? {})) {
        const prevBinding = mergedBindings[devId];
        if (devId === localDeviceId && localBindingsByFolder.has(incoming.driveFolderId)) {
          mergedBindings[devId] = localBindingsByFolder.get(incoming.driveFolderId)!;
          continue;
        }
        if (
          !prevBinding ||
          preferRemoteForConflicts ||
          (binding.lastSyncedAt ?? 0) >= (prevBinding.lastSyncedAt ?? 0)
        ) {
          mergedBindings[devId] = binding;
        }
      }
      byDriveFolderId.set(incoming.driveFolderId, {
        ...existing,
        driveFolderName: incoming.driveFolderName || existing.driveFolderName,
        updatedAt: Math.max(existing.updatedAt || 0, incoming.updatedAt || 0),
        deviceBindings: mergedBindings,
      });
    }
  }

  return Array.from(byDriveFolderId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

// A device offline for longer than this can bring a deleted mapping back. Tombstones are a few
// dozen bytes each, so a year costs nothing and covers any realistic gap between syncs.
const TOMBSTONE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function tombstoneKey(driveFolderId: string, deviceId?: string): string {
  return `${driveFolderId}::${deviceId ?? '*'}`;
}

function isTombstone(value: unknown): value is FolderMappingTombstone {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.driveFolderId === 'string' &&
    t.driveFolderId.length > 0 &&
    typeof t.deletedAt === 'number' &&
    Number.isFinite(t.deletedAt) &&
    (t.deviceId === undefined || (typeof t.deviceId === 'string' && t.deviceId.length > 0))
  );
}

/**
 * Unions tombstone lists, keeping the latest deletion per mapping or per binding. Drops
 * malformed entries (they may come from a hand-edited or older manifest) and expired ones.
 */
export function mergeFolderMappingTombstones(
  lists: ReadonlyArray<ReadonlyArray<unknown> | undefined>,
  now = Date.now()
): FolderMappingTombstone[] {
  const byKey = new Map<string, FolderMappingTombstone>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!isTombstone(raw)) continue;
      if (now - raw.deletedAt > TOMBSTONE_TTL_MS) continue;
      const key = tombstoneKey(raw.driveFolderId, raw.deviceId);
      const prev = byKey.get(key);
      if (!prev || raw.deletedAt > prev.deletedAt) {
        byKey.set(
          key,
          raw.deviceId
            ? { driveFolderId: raw.driveFolderId, deviceId: raw.deviceId, deletedAt: raw.deletedAt }
            : { driveFolderId: raw.driveFolderId, deletedAt: raw.deletedAt }
        );
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.deletedAt - a.deletedAt);
}

/**
 * Removes every binding a tombstone covers and every mapping left with no bindings.
 *
 * Each binding is judged by its own updatedAt, never by the mapping's updatedAt: any device
 * bumps the mapping's updatedAt when it marks a sync, so a stale device syncing after the
 * delete would otherwise bring the mapping back. A binding saved after the tombstone survives,
 * which is how re-creating a deleted mapping works.
 */
export function applyFolderMappingTombstones(
  mappings: DriveFolderMapping[],
  tombstones: FolderMappingTombstone[]
): DriveFolderMapping[] {
  if (tombstones.length === 0) return mappings;
  const deletedAt = new Map<string, number>();
  for (const t of tombstones) {
    deletedAt.set(tombstoneKey(t.driveFolderId, t.deviceId), t.deletedAt);
  }

  const result: DriveFolderMapping[] = [];
  for (const mapping of mappings) {
    const wholeDeletedAt = deletedAt.get(tombstoneKey(mapping.driveFolderId));
    const kept: Record<string, DeviceFolderBinding> = {};
    let removedAny = false;
    for (const [deviceId, binding] of Object.entries(mapping.deviceBindings ?? {})) {
      const bindingTime = binding.updatedAt ?? 0;
      const bindingDeletedAt = deletedAt.get(tombstoneKey(mapping.driveFolderId, deviceId));
      const covered =
        (wholeDeletedAt !== undefined && bindingTime <= wholeDeletedAt) ||
        (bindingDeletedAt !== undefined && bindingTime <= bindingDeletedAt);
      if (covered) {
        removedAny = true;
      } else {
        kept[deviceId] = binding;
      }
    }
    if (Object.keys(kept).length === 0) continue;
    result.push(removedAny ? { ...mapping, deviceBindings: kept } : mapping);
  }
  return result;
}

export interface FolderMappingState {
  folderMappings: DriveFolderMapping[];
  folderMappingTombstones: FolderMappingTombstone[];
}

/** What a push writes to the Drive manifest for devices and folder mappings. */
export interface ManifestFolderState extends FolderMappingState {
  devices: SyncDeviceProfile[];
}

/**
 * Merges this device's folder mappings with a copy from Drive or a backup: unions the
 * tombstones, merges the mappings (keeping this device's own bindings), then applies the
 * tombstones so neither side can bring back what the other deleted.
 */
export function mergeFolderMappingState(
  local: FolderMappingState,
  remote: { folderMappings?: unknown; folderMappingTombstones?: unknown },
  localDeviceId: string,
  now = Date.now()
): FolderMappingState {
  const remoteMappings = Array.isArray(remote.folderMappings)
    ? (remote.folderMappings as DriveFolderMapping[])
    : [];
  const remoteTombstones = Array.isArray(remote.folderMappingTombstones)
    ? remote.folderMappingTombstones
    : [];
  const tombstones = mergeFolderMappingTombstones(
    [local.folderMappingTombstones, remoteTombstones],
    now
  );
  const merged = mergeFolderMappings(local.folderMappings, remoteMappings, true, localDeviceId);
  return {
    folderMappings: applyFolderMappingTombstones(merged, tombstones),
    folderMappingTombstones: tombstones,
  };
}
