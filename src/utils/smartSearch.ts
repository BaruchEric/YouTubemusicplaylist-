import type { LocalTrack, Playlist, TrackPlayStats } from '../types/music';
import { inferTrackGenre } from './genreInference';

const LOSSLESS_FORMATS = new Set(['FLAC', 'WAV', 'AIFF', 'AIF', 'AIFC', 'ALAC']);

export interface ParsedNumericComparison {
  op: '=' | '>' | '>=' | '<' | '<=' | 'range';
  min: number;
  max?: number;
}

export interface ParsedSmartQuery {
  raw: string;
  terms: string[];
  excludedTerms: string[];
  genres: string[];
  excludedGenres: string[];
  artists: string[];
  albums: string[];
  formats: string[];
  folders: string[];
  statuses: Array<'matched' | 'unmatched' | 'missing' | 'skipped'>;
  excludedStatuses: Array<'matched' | 'unmatched' | 'missing' | 'skipped'>;
  flags: {
    lossless?: boolean;
    hasArt?: boolean;
    played?: boolean;
  };
  yearFilter: ParsedNumericComparison | null;
  playsFilter: ParsedNumericComparison | null;
  durationFilter: ParsedNumericComparison | null; // seconds
  activeDescriptors: string[];
}

export interface SmartTrackResult {
  track: LocalTrack;
  genre: string;
  score: number;
  matchedFields: string[];
}

export interface SmartAlbumResult {
  key: string;
  album: string;
  artist: string;
  year: string;
  coverArtUrl: string | null;
  trackIds: string[];
  trackCount: number;
  score: number;
}

export interface SmartGenreResult {
  genre: string;
  count: number;
  trackIds: string[];
  score: number;
}

export interface SmartPlaylistResult {
  playlist: Playlist;
  score: number;
}

export interface GlobalSmartSearchResults {
  parsed: ParsedSmartQuery;
  tracks: SmartTrackResult[];
  playlists: SmartPlaylistResult[];
  albums: SmartAlbumResult[];
  genres: SmartGenreResult[];
}

export const SMART_SEARCH_PRESETS = [
  { label: 'Missing files', query: 'is:missing', hint: 'Tracks missing on device' },
  { label: 'Unmatched YT', query: 'is:unmatched', hint: 'Needs YouTube Music ID' },
  { label: 'Lossless audio', query: 'lossless', hint: 'FLAC, WAV, AIFF, ALAC' },
  { label: 'Played tracks', query: 'plays:>0', hint: 'Tracks with recorded plays' },
  { label: 'No cover art', query: 'is:noart', hint: 'Missing embedded artwork' },
  { label: 'Long tracks (5m+)', query: 'duration:>5m', hint: 'Over 5 minutes' },
] as const;

