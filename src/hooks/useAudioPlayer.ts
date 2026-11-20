import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LocalTrack,
  PlayEventOutcome,
  PlayHistoryEntry,
  TrackPlayStats,
} from '../types/music';
import {
  buildSmartShuffleOrder,
  buildStandardShuffleOrder,
  type ShuffleMode,
} from '../utils/smartShuffle';
import { loadAudioBlob } from '../utils/storage';
import {
  analyzeAudioBlobLoudness,
  computeReplayGainAdjustment,
  loadLoudnessCache,
  loadReplayGainSettings,
  saveLoudnessCache,
  saveReplayGainSettings,
  type AppliedReplayGainInfo,
  type LoudnessScanProgress,
  type ReplayGainMode,
  type ReplayGainTargetLufs,
  type TrackLoudnessData,
} from '../utils/replayGain';

export type RepeatMode = 'off' | 'all' | 'one';
export type {
  AppliedReplayGainInfo,
  LoudnessScanProgress,
  ReplayGainMode,
  ReplayGainTargetLufs,
  ShuffleMode,
  TrackLoudnessData,
};

export const CROSSFADE_PRESETS = [0, 2, 4, 6, 8] as const;
const CROSSFADE_STORAGE_KEY = 'cratesync_crossfade_sec';
const PLAY_STATS_STORAGE_KEY = 'cratesync_play_stats_v1';
const PLAY_HISTORY_STORAGE_KEY = 'cratesync_play_history_v1';
const MAX_PLAY_HISTORY_ENTRIES = 80;
const DEFAULT_CROSSFADE_SECONDS = 4;

interface ActivePlaybackSession {
  trackId: string;
  startedAtMs: number;
  maxObservedTime: number;
  recorded: boolean;
}

export interface AudioPlayerState {
  activeTrackId: string | null;
  queueIds: string[];
  isPlaying: boolean;
  isShuffled: boolean;
  shuffleMode: ShuffleMode;
  repeatMode: RepeatMode;
  isMuted: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  crossfadeSeconds: number;
  isCrossfading: boolean;
  replayGainMode: ReplayGainMode;
  replayGainTargetLufs: ReplayGainTargetLufs;
  replayGainPreampDb: number;
  replayGainPreventClipping: boolean;
  isAnalyzingLoudness: boolean;
  playbackMode: 'local' | 'youtube' | 'none';
  error: string | null;
  needsRelink: boolean;
}

interface CrossfadeSession {
  timerId: number;
  outgoingIdx: 0 | 1;
  incomingIdx: 0 | 1;
  startTime: number;
  durationMs: number;
  progress: number;
}

const MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  webm: 'audio/webm',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  caf: 'audio/x-caf',
};

function ensureAudioBlobType(blob: Blob, fileName: string, format: string): Blob {
  if (blob.type && blob.type.startsWith('audio/')) {
    return blob;
  }
  const ext = (fileName.split('.').pop() || format || '').toLowerCase();
  const inferred = MIME_BY_EXT[ext];
  if (inferred) {
    return new Blob([blob], { type: inferred });
  }
  return blob;
}

function readSavedCrossfadeSeconds(): number {
  try {
    const raw = window.localStorage.getItem(CROSSFADE_STORAGE_KEY);
    if (raw === null) return DEFAULT_CROSSFADE_SECONDS;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 12) {
      return parsed;
    }
  } catch {
    // Ignore storage read errors in restricted iframe contexts
  }
  return DEFAULT_CROSSFADE_SECONDS;
}

function clampVolume(vol: number): number {
  return Math.max(0, Math.min(1, vol));
}

