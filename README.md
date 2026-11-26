# CrateSync

**CrateSync** is a local-first audio library manager that sends your playlists to YouTube Music and keeps the library in step across devices through Google Drive. Scan local device audio folders, extract embedded metadata and album artwork, match tracks to YouTube Music, push each playlist to your YouTube account, organize libraries with Smart Playlists and analytics, and keep tracks, playlists, and folder mappings synchronized across devices via Google Drive.

It runs at https://music.beric.ca ([`docs/DEPLOY.md`](docs/DEPLOY.md)).

## Features

### Local Library Scanning & Maintenance
- **Folder & File Ingestion**: Mount local directories via the File System Access API (`showDirectoryPicker`) in top-level Chromium contexts with automatic `webkitdirectory` and drag-and-drop fallbacks. Supports background auto-watch intervals (`Off`, `30s`, `2m`, `5m`) and missing-file detection. The interval is one setting for the whole app and is saved in the browser. After a reload the browser withholds folder access until a click, so the watcher shows `Paused` until you click it or press Re-scan.
- **Native Binary Metadata Parsing**: Extracts title, artist, album, genre, year, track number, duration, and compressed `160x160` JPEG album artwork directly in the browser from ID3v2, ID3v1, FLAC Vorbis comments, and MP4/M4A atoms, with path-based inference fallback.
- **Supported Audio Formats**: `.mp3`, `.m4a`, `.m4b`, `.m4p`, `.mp4`, `.flac`, `.wav`, `.ogg`, `.oga`, `.opus`, `.aac`, `.wma`, `.aiff`, `.aif`, `.aifc`, `.alac`, `.caf`, `.3gp`, `.amr`, `.webm`.
- **SHA-256 Duplicate Finder**: Detects exact file duplicates via `fileSize` + SHA-256 content hash (with a size-only fallback for unhashed files), recommends the best canonical copy to keep, and remaps playlist references cleanly on removal.
- **Audio Integrity Scanner**: Inspects binary headers, container signatures, playable streams, duration plausibility, and corrupt text tags, with one-click auto-fix for repairable metadata issues.
- **Batch Tag Editor & Cleanup**: Edit tags across multiple tracks at once, manage missing files, and standardize genres.

### YouTube Music Matching & Playlist Sync
- **Track Matching**: Link local tracks to 11-character YouTube / YouTube Music video IDs via URL or ID paste, with pre-filled YouTube Music search links for unmatched tracks.
- **Push to YouTube**: The button on a playlist creates a private playlist on your YouTube account, which YouTube Music shows too, and adds every matched song. Later pushes send only the difference: a new song goes in at its place in the playlist, a song that is out of place is moved, and a song comes off YouTube only when an earlier push put it there and it has since left the playlist. Songs you added on YouTube yourself stay and are never moved. Paste a playlist link under Edit details to send to a playlist you already have. The first push opens Google's window and asks for the YouTube scope (`https://www.googleapis.com/auth/youtube`). The token stays in memory and lasts under an hour.
  - YouTube gives the app's Google Cloud project 10,000 quota units a day, and adding, moving or removing a song costs 50, so a day holds about 200 changes. A bigger push stops at the limit and the next push carries on from there.
  - Songs are added and removed before any song is moved, so a push that hits the limit has the right songs first and the right order later. The fewest songs that put the playlist in order are moved.
  - A YouTube playlist that YouTube sorts by date or popularity cannot take an order. The push says so and leaves the order alone until you set that playlist to manual order on YouTube.
  - Unmatched songs stay behind until you match them.
  - On a second device, pull from Drive before the first push. Otherwise that device creates a second YouTube playlist for the same CrateSync playlist.