function tokenizeQuery(raw: string): string[] {
  const tokens: string[] = [];
  const regex = /(-?[a-zA-Z]+:"[^"]+"|-?"[^"]+"|\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

function stripQuotes(str: string): string {
  if (str.length >= 2 && str.startsWith('"') && str.endsWith('"')) {
    return str.slice(1, -1);
  }
  return str;
}

function parseDurationValue(val: string): number | null {
  const cleaned = val.trim().toLowerCase();
  const colonMatch = cleaned.match(/^(\d+):(\d{1,2})$/);
  if (colonMatch) {
    return parseInt(colonMatch[1], 10) * 60 + parseInt(colonMatch[2], 10);
  }
  const unitMatch = cleaned.match(/^(\d+(?:\.\d+)?)(m|min|mins|s|sec|secs)?$/);
  if (!unitMatch) return null;
  const num = parseFloat(unitMatch[1]);
  if (!Number.isFinite(num)) return null;
  const unit = unitMatch[2] || 'm';
  return unit.startsWith('s') ? Math.round(num) : Math.round(num * 60);
}

function parseNumericComparison(
  val: string,
  parseVal: (s: string) => number | null
): ParsedNumericComparison | null {
  const trimmed = val.trim();
  const rangeMatch = trimmed.match(/^([^-]+)-([^-]+)$/);
  if (rangeMatch) {
    const min = parseVal(rangeMatch[1]);
    const max = parseVal(rangeMatch[2]);
    if (min !== null && max !== null) {
      return { op: 'range', min: Math.min(min, max), max: Math.max(min, max) };
    }
  }
  const opMatch = trimmed.match(/^(>=|<=|>|<|=)?(.+)$/);
  if (!opMatch) return null;
  const op = (opMatch[1] || '=') as '=' | '>' | '>=' | '<' | '<=';
  const num = parseVal(opMatch[2]);
  if (num === null) return null;
  return { op, min: num };
}

function matchesNumeric(actual: number, cmp: ParsedNumericComparison): boolean {
  if (cmp.op === 'range' && cmp.max !== undefined) {
    return actual >= cmp.min && actual <= cmp.max;
  }
  if (cmp.op === '>') return actual > cmp.min;
  if (cmp.op === '>=') return actual >= cmp.min;
  if (cmp.op === '<') return actual < cmp.min;
  if (cmp.op === '<=') return actual <= cmp.min;
  return actual === cmp.min;
}

export function parseSmartQuery(raw: string): ParsedSmartQuery {
  const parsed: ParsedSmartQuery = {
    raw,
    terms: [],
    excludedTerms: [],
    genres: [],
    excludedGenres: [],
    artists: [],
    albums: [],
    formats: [],
    folders: [],
    statuses: [],
    excludedStatuses: [],
    flags: {},
    yearFilter: null,
    playsFilter: null,
    durationFilter: null,
    activeDescriptors: [],
  };

  const tokens = tokenizeQuery(raw.trim());
  for (const token of tokens) {
    const isNegated = token.startsWith('-') && token.length > 1;
    const body = isNegated ? token.slice(1) : token;
    const colonIdx = body.indexOf(':');

    // Bare keywords that double as natural filters
    const lowerBody = body.toLowerCase();
    if (colonIdx === -1) {
      if (lowerBody === 'lossless') {
        parsed.flags.lossless = !isNegated;
        parsed.activeDescriptors.push(isNegated ? 'Lossy only' : 'Lossless audio');
        continue;
      }
      const cleanTerm = stripQuotes(body).trim().toLowerCase();
      if (!cleanTerm) continue;
      if (isNegated) {
        parsed.excludedTerms.push(cleanTerm);
        parsed.activeDescriptors.push(`Exclude "${cleanTerm}"`);
      } else {
        parsed.terms.push(cleanTerm);
      }
      continue;
    }

    const key = body.slice(0, colonIdx).toLowerCase();
    const valRaw = stripQuotes(body.slice(colonIdx + 1)).trim();
    const val = valRaw.toLowerCase();
    if (!val) continue;

    if (key === 'genre' || key === 'g') {
      if (isNegated) {
        parsed.excludedGenres.push(val);
        parsed.activeDescriptors.push(`Not genre: ${valRaw}`);
      } else {
        parsed.genres.push(val);
        parsed.activeDescriptors.push(`Genre: ${valRaw}`);
      }
    } else if (key === 'artist' || key === 'a') {
      parsed.artists.push(val);
      parsed.activeDescriptors.push(`Artist: ${valRaw}`);
    } else if (key === 'album' || key === 'al') {
      parsed.albums.push(val);
      parsed.activeDescriptors.push(`Album: ${valRaw}`);
    } else if (key === 'format' || key === 'fmt' || key === 'ext') {
      parsed.formats.push(val);
      parsed.activeDescriptors.push(`Format: ${valRaw.toUpperCase()}`);
    } else if (key === 'folder' || key === 'dir') {
      parsed.folders.push(val);
      parsed.activeDescriptors.push(`Folder: ${valRaw}`);
    } else if (key === 'status' || key === 'is' || key === 'has') {
      if (val === 'matched' || val === 'yt') {
        if (isNegated) parsed.excludedStatuses.push('matched');
        else parsed.statuses.push('matched');
        parsed.activeDescriptors.push(isNegated ? 'Not matched' : 'YT Matched');
      } else if (val === 'unmatched' || val === 'pending') {
        if (isNegated) parsed.excludedStatuses.push('unmatched');
        else parsed.statuses.push('unmatched');
        parsed.activeDescriptors.push(isNegated ? 'Not unmatched' : 'Unmatched');
      } else if (val === 'missing' || val === 'broken') {
        if (isNegated) parsed.excludedStatuses.push('missing');
        else parsed.statuses.push('missing');
        parsed.activeDescriptors.push(isNegated ? 'Present on device' : 'Missing on device');
      } else if (val === 'skipped') {
        if (isNegated) parsed.excludedStatuses.push('skipped');
        else parsed.statuses.push('skipped');
        parsed.activeDescriptors.push(isNegated ? 'Not skipped' : 'Skipped');
      } else if (val === 'lossless') {
        parsed.flags.lossless = !isNegated;
        parsed.activeDescriptors.push(isNegated ? 'Lossy only' : 'Lossless audio');
      } else if (val === 'art' || val === 'artwork' || val === 'cover') {
        parsed.flags.hasArt = !isNegated;
        parsed.activeDescriptors.push(isNegated ? 'No cover art' : 'Has cover art');
      } else if (val === 'noart' || val === 'nocover') {
        parsed.flags.hasArt = isNegated;
        parsed.activeDescriptors.push(isNegated ? 'Has cover art' : 'No cover art');
      } else if (val === 'played') {
        parsed.flags.played = !isNegated;
        parsed.activeDescriptors.push(isNegated ? 'Unplayed' : 'Played');
      } else if (val === 'unplayed') {
        parsed.flags.played = isNegated;
        parsed.activeDescriptors.push(isNegated ? 'Played' : 'Unplayed');
      }
    } else if (key === 'year' || key === 'y') {
      const cmp = parseNumericComparison(val, (s) => {
        const n = parseInt(s, 10);
        return Number.isFinite(n) && n >= 1900 && n <= 2100 ? n : null;
      });
      if (cmp) {
        parsed.yearFilter = cmp;
        parsed.activeDescriptors.push(`Year: ${valRaw}`);
      }
    } else if (key === 'plays' || key === 'play' || key === 'p') {
      const cmp = parseNumericComparison(val, (s) => {
        const n = parseInt(s, 10);
        return Number.isFinite(n) && n >= 0 ? n : null;
      });
      if (cmp) {
        parsed.playsFilter = cmp;
        parsed.activeDescriptors.push(`Plays: ${valRaw}`);
      }
    } else if (key === 'duration' || key === 'dur' || key === 'len' || key === 'time') {
      const cmp = parseNumericComparison(val, parseDurationValue);
      if (cmp) {
        parsed.durationFilter = cmp;
        parsed.activeDescriptors.push(`Duration: ${valRaw}`);
      }
    } else {
      // Unrecognized operator — treat as plain search text so user isn't surprised
      parsed.terms.push(lowerBody);
    }
  }

  return parsed;
}

/**
 * Lightweight fuzzy subsequence & edit-distance-1 check for typo tolerance.
 */
function fuzzyMatchTerm(haystack: string, needle: string): number {
  if (!haystack || !needle) return 0;
  if (haystack === needle) return 100;
  if (haystack.startsWith(needle)) return 82;
  const wordStartIdx = haystack.indexOf(` ${needle}`);
  if (wordStartIdx !== -1) return 70;
  if (haystack.includes(needle)) return 55;

  // Acronym / initials match (e.g. "dp" -> "Daft Punk")
  if (needle.length >= 2 && needle.length <= 6) {
    const words = haystack.split(/[\s\-_/]+/).filter(Boolean);
    if (words.length >= needle.length) {
      const initials = words.map((w) => w[0]).join('');
      if (initials.includes(needle)) return 42;
    }
  }

  // Ordered subsequence match for short typo / abbreviated queries (>= 3 chars)
  if (needle.length >= 3) {
    let qi = 0;
    let consecutive = 0;
    let maxConsecutive = 0;
    for (let hi = 0; hi < haystack.length && qi < needle.length; hi++) {
      if (haystack[hi] === needle[qi]) {
        qi++;
        consecutive++;
        if (consecutive > maxConsecutive) maxConsecutive = consecutive;
      } else {
        consecutive = 0;
      }
    }
    if (qi === needle.length && maxConsecutive >= Math.max(2, Math.floor(needle.length * 0.5))) {
      return 26;
    }

    // 1-edit typo tolerance on individual words of length >= 4
    if (needle.length >= 4) {
      const words = haystack.split(/[^a-z0-9]+/);
      for (const word of words) {
        if (Math.abs(word.length - needle.length) > 1) continue;
        let diffs = 0;
        let i = 0;
        let j = 0;
        while (i < word.length && j < needle.length) {
          if (word[i] === needle[j]) {
            i++;
            j++;
          } else {
            diffs++;
            if (diffs > 1) break;
            if (word.length > needle.length) i++;
            else if (needle.length > word.length) j++;
            else {
              i++;
              j++;
            }
          }
        }
        diffs += word.length - i + (needle.length - j);
        if (diffs <= 1) return 32;
      }
    }
  }

  return 0;
}

export function evaluateSmartTrackSearch(
  tracks: LocalTrack[],
  rawQuery: string,
  playStats: Record<string, TrackPlayStats> = {},
  precomputedGenres?: Map<string, string>
): { parsed: ParsedSmartQuery; results: SmartTrackResult[] } {
  const parsed = parseSmartQuery(rawQuery);
  const hasFilters =
    parsed.terms.length > 0 ||
    parsed.excludedTerms.length > 0 ||
    parsed.genres.length > 0 ||
    parsed.excludedGenres.length > 0 ||
    parsed.artists.length > 0 ||
    parsed.albums.length > 0 ||
    parsed.formats.length > 0 ||
    parsed.folders.length > 0 ||
    parsed.statuses.length > 0 ||
    parsed.excludedStatuses.length > 0 ||
    parsed.flags.lossless !== undefined ||
    parsed.flags.hasArt !== undefined ||
    parsed.flags.played !== undefined ||
    parsed.yearFilter !== null ||
    parsed.playsFilter !== null ||
    parsed.durationFilter !== null;

  if (!hasFilters) {
    return {
      parsed,
      results: tracks.map((track) => ({
        track,
        genre: precomputedGenres?.get(track.id) ?? inferTrackGenre(track).genre,
        score: 0,
        matchedFields: [],
      })),
    };
  }

  const results: SmartTrackResult[] = [];

  for (const track of tracks) {
    const genre = precomputedGenres?.get(track.id) ?? inferTrackGenre(track).genre;
    const genreLower = genre.toLowerCase();
    const rawGenreLower = (track.genre ?? '').toLowerCase();
    const titleLower = track.title.toLowerCase();
    const artistLower = track.artist.toLowerCase();
    const albumLower = track.album.toLowerCase();
    const folderLower = track.folderName.toLowerCase();
    const fileLower = track.fileName.toLowerCase();
    const formatUpper = (track.format || '').toUpperCase();
    const formatLower = formatUpper.toLowerCase();
    const playCount = playStats[track.id]?.playCount ?? track.playCount ?? 0;

    // 1. Structured filter checks
    if (
      parsed.genres.length > 0 &&
      !parsed.genres.some((g) => genreLower.includes(g) || rawGenreLower.includes(g))
    ) {
      continue;
    }
    if (
      parsed.excludedGenres.length > 0 &&
      parsed.excludedGenres.some((g) => genreLower.includes(g) || rawGenreLower.includes(g))
    ) {
      continue;
    }
    if (parsed.artists.length > 0 && !parsed.artists.every((a) => artistLower.includes(a))) {
      continue;
    }
    if (parsed.albums.length > 0 && !parsed.albums.every((al) => albumLower.includes(al))) {
      continue;
    }
    if (parsed.formats.length > 0 && !parsed.formats.some((f) => formatLower === f || formatLower.includes(f))) {
      continue;
    }
    if (parsed.folders.length > 0 && !parsed.folders.every((f) => folderLower.includes(f))) {
      continue;
    }

    const checkStatus = (st: 'matched' | 'unmatched' | 'missing' | 'skipped') => {
      if (st === 'matched') return Boolean(track.youtubeVideoId);
      if (st === 'unmatched') return !track.youtubeVideoId && track.matchStatus !== 'skipped';
      if (st === 'missing') return track.isMissingOnDevice;
      return track.matchStatus === 'skipped';
    };

    if (parsed.statuses.length > 0 && !parsed.statuses.every(checkStatus)) {
      continue;
    }
    if (parsed.excludedStatuses.length > 0 && parsed.excludedStatuses.some(checkStatus)) {
      continue;
    }

    if (parsed.flags.lossless !== undefined) {
      const isLossless = LOSSLESS_FORMATS.has(formatUpper);
      if (isLossless !== parsed.flags.lossless) continue;
    }
    if (parsed.flags.hasArt !== undefined) {
      const hasArt = Boolean(track.coverArtUrl);
      if (hasArt !== parsed.flags.hasArt) continue;
    }
    if (parsed.flags.played !== undefined) {
      const wasPlayed = playCount > 0;
      if (wasPlayed !== parsed.flags.played) continue;
    }

    if (parsed.yearFilter) {
      const yr = parseInt(track.year, 10);
      if (!Number.isFinite(yr) || !matchesNumeric(yr, parsed.yearFilter)) continue;
    }
    if (parsed.playsFilter && !matchesNumeric(playCount, parsed.playsFilter)) {
      continue;
    }
    if (parsed.durationFilter) {
      if (!track.duration || !matchesNumeric(track.duration, parsed.durationFilter)) continue;
    }

    const fullText = `${titleLower} ${artistLower} ${albumLower} ${genreLower} ${rawGenreLower} ${folderLower} ${fileLower} ${track.year} ${formatLower} ${(track.youtubeVideoId ?? '').toLowerCase()}`;

    if (parsed.excludedTerms.length > 0 && parsed.excludedTerms.some((t) => fullText.includes(t))) {
      continue;
    }

    // 2. Fuzzy relevance scoring across free-text terms
    let totalScore = 10;
    const matchedFields = new Set<string>();
    let allTermsMatched = true;

    for (const term of parsed.terms) {
      const titleScore = fuzzyMatchTerm(titleLower, term) * 1.4;
      const artistScore = fuzzyMatchTerm(artistLower, term) * 1.15;
      const albumScore = fuzzyMatchTerm(albumLower, term) * 1.0;
      const genreScore = fuzzyMatchTerm(genreLower, term) * 0.95;
      const pathScore = fuzzyMatchTerm(`${folderLower} ${fileLower}`, term) * 0.7;
      const metaScore =
        track.year === term || formatLower === term || (track.youtubeVideoId ?? '').toLowerCase() === term
          ? 75
          : 0;

      const best = Math.max(titleScore, artistScore, albumScore, genreScore, pathScore, metaScore);
      if (best <= 0) {
        allTermsMatched = false;
        break;
      }

      totalScore += best;
      if (titleScore === best) matchedFields.add('title');
      else if (artistScore === best) matchedFields.add('artist');
      else if (albumScore === best) matchedFields.add('album');
      else if (genreScore === best) matchedFields.add('genre');
      else if (metaScore === best) matchedFields.add('metadata');
      else matchedFields.add('file');
    }

    if (!allTermsMatched) continue;

    // Gentle tie-breakers for play counts & verified YT matches
    totalScore += Math.min(12, playCount * 2);
    if (track.youtubeVideoId) totalScore += 3;

    results.push({
      track,
      genre,
      score: Math.round(totalScore),
      matchedFields: Array.from(matchedFields),
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.track.addedAt - a.track.addedAt;
  });

  return { parsed, results };
}

export function runGlobalSmartSearch(
  rawQuery: string,
  tracks: LocalTrack[],
  playlists: Playlist[],
  playStats: Record<string, TrackPlayStats>
): GlobalSmartSearchResults {
  const { parsed, results: trackResults } = evaluateSmartTrackSearch(tracks, rawQuery, playStats);
  const queryLower = parsed.terms.join(' ').trim();

  // Playlists matching free-text terms
  const playlistResults: SmartPlaylistResult[] = [];
  if (queryLower || parsed.activeDescriptors.length === 0) {
    for (const pl of playlists) {
      if (!queryLower) {
        playlistResults.push({ playlist: pl, score: pl.updatedAt });
        continue;
      }
      const nameScore = fuzzyMatchTerm(pl.name.toLowerCase(), queryLower) * 1.4;
      const descScore = fuzzyMatchTerm(pl.description.toLowerCase(), queryLower);
      const best = Math.max(nameScore, descScore);
      if (best > 0) {
        playlistResults.push({ playlist: pl, score: best });
      }
    }
    playlistResults.sort((a, b) => b.score - a.score);
  }

  // Albums matching query (built from matched tracks or album names)
  const albumMap = new Map<string, SmartAlbumResult>();
  const albumSourceTracks = queryLower || parsed.activeDescriptors.length > 0 ? trackResults.map((r) => r.track) : tracks;
  for (const track of albumSourceTracks) {
    const albumName = (track.album || '').trim();
    if (!albumName || albumName.toLowerCase() === 'unknown album') continue;
    const key = albumName.toLowerCase();
    const existing = albumMap.get(key);
    const score = queryLower
      ? Math.max(
          fuzzyMatchTerm(albumName.toLowerCase(), queryLower) * 1.3,
          fuzzyMatchTerm(track.artist.toLowerCase(), queryLower)
        )
      : 10;

    if (!existing) {
      albumMap.set(key, {
        key,
        album: albumName,
        artist: track.artist,
        year: track.year,
        coverArtUrl: track.coverArtUrl,
        trackIds: [track.id],
        trackCount: 1,
        score,
      });
    } else {
      existing.trackIds.push(track.id);
      existing.trackCount += 1;
      if (!existing.coverArtUrl && track.coverArtUrl) existing.coverArtUrl = track.coverArtUrl;
      if (score > existing.score) existing.score = score;
    }
  }
  const albums = Array.from(albumMap.values())
    .filter((a) => !queryLower || a.score > 0 || parsed.activeDescriptors.length > 0)
    .sort((a, b) => b.score - a.score || b.trackCount - a.trackCount);

  // Genres matching query
  const genreMap = new Map<string, SmartGenreResult>();
  for (const track of tracks) {
    const g = inferTrackGenre(track).genre;
    const existing = genreMap.get(g);
    const score = queryLower ? fuzzyMatchTerm(g.toLowerCase(), queryLower) : 10;
    if (!existing) {
      genreMap.set(g, { genre: g, count: 1, trackIds: [track.id], score });
    } else {
      existing.count += 1;
      existing.trackIds.push(track.id);
    }
  }
  const genres = Array.from(genreMap.values())
    .filter((g) => (queryLower ? g.score > 0 : g.genre !== 'Unclassified'))
    .sort((a, b) => b.score - a.score || b.count - a.count);

  return {
    parsed,
    tracks: trackResults,
    playlists: playlistResults,
    albums,
    genres,
  };
}
