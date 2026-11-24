import type { LocalTrack } from '../types/music';
import { postAiRequest } from './aiApi';

export interface MetadataSuggestion {
  trackId: string;
  title?: string;
  artist: string;
  album: string;
  year: string;
  confidence: 'high' | 'medium' | 'low';
  reason?: string;
}

export interface SearchGroundingSource {
  title: string;
  uri: string;
}

export interface MetadataLookupResult {
  suggestionsById: Record<string, MetadataSuggestion>;
  sources: SearchGroundingSource[];
}

const BATCH_SIZE = 10;

export async function fetchMetadataSuggestions(
  tracks: LocalTrack[],
  options?: {
    signal?: AbortSignal;
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<MetadataLookupResult> {
  const suggestionsById: Record<string, MetadataSuggestion> = {};
  const sourcesByUri = new Map<string, SearchGroundingSource>();

  if (tracks.length === 0) {
    return { suggestionsById, sources: [] };
  }

  let completed = 0;
  options?.onProgress?.(0, tracks.length);

  for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
    if (options?.signal?.aborted) {
      throw new DOMException('Metadata lookup cancelled.', 'AbortError');
    }

    const chunk = tracks.slice(i, i + BATCH_SIZE);
    const data = await postAiRequest<{
      suggestions: MetadataSuggestion[];
      sources: SearchGroundingSource[];
    }>(
      '/api/metadata/suggest',
      {
        tracks: chunk.map((t) => ({
          id: t.id,
          fileName: t.fileName,
          relativePath: t.relativePath,
          folderName: t.folderName,
          title: t.title,
          artist: t.artist,
          album: t.album,
          year: t.year,
          duration: t.duration,
        })),
      },
      {
        signal: options?.signal,
        fallbackError: (status) => `Metadata lookup failed with status ${status}.`,
      }
    );

    if (Array.isArray(data.suggestions)) {
      for (const item of data.suggestions) {
        if (item && typeof item.trackId === 'string') {
          suggestionsById[item.trackId] = item;
        }
      }
    }

    if (Array.isArray(data.sources)) {
      for (const src of data.sources) {
        if (src?.uri && !sourcesByUri.has(src.uri)) {
          sourcesByUri.set(src.uri, {
            uri: src.uri,
            title: src.title || src.uri,
          });
        }
      }
    }

    completed = Math.min(tracks.length, i + chunk.length);
    options?.onProgress?.(completed, tracks.length);
  }

  return {
    suggestionsById,
    sources: Array.from(sourcesByUri.values()),
  };
}
