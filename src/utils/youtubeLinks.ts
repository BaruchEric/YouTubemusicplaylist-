import type { LocalTrack, Playlist } from '../types/music';

const YT_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Extracts a canonical 11-character YouTube video ID from a URL or raw ID.
 */
export function extractYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (YT_VIDEO_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  try {
    const normalized = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const candidate = url.pathname.split('/').filter(Boolean)[0];
      return candidate && YT_VIDEO_ID_REGEX.test(candidate) ? candidate : null;
    }

    if (
      host === 'youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'm.youtube.com'
    ) {
      const vParam = url.searchParams.get('v');
      if (vParam && YT_VIDEO_ID_REGEX.test(vParam)) {
        return vParam;
      }

      const parts = url.pathname.split('/').filter(Boolean);
      if (
        (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'v') &&
        parts[1] &&
        YT_VIDEO_ID_REGEX.test(parts[1])
      ) {
        return parts[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Extracts a YouTube playlist ID from a URL if valid.
 */
export function extractYouTubePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const normalized = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
    const url = new URL(normalized);
    const listParam = url.searchParams.get('list');
    if (listParam && listParam.length >= 10) {
      return listParam;
    }
  } catch {
    return null;
  }

  return null;
}

export function buildYouTubeMusicSearchUrl(
  track: Pick<LocalTrack, 'title' | 'artist' | 'album'>
): string {
  const parts = [track.artist !== 'Unknown Artist' ? track.artist : '', track.title]
    .map((p) => p.trim())
    .filter(Boolean);
  const query = parts.join(' - ') || track.title;
  return `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
}

export function buildYouTubeMusicWatchUrl(videoId: string): string {
  return `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/**
 * Always returns a working YouTube Music URL for any track:
 * direct song watch URL when matched, or pre-filled YouTube Music search when unmatched.
 */
export function buildTrackYouTubeMusicUrl(
  track: Pick<LocalTrack, 'title' | 'artist' | 'album' | 'youtubeVideoId'>
): string {
  if (track.youtubeVideoId) {
    return buildYouTubeMusicWatchUrl(track.youtubeVideoId);
  }
  return buildYouTubeMusicSearchUrl(track);
}

/** The YouTube Music page of a playlist. */
export function buildYouTubeMusicPlaylistUrl(playlistId: string): string {
  return `https://music.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
}

/**
 * Always returns a working YouTube Music / YouTube queue URL for a playlist.
 */
export function buildPlaylistYouTubeMusicUrl(
  playlist: Pick<Playlist, 'name' | 'youtubePlaylistUrl'>,
  tracks: LocalTrack[]
): { url: string; label: string; isDirectQueue: boolean } {
  const linkedId = extractYouTubePlaylistId(playlist.youtubePlaylistUrl);
  if (linkedId) {
    return {
      url: buildYouTubeMusicPlaylistUrl(linkedId),
      label: 'Open in YouTube Music',
      isDirectQueue: true,
    };
  }

  const matchedIds = tracks
    .map((t) => t.youtubeVideoId)
    .filter((id): id is string => Boolean(id));

  if (matchedIds.length === 1) {
    return {
      url: buildYouTubeMusicWatchUrl(matchedIds[0]),
      label: 'Open in YouTube Music',
      isDirectQueue: true,
    };
  }

  if (matchedIds.length > 1) {
    const batches = buildInstantQueueBatches(matchedIds);
    return {
      url: batches[0].url,
      label: `Open in YouTube Music (${batches[0].count})`,
      isDirectQueue: true,
    };
  }

  if (tracks.length > 0) {
    return {
      url: buildYouTubeMusicSearchUrl(tracks[0]),
      label: 'Open in YouTube Music',
      isDirectQueue: false,
    };
  }

  return {
    url: 'https://music.youtube.com/library/playlists',
    label: 'Open YouTube Music',
    isDirectQueue: false,
  };
}

export function buildYouTubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

/**
 * YouTube supports launching an untitled multi-video queue of up to 50 video IDs
 * directly via watch_videos?video_ids=... Users can immediately save that queue
 * as a playlist in their YouTube / YouTube Music library without OAuth.
 */
export function buildInstantQueueBatches(
  videoIds: string[],
  batchSize = 50
): Array<{ label: string; count: number; url: string }> {
  const uniqueIds = Array.from(new Set(videoIds.filter((id) => YT_VIDEO_ID_REGEX.test(id))));
  const batches: Array<{ label: string; count: number; url: string }> = [];

  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const slice = uniqueIds.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    batches.push({
      label:
        uniqueIds.length > batchSize
          ? `Batch ${batchNum} (${i + 1}–${i + slice.length})`
          : `All ${slice.length} Matched Tracks`,
      count: slice.length,
      url: `https://www.youtube.com/watch_videos?video_ids=${slice.join(',')}`,
    });
  }

  return batches;
}

