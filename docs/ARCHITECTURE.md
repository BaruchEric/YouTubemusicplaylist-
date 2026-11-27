# CrateSync KMP Architecture

CrateSync is structured as a multi-module **Kotlin Multiplatform** repository sharing 100% of domain logic, audio DSP, binary tag parsing, sync engines, and Compose UI across Android, iOS, Desktop (JVM), and Web (Kotlin/WasmJs), paired with a Ktor JVM backend for server-side Gemini AI enrichment.

## Module Dependency Graph

```text
iosApp (SwiftUI host)
   └── :composeApp (Compose Multiplatform UI + Android/iOS/Desktop/WasmJs entrypoints)
          └── :shared (KMP commonMain + SQLDelight + Ktor Client + expect/actual adapters)

:server (Ktor Netty JVM AI proxy)
   └── :shared (shared AI request/response DTOs & canonical genre taxonomy)
```

## Core Architecture Layers (`:shared`)

1. **Models & Wire Schemas (`com.cratesync.model`, `com.cratesync.drive`)**
   - `kotlinx.serialization` DTOs wire-compatible with `cratesync-source-of-truth.json` (tracks, playlists, smart playlists, sync events, 365-day library tombstones, multi-device profiles, per-device Drive folder bindings, and folder-mapping tombstones).
2. **Local Persistence (`CrateSyncDatabase.sq`, `LibraryRepository`)**
   - SQLDelight stores tracks, playlists, smart playlists, scan logs, watched folders, folder mappings, tombstones, play stats/history, ITU-R BS.1770 loudness cache, and preferences.
   - `LibraryRepository` automatically stamps `updatedAt` on edits for conflict-free multi-device merging.
3. **Pure-Kotlin Domain & DSP Engines (`com.cratesync.core`)**
   - **Scanning & Binary Inspection**: Unicode NFC `foldFileName`, `ScanMatcher` (multi-folder + Drive stub linking), `BinaryAudioParser` (ID3v2/ID3v1/FLAC/MP4/WAV + 128 KB HTTP byte-range support), `AudioIntegrityScanner`, pure-Kotlin FIPS 180-4 `Sha256`, `DuplicateDetector` (quality keep-score + playlist remapping).
   - **Playback & DSP**: `AudioTransitions` (`equal-power`, `smooth-s`, `linear`, gapless album continuity), `ReplayGainEngine` (ITU-R BS.1770 K-weighting biquad filter, gated LUFS, EBU R128 album gain, peak clipping guard), `SmartShuffle`.
   - **Discovery & Analytics**: `SmartPlaylists` (11-field evaluator + 5 presets), `SmartSearch` (structured operators + fuzzy ranking), `AnalyticsEngine` (genre distribution, daily/weekly listening, weekly added, 12-week heatmap, album gallery, track stats, recommendations).
   - **Conflict-Free Sync**: `LibraryMerge` and `FolderMappingMerge` (newest-edit wins, 365-day tombstones, audio-holder revival).
4. **Cloud Integrations (`com.cratesync.drive`, `com.cratesync.youtube`, `com.cratesync.ai`)**
   - **Google Drive**: `DriveFairDfsFolderCounter` (3-phase fair DFS per parent folder so deep `Music` trees are never starved), byte-range tag reader, multipart (<= 5 MB) and resumable (> 5 MB) uploads.
   - **YouTube Music**: `YouTubeBulkMatch` (version-word safety, Topic channel priority, `LM` -> `LL`, 30-day search memory), `MatchRefresh` (30-day `videos.list` freshness policy), `YouTubePush` (3-pass safe push + Longest Increasing Subsequence minimal reordering).
   - **AI Proxy Client**: `AiProxyClient` sending Bearer Firebase ID tokens with automatic `429 Retry-After` backoff.
5. **Unidirectional State (`CrateSyncStore`, `PlaybackController`)**
   - Exposes `StateFlow` snapshots consumed by Compose Multiplatform (`CrateSyncApp`).
   - Enforces in-memory-only OAuth tokens and explicit confirmation modals before destructive or remote writes.

## Server-Side AI Proxy (`:server`)

- **Authentication & Rate Limiting (`FirebaseAuthGuard`)**: Verifies Google-issued Firebase ID JWTs against Google's official JWKS endpoint before parsing request bodies, optionally checks `GEMINI_ALLOWED_EMAILS`, and enforces 240 requests / 10 minutes + max 2 concurrent requests per account.
- **Gemini Service (`GeminiService`)**: Reads `GEMINI_API_KEY` from server environment only and calls `gemini-4-hydrogen`:
  - `POST /api/metadata/suggest` (1..25 tracks): Google Search grounding + structured JSON schema.
  - `POST /api/genres/classify` (1..60 tracks): `thinkingLevel: LOW` + strict 20-genre canonical enum schema.
  - `GET /api/health`: Service health check.
