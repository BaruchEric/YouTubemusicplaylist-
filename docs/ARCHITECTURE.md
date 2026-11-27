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

- **`LocalTrack`**: Represents an indexed audio file, a Drive catalog stub, or a list-only entry. A list-only entry comes from an imported playlist file and has no audio behind it: `format` is `YT` (the list gave a video ID) or `LIST`, and `fileSize` is `0`. [`trackSource.ts`](../src/utils/trackSource.ts) tells the kinds apart; folder rules and file counts leave list-only entries out.
  - Identity: `id` (UUID), `fileKey` (`<relativePath.toLowerCase()>::<fileSize>`), optional SHA-256 `contentHash`.
  - `updatedAt` (optional): when the tags or the YouTube match last changed. Two devices that edited the same song settle it by this.
  - Metadata: `title`, `artist`, `album`, `genre`, `year`, `trackNumber`, `duration`, `format`, `fileSize`, `coverArtUrl`.
  - Sync & playback state: `isMissingOnDevice`, `youtubeVideoId`, `youtubeTitle`, `matchStatus` (`unmatched | matched | skipped`), `playCount`, `skipCount`, `lastPlayedAt`.
  - Google Drive linkage: `driveFileId`, `driveModifiedTime`, `drivePath`, `cachedOnDeviceAt`.
- **`Playlist`**: Ordered `trackIds`, last-synced snapshot `syncedTrackIds`, `youtubePlaylistUrl` (a link the user pasted, or the playlist the first push created), optional `youtubePush` (`YouTubePushRecord`: the YouTube playlist id, the video ids CrateSync itself added to it in the order YouTube has them, and when), `watchedFolderName`, and `SyncRule` (`autoAddNewFiles`, `removeMissingFiles`, `folderFilter`). A new or imported playlist starts with `syncedTrackIds: []` and `lastSyncedAt: null`. Records saved before 2026-11-26 may still carry `syncRule.autoScanIntervalSec`; nothing reads it, because the watch interval is app-wide.
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
| `app_state` | `'main'` | Persists `tracks`, `playlists`, `smartPlaylists`, `syncHistory`, `watchedFolderName`, `lastScannedAt`, `devices`, `folderMappings`, `folderMappingTombstones` and `libraryTombstones` (falls back to `localStorage` key `cratesync_library_v1` if IndexedDB is unavailable). |
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
| `cratesync_auto_watch_interval_v1` | [`src/utils/folderWatch.ts`](../src/utils/folderWatch.ts) | Seconds between timed checks of the watched folder (`0`, `30`, `120` or `300`), one value for the whole app |
| `cratesync_drive_folder_scope_v1` | [`src/components/GoogleDriveTransferSection.tsx`](../src/components/GoogleDriveTransferSection.tsx) | Last selected Google Drive folder scope |

> **Security note**: Google Drive OAuth access tokens in [`src/utils/googleAuth.ts`](../src/utils/googleAuth.ts) are stored **exclusively in memory** and are never written to `localStorage`, `sessionStorage`, or IndexedDB.

## Multi-Device Google Drive Sync Protocol

Implemented across [`src/utils/googleAuth.ts`](../src/utils/googleAuth.ts), [`src/utils/googleDriveApi.ts`](../src/utils/googleDriveApi.ts), [`src/utils/folderMappings.ts`](../src/utils/folderMappings.ts), and [`src/components/GoogleDriveTransferSection.tsx`](../src/components/GoogleDriveTransferSection.tsx):

1. **Authentication**: Uses Firebase Auth `signInWithPopup` with `GoogleAuthProvider` requesting two least-privilege scopes:
   - `https://www.googleapis.com/auth/drive.readonly` (browse, search, download audio and playlist files)
   - `https://www.googleapis.com/auth/drive.file` (create/update CrateSync backups and uploaded audio)

   Firebase App Check runs beside it: `googleAuth.ts` starts App Check with a `ReCaptchaEnterpriseProvider` for the `recaptchaSiteKey` in `firebase-applet-config.json`, so Firebase Auth requests carry an attestation token. The project enforces App Check for Authentication and Cloud Firestore since 2026-11-24, so a sign-in request without a token is refused. The server never calls Firebase Auth: `server/aiAccess.ts` checks ID tokens locally against Google's published keys, which App Check does not gate.
