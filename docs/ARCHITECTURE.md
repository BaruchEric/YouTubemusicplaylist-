# CrateSync Architecture

This document describes CrateSync's data model, client-side persistence layer, multi-device Google Drive sync protocol, audio playback pipeline, and server architecture.

## High-Level Architecture

CrateSync runs as a local-first React SPA paired with a lightweight Express backend ([`server.ts`](../server.ts)):

```text
Browser (React 19 SPA)
├── Local Files ──► File System Access API / webkitdirectory / Drag-and-Drop
├── Persistence ──► IndexedDB ("CrateSyncDB") + localStorage caches
├── Playback    ──► Dual-Deck HTMLAudio/WebAudio + ReplayGain + Crossfade
├── Cloud Sync  ──► Firebase Auth (in-memory OAuth token) ──► Google Drive API v3
└── AI Helpers  ──► Express Backend (/api/metadata/suggest, /api/genres/classify)
                        └── @google/genai (Gemini API + Google Search grounding)
```

## Core Data Model

All primary domain interfaces are defined in [`src/types/music.ts`](../src/types/music.ts):

- **`LocalTrack`**: Represents an indexed audio file or Drive catalog stub.
  - Identity: `id` (UUID), `fileKey` (`<relativePath.toLowerCase()>::<fileSize>`), optional SHA-256 `contentHash`.
  - Metadata: `title`, `artist`, `album`, `genre`, `year`, `trackNumber`, `duration`, `format`, `fileSize`, `coverArtUrl`.
  - Sync & playback state: `isMissingOnDevice`, `youtubeVideoId`, `youtubeTitle`, `matchStatus` (`unmatched | matched | skipped`), `playCount`, `skipCount`, `lastPlayedAt`.
  - Google Drive linkage: `driveFileId`, `driveModifiedTime`, `drivePath`, `cachedOnDeviceAt`.
- **`Playlist`**: Ordered `trackIds`, last-synced snapshot `syncedTrackIds`, optional `youtubePlaylistUrl`, `watchedFolderName`, and `SyncRule` (`autoAddNewFiles`, `removeMissingFiles`, `autoScanIntervalSec`, `folderFilter`).
- **`PlaylistDiff`**: Computed delta (`toAdd`, `toRemove`, `missingOnDevice`, `matchedCount`, `unmatchedCount`, `hasChanges`) produced by [`computePlaylistDiff`](../src/utils/syncEngine.ts).
- **`SmartPlaylist`**: Rule-based dynamic playlist (`matchMode: 'all' | 'any'`, `rules`, `sortBy`, `sortDir`, `excludeMissing`).
- **`SyncEvent`**: Audit log record for applied playlist syncs.
- **`SyncDeviceProfile`**: Persistent playing-device identity (`id`, `name`, `platform`, `lastSeenAt`).
- **`DriveFolderMapping`** & **`DeviceFolderBinding`**: Maps a Google Drive folder (`driveFolderId`, `driveFolderName`) to per-device local folder bindings keyed by `SyncDeviceProfile.id`, storing `localFolderPath`, `syncDirection` (`pull | push | bidirectional`), `autoCacheOffline`, `lastSyncedAt`, and `updatedAt` (set when the binding is saved, not when it syncs).
- **`FolderMappingTombstone`**: Records a deleted mapping (`driveFolderId`, `deletedAt`) or one device's removed binding (adds `deviceId`), so merges do not restore it.

## Client-Side Persistence

### IndexedDB (`CrateSyncDB`, v2)

Managed in [`src/utils/storage.ts`](../src/utils/storage.ts) with three object stores:

| Store | Key | Purpose |
| --- | --- | --- |
| `app_state` | `'main'` | Persists `tracks`, `playlists`, `smartPlaylists`, `syncHistory`, `watchedFolderName`, `lastScannedAt`, `devices`, `folderMappings`, and `folderMappingTombstones` (falls back to `localStorage` key `cratesync_library_v1` if IndexedDB is unavailable). |
| `dir_handles` | `'watched_root'` | Stores the mounted `FileSystemDirectoryHandle` so auto-watch and re-scans survive page reloads. |
| `audio_blobs` | `track.fileKey` | Caches local and Drive-downloaded audio `Blob` objects for offline playback and reload persistence. |

