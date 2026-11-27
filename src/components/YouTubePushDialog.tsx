import { useEffect } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { PRIVACY_URL, TERMS_URL, YOUTUBE_TERMS_URL } from '../utils/legalLinks';
import { buildYouTubeMusicPlaylistUrl } from '../utils/youtubeLinks';
import {
  describeYouTubePush,
  YOUTUBE_DAILY_QUOTA_UNITS,
  YOUTUBE_WRITE_COST_UNITS,
  type YouTubePushEstimate,
  type YouTubePushOutcome,
  type YouTubePushProgress,
} from '../utils/youtubePush';

export type YouTubePushDialogState =
  /** Showing what the push will do. connectError is the last failed try to connect. */
  | { phase: 'review'; connectError: string | null }
  /** progress is null while Google's window is open. */
  | { phase: 'working'; progress: YouTubePushProgress | null }
  | { phase: 'done'; outcome: YouTubePushOutcome };

interface YouTubePushDialogProps {
  playlistName: string;
  estimate: YouTubePushEstimate;
  state: YouTubePushDialogState;
  /** True when a fresh YouTube connection exists, so starting opens no Google window. */
  isConnected: boolean;
  onStart: () => void;
  onStop: () => void;
  onClose: () => void;
}

const LINK = 'underline underline-offset-2 hover:text-white transition-colors';

function songs(n: number): string {
  return `${n} song${n === 1 ? '' : 's'}`;
}

function progressLabel(progress: YouTubePushProgress | null): string {
  if (!progress) return 'Waiting for Google. Finish in the Google window.';
  switch (progress.step) {
    case 'reading':
      return 'Reading the YouTube playlist.';
    case 'creating':
      return 'Creating the playlist on YouTube.';
    case 'adding':
      return `Added ${progress.done} of ${songs(progress.total)}.`;
    case 'removing':
      return `Removed ${progress.done} of ${songs(progress.total)}.`;
    case 'ordering':
      return `Moved ${progress.done} of ${songs(progress.total)} into playlist order.`;
    default: {
      const _exhaustive: never = progress;
      return _exhaustive;
    }
  }
}

function progressFraction(progress: YouTubePushProgress | null): number | null {
  if (!progress || progress.step === 'reading' || progress.step === 'creating') return null;
  return progress.total > 0 ? progress.done / progress.total : null;
}

