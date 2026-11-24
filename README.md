# CrateSync

**CrateSync** is a local-first audio library manager, YouTube Music playlist synchronization studio, and multi-device Google Drive sync hub. Scan local device audio folders, extract embedded metadata and album artwork, match tracks to YouTube Music, organize libraries with Smart Playlists and analytics, and keep tracks, playlists, and folder mappings synchronized across devices via Google Drive.

## Features

### Local Library Scanning & Maintenance
- **Folder & File Ingestion**: Mount local directories via the File System Access API (`showDirectoryPicker`) in top-level Chromium contexts with automatic `webkitdirectory` and drag-and-drop fallbacks. Supports background auto-watch intervals (`Off`, `30s`, `2m`, `5m`) and missing-file detection.
- **Native Binary Metadata Parsing**: Extracts title, artist, album, genre, year, track number, duration, and compressed `160x160` JPEG album artwork directly in the browser from ID3v2, ID3v1, FLAC Vorbis comments, and MP4/M4A atoms, with path-based inference fallback.
- **Supported Audio Formats**: `.mp3`, `.m4a`, `.m4b`, `.m4p`, `.mp4`, `.flac`, `.wav`, `.ogg`, `.oga`, `.opus`, `.aac`, `.wma`, `.aiff`, `.aif`, `.aifc`, `.alac`, `.caf`, `.3gp`, `.amr`, `.webm`.
- **SHA-256 Duplicate Finder**: Detects exact file duplicates via `fileSize` + SHA-256 content hash (with a size-only fallback for unhashed files), recommends the best canonical copy to keep, and remaps playlist references cleanly on removal.
- **Audio Integrity Scanner**: Inspects binary headers, container signatures, playable streams, duration plausibility, and corrupt text tags, with one-click auto-fix for repairable metadata issues.
- **Batch Tag Editor & Cleanup**: Edit tags across multiple tracks at once, manage missing files, and standardize genres.

### YouTube Music Matching & Playlist Sync
- **Track Matching**: Link local tracks to 11-character YouTube / YouTube Music video IDs via URL or ID paste, with pre-filled YouTube Music search links for unmatched tracks.
- **Sync Queue & Diff Engine**: Configure per-playlist sync rules (`autoAddNewFiles`, `removeMissingFiles`, `autoScanIntervalSec`, `folderFilter`), inspect exact add/remove/missing deltas, apply sync snapshots, and track sync history.
- **Import & Export**: Launch instant YouTube Music queues or export/import playlists in **M3U8**, **CSV**, **JSON**, and **Plain Text** formats.

### Multi-Device Google Drive Sync
- **Google Drive as Source of Truth**: Sign in with Google via Firebase Auth using least-privilege Drive OAuth scopes (`drive.readonly` and `drive.file`, with access tokens held strictly in memory).
- **Canonical Library Manifest**: Back up and synchronize tracks, playlists, smart playlists, sync history, device registries, and folder mappings via `cratesync-source-of-truth.json` inside the `CrateSync Library` Drive folder.
- **Cross-Device Folder Mappings**: Register each playing device (`SyncDeviceProfile`) and bind Google Drive folders to device-specific local folder paths (`DriveFolderMapping`) with configurable sync directions (`pull`, `push`, `bidirectional`) and optional offline audio caching.
- **Resilient Drive API Client**: Automatic exponential backoff retries for transient rate limits (`429` / `userRateLimitExceeded`) and `5xx` errors.

### Audio Playback Engine
- **Dual-Deck Crossfade & Gapless Playback**: Configurable crossfade duration (`0–12s`, `0.5s` precision), curves (`equal-power`, `smooth-s`, `linear`), manual-skip crossfade toggle, gapless preloading, and gapless album continuity.
- **ReplayGain Loudness Normalization**: Track and album loudness analysis targeting `-14`, `-16`, or `-18 LUFS`, adjustable preamp (`-6 dB` to `+6 dB`), and peak clipping prevention.
- **Smart Shuffle**: Weighted shuffle prioritizing verified YouTube Music matches, complete metadata, local availability, and higher audio fidelity.
- **Offline Cache & On-Demand Drive Streaming**: Persists local and Drive-downloaded audio blobs in IndexedDB for reload-safe offline playback, with automatic tag enrichment when Drive stubs are cached.

### Smart Playlists, Search & Analytics
- **Rule-Based Smart Playlists**: Dynamic playlists combining `all`/`any` rules across genre, artist, album, title, format, year, play count, duration, match status, folder, and recency (`addedDaysAgo`).
- **Global Smart Search (`Cmd+K` / `Ctrl+K`)**: Supports structured query operators including `is:missing`, `is:unmatched`, `is:noart`, `lossless`, `plays:>0`, `duration:>5m`, field prefixes, and exclusions.
- **Dashboard & Visualizations**: Interactive D3 and Recharts analytics covering genre distribution, daily listening activity, weekly listening habits, weekly tracks added, listening heatmap, album art gallery, genre-based track recommendations, and saved dashboard smart filters.