### `localStorage` Keys

| Key | Module | Purpose |
| --- | --- | --- |
| `cratesync_device_profile_v1` | [`src/utils/folderMappings.ts`](../src/utils/folderMappings.ts) | Current device profile (`id`, `name`, `platform`, `lastSeenAt`) |
| `cratesync_play_stats_v1` | [`src/hooks/useAudioPlayer.ts`](../src/hooks/useAudioPlayer.ts) | Per-track play/completion/skip statistics |
| `cratesync_play_history_v1` | [`src/hooks/useAudioPlayer.ts`](../src/hooks/useAudioPlayer.ts) | Rolling play history (up to 2,000 entries). Cover art data URLs are stripped before saving to stay under the localStorage quota; the history list reads covers from the track. |
| `cratesync_transition_settings_v1` | [`src/utils/audioTransitions.ts`](../src/utils/audioTransitions.ts) | Crossfade duration, curve, manual-skip crossfade, and gapless playback settings |
| `cratesync_replaygain_settings_v1` | [`src/utils/replayGain.ts`](../src/utils/replayGain.ts) | ReplayGain mode, target LUFS (`-14/-16/-18`), preamp, and clipping guard |
| `cratesync_replaygain_cache_v1` | [`src/utils/replayGain.ts`](../src/utils/replayGain.ts) | Cached loudness measurements (up to 600 tracks) |
| `cratesync_dashboard_smart_filters_v1` | [`src/utils/dashboardSmartFilters.ts`](../src/utils/dashboardSmartFilters.ts) | User-saved dashboard smart filter presets |
| `cratesync_drive_folder_scope_v1` | [`src/components/GoogleDriveTransferSection.tsx`](../src/components/GoogleDriveTransferSection.tsx) | Last selected Google Drive folder scope |

> **Security note**: Google Drive OAuth access tokens in [`src/utils/googleAuth.ts`](../src/utils/googleAuth.ts) are stored **exclusively in memory** and are never written to `localStorage`, `sessionStorage`, or IndexedDB.

## Multi-Device Google Drive Sync Protocol

Implemented across [`src/utils/googleAuth.ts`](../src/utils/googleAuth.ts), [`src/utils/googleDriveApi.ts`](../src/utils/googleDriveApi.ts), [`src/utils/folderMappings.ts`](../src/utils/folderMappings.ts), and [`src/components/GoogleDriveTransferSection.tsx`](../src/components/GoogleDriveTransferSection.tsx):

1. **Authentication**: Uses Firebase Auth `signInWithPopup` with `GoogleAuthProvider` requesting two least-privilege scopes:
   - `https://www.googleapis.com/auth/drive.readonly` (browse, search, download audio and playlist files)
   - `https://www.googleapis.com/auth/drive.file` (create/update CrateSync backups and uploaded audio)
2. **Canonical Manifest**: Stored as `cratesync-source-of-truth.json` (`schemaVersion: 1`) inside the `CrateSync Library` Drive folder. Contains tracks, playlists, smart playlists, sync history, `devices`, `folderMappings`, and `folderMappingTombstones` (optional; manifests written before it existed parse with none). Both push paths download the current manifest and merge its devices, mappings and tombstones into the local state before writing, so a device that had not pulled cannot erase other devices' bindings or deletions. Uploads of 5 MB or less use one multipart request; larger files, including big manifests, use a resumable upload that resumes from the byte the session reports after a dropped connection, or starts a fresh session when that count is unreadable.
3. **Path Translation & Folder Bindings**:
   - Paths are normalized across Windows/macOS/Linux/mobile (`normalizeFolderPath`).
   - When pushing local audio, `resolveDriveMappingForLocalTrack` selects the most specific `push` or `bidirectional` mapping for the current device.
   - When pulling from Drive, `resolveLocalBindingForDriveFolder` and `translateRelativePathForDevice` project remote files onto the current device's local folder structure (or IndexedDB-only cache when unbound).
   - `mergeDeviceProfiles` and `mergeFolderMappingState` merge registries across devices while preserving each device's independent local bindings. `mergeFolderMappingState` unions tombstones (latest per mapping or binding, dropped after 365 days), merges mappings, then removes every binding whose `updatedAt` is not newer than a tombstone covering it, and every mapping left without bindings. Comparing the binding's `updatedAt` rather than the mapping's means a stale device marking a sync cannot bring a deleted mapping back, while a binding saved after the deletion survives.