2. **Canonical Manifest**: Stored as `cratesync-source-of-truth.json` (`schemaVersion: 1`) inside the `CrateSync Library` Drive folder. Contains tracks, playlists, smart playlists, sync history, `devices`, `folderMappings`, `folderMappingTombstones` and `libraryTombstones` (both optional; manifests written before they existed parse with none). Both push paths download the current manifest and join it with this device's library, devices and mappings before writing, so a device that had not pulled cannot erase what other devices wrote. The rules for songs and playlists are under item 5. Uploads of 5 MB or less use one multipart request; larger files, including big manifests, use a resumable upload that resumes from the byte the session reports after a dropped connection, or starts a fresh session when that count is unreadable.
3. **Path Translation & Folder Bindings**:
   - Paths are normalized across Windows/macOS/Linux/mobile (`normalizeFolderPath`).
   - When pushing local audio, `resolveDriveMappingForLocalTrack` selects the most specific `push` or `bidirectional` mapping for the current device.
   - When pulling from Drive, `resolveLocalBindingForDriveFolder` and `translateRelativePathForDevice` project remote files onto the current device's local folder structure (or IndexedDB-only cache when unbound).
   - `mergeDeviceProfiles` and `mergeFolderMappingState` merge registries across devices while preserving each device's independent local bindings. `mergeFolderMappingState` unions tombstones (latest per mapping or binding, dropped after 365 days), merges mappings, then removes every binding whose `updatedAt` is not newer than a tombstone covering it, and every mapping left without bindings. Comparing the binding's `updatedAt` rather than the mapping's means a stale device marking a sync cannot bring a deleted mapping back, while a binding saved after the deletion survives.
4. **On-Demand Streaming & Tag Enrichment**: When playing a Drive-synced stub that is not yet cached locally, `useAudioPlayer` fetches the audio blob from Drive, stores it in `audio_blobs`, and triggers `extractLocalTrack` in [`src/App.tsx`](../src/App.tsx) to populate embedded ID3/FLAC/MP4 tags, cover art, duration, and `contentHash`.
5. **Merging two devices' libraries** ([`src/utils/libraryMerge.ts`](../src/utils/libraryMerge.ts)):
   - **Push** writes `mergeLibraryForPush(local, remote)`. A song, playlist or smart playlist that only Drive holds stays in the manifest. A song both sides have is one record under the pushing device's ID, matched by Drive file ID, then ID, then `fileKey`, then file name and size. Remote playlists have their track IDs rewritten to match. The push leaves the library on screen as it was, except for Drive links and deletions, and its result message counts what it kept from other devices.
   - **Conflicts** go to the newer `updatedAt`. For a song that covers the tags and the YouTube match only, since the rest of a track describes the file on one device. A playlist or smart playlist is taken whole from the side that changed it last. On a tie the pushing device wins a push and Drive wins a pull. `setTracks` and `setPlaylists` in `App.tsx` are wrappers that stamp `updatedAt` on every edit (`stampEditedTracks`, `stampEditedPlaylists`), so no handler has to remember to.
   - **Deletions** are `LibraryTombstone` records, written when a song, playlist or smart playlist is deleted and dropped after 365 days. A tombstone removes a playlist whose `updatedAt` is not newer than it. It removes a song whose `updatedAt` and `addedAt` are both not newer, and only on a device that does not hold the audio. A device that has the file keeps the song and marks it changed, which ends the deletion everywhere: the library follows the folder, so the next scan would add the song back anyway.
   - **Pull** in merge mode applies the same rules with `newestWins`, `newerTrackEdits` and `dropTombstoned`. Mirror mode takes Drive's copy as it is, and so does a restore from a backup file. Both mark whatever they bring back as changed (`reviveTombstoned`), so an earlier deletion does not remove it again.
   - Each uploaded file's Drive link is saved as soon as that upload finishes. A push that fails part way does not upload the same songs again.

