# CrateSync (Kotlin Multiplatform)

CrateSync is a local-first music library studio, playlist curation hub, Google Drive Source-of-Truth synchronizer, and YouTube Music playlist publisher built with **Kotlin Multiplatform (KMP)** and **Compose Multiplatform**.

## Supported Platforms

- **Android** (Compose Multiplatform + Media3 / ExoPlayer + SQLDelight Android driver + OkHttp)
- **iOS** (Compose Multiplatform via `MainViewController` + SwiftUI host `iosApp` + AVAudioEngine bridge + SQLDelight Native driver + Darwin)
- **Desktop (macOS, Windows, Linux)** (Compose Desktop JVM + dual-deck JVM audio & PCM loudness decoder + SQLDelight JDBC SQLite + CIO)
- **Web (Kotlin/WasmJs)** (ComposeViewport + Web Audio bridge + Ktor Js engine)
- **Server (`:server`)** (Ktor Netty JVM backend proxying authenticated `gemini-4-hydrogen` metadata grounding and genre classification)

## Module Layout

- `:shared` — Pure-Kotlin core engines (`BinaryAudioParser`, `AudioIntegrityScanner`, `DuplicateDetector`, `ScanMatcher`, `SyncEngine`, `LibraryMerge`, `FolderMappingMerge`, `SmartPlaylists`, `SmartSearch`, `SmartShuffle`, `AudioTransitions`, `ReplayGainEngine` ITU-R BS.1770, `AnalyticsEngine`, `YouTubeBulkMatch`, `YouTubePush` LIS optimal reorder, `MatchRefresh` 30-day policy, `GoogleDriveApiClient` 3-phase fair DFS + byte-range tags + resumable upload), SQLDelight schema (`CrateSyncDatabase.sq`), unidirectional `CrateSyncStore`, and platform adapters (`androidMain`, `iosMain`, `jvmMain`, `wasmJsMain`).
- `:composeApp` — Shared Compose Multiplatform UI across all 7 workspaces (`Dashboard`, `Device Storage`, `Playlists`, `Smart Playlists`, `Sync Queue`, `Scan Logs`, `Drive & Transfer`), adaptive navigation shell, live watcher status pill, dual-deck mini-player with crossfade/ReplayGain popovers, 6 native Canvas analytics charts, and platform entrypoints.
- `:server` — Ktor Netty JVM server verifying Firebase ID JWTs via Google JWKS, enforcing `GEMINI_ALLOWED_EMAILS` and per-account rate limits (240 req / 10 min, max 2 in-flight), and calling `gemini-4-hydrogen` strictly server-side using `GEMINI_API_KEY`.
- `iosApp/` — SwiftUI host wrapping `MainViewControllerKt.MainViewController()`.

## Environment Configuration

Copy `.env.example` and configure server-side environment variables when running `:server`:

- `GEMINI_API_KEY` — Server-only Gemini API key (never exposed to clients)
- `FIREBASE_PROJECT_ID` — Optional override (defaults to `firebase-applet-config.json`)
- `GEMINI_ALLOWED_EMAILS` — Optional comma-separated allowlist for AI routes
- `PORT` / `BIND_HOST` — Server bind settings (defaults `3000` / `0.0.0.0`)

## Build & Run Commands

Requires JDK 17+ and Gradle 8.12+ (or a local Gradle wrapper):

```bash
# Run shared multiplatform unit tests
./gradlew :shared:allTests

# Run Desktop app (macOS / Windows / Linux)
./gradlew :composeApp:run

# Build Android debug APK
./gradlew :composeApp:assembleDebug

# Run Web (Kotlin/WasmJs) dev server
./gradlew :composeApp:wasmJsBrowserDevelopmentRun

# Run Ktor Gemini AI proxy server (port 3000)
./gradlew :server:run
```

For **iOS**, build the `ComposeApp` framework (`./gradlew :composeApp:linkDebugFrameworkIosSimulatorArm64`) and open `iosApp/` in Xcode.

## Privacy & Policies

- OAuth access tokens (Google Drive & YouTube) are held strictly in memory and never persisted to disk.
- Destructive actions and remote YouTube/Google Drive writes always require explicit user confirmation.
- Legal disclosures: [Privacy Policy](docs/privacy.html) · [Terms of Service](docs/terms.html) · [YouTube API Audit](docs/YOUTUBE_AUDIT.md).
