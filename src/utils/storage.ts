import type {
  DriveFolderMapping,
  FolderMappingTombstone,
  LibraryTombstone,
  LocalTrack,
  Playlist,
  ScanLogEntry,
  SmartPlaylist,
  SyncDeviceProfile,
  SyncEvent,
} from '../types/music';
import {
  foldersFromLegacyRecord,
  parseStoredFolders,
  toStoredFolders,
  type WatchedFolder,
} from './watchedFolders';

const DB_NAME = 'CrateSyncDB';
const DB_VERSION = 2;

const STORES = {
  STATE: 'app_state',
  HANDLES: 'dir_handles',
  BLOBS: 'audio_blobs',
} as const;

/**
 * Keys in the dir_handles store. The list of picked folders is one record: each folder's
 * handle beside the file keys its last scan saw. The two legacy keys are what an older
 * version kept for its single folder. They are read once, to build the list.
 */
const WATCHED_FOLDERS_KEY = 'watched_folders';
const LEGACY_ROOT_KEY = 'watched_root';
const LEGACY_ROOT_FILES_KEY = 'watched_root_files';

export interface PersistedLibraryState {
  tracks: LocalTrack[];
  playlists: Playlist[];
  smartPlaylists: SmartPlaylist[];
  syncHistory: SyncEvent[];
  scanLogs?: ScanLogEntry[];
  watchedFolderName: string | null;
  lastScannedAt: number | null;
  devices?: SyncDeviceProfile[];
  folderMappings?: DriveFolderMapping[];
  folderMappingTombstones?: FolderMappingTombstone[];
  /** Deleted songs, playlists and smart playlists, kept so a Drive merge does not restore them. */
  libraryTombstones?: LibraryTombstone[];
}

const DEFAULT_STATE: PersistedLibraryState = {
  tracks: [],
  playlists: [],
  smartPlaylists: [],
  syncHistory: [],
  scanLogs: [],
  watchedFolderName: null,
  lastScannedAt: null,
  devices: [],
  folderMappings: [],
  folderMappingTombstones: [],
  libraryTombstones: [],
};

const LS_FALLBACK_KEY = 'cratesync_library_v1';

// One shared connection. Opening a new one per call leaked a connection on every save,
// and an unclosed connection blocks future version upgrades.
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.STATE)) {
        db.createObjectStore(STORES.STATE);
      }
      if (!db.objectStoreNames.contains(STORES.HANDLES)) {
        db.createObjectStore(STORES.HANDLES);
      }
      if (!db.objectStoreNames.contains(STORES.BLOBS)) {
        db.createObjectStore(STORES.BLOBS);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Let another tab upgrade the schema, then reopen lazily on the next call
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

export async function loadLibraryState(): Promise<PersistedLibraryState> {
  try {
    const db = await openDB();
    return await new Promise<PersistedLibraryState>((resolve) => {
      const tx = db.transaction(STORES.STATE, 'readonly');
      const req = tx.objectStore(STORES.STATE).get('main');
      req.onsuccess = () => {
        resolve(req.result ? { ...DEFAULT_STATE, ...req.result } : DEFAULT_STATE);
      };
      req.onerror = () => resolve(DEFAULT_STATE);
    });
  } catch {
    try {
      const raw = localStorage.getItem(LS_FALLBACK_KEY);
      if (!raw) return DEFAULT_STATE;
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_STATE;
    }
  }
}

export async function saveLibraryState(state: PersistedLibraryState): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.STATE, 'readwrite');
      tx.objectStore(STORES.STATE).put(state, 'main');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      // A quota failure at commit fires abort without error; without this the save never settles
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  } catch {
    try {
      localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota overflow in fallback mode
    }
  }
}

export async function saveAudioBlob(fileKey: string, file: Blob): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORES.BLOBS, 'readwrite');
      tx.objectStore(STORES.BLOBS).put(file, fileKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Ignore quota / unavailable IndexedDB
  }
}

