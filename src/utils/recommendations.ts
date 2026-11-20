import type { LocalTrack, Playlist } from '../types/music';
import { inferTrackGenre } from './genreInference';

/**
 * Curated genre adjacency map used to surface closely related genres
 * when exact-genre candidates are exhausted or sparse.
 */
const RELATED_GENRES: Record<string, string[]> = {
  Electronic: ['Ambient / Lo-Fi', 'Pop', 'Hip-Hop / Rap'],
  'Ambient / Lo-Fi': ['Electronic', 'Jazz', 'Classical', 'Soundtrack / Score'],
  'Hip-Hop / Rap': ['R&B / Soul', 'Electronic', 'Pop'],
  'R&B / Soul': ['Hip-Hop / Rap', 'Jazz', 'Pop'],
  'Indie / Alternative': ['Rock', 'Pop', 'Country / Folk', 'Ambient / Lo-Fi'],
  Rock: ['Indie / Alternative', 'Metal', 'Country / Folk'],
  Metal: ['Rock', 'Indie / Alternative'],
  Jazz: ['R&B / Soul', 'Ambient / Lo-Fi', 'Classical'],
  Classical: ['Soundtrack / Score', 'Ambient / Lo-Fi', 'Jazz'],
  Pop: ['Indie / Alternative', 'R&B / Soul', 'Electronic'],
  'Country / Folk': ['Indie / Alternative', 'Rock'],
  'Latin / Reggae': ['Pop', 'R&B / Soul', 'Hip-Hop / Rap'],
  'Soundtrack / Score': ['Classical', 'Ambient / Lo-Fi', 'Electronic'],
  'Podcast / Spoken': ['Ambient / Lo-Fi'],
};

export interface GenreShare {
  genre: string;
  count: number;
  share: number; // 0..1
}

export interface TrackRecommendation {
  track: LocalTrack;
  genre: string;
  genreSource: 'tag' | 'inferred' | 'unclassified';
  targetPlaylist: Playlist | null;
  score: number;
  matchType: 'exact-playlist' | 'related-playlist' | 'top-library';
  reason: string;
  matchedGenre: string;
}

export interface RecommendationSummary {
  recommendations: TrackRecommendation[];
  topProfileGenres: GenreShare[];
  totalCandidates: number;
}

function buildGenreProfile(tracks: LocalTrack[]): GenreShare[] {
  const counts = new Map<string, number>();
  let total = 0;

  for (const track of tracks) {
    if (track.isMissingOnDevice) continue;
    const { genre } = inferTrackGenre(track);
    counts.set(genre, (counts.get(genre) ?? 0) + 1);
    total += 1;
  }

  if (total === 0) return [];

  return Array.from(counts.entries())
    .map(([genre, count]) => ({
      genre,
      count,
      share: count / total,
    }))
    .sort((a, b) => {
      if (a.genre === 'Unclassified' && b.genre !== 'Unclassified') return 1;
      if (b.genre === 'Unclassified' && a.genre !== 'Unclassified') return -1;
      return b.count - a.count;
    });
}

function getAdjacentMatch(
  candidateGenre: string,
  profile: GenreShare[]
): GenreShare | null {
  for (const entry of profile) {
    if (entry.genre === 'Unclassified') continue;
    const neighbors = RELATED_GENRES[entry.genre] ?? [];
    if (neighbors.includes(candidateGenre)) {
      return entry;
    }
  }
  return null;
}