## Pushing a playlist to YouTube

[`src/utils/youtubePush.ts`](../src/utils/youtubePush.ts) decides what to send and [`src/utils/youtubeApi.ts`](../src/utils/youtubeApi.ts) makes the five YouTube Data API v3 calls. The dialog is [`src/components/YouTubePushDialog.tsx`](../src/components/YouTubePushDialog.tsx), opened from the playlist's Push to YouTube button.

1. **Review.** `estimateYouTubePush` works out, from this device alone, how many songs go, how many come off and how many changed place since the last push, so the dialog can show it before anybody signs in.
2. **Connect.** `connectYouTube` in `googleAuth.ts` opens Google's popup for the scope `https://www.googleapis.com/auth/youtube` only. A signed-in user goes through `reauthenticateWithPopup`, which refuses a different Google account. The access token lives in memory and is dropped after 50 minutes.
3. **Read or create.** A playlist with a link is read with `playlistItems.list`, asking only for each entry's id, video id and position, and sorted by position. One without is created private with `playlists.insert`, and its link is saved on the playlist.
4. **Diff.** `planYouTubePush` adds the matched videos YouTube lacks, in playlist order. It removes an entry only when its video is in `youtubePush.videoIds` and the playlist no longer holds it. Entries CrateSync did not add are counted as left alone. `planYouTubeOrder` takes the playlist songs YouTube already has, keeps the longest run that is in playlist order, and lists the rest to move.
5. **Write.** Inserts, then deletes, then moves, one at a time. An insert names its place with `snippet.position`: right after the nearest playlist song before it that is in place, else right before the nearest one after it, else the end. A move is `playlistItems.update` with the same rule. The push keeps its own picture of the YouTube playlist and repeats every write on it, so each next position is counted on the playlist as it then stands. A busy reply (409, a rate limit, a 5xx) gets one more try after two seconds. A video YouTube no longer has is skipped. Anything else stops the push: the daily quota, an expired token, a playlist owned by another account.
   - YouTube answers `manualSortRequired` when the playlist is sorted by date or popularity. The push then adds the song without a place, moves nothing, and reports the order as `sorted-by-youtube`.
   - YouTube answers `invalidPlaylistItemPosition` when the playlist changed under the push. The push adds the song without a place, stops moving, and reports how many songs are still out of place. The next push reads the playlist again and finishes.
6. **Record.** `playlistAfterPush` stores the new `youtubePush` and stamps `updatedAt`, also after a push that stopped part way, so the next push sends only what is still missing.

Quota is 10,000 units a day for the Google Cloud project. A list page costs 1 and every write costs 50, a move included. Placing a new song costs nothing extra, because the insert carries the position. Moves run last, so a push that hits the quota has spent it on the songs before their order.

