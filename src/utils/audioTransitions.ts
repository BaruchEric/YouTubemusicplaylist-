import type { LocalTrack } from '../types/music';

export type CrossfadeCurve = 'equal-power' | 'smooth-s' | 'linear';

export interface PlaybackTransitionSettings {
  crossfadeSeconds: number;
  crossfadeCurve: CrossfadeCurve;
  manualSkipCrossfade: boolean;
  gaplessPlayback: boolean;
  gaplessAlbumContinuity: boolean;
}

export const CROSSFADE_PRESETS = [0, 2, 4, 6, 8, 12] as const;

export const DEFAULT_TRANSITION_SETTINGS: PlaybackTransitionSettings = {
  crossfadeSeconds: 4,
  crossfadeCurve: 'equal-power',
  manualSkipCrossfade: true,
  gaplessPlayback: true,
  gaplessAlbumContinuity: true,
};

const TRANSITION_STORAGE_KEY = 'cratesync_transition_settings_v1';
const LEGACY_CROSSFADE_STORAGE_KEY = 'cratesync_crossfade_sec';

export function clampCrossfadeSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_TRANSITION_SETTINGS.crossfadeSeconds;
  const clamped = Math.max(0, Math.min(12, seconds));
  return Math.round(clamped * 2) / 2; // 0.5s precision
}

export function loadTransitionSettings(): PlaybackTransitionSettings {
  try {
    const raw = window.localStorage.getItem(TRANSITION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PlaybackTransitionSettings>;
      const curve: CrossfadeCurve =
        parsed.crossfadeCurve === 'linear' ||
        parsed.crossfadeCurve === 'smooth-s' ||
        parsed.crossfadeCurve === 'equal-power'
          ? parsed.crossfadeCurve
          : DEFAULT_TRANSITION_SETTINGS.crossfadeCurve;

      return {
        crossfadeSeconds:
          typeof parsed.crossfadeSeconds === 'number'
            ? clampCrossfadeSeconds(parsed.crossfadeSeconds)
            : DEFAULT_TRANSITION_SETTINGS.crossfadeSeconds,
        crossfadeCurve: curve,
        manualSkipCrossfade:
          typeof parsed.manualSkipCrossfade === 'boolean'
            ? parsed.manualSkipCrossfade
            : DEFAULT_TRANSITION_SETTINGS.manualSkipCrossfade,
        gaplessPlayback:
          typeof parsed.gaplessPlayback === 'boolean'
            ? parsed.gaplessPlayback
            : DEFAULT_TRANSITION_SETTINGS.gaplessPlayback,
        gaplessAlbumContinuity:
          typeof parsed.gaplessAlbumContinuity === 'boolean'
            ? parsed.gaplessAlbumContinuity
            : DEFAULT_TRANSITION_SETTINGS.gaplessAlbumContinuity,
      };
    }

    // Migrate legacy crossfade setting if present
    const legacy = window.localStorage.getItem(LEGACY_CROSSFADE_STORAGE_KEY);
    if (legacy !== null) {
      const parsedSec = Number(legacy);
      if (Number.isFinite(parsedSec)) {
        return {
          ...DEFAULT_TRANSITION_SETTINGS,
          crossfadeSeconds: clampCrossfadeSeconds(parsedSec),
        };
      }
    }
  } catch {
    // Ignore storage read errors in restricted iframe contexts
  }

  return { ...DEFAULT_TRANSITION_SETTINGS };
}

export function saveTransitionSettings(settings: PlaybackTransitionSettings): void {
  try {
    window.localStorage.setItem(TRANSITION_STORAGE_KEY, JSON.stringify(settings));
    window.localStorage.setItem(LEGACY_CROSSFADE_STORAGE_KEY, String(settings.crossfadeSeconds));
  } catch {
    // Ignore storage write errors
  }
}

/**
 * Computes outgoing & incoming normalized gain multipliers [0..1] for progress t in [0..1].
 */
export function evaluateCrossfadeCurve(
  progress: number,
  curve: CrossfadeCurve
): { outgoing: number; incoming: number } {
  const t = Math.max(0, Math.min(1, progress));
  switch (curve) {
    case 'linear':
      return {
        outgoing: 1 - t,
        incoming: t,
      };
    case 'smooth-s': {
      // Smoothstep S-curve for gentle start/end with focused mid-point handoff
      const s = t * t * (3 - 2 * t);
      return {
        outgoing: 1 - s,
        incoming: s,
      };
    }
    case 'equal-power':
    default:
      // Constant perceived power curve avoids mid-fade volume dip
      return {
        outgoing: Math.cos(t * Math.PI * 0.5),
        incoming: Math.sin(t * Math.PI * 0.5),
      };
  }
}

/**
 * Determines whether two adjacent tracks belong to the same album in sequential playback,
 * where audiophile gapless continuity should supersede crossfading.
 */
export function isConsecutiveSameAlbumPair(
  currentTrack: LocalTrack | null | undefined,
  nextTrack: LocalTrack | null | undefined,
  isShuffled: boolean
): boolean {
  if (isShuffled || !currentTrack || !nextTrack) return false;
  if (currentTrack.id === nextTrack.id) return false;

  const albumA = (currentTrack.album || '').trim().toLowerCase();
  const albumB = (nextTrack.album || '').trim().toLowerCase();
  if (!albumA || !albumB || albumA === 'unknown album' || albumB === 'unknown album') {
    return false;
  }
  if (albumA !== albumB) return false;

  // If both tracks carry track numbers, confirm they are sequential (or same disc progression)
  if (
    typeof currentTrack.trackNumber === 'number' &&
    typeof nextTrack.trackNumber === 'number' &&
    currentTrack.trackNumber > 0 &&
    nextTrack.trackNumber > 0
  ) {
    return nextTrack.trackNumber === currentTrack.trackNumber + 1;
  }

  return true;
}

export function describeUpcomingTransition(params: {
  currentTrack: LocalTrack | null;
  nextTrack: LocalTrack | null;
  isShuffled: boolean;
  settings: PlaybackTransitionSettings;
}): {
  mode: 'gapless-album' | 'gapless' | 'crossfade' | 'direct';
  label: string;
} {
  const { currentTrack, nextTrack, isShuffled, settings } = params;

  const albumContinuous =
    settings.gaplessPlayback &&
    settings.gaplessAlbumContinuity &&
    isConsecutiveSameAlbumPair(currentTrack, nextTrack, isShuffled);

  if (albumContinuous) {
    return {
      mode: 'gapless-album',
      label: 'Gapless (same album)',
    };
  }

  if (settings.crossfadeSeconds > 0) {
    const curveName =
      settings.crossfadeCurve === 'equal-power'
        ? 'Equal Power'
        : settings.crossfadeCurve === 'smooth-s'
          ? 'Smooth S'
          : 'Linear';
    const secLabel = Number.isInteger(settings.crossfadeSeconds)
      ? `${settings.crossfadeSeconds}s`
      : `${settings.crossfadeSeconds.toFixed(1)}s`;
    return {
      mode: 'crossfade',
      label: `${secLabel} ${curveName}`,
    };
  }

  if (settings.gaplessPlayback) {
    return {
      mode: 'gapless',
      label: 'Gapless handoff',
    };
  }

  return {
    mode: 'direct',
    label: 'Standard cut',
  };
}