export async function loadAudioBlob(fileKey: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(STORES.BLOBS, 'readonly');
      const req = tx.objectStore(STORES.BLOBS).get(fileKey);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function listStoredAudioKeys(): Promise<Set<string>> {
  try {
    const db = await openDB();
    return await new Promise<Set<string>>((resolve) => {
      const tx = db.transaction(STORES.BLOBS, 'readonly');
      const req = tx.objectStore(STORES.BLOBS).getAllKeys();
      req.onsuccess = () => {
        const keys = (req.result as IDBValidKey[] | undefined) ?? [];
        resolve(new Set(keys.map(String)));
      };
      req.onerror = () => resolve(new Set());
    });
  } catch {
    return new Set();
  }
}

/**
 * Deletes stored copies by file key. Resolves true once every one of them is gone and false
 * when the browser deleted none, so a caller can say how much it freed without guessing.
 */
export async function deleteAudioBlobs(fileKeys: string[]): Promise<boolean> {
  if (fileKeys.length === 0) return true;
  try {
    const db = await openDB();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORES.BLOBS, 'readwrite');
      const store = tx.objectStore(STORES.BLOBS);
      for (const key of fileKeys) {
        store.delete(key);
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export interface AudioCacheStats {
  cachedCount: number;
  totalBytes: number;
  cachedKeys: Set<string>;
}

export async function getAudioCacheStats(): Promise<AudioCacheStats> {
  try {
    const db = await openDB();
    return await new Promise<AudioCacheStats>((resolve) => {
      const cachedKeys = new Set<string>();
      let totalBytes = 0;
      const tx = db.transaction(STORES.BLOBS, 'readonly');
      const req = tx.objectStore(STORES.BLOBS).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cachedKeys.add(String(cursor.key));
          const val = cursor.value as Blob | undefined;
          if (val && typeof val.size === 'number') {
            totalBytes += val.size;
          }
          cursor.continue();
        } else {
          resolve({
            cachedCount: cachedKeys.size,
            totalBytes,
            cachedKeys,
          });
        }
      };
      req.onerror = () => resolve({ cachedCount: 0, totalBytes: 0, cachedKeys: new Set() });
    });
  } catch {
    return { cachedCount: 0, totalBytes: 0, cachedKeys: new Set() };
  }
}

export async function clearAllAudioBlobs(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORES.BLOBS, 'readwrite');
      tx.objectStore(STORES.BLOBS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Ignore
  }
}

/**
 * Saves the list of picked folders, each with the file keys of the songs its last scan saw.
 * Those songs play from their folder, so the list must outlive a reload. Says false when
 * the save failed, and a scan then keeps the stored copies it would have freed.
 */
export async function saveWatchedFolders(folders: ReadonlyArray<WatchedFolder>): Promise<boolean> {
  try {
    const db = await openDB();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORES.HANDLES, 'readwrite');
      tx.objectStore(STORES.HANDLES).put(toStoredFolders(folders), WATCHED_FOLDERS_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch {
    // IndexedDB is unavailable, or the browser cannot store a folder handle.
    return false;
  }
}

function readHandleRecords(db: IDBDatabase, keys: readonly string[]): Promise<unknown[]> {
  return new Promise<unknown[]>((resolve, reject) => {
    const tx = db.transaction(STORES.HANDLES, 'readonly');
    const store = tx.objectStore(STORES.HANDLES);
    const requests = keys.map((key) => store.get(key));
    tx.oncomplete = () => resolve(requests.map((req): unknown => req.result));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Saves the list built from the old single-folder record and removes that record. Both
 * happen in one transaction, so the old keys go only when the list is saved.
 */
async function moveLegacyRecord(
  db: IDBDatabase,
  folders: ReadonlyArray<WatchedFolder>
): Promise<boolean> {
  try {
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORES.HANDLES, 'readwrite');
      const store = tx.objectStore(STORES.HANDLES);
      store.put(toStoredFolders(folders), WATCHED_FOLDERS_KEY);
      store.delete(LEGACY_ROOT_KEY);
      store.delete(LEGACY_ROOT_FILES_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Loads the list of picked folders. A browser that still holds the old single-folder
 * record gets a list of that one folder, saved under the new key before the old keys go.
 * When that save fails the old record stays, and the next load builds the list again.
 */
export async function loadWatchedFolders(): Promise<WatchedFolder[]> {
  try {
    const db = await openDB();
    const [saved, legacyHandle, legacyFileKeys] = await readHandleRecords(db, [
      WATCHED_FOLDERS_KEY,
      LEGACY_ROOT_KEY,
      LEGACY_ROOT_FILES_KEY,
    ]);
    if (saved !== undefined) return parseStoredFolders(saved);
    const folders = foldersFromLegacyRecord(
      { handle: legacyHandle, fileKeys: legacyFileKeys },
      crypto.randomUUID()
    );
    if (folders.length > 0) await moveLegacyRecord(db, folders);
    return folders;
  } catch {
    return [];
  }
}