export function formatDuration(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const total = Math.round(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatTotalRuntime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0m';
  const totalMins = Math.round(seconds / 60);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  return `${mins}m`;
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return 'Never';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportPlaylistToCSV(playlist: Playlist, tracks: LocalTrack[]): string {
  const header = ['Track Name', 'Artist Name', 'Album Name', 'Duration (sec)', 'YouTube Music URL', 'Local Path'];
  const rows = tracks.map((t) => [
    escapeCsvCell(t.title),
    escapeCsvCell(t.artist === 'Unknown Artist' ? '' : t.artist),
    escapeCsvCell(t.album === 'Unknown Album' ? '' : t.album),
    String(Math.round(t.duration || 0)),
    t.youtubeVideoId ? buildYouTubeMusicWatchUrl(t.youtubeVideoId) : '',
    escapeCsvCell(t.relativePath),
  ]);
  return [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function exportPlaylistToM3U8(playlist: Playlist, tracks: LocalTrack[]): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${playlist.name}`];
  for (const track of tracks) {
    const dur = Math.round(track.duration || -1);
    const label =
      track.artist && track.artist !== 'Unknown Artist'
        ? `${track.artist} - ${track.title}`
        : track.title;
    lines.push(`#EXTINF:${dur},${label}`);
    lines.push(
      track.youtubeVideoId ? buildYouTubeMusicWatchUrl(track.youtubeVideoId) : track.relativePath
    );
  }
  return lines.join('\n');
}

export function exportPlaylistToJSON(playlist: Playlist, tracks: LocalTrack[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      playlist: {
        name: playlist.name,
        description: playlist.description,
        youtubePlaylistUrl: playlist.youtubePlaylistUrl || null,
        watchedFolderName: playlist.watchedFolderName,
        syncRule: playlist.syncRule,
      },
      tracks: tracks.map((t) => ({
        title: t.title,
        artist: t.artist,
        album: t.album,
        year: t.year,
        duration: t.duration,
        format: t.format,
        relativePath: t.relativePath,
        youtubeVideoId: t.youtubeVideoId,
        youtubeUrl: t.youtubeVideoId ? buildYouTubeMusicWatchUrl(t.youtubeVideoId) : null,
      })),
    },
    null,
    2
  );
}

export function exportPlaylistToPlainText(tracks: LocalTrack[]): string {
  return tracks
    .map((t) => {
      const base =
        t.artist && t.artist !== 'Unknown Artist' ? `${t.artist} - ${t.title}` : t.title;
      return t.youtubeVideoId ? `${base} (${buildYouTubeMusicWatchUrl(t.youtubeVideoId)})` : base;
    })
    .join('\n');
}

export interface ImportedTrackSeed {
  title: string;
  artist: string;
  album: string;
  duration: number;
  youtubeVideoId: string | null;
  relativePath: string;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseImportedText(
  content: string,
  fileName = 'import.txt'
): { suggestedName: string; tracks: ImportedTrackSeed[] } {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? 'txt';
  const baseName = fileName.replace(/\.[^.]+$/, '') || 'Imported Playlist';

  // JSON format
  if (ext === 'json' || content.trim().startsWith('{') || content.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(content);
      const rawTracks = Array.isArray(parsed) ? parsed : parsed.tracks ?? [];
      const suggestedName =
        (!Array.isArray(parsed) && parsed.playlist?.name) || baseName;
      const tracks: ImportedTrackSeed[] = rawTracks
        .filter((item: unknown) => item && typeof item === 'object')
        .map((item: Record<string, unknown>) => {
          const ytId =
            (typeof item.youtubeVideoId === 'string' && extractYouTubeVideoId(item.youtubeVideoId)) ||
            (typeof item.youtubeUrl === 'string' && extractYouTubeVideoId(item.youtubeUrl)) ||
            null;
          return {
            title: String(item.title || item.name || 'Untitled Track'),
            artist: String(item.artist || 'Unknown Artist'),
            album: String(item.album || 'Unknown Album'),
            duration: Number(item.duration) || 0,
            youtubeVideoId: ytId,
            relativePath: String(item.relativePath || `${item.artist || 'Import'} - ${item.title || 'Track'}`),
          };
        });
      if (tracks.length > 0) return { suggestedName, tracks };
    } catch {
      // Fall through to text parsers
    }
  }

  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // M3U / M3U8 format
  if (ext === 'm3u' || ext === 'm3u8' || lines[0]?.startsWith('#EXTM3U')) {
    let suggestedName = baseName;
    const tracks: ImportedTrackSeed[] = [];
    let pendingTitle = '';
    let pendingArtist = 'Unknown Artist';
    let pendingDuration = 0;

    for (const line of lines) {
      if (line.startsWith('#PLAYLIST:')) {
        suggestedName = line.slice('#PLAYLIST:'.length).trim() || suggestedName;
        continue;
      }
      if (line.startsWith('#EXTINF:')) {
        const rest = line.slice('#EXTINF:'.length);
        const commaIdx = rest.indexOf(',');
        if (commaIdx !== -1) {
          const durNum = parseInt(rest.slice(0, commaIdx), 10);
          pendingDuration = Number.isFinite(durNum) && durNum > 0 ? durNum : 0;
          const label = rest.slice(commaIdx + 1).trim();
          const dashSplit = label.split(/\s+-\s+/);
          if (dashSplit.length >= 2) {
            pendingArtist = dashSplit[0].trim();
            pendingTitle = dashSplit.slice(1).join(' - ').trim();
          } else {
            pendingArtist = 'Unknown Artist';
            pendingTitle = label;
          }
        }
        continue;
      }
      if (line.startsWith('#')) continue;

      const ytId = extractYouTubeVideoId(line);
      const fallbackFileName = line.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || line;
      tracks.push({
        title: pendingTitle || fallbackFileName,
        artist: pendingArtist,
        album: 'Imported Playlist',
        duration: pendingDuration,
        youtubeVideoId: ytId,
        relativePath: line,
      });
      pendingTitle = '';
      pendingArtist = 'Unknown Artist';
      pendingDuration = 0;
    }

    return { suggestedName, tracks };
  }

  // CSV format
  if (ext === 'csv' || (lines.length > 1 && lines[0].includes(','))) {
    const headerCells = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
    const hasHeader =
      headerCells.some((h) => h.includes('track') || h.includes('title') || h.includes('artist'));
    const startIdx = hasHeader ? 1 : 0;
    const titleIdx = Math.max(
      0,
      headerCells.findIndex((h) => h.includes('track') || h.includes('title') || h === 'song')
    );
    const artistIdx = headerCells.findIndex((h) => h.includes('artist'));
    const albumIdx = headerCells.findIndex((h) => h.includes('album'));
    const durIdx = headerCells.findIndex((h) => h.includes('duration'));
    const urlIdx = headerCells.findIndex((h) => h.includes('youtube') || h.includes('url') || h.includes('id'));

    const tracks: ImportedTrackSeed[] = [];
    for (let i = startIdx; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      const title = cols[titleIdx] || cols[0];
      if (!title) continue;
      const artist = artistIdx >= 0 && cols[artistIdx] ? cols[artistIdx] : 'Unknown Artist';
      const album = albumIdx >= 0 && cols[albumIdx] ? cols[albumIdx] : 'Unknown Album';
      const duration = durIdx >= 0 ? Number(cols[durIdx]) || 0 : 0;
      const ytId = urlIdx >= 0 && cols[urlIdx] ? extractYouTubeVideoId(cols[urlIdx]) : null;
      tracks.push({
        title,
        artist,
        album,
        duration,
        youtubeVideoId: ytId,
        relativePath: `${artist} - ${title}`,
      });
    }
    return { suggestedName: baseName, tracks };
  }

  // Plain text tracklist (Artist - Title, optional YouTube URL)
  const tracks: ImportedTrackSeed[] = [];
  for (const rawLine of lines) {
    const urlMatch = rawLine.match(/https?:\/\/\S+/);
    const ytId = urlMatch ? extractYouTubeVideoId(urlMatch[0]) : extractYouTubeVideoId(rawLine);
    const cleaned = rawLine
      .replace(/\(https?:\/\/[^)]+\)/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/^\d+[.)]\s*/, '')
      .trim();

    if (!cleaned && ytId) {
      tracks.push({
        title: `YouTube Track (${ytId})`,
        artist: 'Unknown Artist',
        album: 'Imported Links',
        duration: 0,
        youtubeVideoId: ytId,
        relativePath: `youtube:${ytId}`,
      });
      continue;
    }

    if (!cleaned) continue;
    const parts = cleaned.split(/\s+[-–—]\s+/);
    const artist = parts.length >= 2 ? parts[0].trim() : 'Unknown Artist';
    const title = parts.length >= 2 ? parts.slice(1).join(' - ').trim() : cleaned;
    tracks.push({
      title,
      artist,
      album: 'Imported Tracklist',
      duration: 0,
      youtubeVideoId: ytId,
      relativePath: `${artist} - ${title}`,
    });
  }

  return { suggestedName: baseName, tracks };
}

/** A file the browser saves for the user. */
export interface FileDownload {
  fileName: string;
  content: string;
  mimeType: string;
}

// Takes one object: with three strings in a row, a swapped file name and content still compiled,
// and the Scan Logs export shipped that way.
export function triggerFileDownload({ fileName, content, mimeType }: FileDownload): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
