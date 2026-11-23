import type {
  DriveFolderMapping,
  LocalTrack,
  Playlist,
  SmartPlaylist,
  SyncDeviceProfile,
  SyncEvent,
} from '../types/music';

const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files';

export const CRATESYNC_DRIVE_FOLDER_NAME = 'CrateSync Library';
export const CRATESYNC_CANONICAL_MANIFEST_NAME = 'cratesync-source-of-truth.json';

export class DriveApiError extends Error {
  readonly status: number;
  readonly reason: string | null;
  readonly isAuthError: boolean;
  readonly isRateLimit: boolean;

  constructor(message: string, status: number, reason: string | null = null) {
    super(message);
    this.name = 'DriveApiError';
    this.status = status;
    this.reason = reason;
    const normalizedReason = (reason ?? '').toLowerCase();
    this.isRateLimit =
      status === 429 ||
      normalizedReason === 'ratelimitexceeded' ||
      normalizedReason === 'userratelimitexceeded' ||
      normalizedReason === 'sharingratelimitexceeded';
    // Only treat 401 or explicit OAuth scope insufficiency as auth expiry — never 403 rate limits or single-folder permissions
    this.isAuthError =
      status === 401 ||
      (status === 403 &&
        (normalizedReason === 'insufficientpermissions' ||
          normalizedReason === 'autherror' ||
          message.toLowerCase().includes('insufficient authentication scopes')));
  }
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
  webViewLink?: string;
  parents?: string[];
  md5Checksum?: string;
  appProperties?: Record<string, string>;
  /** Full folder path inside Google Drive (e.g. "Music/Daft Punk/Discovery") */
  folderPath?: string;
}

export interface DriveScanProgress {
  scannedFolders: number;
  queuedFolders: number;
  foundAudio: number;
}

export interface DriveFolderItem {
  id: string;
  name: string;
  modifiedTime: string;
  parents?: string[];
  shared?: boolean;
}

export type DriveBrowseScope = 'my-drive' | 'shared-with-me' | 'search';

function sortFoldersAlphabetically(folders: DriveFolderItem[]): DriveFolderItem[] {
  return [...folders].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  );
}

export interface CrateSyncLibraryBackupPayload {
  schemaVersion: 1;
  app: 'CrateSync';
  sourceOfTruth?: 'google-drive';
  backedUpAt: string;
  watchedFolderName: string | null;
  driveMusicFolderId?: string | null;
  driveMusicFolderName?: string | null;
  stats: {
    trackCount: number;
    playlistCount: number;
    smartPlaylistCount: number;
    matchedCount: number;
    driveAudioCount?: number;
  };
  tracks: LocalTrack[];
  playlists: Playlist[];
  smartPlaylists: SmartPlaylist[];
  syncHistory: SyncEvent[];
  devices?: SyncDeviceProfile[];
  folderMappings?: DriveFolderMapping[];
}

async function parseDriveError(res: Response, fallbackMessage: string): Promise<DriveApiError> {
  let detail = fallbackMessage;
  let reason: string | null = null;
  try {
    const body = (await res.json()) as {
      error?: {
        message?: string;
        status?: string;
        errors?: Array<{ reason?: string; message?: string }>;
      };
    };
    if (body?.error?.message) {
      detail = body.error.message;
    }
    if (body?.error?.errors?.[0]?.reason) {
      reason = body.error.errors[0].reason;
    }
  } catch {
    // Keep fallback message
  }
  return new DriveApiError(detail, res.status, reason);
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Performs a Google Drive API fetch with automatic exponential backoff retries
 * for transient rate limits (429 / 403 userRateLimitExceeded) and 5xx responses,
 * preventing large multi-thousand-song scans from failing or tripping auth disconnects.
 */
async function driveFetchWithRetry(
  url: string,
  init: RequestInit,
  fallbackError: string,
  maxRetries = 4
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;

    const cloned = res.clone();
    const err = await parseDriveError(cloned, fallbackError);
    const isTransientServer = res.status >= 500 && res.status < 600;

    if ((err.isRateLimit || isTransientServer) && attempt < maxRetries) {
      const backoffMs = Math.min(8000, 450 * Math.pow(2, attempt) + Math.floor(Math.random() * 250));
      await sleepWithAbort(backoffMs, init.signal ?? undefined);
      continue;
    }

    throw err;
  }

  throw new DriveApiError(fallbackError, 503);
}

function normalizeDriveFile(raw: Record<string, unknown>): DriveFileItem {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? 'Untitled'),
    mimeType: String(raw.mimeType ?? 'application/octet-stream'),
    size: Number(raw.size ?? 0) || 0,
    modifiedTime: String(raw.modifiedTime ?? new Date().toISOString()),
    webViewLink: typeof raw.webViewLink === 'string' ? raw.webViewLink : undefined,
    parents: Array.isArray(raw.parents) ? raw.parents.map(String) : undefined,
    md5Checksum: typeof raw.md5Checksum === 'string' ? raw.md5Checksum : undefined,
    appProperties:
      raw.appProperties && typeof raw.appProperties === 'object'
        ? (raw.appProperties as Record<string, string>)
        : undefined,
  };
}

/**
 * Builds a clean, portable JSON source-of-truth state payload of the CrateSync library.
 * Preserves every track's driveFileId, tags, YouTube matches, play counts, playlists,
 * and smart playlists while stripping oversized inline base64 artwork (> 64KB).
 */
export function buildLibraryBackupPayload(params: {
  tracks: LocalTrack[];
  playlists: Playlist[];
  smartPlaylists: SmartPlaylist[];
  syncHistory: SyncEvent[];
  watchedFolderName: string | null;
  driveMusicFolderId?: string | null;
  driveMusicFolderName?: string | null;
  devices?: SyncDeviceProfile[];
  folderMappings?: DriveFolderMapping[];
}): CrateSyncLibraryBackupPayload {
  const portableTracks: LocalTrack[] = params.tracks.map((track) => ({
    ...track,
    coverArtUrl:
      track.coverArtUrl &&
      track.coverArtUrl.startsWith('data:') &&
      track.coverArtUrl.length > 65_536
        ? null
        : track.coverArtUrl,
  }));

  const matchedCount = portableTracks.filter((t) => Boolean(t.youtubeVideoId)).length;
  const driveAudioCount = portableTracks.filter((t) => Boolean(t.driveFileId)).length;

  return {
    schemaVersion: 1,
    app: 'CrateSync',
    sourceOfTruth: 'google-drive',
    backedUpAt: new Date().toISOString(),
    watchedFolderName: params.watchedFolderName,
    driveMusicFolderId: params.driveMusicFolderId ?? null,
    driveMusicFolderName: params.driveMusicFolderName ?? null,
    stats: {
      trackCount: portableTracks.length,
      playlistCount: params.playlists.length,
      smartPlaylistCount: params.smartPlaylists.length,
      matchedCount,
      driveAudioCount,
    },
    tracks: portableTracks,
    playlists: params.playlists,
    smartPlaylists: params.smartPlaylists,
    syncHistory: params.syncHistory.slice(0, 50),
    devices: params.devices ?? [],
    folderMappings: params.folderMappings ?? [],
  };
}

