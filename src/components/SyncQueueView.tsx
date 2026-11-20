import { CheckCircle2, ExternalLink, FolderSync, History, RefreshCw } from 'lucide-react';
import type { LocalTrack, Playlist, PlaylistDiff, SyncEvent } from '../types/music';
import { buildInstantQueueBatches, formatRelativeTime } from '../utils/youtubeLinks';

interface SyncQueueViewProps {
  playlists: Playlist[];
  trackMap: Map<string, LocalTrack>;
  diffMap: Map<string, PlaylistDiff>;
  syncHistory: SyncEvent[];
  isScanning: boolean;
  hasLiveFolderHandle: boolean;
  onRescanFolder: () => void;
  onRequestApplySync: (playlistId: string) => void;
  onOpenPlaylist: (playlistId: string) => void;
  onOpenCreatePlaylist: () => void;
}

export function SyncQueueView({
  playlists,
  trackMap,
  diffMap,
  syncHistory,
  isScanning,
  hasLiveFolderHandle,
  onRescanFolder,
  onRequestApplySync,
  onOpenPlaylist,
  onOpenCreatePlaylist,
}: SyncQueueViewProps) {
  const pendingPlaylists = playlists.filter((pl) => diffMap.get(pl.id)?.hasChanges);

  return (
    <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-white/[0.08]">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
              Sync Queue &amp; Library Diffs
            </h1>
            <p className="mt-1 text-sm text-[#8B92A2]">
              Review local folder additions and removals before updating playlist snapshots and
              launching your updated YouTube Music queue.
            </p>
          </div>
          {hasLiveFolderHandle && (
            <button
              type="button"
              onClick={onRescanFolder}
              disabled={isScanning}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium text-[#E5E7EB] bg-[#161920] border border-white/[0.1] hover:bg-[#1F232D] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'Scanning...' : 'Check Folder Now'}</span>
            </button>
          )}
        </div>

        {/* Pending Diffs Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Pending Playlist Changes</h2>
            <span className="font-mono text-xs tabular-nums text-[#717786]">
              {pendingPlaylists.length} playlist{pendingPlaylists.length === 1 ? '' : 's'} with
              changes
            </span>
          </div>

          {playlists.length === 0 ? (
            <div className="rounded-lg border border-white/[0.08] bg-[#12141A] p-8 text-center">
              <FolderSync className="h-6 w-6 text-[#6B7280] mx-auto" />
              <p className="mt-3 text-sm text-[#A1A7B5]">
                No playlists configured for folder sync yet.
              </p>
              <button
                type="button"
                onClick={onOpenCreatePlaylist}
                className="mt-4 px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors"
              >
                Create First Playlist
              </button>
            </div>
          ) : pendingPlaylists.length === 0 ? (
            <div className="rounded-lg border border-white/[0.08] bg-[#12141A] p-7 flex items-center gap-4">
              <CheckCircle2 className="h-5 w-5 text-[#22C55E] shrink-0" />
              <div>
                <div className="text-sm font-medium text-white">All playlists are up to date</div>
                <div className="mt-0.5 text-xs text-[#8B92A2]">
                  Every playlist matches its latest device storage scan snapshot. Drop new audio
                  files into your mounted folder to queue changes automatically.
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingPlaylists.map((playlist) => {
                const diff = diffMap.get(playlist.id)!;
                const combinedIds = Array.from(
                  new Set([
                    ...playlist.trackIds.filter(
                      (id) => !diff.toRemove.some((rem) => rem.id === id)
                    ),
                    ...diff.toAdd.map((t) => t.id),
                  ])
                );
                const matchedYoutubeIds = combinedIds
                  .map((id) => trackMap.get(id)?.youtubeVideoId)
                  .filter((yt): yt is string => Boolean(yt));
                const batches = buildInstantQueueBatches(matchedYoutubeIds);

                return (
                  <div
                    key={playlist.id}
                    className="rounded-lg border border-white/[0.09] bg-[#12141A] overflow-hidden"
                  >
                    <div className="px-5 py-4 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <button
                          type="button"
                          onClick={() => onOpenPlaylist(playlist.id)}
                          className="font-display text-base font-semibold text-white hover:text-[#FF4D64] transition-colors text-left"
                        >
                          {playlist.name}
                        </button>
                        <div className="mt-1 font-mono text-xs tabular-nums text-[#8B92A2]">
                          <span className="text-[#22C55E]">+{diff.toAdd.length} add</span>
                          <span className="mx-2 text-[#4B5563]" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-[#EF4444]">-{diff.toRemove.length} remove</span>
                          <span className="mx-2 text-[#4B5563]" aria-hidden="true">
                            ·
                          </span>
                          <span>Last synced {formatRelativeTime(playlist.lastSyncedAt)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5">
                        {batches.length > 0 && (
                          <a
                            href={batches[0].url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-[#E5E7EB] bg-[#1C2029] hover:bg-[#252A36] transition-colors whitespace-nowrap"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            <span>Open Queue ({batches[0].count})</span>
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => onRequestApplySync(playlist.id)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          <span>Apply Sync</span>
                        </button>
                      </div>
                    </div>

                    {/* Exact Diff Lines */}
                    <div className="divide-y divide-white/[0.05] max-h-60 overflow-y-auto text-xs">
                      {diff.toAdd.map((track) => (
                        <div
                          key={`add-${track.id}`}
                          className="px-5 py-2.5 flex items-center justify-between gap-4"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="font-mono text-[#22C55E] w-10 shrink-0">ADD</span>
                            <span className="text-white truncate">{track.title}</span>
                            <span className="text-[#717786] truncate hidden sm:inline">
                              {track.artist}
                            </span>
                          </div>
                          <span className="font-mono text-[#6B7280] shrink-0">
                            {track.youtubeVideoId ? track.youtubeVideoId : 'Unmatched'}
                          </span>
                        </div>
                      ))}
                      {diff.toRemove.map((track) => (
                        <div
                          key={`rem-${track.id}`}
                          className="px-5 py-2.5 flex items-center justify-between gap-4"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="font-mono text-[#EF4444] w-10 shrink-0">REM</span>
                            <span className="text-[#9CA3AF] line-through truncate">
                              {track.title}
                            </span>
                            <span className="text-[#6B7280] truncate hidden sm:inline">
                              {track.artist}
                            </span>
                          </div>
                          <span className="text-[#717786] shrink-0">
                            {track.isMissingOnDevice ? 'Deleted on device' : 'Removed'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Sync History Log */}
        <section className="space-y-4 pt-4 border-t border-white/[0.07]">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-[#717786]" />
            <h2 className="text-sm font-semibold text-white">Sync History</h2>
          </div>

          {syncHistory.length === 0 ? (
            <p className="text-xs text-[#6B7280]">
              No sync snapshots recorded yet. Apply a playlist sync above to create your first
              checkpoint.
            </p>
          ) : (
            <div className="rounded-lg border border-white/[0.08] overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-[#0F1116] border-b border-white/[0.07] text-[#717786]">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">Playlist</th>
                    <th className="py-2.5 px-4 font-medium">Changes Applied</th>
                    <th className="py-2.5 px-4 font-medium text-right">Matched / Total</th>
                    <th className="py-2.5 px-4 font-medium text-right">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05] bg-[#12141A]">
                  {syncHistory.map((evt) => (
                    <tr key={evt.id}>
                      <td className="py-3 px-4 font-medium text-white">{evt.playlistName}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-[#A1A7B5]">
                        +{evt.addedCount} added · -{evt.removedCount} removed
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right text-[#D1D5DB]">
                        {evt.matchedCount} / {evt.totalTracks}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right text-[#717786]">
                        {formatRelativeTime(evt.timestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
