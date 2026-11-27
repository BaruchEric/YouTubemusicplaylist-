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
  - Sync & playback state: `isMissingOnDevice`, `youtubeVideoId`, `youtubeTitle`, `matchStatus` (`unmatched | matched | skipped`), `youtubeChecked` (the video id YouTube last confirmed and when), `playCount`, `skipCount`, `lastPlayedAt`.
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
| `cratesync_bulk_search_memory_v1` | [`src/utils/bulkSearchMemory.ts`](../src/utils/bulkSearchMemory.ts) | Song id to the time Match YouTube last searched YouTube for it. Entries older than 30 days are dropped on read |

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

[`src/utils/youtubePush.ts`](../src/utils/youtubePush.ts) decides what to send and [`src/utils/youtubeApi.ts`](../src/utils/youtubeApi.ts) makes the five YouTube Data API v3 calls a push needs. They are the `YouTubeApi` interface. The reads that bulk matching and the 30-day check use are a separate interface, `YouTubeLookupApi`, so the push code depends on none of them. The dialog is [`src/components/YouTubePushDialog.tsx`](../src/components/YouTubePushDialog.tsx), opened from the playlist's Push to YouTube button.

1. **Review.** `estimateYouTubePush` works out, from this device alone, how many songs go, how many come off and how many changed place since the last push, so the dialog can show it before anybody signs in.
2. **Connect.** `connectYouTube` in `googleAuth.ts` opens Google's popup for the scope `https://www.googleapis.com/auth/youtube` only. A signed-in user goes through `reauthenticateWithPopup`, which refuses a different Google account. The access token lives in memory and is dropped after 50 minutes. With the token in hand the handler first runs the 30-day check of saved matches, described under bulk matching, so the push never sends a video YouTube no longer has.
3. **Read or create.** A playlist with a link is read with `playlistItems.list`, asking only for each entry's id, video id and position, and sorted by position. One without is created private with `playlists.insert`, and its link is saved on the playlist.
4. **Diff.** `planYouTubePush` adds the matched videos YouTube lacks, in playlist order. It removes an entry only when its video is in `youtubePush.videoIds` and the playlist no longer holds it. Entries CrateSync did not add are counted as left alone. `planYouTubeOrder` takes the playlist songs YouTube already has, keeps the longest run that is in playlist order, and lists the rest to move.
5. **Write.** Inserts, then deletes, then moves, one at a time. An insert names its place with `snippet.position`: right after the nearest playlist song before it that is in place, else right before the nearest one after it, else the end. A move is `playlistItems.update` with the same rule. The push keeps its own picture of the YouTube playlist and repeats every write on it, so each next position is counted on the playlist as it then stands. A busy reply (409, a rate limit, a 5xx) gets one more try after two seconds. A video YouTube no longer has is skipped. Anything else stops the push: the daily quota, an expired token, a playlist owned by another account.
   - YouTube answers `manualSortRequired` when the playlist is sorted by date or popularity. The push then adds the song without a place, moves nothing, and reports the order as `sorted-by-youtube`.
   - YouTube answers `invalidPlaylistItemPosition` when the playlist changed under the push. The push adds the song without a place, stops moving, and reports how many songs are still out of place. The next push reads the playlist again and finishes.
6. **Record.** `playlistAfterPush` stores the new `youtubePush` and stamps `updatedAt`, also after a push that stopped part way, so the next push sends only what is still missing. It also adds the songs YouTube now holds to `syncedTrackIds`, so their rows read In sync without a click on Apply Sync. A push that finished sets `lastSyncedAt` and clears the removals that were pending. A push that stopped keeps the removals it did not get to. Songs with no YouTube match stay pending.

Quota is 10,000 units a day for the Google Cloud project. A list page costs 1 and every write costs 50, a move included. Placing a new song costs nothing extra, because the insert carries the position. Moves run last, so a push that hits the quota has spent it on the songs before their order.

