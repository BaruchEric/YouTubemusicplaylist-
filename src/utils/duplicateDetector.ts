import type { LocalTrack } from '../types/music';
import { inferTrackGenre } from './genreInference';
import { buildYouTubeMusicWatchUrl } from './youtubeLinks';

export type DuplicateMatchKind = 'hash+size' | 'size-only';

export interface DuplicateGroup {
  key: string;
  matchKind: DuplicateMatchKind;
  fileSize: number;
  contentHash: string | null;
  tracks: LocalTrack[];
  recommendedKeepId: string;
  redundantBytes: number;
}

/**
 * Scores a track to determine the best canonical copy to keep in a duplicate group:
 * prefers tracks present on device, matched on YouTube Music, with cover art, and added earliest.
 */
function scoreKeepCandidate(track: LocalTrack): number {
  let score = 0;
  if (!track.isMissingOnDevice) score += 100;
  if (track.youtubeVideoId) score += 50;
  if (track.coverArtUrl) score += 15;
  if (track.artist !== 'Unknown Artist') score += 5;
  if (track.album !== 'Unknown Album') score += 5;
  return score;
}

/**
 * Identifies duplicate audio tracks by exact fileSize + SHA-256 contentHash,
 * with a clearly labeled size-only fallback for tracks that have not yet been hashed.
 */
export function findDuplicateGroups(tracks: LocalTrack[]): DuplicateGroup[] {
  const hashBuckets = new Map<string, LocalTrack[]>();
  const unhashedSizeBuckets = new Map<number, LocalTrack[]>();

  for (const track of tracks) {
    if (!track.fileSize || track.fileSize <= 0) continue;

    if (track.contentHash) {
      const key = `${track.fileSize}::${track.contentHash}`;
      const bucket = hashBuckets.get(key) ?? [];
      bucket.push(track);
      hashBuckets.set(key, bucket);
    } else {
      const bucket = unhashedSizeBuckets.get(track.fileSize) ?? [];
      bucket.push(track);
      unhashedSizeBuckets.set(track.fileSize, bucket);
    }
  }

  const groups: DuplicateGroup[] = [];

  for (const [key, groupTracks] of hashBuckets.entries()) {
    if (groupTracks.length < 2) continue;
    const sorted = [...groupTracks].sort((a, b) => {
      const diff = scoreKeepCandidate(b) - scoreKeepCandidate(a);
      if (diff !== 0) return diff;
      return a.addedAt - b.addedAt;
    });
    const fileSize = sorted[0].fileSize;
    groups.push({
      key,
      matchKind: 'hash+size',
      fileSize,
      contentHash: sorted[0].contentHash ?? null,
      tracks: sorted,
      recommendedKeepId: sorted[0].id,
      redundantBytes: fileSize * (sorted.length - 1),
    });
  }

  for (const [fileSize, groupTracks] of unhashedSizeBuckets.entries()) {
    if (groupTracks.length < 2) continue;
    const sorted = [...groupTracks].sort((a, b) => {
      const diff = scoreKeepCandidate(b) - scoreKeepCandidate(a);
      if (diff !== 0) return diff;
      return a.addedAt - b.addedAt;
    });
    groups.push({
      key: `size::${fileSize}`,
      matchKind: 'size-only',
      fileSize,
      contentHash: null,
      tracks: sorted,
      recommendedKeepId: sorted[0].id,
      redundantBytes: fileSize * (sorted.length - 1),
    });
  }

  return groups.sort((a, b) => {
    if (a.matchKind !== b.matchKind) {
      return a.matchKind === 'hash+size' ? -1 : 1;
    }
    return b.redundantBytes - a.redundantBytes;
  });
}

function escapeCsv(val: string): string {
  if (/[",\n\r]/.test(val)) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function exportCatalogToCSV(tracks: LocalTrack[]): string {
  const header = [
    'Track Name',
    'Artist Name',
    'Album Name',
    'Genre',
    'Format',
    'Duration (sec)',
    'File Size (bytes)',
    'SHA-256 Hash',
    'YouTube Music URL',
    'Local Path',
  ];
  const rows = tracks.map((t) => [
    escapeCsv(t.title),
    escapeCsv(t.artist === 'Unknown Artist' ? '' : t.artist),
    escapeCsv(t.album === 'Unknown Album' ? '' : t.album),
    escapeCsv(inferTrackGenre(t).genre),
    escapeCsv(t.format),
    String(Math.round(t.duration || 0)),
    String(t.fileSize || 0),
    t.contentHash || '',
    t.youtubeVideoId ? buildYouTubeMusicWatchUrl(t.youtubeVideoId) : '',
    escapeCsv(t.relativePath),
  ]);
  return [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function exportCatalogToM3U8(tracks: LocalTrack[], name = 'Device Storage Catalog'): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${name}`];
  for (const t of tracks) {
    const dur = Math.round(t.duration || -1);
    const label =
      t.artist && t.artist !== 'Unknown Artist' ? `${t.artist} - ${t.title}` : t.title;
    lines.push(`#EXTINF:${dur},${label}`);
    lines.push(t.youtubeVideoId ? buildYouTubeMusicWatchUrl(t.youtubeVideoId) : t.relativePath);
  }
  return lines.join('\n');
}

export function exportCatalogToJSON(tracks: LocalTrack[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      trackCount: tracks.length,
      tracks: tracks.map((t) => ({
        title: t.title,
        artist: t.artist,
        album: t.album,
        genre: inferTrackGenre(t).genre,
        year: t.year,
        format: t.format,
        duration: t.duration,
        fileSize: t.fileSize,
        contentHash: t.contentHash ?? null,
        relativePath: t.relativePath,
        youtubeVideoId: t.youtubeVideoId,
        youtubeUrl: t.youtubeVideoId ? buildYouTubeMusicWatchUrl(t.youtubeVideoId) : null,
      })),
    },
    null,
    2
  );
}

export function exportDuplicatesReportToCSV(groups: DuplicateGroup[]): string {
  const header = [
    'Group #',
    'Match Method',
    'File Size (bytes)',
    'SHA-256 Hash',
    'Recommendation',
    'Title',
    'Artist',
    'Local Path',
  ];
  const rows: string[][] = [];
  groups.forEach((group, idx) => {
    for (const track of group.tracks) {
      rows.push([
        String(idx + 1),
        group.matchKind === 'hash+size' ? 'Exact Hash + Size' : 'Same File Size',
        String(group.fileSize),
        group.contentHash || 'Not hashed',
        track.id === group.recommendedKeepId ? 'Keep' : 'Redundant',
        escapeCsv(track.title),
        escapeCsv(track.artist),
        escapeCsv(track.relativePath),
      ]);
    }
  });
  return [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
