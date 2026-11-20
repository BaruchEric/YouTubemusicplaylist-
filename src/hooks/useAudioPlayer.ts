import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalTrack } from '../types/music';
import { loadAudioBlob } from '../utils/storage';

export type RepeatMode = 'off' | 'all' | 'one';

export const CROSSFADE_PRESETS = [0, 2, 4, 6, 8] as const;
const CROSSFADE_STORAGE_KEY = 'cratesync_crossfade_sec';
const DEFAULT_CROSSFADE_SECONDS = 4;

export interface AudioPlayerState {
  activeTrackId: string | null;
  queueIds: string[];
  isPlaying: boolean;
  isShuffled: boolean;
  repeatMode: RepeatMode;
  isMuted: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  crossfadeSeconds: number;
  isCrossfading: boolean;
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

export function useAudioPlayer(
  tracks: LocalTrack[],
  fileMapRef: React.MutableRefObject<Map<string, Blob>>
) {
  // Dual-deck HTML5 Audio elements for seamless overlapping crossfades
  const decksRef = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);
  const deckUrlsRef = useRef<[string | null, string | null]>([null, null]);
  const activeDeckIdxRef = useRef<0 | 1>(0);
  const crossfadeSessionRef = useRef<CrossfadeSession | null>(null);
  const crossfadeTriggeredRef = useRef<boolean>(false);

  const lastNonZeroVolumeRef = useRef<number>(0.85);
  const loadSeqRef = useRef<number>(0);