/**
 * Finds or creates the app-managed "CrateSync Library" folder in Google Drive
 * for storing canonical library state and uploaded songs.
 */
export async function findOrCreateCrateSyncFolder(accessToken: string): Promise<DriveFolderItem> {
  const query =
    "trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='cratesyncType' and value='root-folder' }";
  const searchParams = new URLSearchParams({
    q: query,
    pageSize: '5',
    fields: 'files(id,name,modifiedTime)',
  });

  const searchRes = await fetch(`${DRIVE_FILES_ENDPOINT}?${searchParams.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!searchRes.ok) {
    throw await parseDriveError(searchRes, 'Failed to locate CrateSync folder in Google Drive.');
  }

  const searchData = (await searchRes.json()) as { files?: Array<Record<string, unknown>> };
  if (searchData.files && searchData.files.length > 0) {
    const existing = searchData.files[0];
    return {
      id: String(existing.id ?? ''),
      name: String(existing.name ?? CRATESYNC_DRIVE_FOLDER_NAME),
      modifiedTime: String(existing.modifiedTime ?? new Date().toISOString()),
    };
  }

  const createRes = await fetch(`${DRIVE_FILES_ENDPOINT}?fields=id,name,modifiedTime`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: CRATESYNC_DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: {
        cratesyncType: 'root-folder',
      },
    }),
  });

  if (!createRes.ok) {
    throw await parseDriveError(createRes, 'Failed to create CrateSync folder in Google Drive.');
  }

  const created = (await createRes.json()) as Record<string, unknown>;
  return {
    id: String(created.id ?? ''),
    name: String(created.name ?? CRATESYNC_DRIVE_FOLDER_NAME),
    modifiedTime: String(created.modifiedTime ?? new Date().toISOString()),
  };
}

/**
 * Lists Google Drive folders hierarchically — matching Google Drive's "My Drive" view
 * (defaults to `'root' in parents`, sorted alphabetically by Name), with support for
 * drilling into any parent folder ID, browsing "Shared with me", or searching all Drive folders.
 */
export async function listDriveFoldersInParent(
  accessToken: string,
  options?: {
    scope?: DriveBrowseScope;
    parentId?: string | null;
    searchTerm?: string;
    maxPages?: number;
  }
): Promise<DriveFolderItem[]> {
  const scope = options?.scope ?? 'my-drive';
  const maxPages = options?.maxPages ?? 3;
  const clauses = [
    'trashed = false',
    "mimeType = 'application/vnd.google-apps.folder'",
  ];

  if (scope === 'search' && options?.searchTerm?.trim()) {
    const escaped = options.searchTerm
      .trim()
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'");
    clauses.push(`name contains '${escaped}'`);
  } else if (scope === 'shared-with-me' && !options?.parentId) {
    clauses.push('sharedWithMe = true');
  } else {
    const targetParent = (options?.parentId || 'root').replace(/'/g, "\\'");
    clauses.push(`'${targetParent}' in parents`);
  }

  const allFolders: DriveFolderItem[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      q: clauses.join(' and '),
      orderBy: 'name',
      pageSize: '200',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
      fields: 'nextPageToken,files(id,name,modifiedTime,parents,shared)',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const res = await driveFetchWithRetry(
      `${DRIVE_FILES_ENDPOINT}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      'Failed to list Google Drive folders.'
    );

    const data = (await res.json()) as {
      nextPageToken?: string;
      files?: Array<Record<string, unknown>>;
    };

    for (const f of data.files ?? []) {
      allFolders.push({
        id: String(f.id ?? ''),
        name: String(f.name ?? 'Untitled Folder'),
        modifiedTime: String(f.modifiedTime ?? new Date().toISOString()),
        parents: Array.isArray(f.parents) ? f.parents.map(String) : undefined,
        shared: Boolean(f.shared),
      });
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return sortFoldersAlphabetically(allFolders);
}

/**
 * Lists top-level folders in the user's "My Drive" root sorted alphabetically
 * (matching Google Drive's My Drive view).
 */
export async function listDriveFolders(accessToken: string): Promise<DriveFolderItem[]> {
  return listDriveFoldersInParent(accessToken, {
    scope: 'my-drive',
    parentId: 'root',
    maxPages: 3,
  });
}

export interface DriveFolderAudioCount {
  count: number;
  subfolderCount: number;
  done: boolean;
  capped: boolean;
}

const DRIVE_FOLDER_COUNT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const driveFolderCountCache = new Map<
  string,
  { stats: DriveFolderAudioCount; cachedAt: number }
>();

export function getCachedDriveFolderCount(folderId: string): DriveFolderAudioCount | null {
  const entry = driveFolderCountCache.get(folderId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > DRIVE_FOLDER_COUNT_CACHE_TTL_MS) {
    driveFolderCountCache.delete(folderId);
    return null;
  }
  return entry.stats;
}

export function setCachedDriveFolderCount(folderId: string, stats: DriveFolderAudioCount): void {
  driveFolderCountCache.set(folderId, { stats: { ...stats }, cachedAt: Date.now() });
}

export function deleteCachedDriveFolderCount(folderId: string): void {
  driveFolderCountCache.delete(folderId);
}

export function clearDriveFolderCountsIndex(): void {
  driveFolderCountCache.clear();
}

/**
 * Counts audio files and nested subfolders inside each listed Google Drive folder using the
 * proven `'parentId' in parents` query + `isDriveAudioItem` matching (same engine as `listDriveAudioFiles`).
 *
 * Key optimizations for multi-TB Drives:
 * - Isolates giant 0-audio folders (e.g. Camera / backups / dev repos) quickly so they never stall music folders
 * - Runs per-root DFS so deeply nested trees (e.g. Music/Music/Artist/Album) discover audio in 2-4 calls
 *   and then scan completely (up to depth 10 / 4,000 subfolders, full pagination) to match full scan counts
 * - Rolls up and caches EVERY descendant subfolder when an uncapped root finishes, so drilling into
 *   Music -> Music/Music -> Artist -> Album shows exact counts in 0ms with zero recounting
 */
export async function countAudioInDriveFolders(
  accessToken: string,
  folderIds: string[],
  options?: {
    signal?: AbortSignal;
    maxDepth?: number;
    maxSubfoldersPerMusicRoot?: number;
    maxSubfoldersPerNonAudioRoot?: number;
    maxNonAudioFilesBeforeCap?: number;
    maxDurationMs?: number;
    onUpdate?: (counts: Record<string, DriveFolderAudioCount>) => void;
  }
): Promise<Record<string, DriveFolderAudioCount>> {
  const uniqueRoots = Array.from(new Set(folderIds.filter(Boolean)));
  const stats: Record<string, DriveFolderAudioCount> = {};
  if (uniqueRoots.length === 0) return stats;

  const isSmallList = uniqueRoots.length <= 8;
  const maxDepth = options?.maxDepth ?? 10;
  const maxSubfoldersPerMusicRoot = options?.maxSubfoldersPerMusicRoot ?? 4500;
  const maxSubfoldersPerNonAudioRoot =
    options?.maxSubfoldersPerNonAudioRoot ?? (isSmallList ? 120 : 60);
  const phase1ProbeLimit = Math.min(maxSubfoldersPerNonAudioRoot, isSmallList ? 60 : 32);
  const maxNonAudioFilesBeforeCap =
    options?.maxNonAudioFilesBeforeCap ?? (isSmallList ? 4000 : 2500);
  const maxDurationMs = options?.maxDurationMs ?? (isSmallList ? 45_000 : 60_000);
  const deadlineAt = Date.now() + maxDurationMs;

  const DEPTH0_BATCH_SIZE = 8;
  const PROBE_BATCH_SIZE = 10;
  const SUBDIR_BATCH_SIZE = 18;
  const CONCURRENCY = 4;

  const ownerByFolderId = new Map<string, string>();
  const depthByFolderId = new Map<string, number>();
  const visitedFolders = new Set<string>();
  const queueByRoot = new Map<string, string[]>();
  const inFlightByRoot = new Map<string, number>();
  const enqueuedByRoot = new Map<string, number>();
  const processedByRoot = new Map<string, number>();
  const nonAudioByRoot = new Map<string, number>();

  // Per-folder tree tracking so completed roots automatically cache all descendant subfolders too
  const childrenByFolderId = new Map<string, string[]>();
  const directAudioByFolderId = new Map<string, number>();
  const rolledUpRoots = new Set<string>();
  const timedOutRoots = new Set<string>();

  for (const rootId of uniqueRoots) {
    stats[rootId] = { count: 0, subfolderCount: 0, done: false, capped: false };
    ownerByFolderId.set(rootId, rootId);
    depthByFolderId.set(rootId, 0);
    visitedFolders.add(rootId);
    queueByRoot.set(rootId, []);
    inFlightByRoot.set(rootId, 0);
    enqueuedByRoot.set(rootId, 0);
    processedByRoot.set(rootId, 0);
    nonAudioByRoot.set(rootId, 0);
    childrenByFolderId.set(rootId, []);
    directAudioByFolderId.set(rootId, 0);
  }

  const unstartedDepth0 = [...uniqueRoots];
  const retrySoloDepth0: string[] = [];
  let probeCursor = 0;
  let audioCursor = 0;
  let tailCursor = 0;
  let fatalAuthError: unknown = null;

  const emitSnapshot = () => {
    if (!options?.onUpdate) return;
    const copy: Record<string, DriveFolderAudioCount> = {};
    for (const key of Object.keys(stats)) {
      copy[key] = { ...stats[key] };
    }
    options.onUpdate(copy);
  };

  emitSnapshot();

  // Roll up and cache exact counts for a completed root and (if uncapped) all of its descendant subfolders
  const finalizeAndCacheRoot = (rootId: string) => {
    if (rolledUpRoots.has(rootId)) return;
    rolledUpRoots.add(rootId);

    const rootStats = stats[rootId];
    // Never poison cache with an incomplete result that was cut off by the global deadline
    if (timedOutRoots.has(rootId)) {
      return;
    }

    setCachedDriveFolderCount(rootId, rootStats);

    if (rootStats.capped) {
      // Deliberately capped giant non-audio folder (e.g. Camera / backups) — cache root summary only
      return;
    }

    // Root was scanned 100% completely: post-order rollup caches every single nested subfolder!
    const order: string[] = [];
    const stack: string[] = [rootId];
    const seen = new Set<string>([rootId]);
    while (stack.length > 0) {
      const curr = stack.pop()!;
      order.push(curr);
      const kids = childrenByFolderId.get(curr);
      if (kids) {
        for (const kid of kids) {
          if (!seen.has(kid)) {
            seen.add(kid);
            stack.push(kid);
          }
        }
      }
    }

    const totalAudio = new Map<string, number>();
    const totalSubfolders = new Map<string, number>();
    const now = Date.now();

    for (let i = order.length - 1; i >= 0; i--) {
      const fid = order[i];
      let a = directAudioByFolderId.get(fid) ?? 0;
      let s = 0;
      const kids = childrenByFolderId.get(fid);
      if (kids) {
        for (const kid of kids) {
          a += totalAudio.get(kid) ?? 0;
          s += 1 + (totalSubfolders.get(kid) ?? 0);
        }
      }
      totalAudio.set(fid, a);
      totalSubfolders.set(fid, s);
      driveFolderCountCache.set(fid, {
        stats: { count: a, subfolderCount: s, done: true, capped: false },
        cachedAt: now,
      });
    }
  };

  let activeWorkers = 0;
  let waiters: Array<() => void> = [];

  const wakeWaiters = () => {
    if (waiters.length === 0) return;
    const toWake = waiters;
    waiters = [];
    for (const fn of toWake) fn();
  };

  const waitForWork = () =>
    new Promise<void>((resolve) => {
      waiters.push(resolve);
    });

  const onAbort = () => wakeWaiters();
  options?.signal?.addEventListener('abort', onAbort, { once: true });

  type ScanTask = {
    folderIds: string[];
    singleRootOwner: string | null;
    isDepth0Batch: boolean;
  };

  const checkMarkDone = (rootId: string) => {
    if (
      !unstartedDepth0.includes(rootId) &&
      !retrySoloDepth0.includes(rootId) &&
      (queueByRoot.get(rootId)?.length ?? 0) === 0 &&
      (inFlightByRoot.get(rootId) ?? 0) === 0
    ) {
      stats[rootId].done = true;
      finalizeAndCacheRoot(rootId);
    }
  };

  const pickNextTask = (): ScanTask | null => {
    if (fatalAuthError || options?.signal?.aborted) return null;

    if (Date.now() >= deadlineAt) {
      for (const rootId of unstartedDepth0) timedOutRoots.add(rootId);
      for (const rootId of retrySoloDepth0) timedOutRoots.add(rootId);
      unstartedDepth0.length = 0;
      retrySoloDepth0.length = 0;
      for (const rootId of uniqueRoots) {
        const q = queueByRoot.get(rootId)!;
        if (q.length > 0 || !stats[rootId].done) {
          if (q.length > 0) {
            stats[rootId].capped = true;
            timedOutRoots.add(rootId);
            q.length = 0;
          }
          checkMarkDone(rootId);
        }
      }
      return null;
    }

    if (retrySoloDepth0.length > 0) {
      const soloId = retrySoloDepth0.shift()!;
      return { folderIds: [soloId], singleRootOwner: soloId, isDepth0Batch: false };
    }

    if (unstartedDepth0.length > 0) {
      const batch = unstartedDepth0.splice(0, DEPTH0_BATCH_SIZE);
      return {
        folderIds: batch,
        singleRootOwner: batch.length === 1 ? batch[0] : null,
        isDepth0Batch: batch.length > 1,
      };
    }

    // Phase 1 (Fast Fair Probe): probe EVERY 0-audio root up to 4-5 levels deep (DFS, batch 10)
    // in fair round-robin BEFORE any single audio root (e.g. `books`) can hog workers and starve `Music`!
    for (let offset = 0; offset < uniqueRoots.length; offset++) {
      const idx = (probeCursor + offset) % uniqueRoots.length;
      const rootId = uniqueRoots[idx];
      if (stats[rootId].count > 0) continue;
      const q = queueByRoot.get(rootId)!;
      if (q.length === 0) continue;

      const processed = processedByRoot.get(rootId) ?? 0;
      const nonAudio = nonAudioByRoot.get(rootId) ?? 0;
      if (nonAudio >= maxNonAudioFilesBeforeCap) {
        stats[rootId].capped = true;
        q.length = 0;
        checkMarkDone(rootId);
        continue;
      }
      if (processed >= phase1ProbeLimit) continue;

      probeCursor = (idx + 1) % uniqueRoots.length;
      // Pop from the end (DFS order) so deeply nested Music/Music/Artist/Album discovers audio in 2-4 calls
      const takeCount = Math.min(PROBE_BATCH_SIZE, q.length);
      const batch = q.splice(q.length - takeCount, takeCount);
      processedByRoot.set(rootId, processed + batch.length);
      return { folderIds: batch, singleRootOwner: rootId, isDepth0Batch: false };
    }

    // Phase 2 (Full Audio Expansion): expand every confirmed audio root (`Music`, `books`, etc.)
    // in fair round-robin to reach exact final counts and cache all their descendant subfolders!
    for (let offset = 0; offset < uniqueRoots.length; offset++) {
      const idx = (audioCursor + offset) % uniqueRoots.length;
      const rootId = uniqueRoots[idx];
      if (stats[rootId].count === 0) continue;
      const q = queueByRoot.get(rootId)!;
      if (q.length === 0) continue;

      audioCursor = (idx + 1) % uniqueRoots.length;
      const takeCount = Math.min(SUBDIR_BATCH_SIZE, q.length);
      const batch = q.splice(q.length - takeCount, takeCount);
      processedByRoot.set(rootId, (processedByRoot.get(rootId) ?? 0) + batch.length);
      return { folderIds: batch, singleRootOwner: rootId, isDepth0Batch: false };
    }

    // Phase 3 (Tail Probe): finish confirming remaining 0-audio roots up to maxSubfoldersPerNonAudioRoot
    for (let offset = 0; offset < uniqueRoots.length; offset++) {
      const idx = (tailCursor + offset) % uniqueRoots.length;
      const rootId = uniqueRoots[idx];
      if (stats[rootId].count > 0) continue;
      const q = queueByRoot.get(rootId)!;
      if (q.length === 0) continue;

      const processed = processedByRoot.get(rootId) ?? 0;
      const nonAudio = nonAudioByRoot.get(rootId) ?? 0;
      if (processed >= maxSubfoldersPerNonAudioRoot || nonAudio >= maxNonAudioFilesBeforeCap) {
        stats[rootId].capped = true;
        q.length = 0;
        checkMarkDone(rootId);
        continue;
      }

      tailCursor = (idx + 1) % uniqueRoots.length;
      const takeCount = Math.min(PROBE_BATCH_SIZE, q.length);
      const batch = q.splice(q.length - takeCount, takeCount);
      processedByRoot.set(rootId, processed + batch.length);
      return { folderIds: batch, singleRootOwner: rootId, isDepth0Batch: false };
    }

    return null;
  };

  const worker = async () => {
    while (!options?.signal?.aborted && !fatalAuthError) {
      const task = pickNextTask();
      if (!task) {
        if (activeWorkers === 0) {
          wakeWaiters();
          return;
        }
        await waitForWork();
        continue;
      }

      activeWorkers += 1;
      const touchedRoots = new Set<string>();
      for (const fid of task.folderIds) {
        const owner = ownerByFolderId.get(fid);
        if (owner) {
          touchedRoots.add(owner);
          inFlightByRoot.set(owner, (inFlightByRoot.get(owner) ?? 0) + 1);
        }
      }

      try {
        const parentQuery = task.folderIds
          .map((pid) => `'${pid.replace(/'/g, "\\'")}' in parents`)
          .join(' or ');
        // Proven parent query — identical to listDriveAudioFiles Mode A (no broken mimeType contains)
        const q = `trashed = false and (${parentQuery})`;

        let pageToken: string | undefined;
        let pagesRead = 0;
        const batchNonAudioByRoot = new Map<string, number>();

        do {
          if (options?.signal?.aborted || fatalAuthError || Date.now() >= deadlineAt) {
            if (pageToken) {
              for (const owner of touchedRoots) {
                stats[owner].capped = true;
                if (Date.now() >= deadlineAt) {
                  timedOutRoots.add(owner);
                }
              }
            }
            break;
          }

          const params = new URLSearchParams({
            q,
            pageSize: '1000',
            includeItemsFromAllDrives: 'true',
            supportsAllDrives: 'true',
            fields: 'nextPageToken,files(id,name,mimeType,parents)',
          });
          if (pageToken) {
            params.set('pageToken', pageToken);
          }

          const res = await driveFetchWithRetry(
            `${DRIVE_FILES_ENDPOINT}?${params.toString()}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: options?.signal,
            },
            'Failed to count audio files in Google Drive folders.',
            2
          );

          const data = (await res.json()) as {
            nextPageToken?: string;
            files?: Array<Record<string, unknown>>;
          };

          for (const raw of data.files ?? []) {
            const id = String(raw.id ?? '');
            if (!id) continue;
            const parents = Array.isArray(raw.parents) ? raw.parents.map(String) : [];
            const matchedParent = parents.find((pid) => ownerByFolderId.has(pid));
            if (!matchedParent) continue;
            const rootOwner = ownerByFolderId.get(matchedParent)!;
            const parentDepth = depthByFolderId.get(matchedParent) ?? 0;
            const mime = String(raw.mimeType ?? '');

            if (mime === 'application/vnd.google-apps.folder') {
              if (!visitedFolders.has(id)) {
                visitedFolders.add(id);
                stats[rootOwner].subfolderCount += 1;
                const parentKids = childrenByFolderId.get(matchedParent);
                if (parentKids) {
                  parentKids.push(id);
                } else {
                  childrenByFolderId.set(matchedParent, [id]);
                }

                const enqueued = enqueuedByRoot.get(rootOwner) ?? 0;
                if (parentDepth + 1 < maxDepth && enqueued < maxSubfoldersPerMusicRoot) {
                  ownerByFolderId.set(id, rootOwner);
                  depthByFolderId.set(id, parentDepth + 1);
                  enqueuedByRoot.set(rootOwner, enqueued + 1);
                  childrenByFolderId.set(id, []);
                  directAudioByFolderId.set(id, 0);
                  queueByRoot.get(rootOwner)!.push(id);
                } else {
                  stats[rootOwner].capped = true;
                }
              }
            } else if (isDriveAudioItem(raw)) {
              stats[rootOwner].count += 1;
              directAudioByFolderId.set(
                matchedParent,
                (directAudioByFolderId.get(matchedParent) ?? 0) + 1
              );
            } else {
              nonAudioByRoot.set(rootOwner, (nonAudioByRoot.get(rootOwner) ?? 0) + 1);
              batchNonAudioByRoot.set(rootOwner, (batchNonAudioByRoot.get(rootOwner) ?? 0) + 1);
            }
          }

          pagesRead += 1;
          pageToken = data.nextPageToken;

          // If a shared depth-0 batch hits 2+ pages (e.g. Camera has 50k JPEGs), split it immediately
          // so giant photo/backup folders never block music folders in the same batch!
          if (pageToken && task.isDepth0Batch && pagesRead >= 2) {
            for (const rootId of task.folderIds) {
              const flooded =
                stats[rootId].count === 0 && (batchNonAudioByRoot.get(rootId) ?? 0) >= 800;
              if (flooded) {
                stats[rootId].capped = true;
                queueByRoot.get(rootId)!.length = 0;
              } else {
                // Re-query this root solo so its items aren't cut off by the flooded sibling
                for (const prevKid of childrenByFolderId.get(rootId) ?? []) {
                  visitedFolders.delete(prevKid);
                  ownerByFolderId.delete(prevKid);
                  depthByFolderId.delete(prevKid);
                }
                stats[rootId] = { count: 0, subfolderCount: 0, done: false, capped: false };
                queueByRoot.get(rootId)!.length = 0;
                childrenByFolderId.set(rootId, []);
                directAudioByFolderId.set(rootId, 0);
                enqueuedByRoot.set(rootId, 0);
                nonAudioByRoot.set(rootId, 0);
                retrySoloDepth0.push(rootId);
              }
            }
            break;
          }

          // For single-root batches: stop paginating early ONLY if 0 audio & flooded with non-audio files
          if (pageToken && task.singleRootOwner) {
            const owner = task.singleRootOwner;
            if (
              stats[owner].count === 0 &&
              (nonAudioByRoot.get(owner) ?? 0) >= maxNonAudioFilesBeforeCap &&
              pagesRead >= 2
            ) {
              stats[owner].capped = true;
              queueByRoot.get(owner)!.length = 0;
              break;
            }
          }
        } while (pageToken);

        // Drop remaining queued subdirs for any 0-audio root that exceeded its non-audio threshold
        for (const rootOwner of touchedRoots) {
          if (
            stats[rootOwner].count === 0 &&
            (nonAudioByRoot.get(rootOwner) ?? 0) >= maxNonAudioFilesBeforeCap &&
            queueByRoot.get(rootOwner)!.length > 0
          ) {
            stats[rootOwner].capped = true;
            queueByRoot.get(rootOwner)!.length = 0;
          }
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') {
          return;
        }
        if (err instanceof DriveApiError && err.isAuthError) {
          fatalAuthError = err;
          wakeWaiters();
          return;
        }
        for (const owner of touchedRoots) {
          stats[owner].capped = true;
        }
      } finally {
        for (const fid of task.folderIds) {
          const owner = ownerByFolderId.get(fid);
          if (owner) {
            inFlightByRoot.set(owner, Math.max(0, (inFlightByRoot.get(owner) ?? 1) - 1));
          }
        }
        for (const owner of touchedRoots) {
          checkMarkDone(owner);
        }
        activeWorkers -= 1;
        emitSnapshot();
        wakeWaiters();
      }
    }
  };

  try {
    const workerCount = Math.min(CONCURRENCY, Math.max(1, uniqueRoots.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } finally {
    options?.signal?.removeEventListener('abort', onAbort);
  }

  if (fatalAuthError) {
    throw fatalAuthError;
  }

  if (!options?.signal?.aborted) {
    for (const rootId of uniqueRoots) {
      if ((queueByRoot.get(rootId)?.length ?? 0) > 0) {
        stats[rootId].capped = true;
      }
      stats[rootId].done = true;
      finalizeAndCacheRoot(rootId);
    }
    emitSnapshot();
  }

  return stats;
}

/**
 * Creates a new Google Drive folder (inside an optional parent folder) for cross-device mapping.
 */
export async function createDriveFolder(
  accessToken: string,
  name: string,
  parentFolderId?: string | null
): Promise<DriveFolderItem> {
  const body: Record<string, unknown> = {
    name: name.trim(),
    mimeType: 'application/vnd.google-apps.folder',
    appProperties: {
      cratesyncType: 'mapped-folder',
    },
  };
  if (parentFolderId) {
    body.parents = [parentFolderId];
  }

  const res = await fetch(`${DRIVE_FILES_ENDPOINT}?fields=id,name,modifiedTime`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw await parseDriveError(res, `Failed to create folder "${name}" in Google Drive.`);
  }

  const created = (await res.json()) as Record<string, unknown>;
  return {
    id: String(created.id ?? ''),
    name: String(created.name ?? name.trim()),
    modifiedTime: String(created.modifiedTime ?? new Date().toISOString()),
  };
}

const DRIVE_AUDIO_EXT_RE = /\.(mp3|flac|m4a|m4b|wav|ogg|oga|opus|aac|aiff|aif|wma|alac|webm)$/i;

function isDriveAudioItem(raw: Record<string, unknown>): boolean {
  const mime = String(raw.mimeType ?? '').toLowerCase();
  if (mime === 'application/vnd.google-apps.folder') return false;
  if (mime.startsWith('audio/')) return true;
  const name = String(raw.name ?? '');
  return DRIVE_AUDIO_EXT_RE.test(name);
}

/**
 * Lists audio song files stored in Google Drive with full pagination (`pageSize=1000` + `nextPageToken`).
 * When `folderId` is provided, recursively traverses all nested subfolders using batched concurrent BFS
 * so libraries with thousands of songs organized in `Music/Artist/Album/` folders are discovered in seconds.
 */
export async function listDriveAudioFiles(
  accessToken: string,
  options?: {
    folderId?: string | null;
    folderLabel?: string;
    recursive?: boolean;
    searchTerm?: string;
    maxFiles?: number;
    signal?: AbortSignal;
    onProgress?: (progress: DriveScanProgress) => void;
  }
): Promise<DriveFileItem[]> {
  const maxFiles = options?.maxFiles ?? 25_000;
  const recursive = options?.recursive !== false;
  const searchLower = (options?.searchTerm ?? '').trim().toLowerCase();

  // Mode A: Scoped to a specific Google Drive folder → recursive batched BFS across all nested subfolders
  if (options?.folderId) {
    const rootFolderId = options.folderId;
    const rootLabel = (options.folderLabel || 'Google Drive').replace(/^\/+|\/+$/g, '');
    const folderPathById = new Map<string, string>([[rootFolderId, rootLabel]]);
    const visitedFolders = new Set<string>([rootFolderId]);
    const audioById = new Map<string, DriveFileItem>();

    let frontier: string[] = [rootFolderId];
    let scannedFolders = 0;

    const BATCH_SIZE = 15;
    const CONCURRENCY = 3;

    const emitProgress = (queuedCount: number) => {
      options.onProgress?.({
        scannedFolders,
        queuedFolders: queuedCount,
        foundAudio: audioById.size,
      });
    };

    emitProgress(frontier.length);

    while (frontier.length > 0 && audioById.size < maxFiles) {
      if (options.signal?.aborted) break;

      const chunks: string[][] = [];
      for (let i = 0; i < frontier.length; i += BATCH_SIZE) {
        chunks.push(frontier.slice(i, i + BATCH_SIZE));
      }

      const nextFrontier: string[] = [];
      let nextChunkIndex = 0;

      const worker = async () => {
        while (nextChunkIndex < chunks.length) {
          if (options.signal?.aborted || audioById.size >= maxFiles) return;
          const myIndex = nextChunkIndex++;
          const parentBatch = chunks[myIndex];

          const parentQuery = parentBatch
            .map((pid) => `'${pid.replace(/'/g, "\\'")}' in parents`)
            .join(' or ');
          const q = `trashed = false and (${parentQuery})`;

          let pageToken: string | undefined;
          do {
            if (options.signal?.aborted || audioById.size >= maxFiles) return;

            const params = new URLSearchParams({
              q,
              pageSize: '1000',
              includeItemsFromAllDrives: 'true',
              supportsAllDrives: 'true',
              fields:
                'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents,md5Checksum,appProperties)',
            });
            if (pageToken) {
              params.set('pageToken', pageToken);
            }

            const res = await driveFetchWithRetry(
              `${DRIVE_FILES_ENDPOINT}?${params.toString()}`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: options.signal,
              },
              'Failed to list audio files from Google Drive.'
            );

            const data = (await res.json()) as {
              nextPageToken?: string;
              files?: Array<Record<string, unknown>>;
            };

            for (const raw of data.files ?? []) {
              const id = String(raw.id ?? '');
              if (!id) continue;
              const mime = String(raw.mimeType ?? '');
              const parents = Array.isArray(raw.parents) ? raw.parents.map(String) : [];
              const matchedParentId = parents.find((pid) => folderPathById.has(pid));
              const parentPath = matchedParentId
                ? folderPathById.get(matchedParentId)!
                : rootLabel;

              if (mime === 'application/vnd.google-apps.folder') {
                if (recursive && !visitedFolders.has(id)) {
                  visitedFolders.add(id);
                  const folderName = String(raw.name ?? 'Folder');
                  folderPathById.set(id, `${parentPath}/${folderName}`);
                  nextFrontier.push(id);
                }
              } else if (isDriveAudioItem(raw)) {
                const name = String(raw.name ?? '');
                if (searchLower && !name.toLowerCase().includes(searchLower)) continue;
                if (!audioById.has(id)) {
                  const normalized = normalizeDriveFile(raw);
                  normalized.folderPath = parentPath;
                  audioById.set(id, normalized);
                  if (audioById.size >= maxFiles) break;
                }
              }
            }

            pageToken = data.nextPageToken;
          } while (pageToken);

          scannedFolders += parentBatch.length;
          emitProgress(
            Math.max(0, (chunks.length - myIndex - 1) * BATCH_SIZE) + nextFrontier.length
          );
        }
      };

      const workerCount = Math.min(CONCURRENCY, chunks.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      frontier = recursive ? nextFrontier : [];
    }

    return Array.from(audioById.values()).sort(
      (a, b) => (Date.parse(b.modifiedTime) || 0) - (Date.parse(a.modifiedTime) || 0)
    );
  }

  // Mode B: Entire Google Drive audio scan → full pagination (pageSize=1000 + nextPageToken)
  const escapedSearch = (options?.searchTerm ?? '')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");

  const audioFormatFilter = [
    "mimeType contains 'audio/'",
    "name contains '.mp3'",
    "name contains '.flac'",
    "name contains '.m4a'",
    "name contains '.wav'",
    "name contains '.ogg'",
    "name contains '.opus'",
    "name contains '.aac'",
    "name contains '.aiff'",
    "name contains '.aif'",
    "name contains '.m4b'",
    "name contains '.wma'",
    "name contains '.webm'",
  ].join(' or ');

  const clauses = [
    'trashed = false',
    "mimeType != 'application/vnd.google-apps.folder'",
    `(${audioFormatFilter})`,
  ];

  if (escapedSearch) {
    clauses.push(`name contains '${escapedSearch}'`);
  }

  const allAudio: DriveFileItem[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;
  const maxPages = Math.ceil(maxFiles / 1000);

  do {
    if (options?.signal?.aborted) break;

    const params = new URLSearchParams({
      q: clauses.join(' and '),
      orderBy: 'modifiedTime desc',
      pageSize: '1000',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
      fields:
        'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents,md5Checksum,appProperties)',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const res = await driveFetchWithRetry(
      `${DRIVE_FILES_ENDPOINT}?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: options?.signal,
      },
      'Failed to list audio files from Google Drive.'
    );

    const data = (await res.json()) as {
      nextPageToken?: string;
      files?: Array<Record<string, unknown>>;
    };

    for (const raw of data.files ?? []) {
      allAudio.push(normalizeDriveFile(raw));
      if (allAudio.length >= maxFiles) break;
    }

    pageCount += 1;
    options?.onProgress?.({
      scannedFolders: pageCount,
      queuedFolders: data.nextPageToken ? 1 : 0,
      foundAudio: allAudio.length,
    });

    pageToken = data.nextPageToken;
  } while (pageToken && pageCount < maxPages && allAudio.length < maxFiles);

  return allAudio;
}

/**
 * Downloads an audio song binary Blob from Google Drive for offline caching and playback.
 */
export async function downloadDriveAudioBlob(
  accessToken: string,
  fileId: string,
  fallbackMimeType?: string
): Promise<Blob> {
  const res = await fetch(
    `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to download audio file from Google Drive.');
  }

  const rawBlob = await res.blob();
  if ((!rawBlob.type || rawBlob.type === 'application/octet-stream') && fallbackMimeType) {
    return new Blob([rawBlob], { type: fallbackMimeType });
  }
  return rawBlob;
}

/**
 * Uploads a binary audio file (song) to Google Drive using multipart/related binary upload,
 * preserving exact file bytes so every synced device plays the authentic source audio.
 */
export async function uploadAudioFileToDrive(
  accessToken: string,
  blob: Blob,
  fileName: string,
  options?: { folderId?: string | null; trackId?: string }
): Promise<DriveFileItem> {
  const boundary = `cratesync_audio_${crypto.randomUUID().replace(/-/g, '')}`;
  const mimeType =
    blob.type && blob.type.startsWith('audio/') ? blob.type : inferAudioMimeFromName(fileName);

  const metadata: Record<string, unknown> = {
    name: fileName,
    mimeType,
    appProperties: {
      cratesyncType: 'audio-track',
      ...(options?.trackId ? { trackId: options.trackId } : {}),
    },
  };

  if (options?.folderId) {
    metadata.parents = [options.folderId];
  }

  const preamble = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    '',
    '',
  ].join('\r\n');

  const epilogue = `\r\n--${boundary}--`;
  const multipartBlob = new Blob([preamble, blob, epilogue], {
    type: `multipart/related; boundary=${boundary}`,
  });

  const res = await fetch(
    `${DRIVE_UPLOAD_ENDPOINT}?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink,parents,md5Checksum,appProperties`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBlob,
    }
  );

  if (!res.ok) {
    throw await parseDriveError(res, `Failed to upload "${fileName}" to Google Drive.`);
  }

  const raw = (await res.json()) as Record<string, unknown>;
  return normalizeDriveFile(raw);
}

export function inferAudioMimeFromName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg';
    case 'flac':
      return 'audio/flac';
    case 'm4a':
    case 'm4b':
    case 'mp4':
      return 'audio/mp4';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
    case 'oga':
      return 'audio/ogg';
    case 'opus':
      return 'audio/opus';
    case 'aac':
      return 'audio/aac';
    case 'aiff':
    case 'aif':
      return 'audio/aiff';
    case 'webm':
      return 'audio/webm';
    default:
      return 'audio/mpeg';
  }
}

