import type { LocalTrack } from '../types/music';

/**
 * Formats of a library entry that came from an imported list and has no audio file behind it:
 * YT when the list gave a YouTube video ID, LIST when it gave only a title and artist.
 */
export const LIST_ONLY_FORMATS: ReadonlySet<string> = new Set(['YT', 'LIST']);

export function isListOnlyTrack(track: Pick<LocalTrack, 'format'>): boolean {
  return LIST_ONLY_FORMATS.has(track.format.toUpperCase());
}

/** Audio files the app has seen on this device: no imported lines, no files that went missing. */
export function countDeviceFiles(tracks: readonly LocalTrack[]): number {
  let count = 0;
  for (const track of tracks) {
    if (!track.isMissingOnDevice && !isListOnlyTrack(track)) count += 1;
  }
  return count;
}
