import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Disc3,
  Download,
  ExternalLink,
  Link2,
  Pause,
  Play,
  RefreshCw,
  Shuffle,
  SlidersHorizontal,
  Tags,
  Trash2,
} from 'lucide-react';
import type { ShuffleMode } from '../hooks/useAudioPlayer';
import type {
  LocalTrack,
  Playlist,
  PlaylistDiff,
  SyncRule,
  TrackPlayStats,
} from '../types/music';
import { parseWatchInterval, type WatchIntervalSec } from '../utils/folderWatch';
import { getSmartShuffleSummary } from '../utils/smartShuffle';
import {
  buildInstantQueueBatches,
  buildPlaylistYouTubeMusicUrl,
  buildTrackYouTubeMusicUrl,
  exportPlaylistToCSV,
  exportPlaylistToM3U8,
  exportPlaylistToPlainText,
  extractYouTubePlaylistId,
  formatDuration,
  formatRelativeTime,
  formatTotalRuntime,
  triggerFileDownload,
} from '../utils/youtubeLinks';

const DEFAULT_COVER_SRC = '/src/assets/images/playlist_cover_default_1795114389909.jpg';

interface PlaylistViewProps {
  playlist: Playlist;
  tracks: LocalTrack[];
  diff: PlaylistDiff;
  playStats: Record<string, TrackPlayStats>;
  availableFolders: string[];
  /** The app-wide folder watch interval. Playlists do not have their own. */
  autoWatchIntervalSec: WatchIntervalSec;
  activePlayingTrackId: string | null;
  isAudioPlaying: boolean;
  shuffleMode: ShuffleMode;
  hasPlayableFile: (fileKey: string) => boolean;
  onChangeAutoWatch: (sec: WatchIntervalSec) => void;
  onUpdatePlaylist: (playlistId: string, updates: Partial<Playlist>) => void;
  onUpdateSyncRule: (playlistId: string, rule: SyncRule) => void;
  onReorderTrack: (playlistId: string, fromIdx: number, toIdx: number) => void;
  onRemoveTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  onRequestDeletePlaylist: (playlistId: string) => void;
  onApplySync: (playlistId: string) => void;
  onInspectTrack: (trackId: string) => void;
  onOpenBatchTagEditor: (trackIds: string[], contextLabel: string) => void;
  onPlayTrack: (trackId: string, queueIds: string[]) => void;
  onPlayList: (trackIds: string[], options?: { shuffle?: boolean | ShuffleMode }) => void;
  onGoToScanner: () => void;
}

