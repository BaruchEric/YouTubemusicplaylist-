import type { LocalTrack } from '../types/music';

/**
 * Standard ID3v1 genre lookup table (subset of indices 0..147 covering common genres).
 */
const ID3V1_GENRES: Record<number, string> = {
  0: 'Blues',
  1: 'Classic Rock',
  2: 'Country',
  3: 'Dance',
  4: 'Disco',
  5: 'Funk',
  6: 'Grunge',
  7: 'Hip-Hop',
  8: 'Jazz',
  9: 'Metal',
  10: 'New Age',
  11: 'Oldies',
  12: 'Other',
  13: 'Pop',
  14: 'R&B',
  15: 'Rap',
  16: 'Reggae',
  17: 'Rock',
  18: 'Techno',
  19: 'Industrial',
  20: 'Alternative',
  21: 'Ska',
  22: 'Death Metal',
  24: 'Soundtrack',
  25: 'Euro-Techno',
  26: 'Ambient',
  27: 'Trip-Hop',
  28: 'Vocal',
  29: 'Jazz+Funk',
  30: 'Fusion',
  31: 'Trance',
  32: 'Classical',
  33: 'Instrumental',
  34: 'Acid',
  35: 'House',
  36: 'Game',
  37: 'Sound Clip',
  38: 'Gospel',
  39: 'Noise',
  40: 'AlternRock',
  41: 'Bass',
  42: 'Soul',
  43: 'Punk',
  44: 'Space',
  45: 'Meditative',
  46: 'Instrumental Pop',
  47: 'Instrumental Rock',
  48: 'Ethnic',
  49: 'Gothic',
  50: 'Darkwave',
  51: 'Techno-Industrial',
  52: 'Electronic',
  53: 'Pop-Folk',
  54: 'Eurodance',
  55: 'Dream',
  56: 'Southern Rock',
  58: 'Cult',
  59: 'Gangsta',
  60: 'Top 40',
  62: 'Pop/Funk',
  63: 'Jungle',
  65: 'Cabaret',
  66: 'New Wave',
  67: 'Psychedelic',
  68: 'Rave',
  69: 'Showtunes',
  71: 'Lo-Fi',
  73: 'Acid Punk',
  74: 'Acid Jazz',
  78: 'Rock & Roll',
  79: 'Hard Rock',
  80: 'Folk',
  81: 'Folk-Rock',
  84: 'Fast Fusion',
  85: 'Swing',
  86: 'Latin',
  88: 'Celtic',
  89: 'Bluegrass',
  90: 'Avantgarde',
  91: 'Gothic Rock',
  92: 'Progressive Rock',
  93: 'Psychedelic Rock',
  94: 'Symphonic Rock',
  95: 'Slow Rock',
  96: 'Big Band',
  97: 'Chorus',
  98: 'Easy Listening',
  99: 'Acoustic',
  101: 'Speech',
  103: 'Opera',
  104: 'Chamber Music',
  105: 'Sonata',
  106: 'Symphony',
  108: 'Primus',
  110: 'Satire',
  111: 'Slow Jam',
  112: 'Club',
  113: 'Tango',
  114: 'Samba',
  115: 'Folklore',
  116: 'Ballad',
  117: 'Power Ballad',
  118: 'Rhythmic Soul',
  119: 'Freestyle',
  121: 'Punk Rock',
  122: 'Drum Solo',
  123: 'A Cappella',
  124: 'Euro-House',
  125: 'Dance Hall',
  126: 'Goa',
  127: 'Drum & Bass',
  128: 'Club-House',
  129: 'Hardcore',
  130: 'Terror',
  131: 'Indie',
  132: 'BritPop',
  136: 'Christian Gangsta',
  137: 'Heavy Metal',
  138: 'Black Metal',
  141: 'Christian Rock',
  142: 'Merengue',
  143: 'Salsa',
  144: 'Thrash Metal',
  145: 'Anime',
  146: 'JPop',
  147: 'Synthpop',
};

export function lookupId3v1Genre(code: number): string | undefined {
  return ID3V1_GENRES[code];
}