  const [state, setState] = useState<AudioPlayerState>(() => ({
    activeTrackId: null,
    queueIds: [],
    isPlaying: false,
    isShuffled: false,
    repeatMode: 'off',
    isMuted: false,
    currentTime: 0,
    duration: 0,
    volume: 0.85,
    crossfadeSeconds: readSavedCrossfadeSeconds(),
    isCrossfading: false,
    playbackMode: 'none',
    error: null,
    needsRelink: false,
  }));

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const tracksRef = useRef(tracks);
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  const getActiveDeck = useCallback((): HTMLAudioElement | null => {
    return decksRef.current[activeDeckIdxRef.current];
  }, []);

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
  }, []);

  const cancelCrossfade = useCallback(
    (options?: { keepIncoming?: boolean }) => {
      const session = crossfadeSessionRef.current;
      if (!session) return;

      window.clearInterval(session.timerId);
      crossfadeSessionRef.current = null;

      clearDeck(session.outgoingIdx);

      if (options?.keepIncoming) {
        const incoming = decksRef.current[session.incomingIdx];
        if (incoming) {
          const masterVol = stateRef.current.isMuted ? 0 : stateRef.current.volume;
          incoming.volume = clampVolume(masterVol);
          incoming.muted = stateRef.current.isMuted;
        }
      }

      setState((prev) => (prev.isCrossfading ? { ...prev, isCrossfading: false } : prev));
    },
    [clearDeck]
  );

  const clearAllDecks = useCallback(() => {
    cancelCrossfade({ keepIncoming: false });
    clearDeck(0);
    clearDeck(1);
    crossfadeTriggeredRef.current = false;
  }, [cancelCrossfade, clearDeck]);

  /**
   * Starts an equal-power crossfade between outgoingIdx and incomingIdx.
   * Uses a 40ms interval so transitions complete smoothly even in background tabs.
   */
  const startCrossfadeRamp = useCallback(
    (outgoingIdx: 0 | 1, incomingIdx: 0 | 1, durationSec: number) => {
      const durationMs = Math.max(250, Math.round(durationSec * 1000));
      const startTime = performance.now();

      const applyGains = (progress: number) => {
        const clamped = Math.max(0, Math.min(1, progress));
        const masterVol = stateRef.current.isMuted ? 0 : stateRef.current.volume;
        const outgoing = decksRef.current[outgoingIdx];
        const incoming = decksRef.current[incomingIdx];

        // Equal-power curve avoids the perceived volume dip of linear crossfades
        const outGain = Math.cos(clamped * Math.PI * 0.5);
        const inGain = Math.sin(clamped * Math.PI * 0.5);

        if (outgoing) {
          outgoing.volume = clampVolume(masterVol * outGain);
          outgoing.muted = stateRef.current.isMuted;
        }
        if (incoming) {
          incoming.volume = clampVolume(masterVol * inGain);
          incoming.muted = stateRef.current.isMuted;
        }
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
          const incoming = decksRef.current[incomingIdx];
          if (incoming) {
            const masterVol = stateRef.current.isMuted ? 0 : stateRef.current.volume;
            incoming.volume = clampVolume(masterVol);
          }
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
    [clearDeck]
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

        incomingDeck.src = nextUrl;
        incomingDeck.volume = 0;
        incomingDeck.muted = stateRef.current.isMuted;

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
          setState((prev) => ({ ...prev, isPlaying: true, error: null, needsRelink: false }));
          startCrossfadeRamp(outgoingIdx, incomingIdx, requestedFade);
        } catch (err: unknown) {
          if (seq !== loadSeqRef.current) return;
          const domErr = err as { name?: string };
          if (domErr?.name === 'AbortError') return;

          clearAllDecks();

          if (track.youtubeVideoId) {
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

      targetDeck.src = nextUrl;
      targetDeck.volume = clampVolume(stateRef.current.isMuted ? 0 : stateRef.current.volume);
      targetDeck.muted = stateRef.current.isMuted;
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
        setState((prev) => ({ ...prev, isPlaying: true, error: null, needsRelink: false }));
      } catch (err: unknown) {
        if (seq !== loadSeqRef.current) return;
        const domErr = err as { name?: string };
        if (domErr?.name === 'AbortError') return;

        if (track.youtubeVideoId) {
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
          error:
            domErr?.name === 'NotAllowedError'
              ? 'Browser blocked autoplay — click Play again to start audio.'
              : `Your browser cannot natively decode .${track.format.toLowerCase()} audio. Match it on YouTube Music to stream it here.`,
          needsRelink: false,
        }));
      }
    },
    [fileMapRef, clearAllDecks, clearDeck, cancelCrossfade, startCrossfadeRamp]
  );

  const resolveNextTrackId = useCallback((fromAutoEnded: boolean): string | null => {
    const { activeTrackId, queueIds, isShuffled, repeatMode } = stateRef.current;
    const list = queueIds.length > 0 ? queueIds : tracksRef.current.map((t) => t.id);
    if (list.length === 0) return null;

    if (fromAutoEnded && repeatMode === 'one' && activeTrackId) {
      return activeTrackId;
    }

    if (isShuffled && list.length > 1) {
      const others = list.filter((id) => id !== activeTrackId);
      return others[Math.floor(Math.random() * others.length)] ?? null;
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
          setState((prev) => ({ ...prev, queueIds }));
        }
        if (audio.paused) {
          audio.play().then(
            () => setState((prev) => ({ ...prev, isPlaying: true, error: null })),
            () =>
              setState((prev) => ({
                ...prev,
                isPlaying: false,
                error: 'Playback was blocked by the browser.',
              }))
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

      const manualFadeSec =
        stateRef.current.crossfadeSeconds > 0 && !audio.paused
          ? Math.min(stateRef.current.crossfadeSeconds, 2.5)
          : 0;
      void loadAndPlayId(trackId, queueIds, { crossfadeDurationSec: manualFadeSec });
    },
    [getActiveDeck, cancelCrossfade, loadAndPlayId]
  );

  const playList = useCallback(
    (trackIds: string[], options?: { shuffle?: boolean }) => {
      if (trackIds.length === 0) return;

      const playableIds = trackIds.filter((id) => {
        const t = tracksRef.current.find((item) => item.id === id);
        return Boolean(t && (fileMapRef.current.has(t.fileKey) || t.youtubeVideoId));
      });
      const candidatePool = playableIds.length > 0 ? playableIds : trackIds;

      const shouldShuffle = options?.shuffle ?? stateRef.current.isShuffled;
      if (options?.shuffle !== undefined) {
        setState((prev) => ({ ...prev, isShuffled: shouldShuffle }));
      }

      const startId = shouldShuffle
        ? candidatePool[Math.floor(Math.random() * candidatePool.length)]
        : candidatePool[0];

      const audio = getActiveDeck();
      const manualFadeSec =
        stateRef.current.crossfadeSeconds > 0 && audio && !audio.paused
          ? Math.min(stateRef.current.crossfadeSeconds, 2.5)
          : 0;

      void loadAndPlayId(startId, trackIds, { crossfadeDurationSec: manualFadeSec });
    },
    [fileMapRef, getActiveDeck, loadAndPlayId]
  );

  const nextTrack = useCallback(
    (fromAutoEnded = false, autoFadeDurationSec?: number) => {
      const { activeTrackId, queueIds, repeatMode, crossfadeSeconds } = stateRef.current;
      const list = queueIds.length > 0 ? queueIds : tracksRef.current.map((t) => t.id);
      if (list.length === 0) return;

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
    [resolveNextTrackId, getActiveDeck, loadAndPlayId]
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

    const manualFadeSec =
      crossfadeSeconds > 0 && audio && !audio.paused ? Math.min(crossfadeSeconds, 2.5) : 0;
    void loadAndPlayId(targetId, list, { crossfadeDurationSec: manualFadeSec });
  }, [getActiveDeck, cancelCrossfade, loadAndPlayId]);

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
      audio.play().then(
        () => setState((prev) => ({ ...prev, isPlaying: true, error: null })),
        () => {}
      );
    } else {
      cancelCrossfade({ keepIncoming: true });
      audio.pause();
      setState((prev) => ({ ...prev, isPlaying: false }));
    }
  }, [getActiveDeck, cancelCrossfade, loadAndPlayId, playList]);

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

  const applyMasterVolumeToDecks = useCallback((masterVol: number, muted: boolean) => {
    const effective = muted ? 0 : clampVolume(masterVol);
    const session = crossfadeSessionRef.current;

    if (session) {
      const p = Math.max(0, Math.min(1, session.progress));
      const outgoing = decksRef.current[session.outgoingIdx];
      const incoming = decksRef.current[session.incomingIdx];
      if (outgoing) {
        outgoing.volume = clampVolume(effective * Math.cos(p * Math.PI * 0.5));
        outgoing.muted = muted;
      }
      if (incoming) {
        incoming.volume = clampVolume(effective * Math.sin(p * Math.PI * 0.5));
        incoming.muted = muted;
      }
    } else {
      const active = decksRef.current[activeDeckIdxRef.current];
      if (active) {
        active.volume = effective;
        active.muted = muted;
      }
    }
  }, []);

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

  const toggleShuffle = useCallback(() => {
    setState((prev) => ({ ...prev, isShuffled: !prev.isShuffled }));
  }, []);

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

  const activeTrack = tracks.find((t) => t.id === state.activeTrackId) ?? null;

  return {
    state,
    activeTrack,
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
    toggleShuffle,
    cycleRepeatMode,
    stop,
  };
}