/**
 * Derives a clean LocalTrack catalog stub from a Google Drive audio file metadata entry
 * so Drive songs appear immediately in the library before being cached to this device.
 * Uses nested Drive folderPath (e.g. "Music/Daft Punk/Discovery") to infer Artist & Album when available.
 */
export function buildTrackStubFromDriveAudio(
  file: DriveFileItem,
  folderLabel = 'Google Drive'
): LocalTrack {
  const ext = file.name.split('.').pop()?.toUpperCase() || 'AUDIO';
  const baseName = file.name.replace(/\.[^.]+$/, '').trim() || file.name;
  let cleaned = baseName;
  let trackNumber: number | null = null;

  const trackPrefix = cleaned.match(/^(\d{1,3})\s*[.\-–_]\s*(.+)$/);
  if (trackPrefix) {
    trackNumber = parseInt(trackPrefix[1], 10);
    cleaned = trackPrefix[2].trim();
  }

  const effectivePath = (file.folderPath || folderLabel || 'Google Drive').replace(/^\/+|\/+$/g, '');
  const pathSegments = effectivePath.split('/').filter(Boolean);
  const leafFolder = pathSegments[pathSegments.length - 1] || folderLabel;

  let artist = 'Unknown Artist';
  let title = cleaned;
  let album = leafFolder === 'Google Drive' ? 'Google Drive Library' : leafFolder;

  const dashParts = cleaned.split(/\s+[-–—]\s+/);
  if (dashParts.length >= 2) {
    artist = dashParts[0].trim();
    title = dashParts.slice(1).join(' - ').trim();
  } else if (pathSegments.length >= 3) {
    // e.g. Music / Artist / Album / 01 Track.flac
    artist = pathSegments[pathSegments.length - 2];
    album = pathSegments[pathSegments.length - 1];
  } else if (pathSegments.length === 2) {
    // e.g. Music / Artist / Track.flac
    artist = pathSegments[1];
  }

  const modifiedMs = Date.parse(file.modifiedTime) || Date.now();
  return {
    id: crypto.randomUUID(),
    fileKey: `gdrive::${file.id}`,
    fileName: file.name,
    relativePath: `${effectivePath}/${file.name}`,
    folderName: leafFolder,
    title: title || baseName,
    artist,
    album,
    year: '',
    trackNumber,
    duration: 0,
    format: ext,
    fileSize: file.size,
    contentHash: file.md5Checksum ?? null,
    coverArtUrl: null,
    addedAt: modifiedMs,
    lastSeenAt: Date.now(),
    isMissingOnDevice: false,
    youtubeVideoId: null,
    youtubeTitle: null,
    matchStatus: 'unmatched',
    driveFileId: file.id,
    driveModifiedTime: file.modifiedTime,
    drivePath: effectivePath,
    cachedOnDeviceAt: null,
  };
}

