/**
 * Bulk matching: finds the YouTube video for many songs at once. The videos come from a
 * YouTube search, from a playlist the user names or from a list the user pastes. This module
 * decides which video fits which song and how sure it is. Nothing here writes to the library:
 * the user reviews the proposals and applies the ones they keep.
 */
import type { LocalTrack, Playlist } from '../types/music';
import { YouTubeApiError, type YouTubeFailure, type YouTubeVideoSummary } from './youtubeApi';
import type { ImportedTrackSeed } from './youtubeLinks';

/** A YouTube video offered as the match for a song. */
export type MatchCandidate = YouTubeVideoSummary;

/**
 * exact: the title and the artist both agree. likely: the title agrees and the artist could
 * not be checked, or the artist agrees and the title is close.
 */
export type MatchConfidence = 'exact' | 'likely';

export interface MatchProposal {
  trackId: string;
  candidate: MatchCandidate;
  confidence: MatchConfidence;
}

/** What one search costs out of the day's quota units. */
export const YOUTUBE_SEARCH_COST_UNITS = 100;

/** How alike two titles must be, by shared words, to count as close. */
const CLOSE_TITLE_SCORE = 0.85;
/** A compact artist name shorter than this must appear as a whole word. */
const MIN_COMPACT_ARTIST_LENGTH = 6;
/** The first of several tagged artists stands for the song alone from this many letters on. */
const MIN_LEAD_ARTIST_LENGTH = 6;
/** How many pool videos a close-title lookup scores for one song. */
const MAX_FUZZY_CANDIDATES = 200;
const BUSY_RETRY_DELAY_MS = 2_000;

const UNKNOWN_ARTISTS = new Set(['', 'unknown artist', 'unknown', 'various artists', 'various', 'va']);

/** Words that name another recording of the song. A video with one fits only a song with it. */
const VERSION_WORDS = [
  'live',
  'remix',
  'acoustic',
  'instrumental',
  'karaoke',
  'cover',
  'demo',
  'unplugged',
  'extended',
  'dub',
  'alternate',
];
/** "Re-Recorded Version" and "Rerecording" are one note, which no single word catches. */
const RERECORDED = /(?:^| )re ?record(?:ed|ing)(?: |$)/;

const BRACKETED = /[([{]([^)\]}]*)[)\]}]/g;
const FEATURED = /\s+(?:feat\.?|ft\.?|featuring)\s.*$/i;
const DASH = /\s+[-–—]\s+/;
const ARTIST_SEPARATOR = /\s*(?:,|;|&|\/|\s+and\s+|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+|\s+with\s+|\s+x\s+|\s+vs\.?\s+)\s*/i;
/** "09 ", "09 - ", "9. " at the start of a title taken from a file name. */
const LEADING_NUMBER = /^\d{1,3}(?:\s*[-._)]\s*|\s+)(?=\S)/;
/** A part after a dash that says which release it is, not what the song is called. */
const RELEASE_NOTE =
  /^(?:(?:\d{4} )?(?:digital(?:ly)? )?remaster(?:ed)?(?: \d{4})?(?: version)?|(?:single|album|radio|original|mono|stereo|explicit|clean)(?: (?:version|edit|mix))?|bonus track|live(?: .*)?)$/;

