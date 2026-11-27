import type { LocalTrack } from '../types/music';

/** What a Drive file's name and folders say about a song before anything reads the file. */
export interface DrivePathGuess {
  title: string;
  artist: string;
  album: string;
  trackNumber: number | null;
  /** The folder path with no leading or trailing slash. */
  effectivePath: string;
  leafFolder: string;
}

/**
 * Guesses a song's title, artist, album and track number from its file name and its Drive
 * folder path, e.g. "Music/Daft Punk/Discovery". The Drive listing fills new songs with this
 * guess, and applyFileTags uses it to tell a guessed value from one the user typed.
 */
export function guessTrackFieldsFromDrivePath(
  fileName: string,
  folderPath: string | null | undefined,
  folderLabel = 'Google Drive'
): DrivePathGuess {
  const baseName = fileName.replace(/\.[^.]+$/, '').trim() || fileName;
  let cleaned = baseName;
  let trackNumber: number | null = null;

  const trackPrefix = cleaned.match(/^(\d{1,3})\s*[.\-–_]\s*(.+)$/);
  if (trackPrefix) {
    trackNumber = parseInt(trackPrefix[1], 10);
    cleaned = trackPrefix[2].trim();
  }

  const effectivePath = (folderPath || folderLabel || 'Google Drive').replace(/^\/+|\/+$/g, '');
  const pathSegments = effectivePath.split('/').filter(Boolean);
  const leafFolder = pathSegments[pathSegments.length - 1] || folderLabel;

  let artist = 'Unknown Artist';
  let title = cleaned;
  let album = leafFolder === 'Google Drive' ? 'Google Drive Library' : leafFolder;

  const dashParts = cleaned.split(/\s+[-–—]\s+/);
  if (dashParts.length >= 2) {
    artist = dashParts[0].trim();
    title = dashParts.slice(1).join(' - ').trim();
  } else if (pathSegments.length >= 3) {
    // e.g. Music / Artist / Album / 01 Track.flac
    artist = pathSegments[pathSegments.length - 2];
    album = pathSegments[pathSegments.length - 1];
  } else if (pathSegments.length === 2) {
    // e.g. Music / Artist / Track.flac
    artist = pathSegments[1];
  }

  return { title: title || baseName, artist, album, trackNumber, effectivePath, leafFolder };
}

/** What a file's own tags and audio header say. A missing or empty value means the file has none. */
export interface FileTagValues {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  year?: string | null;
  trackNumber?: number | null;
  coverArtUrl?: string | null;
  /** Seconds, 0 when the file does not say. */
  duration?: number;
}

const PLACEHOLDER_VALUES: ReadonlySet<string> = new Set([
  '',
  'Unknown Artist',
  'Unknown Album',
  'Google Drive Library',
]);

/**
 * Every guess the Drive listing could have made for this song. A later scan with another folder
 * scope rewrites drivePath, so the folder in relativePath, which that scan keeps, counts too.
 */
function pathGuessesFor(track: LocalTrack): DrivePathGuess[] {
  const folders = new Set<string>();
  if (track.drivePath) folders.add(track.drivePath);
  const lastSlash = track.relativePath.lastIndexOf('/');
  if (lastSlash > 0) folders.add(track.relativePath.slice(0, lastSlash));
  return [...folders].map((folder) => guessTrackFieldsFromDrivePath(track.fileName, folder));
}

function pickText(
  current: string,
  fromFile: string | null | undefined,
  guessed: readonly string[]
): string {
  const value = fromFile?.trim() ?? '';
  if (!value) return current;
  const nobodyEditedIt = PLACEHOLDER_VALUES.has(current.trim()) || guessed.includes(current);
  return nobodyEditedIt ? value : current;
}

/**
 * The fields of a song that change once the app has read its file, whether it downloaded the
 * whole file or only the first bytes. A text field takes the file's value while the song still
 * holds a placeholder or the guess made from the file name and folders. A value the user typed
 * stays. Returns only what differs from the song, so an empty result means nothing to save.
 */
export function applyFileTags(track: LocalTrack, file: FileTagValues): Partial<LocalTrack> {
  const guesses = pathGuessesFor(track);
  const bareFileName = track.fileName.replace(/\.[^.]+$/, '');
  const changes: Partial<LocalTrack> = {};

  const title = pickText(track.title, file.title, [...guesses.map((g) => g.title), bareFileName]);
  if (title !== track.title) changes.title = title;

  const artist = pickText(track.artist, file.artist, guesses.map((g) => g.artist));
  if (artist !== track.artist) changes.artist = artist;

  const album = pickText(track.album, file.album, guesses.map((g) => g.album));
  if (album !== track.album) changes.album = album;

  const genre = pickText(track.genre ?? '', file.genre, []);
  if (genre !== (track.genre ?? '')) changes.genre = genre;

  const year = pickText(track.year, file.year, []);
  if (year !== track.year) changes.year = year;

  if (
    typeof file.trackNumber === 'number' &&
    file.trackNumber > 0 &&
    file.trackNumber !== track.trackNumber
  ) {
    changes.trackNumber = file.trackNumber;
  }

  if (typeof file.duration === 'number' && file.duration > 0 && file.duration !== track.duration) {
    changes.duration = file.duration;
  }

  if (!track.coverArtUrl && file.coverArtUrl) changes.coverArtUrl = file.coverArtUrl;

  return changes;
}