function scoreTrackForTarget(
  track: LocalTrack,
  playlist: Playlist | null,
  playlistTracks: LocalTrack[],
  playlistProfile: GenreShare[],
  libraryProfile: GenreShare[],
  libraryTopGenreSet: Map<string, GenreShare>
): TrackRecommendation | null {
  const inferred = inferTrackGenre(track);
  const candidateGenre = inferred.genre;

  let score = 0;
  let matchType: TrackRecommendation['matchType'] = 'top-library';
  let reason = '';
  let matchedGenre = candidateGenre;

  const playlistProfileMap = new Map(playlistProfile.map((g) => [g.genre, g]));
  const playlistArtists = new Set(
    playlistTracks
      .map((t) => t.artist.trim().toLowerCase())
      .filter((a) => a && a !== 'unknown artist')
  );

  // 1. Target playlist has existing tracks with genre signal
  if (playlist && playlistProfile.length > 0) {
    const exactInPlaylist = playlistProfileMap.get(candidateGenre);
    if (exactInPlaylist && candidateGenre !== 'Unclassified') {
      const pct = Math.max(1, Math.round(exactInPlaylist.share * 100));
      score += 65 + Math.round(exactInPlaylist.share * 35);
      matchType = 'exact-playlist';
      matchedGenre = candidateGenre;
      reason = `Matches ${candidateGenre} (${pct}% of ${playlist.name})`;
    } else {
      const related = getAdjacentMatch(candidateGenre, playlistProfile);
      if (related) {
        score += 38 + Math.round(related.share * 24);
        matchType = 'related-playlist';
        matchedGenre = related.genre;
        reason = `Pairs with ${related.genre} in ${playlist.name}`;
      }
    }
  }

  // 2. Fall back or reinforce with overall library genre affinity
  const libShare = libraryTopGenreSet.get(candidateGenre);
  if (score === 0) {
    if (libShare && candidateGenre !== 'Unclassified') {
      const pct = Math.max(1, Math.round(libShare.share * 100));
      score += 32 + Math.round(libShare.share * 30);
      matchType = 'top-library';
      matchedGenre = candidateGenre;
      reason = playlist
        ? `Top library genre: ${candidateGenre} (${pct}% of library)`
        : `${candidateGenre} makes up ${pct}% of your library`;
    } else if (libraryProfile.length > 0) {
      const relatedLib = getAdjacentMatch(candidateGenre, libraryProfile);
      if (relatedLib) {
        score += 22 + Math.round(relatedLib.share * 15);
        matchType = 'top-library';
        matchedGenre = relatedLib.genre;
        reason = `Complements your ${relatedLib.genre} tracks`;
      } else {
        score += 10;
        matchType = 'top-library';
        reason = playlist
          ? `Not yet in ${playlist.name}`
          : 'Ready to organize into a playlist';
      }
    }
  } else if (libShare && candidateGenre !== 'Unclassified') {
    score += Math.round(libShare.share * 10);
  }

  // 3. Artist cohesion bonus with target playlist
  const normalizedArtist = track.artist.trim().toLowerCase();
  if (
    playlist &&
    normalizedArtist &&
    normalizedArtist !== 'unknown artist' &&
    playlistArtists.has(normalizedArtist)
  ) {
    score += 18;
    if (matchType === 'exact-playlist') {
      reason = `${candidateGenre} · ${track.artist} already in ${playlist.name}`;
    } else {
      reason = `Same artist (${track.artist}) as ${playlist.name}`;
    }
  }

  // 4. Metadata & YouTube Music sync readiness bonuses
  if (track.youtubeVideoId && /^[a-zA-Z0-9_-]{11}$/.test(track.youtubeVideoId)) {
    score += 9;
  }
  if (inferred.source === 'tag') {
    score += 5;
  }
  if (track.coverArtUrl) {
    score += 3;
  }
  if (track.duration > 0) {
    score += 2;
  }

  return {
    track,
    genre: candidateGenre,
    genreSource: inferred.source,
    targetPlaylist: playlist,
    score,
    matchType,
    reason,
    matchedGenre,
  };
}

/**
 * Generates playlist track recommendations grounded in the genre makeup
 * of the user's local library and existing playlists.
 *
 * - If `targetPlaylistId` is `'auto'`, each eligible track is matched against
 *   whichever playlist it best complements (or top library genres when no playlists exist).
 * - If `targetPlaylistId` is a specific playlist ID, only tracks not yet in that
 *   playlist are scored against its genre profile + library profile.
 */
