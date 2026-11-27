import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { LocalTrack } from '../types/music';
import { YOUTUBE_SEARCH_COST_UNITS, type MatchProposal } from '../utils/bulkMatch';
import { PRIVACY_URL, TERMS_URL, YOUTUBE_TERMS_URL } from '../utils/legalLinks';
import { buildYouTubeMusicWatchUrl } from '../utils/youtubeLinks';
import { YOUTUBE_DAILY_QUOTA_UNITS } from '../utils/youtubePush';

export type BulkMatchDialogState =
  /** Picking where the videos come from. error is why the last try gave nothing. */
  | { phase: 'choose'; error: string | null }
  /** progress is null while Google's window is open or a playlist is being read. */
  | {
      phase: 'working';
      label: string;
      progress: { done: number; total: number; found: number } | null;
      canStop: boolean;
    }
  /** note is why a search ended before its last song. */
  | { phase: 'review'; proposals: MatchProposal[]; note: string | null }
  | { phase: 'done'; appliedCount: number };

interface BulkMatchDialogProps {
  /** The library, to name the song of each proposal. */
  tracks: readonly LocalTrack[];
  /** How many songs the window was opened for, or null when it covers the whole library. */
  selectedCount: number | null;
  /** Songs with no YouTube video that the user has not set aside. */
  unmatchedCount: number;
  /** The same songs minus the ones YouTube was searched for in the last 30 days. */
  searchableCount: number;
  state: BulkMatchDialogState;
  /** True when a fresh YouTube connection exists, so starting opens no Google window. */
  isConnected: boolean;
  onSearch: (songCount: number) => void;
  onReadPlaylist: (link: string) => void;
  onReadList: (text: string, fileName: string) => void;
  onForgetSearched: () => void;
  onStop: () => void;
  onApply: (proposals: MatchProposal[]) => void;
  /** From the review or the last screen back to picking a source. */
  onBack: () => void;
  onClose: () => void;
}

type Source = 'search' | 'playlist' | 'list';

const SEARCHES_PER_DAY = YOUTUBE_DAILY_QUOTA_UNITS / YOUTUBE_SEARCH_COST_UNITS;
const DEFAULT_SEARCH_COUNT = 25;

const LINK = 'underline underline-offset-2 hover:text-white transition-colors';
const PRIMARY =
  'px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-40 transition-colors';
const SECONDARY =
  'px-4 py-2 rounded-md text-xs font-medium text-[#D1D5DB] border border-white/[0.11] hover:text-white hover:bg-white/[0.06] disabled:opacity-40 transition-colors';
const FIELD =
  'w-full rounded-md bg-[#0D0F13] border border-white/[0.1] px-3 py-2 text-sm text-white placeholder:text-[#5E6676] focus:outline-none focus:border-[#FF1F3D]/60';
const LIST_FIELD =
  'w-full rounded-md bg-[#0D0F13] border border-white/[0.1] px-3 py-2 text-xs font-mono text-white placeholder:text-[#5E6676] focus:outline-none focus:border-[#FF1F3D]/60';
const COUNT_FIELD =
  'w-24 rounded-md bg-[#0D0F13] border border-white/[0.1] px-3 py-2 text-sm font-mono tabular-nums text-white focus:outline-none focus:border-[#FF1F3D]/60';