Asking Google for more is a compliance audit, the [Audit and Quota Extension Form](https://support.google.com/youtube/contact/yt_api_form). It wants a public privacy policy and terms of service, screenshots of both and of the consent screen, a way in for the reviewer or a screen recording of a whole push, an architecture diagram and a user flow diagram, and the applicant's legal name and address. [`YOUTUBE_AUDIT.md`](YOUTUBE_AUDIT.md) records the answers given, the files attached and where they fall short. The three diagrams are [`diagrams/architecture.mmd`](diagrams/architecture.mmd), [`diagrams/push-user-flow.mmd`](diagrams/push-user-flow.mmd) and [`diagrams/match-user-flow.mmd`](diagrams/match-user-flow.mmd), each with its PNG.

The public pages are [`privacy.html`](privacy.html), [`terms.html`](terms.html) and [`index.html`](index.html) in this folder, with [`site.css`](site.css). GitHub Pages serves `docs/` from `main` at `https://barucheric.github.io/YouTubemusicplaylist-/`, and `.nojekyll` keeps it from running Jekyll over them. [`src/utils/legalLinks.ts`](../src/utils/legalLinks.ts) holds the addresses, `LegalLinks` puts them at the foot of the sidebar, and the push review window names YouTube API Services with links to the YouTube Terms of Service, the terms and the privacy policy. [`tests/legalPages.test.ts`](../tests/legalPages.test.ts) fails when a page loses a statement YouTube's developer policy requires: that the app uses YouTube API Services, the link to the Google Privacy Policy, the Google page where access is revoked, a contact address, and the sentence binding users to the YouTube Terms of Service. A change to what CrateSync reads or stores goes into `privacy.html` in the same commit.

The push was run against the real YouTube on 2026-11-26 from music.beric.ca: one push that created a private playlist of four songs, one that added a song at its place, removed one and moved one, and one that moved a song while a song added on YouTube by hand stayed where it was. Two things to know from that run:

- Google shows "Google hasn't verified this app" before its consent page, because the project's OAuth client has not been through Google's verification. Advanced leads on to the consent page.
- A browser signed in to several Google accounts opens a playlist link with the first one, and YouTube answers "The playlist does not exist" for a private playlist another account owns. The finished window and the playlist's link say so.

## Matching many songs to YouTube

A push sends only songs that have a `youtubeVideoId`. Match YouTube on Device Storage fills that in for many songs at once. [`src/utils/bulkMatch.ts`](../src/utils/bulkMatch.ts) holds the rules, [`src/hooks/useBulkMatch.ts`](../src/hooks/useBulkMatch.ts) runs them and talks to YouTube, and [`src/components/BulkMatchDialog.tsx`](../src/components/BulkMatchDialog.tsx) is the window. It works on the songs `songsToMatch` returns: no video yet and not marked skipped. Opened with rows ticked, it works on those rows only.

1. **Videos come from one of three places.**
   - **Search.** `searchForMatches` calls `search.list` once per song with `type=video`, `videoCategoryId=10` (music) and `maxResults=5`, and asks only for each result's video id, title and channel title. The query is the artist and the title (`searchQueryFor`), without a track number the title took from the file name. `orderForSearch` puts songs that sit in a playlist first. A busy reply gets one more try after two seconds. Any other failure, the daily quota included, ends the run with what it found. The Stop button aborts between two songs.
   - **A playlist.** `playlistIdForLookup` reads the id from a link or takes a bare id, and turns YouTube Music's `LM` (liked songs) into `LL`, the name the Data API has for the same list. `listPlaylistVideos` reads it with `playlistItems.list`, this time asking for the title and `videoOwnerChannelTitle` too. An entry without an owner channel is a deleted or private video and is left out.
   - **A list.** `parseImportedText` from `youtubeLinks.ts` reads pasted lines or a CSV, M3U or JSON file, and `candidatesFromSeeds` keeps the lines that carry a video id. No YouTube call is made.
2. **Scoring.** `scoreCandidate` compares one song with one video and answers `exact`, `likely` or null.
   - Both sides are normalized: lower case, accents and punctuation dropped, `&` read as `and`.
   - A video title is split at its dashes and read three ways: the whole title with the channel as the artist, `Artist - Title`, and `Title - Artist`. Bracketed notes, a trailing `feat.` and a release note such as `2017 Remaster` are taken out first.
   - The song's title may also be matched without a leading track number, which a Drive listing leaves in ("09 Fireflies").
   - Version words (`live`, `remix`, `acoustic`, `instrumental`, `karaoke`, `cover`, `demo`, `unplugged`) must agree. The video's set has to equal the title's set, or the title's set plus the album's, so a song from a live album takes a live video or a plain one and never a karaoke one.
   - The artist is the whole tag, or the first of several tagged artists when that name has two words or six letters. It has to appear as words in the channel or in the artist part of the title, or with the spaces removed (`JoeCockerVEVO`).
   - `exact` is the same title with the artist found. `likely` is a close title (85% of the words shared) with the artist found, or the same title for a song whose artist is unknown.
3. **Picking.** Exact beats likely, then the video whose version words fit the album, then an `Artist - Topic` channel, which is the upload YouTube Music plays, then the earlier result. `planBulkMatch` indexes a playlist's videos by title and by word, so matching 2,500 songs against 5,000 videos does not compare every pair.
4. **Review and apply.** The window lists each song next to its video with a link to YouTube Music. Exact matches come ticked. `applyMatches` writes `youtubeVideoId` and `matchStatus: 'matched'` for the ticked ones and leaves a song that already has a video alone. It goes through `setTracks`, so each song is stamped and the next Drive sync carries the match.

A search costs 100 quota units (`YOUTUBE_SEARCH_COST_UNITS`) whatever it returns, so 10,000 units cover 100 songs a day and the whole of a 2,568-song library takes 26 days. The window caps one run at a day's worth and shows the cost before it starts. [`bulkSearchMemory.ts`](../src/utils/bulkSearchMemory.ts) records every song searched, matched or not, and leaves it out of later runs for 30 days, because the same query returns the same videos. "Search them again" in the window clears that record.

Of what YouTube returns, only the video id of an applied match is stored. Titles and channel names live in the window's state and are gone when it closes.

### The 30-day check of saved matches

YouTube's [developer policy](https://developers.google.com/youtube/terms/developer-policies) (section III.E.4) lets an app keep API data for 30 days. After that the app refreshes it or deletes it. A match is a video id, so [`src/utils/matchRefresh.ts`](../src/utils/matchRefresh.ts) asks YouTube whether each saved video still exists.

- `LocalTrack.youtubeChecked` holds the video id YouTube last confirmed and when. `applyMatches` sets it for a match that came from a search or a playlist read. A pasted link has none.
- `matchesDueForRefresh` picks the matched songs with no check, a check of another video id, or a check 30 days old.
- `refreshMatches` sends their ids to `videos.list` with `part=id`, 50 per call at 1 quota unit a call, and sorts them into confirmed and gone. A call YouTube refuses changes nothing.
- `applyMatchRefresh` stamps the confirmed songs and clears the match of a song whose video is gone: `youtubeVideoId` and `youtubeTitle` go to null and `matchStatus` to `unmatched`. A toast says how many.

The check runs when CrateSync holds a YouTube token anyway: in `handleStartYouTubePush` before the push reads the playlist, and in `useBulkMatch` before a search or a playlist read. CrateSync has no token while nobody is connected, so a match can pass 30 days unchecked until the next push or lookup. The check covers the whole library each time, which is 52 units for 2,568 songs.

## How a folder scan tells which song a file is

[`src/utils/scanMatch.ts`](../src/utils/scanMatch.ts) answers that for every audio file a scan finds (`createScanMatcher`), and `ingestAudioEntries` in `App.tsx` acts on the answer.

1. **Known.** The file's lower-case path and size equal a song's `fileKey`, or its path and size. The second check finds a Drive song, which keeps its `gdrive::<id>` key after it takes a local path.
2. **The local copy of a Drive song.** The file has the name and byte size of a Drive song that still sits at the path Drive gave it (`relativePath` is `drivePath` plus the file name). The scan links the two with `linkDriveSongToLocalFile`: the song takes the file's path and the scanned folder's name, keeps its id, key and Drive fields, and the audio is saved under its existing key. From then on step 1 finds it. When two Drive songs share a name and size, the one with more parent folders in common wins. Each Drive song goes to one file per scan, so a second copy of the file elsewhere becomes a new song.
3. **A loose file.** A file picked on its own has no folder. It goes to a Drive song still at its Drive path, which keeps that path, or back to a song that lost its audio on this device.
4. **New.** Anything else is parsed with `extractLocalTrack` and added.

Before this rule a file in a folder never matched a Drive song, so scanning the local copy of a Drive library added every song a second time.

Names and paths are compared after `foldFileName` in [`src/utils/fileNameKey.ts`](../src/utils/fileNameKey.ts) folds them to one Unicode spelling (NFC) and to lower case. macOS hands back "é" as "e" plus a combining accent and Google Drive sends one character, so without the fold a file such as `01 L'Eté Indien.mp3` never matched its Drive song. The first scan of a 2,568-song folder linked 2,559 songs and added the 9 with an accent in the file name a second time. The manifest merge and the Drive pull use the same key (`nameSizeKey`).

A song the Drive listing added has a duration of 0 until a file has been read. When the scan finds the local file of such a song, `readTagsFromScannedFile` in [`src/utils/driveTagReader.ts`](../src/utils/driveTagReader.ts) reads its tags and length from that file, so the song loses its file-name title in the same scan.

## Reading a Drive song's tags without downloading it

The Drive listing returns a file's name, size and folders, and `buildTrackStubFromDriveAudio` guesses the title, artist and album from them. Read Tags on the Drive Sync & Transfer page replaces the guess with what the file says.

1. **Which songs.** `needsTagRead` picks the songs with a Drive file and a duration of 0. A read sets the duration, so a song is read once.
2. **What is downloaded.** `downloadDriveFileRange` in [`src/utils/googleDriveApi.ts`](../src/utils/googleDriveApi.ts) sends `GET files/{id}?alt=media` with a `Range` header. `readTagsFromFileHead` in [`src/utils/audioMetadata.ts`](../src/utils/audioMetadata.ts) asks for the first 128 KB (`TAG_HEAD_BYTES`). An MP3 whose ID3v2 tag is longer gets one more read, and so does an MP4 whose `moov` atom sits elsewhere. A song this browser stores is read from the stored copy and costs no download.
3. **The length.** MP3 takes it from the Xing or VBRI frame count, or from the file size and the first frame's bitrate when the file has neither. MP4 takes it from `mvhd`, FLAC from `STREAMINFO`, WAV from its `fmt` and `data` chunks. An MP3 with a changing bitrate and no Xing header gets a wrong length, 10 files of 2,573 in the library this was checked against.
4. **Which fields change.** `applyFileTags` in [`src/utils/fileTags.ts`](../src/utils/fileTags.ts) is the one rule, shared with Cache Offline. A text field takes the file's value while the song still holds a placeholder or the guess from its name and folders. A value the user typed stays. Genre and year are filled only when empty, and a cover only when the song has none.
5. **The run.** `readDriveTrackTags` in `driveTagReader.ts` reads four songs at a time and hands the changes to `App.tsx` every 25 songs, so a stop or a reload keeps what was read. A rate limit waits 1, 2 and 4 seconds and then stops the run. A refused sign-in stops it and shows the reconnect state.

The changes go through `setTracks`, so a changed title, artist or album is stamped as an edit and reaches other devices with the next push. The manifest of a device that has not read a song still says 0 for its duration, and a pull keeps the duration this device knows.

## How the client code is split

`bun run build` writes about twenty scripts where it used to write one of 1.7 MB.

- **Screens.** [`src/components/LazyViews.tsx`](../src/components/LazyViews.tsx) makes each of the seven screens a `lazyComponent`, so the browser fetches a screen's script the first time that screen opens. The first page load carries the app shell and the dashboard. 1.5 seconds later `fetchAllViews` fetches the other six.
- **Dashboard charts.** [`src/components/LazyCharts.tsx`](../src/components/LazyCharts.tsx) does the same for the six charts that need Recharts or D3, about 620 kB of script with the libraries. The dashboard draws first with an empty card in each chart's place, sized to the chart's height, and the charts fill in when their scripts arrive. A chart that fails shows "This chart did not load" in its card.
- **Why not `React.lazy`.** `React.lazy` shows its fallback on the first draw even when the script is already in the browser, and React keeps a fallback on screen for 300 ms. [`src/components/lazyComponent.tsx`](../src/components/lazyComponent.tsx) draws a part at once when its code was fetched ahead, so a screen that `fetchAllViews` fetched opens with no empty frame.
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
| `audioMetadata.ts` | Binary ID3v2/ID3v1/FLAC/MP4 tag parser, cover art compressor (`160x160` JPEG), SHA-256 hashing. Also reads tags and length from the first bytes of a file through a range reader (`readTagsFromFileHead`, `readTagsFromBlob`) |
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
| `googleDriveApi.ts` | Google Drive v3 client (folder scanning, multipart and resumable uploads, downloads, byte-range downloads, manifest I/O, retry/backoff) |
| `folderMappings.ts` | Device profiles, cross-platform path normalization, Drive-to-local binding resolution, merging & tombstones |
| `libraryMerge.ts` | Joins two devices' songs and playlists for a push or a pull: newest edit wins, deletions as tombstones, edit stamps |
| `youtubeLinks.ts` | YouTube ID/playlist URL extraction, queue batch builders, M3U8/CSV/JSON/TXT import & export |
| `youtubeApi.ts` | YouTube Data API v3 client. For a push: create a playlist, list its entries in order, add one at a place, move one, remove one. For bulk matching: list a playlist's videos with titles, and search for a song. For the 30-day check: which video ids still exist. Sorts failures by what to do about them |
| `bulkMatch.ts` | Bulk matching rules: normalize titles and artists, score a video against a song, pick the best of a pool or of a search's results, run a search over many songs, apply the kept matches |
| `bulkSearchMemory.ts` | Remembers for 30 days which songs YouTube was searched for |
| `matchRefresh.ts` | The 30-day check of saved matches: which are due, the `videos.list` question, clearing the ones YouTube no longer has |
| `scanMatch.ts` | Tells which library song a scanned file is, and links a Drive song to its local file |
| `fileNameKey.ts` | Folds a file name to one Unicode spelling and lower case, and builds the name-and-size key the scan, the manifest merge and the Drive pull compare |
| `fileTags.ts` | The guess the Drive listing makes from a file's name and folders, and the one rule for which fields a file's tags replace (`applyFileTags`) |
| `driveTagReader.ts` | Read Tags: which Drive songs need a read, the run over them with retries, batches and a stop, and the tag read a folder scan does for a linked song |
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
- **Screen and chart loading**: `lazyComponent` (a part whose script the browser fetches on its own), `LazyViews` (the seven screens, `fetchAllViews`, `ViewBoundary`), `LazyCharts` (the six dashboard charts, `ChartBoundary`) and `CodeBoundary`, which shows a message in place of a part that fails to load
- **Navigation & Chrome**: `Sidebar`, `TopBar`, `MiniPlayer`, `ToastContainer`, `DashboardJumpMenu`, `DashboardQuickActionsMenu`
- **Google Drive & Folder UI**: `GoogleDriveTransferSection`, `FolderMappingsPanel`, `DriveFolderBrowserModal`, `LocalFolderBrowserModal`
- **Library Maintenance & Editing**: `TrackMatchDrawer`, `BatchTagEditorModal`, `DuplicateFinderPanel`, `AudioIntegrityPanel`, `LibraryCleanupPanel`, `Modals`, `YouTubePushDialog`, `BulkMatchDialog`, `SmartPlaylistModal`, `SmartSearchModal`
- **Analytics & Discovery**: `GenreDistributionChart`, `GlobalGenreDistributionChart`, `SmartPlaylistGenreBreakdown`, `DailyListeningChart`, `WeeklyListeningHabitsChart`, `WeeklyTracksAddedChart`, `ListeningActivityHeatmap`, `ListeningActivitySection`, `TrackStatisticsPanel`, `AlbumArtGallery`, `RecommendedForYou`, `DashboardSmartFilter`