export function cleanRawGenreTag(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Handle ID3v2 numeric references like "(17)" or "(17)Rock" or bare "17"
  const parenMatch = trimmed.match(/^\((\d{1,3})\)\s*(.*)$/);
  if (parenMatch) {
    const trailing = parenMatch[2].trim();
    if (trailing) return trailing;
    const mapped = ID3V1_GENRES[parseInt(parenMatch[1], 10)];
    return mapped ?? '';
  }
  if (/^\d{1,3}$/.test(trimmed)) {
    return ID3V1_GENRES[parseInt(trimmed, 10)] ?? '';
  }
  return trimmed;
}

interface GenreRule {
  genre: string;
  patterns: RegExp[];
}

const CANONICAL_GENRE_RULES: GenreRule[] = [
  {
    genre: 'Electronic',
    patterns: [
      /\b(electronic|electronica|edm|house|deep house|tech house|progressive house|techno|trance|dubstep|drum\s*&?\s*bass|dnb|synthwave|retrowave|vaporwave|electro|idm|breakbeat|uk garage|future bass|hardstyle|rave|club mix|club|eurodance|disco|nu-disco|acid|jungle|goa|chiptune|cyberpunk|remix|vip mix|extended mix|radio edit|dj\b)/i,
    ],
  },
  {
    genre: 'Hip-Hop / Rap',
    patterns: [
      /\b(hip[\s-]?hop|rap|trap|drill|boom\s?bap|mixtape|cypher|freestyle|gangsta|grime|phonk|beat tape|type beat|instrumental beat|prod\.|mc\b)/i,
    ],
  },
  {
    genre: 'Ambient / Lo-Fi',
    patterns: [
      /\b(lo[\s-]?fi|lofi|ambient|chillhop|chillout|chill[\s-]?wave|chill|downtempo|soundscape|meditation|meditative|sleep|study beats|study music|drone|atmospheric|new age|relaxing|spa|rain sounds|binaural)/i,
    ],
  },
  {
    genre: 'Metal',
    patterns: [
      /\b(metal|heavy metal|death metal|black metal|thrash|metalcore|deathcore|doom metal|nu[\s-]?metal|djent|prog metal|power metal|hardcore punk|sludge)/i,
    ],
  },
  {
    genre: 'Indie / Alternative',
    patterns: [
      /\b(indie|alternative|alt[\s-]?rock|shoegaze|dream\s?pop|bedroom\s?pop|post[\s-]?punk|new\s?wave|britpop|emo|math\s?rock|midwest emo|art\s?rock|grunge|post[\s-]?rock)/i,
    ],
  },
  {
    genre: 'Rock',
    patterns: [
      /\b(rock|punk|classic rock|hard rock|garage rock|prog rock|progressive rock|psychedelic|southern rock|blues rock|rock\s*&\s*roll|guitar solo)/i,
    ],
  },
  {
    genre: 'R&B / Soul',
    patterns: [
      /\b(r&b|rnb|rhythm\s*&?\s*blues|soul|neo[\s-]?soul|funk|motown|gospel|quiet storm|slow jam|groove)/i,
    ],
  },
  {
    genre: 'Jazz',
    patterns: [
      /\b(jazz|bebop|swing|bossa\s?nova|fusion|smooth jazz|acid jazz|big band|saxophone|sax\b|jazz trio|quartet|quintet|blues|blue note)/i,
    ],
  },
  {
    genre: 'Classical',
    patterns: [
      /\b(classical|symphony|concerto|sonata|prelude|nocturne|etude|étude|adagio|allegro|andante|orchestra|philharmonic|chamber music|string quartet|violin concerto|cello suite|piano solo|baroque|opera|waltz|requiem|cantata|op\.\s*\d+|bwv\s*\d+|k\.\s*\d+)/i,
    ],
  },
  {
    genre: 'Pop',
    patterns: [
      /\b(pop|dance[\s-]?pop|synth[\s-]?pop|k[\s-]?pop|j[\s-]?pop|electropop|hyperpop|top\s*40|vocal pop|teen pop|europop|mandopop|cantopop|a cappella)/i,
    ],
  },
  {
    genre: 'Country / Folk',
    patterns: [
      /\b(country|folk|americana|bluegrass|singer[\s-]?songwriter|acoustic|western|celtic|banjo|nashville|ballad|unplugged)/i,
    ],
  },
  {
    genre: 'Latin / Reggae',
    patterns: [
      /\b(latin|reggaeton|salsa|bachata|cumbia|merengue|tango|samba|flamenco|mariachi|corrido|reggae|dub|ska|dancehall|afrobeat|afrobeats|amapiano)/i,
    ],
  },
  {
    genre: 'Soundtrack / Score',
    patterns: [
      /\b(soundtrack|ost\b|original score|film score|movie score|main theme|main title|end credits|opening theme|ending theme|anime|video game|game music|cinematic|trailer|overture|suite|showtunes)/i,
    ],
  },
  {
    genre: 'Podcast / Spoken',
    patterns: [
      /\b(podcast|episode|ep\.\s*\d+|audiobook|interview|lecture|spoken word|speech|voice memo|talk show|commentary|narration)/i,
    ],
  },
];