export function PlaylistView({
  playlist,
  tracks,
  diff,
  playStats,
  availableFolders,
  autoWatchIntervalSec,
  activePlayingTrackId,
  isAudioPlaying,
  shuffleMode,
  hasPlayableFile,
  onChangeAutoWatch,
  onUpdatePlaylist,
  onUpdateSyncRule,
  onReorderTrack,
  onRemoveTrackFromPlaylist,
  onRequestDeletePlaylist,
  onApplySync,
  onInspectTrack,
  onOpenBatchTagEditor,
  onPlayTrack,
  onPlayList,
  onGoToScanner,
}: PlaylistViewProps) {
  const [showRules, setShowRules] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [nameDraft, setNameDraft] = useState(playlist.name);
  const [descDraft, setDescDraft] = useState(playlist.description);
  const [ytUrlDraft, setYtUrlDraft] = useState(playlist.youtubePlaylistUrl);
  const [copiedNotice, setCopiedNotice] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);

  const coverArt = useMemo(() => {
    const firstWithArt = tracks.find((t) => t.coverArtUrl);
    return firstWithArt?.coverArtUrl || DEFAULT_COVER_SRC;
  }, [tracks]);

  const totalDuration = useMemo(
    () => tracks.reduce((sum, t) => sum + (t.duration || 0), 0),
    [tracks]
  );

  const matchedVideoIds = useMemo(
    () => tracks.map((t) => t.youtubeVideoId).filter((id): id is string => Boolean(id)),
    [tracks]
  );

  const queueBatches = useMemo(() => buildInstantQueueBatches(matchedVideoIds), [matchedVideoIds]);
  const ytMusicTarget = useMemo(
    () => buildPlaylistYouTubeMusicUrl(playlist, tracks),
    [playlist, tracks]
  );
  const trackIds = useMemo(() => tracks.map((t) => t.id), [tracks]);
  const smartSummary = useMemo(() => getSmartShuffleSummary(tracks), [tracks]);
  const syncedSet = useMemo(() => new Set(playlist.syncedTrackIds), [playlist.syncedTrackIds]);
  const linkedPlaylistId = extractYouTubePlaylistId(playlist.youtubePlaylistUrl);

  const handleSaveMeta = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameDraft.trim()) return;
    onUpdatePlaylist(playlist.id, {
      name: nameDraft.trim(),
      description: descDraft.trim(),
      youtubePlaylistUrl: ytUrlDraft.trim(),
    });
    setEditingMeta(false);
  };

  const handleCopyTracklist = async () => {
    try {
      await navigator.clipboard.writeText(exportPlaylistToPlainText(tracks));
      setCopiedNotice(true);
      window.setTimeout(() => setCopiedNotice(false), 2000);
    } catch {
      // Clipboard blocked
    }
  };

  const handleDownloadCSV = () => {
    const csv = exportPlaylistToCSV(playlist, tracks);
    const safeName = playlist.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'playlist';
    triggerFileDownload({
      content: csv,
      fileName: `${safeName}-youtube-music.csv`,
      mimeType: 'text/csv;charset=utf-8',
    });
  };

  const handleDownloadM3U = () => {
    const m3u = exportPlaylistToM3U8(playlist, tracks);
    const safeName = playlist.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'playlist';
    triggerFileDownload({
      content: m3u,
      fileName: `${safeName}.m3u8`,
      mimeType: 'audio/x-mpegurl;charset=utf-8',
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Playlist Header */}
      <div className="px-5 sm:px-8 py-6 border-b border-white/[0.08] bg-[#0F1116] shrink-0">
        <div className="flex flex-col md:flex-row gap-6 md:items-end justify-between">
          <div className="flex items-start gap-5 min-w-0">
            <div className="h-24 w-24 sm:h-28 sm:w-28 rounded-lg bg-[#1A1D24] border border-white/[0.09] overflow-hidden shrink-0 flex items-center justify-center">
              {!coverFailed ? (
                <img
                  src={coverArt}
                  alt={`${playlist.name} playlist cover`}
                  referrerPolicy="no-referrer"
                  onError={() => setCoverFailed(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Disc3 className="h-8 w-8 text-[#525866]" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              {!editingMeta ? (
                <>
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white truncate">
                      {playlist.name}
                    </h1>
                    <button
                      type="button"
                      onClick={() => {
                        setNameDraft(playlist.name);
                        setDescDraft(playlist.description);
                        setYtUrlDraft(playlist.youtubePlaylistUrl);
                        setEditingMeta(true);
                      }}
                      className="text-xs text-[#8B92A2] hover:text-white transition-colors"
                    >
                      Edit details
                    </button>
                  </div>

                  {playlist.description && (
                    <p className="mt-1.5 text-sm text-[#9CA3AF] max-w-2xl">
                      {playlist.description}
                    </p>
                  )}

                  {/* Unboxed Metadata Row */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[#8B92A2] font-mono tabular-nums">
                    <span className="text-[#E5E7EB]">{tracks.length} tracks</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatTotalRuntime(totalDuration)}</span>
                    <span aria-hidden="true">·</span>
                    <span className={matchedVideoIds.length > 0 ? 'text-[#22C55E]' : ''}>
                      {matchedVideoIds.length} matched on YouTube Music
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Synced {formatRelativeTime(playlist.lastSyncedAt)}</span>
                  </div>

                  {linkedPlaylistId && (
                    <div className="mt-2">
                      <a
                        href={`https://music.youtube.com/playlist?list=${encodeURIComponent(linkedPlaylistId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-[#FF4D64] hover:text-[#FF7588] transition-colors"
                      >
                        <span>Open linked YouTube Music playlist</span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  )}
                </>
              ) : (
                <form onSubmit={handleSaveMeta} className="space-y-3 max-w-lg">
                  <input
                    type="text"
                    required
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    placeholder="Playlist name"
                    className="w-full px-3 py-1.5 rounded-md bg-[#0B0C0E] border border-white/[0.12] text-sm font-medium text-white focus:border-[#FF1F3D] focus:outline-none"
                  />
                  <input
                    type="text"
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    placeholder="Description"
                    className="w-full px-3 py-1.5 rounded-md bg-[#0B0C0E] border border-white/[0.12] text-xs text-white focus:border-[#FF1F3D] focus:outline-none"
                  />
                  <input
                    type="url"
                    value={ytUrlDraft}
                    onChange={(e) => setYtUrlDraft(e.target.value)}
                    placeholder="Linked YouTube Music playlist URL (https://music.youtube.com/playlist?list=...)"
                    className="w-full px-3 py-1.5 rounded-md bg-[#0B0C0E] border border-white/[0.12] text-xs font-mono text-white focus:border-[#FF1F3D] focus:outline-none"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingMeta(false)}
                      className="px-3 py-1.5 rounded-md text-xs font-medium text-[#9CA3AF] hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* Primary Playlist Actions */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {trackIds.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => onPlayList(trackIds, { shuffle: 'off' })}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium text-[#0B0C0E] bg-white hover:bg-[#E5E7EB] transition-colors whitespace-nowrap"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Play</span>
                </button>
                <button
                  type="button"
                  onClick={() => onPlayList(trackIds, { shuffle: 'smart' })}
                  title={`Smart Shuffle prioritizes ${smartSummary.matchedCount} YouTube-matched and ${smartSummary.priorityCount} metadata-complete tracks over unmatched files`}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
                    shuffleMode === 'smart'
                      ? 'text-white bg-[#FF1F3D]/20 border-[#FF1F3D]/55 hover:bg-[#FF1F3D]/30'
                      : 'text-[#E5E7EB] bg-[#161920] border-white/[0.11] hover:text-white hover:bg-[#1E222B]'
                  }`}
                >
                  <Shuffle className="h-3.5 w-3.5 text-[#FF4D64]" />
                  <span>Smart Shuffle</span>
                </button>
                <button
                  type="button"
                  onClick={() => onPlayList(trackIds, { shuffle: 'standard' })}
                  title="Standard equal-weight shuffle across all tracks"
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
                    shuffleMode === 'standard'
                      ? 'text-white bg-white/[0.12] border-white/[0.2]'
                      : 'text-[#D1D5DB] bg-[#161920] border-white/[0.09] hover:text-white hover:bg-[#1E222B]'
                  }`}
                >
                  <Shuffle className="h-3.5 w-3.5" />
                  <span>Shuffle</span>
                </button>
              </>
            )}

            <a
              href={ytMusicTarget.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>{ytMusicTarget.label}</span>
            </a>

            {diff.hasChanges && (
              <button
                type="button"
                onClick={() => onApplySync(playlist.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-[#FDE68A] bg-[#D97706]/20 border border-[#D97706]/40 hover:bg-[#D97706]/30 transition-colors whitespace-nowrap"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>
                  Apply Sync ({diff.toAdd.length + diff.toRemove.length})
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowRules((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
                showRules
                  ? 'bg-white/[0.1] border-white/[0.18] text-white'
                  : 'bg-[#161920] border-white/[0.09] text-[#D1D5DB] hover:text-white hover:bg-[#1E222B]'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Sync Rules</span>
            </button>
          </div>
        </div>

        {/* Multi-Batch Instant YouTube Queue Strip (if > 50 matched tracks) */}
        {queueBatches.length > 1 && (
          <div className="mt-4 pt-3 border-t border-white/[0.07] flex flex-wrap items-center gap-3 text-xs">
            <span className="text-[#8B92A2]">YouTube queue batches (max 50 per URL):</span>
            {queueBatches.map((batch) => (
              <a
                key={batch.label}
                href={batch.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[#E5E7EB] hover:text-[#FF4D64] underline underline-offset-2 whitespace-nowrap"
              >
                <span>{batch.label}</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        )}

        {/* Secondary Export / Utility Strip */}
        <div className="mt-4 pt-3 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={handleDownloadCSV}
              className="inline-flex items-center gap-1.5 text-[#A1A7B5] hover:text-white transition-colors whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV (YouTube Music transfer)</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadM3U}
              className="inline-flex items-center gap-1.5 text-[#A1A7B5] hover:text-white transition-colors whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export M3U8</span>
            </button>
            {trackIds.length > 0 && (
              <button
                type="button"
                onClick={() => onOpenBatchTagEditor(trackIds, playlist.name)}
                className="inline-flex items-center gap-1.5 text-[#A1A7B5] hover:text-white transition-colors whitespace-nowrap"
              >
                <Tags className="h-3.5 w-3.5" />
                <span>Batch Edit Tags</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleCopyTracklist}
              className="inline-flex items-center gap-1.5 text-[#A1A7B5] hover:text-white transition-colors whitespace-nowrap"
            >
              {copiedNotice ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[#22C55E]" />
                  <span className="text-[#22C55E]">Copied tracklist</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy tracklist</span>
                </>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => onRequestDeletePlaylist(playlist.id)}
            className="inline-flex items-center gap-1.5 text-[#8B92A2] hover:text-[#EF4444] transition-colors whitespace-nowrap"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete Playlist</span>
          </button>
        </div>

        {/* Collapsible Auto-Sync Rules Drawer */}
        {showRules && (
          <div className="mt-4 pt-4 border-t border-white/[0.08] grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="space-y-2">
              <label htmlFor="rule-folder-filter" className="block text-[#9CA3AF] font-medium">
                Bound Local Folder Filter
              </label>
              <select
                id="rule-folder-filter"
                value={playlist.syncRule.folderFilter}
                onChange={(e) =>
                  onUpdateSyncRule(playlist.id, {
                    ...playlist.syncRule,
                    folderFilter: e.target.value,
                  })
                }
                className="w-full px-3 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-white focus:border-[#FF1F3D] focus:outline-none"
              >
                <option value="">All scanned local folders</option>
                {availableFolders.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2.5 pt-1">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={playlist.syncRule.autoAddNewFiles}
                  onChange={(e) =>
                    onUpdateSyncRule(playlist.id, {
                      ...playlist.syncRule,
                      autoAddNewFiles: e.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded accent-[#FF1F3D]"
                />
                <span className="text-[#D1D5DB]">Auto-queue newly added folder files</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={playlist.syncRule.removeMissingFiles}
                  onChange={(e) =>
                    onUpdateSyncRule(playlist.id, {
                      ...playlist.syncRule,
                      removeMissingFiles: e.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded accent-[#FF1F3D]"
                />
                <span className="text-[#D1D5DB]">Queue removal when deleted on device</span>
              </label>
            </div>

            <div className="space-y-2">
              <label htmlFor="rule-scan-interval" className="block text-[#9CA3AF] font-medium">
                Folder watch interval
              </label>
              <select
                id="rule-scan-interval"
                value={autoWatchIntervalSec}
                onChange={(e) => onChangeAutoWatch(parseWatchInterval(e.target.value))}
                className="w-full px-3 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] font-mono text-white focus:border-[#FF1F3D] focus:outline-none"
              >
                <option value={0}>Manual scan only</option>
                <option value={30}>Every 30 seconds</option>
                <option value={120}>Every 2 minutes</option>
                <option value={300}>Every 5 minutes</option>
              </select>
              <p className="text-[#717786] leading-relaxed">
                One setting for the whole app. Every playlist follows the same watched folder.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Pending Diff Notice Banner */}
      {diff.hasChanges && (
        <div className="px-5 sm:px-8 py-2.5 bg-[#D97706]/[0.1] border-b border-[#D97706]/25 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <span className="text-[#FDE68A]">
            Pending sync changes detected:{' '}
            <span className="font-mono tabular-nums font-medium">+{diff.toAdd.length}</span> to
            add,{' '}
            <span className="font-mono tabular-nums font-medium">-{diff.toRemove.length}</span> to
            remove.
          </span>
          <button
            type="button"
            onClick={() => onApplySync(playlist.id)}
            className="font-medium text-white hover:underline underline-offset-2 whitespace-nowrap"
          >
            Sync playlist snapshot now
          </button>
        </div>
      )}

      {/* Playlist Tracklist Table */}
      <div className="flex-1 overflow-auto">
        {tracks.length === 0 ? (
          <div className="py-16 px-6 text-center max-w-md mx-auto">
            <p className="text-sm text-[#9CA3AF]">
              This playlist has no tracks yet. Add scanned songs from Device Storage or enable
              auto-add sync rules.
            </p>
            <button
              type="button"
              onClick={onGoToScanner}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors"
            >
              Browse Device Storage
            </button>
          </div>
        ) : (
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead className="sticky top-0 z-10 bg-[#0D0F13] border-b border-white/[0.08] text-[11px] font-medium text-[#717786]">
              <tr>
                <th className="py-2.5 pl-6 pr-2 w-12 text-center">#</th>
                <th className="py-2.5 px-3">Track</th>
                <th className="py-2.5 px-3 w-44">Sync State</th>
                <th className="py-2.5 px-3 w-48">YouTube Music</th>
                <th className="py-2.5 px-3 w-16 text-right">Plays</th>
                <th className="py-2.5 px-3 w-20 text-right">Time</th>
                <th className="py-2.5 pl-2 pr-6 w-28 text-right">Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] text-sm">
              {tracks.map((track, idx) => {
                const isActivePlay = activePlayingTrackId === track.id;
                const playable = hasPlayableFile(track.fileKey);
                const isSynced = syncedSet.has(track.id);
                const pStats = playStats[track.id];
                const playCount = pStats?.playCount ?? track.playCount ?? 0;
                const skipCount = pStats?.skipCount ?? track.skipCount ?? 0;
                const completedCount =
                  pStats?.completedCount ?? Math.max(0, playCount - skipCount);
                const lastPlayedAt = pStats?.lastPlayedAt ?? track.lastPlayedAt ?? null;

                return (
                  <tr key={track.id} className="group hover:bg-white/[0.03] transition-colors">
                    <td className="py-2.5 pl-6 pr-2 text-center">
                      <button
                        type="button"
                        onClick={() => onPlayTrack(track.id, trackIds)}
                        aria-label={
                          isActivePlay && isAudioPlaying
                            ? `Pause ${track.title}`
                            : `Play ${track.title}`
                        }
                        className={`h-7 w-7 mx-auto rounded flex items-center justify-center transition-colors ${
                          isActivePlay
                            ? 'text-[#FF1F3D]'
                            : playable
                              ? 'text-[#717786] hover:text-white hover:bg-white/[0.07]'
                              : 'text-[#4B5563]'
                        }`}
                      >
                        {isActivePlay && isAudioPlaying ? (
                          <Pause className="h-3.5 w-3.5 fill-current" />
                        ) : (
                          <>
                            <span className="font-mono text-xs tabular-nums group-hover:hidden">
                              {idx + 1}
                            </span>
                            <Play className="h-3.5 w-3.5 fill-current hidden group-hover:block ml-0.5" />
                          </>
                        )}
                      </button>
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded bg-[#181B22] border border-white/[0.06] overflow-hidden flex items-center justify-center shrink-0">
                          {track.coverArtUrl ? (
                            <img
                              src={track.coverArtUrl}
                              alt={`${track.title} art`}
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Disc3 className="h-4 w-4 text-[#525866]" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div
                            className={`text-[13.5px] font-medium truncate ${
                              track.isMissingOnDevice
                                ? 'text-[#717786] line-through'
                                : isActivePlay
                                  ? 'text-[#FF4D64]'
                                  : 'text-white'
                            }`}
                          >
                            {track.title}
                          </div>
                          <div className="text-xs text-[#8B92A2] truncate">
                            {track.artist}
                            {track.album !== 'Unknown Album' && (
                              <>
                                <span className="mx-1.5 text-[#4B5563]" aria-hidden="true">
                                  ·
                                </span>
                                <span>{track.album}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                      {track.isMissingOnDevice ? (
                        <span className="text-[#EF4444]">Missing on device</span>
                      ) : isSynced ? (
                        <span className="text-[#8B92A2]">In sync</span>
                      ) : (
                        <span className="text-[#F59E0B]">Pending addition</span>
                      )}
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2.5 text-xs">
                        {track.youtubeVideoId ? (
                          <button
                            type="button"
                            onClick={() => onInspectTrack(track.id)}
                            className="inline-flex items-center gap-1.5 font-medium text-[#22C55E] hover:text-[#4ADE80] transition-colors whitespace-nowrap"
                          >
                            <Check className="h-3.5 w-3.5 shrink-0" />
                            <span className="font-mono">{track.youtubeVideoId}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onInspectTrack(track.id)}
                            className="inline-flex items-center gap-1 font-medium text-[#D1D5DB] hover:text-white transition-colors whitespace-nowrap"
                          >
                            <Link2 className="h-3.5 w-3.5 text-[#8B92A2]" />
                            <span>Match</span>
                          </button>
                        )}
                        <span className="text-[#3F4554]" aria-hidden="true">
                          ·
                        </span>
                        <a
                          href={buildTrackYouTubeMusicUrl(track)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#A1A7B5] hover:text-[#FF4D64] transition-colors whitespace-nowrap"
                          title={
                            track.youtubeVideoId
                              ? 'Play directly in YouTube Music'
                              : 'Open in YouTube Music'
                          }
                        >
                          <span>Open</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </td>

                    <td
                      className="py-2.5 px-3 text-right font-mono text-xs tabular-nums"
                      title={
                        playCount > 0
                          ? `${completedCount} finished · ${skipCount} skipped${lastPlayedAt ? ` · Last played ${formatRelativeTime(lastPlayedAt)}` : ''}`
                          : 'Not played yet'
                      }
                    >
                      {playCount > 0 ? (
                        <span className="text-white font-medium">{playCount}</span>
                      ) : (
                        <span className="text-[#4B5563]">—</span>
                      )}
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-[#8B92A2]">
                      {formatDuration(track.duration)}
                    </td>

                    <td className="py-2.5 pl-2 pr-6 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => onReorderTrack(playlist.id, idx, idx - 1)}
                          aria-label={`Move ${track.title} up`}
                          className="p-1 rounded text-[#717786] hover:text-white hover:bg-white/[0.06] disabled:opacity-25 transition-colors"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === tracks.length - 1}
                          onClick={() => onReorderTrack(playlist.id, idx, idx + 1)}
                          aria-label={`Move ${track.title} down`}
                          className="p-1 rounded text-[#717786] hover:text-white hover:bg-white/[0.06] disabled:opacity-25 transition-colors"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveTrackFromPlaylist(playlist.id, track.id)}
                          aria-label={`Remove ${track.title} from playlist`}
                          className="p-1 rounded text-[#717786] hover:text-[#EF4444] hover:bg-white/[0.06] transition-colors ml-1"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