/** Lower case, no accents, no punctuation, single spaces. "&" reads as "and". */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’‘`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function compact(normalized: string): string {
  return normalized.replace(/ /g, '');
}

function versionWordsIn(text: string): string[] {
  const normalized = normalizeForMatch(text);
  const words = new Set(normalized.split(' '));
  const found = VERSION_WORDS.filter((word) => words.has(word));
  if (RERECORDED.test(normalized)) found.push('rerecorded');
  return found;
}

/**
 * Adds "karaoke" when any of the texts says it. A karaoke upload often says so outside
 * brackets, in a note set off by pipes or only in the channel's name.
 */
function withKaraoke(versions: readonly string[], ...texts: string[]): string[] {
  const saysIt = texts.some((text) => normalizeForMatch(text).split(' ').includes('karaoke'));
  return saysIt ? [...new Set([...versions, 'karaoke'])].sort() : [...versions];
}

interface TitleParts {
  /** The title split at its dashes, with bracketed notes, featured artists and release notes gone. */
  parts: string[];
  /** The version words found in what was taken out, sorted. */
  versions: string[];
}

function titleParts(raw: string): TitleParts {
  const versions = new Set<string>();
  const unbracketed = raw.replace(BRACKETED, (_whole, inner: string) => {
    for (const word of versionWordsIn(inner)) versions.add(word);
    return ' ';
  });
  const parts = unbracketed
    .replace(FEATURED, '')
    .split(DASH)
    .map((part) => part.trim())
    .filter(Boolean);

  while (parts.length > 1) {
    const last = normalizeForMatch(parts[parts.length - 1] ?? '');
    if (!RELEASE_NOTE.test(last)) break;
    for (const word of versionWordsIn(last)) versions.add(word);
    parts.pop();
  }

  // A title that is nothing but a bracketed note keeps its words.
  if (parts.length === 0) {
    const bare = raw.replace(/[()[\]{}]/g, ' ').trim();
    if (bare) parts.push(bare);
  }
  return { parts, versions: [...versions].sort() };
}

/** What a match needs to know about a song. The album is a hint and may be missing. */
export type SongToMatch = Pick<LocalTrack, 'title' | 'artist'> & Partial<Pick<LocalTrack, 'album'>>;

interface SongForm {
  /** The titles the song may go by, normalized. */
  titles: string[];
  /**
   * The names a video may give the artist by, normalized: the whole tag, and the first of
   * several tagged artists when that name is long enough to stand alone. Empty when the
   * tags name nobody.
   */
  artists: string[];
  /** The version words in the title, sorted. */
  versions: string[];
  /** The title's version words plus the album's, sorted. A live album makes every song live. */
  albumVersions: string[];
}

function artistNames(artist: string): string[] {
  if (UNKNOWN_ARTISTS.has(artist.trim().toLowerCase())) return [];
  const names = new Set<string>();
  const whole = normalizeForMatch(artist).replace(/^the /, '');
  if (whole) names.add(whole);

  const parts = artist.split(ARTIST_SEPARATOR).filter((name) => name.trim());
  if (parts.length > 1) {
    const lead = normalizeForMatch(parts[0] ?? '').replace(/^the /, '');
    // "Simon" out of "Simon & Garfunkel" would also fit Paul Simon, so a lone short name is out.
    if (lead.includes(' ') || lead.length >= MIN_LEAD_ARTIST_LENGTH) names.add(lead);
  }
  return [...names];
}

function fileBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim();
}

function songForm(track: SongToMatch): SongForm {
  const { parts, versions: bracketed } = titleParts(track.title);
  // A song called "Karaoke" still fits its own video, which says the word too.
  const versions = withKaraoke(bracketed, track.title);
  const artists = artistNames(track.artist);
  const titles = new Set<string>([normalizeForMatch(parts.join(' '))]);

  const numberless = track.title.replace(LEADING_NUMBER, '');
  if (numberless !== track.title && /\p{L}/u.test(numberless)) {
    titles.add(normalizeForMatch(titleParts(numberless).parts.join(' ')));
  }
  // With no tagged artist, "Artist - Title" in the title field is common.
  if (artists.length === 0 && parts.length > 1) {
    titles.add(normalizeForMatch(parts.slice(1).join(' ')));
  }
  titles.delete('');
  const albumVersions = [...new Set([...versions, ...versionWordsIn(track.album ?? '')])].sort();
  return { titles: [...titles], artists, versions, albumVersions };
}

/** One way to read a video title: which words are the song and which name the artist. */
interface Reading {
  title: string;
  artistText: string;
}

interface CandidateForm {
  readings: Reading[];
  versions: string[];
  isTopicChannel: boolean;
}

function candidateForm(candidate: MatchCandidate): CandidateForm {
  const { parts, versions: bracketed } = titleParts(candidate.title);
  const versions = withKaraoke(bracketed, candidate.title, candidate.channel);
  const channel = normalizeForMatch(candidate.channel);
  const whole = normalizeForMatch(parts.join(' '));
  const readings: Reading[] = [{ title: whole, artistText: channel }];

  if (parts.length > 1) {
    const left = normalizeForMatch(parts[0] ?? '');
    const right = normalizeForMatch(parts.slice(1).join(' '));
    // "Artist - Title". The channel may name the artist too.
    readings.push({ title: right, artistText: `${left} ${channel}` });
    // "Title - Artist". Only the right side may name the artist here, or a song would match
    // any upload by a band it shares its name with.
    readings.push({ title: left, artistText: right });
  }

  return {
    readings: readings.filter((reading) => reading.title),
    versions,
    isTopicChannel: / topic$/.test(channel),
  };
}

function namesArtist(artistText: string, artists: readonly string[]): boolean {
  return artists.some((artist) => {
    if (` ${artistText} `.includes(` ${artist} `)) return true;
    // "JoeCockerVEVO" holds the name with no spaces.
    const squeezed = compact(artist);
    return squeezed.length >= MIN_COMPACT_ARTIST_LENGTH && compact(artistText).includes(squeezed);
  });
}

/** Share of words two titles have in common: 1 when equal, 0 when none. */
function sharedWords(a: string, b: string): number {
  const left = a.split(' ');
  const right = b.split(' ');
  const pool = new Map<string, number>();
  for (const word of left) pool.set(word, (pool.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of right) {
    const count = pool.get(word) ?? 0;
    if (count > 0) {
      shared += 1;
      pool.set(word, count - 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

/** "Wild Boys" and "The Wild Boys" are one title. Too short for the shared-word score to say so. */
function withoutLeadingThe(title: string): string {
  return title.replace(/^the (?=\S)/, '');
}

function isCloseTitle(a: string, b: string): boolean {
  return sharedWords(a, b) >= CLOSE_TITLE_SCORE || withoutLeadingThe(a) === withoutLeadingThe(b);
}

function sameVersions(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((word, index) => word === b[index]);
}

/** A video is the right recording when its version words are the title's, or the title's plus the album's. */
function isRightRecording(song: SongForm, candidate: CandidateForm): boolean {
  return (
    sameVersions(song.versions, candidate.versions) ||
    sameVersions(song.albumVersions, candidate.versions)
  );
}

function scoreForms(song: SongForm, candidate: CandidateForm): MatchConfidence | null {
  if (!isRightRecording(song, candidate)) return null;

  let best: MatchConfidence | null = null;
  for (const reading of candidate.readings) {
    const sameTitle = song.titles.includes(reading.title);
    const closeTitle =
      !sameTitle && song.titles.some((title) => isCloseTitle(title, reading.title));
    if (!sameTitle && !closeTitle) continue;

    if (song.artists.length === 0) {
      if (sameTitle) best = 'likely';
      continue;
    }
    if (!namesArtist(reading.artistText, song.artists)) continue;
    if (sameTitle) return 'exact';
    best = 'likely';
  }
  return best;
}

/** How well a video fits a song, or null when it does not. */
export function scoreCandidate(track: SongToMatch, candidate: MatchCandidate): MatchConfidence | null {
  return scoreForms(songForm(track), candidateForm(candidate));
}

/** The songs a bulk match works on: no video yet and not set aside by the user. */
export function songsToMatch(tracks: readonly LocalTrack[]): LocalTrack[] {
  return tracks.filter((track) => !track.youtubeVideoId && track.matchStatus !== 'skipped');
}

interface Scored {
  candidate: MatchCandidate;
  confidence: MatchConfidence;
  /** The video carries every version word the song's title and album do. */
  fitsAlbum: boolean;
  isTopicChannel: boolean;
  index: number;
}

function scored(
  song: SongForm,
  form: CandidateForm,
  candidate: MatchCandidate,
  index: number
): Scored | null {
  const confidence = scoreForms(song, form);
  if (!confidence) return null;
  return {
    candidate,
    confidence,
    fitsAlbum: sameVersions(song.albumVersions, form.versions),
    isTopicChannel: form.isTopicChannel,
    index,
  };
}

/**
 * Exact beats likely. Among equals the recording the album names wins, then a Topic channel,
 * since YouTube Music plays those, then the earlier result.
 */
function better(a: Scored, b: Scored | null): boolean {
  if (!b) return true;
  if (a.confidence !== b.confidence) return a.confidence === 'exact';
  if (a.fitsAlbum !== b.fitsAlbum) return a.fitsAlbum;
  if (a.isTopicChannel !== b.isTopicChannel) return a.isTopicChannel;
  return a.index < b.index;
}

/** The best of a handful of videos for one song, as a search returns them. */
export function pickSearchResult(
  track: LocalTrack,
  results: readonly MatchCandidate[]
): MatchProposal | null {
  const song = songForm(track);
  let best: Scored | null = null;
  for (const [index, candidate] of results.entries()) {
    const entry = scored(song, candidateForm(candidate), candidate, index);
    if (entry && better(entry, best)) best = entry;
  }
  return best ? { trackId: track.id, candidate: best.candidate, confidence: best.confidence } : null;
}

/**
 * Matches every unmatched song against one pool of videos, such as a playlist's. A video may
 * serve several songs, since a library can hold the same song twice.
 */
export function planBulkMatch(input: {
  tracks: readonly LocalTrack[];
  candidates: readonly MatchCandidate[];
}): MatchProposal[] {
  const forms = input.candidates.map(candidateForm);
  const byTitle = new Map<string, number[]>();
  const byWord = new Map<string, number[]>();
  const file = (map: Map<string, number[]>, key: string, index: number) => {
    const list = map.get(key);
    if (list) {
      if (list[list.length - 1] !== index) list.push(index);
    } else {
      map.set(key, [index]);
    }
  };
  for (const [index, form] of forms.entries()) {
    for (const reading of form.readings) {
      file(byTitle, reading.title, index);
      for (const word of reading.title.split(' ')) {
        if (word.length >= 3) file(byWord, word, index);
      }
    }
  }

  const proposals: MatchProposal[] = [];
  for (const track of songsToMatch(input.tracks)) {
    const song = songForm(track);
    const indexes = new Set<number>();
    for (const title of song.titles) {
      for (const index of byTitle.get(title) ?? []) indexes.add(index);
    }
    if (indexes.size === 0) {
      for (const title of song.titles) {
        for (const word of title.split(' ')) {
          for (const index of byWord.get(word) ?? []) {
            if (indexes.size >= MAX_FUZZY_CANDIDATES) break;
            indexes.add(index);
          }
        }
      }
    }

    let best: Scored | null = null;
    for (const index of indexes) {
      const form = forms[index];
      const candidate = input.candidates[index];
      if (!form || !candidate) continue;
      const entry = scored(song, form, candidate, index);
      if (entry && better(entry, best)) best = entry;
    }
    if (best) {
      proposals.push({ trackId: track.id, candidate: best.candidate, confidence: best.confidence });
    }
  }
  return proposals;
}

/** YouTube Music calls the liked songs "LM". The Data API knows the same list as "LL". */
const LIKED_LIST_IDS: Record<string, string> = { LM: 'LL', LL: 'LL' };
const BARE_PLAYLIST_ID = /^[A-Za-z0-9_-]{2,}$/;

/**
 * The playlist id in what the user typed: a YouTube or YouTube Music link with "list=", or
 * the id on its own. Null when there is none.
 */
export function playlistIdForLookup(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let id: string | null = null;
  if (BARE_PLAYLIST_ID.test(trimmed)) {
    // A bare word of letters is more likely a typed name than an id, so ask for a prefix.
    id = /^(?:PL|OLAK5uy_|UU|FL|RD|LL$|LM$)/.test(trimmed) ? trimmed : null;
  } else if (!/\s/.test(trimmed)) {
    try {
      const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      id = url.searchParams.get('list');
    } catch {
      id = null;
    }
  }
  if (!id || !BARE_PLAYLIST_ID.test(id)) return null;
  return LIKED_LIST_IDS[id] ?? id;
}

/** The lines of a pasted list or an exported file that carry a YouTube link, as videos to match. */
export function candidatesFromSeeds(seeds: readonly ImportedTrackSeed[]): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  for (const seed of seeds) {
    if (!seed.youtubeVideoId) continue;
    const artist = UNKNOWN_ARTISTS.has(seed.artist.trim().toLowerCase()) ? '' : seed.artist.trim();
    const title = seed.title.trim();
    if (!title) continue;
    candidates.push({
      videoId: seed.youtubeVideoId,
      title: artist ? `${artist} - ${title}` : title,
      channel: '',
    });
  }
  return candidates;
}

/** The words to search YouTube with for one song. */
export function searchQueryFor(track: Pick<LocalTrack, 'title' | 'artist' | 'fileName'>): string {
  // A title copied from the file name often starts with the track number.
  const fromFileName = track.title.trim() === fileBaseName(track.fileName);
  const title = fromFileName ? track.title.replace(LEADING_NUMBER, '') : track.title;
  const artist = UNKNOWN_ARTISTS.has(track.artist.trim().toLowerCase()) ? '' : track.artist.trim();
  return `${artist} ${title.trim()}`.trim();
}

/** Songs that sit in a playlist come first, in playlist order: a push needs those. */
export function orderForSearch(
  tracks: readonly LocalTrack[],
  playlists: readonly Pick<Playlist, 'trackIds'>[]
): LocalTrack[] {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const ordered: LocalTrack[] = [];
  const taken = new Set<string>();
  const take = (track: LocalTrack | undefined) => {
    if (!track || taken.has(track.id)) return;
    taken.add(track.id);
    ordered.push(track);
  };
  for (const playlist of playlists) {
    for (const id of playlist.trackIds) take(byId.get(id));
  }
  for (const track of tracks) take(track);
  return ordered;
}

export interface BulkSearchOutcome {
  proposals: MatchProposal[];
  /** The songs YouTube was asked about, matched or not. Each one cost a search. */
  searchedIds: string[];
  /** Why the run ended before the last song, or null when it finished. */
  stopped: { failure: YouTubeFailure | 'cancelled'; message: string } | null;
}

/** One sentence for the person at the screen when a search or a playlist read fails or stops. */
export function describeLookupFailure(
  failure: YouTubeFailure | 'cancelled',
  task: 'search' | 'playlist'
): string {
  const again = task === 'search' ? 'search again' : 'read the playlist again';
  switch (failure) {
    case 'quota':
      return `YouTube's daily allowance for CrateSync is used up. It resets at midnight Pacific time. After that, ${again}.`;
    case 'auth':
      return `YouTube no longer accepts the connection. Connect YouTube and ${again}.`;
    case 'api-disabled':
      return `The YouTube Data API is switched off for the Google Cloud project behind CrateSync. Turn it on in the Google Cloud console, then ${again}.`;
    case 'no-channel':
      return 'This Google account has no YouTube channel yet. Open YouTube once, create the channel, then try again.';
    case 'playlist-missing':
    case 'forbidden':
      return 'YouTube cannot find that playlist under the connected account. A private playlist opens only for the account that owns it.';
    case 'network':
      return `CrateSync could not reach YouTube. Check the connection and ${again}.`;
    case 'busy':
      return `YouTube was too busy to answer. Wait a minute, then ${again}.`;
    case 'cancelled':
      return task === 'search' ? 'Stopped. Search again to look up the rest.' : 'Stopped.';
    default:
      return 'YouTube refused the request.';
  }
}