export interface InferredGenreResult {
  genre: string;
  source: 'tag' | 'inferred' | 'unclassified';
}

function matchCanonicalGenre(text: string): string | null {
  for (const rule of CANONICAL_GENRE_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return rule.genre;
      }
    }
  }
  return null;
}

/**
 * Resolves a track's canonical music genre from:
 * 1) Embedded/edited genre metadata tag (`track.genre`)
 * 2) Folder & relative path hints
 * 3) Artist, album, title, and filename keywords
 * 4) Duration heuristic for long-form spoken audio
 */
export function inferTrackGenre(track: LocalTrack): InferredGenreResult {
  // 1. Explicit embedded or user-edited genre tag
  if (track.genre) {
    const cleaned = cleanRawGenreTag(track.genre);
    if (cleaned && cleaned.toLowerCase() !== 'other' && cleaned.toLowerCase() !== 'unknown') {
      const canonical = matchCanonicalGenre(cleaned);
      if (canonical) {
        return { genre: canonical, source: 'tag' };
      }
      // Preserve clean custom/specific user genre tag in title case
      const titled = cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
      return { genre: titled, source: 'tag' };
    }
  }

  // 2. Folder & path cues (strong user organization signal)
  const pathContext = `${track.folderName} ${track.relativePath.replace(/[/\\_-]+/g, ' ')}`;
  const fromPath = matchCanonicalGenre(pathContext);
  if (fromPath) {
    return { genre: fromPath, source: 'inferred' };
  }

  // 3. Artist, album, title, and filename cues
  const metaContext = [
    track.artist !== 'Unknown Artist' ? track.artist : '',
    track.album !== 'Unknown Album' ? track.album : '',
    track.title,
    track.fileName.replace(/[_.-]+/g, ' '),
  ]
    .filter(Boolean)
    .join(' ');

  const fromMeta = matchCanonicalGenre(metaContext);
  if (fromMeta) {
    return { genre: fromMeta, source: 'inferred' };
  }

  // 4. Duration fallback for very long recordings (> 22 min)
  if (track.duration >= 22 * 60) {
    return { genre: 'Podcast / Spoken', source: 'inferred' };
  }

  return { genre: 'Unclassified', source: 'unclassified' };
}

export interface GenreGroupSummary {
  genre: string;
  tracks: LocalTrack[];
  trackIds: string[];
  count: number;
  sharePct: number;
  totalDuration: number;
  avgDuration: number;
  totalSize: number;
  avgBitrateKbps: number | null;
  matchedCount: number;
  taggedCount: number;
}

export interface DurationBucket {
  label: string;
  count: number;
  pct: number;
}

export interface FormatSummary {
  format: string;
  count: number;
  size: number;
  pct: number;
}

export interface TrackStatistics {
  totalTracks: number;
  activeTracks: number;
  missingTracks: number;
  matchedTracks: number;
  unmatchedTracks: number;
  skippedTracks: number;
  matchRatePct: number;
  totalDuration: number;
  avgDuration: number;
  longestTrack: LocalTrack | null;
  shortestTrack: LocalTrack | null;
  totalSize: number;
  avgSize: number;
  avgBitrateKbps: number | null;
  losslessCount: number;
  losslessPct: number;
  uniqueArtists: number;
  uniqueAlbums: number;
  uniqueFolders: number;
  uniqueGenres: number;
  withCoverArtCount: number;
  withYearCount: number;
  withEmbeddedGenreCount: number;
  yearRange: { min: number; max: number } | null;
  durationBuckets: DurationBucket[];
  formats: FormatSummary[];
  genreGroups: GenreGroupSummary[];
}