- **Sync Queue & Diff Engine**: Configure per-playlist sync rules (`autoAddNewFiles`, `removeMissingFiles`, `folderFilter`), inspect exact add/remove/missing deltas, apply sync snapshots, and track sync history. Apply Sync updates CrateSync's own record of the folder. It sends nothing to YouTube. Push to YouTube does that.
- **Import & Export**: Open a temporary YouTube Music queue of up to 50 matched songs without signing in, or export/import playlists in **M3U8**, **CSV**, **JSON**, and **Plain Text** formats. YouTube does not let you save that queue as a playlist in one step, which is what Push to YouTube is for.

### Multi-Device Google Drive Sync
- **Google Drive as Source of Truth**: Sign in with Google via Firebase Auth using least-privilege Drive OAuth scopes (`drive.readonly` and `drive.file`, with access tokens held strictly in memory).
- **Canonical Library Manifest**: Back up and synchronize tracks, playlists, smart playlists, sync history, device registries, and folder mappings via `cratesync-source-of-truth.json` inside the `CrateSync Library` Drive folder.
- **Cross-Device Folder Mappings**: Register each playing device (`SyncDeviceProfile`) and bind Google Drive folders to device-specific local folder paths (`DriveFolderMapping`) with configurable sync directions (`pull`, `push`, `bidirectional`) and optional offline audio caching. Deleting a mapping or unbinding a device writes a tombstone to the manifest, so the deletion reaches every device instead of coming back on the next merge. Each push reads the current manifest and merges its devices, mappings and tombstones before writing.
- **Two Devices, One Library**: A push joins this device's songs and playlists with what Drive already holds, so it never drops what another device pushed. Where both changed the same song or playlist, the newer edit wins. Deleting a song, playlist or smart playlist is recorded, so a merge does not bring it back. A device that still has a deleted song's file keeps the song. A push that fails part way does not upload the same songs again.
- **Resilient Drive API Client**: Automatic exponential backoff retries for transient rate limits (`429` / `userRateLimitExceeded`) and `5xx` errors. Files over 5 MB (large audio files and big library manifests) go up as resumable uploads, which pick up after a dropped connection.

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
- **Backend**: Express 4 (serves API routes + Vite dev middleware or the production build in `dist/`)
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
| `GEMINI_ALLOWED_EMAILS` | Optional | Comma-separated Google accounts allowed to use the AI endpoints. When unset, any Google account that signs in to the app can use them, within the rate limit. Set it on any server reachable from the internet. |
| `BIND_HOST` | Optional | Address the server listens on (defaults to `0.0.0.0`). Set `127.0.0.1` to keep a local server off the network. |
| `APP_URL` | Unused | AI Studio sets it for applets it hosts. Nothing in this code reads it, and the deployment at music.beric.ca does not set it. |
| `PORT` | Optional | Server port (defaults to `3000`). |
| `DISABLE_HMR` | Optional | Set to `true` to disable Vite HMR and file watching. |

> **Google Drive OAuth**: Firebase and Google OAuth client configuration is loaded from [`firebase-applet-config.json`](firebase-applet-config.json). Google sign-in works only from an origin the Firebase project knows in three places: Auth's authorized domains (Authentication, Settings, Authorized domains), the HTTP referrers allowed on the browser API key in `apiKey`, and the domains of the reCAPTCHA Enterprise key in `recaptchaSiteKey`, which Firebase App Check uses. App Check is enforced for Authentication, so an origin missing from the reCAPTCHA key cannot sign in. The key allows `localhost` on ports 3000 to 3002 and the AI Studio preview hosts, so a local server works at `http://localhost:3000`. The same three places also list `music.beric.ca`, where the app is deployed ([`docs/DEPLOY.md`](docs/DEPLOY.md)). To serve from anywhere else, add the origin in all three places.
>
> **Push to YouTube** needs one more thing on that Google Cloud project: the YouTube Data API v3 (`youtube.googleapis.com`) switched on. It has been on since 2026-11-26. The calls carry the user's OAuth token, so the browser API key's restrictions do not apply to them.

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
| `build` | `vite build` | Builds the client to `dist/`, one script per screen plus one per library group, and copies `src/assets/` |
| `start` | `NODE_ENV=production node server.ts` | Runs the production server, serving `dist/` (run `build` first) |
| `preview` | `vite preview` | Previews the static Vite production build |
| `lint` | `tsc --noEmit` | Runs strict TypeScript type-checking |
| `test` | `bun test` | Runs the unit tests in `tests/` (AI endpoint sign-in check, folder mapping merges, the two-device library merge, Drive uploads, the YouTube push and its API client, playlist diffs and imports, the folder watcher, exports) |
| `deploy` | `deploy/deploy-mini.sh` | Deploys the committed tree to https://music.beric.ca. See [`docs/DEPLOY.md`](docs/DEPLOY.md) |
| `clean` | `rm -rf dist server.js` | Removes build artifacts |

