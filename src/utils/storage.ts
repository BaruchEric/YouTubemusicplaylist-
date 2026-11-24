import type {
  DriveFolderMapping,
  LocalTrack,
  Playlist,
  ScanLogEntry,
  SmartPlaylist,
  SyncDeviceProfile,
  SyncEvent,
} from '../types/music';

const DB_NAME = 'CrateSyncDB';
const DB_VERSION = 2;

const STORES = {
  STATE: 'app_state',
  HANDLES: 'dir_handles',
  BLOBS: 'audio_blobs',
} as const;

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

export async function deleteAudioBlobs(fileKeys: string[]): Promise<void> {
  if (fileKeys.length === 0) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORES.BLOBS, 'readwrite');
      const store = tx.objectStore(STORES.BLOBS);
      for (const key of fileKeys) {
        store.delete(key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Ignore
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

export async function saveDirectoryHandle(
  handle: FileSystemDirectoryHandle | null
): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORES.HANDLES, 'readwrite');
      if (handle) {
        tx.objectStore(STORES.HANDLES).put(handle, 'watched_root');
      } else {
        tx.objectStore(STORES.HANDLES).delete('watched_root');
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Ignore when IndexedDB or handle structured clone is unsupported
  }
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    return await new Promise<FileSystemDirectoryHandle | null>((resolve) => {
      const tx = db.transaction(STORES.HANDLES, 'readonly');
      const req = tx.objectStore(STORES.HANDLES).get('watched_root');
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