Asking Google for more is a compliance audit, the [Audit and Quota Extension Form](https://support.google.com/youtube/contact/yt_api_form). It wants a public privacy policy and terms of service, screenshots of both and of the consent screen, a way in for the reviewer or a screen recording of a whole push, an architecture diagram and a user flow diagram, and the applicant's legal name and address. CrateSync has none of the public pages, so the form has not been sent.

The push was run against the real YouTube on 2026-11-26 from music.beric.ca: one push that created a private playlist of four songs, one that added a song at its place, removed one and moved one, and one that moved a song while a song added on YouTube by hand stayed where it was. Two things to know from that run:

- Google shows "Google hasn't verified this app" before its consent page, because the project's OAuth client has not been through Google's verification. Advanced leads on to the consent page.
- A browser signed in to several Google accounts opens a playlist link with the first one, and YouTube answers "The playlist does not exist" for a private playlist another account owns. The finished window and the playlist's link say so.

## How the client code is split

`bun run build` writes about fifteen scripts where it used to write one of 1.7 MB.

- **Screens.** [`src/components/LazyViews.tsx`](../src/components/LazyViews.tsx) wraps the seven screens in `React.lazy`, so the browser fetches a screen's script the first time that screen opens. The first page load carries the app shell and the dashboard. 1.5 seconds later `fetchAllViews` fetches the other six, so a later click opens at once.
- **Libraries.** `build.rolldownOptions.output.codeSplitting` in [`vite.config.ts`](../vite.config.ts) puts React, Firebase, Recharts, D3 and the icons in files of their own. Their names change only on an upgrade, so a deploy of app code leaves them in the browser's cache.
- **A tab left open through a deploy.** The deploy replaces the scripts, and a tab from before it can ask for one that is gone. The server answers `404`, Vite fires `vite:preloadError`, and [`src/utils/staleCode.ts`](../src/utils/staleCode.ts) reloads the page once. It does not reload again within 60 seconds, when the browser is offline, or for the background fetch of the other screens. If the script is still missing after the reload, `ViewBoundary` shows "This screen did not load" with a Reload button in place of that screen, and the sidebar and the player keep working.

## Audio Playback Pipeline

Managed by [`src/hooks/useAudioPlayer.ts`](../src/hooks/useAudioPlayer.ts), [`src/utils/audioTransitions.ts`](../src/utils/audioTransitions.ts), [`src/utils/replayGain.ts`](../src/utils/replayGain.ts), and [`src/utils/smartShuffle.ts`](../src/utils/smartShuffle.ts):

- **Source Resolution**: Checks in-memory `fileMapRef` first, then IndexedDB `audio_blobs`, then Google Drive (if `driveFileId` and an active OAuth token exist), falling back to YouTube playback mode when no local/Drive binary is available.
- **Transitions**: Uses a dual-deck setup for scheduled crossfades (`equal-power`, `smooth-s`, or `linear` gain curves) and gapless preloading. When `gaplessAlbumContinuity` is enabled, consecutive tracks from the same album play gaplessly instead of crossfading.
- **ReplayGain**: Computes integrated loudness (LUFS) and peak amplitude per track/album, applies gain compensation toward the selected target (`-14`, `-16`, or `-18 LUFS`) plus preamp offset, and caps gain when peak clipping prevention is enabled.
- **Telemetry**: Records completed vs. skipped play events into `playStats` and `playHistory`, feeding dashboard analytics, Smart Playlists, and Smart Search.

## Server Architecture

[`server.ts`](../server.ts) runs a single Express HTTP server on `${BIND_HOST || '0.0.0.0'}:${PORT || 3000}`:

- **AI endpoint access**: [`server/aiAccess.ts`](../server/aiAccess.ts) guards every `/api` route before the body is parsed. It verifies a Firebase ID token (`Authorization: Bearer`) with `jose` against Google's securetoken keys, with issuer and audience bound to the `projectId` in `firebase-applet-config.json`, and accepts only Google sign-ins. `GEMINI_ALLOWED_EMAILS`, when set, limits use to those verified emails. Each account gets 240 requests per 10 minutes and 2 in flight; over that it answers `429` with `Retry-After`. Development mode gets no exception: `localhost` is an authorized Firebase domain, so a local run signs in like the deployed app. The client side is [`src/utils/aiApi.ts`](../src/utils/aiApi.ts), which waits for Firebase to restore the session, attaches the token, and retries a `429` up to three times.
- **Development (`NODE_ENV !== 'production'`)**: Attaches Vite in middleware mode (`appType: 'spa'`) for live module serving and HMR.
- **Production (`NODE_ENV === 'production'`)**: [`server/builtApp.ts`](../server/builtApp.ts) serves `dist/`. A script or stylesheet whose name ends in a content hash goes out with `Cache-Control: public, max-age=31536000, immutable`. A file under `/assets` that does not exist answers `404` as plain text. Any other address gets `dist/index.html`, which the browser checks again on each visit.
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
| `syncEngine.ts` | Directory walking, drag-and-drop entry traversal, playlist diff computation, the folder-scope rule |
| `folderWatch.ts` | The saved watch interval, the folder permission query, and the watcher status (`watching`, `paused`, `syncing`, `idle`) |
| `trackSource.ts` | Tells device files from list-only entries |
| `playlistImport.ts` | Plans what importing a playlist file adds: the playlist, new list-only entries, YouTube IDs for songs already owned |
| `scanLogExport.ts` | Builds the Scan Logs JSON download |
| `deviceCache.ts` | Counts cached songs with no Drive copy and words the Clear Device Cache dialog |
| `storage.ts` | IndexedDB (`CrateSyncDB`) wrapper for library state, directory handles, and audio blobs |
| `googleAuth.ts` | Firebase Google OAuth sign-in/out, in-memory Drive token management, the separate in-memory YouTube token (`connectYouTube`), Firebase ID tokens for the AI endpoints |
| `googleDriveApi.ts` | Google Drive v3 client (folder scanning, multipart and resumable uploads, downloads, manifest I/O, retry/backoff) |
| `folderMappings.ts` | Device profiles, cross-platform path normalization, Drive-to-local binding resolution, merging & tombstones |
| `libraryMerge.ts` | Joins two devices' songs and playlists for a push or a pull: newest edit wins, deletions as tombstones, edit stamps |
| `youtubeLinks.ts` | YouTube ID/playlist URL extraction, queue batch builders, M3U8/CSV/JSON/TXT import & export |
| `youtubeApi.ts` | YouTube Data API v3 client for a push: create a playlist, list its entries in order, add one at a place, move one, remove one, and sort failures by what to do about them |
| `youtubePush.ts` | Plans and runs a push to YouTube: the estimate shown before sign-in, the diff, which songs have to move, the write loop, and the record stored on the playlist |
| `smartPlaylists.ts` | Smart Playlist rule definitions, field metadata, and evaluation/sorting engine |
| `smartSearch.ts` | Global search tokenizer, query operator parser, and scored track/album/genre/playlist matching |
| `dashboardSmartFilters.ts` | Dashboard quick criteria, custom rule evaluation, and saved filter storage |
| `duplicateDetector.ts` | Exact hash+size and size-only duplicate grouping with keep-candidate scoring |
| `genreInference.ts` | Local genre tag normalization, ID3v1 genre lookup, heuristic inference, and track statistics |
| `aiApi.ts` | Authenticated POST helper for the Gemini endpoints (Firebase ID token, `429` retry) |
| `genreClassifier.ts` | Client batch wrapper for `POST /api/genres/classify` |
| `metadataLookup.ts` | Client batch wrapper for `POST /api/metadata/suggest` |
| `recommendations.ts` | Genre-profile and genre-adjacency track recommendations |
| `staleCode.ts` | Reloads the page once when a screen's script is gone after a deploy, with the rule that stops a reload loop |

### `src/components/`
- **Core Workspace Views**: `DashboardView`, `ScannerView`, `PlaylistView`, `SmartPlaylistView`, `SyncQueueView`, `ScanLogView`, `TransferView`
- **Screen loading**: `LazyViews` (the seven screens as `React.lazy` components, `fetchAllViews`, and `ViewBoundary`, which shows a message when a screen fails to load)
- **Navigation & Chrome**: `Sidebar`, `TopBar`, `MiniPlayer`, `ToastContainer`, `DashboardJumpMenu`, `DashboardQuickActionsMenu`
- **Google Drive & Folder UI**: `GoogleDriveTransferSection`, `FolderMappingsPanel`, `DriveFolderBrowserModal`, `LocalFolderBrowserModal`
- **Library Maintenance & Editing**: `TrackMatchDrawer`, `BatchTagEditorModal`, `DuplicateFinderPanel`, `AudioIntegrityPanel`, `LibraryCleanupPanel`, `Modals`, `YouTubePushDialog`, `SmartPlaylistModal`, `SmartSearchModal`
- **Analytics & Discovery**: `GenreDistributionChart`, `GlobalGenreDistributionChart`, `SmartPlaylistGenreBreakdown`, `DailyListeningChart`, `WeeklyListeningHabitsChart`, `WeeklyTracksAddedChart`, `ListeningActivityHeatmap`, `ListeningActivitySection`, `TrackStatisticsPanel`, `AlbumArtGallery`, `RecommendedForYou`, `DashboardSmartFilter`
