import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { BulkMatchDialogState } from '../components/BulkMatchDialog';
import type { LocalTrack, Playlist } from '../types/music';
import {
  applyMatches,
  candidatesFromSeeds,
  describeLookupFailure,
  lookupFailureOf,
  orderForSearch,
  planBulkMatch,
  playlistIdForLookup,
  searchForMatches,
  songsToMatch,
  type MatchCandidate,
  type MatchProposal,
} from '../utils/bulkMatch';
import {
  clearSearchMemory,
  loadSearchMemory,
  rememberSearched,
  songsNotSearchedLately,
  type SearchMemory,
} from '../utils/bulkSearchMemory';
import {
  clearYouTubeAccessToken,
  connectYouTube,
  describeYouTubeConnectError,
  getYouTubeAccessToken,
} from '../utils/googleAuth';
import { applyMatchRefresh, refreshMatches } from '../utils/matchRefresh';
import { createYouTubeApi, type YouTubeLookupApi } from '../utils/youtubeApi';
import { parseImportedText } from '../utils/youtubeLinks';

/** The open window and the songs it works on. scopeIds is null for the whole library. */
interface OpenWindow {
  state: BulkMatchDialogState;
  scopeIds: ReadonlySet<string> | null;
}

/**
 * The "Match songs to YouTube" window: its state and what its buttons do. The matching
 * rules live in utils/bulkMatch. This hook runs them, talks to YouTube and writes the kept
 * matches into the library.
 */