### AI-Powered Metadata & Genre Enrichment
- **Google Search Metadata Lookup (`POST /api/metadata/suggest`)**: Uses Gemini with Google Search grounding to verify artist, album, canonical title, and release year for up to 25 tracks per request, returning confidence scores and grounding sources.
- **Deep Genre Classification (`POST /api/genres/classify`)**: Classifies up to 60 untagged or unclassified tracks per request into canonical music genres and subgenres.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide Icons, Motion, D3, Recharts
- **Backend**: Express 4 (serves API routes + Vite dev middleware or production `dist/` bundle)
- **AI**: `@google/genai` (server-side Gemini API with Google Search grounding)
- **Auth & Cloud Sync**: Firebase Auth + Google Drive REST API v3
- **Persistence**: IndexedDB (`CrateSyncDB`) + `localStorage` settings/stats caches

## Getting Started

### Prerequisites
- Node.js 20+ (or Bun)
- A Gemini API key (optional; required only for AI metadata lookup and deep genre classification)

### Installation

```bash
# Using Bun (lockfile included)
bun install

# Or using npm
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and configure as needed:

```bash
cp .env.example .env
```

| Variable | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Optional | Enables `/api/metadata/suggest` and `/api/genres/classify`. Without it, all local library, playback, YouTube matching, and Google Drive features still work. |
| `APP_URL` | Optional | Public URL of the hosted app (used for self-referential links / OAuth contexts). |
| `PORT` | Optional | Server port (defaults to `3000`). |
| `DISABLE_HMR` | Optional | Set to `true` to disable Vite HMR and file watching. |

> **Google Drive OAuth**: Firebase and Google OAuth client configuration is loaded from [`firebase-applet-config.json`](firebase-applet-config.json). Ensure your local or deployed origin is authorized in your Firebase / Google Cloud OAuth console when using Google Drive sign-in.

### Running the App

```bash
# Start development server (Express + Vite HMR on http://localhost:3000)
npm run dev

# Type-check with TypeScript
npm run lint

# Build production frontend bundle into dist/
npm run build

# Start production server (serves dist/ + /api/* routes; the script sets NODE_ENV=production)
npm start
```

### Available Scripts

| Script | Command | Description |
| --- | --- | --- |
| `dev` | `tsx server.ts` | Runs Express with Vite middleware in development mode |
| `build` | `vite build` | Builds the client bundle to `dist/` and copies `src/assets/` |
| `start` | `NODE_ENV=production node server.ts` | Runs the production server, serving `dist/` (run `build` first) |
| `preview` | `vite preview` | Previews the static Vite production build |
| `lint` | `tsc --noEmit` | Runs strict TypeScript type-checking |
| `clean` | `rm -rf dist server.js` | Removes build artifacts |

## Backend API

All API routes are implemented in [`server.ts`](server.ts) and accept JSON payloads up to `1mb`.

### `POST /api/metadata/suggest`
Cross-references local audio tracks via Gemini + Google Search grounding to suggest verified metadata.
- **Body**: `{ "tracks": TrackLookupInput[] }` (`1–25` tracks per request)
- **Response**: `{ "suggestions": MetadataSuggestion[], "sources": SearchSource[] }`
- **Errors**: `400` (invalid batch size), `503` (missing `GEMINI_API_KEY`), `403`/`429`/`500`

### `POST /api/genres/classify`
Classifies tracks into canonical primary genres and subgenres.
- **Body**: `{ "tracks": GenreClassifyInput[] }` (`1–60` tracks per request)
- **Response**: `{ "classifications": DeepGenreClassificationItem[] }`
- **Errors**: `400` (invalid batch size), `503` (missing `GEMINI_API_KEY`), `403`/`429`/`500`

## Project Structure

```text
.
├── server.ts                    # Express server, Vite middleware, Gemini API routes
├── index.html                   # App shell & typography
├── metadata.json                # AI Studio applet metadata
├── firebase-applet-config.json  # Firebase & Google OAuth client configuration
├── vite.config.ts               # Vite + React + Tailwind v4 + asset copy plugin
├── docs/
│   └── ARCHITECTURE.md          # Detailed data model, sync protocol & module reference
└── src/
    ├── App.tsx                  # Root workspace state, ingestion, sync & view routing
    ├── types/music.ts           # Core domain types
    ├── hooks/                   # Audio player engine & toast notifications
    ├── utils/                   # Metadata, Drive API, sync, search, ReplayGain & integrity
    └── components/              # Views, charts, player UI, Drive browsers & modals
```

For an in-depth breakdown of the data model, IndexedDB schema, multi-device Drive sync protocol, and module responsibilities, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