function readSavedPlayStats(): Record<string, TrackPlayStats> {
  try {
    const raw = window.localStorage.getItem(PLAY_STATS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const clean: Record<string, TrackPlayStats> = {};
    for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Partial<TrackPlayStats>;
      const playCount = Number.isFinite(e.playCount) ? Math.max(0, Number(e.playCount)) : 0;
      const completedCount = Number.isFinite(e.completedCount)
        ? Math.max(0, Number(e.completedCount))
        : 0;
      const skipCount = Number.isFinite(e.skipCount) ? Math.max(0, Number(e.skipCount)) : 0;
      const lastPlayedAt =
        typeof e.lastPlayedAt === 'number' && Number.isFinite(e.lastPlayedAt)
          ? e.lastPlayedAt
          : null;
      if (playCount > 0 || completedCount > 0 || skipCount > 0) {
        clean[id] = {
          playCount: Math.max(playCount, completedCount + skipCount),
          completedCount,
          skipCount,
          lastPlayedAt,
        };
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function readSavedPlayHistory(): PlayHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(PLAY_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is PlayHistoryEntry =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof item.id === 'string' &&
          typeof item.trackId === 'string' &&
          typeof item.title === 'string'
      )
      .slice(0, MAX_PLAY_HISTORY_ENTRIES);
  } catch {
    return [];
  }
}

export function useAudioPlayer(
  tracks: LocalTrack[],
  fileMapRef: React.MutableRefObject<Map<string, Blob>>,
  options?: {
    onPlayRecorded?: (event: {
      trackId: string;
      outcome: PlayEventOutcome;
      listenedSeconds: number;
      playedAt: number;
    }) => void;
  }
) {
  // Dual-deck HTML5 Audio elements for seamless overlapping crossfades
  const decksRef = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);
  const deckUrlsRef = useRef<[string | null, string | null]>([null, null]);
  const deckTrackIdRef = useRef<[string | null, string | null]>([null, null]);
  const deckFadeGainRef = useRef<[number, number]>([1, 1]);
  const activeDeckIdxRef = useRef<0 | 1>(0);
  const crossfadeSessionRef = useRef<CrossfadeSession | null>(null);
  const crossfadeTriggeredRef = useRef<boolean>(false);

  // Web Audio API graph for true bidirectional (+/- dB) ReplayGain & safety peak limiting
  const audioCtxRef = useRef<AudioContext | null>(null);
  const deckSourcesRef = useRef<
    [MediaElementAudioSourceNode | null, MediaElementAudioSourceNode | null]
  >([null, null]);
  const deckGainNodesRef = useRef<[GainNode | null, GainNode | null]>([null, null]);
  const masterGainNodeRef = useRef<GainNode | null>(null);
  const limiterNodeRef = useRef<DynamicsCompressorNode | null>(null);
  const webAudioReadyRef = useRef<boolean>(false);
  const webAudioFailedRef = useRef<boolean>(false);

  // Loudness analysis tracking
  const analyzingKeysRef = useRef<Set<string>>(new Set());
  const scanCancelledRef = useRef<boolean>(false);

  const lastNonZeroVolumeRef = useRef<number>(0.85);
  const loadSeqRef = useRef<number>(0);
  const baseQueueIdsRef = useRef<string[]>([]);
  const playbackSessionRef = useRef<ActivePlaybackSession | null>(null);
  const onPlayRecordedRef = useRef(options?.onPlayRecorded);
  useEffect(() => {
    onPlayRecordedRef.current = options?.onPlayRecorded;
  }, [options?.onPlayRecorded]);

  const [playStats, setPlayStats] = useState<Record<string, TrackPlayStats>>(() =>
    readSavedPlayStats()
  );
  const [playHistory, setPlayHistory] = useState<PlayHistoryEntry[]>(() => readSavedPlayHistory());
  const [loudnessCache, setLoudnessCache] = useState<Record<string, TrackLoudnessData>>(() =>
    loadLoudnessCache()
  );
  const [loudnessScanProgress, setLoudnessScanProgress] = useState<LoudnessScanProgress | null>(
    null
  );

  const loudnessCacheRef = useRef(loudnessCache);
  useEffect(() => {
    loudnessCacheRef.current = loudnessCache;
    saveLoudnessCache(loudnessCache);
  }, [loudnessCache]);

  // Persist play stats & recent play history locally
  useEffect(() => {
    try {
      window.localStorage.setItem(PLAY_STATS_STORAGE_KEY, JSON.stringify(playStats));
    } catch {
      // Ignore storage quota errors
    }
  }, [playStats]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PLAY_HISTORY_STORAGE_KEY, JSON.stringify(playHistory));
    } catch {
      // Ignore storage quota errors
    }
  }, [playHistory]);

  const [state, setState] = useState<AudioPlayerState>(() => {
    const savedRg = loadReplayGainSettings();
    return {
      activeTrackId: null,
      queueIds: [],
      isPlaying: false,
      isShuffled: false,
      shuffleMode: 'off',
      repeatMode: 'off',
      isMuted: false,
      currentTime: 0,
      duration: 0,
      volume: 0.85,
      crossfadeSeconds: readSavedCrossfadeSeconds(),
      isCrossfading: false,
      replayGainMode: savedRg.mode,
      replayGainTargetLufs: savedRg.targetLufs,
      replayGainPreampDb: savedRg.preampDb,
      replayGainPreventClipping: savedRg.preventClipping,
      isAnalyzingLoudness: false,
      playbackMode: 'none',
      error: null,
      needsRelink: false,
    };
  });

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Persist ReplayGain settings when changed
  useEffect(() => {
    saveReplayGainSettings({
      mode: state.replayGainMode,
      targetLufs: state.replayGainTargetLufs,
      preampDb: state.replayGainPreampDb,
      preventClipping: state.replayGainPreventClipping,
    });
  }, [
    state.replayGainMode,
    state.replayGainTargetLufs,
    state.replayGainPreampDb,
    state.replayGainPreventClipping,
  ]);

  const tracksRef = useRef(tracks);
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  const libraryAlbumLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tracks) {
      if (t.album) map.set(t.fileKey, t.album);
    }
    return map;
  }, [tracks]);

  const libraryAlbumLookupRef = useRef(libraryAlbumLookup);
  useEffect(() => {
    libraryAlbumLookupRef.current = libraryAlbumLookup;
  }, [libraryAlbumLookup]);

  const getActiveDeck = useCallback((): HTMLAudioElement | null => {
    return decksRef.current[activeDeckIdxRef.current];
  }, []);

  const getDeckReplayGainLinear = useCallback((deckIdx: 0 | 1): number => {
    const {
      replayGainMode,
      replayGainTargetLufs,
      replayGainPreampDb,
      replayGainPreventClipping,
    } = stateRef.current;

    if (replayGainMode === 'off') return 1;
    const trackId = deckTrackIdRef.current[deckIdx];
    if (!trackId) return 1;

    const track = tracksRef.current.find((t) => t.id === trackId);
    if (!track) return 1;

    const info = computeReplayGainAdjustment({
      trackKey: track.fileKey,
      trackAlbum: track.album,
      cache: loudnessCacheRef.current,
      mode: replayGainMode,
      targetLufs: replayGainTargetLufs,
      preampDb: replayGainPreampDb,
      preventClipping: replayGainPreventClipping,
      libraryAlbumLookup: libraryAlbumLookupRef.current,
    });

    return info ? info.linearGain : 1;
  }, []);

  /**
   * Synchronizes per-deck ReplayGain multipliers, equal-power crossfade curves,
   * master volume, mute state, and the Web Audio peak limiter across both decks.
   */
  const syncDeckGains = useCallback(
    (smooth = true) => {
      const muted = stateRef.current.isMuted;
      const masterVol = muted ? 0 : clampVolume(stateRef.current.volume);
      const preventClipping = stateRef.current.replayGainPreventClipping;
      const ctx = audioCtxRef.current;

      if (webAudioReadyRef.current && ctx && masterGainNodeRef.current) {
        const now = ctx.currentTime;
        const tc = smooth ? 0.025 : 0.008;

        masterGainNodeRef.current.gain.setTargetAtTime(masterVol, now, tc);

        if (limiterNodeRef.current) {
          limiterNodeRef.current.threshold.setTargetAtTime(preventClipping ? -1.0 : 0.0, now, 0.02);
          limiterNodeRef.current.ratio.setTargetAtTime(preventClipping ? 12.0 : 1.0, now, 0.02);
        }

        ([0, 1] as const).forEach((idx) => {
          const audio = decksRef.current[idx];
          const gainNode = deckGainNodesRef.current[idx];
          const fadeGain = deckFadeGainRef.current[idx];
          const rgLinear = getDeckReplayGainLinear(idx);
          const combined = Math.max(0, fadeGain * rgLinear);

          if (audio) {
            audio.volume = 1;
            audio.muted = muted;
          }
          if (gainNode) {
            if (!smooth && combined === 0) {
              gainNode.gain.cancelScheduledValues(now);
              gainNode.gain.setValueAtTime(0, now);
            } else {
              gainNode.gain.setTargetAtTime(combined, now, tc);
            }
          }
        });
        return;
      }

      // Graceful HTML5 Audio fallback when Web Audio graph isn't active
      ([0, 1] as const).forEach((idx) => {
        const audio = decksRef.current[idx];
        if (!audio) return;
        const fadeGain = deckFadeGainRef.current[idx];
        const rgLinear = getDeckReplayGainLinear(idx);
        audio.volume = clampVolume(masterVol * fadeGain * Math.min(1, rgLinear));
        audio.muted = muted;
      });
    },
    [getDeckReplayGainLinear]
  );

  /**
   * Lazily initializes and resumes the Web Audio API ReplayGain graph on user gesture.
   * Connects both HTML5 Audio decks -> per-deck GainNodes -> master GainNode -> safety limiter -> destination.
   */
  const ensureWebAudioGraph = useCallback(async () => {
    if (webAudioFailedRef.current) return;

    if (!webAudioReadyRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const deckA = decksRef.current[0];
      const deckB = decksRef.current[1];

      if (!AudioCtx || !deckA || !deckB) {
        webAudioFailedRef.current = true;
        return;
      }

      try {
        const ctx = new AudioCtx();
        const masterGain = ctx.createGain();
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = stateRef.current.replayGainPreventClipping ? -1.0 : 0.0;
        limiter.knee.value = 3.0;
        limiter.ratio.value = stateRef.current.replayGainPreventClipping ? 12.0 : 1.0;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.12;

        masterGain.connect(limiter);
        limiter.connect(ctx.destination);

        const srcA = ctx.createMediaElementSource(deckA);
        const gainA = ctx.createGain();
        srcA.connect(gainA);
        gainA.connect(masterGain);

        const srcB = ctx.createMediaElementSource(deckB);
        const gainB = ctx.createGain();
        srcB.connect(gainB);
        gainB.connect(masterGain);

        deckA.volume = 1;
        deckB.volume = 1;

        audioCtxRef.current = ctx;
        deckSourcesRef.current = [srcA, srcB];
        deckGainNodesRef.current = [gainA, gainB];
        masterGainNodeRef.current = masterGain;
        limiterNodeRef.current = limiter;
        webAudioReadyRef.current = true;
      } catch {
        webAudioFailedRef.current = true;
        return;
      }
    }

    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Ignore resume errors outside user gesture
      }
    }

    syncDeckGains(false);
  }, [syncDeckGains]);

  /**
   * Analyzes and caches loudness for a track asynchronously if not already analyzed.
   */
  const ensureTrackLoudness = useCallback(
    async (track: LocalTrack, preloadedBlob?: Blob | null): Promise<TrackLoudnessData | null> => {
      const existing = loudnessCacheRef.current[track.fileKey];
      if (existing) return existing;
      if (analyzingKeysRef.current.has(track.fileKey)) return null;

      analyzingKeysRef.current.add(track.fileKey);
      const isCurrentActive = stateRef.current.activeTrackId === track.id;
      if (isCurrentActive) {
        setState((prev) => (prev.isAnalyzingLoudness ? prev : { ...prev, isAnalyzingLoudness: true }));
      }

      try {
        let blob = preloadedBlob ?? fileMapRef.current.get(track.fileKey) ?? null;
        if (!blob) {
          blob = await loadAudioBlob(track.fileKey);
        }
        if (!blob) return null;

        const data = await analyzeAudioBlobLoudness(blob, track.album, audioCtxRef.current);
        setLoudnessCache((prev) => ({
          ...prev,
          [track.fileKey]: data,
        }));
        return data;
      } catch {
        return null;
      } finally {
        analyzingKeysRef.current.delete(track.fileKey);
        if (stateRef.current.activeTrackId === track.id) {
          setState((prev) =>
            prev.isAnalyzingLoudness ? { ...prev, isAnalyzingLoudness: false } : prev
          );
        }
      }
    },
    [fileMapRef]
  );

  // Re-apply ReplayGain smoothly whenever settings or loudness measurements update
  useEffect(() => {
    syncDeckGains(true);
  }, [
    state.replayGainMode,
    state.replayGainTargetLufs,
    state.replayGainPreampDb,
    state.replayGainPreventClipping,
    loudnessCache,
    syncDeckGains,
  ]);

  // If user enables ReplayGain while a local track is already loaded, analyze it immediately
  useEffect(() => {
    if (state.replayGainMode === 'off') return;
    if (!state.activeTrackId || state.playbackMode !== 'local') return;
    const track = tracksRef.current.find((t) => t.id === state.activeTrackId);
    if (!track || loudnessCacheRef.current[track.fileKey]) return;
    void ensureTrackLoudness(track);
  }, [state.replayGainMode, state.activeTrackId, state.playbackMode, ensureTrackLoudness]);

  const beginPlaybackSession = useCallback((trackId: string) => {
    playbackSessionRef.current = {
      trackId,
      startedAtMs: Date.now(),
      maxObservedTime: 0,
      recorded: false,
    };
  }, []);

  /**
   * Records a play count increment & recent play history entry when the active track
   * either finishes naturally (including end-of-track crossfade handoff) or is skipped.
   */
  const recordTrackOutcome = useCallback(
    (outcome: PlayEventOutcome, expectedTrackId?: string | null) => {
      const session = playbackSessionRef.current;
      const targetId = expectedTrackId ?? session?.trackId ?? stateRef.current.activeTrackId;
      if (!targetId) return;

      // Prevent duplicate counts for the same playback session (e.g. crossfade handoff + ended event)
      if (session && session.trackId === targetId) {
        if (session.recorded) return;
        session.recorded = true;
      } else if (stateRef.current.playbackMode === 'none') {
        // Track never loaded or played cleanly
        return;
      }

      const track = tracksRef.current.find((t) => t.id === targetId);
      if (!track) return;

      const activeDeck = decksRef.current[activeDeckIdxRef.current];
      const deckTime =
        stateRef.current.playbackMode === 'local' && activeDeck && Number.isFinite(activeDeck.currentTime)
          ? activeDeck.currentTime
          : 0;
      const wallElapsedSec = session ? Math.max(0, (Date.now() - session.startedAtMs) / 1000) : 0;
      const observed = session ? session.maxObservedTime : 0;
      const rawDuration =
        stateRef.current.duration > 0 ? stateRef.current.duration : track.duration || 0;

      const listenedSeconds =
        outcome === 'completed'
          ? Math.round(rawDuration || Math.max(deckTime, observed, wallElapsedSec))
          : Math.round(
              Math.min(
                rawDuration > 0 ? rawDuration : Number.MAX_SAFE_INTEGER,
                Math.max(deckTime, observed, stateRef.current.playbackMode === 'youtube' ? wallElapsedSec : 0)
              )
            );

      const playedAt = Date.now();

      setPlayStats((prev) => {
        const existing = prev[targetId] ?? {
          playCount: track.playCount ?? 0,
          completedCount: Math.max(0, (track.playCount ?? 0) - (track.skipCount ?? 0)),
          skipCount: track.skipCount ?? 0,
          lastPlayedAt: track.lastPlayedAt ?? null,
        };
        return {
          ...prev,
          [targetId]: {
            playCount: existing.playCount + 1,
            completedCount: existing.completedCount + (outcome === 'completed' ? 1 : 0),
            skipCount: existing.skipCount + (outcome === 'skipped' ? 1 : 0),
            lastPlayedAt: playedAt,
          },
        };
      });

      const entry: PlayHistoryEntry = {
        id:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${playedAt}-${targetId}`,
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        coverArtUrl: track.coverArtUrl,
        playedAt,
        outcome,
        listenedSeconds,
        duration: rawDuration,
      };

      setPlayHistory((prev) => [entry, ...prev].slice(0, MAX_PLAY_HISTORY_ENTRIES));
      onPlayRecordedRef.current?.({
        trackId: targetId,
        outcome,
        listenedSeconds,
        playedAt,
      });
    },
    []
  );

  const clearDeck = useCallback((idx: 0 | 1) => {
    const audio = decksRef.current[idx];
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    const url = deckUrlsRef.current[idx];
    if (url) {
      URL.revokeObjectURL(url);
      deckUrlsRef.current[idx] = null;
    }
    deckTrackIdRef.current[idx] = null;
    deckFadeGainRef.current[idx] = 1;
  }, []);

  const cancelCrossfade = useCallback(
    (options?: { keepIncoming?: boolean }) => {
      const session = crossfadeSessionRef.current;
      if (!session) return;

      window.clearInterval(session.timerId);
      crossfadeSessionRef.current = null;

      clearDeck(session.outgoingIdx);

      if (options?.keepIncoming) {
        deckFadeGainRef.current[session.incomingIdx] = 1;
        syncDeckGains(true);
      }

      setState((prev) => (prev.isCrossfading ? { ...prev, isCrossfading: false } : prev));
    },
    [clearDeck, syncDeckGains]
  );

  const clearAllDecks = useCallback(() => {
    cancelCrossfade({ keepIncoming: false });
    clearDeck(0);
    clearDeck(1);
    crossfadeTriggeredRef.current = false;
  }, [cancelCrossfade, clearDeck]);

  /**
   * Starts an equal-power crossfade between outgoingIdx and incomingIdx.
   * Preserves each deck's individual ReplayGain adjustment throughout the ramp.
   * Uses a 40ms interval so transitions complete smoothly even in background tabs.
   */
  const startCrossfadeRamp = useCallback(
    (outgoingIdx: 0 | 1, incomingIdx: 0 | 1, durationSec: number) => {
      const durationMs = Math.max(250, Math.round(durationSec * 1000));
      const startTime = performance.now();

      const applyGains = (progress: number) => {
        const clamped = Math.max(0, Math.min(1, progress));
        // Equal-power curve avoids the perceived volume dip of linear crossfades
        deckFadeGainRef.current[outgoingIdx] = Math.cos(clamped * Math.PI * 0.5);
        deckFadeGainRef.current[incomingIdx] = Math.sin(clamped * Math.PI * 0.5);
        syncDeckGains(false);
      };

      applyGains(0);
      setState((prev) => ({ ...prev, isCrossfading: true }));

      const timerId = window.setInterval(() => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(1, elapsed / durationMs);

        if (crossfadeSessionRef.current) {
          crossfadeSessionRef.current.progress = progress;
        }

        applyGains(progress);

        if (progress >= 1) {
          window.clearInterval(timerId);
          crossfadeSessionRef.current = null;
          clearDeck(outgoingIdx);
          deckFadeGainRef.current[incomingIdx] = 1;
          syncDeckGains(false);
          setState((prev) => (prev.isCrossfading ? { ...prev, isCrossfading: false } : prev));
        }
      }, 40);

      crossfadeSessionRef.current = {
        timerId,
        outgoingIdx,
        incomingIdx,
        startTime,
        durationMs,
        progress: 0,
      };
    },
    [clearDeck, syncDeckGains]
  );

  const loadAndPlayId = useCallback(
    async (
      trackId: string,
      nextQueueIds?: string[],
      options?: { crossfadeDurationSec?: number }
    ) => {
      const currentIdx = activeDeckIdxRef.current;
      const currentDeck = decksRef.current[currentIdx];
      if (!currentDeck) return;

      const seq = ++loadSeqRef.current;

      const resolvedQueue =
        nextQueueIds && nextQueueIds.length > 0
          ? nextQueueIds
          : stateRef.current.queueIds.length > 0
            ? stateRef.current.queueIds
            : tracksRef.current.map((t) => t.id);

      const track = tracksRef.current.find((t) => t.id === trackId);
      if (!track) return;

      // 1. Look up live Blob in memory first, then fall back to IndexedDB persisted audio blob
      let blob: Blob | null = fileMapRef.current.get(track.fileKey) ?? null;
      if (!blob) {
        blob = await loadAudioBlob(track.fileKey);
        if (seq !== loadSeqRef.current) return; // Superseded by another play click
        if (blob) {
          fileMapRef.current.set(track.fileKey, blob);
        }
      }

      // 2. If no local audio blob exists, fall back cleanly to embedded YouTube player if matched
      if (!blob) {
        clearAllDecks();
        if (track.youtubeVideoId) {
          beginPlaybackSession(trackId);
          setState((prev) => ({
            ...prev,
            activeTrackId: trackId,
            queueIds: resolvedQueue,
            isPlaying: true,
            currentTime: 0,
            duration: track.duration,
            playbackMode: 'youtube',
            error: null,
            needsRelink: false,
          }));
          return;
        }

        playbackSessionRef.current = null;
        setState((prev) => ({
          ...prev,
          activeTrackId: trackId,
          queueIds: resolvedQueue,
          isPlaying: false,
          currentTime: 0,
          duration: track.duration,
          playbackMode: 'none',
          error: 'Audio file not cached yet. Re-select your local file or folder to play.',
          needsRelink: true,
        }));
        return;
      }

      // 3. Decide whether to crossfade onto the alternate deck or do a direct switch
      const requestedFade = options?.crossfadeDurationSec ?? 0;
      const latestActiveIdx = activeDeckIdxRef.current;
      const outgoingDeck = decksRef.current[latestActiveIdx];
      const canCrossfade =
        requestedFade > 0.25 &&
        stateRef.current.playbackMode === 'local' &&
        Boolean(outgoingDeck) &&
        Boolean(deckUrlsRef.current[latestActiveIdx]) &&
        !outgoingDeck!.paused;

      // Ensure Web Audio ReplayGain pipeline is initialized & resumed on playback gesture
      await ensureWebAudioGraph();
      if (seq !== loadSeqRef.current) return;

      // Kick off background loudness analysis for this track (if not cached) and pre-analyze next track
      if (stateRef.current.replayGainMode !== 'off') {
        if (!loudnessCacheRef.current[track.fileKey]) {
          void ensureTrackLoudness(track, blob);
        }
        const curPos = resolvedQueue.indexOf(trackId);
        const upcomingId =
          curPos >= 0 && curPos + 1 < resolvedQueue.length ? resolvedQueue[curPos + 1] : null;
        if (upcomingId && upcomingId !== trackId) {
          const upcomingTrack = tracksRef.current.find((t) => t.id === upcomingId);
          if (upcomingTrack && !loudnessCacheRef.current[upcomingTrack.fileKey]) {
            void ensureTrackLoudness(upcomingTrack);
          }
        }
      }

      if (canCrossfade) {
        // Finish any prior crossfade before initiating a new one so the alternate deck is free
        if (crossfadeSessionRef.current) {
          cancelCrossfade({ keepIncoming: true });
        }

        const outgoingIdx = activeDeckIdxRef.current;
        const incomingIdx: 0 | 1 = outgoingIdx === 0 ? 1 : 0;
        const incomingDeck = decksRef.current[incomingIdx];
        if (!incomingDeck) return;

        clearDeck(incomingIdx);

        const typedBlob = ensureAudioBlobType(blob, track.fileName, track.format);
        const nextUrl = URL.createObjectURL(typedBlob);
        deckUrlsRef.current[incomingIdx] = nextUrl;
        deckTrackIdRef.current[incomingIdx] = trackId;
        deckFadeGainRef.current[incomingIdx] = 0;

        incomingDeck.src = nextUrl;
        syncDeckGains(false);

        activeDeckIdxRef.current = incomingIdx;
        crossfadeTriggeredRef.current = false;

        setState((prev) => ({
          ...prev,
          activeTrackId: trackId,
          queueIds: resolvedQueue,
          currentTime: 0,
          duration: track.duration,
          playbackMode: 'local',
          error: null,
          needsRelink: false,
        }));

        try {
          await incomingDeck.play();
          if (seq !== loadSeqRef.current) {
            clearDeck(incomingIdx);
            return;
          }
          beginPlaybackSession(trackId);
          setState((prev) => ({ ...prev, isPlaying: true, error: null, needsRelink: false }));
          startCrossfadeRamp(outgoingIdx, incomingIdx, requestedFade);
        } catch (err: unknown) {
          if (seq !== loadSeqRef.current) return;
          const domErr = err as { name?: string };
          if (domErr?.name === 'AbortError') return;

          clearAllDecks();

          if (track.youtubeVideoId) {
            beginPlaybackSession(trackId);
            setState((prev) => ({
              ...prev,
              isPlaying: true,
              playbackMode: 'youtube',
              error: null,
              needsRelink: false,
            }));
            return;
          }

          setState((prev) => ({
            ...prev,
            isPlaying: false,
            playbackMode: 'none',
            error:
              domErr?.name === 'NotAllowedError'
                ? 'Browser blocked autoplay — click Play again to start audio.'
                : `Your browser cannot natively decode .${track.format.toLowerCase()} audio. Match it on YouTube Music to stream it here.`,
            needsRelink: false,
          }));
        }
        return;
      }

      // Direct switch (no active local playback or crossfade disabled)
      clearAllDecks();
      const targetIdx = activeDeckIdxRef.current;
      const targetDeck = decksRef.current[targetIdx];
      if (!targetDeck) return;

      const typedBlob = ensureAudioBlobType(blob, track.fileName, track.format);
      const nextUrl = URL.createObjectURL(typedBlob);
      deckUrlsRef.current[targetIdx] = nextUrl;
      deckTrackIdRef.current[targetIdx] = trackId;
      deckFadeGainRef.current[targetIdx] = 1;

      targetDeck.src = nextUrl;
      syncDeckGains(false);
      crossfadeTriggeredRef.current = false;

      setState((prev) => ({
        ...prev,
        activeTrackId: trackId,
        queueIds: resolvedQueue,
        currentTime: 0,
        duration: track.duration,
        playbackMode: 'local',
        error: null,
        needsRelink: false,
      }));

      try {
        await targetDeck.play();
        if (seq !== loadSeqRef.current) return;
        beginPlaybackSession(trackId);
        setState((prev) => ({ ...prev, isPlaying: true, error: null, needsRelink: false }));
      } catch (err: unknown) {
        if (seq !== loadSeqRef.current) return;
        const domErr = err as { name?: string };
        if (domErr?.name === 'AbortError') return;

        if (track.youtubeVideoId) {
          clearAllDecks();
          beginPlaybackSession(trackId);
          setState((prev) => ({
            ...prev,
            isPlaying: true,
            playbackMode: 'youtube',
            error: null,
            needsRelink: false,
          }));
          return;
        }

        playbackSessionRef.current = null;
        setState((prev) => ({
          ...prev,
          isPlaying: false,
          playbackMode: 'none',
          error:
            domErr?.name === 'NotAllowedError'
              ? 'Browser blocked autoplay — click Play again to start audio.'
              : `Your browser cannot natively decode .${track.format.toLowerCase()} audio. Match it on YouTube Music to stream it here.`,
          needsRelink: false,
        }));
      }
    },
    [
      fileMapRef,
      clearAllDecks,
      clearDeck,
      cancelCrossfade,
      startCrossfadeRamp,
      beginPlaybackSession,
      ensureWebAudioGraph,
      ensureTrackLoudness,
      syncDeckGains,
    ]
  );

  const buildTrackLookup = useCallback(() => {
    const map = new Map<string, LocalTrack>();
    for (const t of tracksRef.current) map.set(t.id, t);
    return map;
  }, []);

  const orderQueueForMode = useCallback(
    (ids: string[], mode: ShuffleMode, pinFirstId?: string | null): string[] => {
      if (mode === 'smart') {
        const lookup = buildTrackLookup();
        return buildSmartShuffleOrder(
          ids,
          lookup,
          (fileKey) => fileMapRef.current.has(fileKey),
          pinFirstId
        );
      }
      if (mode === 'standard') {
        return buildStandardShuffleOrder(ids, pinFirstId);
      }
      return Array.from(new Set(ids));
    },
    [buildTrackLookup, fileMapRef]
  );

  const resolveNextTrackId = useCallback((fromAutoEnded: boolean): string | null => {
    const { activeTrackId, queueIds, repeatMode } = stateRef.current;
    const list = queueIds.length > 0 ? queueIds : tracksRef.current.map((t) => t.id);
    if (list.length === 0) return null;

    if (fromAutoEnded && repeatMode === 'one' && activeTrackId) {
      return activeTrackId;
    }

    const idx = activeTrackId ? list.indexOf(activeTrackId) : -1;
    if (idx >= 0 && idx + 1 < list.length) {
      return list[idx + 1];
    }
    if (repeatMode === 'all' || (!fromAutoEnded && list.length > 0)) {
      return list[0];
    }
    return null;
  }, []);

  const playTrack = useCallback(
    (trackId: string, queueIds?: string[]) => {
      const audio = getActiveDeck();
      if (!audio) return;

      const activeUrl = deckUrlsRef.current[activeDeckIdxRef.current];

      // Toggle play/pause if clicking currently loaded local track
      if (
        stateRef.current.activeTrackId === trackId &&
        stateRef.current.playbackMode === 'local' &&
        activeUrl
      ) {
        if (queueIds && queueIds.length > 0) {
          baseQueueIdsRef.current = queueIds;
          const ordered =
            stateRef.current.shuffleMode !== 'off'
              ? orderQueueForMode(queueIds, stateRef.current.shuffleMode, trackId)
              : queueIds;
          setState((prev) => ({ ...prev, queueIds: ordered }));
        }
        if (audio.paused) {
          void ensureWebAudioGraph().then(() =>
            audio.play().then(
              () => setState((prev) => ({ ...prev, isPlaying: true, error: null })),
              () =>
                setState((prev) => ({
                  ...prev,
                  isPlaying: false,
                  error: 'Playback was blocked by the browser.',
                }))
            )
          );
        } else {
          cancelCrossfade({ keepIncoming: true });
          audio.pause();
          setState((prev) => ({ ...prev, isPlaying: false }));
        }
        return;
      }

      // Toggle pause/resume on YouTube mode
      if (
        stateRef.current.activeTrackId === trackId &&
        stateRef.current.playbackMode === 'youtube'
      ) {
        setState((prev) => ({ ...prev, isPlaying: !prev.isPlaying }));
        return;
      }

      // Switching directly to a different track while another was loaded counts as skipping the outgoing track
      if (
        stateRef.current.activeTrackId &&
        stateRef.current.activeTrackId !== trackId &&
        stateRef.current.playbackMode !== 'none'
      ) {
        recordTrackOutcome('skipped', stateRef.current.activeTrackId);
      }

      let targetQueue = queueIds;
      if (queueIds && queueIds.length > 0) {
        baseQueueIdsRef.current = queueIds;
        if (stateRef.current.shuffleMode !== 'off') {
          targetQueue = orderQueueForMode(queueIds, stateRef.current.shuffleMode, trackId);
        }
      }

      const manualFadeSec =
        stateRef.current.crossfadeSeconds > 0 && !audio.paused
          ? Math.min(stateRef.current.crossfadeSeconds, 2.5)
          : 0;
      void loadAndPlayId(trackId, targetQueue, { crossfadeDurationSec: manualFadeSec });
    },
    [
      getActiveDeck,
      cancelCrossfade,
      loadAndPlayId,
      orderQueueForMode,
      recordTrackOutcome,
      ensureWebAudioGraph,
    ]
  );

  const playList = useCallback(
    (trackIds: string[], options?: { shuffle?: boolean | ShuffleMode }) => {
      if (trackIds.length === 0) return;

      baseQueueIdsRef.current = trackIds;

      let resolvedMode: ShuffleMode = stateRef.current.shuffleMode;
      if (options?.shuffle === 'smart') {
        resolvedMode = 'smart';
      } else if (options?.shuffle === 'standard') {
        resolvedMode = 'standard';
      } else if (options?.shuffle === 'off' || options?.shuffle === false) {
        resolvedMode = 'off';
      } else if (options?.shuffle === true) {
        resolvedMode = stateRef.current.shuffleMode === 'smart' ? 'smart' : 'standard';
      }

      const orderedQueue = orderQueueForMode(trackIds, resolvedMode);

      setState((prev) => ({
        ...prev,
        shuffleMode: resolvedMode,
        isShuffled: resolvedMode !== 'off',
        queueIds: orderedQueue,
      }));

      let startId = orderedQueue[0];
      if (resolvedMode === 'off') {
        const firstPlayable = orderedQueue.find((id) => {
          const t = tracksRef.current.find((item) => item.id === id);
          return Boolean(t && (fileMapRef.current.has(t.fileKey) || t.youtubeVideoId));
        });
        if (firstPlayable) startId = firstPlayable;
      }

      const audio = getActiveDeck();
      if (
        stateRef.current.activeTrackId &&
        stateRef.current.activeTrackId !== startId &&
        stateRef.current.playbackMode !== 'none'
      ) {
        recordTrackOutcome('skipped', stateRef.current.activeTrackId);
      }
      const manualFadeSec =
        stateRef.current.crossfadeSeconds > 0 && audio && !audio.paused
          ? Math.min(stateRef.current.crossfadeSeconds, 2.5)
          : 0;

      void loadAndPlayId(startId, orderedQueue, { crossfadeDurationSec: manualFadeSec });
    },
    [fileMapRef, getActiveDeck, loadAndPlayId, orderQueueForMode, recordTrackOutcome]
  );

  const nextTrack = useCallback(
    (fromAutoEnded = false, autoFadeDurationSec?: number) => {
      const { activeTrackId, queueIds, repeatMode, crossfadeSeconds, shuffleMode, playbackMode } =
        stateRef.current;

      // Record completion on natural end / end-of-track crossfade, or skip on manual Next
      if (activeTrackId && playbackMode !== 'none') {
        recordTrackOutcome(fromAutoEnded ? 'completed' : 'skipped', activeTrackId);
      }

      const list = queueIds.length > 0 ? queueIds : tracksRef.current.map((t) => t.id);
      if (list.length === 0) return;

      const idx = activeTrackId ? list.indexOf(activeTrackId) : -1;
      const wrappingAround =
        idx >= 0 &&
        idx + 1 >= list.length &&
        !(fromAutoEnded && repeatMode === 'one') &&
        (repeatMode === 'all' || !fromAutoEnded);

      // Re-shuffle cleanly on wrap-around in shuffle modes
      if (wrappingAround && shuffleMode !== 'off' && list.length > 1) {
        const sourceIds = baseQueueIdsRef.current.length > 0 ? baseQueueIdsRef.current : list;
        const freshOrder = orderQueueForMode(sourceIds, shuffleMode);
        // Avoid playing the exact same track twice across the loop boundary
        if (freshOrder[0] === activeTrackId && freshOrder.length > 1) {
          freshOrder.push(freshOrder.shift()!);
        }
        const audio = getActiveDeck();
        const fadeSec =
          autoFadeDurationSec !== undefined
            ? autoFadeDurationSec
            : !fromAutoEnded && crossfadeSeconds > 0 && audio && !audio.paused
              ? Math.min(crossfadeSeconds, 2.5)
              : 0;
        void loadAndPlayId(freshOrder[0], freshOrder, { crossfadeDurationSec: fadeSec });
        return;
      }

      const nextId = resolveNextTrackId(fromAutoEnded);
      if (!nextId) {
        setState((prev) => ({ ...prev, isPlaying: false }));
        return;
      }

      // If repeat-one triggered on natural end without crossfade, simply restart active deck
      if (
        fromAutoEnded &&
        repeatMode === 'one' &&
        nextId === activeTrackId &&
        !autoFadeDurationSec
      ) {
        const audio = getActiveDeck();
        if (audio && deckUrlsRef.current[activeDeckIdxRef.current]) {
          audio.currentTime = 0;
          crossfadeTriggeredRef.current = false;
          beginPlaybackSession(activeTrackId);
          audio.play().then(
            () => setState((prev) => ({ ...prev, isPlaying: true, currentTime: 0 })),
            () => {}
          );
          return;
        }
      }

      const audio = getActiveDeck();
      const fadeSec =
        autoFadeDurationSec !== undefined
          ? autoFadeDurationSec
          : !fromAutoEnded && crossfadeSeconds > 0 && audio && !audio.paused
            ? Math.min(crossfadeSeconds, 2.5)
            : 0;

      void loadAndPlayId(nextId, list, { crossfadeDurationSec: fadeSec });
    },
    [
      resolveNextTrackId,
      getActiveDeck,
      loadAndPlayId,
      orderQueueForMode,
      recordTrackOutcome,
      beginPlaybackSession,
    ]
  );

  const prevTrack = useCallback(() => {
    const audio = getActiveDeck();
    const { activeTrackId, queueIds, repeatMode, currentTime, crossfadeSeconds } = stateRef.current;

    if (audio && deckUrlsRef.current[activeDeckIdxRef.current] && currentTime > 3) {
      cancelCrossfade({ keepIncoming: true });
      audio.currentTime = 0;
      crossfadeTriggeredRef.current = false;
      setState((prev) => ({ ...prev, currentTime: 0 }));
      return;
    }

    const list = queueIds.length > 0 ? queueIds : tracksRef.current.map((t) => t.id);
    if (list.length === 0) return;

    const idx = activeTrackId ? list.indexOf(activeTrackId) : -1;
    let targetId: string | null = null;
    if (idx > 0) {
      targetId = list[idx - 1];
    } else if (repeatMode === 'all' || list.length > 0) {
      targetId = list[list.length - 1];
    }

    if (!targetId) return;

    if (activeTrackId && targetId !== activeTrackId && stateRef.current.playbackMode !== 'none') {
      recordTrackOutcome('skipped', activeTrackId);
    }

    const manualFadeSec =
      crossfadeSeconds > 0 && audio && !audio.paused ? Math.min(crossfadeSeconds, 2.5) : 0;
    void loadAndPlayId(targetId, list, { crossfadeDurationSec: manualFadeSec });
  }, [getActiveDeck, cancelCrossfade, loadAndPlayId, recordTrackOutcome]);

  const togglePlay = useCallback(() => {
    const audio = getActiveDeck();
    if (!audio) return;

    const { activeTrackId, queueIds, playbackMode } = stateRef.current;

    if (activeTrackId && playbackMode === 'youtube') {
      setState((prev) => ({ ...prev, isPlaying: !prev.isPlaying }));
      return;
    }

    if (!activeTrackId || !deckUrlsRef.current[activeDeckIdxRef.current]) {
      if (activeTrackId) {
        void loadAndPlayId(activeTrackId, queueIds);
        return;
      }
      const pool = queueIds.length > 0 ? queueIds : tracksRef.current.map((t) => t.id);
      if (pool.length > 0) {
        playList(pool);
      }
      return;
    }

    if (audio.paused) {
      void ensureWebAudioGraph().then(() =>
        audio.play().then(
          () => setState((prev) => ({ ...prev, isPlaying: true, error: null })),
          () => {}
        )
      );
    } else {
      cancelCrossfade({ keepIncoming: true });
      audio.pause();
      setState((prev) => ({ ...prev, isPlaying: false }));
    }
  }, [getActiveDeck, cancelCrossfade, loadAndPlayId, playList, ensureWebAudioGraph]);

  const seek = useCallback(
    (seconds: number) => {
      const audio = getActiveDeck();
      if (!audio || stateRef.current.playbackMode !== 'local') return;

      cancelCrossfade({ keepIncoming: true });

      const maxDur = Number.isFinite(audio.duration) ? audio.duration : stateRef.current.duration;
      const clamped = Math.max(0, Math.min(maxDur || seconds, seconds));
      audio.currentTime = clamped;

      // Re-arm automatic end-of-track crossfade if user sought back before the fade window
      if (maxDur > 0 && maxDur - clamped > stateRef.current.crossfadeSeconds + 0.5) {
        crossfadeTriggeredRef.current = false;
      }

      setState((prev) => ({ ...prev, currentTime: clamped }));
    },
    [getActiveDeck, cancelCrossfade]
  );

  const applyMasterVolumeToDecks = useCallback(
    (masterVol: number, muted: boolean) => {
      stateRef.current = {
        ...stateRef.current,
        volume: clampVolume(masterVol),
        isMuted: muted,
      };
      syncDeckGains(true);
    },
    [syncDeckGains]
  );

  const setVolume = useCallback(
    (vol: number) => {
      const clamped = clampVolume(vol);
      if (clamped > 0) {
        lastNonZeroVolumeRef.current = clamped;
      }
      applyMasterVolumeToDecks(clamped, clamped === 0);
      setState((prev) => ({
        ...prev,
        volume: clamped,
        isMuted: clamped === 0,
      }));
    },
    [applyMasterVolumeToDecks]
  );

  const toggleMute = useCallback(() => {
    const currentlyMuted = stateRef.current.isMuted || stateRef.current.volume === 0;
    const nextVol = currentlyMuted ? lastNonZeroVolumeRef.current || 0.85 : 0;
    const nextMuted = !currentlyMuted;
    applyMasterVolumeToDecks(nextVol, nextMuted);
    setState((prev) => ({
      ...prev,
      isMuted: nextMuted,
      volume: nextVol,
    }));
  }, [applyMasterVolumeToDecks]);

  // ReplayGain controls
  const setReplayGainMode = useCallback((mode: ReplayGainMode) => {
    setState((prev) => ({ ...prev, replayGainMode: mode }));
  }, []);

  const cycleReplayGainMode = useCallback(() => {
    setState((prev) => {
      const next: ReplayGainMode =
        prev.replayGainMode === 'off'
          ? 'track'
          : prev.replayGainMode === 'track'
            ? 'album'
            : 'off';
      return { ...prev, replayGainMode: next };
    });
  }, []);

  const setReplayGainTargetLufs = useCallback((targetLufs: ReplayGainTargetLufs) => {
    setState((prev) => ({ ...prev, replayGainTargetLufs: targetLufs }));
  }, []);

  const setReplayGainPreampDb = useCallback((db: number) => {
    const snapped = Math.max(-6, Math.min(6, Math.round(db * 2) / 2));
    setState((prev) => ({ ...prev, replayGainPreampDb: snapped }));
  }, []);

  const setReplayGainPreventClipping = useCallback((enabled: boolean) => {
    setState((prev) => ({ ...prev, replayGainPreventClipping: enabled }));
  }, []);

  const cancelLibraryLoudnessScan = useCallback(() => {
    scanCancelledRef.current = true;
  }, []);

  const analyzeLibraryLoudness = useCallback(async () => {
    if (loudnessScanProgress) return;
    scanCancelledRef.current = false;

    const pendingTracks = tracksRef.current.filter(
      (t) => !t.isMissingOnDevice && !loudnessCacheRef.current[t.fileKey]
    );
    if (pendingTracks.length === 0) return;

    setLoudnessScanProgress({ processed: 0, total: pendingTracks.length });

    let processed = 0;
    for (const track of pendingTracks) {
      if (scanCancelledRef.current) break;

      setLoudnessScanProgress({
        processed,
        total: pendingTracks.length,
        currentTitle: track.title,
      });

      await ensureTrackLoudness(track);
      processed += 1;

      setLoudnessScanProgress({
        processed,
        total: pendingTracks.length,
        currentTitle: track.title,
      });

      // Yield briefly to keep UI responsive during batch decoding
      await new Promise((resolve) => window.setTimeout(resolve, 24));
    }

    setLoudnessScanProgress(null);
  }, [loudnessScanProgress, ensureTrackLoudness]);

  const clearLoudnessCache = useCallback(() => {
    setLoudnessCache({});
  }, []);

  const setCrossfadeSeconds = useCallback((seconds: number) => {
    const clamped = Math.max(0, Math.min(12, Math.round(seconds)));
    try {
      window.localStorage.setItem(CROSSFADE_STORAGE_KEY, String(clamped));
    } catch {
      // Ignore storage write errors
    }
    setState((prev) => ({ ...prev, crossfadeSeconds: clamped }));
  }, []);

  const cycleCrossfade = useCallback(() => {
    const current = stateRef.current.crossfadeSeconds;
    const idx = CROSSFADE_PRESETS.findIndex((preset) => preset === current);
    const next =
      idx >= 0 ? CROSSFADE_PRESETS[(idx + 1) % CROSSFADE_PRESETS.length] : CROSSFADE_PRESETS[0];
    setCrossfadeSeconds(next);
  }, [setCrossfadeSeconds]);

  const setShuffleMode = useCallback(
    (nextMode: ShuffleMode) => {
      setState((prev) => {
        const currentPool =
          baseQueueIdsRef.current.length > 0
            ? baseQueueIdsRef.current
            : prev.queueIds.length > 0
              ? prev.queueIds
              : tracksRef.current.map((t) => t.id);

        if (baseQueueIdsRef.current.length === 0 && currentPool.length > 0) {
          baseQueueIdsRef.current = currentPool;
        }

        const nextQueue =
          nextMode === 'off'
            ? currentPool
            : orderQueueForMode(currentPool, nextMode, prev.activeTrackId);

        return {
          ...prev,
          shuffleMode: nextMode,
          isShuffled: nextMode !== 'off',
          queueIds: nextQueue,
        };
      });
    },
    [orderQueueForMode]
  );

  const cycleShuffleMode = useCallback(() => {
    const current = stateRef.current.shuffleMode;
    const next: ShuffleMode =
      current === 'off' ? 'smart' : current === 'smart' ? 'standard' : 'off';
    setShuffleMode(next);
  }, [setShuffleMode]);

  const cycleRepeatMode = useCallback(() => {
    setState((prev) => {
      const next: RepeatMode =
        prev.repeatMode === 'off' ? 'all' : prev.repeatMode === 'all' ? 'one' : 'off';
      return { ...prev, repeatMode: next };
    });
  }, []);

  const stop = useCallback(() => {
    loadSeqRef.current++;
    clearAllDecks();
    setState((prev) => ({
      ...prev,
      activeTrackId: null,
      isPlaying: false,
      isCrossfading: false,
      currentTime: 0,
      duration: 0,
      playbackMode: 'none',
      error: null,
      needsRelink: false,
    }));
  }, [clearAllDecks]);

  const nextTrackRef = useRef(nextTrack);
  useEffect(() => {
    nextTrackRef.current = nextTrack;
  }, [nextTrack]);

  const resolveNextTrackIdRef = useRef(resolveNextTrackId);
  useEffect(() => {
    resolveNextTrackIdRef.current = resolveNextTrackId;
  }, [resolveNextTrackId]);

  // Wire dual HTML5 Audio decks for overlapping crossfade transitions
  useEffect(() => {
    const deckA = new Audio();
    const deckB = new Audio();
    deckA.preload = 'auto';
    deckB.preload = 'auto';
    deckA.volume = 0.85;
    deckB.volume = 0.85;
    decksRef.current = [deckA, deckB];

    const makeHandlers = (deckIdx: 0 | 1, audio: HTMLAudioElement) => {
      const onTimeUpdate = () => {
        if (deckIdx !== activeDeckIdxRef.current) return;

        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        const currentTime = audio.currentTime;

        if (
          playbackSessionRef.current &&
          playbackSessionRef.current.trackId === stateRef.current.activeTrackId &&
          currentTime > playbackSessionRef.current.maxObservedTime
        ) {
          playbackSessionRef.current.maxObservedTime = currentTime;
        }

        setState((prev) => ({
          ...prev,
          currentTime,
          duration: duration || prev.duration,
        }));

        // Automatic end-of-track playlist crossfade trigger
        const fadeSec = stateRef.current.crossfadeSeconds;
        if (
          fadeSec > 0 &&
          !audio.paused &&
          !crossfadeTriggeredRef.current &&
          duration > fadeSec + 1.5
        ) {
          const remaining = duration - currentTime;
          if (remaining > 0.25 && remaining <= fadeSec) {
            const upcomingId = resolveNextTrackIdRef.current(true);
            if (upcomingId) {
              crossfadeTriggeredRef.current = true;
              const effectiveFade = Math.min(fadeSec, Math.max(0.5, remaining));
              nextTrackRef.current(true, effectiveFade);
            }
          }
        }
      };

      const onLoadedMetadata = () => {
        if (deckIdx !== activeDeckIdxRef.current) return;
        setState((prev) => ({
          ...prev,
          duration: Number.isFinite(audio.duration) ? audio.duration : prev.duration,
        }));
      };

      const onEnded = () => {
        // Ignore natural end on outgoing deck that has already handed off via crossfade
        if (deckIdx !== activeDeckIdxRef.current) return;
        if (crossfadeTriggeredRef.current) return;
        nextTrackRef.current(true);
      };

      const onError = () => {
        if (deckIdx !== activeDeckIdxRef.current) return;
        if (!audio.getAttribute('src')) return;

        const activeId = stateRef.current.activeTrackId;
        const activeTrack = tracksRef.current.find((t) => t.id === activeId);
        if (activeTrack?.youtubeVideoId) {
          clearAllDecks();
          setState((prev) => ({
            ...prev,
            isPlaying: true,
            playbackMode: 'youtube',
            error: null,
            needsRelink: false,
          }));
          return;
        }

        setState((prev) => ({
          ...prev,
          isPlaying: false,
          playbackMode: 'none',
          error: activeTrack
            ? `Cannot decode ${activeTrack.format} in this browser. Match it on YouTube Music to stream.`
            : 'Unable to play this audio file in the browser.',
        }));
      };

      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('loadedmetadata', onLoadedMetadata);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);

      return () => {
        audio.pause();
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
      };
    };

    const cleanupA = makeHandlers(0, deckA);
    const cleanupB = makeHandlers(1, deckB);

    return () => {
      scanCancelledRef.current = true;
      if (crossfadeSessionRef.current) {
        window.clearInterval(crossfadeSessionRef.current.timerId);
        crossfadeSessionRef.current = null;
      }
      cleanupA();
      cleanupB();
      if (deckUrlsRef.current[0]) {
        URL.revokeObjectURL(deckUrlsRef.current[0]);
        deckUrlsRef.current[0] = null;
      }
      if (deckUrlsRef.current[1]) {
        URL.revokeObjectURL(deckUrlsRef.current[1]);
        deckUrlsRef.current[1] = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [clearAllDecks]);

  // Spacebar shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        tag === 'BUTTON' ||
        tag === 'A' ||
        target.isContentEditable
      ) {
        return;
      }
      if (tracksRef.current.length === 0) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay]);

  const getTrackPlayCount = useCallback(
    (trackId: string): number => {
      const stats = playStats[trackId];
      if (stats) return stats.playCount;
      const track = tracksRef.current.find((t) => t.id === trackId);
      return track?.playCount ?? 0;
    },
    [playStats]
  );

  const totalPlays = useMemo(
    () => Object.values(playStats).reduce((sum, entry) => sum + entry.playCount, 0),
    [playStats]
  );

  const clearPlayHistory = useCallback(() => {
    setPlayHistory([]);
  }, []);

  const resetPlayStats = useCallback(() => {
    setPlayStats({});
    setPlayHistory([]);
  }, []);

  const activeTrack = tracks.find((t) => t.id === state.activeTrackId) ?? null;

  const activeTrackReplayGain = useMemo<AppliedReplayGainInfo | null>(() => {
    if (!activeTrack) return null;
    return computeReplayGainAdjustment({
      trackKey: activeTrack.fileKey,
      trackAlbum: activeTrack.album,
      cache: loudnessCache,
      mode: state.replayGainMode,
      targetLufs: state.replayGainTargetLufs,
      preampDb: state.replayGainPreampDb,
      preventClipping: state.replayGainPreventClipping,
      libraryAlbumLookup,
    });
  }, [
    activeTrack,
    loudnessCache,
    state.replayGainMode,
    state.replayGainTargetLufs,
    state.replayGainPreampDb,
    state.replayGainPreventClipping,
    libraryAlbumLookup,
  ]);

  const analyzedTrackCount = useMemo(
    () => tracks.reduce((count, t) => count + (loudnessCache[t.fileKey] ? 1 : 0), 0),
    [tracks, loudnessCache]
  );

  return {
    state,
    activeTrack,
    activeTrackReplayGain,
    loudnessCache,
    analyzedTrackCount,
    loudnessScanProgress,
    playStats,
    playHistory,
    totalPlays,
    getTrackPlayCount,
    clearPlayHistory,
    resetPlayStats,
    playTrack,
    playList,
    togglePlay,
    nextTrack: () => nextTrack(false),
    prevTrack,
    seek,
    setVolume,
    toggleMute,
    setCrossfadeSeconds,
    cycleCrossfade,
    setReplayGainMode,
    cycleReplayGainMode,
    setReplayGainTargetLufs,
    setReplayGainPreampDb,
    setReplayGainPreventClipping,
    analyzeLibraryLoudness,
    cancelLibraryLoudnessScan,
    clearLoudnessCache,
    setShuffleMode,
    cycleShuffleMode,
    toggleShuffle: cycleShuffleMode,
    cycleRepeatMode,
    stop,
  };
}