export function YouTubePushDialog({
  playlistName,
  estimate,
  state,
  isConnected,
  onStart,
  onStop,
  onClose,
}: YouTubePushDialogProps) {
  const isWorking = state.phase === 'working';

  useEffect(() => {
    if (isWorking) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isWorking, onClose]);

  const changesPerDay = YOUTUBE_DAILY_QUOTA_UNITS / YOUTUBE_WRITE_COST_UNITS;
  const changeCount = Math.ceil(estimate.quotaUnits / YOUTUBE_WRITE_COST_UNITS);
  const nothingToPush = estimate.matchedCount === 0 && estimate.removeCount === 0;
  const fraction = state.phase === 'working' ? progressFraction(state.progress) : null;
  const order = state.phase === 'done' ? state.outcome.order : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="youtube-push-title"
    >
      <div className="w-full max-w-md rounded-lg bg-[#14171D] border border-white/[0.1] overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3">
          <h2
            id="youtube-push-title"
            className="font-display text-base font-semibold text-white truncate"
          >
            Push &quot;{playlistName}&quot; to YouTube
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

        {state.phase === 'review' && (
          <div className="p-6 space-y-4 text-sm text-[#B8BECB] leading-relaxed">
            <p>
              {estimate.linkedPlaylistId
                ? 'The songs go to the YouTube playlist this one is linked to.'
                : `CrateSync creates a private playlist named "${playlistName}" on your YouTube account. It appears in YouTube Music too.`}
            </p>

            <dl className="rounded-md border border-white/[0.08] bg-[#0D0F13] divide-y divide-white/[0.06] text-xs">
              <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                <dt className="text-[#8B92A2]">To send</dt>
                <dd className="font-mono tabular-nums text-white">
                  {estimate.linkedPlaylistId && !estimate.knowsWhatIsThere
                    ? `up to ${songs(estimate.sendCount)}`
                    : songs(estimate.sendCount)}
                </dd>
              </div>
              {estimate.removeCount > 0 && (
                <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                  <dt className="text-[#8B92A2]">To remove, gone from this playlist</dt>
                  <dd className="font-mono tabular-nums text-white">
                    {songs(estimate.removeCount)}
                  </dd>
                </div>
              )}
              {estimate.moveCount > 0 && (
                <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                  <dt className="text-[#8B92A2]">To move, changed place in this playlist</dt>
                  <dd className="font-mono tabular-nums text-white">
                    {songs(estimate.moveCount)}
                  </dd>
                </div>
              )}
              {estimate.unmatchedCount > 0 && (
                <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                  <dt className="text-[#8B92A2]">Staying behind, no YouTube match</dt>
                  <dd className="font-mono tabular-nums text-[#FDE68A]">
                    {songs(estimate.unmatchedCount)}
                  </dd>
                </div>
              )}
            </dl>

            {estimate.linkedPlaylistId && !estimate.knowsWhatIsThere && (
              <p className="text-xs text-[#8B92A2]">
                CrateSync reads the YouTube playlist first and skips the songs it already has.
              </p>
            )}
            <p className="text-xs text-[#8B92A2]">
              The songs go in this playlist&apos;s order, and a song that is out of place on
              YouTube is moved. CrateSync takes a song off YouTube only when an earlier push put
              it there. Songs you added on YouTube yourself stay and are never moved.
            </p>
            <p className="text-xs text-[#8B92A2]">
              A push uses YouTube API Services. By pushing you agree to the{' '}
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
              says what CrateSync keeps.
            </p>
            {estimate.days > 1 && (
              <p className="text-xs text-[#FDE68A]">
                YouTube lets CrateSync make about {changesPerDay} changes a day. This push needs{' '}
                {changeCount}, so it takes {estimate.days} days. Push again each day and CrateSync
                carries on from where it stopped.
              </p>
            )}
            {nothingToPush && (
              <p className="text-xs text-[#FDE68A]">
                No song in this playlist has a YouTube match yet. Match a song first.
              </p>
            )}
            {state.connectError && (
              <p role="alert" className="text-xs text-[#FCA5A5]">
                {state.connectError}
              </p>
            )}
          </div>
        )}

        {state.phase === 'working' && (
          <div className="p-6 space-y-4">
            <p role="status" className="text-sm text-[#B8BECB]">
              {progressLabel(state.progress)}
            </p>
            <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden" aria-hidden="true">
              <div
                className="h-full bg-[#FF1F3D] transition-[width] duration-200"
                style={{ width: `${Math.round((fraction ?? 0) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {state.phase === 'done' && (
          <div className="p-6 space-y-3 text-sm text-[#B8BECB] leading-relaxed">
            <p className="text-white">{describeYouTubePush(state.outcome)}</p>
            {state.outcome.stopped && (
              <p role="alert" className="text-xs text-[#FDE68A]">
                {state.outcome.stopped.message}
              </p>
            )}
            {order?.state === 'sorted-by-youtube' && (
              <p className="text-xs text-[#FDE68A]">
                YouTube sorts this playlist by its own rule, so CrateSync left the order alone.
                To have it follow this playlist, set the playlist&apos;s order to Manual on
                YouTube and push again.
              </p>
            )}
            {order?.state === 'out-of-order' && !state.outcome.stopped && (
              <p className="text-xs text-[#FDE68A]">
                The YouTube playlist changed while CrateSync was working, so the order is not
                finished. Push again to finish it.
              </p>
            )}
            {state.outcome.leftAlone > 0 && (
              <p className="text-xs text-[#8B92A2]">
                {songs(state.outcome.leftAlone)} on the YouTube playlist{' '}
                {state.outcome.leftAlone === 1 ? 'is' : 'are'} not in this playlist. CrateSync
                did not add {state.outcome.leftAlone === 1 ? 'it' : 'them'}, so{' '}
                {state.outcome.leftAlone === 1 ? 'it stays' : 'they stay'}.
              </p>
            )}
            {state.outcome.playlist && (
              <>
                <a
                  href={buildYouTubeMusicPlaylistUrl(state.outcome.playlist.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#FF4D64] hover:text-white transition-colors"
                >
                  <span>Open the playlist in YouTube Music</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                {/* A browser signed in to several Google accounts opens the link with its
                    first one, and YouTube hides a private playlist from every other account. */}
                <p className="text-xs text-[#8B92A2]">
                  The playlist is private. If YouTube says it does not exist, switch YouTube
                  to the Google account you connected here.
                </p>
              </>
            )}
          </div>
        )}

        <div className="px-6 py-4 bg-[#101217] border-t border-white/[0.07] flex items-center justify-end gap-2.5">
          {state.phase === 'review' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-md text-xs font-medium text-[#D1D5DB] hover:text-white hover:bg-white/[0.06] transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onStart}
                disabled={nothingToPush}
                className="px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-40 disabled:hover:bg-[#FF1F3D] transition-colors whitespace-nowrap"
              >
                {isConnected ? 'Push to YouTube' : 'Connect YouTube and push'}
              </button>
            </>
          )}
          {state.phase === 'working' && (
            <button
              type="button"
              onClick={onStop}
              disabled={state.progress === null}
              className="px-4 py-2 rounded-md text-xs font-medium text-[#D1D5DB] border border-white/[0.11] hover:text-white hover:bg-white/[0.06] disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              Stop
            </button>
          )}
          {state.phase === 'done' && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