const LOSSLESS_FORMATS = new Set(['FLAC', 'WAV', 'AIFF', 'AIF', 'AIFC', 'ALAC']);

export function computeTrackBitrateKbps(track: LocalTrack): number | null {
  if (!track.fileSize || track.fileSize <= 0 || !track.duration || track.duration <= 0) {
    return null;
  }
  const kbps = Math.round((track.fileSize * 8) / (track.duration * 1000));
  // Filter unrealistic outlier values (e.g. corrupt header or tiny placeholder)
  if (kbps < 16 || kbps > 10000) return null;
  return kbps;
}

export function computeTrackStatistics(tracks: LocalTrack[]): TrackStatistics {
  let activeTracks = 0;
  let missingTracks = 0;
  let matchedTracks = 0;
  let unmatchedTracks = 0;
  let skippedTracks = 0;
  let totalDuration = 0;
  let durationKnownCount = 0;
  let totalSize = 0;
  let sizeKnownCount = 0;
  let bitrateSum = 0;
  let bitrateCount = 0;
  let losslessCount = 0;
  let withCoverArtCount = 0;
  let withYearCount = 0;
  let withEmbeddedGenreCount = 0;

  let longestTrack: LocalTrack | null = null;
  let shortestTrack: LocalTrack | null = null;

  let minYear = Infinity;
  let maxYear = -Infinity;

  const artists = new Set<string>();
  const albums = new Set<string>();
  const folders = new Set<string>();
  const formatTotals = new Map<string, { count: number; size: number }>();

  const genreBuckets = new Map<
    string,
    {
      tracks: LocalTrack[];
      totalDuration: number;
      totalSize: number;
      bitrateSum: number;
      bitrateCount: number;
      matchedCount: number;
      taggedCount: number;
    }
  >();

  let under2m = 0;
  let twoTo4m = 0;
  let fourTo6m = 0;
  let over6m = 0;

  for (const track of tracks) {
    if (track.isMissingOnDevice) missingTracks++;
    else activeTracks++;

    if (track.youtubeVideoId) matchedTracks++;
    else if (track.matchStatus === 'skipped') skippedTracks++;
    else unmatchedTracks++;

    if (track.duration > 0) {
      totalDuration += track.duration;
      durationKnownCount++;
      if (!longestTrack || track.duration > longestTrack.duration) {
        longestTrack = track;
      }
      if (!shortestTrack || track.duration < shortestTrack.duration) {
        shortestTrack = track;
      }
      if (track.duration < 120) under2m++;
      else if (track.duration < 240) twoTo4m++;
      else if (track.duration < 360) fourTo6m++;
      else over6m++;
    }

    if (track.fileSize > 0) {
      totalSize += track.fileSize;
      sizeKnownCount++;
    }

    const kbps = computeTrackBitrateKbps(track);
    if (kbps !== null) {
      bitrateSum += kbps;
      bitrateCount++;
    }

    const fmt = (track.format || 'AUDIO').toUpperCase();
    if (LOSSLESS_FORMATS.has(fmt)) losslessCount++;
    const fmtEntry = formatTotals.get(fmt) ?? { count: 0, size: 0 };
    fmtEntry.count += 1;
    fmtEntry.size += track.fileSize || 0;
    formatTotals.set(fmt, fmtEntry);

    if (track.artist && track.artist !== 'Unknown Artist') {
      artists.add(track.artist.toLowerCase());
    }
    if (track.album && track.album !== 'Unknown Album') {
      albums.add(track.album.toLowerCase());
    }
    if (track.folderName) {
      folders.add(track.folderName.toLowerCase());
    }
    if (track.coverArtUrl) withCoverArtCount++;

    const parsedYear = parseInt(track.year, 10);
    if (Number.isFinite(parsedYear) && parsedYear >= 1900 && parsedYear <= 2100) {
      withYearCount++;
      if (parsedYear < minYear) minYear = parsedYear;
      if (parsedYear > maxYear) maxYear = parsedYear;
    }

    const inferred = inferTrackGenre(track);
    if (inferred.source === 'tag') withEmbeddedGenreCount++;

    const gEntry = genreBuckets.get(inferred.genre) ?? {
      tracks: [],
      totalDuration: 0,
      totalSize: 0,
      bitrateSum: 0,
      bitrateCount: 0,
      matchedCount: 0,
      taggedCount: 0,
    };
    gEntry.tracks.push(track);
    gEntry.totalDuration += track.duration || 0;
    gEntry.totalSize += track.fileSize || 0;
    if (kbps !== null) {
      gEntry.bitrateSum += kbps;
      gEntry.bitrateCount++;
    }
    if (track.youtubeVideoId) gEntry.matchedCount++;
    if (inferred.source === 'tag') gEntry.taggedCount++;
    genreBuckets.set(inferred.genre, gEntry);
  }

  const totalTracks = tracks.length;
  const matchRatePct = totalTracks > 0 ? Math.round((matchedTracks / totalTracks) * 100) : 0;
  const avgDuration = durationKnownCount > 0 ? totalDuration / durationKnownCount : 0;
  const avgSize = sizeKnownCount > 0 ? totalSize / sizeKnownCount : 0;
  const avgBitrateKbps = bitrateCount > 0 ? Math.round(bitrateSum / bitrateCount) : null;
  const losslessPct = totalTracks > 0 ? Math.round((losslessCount / totalTracks) * 100) : 0;

  const bucketDenom = Math.max(1, durationKnownCount);
  const durationBuckets: DurationBucket[] = [
    { label: '< 2m', count: under2m, pct: Math.round((under2m / bucketDenom) * 100) },
    { label: '2–4m', count: twoTo4m, pct: Math.round((twoTo4m / bucketDenom) * 100) },
    { label: '4–6m', count: fourTo6m, pct: Math.round((fourTo6m / bucketDenom) * 100) },
    { label: '6m+', count: over6m, pct: Math.round((over6m / bucketDenom) * 100) },
  ];

  const formats: FormatSummary[] = Array.from(formatTotals.entries())
    .map(([format, data]) => ({
      format,
      count: data.count,
      size: data.size,
      pct: totalTracks > 0 ? Math.round((data.count / totalTracks) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const genreGroups: GenreGroupSummary[] = Array.from(genreBuckets.entries())
    .map(([genre, data]) => ({
      genre,
      tracks: data.tracks,
      trackIds: data.tracks.map((t) => t.id),
      count: data.tracks.length,
      sharePct: totalTracks > 0 ? Math.round((data.tracks.length / totalTracks) * 100) : 0,
      totalDuration: data.totalDuration,
      avgDuration: data.tracks.length > 0 ? data.totalDuration / data.tracks.length : 0,
      totalSize: data.totalSize,
      avgBitrateKbps:
        data.bitrateCount > 0 ? Math.round(data.bitrateSum / data.bitrateCount) : null,
      matchedCount: data.matchedCount,
      taggedCount: data.taggedCount,
    }))
    .sort((a, b) => {
      // Keep Unclassified at the bottom unless it's the only bucket
      if (a.genre === 'Unclassified' && b.genre !== 'Unclassified') return 1;
      if (b.genre === 'Unclassified' && a.genre !== 'Unclassified') return -1;
      return b.count - a.count || b.totalDuration - a.totalDuration;
    });

  const classifiedGenreCount = genreGroups.filter((g) => g.genre !== 'Unclassified').length;

  return {
    totalTracks,
    activeTracks,
    missingTracks,
    matchedTracks,
    unmatchedTracks,
    skippedTracks,
    matchRatePct,
    totalDuration,
    avgDuration,
    longestTrack,
    shortestTrack,
    totalSize,
    avgSize,
    avgBitrateKbps,
    losslessCount,
    losslessPct,
    uniqueArtists: artists.size,
    uniqueAlbums: albums.size,
    uniqueFolders: folders.size,
    uniqueGenres: classifiedGenreCount > 0 ? classifiedGenreCount : genreGroups.length,
    withCoverArtCount,
    withYearCount,
    withEmbeddedGenreCount,
    yearRange: minYear <= maxYear ? { min: minYear, max: maxYear } : null,
    durationBuckets,
    formats,
    genreGroups,
  };
}