4. **On-Demand Streaming & Tag Enrichment**: When playing a Drive-synced stub that is not yet cached locally, `useAudioPlayer` fetches the audio blob from Drive, stores it in `audio_blobs`, and triggers `extractLocalTrack` in [`src/App.tsx`](../src/App.tsx) to populate embedded ID3/FLAC/MP4 tags, cover art, duration, and `contentHash`.

## Audio Playback Pipeline

Managed by [`src/hooks/useAudioPlayer.ts`](../src/hooks/useAudioPlayer.ts), [`src/utils/audioTransitions.ts`](../src/utils/audioTransitions.ts), [`src/utils/replayGain.ts`](../src/utils/replayGain.ts), and [`src/utils/smartShuffle.ts`](../src/utils/smartShuffle.ts):

- **Source Resolution**: Checks in-memory `fileMapRef` first, then IndexedDB `audio_blobs`, then Google Drive (if `driveFileId` and an active OAuth token exist), falling back to YouTube playback mode when no local/Drive binary is available.
- **Transitions**: Uses a dual-deck setup for scheduled crossfades (`equal-power`, `smooth-s`, or `linear` gain curves) and gapless preloading. When `gaplessAlbumContinuity` is enabled, consecutive tracks from the same album play gaplessly instead of crossfading.
- **ReplayGain**: Computes integrated loudness (LUFS) and peak amplitude per track/album, applies gain compensation toward the selected target (`-14`, `-16`, or `-18 LUFS`) plus preamp offset, and caps gain when peak clipping prevention is enabled.
- **Telemetry**: Records completed vs. skipped play events into `playStats` and `playHistory`, feeding dashboard analytics, Smart Playlists, and Smart Search.

## Server Architecture

[`server.ts`](../server.ts) runs a single Express HTTP server on `${BIND_HOST || '0.0.0.0'}:${PORT || 3000}`:

- **AI endpoint access**: [`server/aiAccess.ts`](../server/aiAccess.ts) guards every `/api` route before the body is parsed. It verifies a Firebase ID token (`Authorization: Bearer`) with `jose` against Google's securetoken keys, with issuer and audience bound to the `projectId` in `firebase-applet-config.json`, and accepts only Google sign-ins. `GEMINI_ALLOWED_EMAILS`, when set, limits use to those verified emails. Each account gets 240 requests per 10 minutes and 2 in flight; over that it answers `429` with `Retry-After`. In development mode it also accepts token-less requests whose TCP peer is loopback (`trustLoopback`), since Firebase sign-in is not authorized on `localhost`. The client side is [`src/utils/aiApi.ts`](../src/utils/aiApi.ts), which waits for Firebase to restore the session, attaches the token, and retries a `429` up to three times.
- **Development (`NODE_ENV !== 'production'`)**: Attaches Vite in middleware mode (`appType: 'spa'`) for live module serving and HMR.
- **Production (`NODE_ENV === 'production'`)**: Serves static files from `dist/` with an SPA fallback to `dist/index.html`.
- **AI Endpoints**:
  - `POST /api/metadata/suggest`: Batched by [`src/utils/metadataLookup.ts`](../src/utils/metadataLookup.ts) (client batch size `10`, server max `25`). Uses Gemini with `tools: [{ googleSearch: {} }]` and structured JSON schema output; returns sanitized suggestions plus deduplicated web grounding `sources`.
  - `POST /api/genres/classify`: Batched by [`src/utils/genreClassifier.ts`](../src/utils/genreClassifier.ts) (client batch size `50`, server max `60`). Uses Gemini with structured JSON schema output to assign canonical genres/subgenres while filtering out generic placeholders (`Other`, `Unknown`, `Misc`, etc.).

