import type { LocalTrack } from '../types/music';
import { postAiRequest } from './aiApi';

export interface DeepGenreClassificationItem {
  trackId: string;
  genre: string;
  subgenre: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface DeepGenreClassificationResult {
  updates: Record<string, string>;
  classifiedCount: number;
  totalRequested: number;
  genresDiscovered: string[];
}

const MAX_BATCH_SIZE = 50;

/**
 * Classifies unclassified, untagged, or "Other"-tagged tracks in batches via
 * the server-side /api/genres/classify endpoint.
 */
export async function classifyTracksDeeply(
  tracks: LocalTrack[],
  onProgress?: (processed: number, total: number) => void
): Promise<DeepGenreClassificationResult> {
  if (tracks.length === 0) {
    return {
      updates: {},
      classifiedCount: 0,
      totalRequested: 0,
      genresDiscovered: [],
    };
  }

  const updates: Record<string, string> = {};
  const discoveredSet = new Set<string>();
  let processed = 0;

  for (let i = 0; i < tracks.length; i += MAX_BATCH_SIZE) {
    const batch = tracks.slice(i, i + MAX_BATCH_SIZE);
    const payload = {
      tracks: batch.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        fileName: t.fileName,
        relativePath: t.relativePath,
        folderName: t.folderName,
        year: t.year,
        duration: t.duration,
        currentGenre: t.genre ?? '',
      })),
    };

    const data = await postAiRequest<{ classifications: DeepGenreClassificationItem[] }>(
      '/api/genres/classify',
      payload,
      { fallbackError: (status) => `Genre classification failed (HTTP ${status}).` }
    );

    const items = Array.isArray(data.classifications) ? data.classifications : [];
    for (const item of items) {
      if (item.trackId && item.genre) {
        updates[item.trackId] = item.genre;
        discoveredSet.add(item.genre);
      }
    }

    processed = Math.min(tracks.length, i + batch.length);
    onProgress?.(processed, tracks.length);
  }

  return {
    updates,
    classifiedCount: Object.keys(updates).length,
    totalRequested: tracks.length,
    genresDiscovered: Array.from(discoveredSet).sort((a, b) => a.localeCompare(b)),
  };
}
