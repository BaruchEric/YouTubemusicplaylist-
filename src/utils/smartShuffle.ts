import type { LocalTrack } from '../types/music';
import { computeTrackBitrateKbps } from './genreInference';

export type ShuffleMode = 'off' | 'standard' | 'smart';

const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const LOSSLESS_FORMATS = new Set(['FLAC', 'WAV', 'AIFF', 'AIF', 'AIFC', 'ALAC']);

export interface TrackSmartScore {
  score: number;
  hasValidYouTubeId: boolean;
  metadataCompleteness: number; // 0..1
  isHighPriority: boolean;
}

/**
 * Evaluates a track for Smart Shuffle prioritization:
 * - High-quality verified 11-char YouTube Music video IDs get top priority
 * - Complete metadata (artist, album, genre, year, cover art) boosts priority
 * - Playable local audio & higher audio quality add further lift
 * - Missing/unplayable or explicitly skipped tracks are heavily deprioritized
 */
export function scoreTrackForSmartShuffle(
  track: LocalTrack,
  hasLocalFile = false
): TrackSmartScore {
  const hasValidYouTubeId = Boolean(
    track.youtubeVideoId && YOUTUBE_ID_PATTERN.test(track.youtubeVideoId)
  );

  let score = 0;

  // 1. High-quality YouTube Music ID match (up to 50 pts)
  if (hasValidYouTubeId) {
    score += track.matchStatus === 'matched' ? 46 : 36;
    if (track.youtubeTitle && track.youtubeTitle.trim().length > 0) {
      score += 4;
    }
  }

  // 2. Metadata completeness (up to 32 pts)
  let metaFields = 0;
  const totalMetaFields = 5;
  if (track.artist && track.artist !== 'Unknown Artist') {
    score += 9;
    metaFields++;
  }
  if (track.album && track.album !== 'Unknown Album') {
    score += 7;
    metaFields++;
  }
  if (track.genre && track.genre.trim().length > 0) {
    score += 6;
    metaFields++;
  }
  if (track.year && /^\d{4}$/.test(track.year)) {
    score += 5;
    metaFields++;
  }
  if (track.coverArtUrl) {
    score += 5;
    metaFields++;
  }

  // 3. Playback availability & audio fidelity (up to 18 pts)
  if (!track.isMissingOnDevice) {
    score += hasLocalFile ? 10 : 6;
  }
  const fmt = (track.format || '').toUpperCase();
  const kbps = computeTrackBitrateKbps(track);
  if (LOSSLESS_FORMATS.has(fmt) || (kbps !== null && kbps >= 256)) {
    score += 5;
  } else if (kbps !== null && kbps >= 160) {
    score += 2;
  }
  if (track.duration >= 30) {
    score += 3;
  }

  // 4. Penalties for skipped or unplayable tracks
  if (track.matchStatus === 'skipped') {
    score = Math.round(score * 0.25);
  }
  if (track.isMissingOnDevice && !hasValidYouTubeId) {
    score = Math.min(score, 2);
  }

  const clampedScore = Math.max(1, Math.min(100, score));
  return {
    score: clampedScore,
    hasValidYouTubeId,
    metadataCompleteness: metaFields / totalMetaFields,
    isHighPriority: hasValidYouTubeId || clampedScore >= 40,
  };
}

/**
 * Produces a Smart-Shuffled ordering of `trackIds` using weighted sampling without
 * replacement so matched tracks with high-quality YouTube IDs and complete metadata
 * appear earlier and more prominently than unmatched/sparse tracks while preserving
 * organic variety on every shuffle.
 */
export function buildSmartShuffleOrder(
  trackIds: string[],
  tracksById: Map<string, LocalTrack>,
  hasLocalFile?: (fileKey: string) => boolean,
  pinFirstId?: string | null
): string[] {
  const uniqueIds = Array.from(new Set(trackIds));
  if (uniqueIds.length <= 1) return uniqueIds;

  const pool: Array<{ id: string; weight: number }> = [];
  for (const id of uniqueIds) {
    if (pinFirstId && id === pinFirstId) continue;
    const track = tracksById.get(id);
    if (!track) {
      pool.push({ id, weight: 0.2 });
      continue;
    }
    const localReady = hasLocalFile ? hasLocalFile(track.fileKey) : !track.isMissingOnDevice;
    const { score, hasValidYouTubeId } = scoreTrackForSmartShuffle(track, localReady);

    // Non-linear weighting strongly favors matched YouTube IDs & rich metadata
    const baseWeight = Math.pow(score / 12, 2.6);
    const matchMultiplier = hasValidYouTubeId ? 3.5 : 1;
    pool.push({ id, weight: Math.max(0.1, baseWeight * matchMultiplier) });
  }

  const ordered: string[] = [];
  if (pinFirstId && uniqueIds.includes(pinFirstId)) {
    ordered.push(pinFirstId);
  }

  // Weighted sampling without replacement
  while (pool.length > 0) {
    let totalWeight = 0;
    for (const item of pool) totalWeight += item.weight;

    let threshold = Math.random() * totalWeight;
    let chosenIdx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      threshold -= pool[i].weight;
      if (threshold <= 0) {
        chosenIdx = i;
        break;
      }
    }

    ordered.push(pool[chosenIdx].id);
    pool.splice(chosenIdx, 1);
  }

  return ordered;
}

/**
 * Standard uniform Fisher-Yates shuffle, optionally pinning the currently playing track first.
 */
export function buildStandardShuffleOrder(
  trackIds: string[],
  pinFirstId?: string | null
): string[] {
  const uniqueIds = Array.from(new Set(trackIds));
  const rest = pinFirstId ? uniqueIds.filter((id) => id !== pinFirstId) : [...uniqueIds];

  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }

  if (pinFirstId && uniqueIds.includes(pinFirstId)) {
    return [pinFirstId, ...rest];
  }
  return rest;
}

export function getSmartShuffleSummary(tracks: LocalTrack[]): {
  priorityCount: number;
  matchedCount: number;
  totalCount: number;
} {
  let priorityCount = 0;
  let matchedCount = 0;
  for (const t of tracks) {
    const evaluated = scoreTrackForSmartShuffle(t);
    if (evaluated.hasValidYouTubeId) matchedCount++;
    if (evaluated.isHighPriority) priorityCount++;
  }
  return {
    priorityCount,
    matchedCount,
    totalCount: tracks.length,
  };
}