export function useBulkMatch(input: {
  tracks: LocalTrack[];
  playlists: Playlist[];
  setTracks: Dispatch<SetStateAction<LocalTrack[]>>;
  /** Called when the 30-day check found saved videos YouTube no longer has. */
  onMatchesCleared: (count: number) => void;
}) {
  const { tracks, playlists, setTracks, onMatchesCleared } = input;
  const [open, setOpen] = useState<OpenWindow | null>(null);
  const [memory, setMemory] = useState<SearchMemory>({});
  const abortRef = useRef<AbortController | null>(null);
  /** When YouTube returned the videos under review, or null for a pasted list. */
  const reviewCheckedAtRef = useRef<number | null>(null);

  const scopeIds = open?.scopeIds ?? null;
  const unmatched = useMemo(
    () => songsToMatch(scopeIds ? tracks.filter((track) => scopeIds.has(track.id)) : tracks),
    [tracks, scopeIds]
  );
  const searchable = useMemo(
    () => songsNotSearchedLately(unmatched, memory),
    [unmatched, memory]
  );

  const show = (state: BulkMatchDialogState) =>
    setOpen((current) => (current ? { ...current, state } : current));

  /**
   * The token for a YouTube call, or null after showing why there is none. Call it before
   * the first await of a click handler, or the browser blocks Google's window.
   */
  const connect = async (): Promise<string | null> => {
    try {
      return getYouTubeAccessToken() ?? (await connectYouTube());
    } catch (err) {
      show({ phase: 'choose', error: describeYouTubeConnectError(err) });
      return null;
    }
  };

  const showProposals = (
    proposals: MatchProposal[],
    note: string | null,
    source: 'youtube' | 'list'
  ) => {
    reviewCheckedAtRef.current = source === 'youtube' ? Date.now() : null;
    show({ phase: 'review', proposals, note });
  };

  /**
   * The 30-day check of saved matches, run while a YouTube token is at hand. A check
   * YouTube refuses changes nothing, and the call that follows reports the reason.
   */
  const refreshSavedMatches = async (api: YouTubeLookupApi) => {
    const now = Date.now();
    const outcome = await refreshMatches({ api, tracks, now });
    const { clearedCount } = applyMatchRefresh(tracks, outcome, now);
    setTracks((prev) => applyMatchRefresh(prev, outcome, now).tracks);
    if (clearedCount > 0) onMatchesCleared(clearedCount);
  };

  return {
    /** Null while the window is closed. */
    state: open?.state ?? null,
    /** How many songs the window was opened for, or null when it covers the library. */
    selectedCount: scopeIds ? scopeIds.size : null,
    unmatchedCount: unmatched.length,
    searchableCount: searchable.length,

    /** Opens the window for the given songs, or for the whole library without any. */
    openFor(trackIds: readonly string[]) {
      setMemory(loadSearchMemory());
      setOpen({
        state: { phase: 'choose', error: null },
        scopeIds: trackIds.length > 0 ? new Set(trackIds) : null,
      });
    },

    close() {
      abortRef.current?.abort();
      abortRef.current = null;
      setOpen(null);
    },

    back() {
      show({ phase: 'choose', error: null });
    },

    stop() {
      abortRef.current?.abort();
    },

    forgetSearched() {
      clearSearchMemory();
      setMemory({});
    },

    async search(songCount: number) {
      const run = orderForSearch(searchable, playlists).slice(0, songCount);
      if (run.length === 0) return;
      const label = 'Searching YouTube for your songs.';
      show({ phase: 'working', label, progress: null, canStop: false });

      const accessToken = await connect();
      if (!accessToken) return;

      const api = createYouTubeApi(accessToken);
      await refreshSavedMatches(api);

      const controller = new AbortController();
      abortRef.current = controller;
      show({
        phase: 'working',
        label,
        progress: { done: 0, total: run.length, found: 0 },
        canStop: true,
      });
      const outcome = await searchForMatches({
        api,
        tracks: run,
        signal: controller.signal,
        onProgress: (progress) =>
          setOpen((current) =>
            current && current.state.phase === 'working'
              ? { ...current, state: { ...current.state, progress } }
              : current
          ),
      });
      abortRef.current = null;

      if (outcome.stopped?.failure === 'auth') clearYouTubeAccessToken();
      if (outcome.searchedIds.length > 0) setMemory(rememberSearched(outcome.searchedIds));

      if (outcome.stopped && outcome.searchedIds.length === 0) {
        show({ phase: 'choose', error: outcome.stopped.message });
        return;
      }
      showProposals(outcome.proposals, outcome.stopped?.message ?? null, 'youtube');
    },

    async readPlaylist(link: string) {
      const playlistId = playlistIdForLookup(link);
      if (!playlistId) {
        show({
          phase: 'choose',
          error: 'That is not a YouTube playlist link. Paste a link that has "list=" in it.',
        });
        return;
      }
      show({
        phase: 'working',
        label: 'Reading the playlist from YouTube.',
        progress: null,
        canStop: false,
      });

      const accessToken = await connect();
      if (!accessToken) return;

      const api = createYouTubeApi(accessToken);
      await refreshSavedMatches(api);

      try {
        const videos = await api.listPlaylistVideos(playlistId);
        showProposals(planBulkMatch({ tracks: unmatched, candidates: videos }), null, 'youtube');
      } catch (err) {
        const failure = lookupFailureOf(err);
        if (failure === 'auth') clearYouTubeAccessToken();
        show({ phase: 'choose', error: describeLookupFailure(failure, 'playlist') });
      }
    },

    readList(text: string, fileName: string) {
      let candidates: MatchCandidate[];
      try {
        candidates = candidatesFromSeeds(parseImportedText(text, fileName).tracks);
      } catch {
        candidates = [];
      }
      if (candidates.length === 0) {
        show({
          phase: 'choose',
          error: 'No line of that list has a YouTube link next to a title.',
        });
        return;
      }
      showProposals(planBulkMatch({ tracks: unmatched, candidates }), null, 'list');
    },

    apply(proposals: MatchProposal[]) {
      // setTracks stamps each changed song, so the next Drive sync carries the match.
      const checkedAt = reviewCheckedAtRef.current ?? undefined;
      setTracks((prev) => applyMatches(prev, proposals, checkedAt).tracks);
      show({ phase: 'done', appliedCount: applyMatches(tracks, proposals).appliedCount });
    },
  };
}
