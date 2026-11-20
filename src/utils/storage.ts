import type { LocalTrack, Playlist, SyncEvent } from '../types/music';

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
  syncHistory: SyncEvent[];
  watchedFolderName: string | null;
  lastScannedAt: number | null;
}

const DEFAULT_STATE: PersistedLibraryState = {
  tracks: [],
  playlists: [],
  syncHistory: [],
  watchedFolderName: null,
  lastScannedAt: null,
};

const LS_FALLBACK_KEY = 'cratesync_library_v1';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
