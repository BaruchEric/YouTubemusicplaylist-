import { useState } from 'react';
import {
  Activity,
  Disc3,
  ExternalLink,
  FolderOpen,
  Gauge,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  RotateCcw,
  ShieldCheck,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  Waves,
  X,
} from 'lucide-react';
import type {
  AppliedReplayGainInfo,
  AudioPlayerState,
  LoudnessScanProgress,
  ReplayGainMode,
  ReplayGainTargetLufs,
} from '../hooks/useAudioPlayer';
import type { LocalTrack } from '../types/music';
import { formatGainDb, formatLufs } from '../utils/replayGain';
import {
  buildTrackYouTubeMusicUrl,
  formatDuration,
} from '../utils/youtubeLinks';

const TARGET_LUFS_OPTIONS: Array<{
  value: ReplayGainTargetLufs;
  label: string;
  caption: string;
}> = [
  { value: -14, label: '-14 LUFS', caption: 'YouTube' },
  { value: -16, label: '-16 LUFS', caption: 'Balanced' },
  { value: -18, label: '-18 LUFS', caption: 'RG 2.0' },
];

interface MiniPlayerProps {
  track: LocalTrack | null;
  queueTracks: LocalTrack[];
  totalLibraryCount: number;
  state: AudioPlayerState;
  activeTrackReplayGain: AppliedReplayGainInfo | null;
  analyzedTrackCount: number;
  loudnessScanProgress: LoudnessScanProgress | null;
  onTogglePlay: () => void;
  onSelectTrack: (trackId: string) => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onCycleCrossfade: () => void;
  onSetReplayGainMode: (mode: ReplayGainMode) => void;
  onSetReplayGainTargetLufs: (target: ReplayGainTargetLufs) => void;
  onSetReplayGainPreampDb: (db: number) => void;
  onSetReplayGainPreventClipping: (enabled: boolean) => void;
  onAnalyzeLibraryLoudness: () => void;
  onCancelLibraryLoudnessScan: () => void;
  onClearLoudnessCache: () => void;
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
  activeTrackReplayGain,
  analyzedTrackCount,
  loudnessScanProgress,
  onTogglePlay,
  onSelectTrack,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleShuffle,
  onCycleRepeat,
  onCycleCrossfade,
  onSetReplayGainMode,
  onSetReplayGainTargetLufs,
  onSetReplayGainPreampDb,
  onSetReplayGainPreventClipping,
  onAnalyzeLibraryLoudness,
  onCancelLibraryLoudnessScan,
  onClearLoudnessCache,
  onPrev,
  onNext,
  onRelinkFiles,
  onInspectTrack,
}: MiniPlayerProps) {
  const [queueOpen, setQueueOpen] = useState(false);
  const [replayGainOpen, setReplayGainOpen] = useState(false);

  const effectiveDuration = state.duration || track?.duration || 0;
  const repeatLabel =
    state.repeatMode === 'one'
      ? 'Repeat one'
      : state.repeatMode === 'all'
        ? 'Repeat queue'
        : 'Repeat off';

  const showYouTubeEmbed =
    state.playbackMode === 'youtube' && Boolean(track?.youtubeVideoId) && state.isPlaying;

  const replayGainButtonLabel =
    state.replayGainMode === 'off'
      ? 'RG Off'
      : state.isAnalyzingLoudness
        ? 'RG …'
        : activeTrackReplayGain
          ? formatGainDb(activeTrackReplayGain.appliedGainDb)
          : state.replayGainMode === 'album'
            ? 'RG Alb'
            : 'RG Trk';

  const replayGainActive = state.replayGainMode !== 'off';

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

      {/* ReplayGain Loudness Normalization Popover */}
      {replayGainOpen && (
        <div className="absolute bottom-[82px] right-4 sm:right-6 z-40 w-[348px] max-w-[calc(100vw-2rem)] rounded-lg bg-[#151820] border border-white/[0.12] shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Gauge className="h-3.5 w-3.5 text-[#FF4D64] shrink-0" />
                <span className="truncate">Loudness Normalization (ReplayGain)</span>
              </div>
              <div className="text-[11px] text-[#8B92A2] truncate mt-0.5">
                ITU-R BS.1770 K-weighted gain leveling
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReplayGainOpen(false)}
              aria-label="Close ReplayGain settings"
              className="p-1 rounded text-[#8B92A2] hover:text-white transition-colors shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Mode selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#8B92A2]">
                  Normalization Mode
                </span>
                <span className="text-[11px] text-[#9CA3AF]">
                  {state.replayGainMode === 'off'
                    ? 'Bypassed'
                    : state.replayGainMode === 'track'
                      ? 'Per-track level'
                      : 'Preserve album dynamics'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'off', label: 'Off' },
                    { id: 'track', label: 'Track' },
                    { id: 'album', label: 'Album' },
                  ] as const
                ).map((option) => {
                  const selected = state.replayGainMode === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => onSetReplayGainMode(option.id)}
                      className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                        selected
                          ? 'bg-[#FF1F3D] text-white'
                          : 'bg-white/[0.05] text-[#A1A7B5] hover:bg-white/[0.09] hover:text-white'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Target Loudness */}
            <div className={`space-y-1.5 ${!replayGainActive ? 'opacity-45 pointer-events-none' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#8B92A2]">
                  Target Loudness
                </span>
                <span className="text-[11px] font-mono tabular-nums text-[#9CA3AF]">
                  {state.replayGainTargetLufs} LUFS
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {TARGET_LUFS_OPTIONS.map((opt) => {
                  const selected = state.replayGainTargetLufs === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onSetReplayGainTargetLufs(opt.value)}
                      className={`px-2 py-1.5 rounded border text-center transition-colors ${
                        selected
                          ? 'bg-[#FF1F3D]/15 border-[#FF1F3D]/50 text-white'
                          : 'bg-white/[0.03] border-white/[0.07] text-[#9CA3AF] hover:text-white hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="font-mono text-xs tabular-nums font-medium">{opt.label}</div>
                      <div className="text-[10px] text-[#8B92A2] mt-0.5">{opt.caption}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pre-amp slider */}
            <div className={`space-y-1.5 ${!replayGainActive ? 'opacity-45 pointer-events-none' : ''}`}>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#8B92A2]">
                  Pre-amp Gain
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs tabular-nums text-white">
                    {formatGainDb(state.replayGainPreampDb)}
                  </span>
                  {state.replayGainPreampDb !== 0 && (
                    <button
                      type="button"
                      onClick={() => onSetReplayGainPreampDb(0)}
                      className="text-[11px] text-[#8B92A2] hover:text-white underline underline-offset-2"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
              <input
                type="range"
                min={-6}
                max={6}
                step={0.5}
                value={state.replayGainPreampDb}
                onChange={(e) => onSetReplayGainPreampDb(Number(e.target.value))}
                aria-label="ReplayGain pre-amp in decibels"
                className="w-full h-1 accent-[#FF1F3D] bg-white/15 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between font-mono text-[10px] tabular-nums text-[#6B7280]">
                <span>-6 dB</span>
                <span>0 dB</span>
                <span>+6 dB</span>
              </div>
            </div>

            {/* Prevent Clipping / Safety Peak Limiter */}
            <div
              className={`flex items-center justify-between gap-3 ${
                !replayGainActive ? 'opacity-45 pointer-events-none' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-white">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />
                  <span>Prevent Clipping</span>
                </div>
                <div className="text-[11px] text-[#8B92A2]">
                  Caps boost by peak amplitude &amp; engages limiter
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={state.replayGainPreventClipping}
                onClick={() => onSetReplayGainPreventClipping(!state.replayGainPreventClipping)}
                className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${
                  state.replayGainPreventClipping ? 'bg-[#FF1F3D]' : 'bg-white/15'
                }`}
              >
                <span
                  className={`block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    state.replayGainPreventClipping ? 'translate-x-[18px]' : 'translate-x-[3px]'
                  }`}
                />
              </button>
            </div>

            {/* Live Active Track Loudness Readout */}
            <div className="rounded-md bg-[#0E1015] border border-white/[0.07] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-[#D1D5DB] truncate">
                  {track ? track.title : 'No active track'}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wide text-[#8B92A2] shrink-0">
                  {state.isAnalyzingLoudness
                    ? 'Analyzing…'
                    : activeTrackReplayGain
                      ? activeTrackReplayGain.scope === 'album'
                        ? `Album · ${activeTrackReplayGain.albumTrackCount}`
                        : 'Track Gain'
                      : state.playbackMode === 'youtube'
                        ? 'YT Stream'
                        : replayGainActive
                          ? 'Pending'
                          : 'Off'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1 border-t border-white/[0.06]">
                <div>
                  <div className="text-[10px] text-[#717786]">Measured</div>
                  <div className="font-mono text-xs tabular-nums text-white mt-0.5">
                    {activeTrackReplayGain ? formatLufs(activeTrackReplayGain.measuredLufs) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#717786]">Peak</div>
                  <div className="font-mono text-xs tabular-nums text-white mt-0.5">
                    {activeTrackReplayGain ? activeTrackReplayGain.peak.toFixed(2) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#717786]">Applied</div>
                  <div
                    className={`font-mono text-xs tabular-nums font-medium mt-0.5 ${
                      !activeTrackReplayGain
                        ? 'text-[#717786]'
                        : activeTrackReplayGain.appliedGainDb > 0.1
                          ? 'text-[#22C55E]'
                          : activeTrackReplayGain.appliedGainDb < -0.1
                            ? 'text-[#FF4D64]'
                            : 'text-white'
                    }`}
                  >
                    {activeTrackReplayGain
                      ? formatGainDb(activeTrackReplayGain.appliedGainDb)
                      : '0.0 dB'}
                  </div>
                </div>
              </div>

              {activeTrackReplayGain?.clippingPrevented && (
                <div className="text-[11px] text-[#F59E0B] pt-0.5">
                  Boost reduced from {formatGainDb(activeTrackReplayGain.rawGainDb)} to prevent
                  digital clipping.
                </div>
              )}
              {state.playbackMode === 'youtube' && (
                <div className="text-[11px] text-[#8B92A2] pt-0.5">
                  ReplayGain applies to local audio playback decks.
                </div>
              )}
            </div>

            {/* Library Loudness Batch Analysis */}
            <div className="pt-2.5 border-t border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-[#D1D5DB] flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-[#8B92A2] shrink-0" />
                    <span>Library Loudness Cache</span>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#8B92A2] mt-0.5">
                    {analyzedTrackCount} / {totalLibraryCount} tracks analyzed
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {loudnessScanProgress ? (
                    <button
                      type="button"
                      onClick={onCancelLibraryLoudnessScan}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-white/[0.08] hover:bg-white/[0.14] text-white transition-colors whitespace-nowrap"
                    >
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Stop</span>
                    </button>
                  ) : (
                    <>
                      {analyzedTrackCount > 0 && (
                        <button
                          type="button"
                          onClick={onClearLoudnessCache}
                          title="Clear cached loudness measurements"
                          className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={onAnalyzeLibraryLoudness}
                        disabled={totalLibraryCount === 0 || analyzedTrackCount >= totalLibraryCount}
                        className="px-2.5 py-1.5 rounded text-xs font-medium bg-white/[0.08] hover:bg-white/[0.14] disabled:opacity-40 disabled:pointer-events-none text-white transition-colors whitespace-nowrap"
                      >
                        {analyzedTrackCount >= totalLibraryCount && totalLibraryCount > 0
                          ? 'Up to date'
                          : 'Analyze Library'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {loudnessScanProgress && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-[#8B92A2]">
                    <span className="truncate pr-2">
                      {loudnessScanProgress.currentTitle || 'Decoding audio…'}
                    </span>
                    <span className="font-mono tabular-nums shrink-0">
                      {loudnessScanProgress.processed}/{loudnessScanProgress.total}
                    </span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-white/[0.08] overflow-hidden">
                    <div
                      className="h-full bg-[#FF1F3D] transition-all duration-150"
                      style={{
                        width: `${Math.round(
                          (loudnessScanProgress.processed / Math.max(1, loudnessScanProgress.total)) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Up Next Queue Popover */}
      {queueOpen && (
        <div className="absolute bottom-[82px] right-4 sm:right-6 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-lg bg-[#151820] border border-white/[0.12] shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white">
                Up Next ({queueTracks.length})
              </div>
              {state.shuffleMode === 'smart' && (
                <div className="text-[11px] text-[#FF4D64] truncate mt-0.5">
                  Smart Shuffle · Matched YT IDs prioritized
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setQueueOpen(false)}
              aria-label="Close playback queue"
              className="p-1 rounded text-[#8B92A2] hover:text-white transition-colors shrink-0"
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
                        <div className="text-[11px] text-[#8B92A2] truncate">
                          {item.artist}
                          {state.shuffleMode === 'smart' && item.youtubeVideoId && (
                            <span className="text-[#22C55E]"> · YT Matched</span>
                          )}
                        </div>
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
        <div className="flex items-center gap-2.5 sm:gap-3.5">
          <button
            type="button"
            onClick={onToggleShuffle}
            aria-label={
              state.shuffleMode === 'smart'
                ? 'Smart Shuffle active (prioritizes matched YouTube IDs & complete metadata). Click for Standard Shuffle.'
                : state.shuffleMode === 'standard'
                  ? 'Standard Shuffle active. Click to disable shuffle.'
                  : 'Shuffle off. Click to enable Smart Shuffle.'
            }
            aria-pressed={state.shuffleMode !== 'off'}
            title={
              state.shuffleMode === 'smart'
                ? 'Smart Shuffle on — prioritizes matched YouTube IDs & complete metadata (click for Standard Shuffle)'
                : state.shuffleMode === 'standard'
                  ? 'Standard Shuffle on (click to turn off)'
                  : 'Shuffle off (click for Smart Shuffle)'
            }
            className={`inline-flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
              state.shuffleMode === 'smart'
                ? 'text-[#FF4D64] bg-[#FF1F3D]/15 hover:bg-[#FF1F3D]/20'
                : state.shuffleMode === 'standard'
                  ? 'text-white bg-white/[0.1] hover:bg-white/[0.14]'
                  : 'text-[#717786] hover:text-white'
            }`}
          >
            <Shuffle className="h-3.5 w-3.5 shrink-0" />
            {state.shuffleMode === 'smart' && <span>Smart</span>}
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

          <button
            type="button"
            onClick={() => {
              setReplayGainOpen((v) => !v);
              setQueueOpen(false);
            }}
            aria-label="Loudness normalization (ReplayGain) settings"
            aria-expanded={replayGainOpen}
            title={
              replayGainActive
                ? `ReplayGain (${state.replayGainMode}, target ${state.replayGainTargetLufs} LUFS)${
                    activeTrackReplayGain
                      ? ` · Applied ${formatGainDb(activeTrackReplayGain.appliedGainDb)}`
                      : ''
                  }`
                : 'ReplayGain loudness normalization: Off (click to configure)'
            }
            className={`inline-flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-mono tabular-nums transition-colors whitespace-nowrap ${
              replayGainOpen
                ? 'text-white bg-white/[0.14]'
                : replayGainActive
                  ? 'text-[#FF4D64] bg-[#FF1F3D]/10 hover:bg-[#FF1F3D]/15'
                  : 'text-[#717786] hover:text-white'
            }`}
          >
            <Gauge className="h-3.5 w-3.5 shrink-0" />
            <span>{replayGainButtonLabel}</span>
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
          onClick={() => {
            setQueueOpen((v) => !v);
            setReplayGainOpen(false);
          }}
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