## Backend API

All API routes are implemented in [`server.ts`](server.ts) and accept JSON payloads up to `1mb`.

Every `/api` request needs an `Authorization: Bearer` header carrying a Firebase ID token from a Google sign-in to this app's Firebase project. The client sends it automatically once the user has signed in with Google on the Drive Sync & Transfer page; signed out, AI lookups show a "Sign in with Google" error. The dev server works the same way. Open it at `http://localhost:3000`, not `127.0.0.1`: `localhost` is an authorized domain in this Firebase project and `127.0.0.1` is not, so Google sign-in fails there. [`server/aiAccess.ts`](server/aiAccess.ts) verifies the token against Google's published keys, rejects anonymous sign-ins, applies `GEMINI_ALLOWED_EMAILS` when set, and allows each account 240 requests per 10 minutes with at most 2 in flight. The client waits out a `429` using its `Retry-After` header and tries again, up to three times.

### `POST /api/metadata/suggest`
Cross-references local audio tracks via Gemini + Google Search grounding to suggest verified metadata.
- **Body**: `{ "tracks": TrackLookupInput[] }` (`1–25` tracks per request)
- **Response**: `{ "suggestions": MetadataSuggestion[], "sources": SearchSource[] }`
- **Errors**: `401` (no valid sign-in), `403` (account not on the allowlist, or Gemini rejected the key), `400` (invalid batch size), `429` (rate limit, with `Retry-After`), `503` (missing `GEMINI_API_KEY`), `500`

### `POST /api/genres/classify`
Classifies tracks into canonical primary genres and subgenres.
- **Body**: `{ "tracks": GenreClassifyInput[] }` (`1–60` tracks per request)
- **Response**: `{ "classifications": DeepGenreClassificationItem[] }`
- **Errors**: same as `/api/metadata/suggest`

## Project Structure

```text
.
├── server.ts                    # Express server, Vite middleware, Gemini API routes
├── server/aiAccess.ts           # Sign-in check and rate limit for the Gemini routes
├── server/builtApp.ts           # Serves dist/ in production: cache rules and the page fallback
├── tests/                       # bun test unit tests
├── index.html                   # App shell & typography
├── metadata.json                # AI Studio applet metadata
├── firebase-applet-config.json  # Firebase & Google OAuth client configuration
├── vite.config.ts               # Vite + React + Tailwind v4, library file groups, asset copy plugin
├── deploy/                      # systemd unit and the deploy script for music.beric.ca
├── docs/
│   ├── ARCHITECTURE.md          # Detailed data model, sync protocol & module reference
│   └── DEPLOY.md                # How the app is deployed and what makes the hostname work
└── src/
    ├── App.tsx                  # Root workspace state, ingestion, sync & view routing
    ├── types/music.ts           # Core domain types
    ├── hooks/                   # Audio player engine & toast notifications
    ├── utils/                   # Metadata, Drive API, sync, search, ReplayGain & integrity
    └── components/              # Views, charts, player UI, Drive browsers & modals
```

For an in-depth breakdown of the data model, IndexedDB schema, multi-device Drive sync protocol, and module responsibilities, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
