import type { LocalTrack } from '../types/music';

export interface DeviceCacheSummary {
  /** Audio files held in this browser's storage. */
  cachedCount: number;
  /** Cached songs that were never uploaded to Google Drive, so Drive cannot give them back. */
  withoutDriveCopyCount: number;
}

export function summarizeDeviceCache(
  tracks: readonly LocalTrack[],
  cachedKeys: ReadonlySet<string>
): DeviceCacheSummary {
  let withoutDriveCopyCount = 0;
  for (const track of tracks) {
    if (cachedKeys.has(track.fileKey) && !track.driveFileId) withoutDriveCopyCount += 1;
  }
  return { cachedCount: cachedKeys.size, withoutDriveCopyCount };
}

/** What the Clear Device Cache dialog tells the user before they confirm. */
export function clearDeviceCacheMessage(input: DeviceCacheSummary & { sizeLabel: string }): string {
  const files = `${input.cachedCount} cached audio file${input.cachedCount === 1 ? '' : 's'}`;
  const opening = `Remove ${files} (${input.sizeLabel}) from this browser's storage.`;
  const originals = 'The original files on your disk are not touched.';
  if (input.withoutDriveCopyCount === 0) {
    return `${opening} Every one has a copy in Google Drive, which CrateSync downloads again when you play the song. ${originals}`;
  }
  const count = input.withoutDriveCopyCount;
  return `${opening} ${count} of them ${count === 1 ? 'has' : 'have'} no copy in Google Drive, so CrateSync cannot play ${count === 1 ? 'it' : 'them'} again until you rescan the folder or add the file${count === 1 ? '' : 's'} again. ${originals}`;
}