/** The failure a thrown value stands for. Anything that is not a YouTube error is "other". */
export function lookupFailureOf(err: unknown): YouTubeFailure {
  return err instanceof YouTubeApiError ? err.failure : 'other';
}

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Searches YouTube for each song in turn and keeps the result that fits. One search costs
 * 100 quota units, so the caller decides how many songs to pass. A busy answer is tried once
 * more. Any other failure ends the run with what was found so far.
 */
export async function searchForMatches(input: {
  api: { searchVideos(query: string): Promise<MatchCandidate[]> };
  tracks: readonly LocalTrack[];
  signal?: AbortSignal;
  onProgress?: (progress: { done: number; total: number; found: number }) => void;
  wait?: (ms: number) => Promise<void>;
}): Promise<BulkSearchOutcome> {
  const { api, tracks, signal, onProgress } = input;
  const wait = input.wait ?? defaultWait;
  const outcome: BulkSearchOutcome = { proposals: [], searchedIds: [], stopped: null };
  const stop = (failure: YouTubeFailure | 'cancelled') => {
    outcome.stopped = { failure, message: describeLookupFailure(failure, 'search') };
    return outcome;
  };

  for (const track of tracks) {
    if (signal?.aborted) return stop('cancelled');

    const query = searchQueryFor(track);
    let results: MatchCandidate[];
    try {
      results = await api.searchVideos(query);
    } catch (firstErr) {
      if (lookupFailureOf(firstErr) !== 'busy') return stop(lookupFailureOf(firstErr));
      await wait(BUSY_RETRY_DELAY_MS);
      try {
        results = await api.searchVideos(query);
      } catch (secondErr) {
        return stop(lookupFailureOf(secondErr));
      }
    }

    outcome.searchedIds.push(track.id);
    const proposal = pickSearchResult(track, results);
    if (proposal) outcome.proposals.push(proposal);
    onProgress?.({ done: outcome.searchedIds.length, total: tracks.length, found: outcome.proposals.length });
  }
  return outcome;
}

/**
 * The library with the kept matches written in. A song that already has a video keeps it.
 * Only the video's id is stored: the title and channel YouTube returned are shown for the
 * review and then dropped.
 *
 * checkedAt is when YouTube returned the videos, which starts the 30 days of matchRefresh.
 * Leave it out for videos from a pasted list, which YouTube has not confirmed.
 */
export function applyMatches(
  tracks: readonly LocalTrack[],
  proposals: readonly MatchProposal[],
  checkedAt?: number
): { tracks: LocalTrack[]; appliedCount: number } {
  const videoByTrack = new Map(proposals.map((p) => [p.trackId, p.candidate.videoId]));
  let appliedCount = 0;
  const next = tracks.map((track) => {
    const videoId = videoByTrack.get(track.id);
    if (!videoId || track.youtubeVideoId) return track;
    appliedCount += 1;
    const matched: LocalTrack = { ...track, youtubeVideoId: videoId, matchStatus: 'matched' };
    return checkedAt === undefined
      ? matched
      : { ...matched, youtubeChecked: { videoId, at: checkedAt } };
  });
  return { tracks: next, appliedCount };
}