/**
 * Lists CrateSync source-of-truth manifests and library metadata backup files in Google Drive.
 */
export async function listCrateSyncBackups(accessToken: string): Promise<DriveFileItem[]> {
  const query =
    "trashed = false and (appProperties has { key='cratesyncType' and value='source-of-truth' } or appProperties has { key='cratesyncType' and value='library-backup' } or name contains 'cratesync-library-backup' or name = 'cratesync-source-of-truth.json')";
  const params = new URLSearchParams({
    q: query,
    orderBy: 'modifiedTime desc',
    pageSize: '20',
    fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,parents,appProperties)',
  });

  const res = await fetch(`${DRIVE_FILES_ENDPOINT}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to list CrateSync backups from Google Drive.');
  }

  const data = (await res.json()) as { files?: Array<Record<string, unknown>> };
  const files = (data.files ?? []).map(normalizeDriveFile);
  // Put canonical source-of-truth manifest first if present
  return files.sort((a, b) => {
    const aCanon = a.appProperties?.cratesyncType === 'source-of-truth' || a.name === CRATESYNC_CANONICAL_MANIFEST_NAME ? 1 : 0;
    const bCanon = b.appProperties?.cratesyncType === 'source-of-truth' || b.name === CRATESYNC_CANONICAL_MANIFEST_NAME ? 1 : 0;
    if (aCanon !== bCanon) return bCanon - aCanon;
    return (Date.parse(b.modifiedTime) || 0) - (Date.parse(a.modifiedTime) || 0);
  });
}

/**
 * Lists importable playlist files (M3U8, M3U, CSV, JSON, TXT) from Google Drive storage.
 */
export async function listDrivePlaylistFiles(
  accessToken: string,
  searchTerm = ''
): Promise<DriveFileItem[]> {
  const escapedSearch = searchTerm.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const formatFilter = [
    "name contains '.m3u8'",
    "name contains '.m3u'",
    "name contains '.csv'",
    "name contains '.json'",
    "name contains '.txt'",
    "mimeType = 'audio/x-mpegurl'",
    "mimeType = 'application/vnd.apple.mpegurl'",
    "mimeType = 'text/csv'",
    "mimeType = 'application/json'",
    "mimeType = 'text/plain'",
    "appProperties has { key='cratesyncType' and value='playlist-export' }",
  ].join(' or ');

  const clauses = [
    'trashed = false',
    "mimeType != 'application/vnd.google-apps.folder'",
    `(${formatFilter})`,
  ];

  if (escapedSearch) {
    clauses.push(`name contains '${escapedSearch}'`);
  }

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    orderBy: 'modifiedTime desc',
    pageSize: '30',
    fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,appProperties)',
  });

  const res = await fetch(`${DRIVE_FILES_ENDPOINT}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to list playlist files from Google Drive.');
  }

  const data = (await res.json()) as { files?: Array<Record<string, unknown>> };
  return (data.files ?? []).map(normalizeDriveFile);
}