export function generateTrackRecommendations(options: {
  tracks: LocalTrack[];
  playlists: Playlist[];
  trackMap: Map<string, LocalTrack>;
  targetPlaylistId: string; // 'auto' or a playlist ID
  activeGenre: string; // 'all' or specific genre
  dismissedIds: Set<string>;
  rotationOffset?: number;
  limit?: number;
}): RecommendationSummary {
  const {
    tracks,
    playlists,
    trackMap,
    targetPlaylistId,
    activeGenre,
    dismissedIds,
    rotationOffset = 0,
    limit = 6,
  } = options;

  const activeLibraryTracks = tracks.filter((t) => !t.isMissingOnDevice);
  const libraryProfile = buildGenreProfile(activeLibraryTracks);
  const libraryTopGenreMap = new Map(libraryProfile.map((g) => [g.genre, g]));

  const scopedLibraryTracks = activeLibraryTracks.filter((t) => {
    if (dismissedIds.has(t.id)) return false;
    if (activeGenre !== 'all' && inferTrackGenre(t).genre !== activeGenre) return false;
    return true;
  });

  if (scopedLibraryTracks.length === 0) {
    return {
      recommendations: [],
      topProfileGenres: libraryProfile.slice(0, 4),
      totalCandidates: 0,
    };
  }

  const specificPlaylist =
    targetPlaylistId !== 'auto'
      ? playlists.find((p) => p.id === targetPlaylistId) ?? null
      : null;

  // Precompute playlist tracks & profiles
  const playlistContexts = (specificPlaylist ? [specificPlaylist] : playlists).map((pl) => {
    const memberIds = new Set(pl.trackIds);
    const plTracks = pl.trackIds
      .map((id) => trackMap.get(id))
      .filter((t): t is LocalTrack => Boolean(t && !t.isMissingOnDevice));
    return {
      playlist: pl,
      memberIds,
      plTracks,
      profile: buildGenreProfile(plTracks),
    };
  });

  const scored: TrackRecommendation[] = [];

  if (specificPlaylist) {
    const ctx = playlistContexts[0];
    for (const track of scopedLibraryTracks) {
      if (ctx.memberIds.has(track.id)) continue;
      const rec = scoreTrackForTarget(
        track,
        ctx.playlist,
        ctx.plTracks,
        ctx.profile,
        libraryProfile,
        libraryTopGenreMap
      );
      if (rec) scored.push(rec);
    }
  } else if (playlistContexts.length > 0) {
    // Auto mode: for each track, pick the playlist where it fits best and isn't already present
    for (const track of scopedLibraryTracks) {
      let best: TrackRecommendation | null = null;
      for (const ctx of playlistContexts) {
        if (ctx.memberIds.has(track.id)) continue;
        const candidate = scoreTrackForTarget(
          track,
          ctx.playlist,
          ctx.plTracks,
          ctx.profile,
          libraryProfile,
          libraryTopGenreMap
        );
        if (candidate && (!best || candidate.score > best.score)) {
          best = candidate;
        }
      }
      if (best) scored.push(best);
    }
  } else {
    // No playlists yet: recommend top genre-aligned tracks from the library to start a playlist
    for (const track of scopedLibraryTracks) {
      const rec = scoreTrackForTarget(
        track,
        null,
        [],
        [],
        libraryProfile,
        libraryTopGenreMap
      );
      if (rec) scored.push(rec);
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.track.addedAt - a.track.addedAt;
  });

  // Apply gentle rotation offset when the user clicks "Refresh Picks"
  const poolSize = scored.length;
  let rotated = scored;
  if (poolSize > limit && rotationOffset > 0) {
    const shift = (rotationOffset * Math.min(limit, 3)) % poolSize;
    rotated = [...scored.slice(shift), ...scored.slice(0, shift)];
  }

  // Encourage light artist diversity in the top slice when plenty of candidates exist
  const selected: TrackRecommendation[] = [];
  const deferred: TrackRecommendation[] = [];
  const artistCounts = new Map<string, number>();

  for (const item of rotated) {
    const artistKey = (item.track.artist || 'unknown').toLowerCase();
    const seen = artistCounts.get(artistKey) ?? 0;
    if (seen < 2) {
      selected.push(item);
      artistCounts.set(artistKey, seen + 1);
      if (selected.length >= limit) break;
    } else {
      deferred.push(item);
    }
  }

  for (const item of deferred) {
    if (selected.length >= limit) break;
    selected.push(item);
  }

  const activeProfile =
    specificPlaylist && playlistContexts[0]?.profile.length > 0
      ? playlistContexts[0].profile
      : libraryProfile;

  return {
    recommendations: selected,
    topProfileGenres: activeProfile.slice(0, 4),
    totalCandidates: poolSize,
  };
}
