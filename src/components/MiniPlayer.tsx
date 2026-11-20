import { useState } from 'react';
import {
  Disc3,
  ExternalLink,
  FolderOpen,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  Waves,
  X,
} from 'lucide-react';
import type { AudioPlayerState } from '../hooks/useAudioPlayer';
import type { LocalTrack } from '../types/music';
import {
  buildTrackYouTubeMusicUrl,
  formatDuration,
} from '../utils/youtubeLinks';

interface MiniPlayerProps {
  track: LocalTrack | null;
  queueTracks: LocalTrack[];
  totalLibraryCount: number;
  state: AudioPlayerState;
  onTogglePlay: () => void;
  onSelectTrack: (trackId: string) => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onCycleCrossfade: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRelinkFiles: () => void;
  onInspectTrack: (trackId: string) => void;
}

export function MiniPlayer({
  track,
  queueTracks,
  totalLibraryCount,
  state,
  onTogglePlay,
  onSelectTrack,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleShuffle,
  onCycleRepeat,
  onCycleCrossfade,
  onPrev,
  onNext,
  onRelinkFiles,
  onInspectTrack,
}: MiniPlayerProps) {
  const [queueOpen, setQueueOpen] = useState(false);

  const effectiveDuration = state.duration || track?.duration || 0;
  const repeatLabel =
    state.repeatMode === 'one'
      ? 'Repeat one'
      : state.repeatMode === 'all'
        ? 'Repeat queue'
        : 'Repeat off';

  const showYouTubeEmbed =
    state.playbackMode === 'youtube' && Boolean(track?.youtubeVideoId) && state.isPlaying;

  return (
    <div className="relative h-[76px] px-4 sm:px-6 bg-[#12141A] border-t border-white/[0.09] flex items-center justify-between gap-4 shrink-0">
      {/* Compact Embedded YouTube Stream Dock when playing a YouTube-matched track without local file */}
      {showYouTubeEmbed && track?.youtubeVideoId && (
        <div className="absolute bottom-[82px] left-4 sm:left-6 z-40 w-80 rounded-lg bg-[#141720] border border-white/[0.12] shadow-2xl overflow-hidden">
          <div className="px-3 py-2 border-b border-white/[0.08] flex items-center justify-between gap-2 text-xs">
            <span className="text-[#D1D5DB] truncate font-medium">
              Streaming via YouTube · {track.title}
            </span>
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label="Close YouTube stream"
              className="p-1 rounded text-[#8B92A2] hover:text-white transition-colors shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="aspect-video w-full bg-black">
            <iframe
              key={track.youtubeVideoId}
              src={`https://www.youtube.com/embed/${encodeURIComponent(track.youtubeVideoId)}?autoplay=1&rel=0`}
              title={`YouTube player for ${track.title}`}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="w-full h-full border-0"
            />
          </div>
        </div>
      )}

      {/* Up Next Queue Popover */}
      {queueOpen && (
        <div className="absolute bottom-[82px] right-4 sm:right-6 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-lg bg-[#151820] border border-white/[0.12] shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between">
            <span className="text-xs font-semibold text-white">
              Up Next ({queueTracks.length})
            </span>
            <button
              type="button"
              onClick={() => setQueueOpen(false)}
              aria-label="Close playback queue"
              className="p-1 rounded text-[#8B92A2] hover:text-white transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-white/[0.05]">
            {queueTracks.length === 0 ? (
              <div className="p-4 text-xs text-[#6B7280]">No tracks in queue yet.</div>
            ) : (
              queueTracks.map((item, idx) => {
                const isCurrent = item.id === track?.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectTrack(item.id)}
                    className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left transition-colors ${
                      isCurrent ? 'bg-[#FF1F3D]/10' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`font-mono text-[11px] tabular-nums w-5 shrink-0 ${
                          isCurrent ? 'text-[#FF4D64]' : 'text-[#6B7280]'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <div
                          className={`text-xs font-medium truncate ${
                            isCurrent ? 'text-[#FF4D64]' : 'text-white'
                          }`}
                        >
                          {item.title}
                        </div>
                        <div className="text-[11px] text-[#8B92A2] truncate">{item.artist}</div>
                      </div>
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-[#717786] shrink-0">
                      {formatDuration(item.duration)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Left: Active Track Metadata + Recovery Actions */}
      <div className="flex items-center gap-3 min-w-0 w-1/3 max-w-[320px]">
        <div className="h-11 w-11 rounded bg-[#1A1D25] border border-white/[0.08] overflow-hidden flex items-center justify-center shrink-0">
          {track?.coverArtUrl ? (
            <img
              src={track.coverArtUrl}
              alt={`${track.title} artwork`}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          ) : (
            <Disc3 className={`h-4 w-4 ${state.isPlaying ? 'text-[#FF1F3D]' : 'text-[#6B7280]'}`} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {track ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-white truncate">{track.title}</span>
              </div>

              {state.error ? (
                <div className="flex items-center gap-2 text-[11px] mt-0.5 min-w-0">
                  <span className="text-[#F59E0B] truncate" title={state.error}>
                    {state.error}
                  </span>
                  {state.needsRelink ? (
                    <button
                      type="button"
                      onClick={onRelinkFiles}
                      className="inline-flex items-center gap-1 text-white hover:text-[#FF4D64] font-medium whitespace-nowrap shrink-0 underline underline-offset-2"
                    >
                      <FolderOpen className="h-3 w-3" />
                      <span>Re-link</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onInspectTrack(track.id)}
                      className="text-white hover:text-[#FF4D64] font-medium whitespace-nowrap shrink-0 underline underline-offset-2"
                    >
                      Match YT
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-xs text-[#8B92A2] truncate">
                  {state.playbackMode === 'youtube' ? (
                    <span className="text-[#22C55E]">Playing via YouTube</span>
                  ) : (
                    <span>{track.artist}</span>
                  )}
                  {track.album !== 'Unknown Album' && state.playbackMode !== 'youtube' && (
                    <>
                      <span className="mx-1 text-[#4B5563]" aria-hidden="true">
                        ·
                      </span>
                      <span>{track.album}</span>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-[13px] font-medium text-[#D1D5DB] truncate">Ready to play</div>
              <div className="text-xs text-[#717786] font-mono tabular-nums truncate">
                {totalLibraryCount} local track{totalLibraryCount === 1 ? '' : 's'} available
              </div>
            </>
          )}
        </div>
      </div>

      {/* Center: Transport Controls + Scrubber */}
      <div className="flex-1 max-w-xl flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            type="button"
            onClick={onToggleShuffle}
            aria-label={state.isShuffled ? 'Disable shuffle' : 'Enable shuffle'}
            aria-pressed={state.isShuffled}
            title={state.isShuffled ? 'Shuffle on' : 'Shuffle off'}
            className={`p-1.5 rounded transition-colors ${
              state.isShuffled
                ? 'text-[#FF4D64] bg-[#FF1F3D]/10'
                : 'text-[#717786] hover:text-white'
            }`}
          >
            <Shuffle className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous track"
            title="Previous track"
            className="p-1.5 text-[#A1A7B5] hover:text-white transition-colors"
          >
            <SkipBack className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={state.isPlaying ? 'Pause' : 'Play'}
            title={state.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            className="h-9 w-9 rounded-full bg-white text-[#0B0C0E] hover:bg-[#E5E7EB] flex items-center justify-center transition-colors shrink-0"
          >
            {state.isPlaying ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={onNext}
            aria-label="Next track"
            title="Next track"
            className="p-1.5 text-[#A1A7B5] hover:text-white transition-colors"
          >
            <SkipForward className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onCycleRepeat}
            aria-label={repeatLabel}
            title={repeatLabel}
            className={`p-1.5 rounded transition-colors ${
              state.repeatMode !== 'off'
                ? 'text-[#FF4D64] bg-[#FF1F3D]/10'
                : 'text-[#717786] hover:text-white'
            }`}
          >
            {state.repeatMode === 'one' ? (
              <Repeat1 className="h-3.5 w-3.5" />
            ) : (
              <Repeat className="h-3.5 w-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={onCycleCrossfade}
            aria-label={
              state.crossfadeSeconds > 0
                ? `Crossfade ${state.crossfadeSeconds} seconds`
                : 'Crossfade off'
            }
            aria-pressed={state.crossfadeSeconds > 0}
            title={
              state.crossfadeSeconds > 0
                ? `Crossfade: ${state.crossfadeSeconds}s (click to change)`
                : 'Crossfade: Off (click to enable)'
            }
            className={`hidden sm:inline-flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-mono tabular-nums transition-colors whitespace-nowrap ${
              state.isCrossfading
                ? 'text-white bg-[#FF1F3D]/25'
                : state.crossfadeSeconds > 0
                  ? 'text-[#FF4D64] bg-[#FF1F3D]/10 hover:bg-[#FF1F3D]/15'
                  : 'text-[#717786] hover:text-white'
            }`}
          >
            <Waves className="h-3.5 w-3.5 shrink-0" />
            <span>{state.crossfadeSeconds > 0 ? `${state.crossfadeSeconds}s` : 'Off'}</span>
          </button>
        </div>

        <div className="w-full flex items-center gap-2.5">
          <span className="font-mono text-[11px] tabular-nums text-[#717786] w-10 text-right">
            {formatDuration(state.currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={effectiveDuration || 1}
            step={0.5}
            disabled={!track || state.playbackMode !== 'local'}
            value={Math.min(state.currentTime, effectiveDuration || 1)}
            onChange={(e) => onSeek(Number(e.target.value))}
            aria-label="Seek audio position"
            className="flex-1 h-1 accent-[#FF1F3D] bg-white/15 rounded-lg cursor-pointer disabled:opacity-40"
          />
          <span className="font-mono text-[11px] tabular-nums text-[#717786] w-10">
            {formatDuration(effectiveDuration)}
          </span>
        </div>
      </div>

      {/* Right: Open in YouTube Music + Queue Toggle + Mute & Volume Slider */}
      <div className="flex items-center justify-end gap-2.5 sm:gap-3 shrink-0 md:w-1/3 md:max-w-[300px]">
        <a
          href={
            track
              ? buildTrackYouTubeMusicUrl(track)
              : 'https://music.youtube.com/library/playlists'
          }
          target="_blank"
          rel="noopener noreferrer"
          title={
            track?.youtubeVideoId
              ? 'Open this matched song in YouTube Music'
              : track
                ? 'Search and play this track in YouTube Music'
                : 'Open YouTube Music library'
          }
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF1F3D]/15 border border-[#FF1F3D]/35 hover:bg-[#FF1F3D] hover:border-[#FF1F3D] transition-colors whitespace-nowrap shrink-0"
        >
          <span className="hidden sm:inline">YouTube Music</span>
          <span className="sm:hidden">YT Music</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>

        <button
          type="button"
          onClick={() => setQueueOpen((v) => !v)}
          aria-label="Toggle playback queue"
          aria-expanded={queueOpen}
          title="Up Next queue"
          className={`hidden md:inline-flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${
            queueOpen
              ? 'bg-white/[0.1] text-white'
              : 'text-[#8B92A2] hover:text-white hover:bg-white/[0.06]'
          }`}
        >
          <ListMusic className="h-3.5 w-3.5" />
          <span className="font-mono tabular-nums">{queueTracks.length}</span>
        </button>

        <button
          type="button"
          onClick={onToggleMute}
          aria-label={state.isMuted || state.volume === 0 ? 'Unmute' : 'Mute'}
          title={state.isMuted || state.volume === 0 ? 'Unmute' : 'Mute'}
          className="hidden md:inline-flex p-1.5 rounded text-[#8B92A2] hover:text-white transition-colors"
        >
          {state.isMuted || state.volume === 0 ? (
            <VolumeX className="h-4 w-4 text-[#EF4444]" />
          ) : state.volume < 0.5 ? (
            <Volume1 className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </button>

        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={state.isMuted ? 0 : state.volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          aria-label="Audio volume"
          className="hidden lg:block w-20 h-1 accent-white bg-white/15 rounded-lg cursor-pointer"
        />
      </div>
    </div>
  );
}