/**
 * Uploads a text/JSON file to Google Drive using multipart/related upload.
 * Supports creating a new file (POST) or updating an existing app-managed file (PATCH).
 */
async function uploadMultipartTextFile(params: {
  accessToken: string;
  fileName: string;
  content: string;
  mimeType: string;
  appProperties: Record<string, string>;
  existingFileId?: string | null;
  parentFolderId?: string | null;
}): Promise<DriveFileItem> {
  const boundary = `cratesync_boundary_${crypto.randomUUID().replace(/-/g, '')}`;
  const isUpdate = Boolean(params.existingFileId);
  const metadata: Record<string, unknown> = {
    name: params.fileName,
    mimeType: params.mimeType,
    appProperties: params.appProperties,
  };
  if (!isUpdate && params.parentFolderId) {
    metadata.parents = [params.parentFolderId];
  }

  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${params.mimeType}; charset=UTF-8`,
    '',
    params.content,
    `--${boundary}--`,
  ].join('\r\n');

  const targetUrl = isUpdate
    ? `${DRIVE_UPLOAD_ENDPOINT}/${encodeURIComponent(params.existingFileId!)}?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink,parents,appProperties`
    : `${DRIVE_UPLOAD_ENDPOINT}?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink,parents,appProperties`;

  const res = await fetch(targetUrl, {
    method: isUpdate ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!res.ok) {
    throw await parseDriveError(
      res,
      isUpdate
        ? 'Failed to update existing file on Google Drive.'
        : 'Failed to upload file to Google Drive.'
    );
  }

  const raw = (await res.json()) as Record<string, unknown>;
  return normalizeDriveFile(raw);
}

export async function syncCanonicalManifestToDrive(
  accessToken: string,
  payload: CrateSyncLibraryBackupPayload,
  options?: { existingFileId?: string | null; parentFolderId?: string | null }
): Promise<DriveFileItem> {
  return uploadMultipartTextFile({
    accessToken,
    fileName: CRATESYNC_CANONICAL_MANIFEST_NAME,
    content: JSON.stringify(payload, null, 2),
    mimeType: 'application/json',
    appProperties: {
      cratesyncType: 'source-of-truth',
      trackCount: String(payload.stats.trackCount),
      playlistCount: String(payload.stats.playlistCount),
      smartPlaylistCount: String(payload.stats.smartPlaylistCount),
      driveAudioCount: String(payload.stats.driveAudioCount ?? 0),
    },
    existingFileId: options?.existingFileId,
    parentFolderId: options?.parentFolderId,
  });
}

export async function uploadLibraryMetadataBackup(
  accessToken: string,
  payload: CrateSyncLibraryBackupPayload,
  options: { fileName: string; existingFileId?: string | null; parentFolderId?: string | null }
): Promise<DriveFileItem> {
  return uploadMultipartTextFile({
    accessToken,
    fileName: options.fileName,
    content: JSON.stringify(payload, null, 2),
    mimeType: 'application/json',
    appProperties: {
      cratesyncType: 'library-backup',
      trackCount: String(payload.stats.trackCount),
      playlistCount: String(payload.stats.playlistCount),
      smartPlaylistCount: String(payload.stats.smartPlaylistCount),
      driveAudioCount: String(payload.stats.driveAudioCount ?? 0),
    },
    existingFileId: options.existingFileId,
    parentFolderId: options.parentFolderId,
  });
}

export async function uploadPlaylistExportToDrive(
  accessToken: string,
  params: {
    fileName: string;
    content: string;
    mimeType: string;
    playlistName: string;
    trackCount: number;
    parentFolderId?: string | null;
  }
): Promise<DriveFileItem> {
  return uploadMultipartTextFile({
    accessToken,
    fileName: params.fileName,
    content: params.content,
    mimeType: params.mimeType,
    appProperties: {
      cratesyncType: 'playlist-export',
      playlistName: params.playlistName.slice(0, 80),
      trackCount: String(params.trackCount),
    },
    parentFolderId: params.parentFolderId,
  });
}

/**
 * Downloads file text content from Google Drive.
 */
export async function downloadDriveFileText(
  accessToken: string,
  file: Pick<DriveFileItem, 'id' | 'mimeType'>
): Promise<string> {
  let url = `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(file.id)}?alt=media`;

  if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
    url = `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(file.id)}/export?mimeType=text/csv`;
  } else if (file.mimeType === 'application/vnd.google-apps.document') {
    url = `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(file.id)}/export?mimeType=text/plain`;
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw await parseDriveError(res, 'Failed to download file content from Google Drive.');
  }

  return res.text();
}

export async function deleteDriveFile(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok && res.status !== 204) {
    throw await parseDriveError(res, 'Failed to delete file from Google Drive.');
  }
}

/**
 * Validates and parses a downloaded CrateSync source-of-truth / library backup JSON payload.
 */
export function parseLibraryBackupPayload(rawText: string): CrateSyncLibraryBackupPayload | null {
  try {
    const parsed = JSON.parse(rawText) as Partial<CrateSyncLibraryBackupPayload>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (
      parsed.app !== 'CrateSync' ||
      !Array.isArray(parsed.tracks) ||
      !Array.isArray(parsed.playlists)
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      app: 'CrateSync',
      sourceOfTruth: parsed.sourceOfTruth ?? 'google-drive',
      backedUpAt:
        typeof parsed.backedUpAt === 'string' ? parsed.backedUpAt : new Date().toISOString(),
      watchedFolderName:
        typeof parsed.watchedFolderName === 'string' ? parsed.watchedFolderName : null,
      driveMusicFolderId:
        typeof parsed.driveMusicFolderId === 'string' ? parsed.driveMusicFolderId : null,
      driveMusicFolderName:
        typeof parsed.driveMusicFolderName === 'string' ? parsed.driveMusicFolderName : null,
      stats: {
        trackCount: parsed.tracks.length,
        playlistCount: parsed.playlists.length,
        smartPlaylistCount: Array.isArray(parsed.smartPlaylists) ? parsed.smartPlaylists.length : 0,
        matchedCount: parsed.tracks.filter((t) => Boolean(t?.youtubeVideoId)).length,
        driveAudioCount: parsed.tracks.filter((t) => Boolean(t?.driveFileId)).length,
      },
      tracks: parsed.tracks,
      playlists: parsed.playlists,
      smartPlaylists: Array.isArray(parsed.smartPlaylists) ? parsed.smartPlaylists : [],
      syncHistory: Array.isArray(parsed.syncHistory) ? parsed.syncHistory : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      folderMappings: Array.isArray(parsed.folderMappings) ? parsed.folderMappings : [],
    };
  } catch {
    return null;
  }
}
