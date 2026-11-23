import type {
  DeviceFolderBinding,
  DriveFolderMapping,
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
  preferRemoteForConflicts = true
): DriveFolderMapping[] {
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