const TAB_ON = 'text-white bg-[#1E222D] border-[#FF1F3D]/60';
const TAB_OFF = 'text-[#D1D5DB] bg-[#161920] border-white/[0.09] hover:text-white hover:bg-[#1E222B]';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function ChooseBody({
  selectedCount,
  unmatchedCount,
  searchableCount,
  error,
  isConnected,
  onSearch,
  onReadPlaylist,
  onReadList,
  onForgetSearched,
  onClose,
}: Pick<
  BulkMatchDialogProps,
  | 'selectedCount'
  | 'unmatchedCount'
  | 'searchableCount'
  | 'isConnected'
  | 'onSearch'
  | 'onReadPlaylist'
  | 'onReadList'
  | 'onForgetSearched'
  | 'onClose'
> & { error: string | null }) {
  const [source, setSource] = useState<Source>('search');
  const searchLimit = Math.min(SEARCHES_PER_DAY, searchableCount);
  const [songCount, setSongCount] = useState(String(Math.min(DEFAULT_SEARCH_COUNT, searchLimit)));
  const [link, setLink] = useState('');
  const [listText, setListText] = useState('');

  const parsedCount = Number.parseInt(songCount, 10);
  const searchCount = Number.isInteger(parsedCount)
    ? Math.max(0, Math.min(parsedCount, searchLimit))
    : 0;
  const skippedCount = unmatchedCount - searchableCount;
  const connect = isConnected ? '' : 'Connect YouTube and ';

  const tabs: Array<{ id: Source; label: string }> = [
    { id: 'search', label: 'Search YouTube' },
    { id: 'playlist', label: 'A YouTube playlist' },
    { id: 'list', label: 'A list of links' },
  ];

  return (
    <>
      <div className="p-6 space-y-4 text-sm text-[#B8BECB] leading-relaxed">
        <p>
          {selectedCount === null
            ? plural(unmatchedCount, 'song has', 'songs have')
            : `${unmatchedCount} of the ${plural(selectedCount, 'selected song', 'selected songs')} ${
                unmatchedCount === 1 ? 'has' : 'have'
              }`}{' '}
          no YouTube video yet. A song needs one
          before a push can put it on a YouTube playlist. Pick where the videos come from, then
          review every match before it is saved.
        </p>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Where the videos come from">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={source === tab.id}
              onClick={() => setSource(tab.id)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                source === tab.id ? TAB_ON : TAB_OFF
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {source === 'search' && (
          <div className="space-y-3">
            <p className="text-xs text-[#8B92A2]">
              CrateSync searches YouTube for each song&apos;s artist and title and proposes the
              video that fits. One search costs {YOUTUBE_SEARCH_COST_UNITS} of the{' '}
              {YOUTUBE_DAILY_QUOTA_UNITS.toLocaleString('en-US')} units YouTube gives CrateSync a
              day. That is {SEARCHES_PER_DAY} songs a day at most, and a push draws on the same
              allowance. Songs in a playlist go first.
            </p>
            <label className="flex items-center gap-3 text-xs text-[#D1D5DB]">
              <span>Songs to search now</span>
              <input
                type="number"
                min={1}
                max={searchLimit}
                value={songCount}
                onChange={(event) => setSongCount(event.target.value)}
                className={COUNT_FIELD}
              />
              <span className="text-[#8B92A2]">
                {(searchCount * YOUTUBE_SEARCH_COST_UNITS).toLocaleString('en-US')} units
              </span>
            </label>
            {skippedCount > 0 && (
              <p className="text-xs text-[#8B92A2]">
                {plural(skippedCount, 'song was', 'songs were')} searched in the last 30 days and{' '}
                {skippedCount === 1 ? 'is' : 'are'} left out, since YouTube would give the same
                answer.{' '}
                <button type="button" onClick={onForgetSearched} className={LINK}>
                  {skippedCount === 1 ? 'Search it again' : 'Search them again'}
                </button>
              </p>
            )}
          </div>
        )}

        {source === 'playlist' && (
          <div className="space-y-3">
            <p className="text-xs text-[#8B92A2]">
              CrateSync reads the playlist and matches its videos to your songs by artist and
              title. Reading costs 1 unit for every 50 videos. Your liked songs are the playlist
              at music.youtube.com/playlist?list=LM.
            </p>
            <input
              type="text"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://music.youtube.com/playlist?list=..."
              aria-label="YouTube playlist link"
              className={FIELD}
            />
          </div>
        )}

        {source === 'list' && (
          <div className="space-y-3">
            <p className="text-xs text-[#8B92A2]">
              Paste one song a line with its link, such as &quot;Owl City - Fireflies
              https://music.youtube.com/watch?v=...&quot;, or pick a CSV, M3U or JSON file that
              holds titles and links. This uses none of YouTube&apos;s allowance and needs no
              connection.
            </p>
            <textarea
              value={listText}
              onChange={(event) => setListText(event.target.value)}
              rows={5}
              placeholder="Artist - Title https://music.youtube.com/watch?v=..."
              aria-label="Songs with their YouTube links"
              className={LIST_FIELD}
            />
            <label className="block text-xs text-[#D1D5DB]">
              <span className="sr-only">A file with titles and links</span>
              <input
                type="file"
                accept=".csv,.m3u,.m3u8,.json,.txt"
                onChange={(event) => {
                  const picked = event.target.files?.[0];
                  if (!picked) return;
                  void picked.text().then((content) => onReadList(content, picked.name));
                }}
                className="block w-full text-xs text-[#8B92A2] file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border file:border-white/[0.11] file:bg-transparent file:text-xs file:font-medium file:text-[#D1D5DB]"
              />
            </label>
          </div>
        )}

        {source !== 'list' && (
          <p className="text-xs text-[#8B92A2]">
            This uses YouTube API Services. By going on you agree to the{' '}
            <a href={YOUTUBE_TERMS_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
              YouTube Terms of Service
            </a>{' '}
            and to CrateSync&apos;s{' '}
            <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
              terms
            </a>
            . The{' '}
            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
              privacy policy
            </a>{' '}
            says what CrateSync keeps. Of what YouTube returns, CrateSync keeps the id of each
            video you apply and nothing else.
          </p>
        )}

        {error && (
          <p role="alert" className="text-xs text-[#FCA5A5]">
            {error}
          </p>
        )}
      </div>

      <div className="px-6 py-4 border-t border-white/[0.08] flex justify-end gap-2">
        <button type="button" onClick={onClose} className={SECONDARY}>
          Cancel
        </button>
        {source === 'search' && (
          <button
            type="button"
            disabled={searchCount === 0}
            onClick={() => onSearch(searchCount)}
            className={PRIMARY}
          >
            {connect ? `${connect}search` : 'Search'} {plural(searchCount, 'song', 'songs')}
          </button>
        )}
        {source === 'playlist' && (
          <button
            type="button"
            disabled={link.trim().length === 0}
            onClick={() => onReadPlaylist(link)}
            className={PRIMARY}
          >
            {connect ? `${connect}read the playlist` : 'Read the playlist'}
          </button>
        )}
        {source === 'list' && (
          <button
            type="button"
            disabled={listText.trim().length === 0}
            onClick={() => onReadList(listText, 'pasted.txt')}
            className={PRIMARY}
          >
            Match the list
          </button>
        )}
      </div>
    </>
  );
}

function ReviewBody({
  tracks,
  proposals,
  note,
  onApply,
  onBack,
}: Pick<BulkMatchDialogProps, 'tracks' | 'onApply' | 'onBack'> & {
  proposals: MatchProposal[];
  note: string | null;
}) {
  const trackById = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(proposals.filter((p) => p.confidence === 'exact').map((p) => p.trackId))
  );

  const likelyUnticked = proposals.filter(
    (p) => p.confidence === 'likely' && !ticked.has(p.trackId)
  ).length;
  const toggle = (trackId: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });

  return (
    <>
      <div className="p-6 space-y-4 text-sm text-[#B8BECB] leading-relaxed">
        {note && <p className="text-xs text-[#FDE68A]">{note}</p>}

        {proposals.length === 0 ? (
          <p>
            No song matched. A match needs the same title and the artist&apos;s name in the
            video&apos;s title or channel.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <p>
                {plural(proposals.length, 'match', 'matches')} found. Open a link to hear the
                video before you keep it.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setTicked(new Set(proposals.map((p) => p.trackId)))}
                  className={LINK}
                >
                  Tick all
                </button>
                <button type="button" onClick={() => setTicked(new Set())} className={LINK}>
                  Clear
                </button>
              </div>
            </div>

            <ul className="max-h-[45vh] overflow-y-auto rounded-md border border-white/[0.08] bg-[#0D0F13] divide-y divide-white/[0.06]">
              {proposals.map((proposal) => {
                const track = trackById.get(proposal.trackId);
                if (!track) return null;
                const isExact = proposal.confidence === 'exact';
                return (
                  <li key={proposal.trackId} className="flex items-start gap-3 px-3 py-2.5 text-xs">
                    <input
                      type="checkbox"
                      checked={ticked.has(proposal.trackId)}
                      onChange={() => toggle(proposal.trackId)}
                      aria-label={`Keep the match for ${track.title}`}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#FF1F3D]"
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-white truncate">
                        {track.artist} - {track.title}
                      </p>
                      <a
                        href={buildYouTubeMusicWatchUrl(proposal.candidate.videoId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-center gap-1 text-[#8B92A2] hover:text-white transition-colors"
                      >
                        <span className="truncate">
                          {proposal.candidate.title}
                          {proposal.candidate.channel ? `, ${proposal.candidate.channel}` : ''}
                        </span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </div>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium border ${
                        isExact
                          ? 'text-[#86EFAC] border-[#86EFAC]/30'
                          : 'text-[#FDE68A] border-[#FDE68A]/30'
                      }`}
                    >
                      {isExact ? 'Exact' : 'Likely'}
                    </span>
                  </li>
                );
              })}
            </ul>

            {likelyUnticked > 0 && (
              <p className="text-xs text-[#8B92A2]">
                {plural(likelyUnticked, 'likely match is', 'likely matches are')} not ticked. The
                title is close or the artist could not be checked, so open the link first.
              </p>
            )}
          </>
        )}
      </div>

      <div className="px-6 py-4 border-t border-white/[0.08] flex justify-end gap-2">
        <button type="button" onClick={onBack} className={SECONDARY}>
          Back
        </button>
        {proposals.length > 0 && (
          <button
            type="button"
            disabled={ticked.size === 0}
            onClick={() => onApply(proposals.filter((p) => ticked.has(p.trackId)))}
            className={PRIMARY}
          >
            Apply {plural(ticked.size, 'match', 'matches')}
          </button>
        )}
      </div>
    </>
  );
}

export function BulkMatchDialog({
  tracks,
  selectedCount,
  unmatchedCount,
  searchableCount,
  state,
  isConnected,
  onSearch,
  onReadPlaylist,
  onReadList,
  onForgetSearched,
  onStop,
  onApply,
  onBack,
  onClose,
}: BulkMatchDialogProps) {
  const isWorking = state.phase === 'working';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isWorking) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isWorking, onClose]);

  const body = (() => {
    switch (state.phase) {
      case 'choose':
        return (
          <ChooseBody
            // A change in what can be searched resets the count field to its new limit.
            key={searchableCount}
            selectedCount={selectedCount}
            unmatchedCount={unmatchedCount}
            searchableCount={searchableCount}
            error={state.error}
            isConnected={isConnected}
            onSearch={onSearch}
            onReadPlaylist={onReadPlaylist}
            onReadList={onReadList}
            onForgetSearched={onForgetSearched}
            onClose={onClose}
          />
        );
      case 'working': {
        const { progress } = state;
        const fraction = progress && progress.total > 0 ? progress.done / progress.total : null;
        return (
          <>
            <div className="p-6 space-y-4 text-sm text-[#B8BECB] leading-relaxed" aria-live="polite">
              <p>{state.label}</p>
              {progress ? (
                <>
                  <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                    <div
                      className="h-full bg-[#FF1F3D] transition-[width]"
                      style={{ width: `${Math.round((fraction ?? 0) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs font-mono tabular-nums text-[#8B92A2]">
                    {progress.done} of {plural(progress.total, 'song', 'songs')}, {progress.found}{' '}
                    found
                  </p>
                </>
              ) : (
                <p className="text-xs text-[#8B92A2]">
                  If a Google window opened, finish there first.
                </p>
              )}
            </div>
            {state.canStop && (
              <div className="px-6 py-4 border-t border-white/[0.08] flex justify-end">
                <button type="button" onClick={onStop} className={SECONDARY}>
                  Stop
                </button>
              </div>
            )}
          </>
        );
      }
      case 'review':
        return (
          <ReviewBody
            tracks={tracks}
            proposals={state.proposals}
            note={state.note}
            onApply={onApply}
            onBack={onBack}
          />
        );
      case 'done':
        return (
          <>
            <div className="p-6 space-y-4 text-sm text-[#B8BECB] leading-relaxed">
              <p>
                {plural(state.appliedCount, 'song now has', 'songs now have')} a YouTube video. A
                playlist that holds {state.appliedCount === 1 ? 'it' : 'them'} can be pushed to
                YouTube.
              </p>
              <p className="text-xs text-[#8B92A2]">
                {plural(unmatchedCount, 'song is', 'songs are')} still without one.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-white/[0.08] flex justify-end gap-2">
              {unmatchedCount > 0 && (
                <button type="button" onClick={onBack} className={SECONDARY}>
                  Match more
                </button>
              )}
              <button type="button" onClick={onClose} className={PRIMARY}>
                Done
              </button>
            </div>
          </>
        );
      default: {
        const _exhaustive: never = state;
        return _exhaustive;
      }
    }
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-match-title"
    >
      <div className="w-full max-w-2xl max-h-full overflow-y-auto rounded-lg bg-[#14171D] border border-white/[0.1]">
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3">
          <h2 id="bulk-match-title" className="font-display text-base font-semibold text-white truncate">
            Match songs to YouTube
          </h2>
          {!isWorking && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {body}
      </div>
    </div>
  );
}
