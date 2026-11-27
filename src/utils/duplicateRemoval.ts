/**
 * Takes redundant copies of a song out of the library.
 *
 * A match to a YouTube video belongs to the song, not to one of its files. When the copy
 * that goes holds the match and the copy that stays holds none, the match moves over, so
 * removing a duplicate never costs a search.
 */
import type { LocalTrack } from '../types/music';

function withMatchOf(kept: LocalTrack, removed: LocalTrack): LocalTrack {
  if (kept.youtubeVideoId || !removed.youtubeVideoId) return kept;
  return {
    ...kept,
    youtubeVideoId: removed.youtubeVideoId,
    youtubeTitle: removed.youtubeTitle,
    matchStatus: removed.matchStatus,
    ...(removed.youtubeChecked ? { youtubeChecked: removed.youtubeChecked } : {}),
  };
}

/**
 * The library without the tracks in `removeIds`. `remapToKeep` names, for each removed
 * track, the copy that stays.
 */
export function removeDuplicateTracks(
  tracks: readonly LocalTrack[],
  removeIds: readonly string[],
  remapToKeep: Readonly<Record<string, string>>
): LocalTrack[] {
  const removing = new Set(removeIds);
  const removedByKeptId = new Map<string, LocalTrack[]>();
  for (const track of tracks) {
    if (!removing.has(track.id)) continue;
    const keptId = remapToKeep[track.id];
    if (!keptId) continue;
    const list = removedByKeptId.get(keptId);
    if (list) list.push(track);
    else removedByKeptId.set(keptId, [track]);
  }

  return tracks
    .filter((track) => !removing.has(track.id))
    .map((track) => (removedByKeptId.get(track.id) ?? []).reduce(withMatchOf, track));
}