## Module Reference

### `src/utils/`
| File | Responsibility |
| --- | --- |
| `audioMetadata.ts` | Binary ID3v2/ID3v1/FLAC/MP4 tag parser, cover art compressor (`160x160` JPEG), SHA-256 hashing |
| `audioIntegrity.ts` | Binary header inspection, container mismatch checks, duration plausibility, corrupt tag detection |
| `audioTransitions.ts` | Crossfade curve math, gapless album continuity detection, transition settings persistence |
| `replayGain.ts` | Track/album LUFS loudness analysis, gain calculation, clipping prevention, loudness cache |
| `smartShuffle.ts` | Weighted shuffle scoring based on YouTube match quality, metadata completeness, and audio fidelity |
| `syncEngine.ts` | Directory walking, drag-and-drop entry traversal, playlist diff computation |
| `storage.ts` | IndexedDB (`CrateSyncDB`) wrapper for library state, directory handles, and audio blobs |
| `googleAuth.ts` | Firebase Google OAuth sign-in/out, in-memory Drive token management, Firebase ID tokens for the AI endpoints |
| `googleDriveApi.ts` | Google Drive v3 client (folder scanning, multipart and resumable uploads, downloads, manifest I/O, retry/backoff) |
| `folderMappings.ts` | Device profiles, cross-platform path normalization, Drive-to-local binding resolution, merging & tombstones |
| `youtubeLinks.ts` | YouTube ID/playlist URL extraction, queue batch builders, M3U8/CSV/JSON/TXT import & export |
| `smartPlaylists.ts` | Smart Playlist rule definitions, field metadata, and evaluation/sorting engine |
| `smartSearch.ts` | Global search tokenizer, query operator parser, and scored track/album/genre/playlist matching |
| `dashboardSmartFilters.ts` | Dashboard quick criteria, custom rule evaluation, and saved filter storage |
| `duplicateDetector.ts` | Exact hash+size and size-only duplicate grouping with keep-candidate scoring |
| `genreInference.ts` | Local genre tag normalization, ID3v1 genre lookup, heuristic inference, and track statistics |
| `aiApi.ts` | Authenticated POST helper for the Gemini endpoints (Firebase ID token, `429` retry) |
| `genreClassifier.ts` | Client batch wrapper for `POST /api/genres/classify` |
| `metadataLookup.ts` | Client batch wrapper for `POST /api/metadata/suggest` |
| `recommendations.ts` | Genre-profile and genre-adjacency track recommendations |

### `src/components/`
- **Core Workspace Views**: `DashboardView`, `ScannerView`, `PlaylistView`, `SmartPlaylistView`, `SyncQueueView`, `TransferView`
- **Navigation & Chrome**: `Sidebar`, `TopBar`, `MiniPlayer`, `ToastContainer`, `DashboardJumpMenu`, `DashboardQuickActionsMenu`
- **Google Drive & Folder UI**: `GoogleDriveTransferSection`, `FolderMappingsPanel`, `DriveFolderBrowserModal`, `LocalFolderBrowserModal`
- **Library Maintenance & Editing**: `TrackMatchDrawer`, `BatchTagEditorModal`, `DuplicateFinderPanel`, `AudioIntegrityPanel`, `LibraryCleanupPanel`, `Modals`, `SmartPlaylistModal`, `SmartSearchModal`
- **Analytics & Discovery**: `GenreDistributionChart`, `GlobalGenreDistributionChart`, `SmartPlaylistGenreBreakdown`, `DailyListeningChart`, `WeeklyListeningHabitsChart`, `WeeklyTracksAddedChart`, `ListeningActivityHeatmap`, `ListeningActivitySection`, `TrackStatisticsPanel`, `AlbumArtGallery`, `RecommendedForYou`, `DashboardSmartFilter`
