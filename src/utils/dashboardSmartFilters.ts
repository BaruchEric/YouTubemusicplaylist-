import type { LocalTrack, TrackPlayStats } from '../types/music';
import { cleanRawGenreTag, type InferredGenreResult } from './genreInference';

export type QuickCriterionId =
  | 'no-genre'
  | 'missing-year'
  | 'longer-than-10m'
  | 'no-artwork'
  | 'unmatched'
  | 'never-played'
  | 'lossless'
  | 'missing-file';

export type SmartFilterMatchMode = 'all' | 'any';

export type CustomFilterField =
  | 'genre'
  | 'year'
  | 'durationMin'
  | 'artist'
  | 'album'
  | 'format'
  | 'playCount'
  | 'hasArtwork'
  | 'matchStatus'
  | 'missingOnDevice';

export type CustomFilterOperator =
  | 'is_empty'
  | 'is_not_empty'
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'is_true'
  | 'is_false';

export interface CustomFilterRule {
  id: string;
  field: CustomFilterField;
  operator: CustomFilterOperator;
  value: string;
}

export interface SavedDashboardSmartFilter {
  id: string;
  name: string;
  matchMode: SmartFilterMatchMode;
  quickIds: QuickCriterionId[];
  rules: CustomFilterRule[];
  createdAt: number;
}

export interface QuickCriterionDefinition {
  id: QuickCriterionId;
  label: string;
  shortDescription: string;
  hideWhenZero?: boolean;
}

export const QUICK_CRITERIA: QuickCriterionDefinition[] = [
  {
    id: 'no-genre',
    label: 'No Genre',
    shortDescription: 'Tracks without an embedded genre tag or still unclassified',
  },
  {
    id: 'missing-year',
    label: 'Missing Year',
    shortDescription: 'Tracks missing a valid 4-digit release year tag',
  },
  {
    id: 'longer-than-10m',
    label: 'Longer than 10m',
    shortDescription: 'Extended tracks, DJ mixes, or podcasts ≥ 10 minutes',
  },
  {
    id: 'no-artwork',
    label: 'No Cover Art',
    shortDescription: 'Tracks missing embedded or fetched album artwork',
  },
  {
    id: 'unmatched',
    label: 'Unmatched',
    shortDescription: 'Tracks not yet linked to a YouTube Music video ID',
  },
  {
    id: 'never-played',
    label: 'Never Played',
    shortDescription: 'Library tracks with zero recorded plays',
  },
  {
    id: 'lossless',
    label: 'Lossless',
    shortDescription: 'FLAC, WAV, AIFF, or ALAC uncompressed/lossless audio',
  },
  {
    id: 'missing-file',
    label: 'Missing Files',
    shortDescription: 'Tracks no longer found in the watched local folder',
    hideWhenZero: true,
  },
];

export interface CustomFieldMeta {
  field: CustomFilterField;
  label: string;
  operators: Array<{ op: CustomFilterOperator; label: string; needsValue: boolean }>;
  placeholder: string;
  inputType: 'text' | 'number' | 'select';
  selectOptions?: string[];
}

export const CUSTOM_FILTER_FIELDS: CustomFieldMeta[] = [
  {
    field: 'genre',
    label: 'Genre',
    operators: [
      { op: 'is_empty', label: 'is missing / unclassified', needsValue: false },
      { op: 'is_not_empty', label: 'is set', needsValue: false },
      { op: 'contains', label: 'contains', needsValue: true },
      { op: 'equals', label: 'equals', needsValue: true },
      { op: 'not_contains', label: 'does not contain', needsValue: true },
    ],
    placeholder: 'e.g. Electronic, Jazz',
    inputType: 'text',
  },
  {
    field: 'year',
    label: 'Release Year',
    operators: [
      { op: 'is_empty', label: 'is missing', needsValue: false },
      { op: 'is_not_empty', label: 'is present', needsValue: false },
      { op: 'lt', label: 'before', needsValue: true },
      { op: 'gte', label: 'from or after', needsValue: true },
      { op: 'equals', label: 'equals', needsValue: true },
    ],
    placeholder: 'e.g. 2010',
    inputType: 'number',
  },
  {
    field: 'durationMin',
    label: 'Duration (min)',
    operators: [
      { op: 'gt', label: 'longer than', needsValue: true },
      { op: 'gte', label: 'at least', needsValue: true },
      { op: 'lt', label: 'shorter than', needsValue: true },
      { op: 'lte', label: 'at most', needsValue: true },
    ],
    placeholder: 'e.g. 10',
    inputType: 'number',
  },
  {
    field: 'artist',
    label: 'Artist',
    operators: [
      { op: 'is_empty', label: 'is unknown / missing', needsValue: false },
      { op: 'contains', label: 'contains', needsValue: true },
      { op: 'equals', label: 'equals', needsValue: true },
      { op: 'not_contains', label: 'does not contain', needsValue: true },
    ],
    placeholder: 'e.g. Daft Punk',
    inputType: 'text',
  },
  {
    field: 'album',
    label: 'Album',
    operators: [
      { op: 'is_empty', label: 'is unknown / missing', needsValue: false },
      { op: 'contains', label: 'contains', needsValue: true },
      { op: 'equals', label: 'equals', needsValue: true },
    ],
    placeholder: 'e.g. Discovery',
    inputType: 'text',
  },
  {
    field: 'format',
    label: 'Audio Format',
    operators: [
      { op: 'equals', label: 'is', needsValue: true },
      { op: 'not_equals', label: 'is not', needsValue: true },
    ],
    placeholder: 'e.g. FLAC, MP3',
    inputType: 'select',
    selectOptions: ['MP3', 'FLAC', 'M4A', 'WAV', 'OGG', 'OPUS', 'AIFF', 'ALAC'],
  },
  {
    field: 'playCount',
    label: 'Play Count',
    operators: [
      { op: 'equals', label: 'equals', needsValue: true },
      { op: 'gte', label: 'at least', needsValue: true },
      { op: 'lte', label: 'at most', needsValue: true },
    ],
    placeholder: 'e.g. 5',
    inputType: 'number',
  },
  {
    field: 'hasArtwork',
    label: 'Cover Art',
    operators: [
      { op: 'is_false', label: 'is missing', needsValue: false },
      { op: 'is_true', label: 'is present', needsValue: false },
    ],
    placeholder: '',
    inputType: 'text',
  },
  {
    field: 'matchStatus',
    label: 'YT Match',
    operators: [
      { op: 'equals', label: 'is', needsValue: true },
      { op: 'not_equals', label: 'is not', needsValue: true },
    ],
    placeholder: 'unmatched',
    inputType: 'select',
    selectOptions: ['unmatched', 'matched', 'skipped'],
  },
  {
    field: 'missingOnDevice',
    label: 'Device File',
    operators: [
      { op: 'is_true', label: 'is missing on device', needsValue: false },
      { op: 'is_false', label: 'is present on device', needsValue: false },
    ],
    placeholder: '',
    inputType: 'text',
  },
];

const LOSSLESS_FORMATS = new Set(['FLAC', 'WAV', 'AIFF', 'AIF', 'AIFC', 'ALAC']);
const STORAGE_KEY = 'cratesync_dashboard_smart_filters_v1';

export function hasValidYearTag(track: LocalTrack): boolean {
  const parsed = parseInt((track.year || '').trim(), 10);
  return Number.isFinite(parsed) && parsed >= 1900 && parsed <= 2100;
}

export function isTrackMissingGenre(
  track: LocalTrack,
  genreMap?: Map<string, InferredGenreResult>
): boolean {
  const rawCleaned = track.genre ? cleanRawGenreTag(track.genre).toLowerCase() : '';
  const hasExplicitTag =
    rawCleaned.length > 0 &&
    rawCleaned !== 'other' &&
    rawCleaned !== 'unknown' &&
    rawCleaned !== 'unclassified' &&
    rawCleaned !== 'untagged' &&
    rawCleaned !== 'none' &&
    rawCleaned !== 'n/a';

  if (hasExplicitTag) return false;
  const resolved = genreMap?.get(track.id);
  if (!resolved) return true;
  return resolved.source === 'unclassified' || resolved.genre === 'Unclassified';
}

export function evaluateQuickCriterion(
  track: LocalTrack,
  criterionId: QuickCriterionId,
  playStats: Record<string, TrackPlayStats>,
  genreMap?: Map<string, InferredGenreResult>
): boolean {
  switch (criterionId) {
    case 'no-genre':
      return isTrackMissingGenre(track, genreMap);
    case 'missing-year':
      return !hasValidYearTag(track);
    case 'longer-than-10m':
      return (track.duration || 0) >= 600;
    case 'no-artwork':
      return !track.coverArtUrl;
    case 'unmatched':
      return !track.youtubeVideoId && track.matchStatus !== 'skipped';
    case 'never-played':
      return (playStats[track.id]?.playCount ?? track.playCount ?? 0) === 0;
    case 'lossless':
      return LOSSLESS_FORMATS.has((track.format || '').toUpperCase());
    case 'missing-file':
      return Boolean(track.isMissingOnDevice);
  }
}

export function evaluateCustomFilterRule(
  track: LocalTrack,
  rule: CustomFilterRule,
  playStats: Record<string, TrackPlayStats>,
  genreMap?: Map<string, InferredGenreResult>
): boolean {
  const val = rule.value.trim();
  const valLower = val.toLowerCase();

  switch (rule.field) {
    case 'genre': {
      const missing = isTrackMissingGenre(track, genreMap);
      if (rule.operator === 'is_empty') return missing;
      if (rule.operator === 'is_not_empty') return !missing;
      const resolved = (genreMap?.get(track.id)?.genre ?? track.genre ?? '').toLowerCase();
      if (!valLower) return true;
      if (rule.operator === 'contains') return resolved.includes(valLower);
      if (rule.operator === 'not_contains') return !resolved.includes(valLower);
      if (rule.operator === 'equals') return resolved === valLower;
      return true;
    }
    case 'year': {
      const valid = hasValidYearTag(track);
      if (rule.operator === 'is_empty') return !valid;
      if (rule.operator === 'is_not_empty') return valid;
      if (!valid) return false;
      const trackYear = parseInt(track.year, 10);
      const targetYear = parseInt(val, 10);
      if (!Number.isFinite(targetYear)) return true;
      if (rule.operator === 'lt') return trackYear < targetYear;
      if (rule.operator === 'gte') return trackYear >= targetYear;
      if (rule.operator === 'equals') return trackYear === targetYear;
      return true;
    }
    case 'durationMin': {
      const targetMin = parseFloat(val);
      if (!Number.isFinite(targetMin) || targetMin < 0) return true;
      const trackMin = (track.duration || 0) / 60;
      if (trackMin <= 0) return false;
      if (rule.operator === 'gt') return trackMin > targetMin;
      if (rule.operator === 'gte') return trackMin >= targetMin;
      if (rule.operator === 'lt') return trackMin < targetMin;
      if (rule.operator === 'lte') return trackMin <= targetMin;
      return true;
    }
    case 'artist': {
      const artist = (track.artist || '').trim();
      const isMissing = !artist || artist.toLowerCase() === 'unknown artist';
      if (rule.operator === 'is_empty') return isMissing;
      if (!valLower) return true;
      const lower = artist.toLowerCase();
      if (rule.operator === 'contains') return lower.includes(valLower);
      if (rule.operator === 'not_contains') return !lower.includes(valLower);
      if (rule.operator === 'equals') return lower === valLower;
      return true;
    }
    case 'album': {
      const album = (track.album || '').trim();
      const isMissing = !album || album.toLowerCase() === 'unknown album';
      if (rule.operator === 'is_empty') return isMissing;
      if (!valLower) return true;
      const lower = album.toLowerCase();
      if (rule.operator === 'contains') return lower.includes(valLower);
      if (rule.operator === 'equals') return lower === valLower;
      return true;
    }
    case 'format': {
      const fmt = (track.format || '').toUpperCase();
      const target = val.toUpperCase();
      if (!target) return true;
      if (rule.operator === 'equals') return fmt === target;
      if (rule.operator === 'not_equals') return fmt !== target;
      return true;
    }
    case 'playCount': {
      const target = parseInt(val, 10);
      if (!Number.isFinite(target)) return true;
      const plays = playStats[track.id]?.playCount ?? track.playCount ?? 0;
      if (rule.operator === 'equals') return plays === target;
      if (rule.operator === 'gte') return plays >= target;
      if (rule.operator === 'lte') return plays <= target;
      return true;
    }
    case 'hasArtwork': {
      const hasArt = Boolean(track.coverArtUrl);
      return rule.operator === 'is_true' ? hasArt : !hasArt;
    }
    case 'matchStatus': {
      const status = track.youtubeVideoId
        ? 'matched'
        : track.matchStatus === 'skipped'
          ? 'skipped'
          : 'unmatched';
      if (!valLower) return true;
      return rule.operator === 'equals' ? status === valLower : status !== valLower;
    }
    case 'missingOnDevice': {
      const missing = Boolean(track.isMissingOnDevice);
      return rule.operator === 'is_true' ? missing : !missing;
    }
  }
}

export function filterTracksBySmartCriteria(
  tracks: LocalTrack[],
  quickIds: QuickCriterionId[],
  rules: CustomFilterRule[],
  matchMode: SmartFilterMatchMode,
  playStats: Record<string, TrackPlayStats>,
  genreMap?: Map<string, InferredGenreResult>
): LocalTrack[] {
  if (quickIds.length === 0 && rules.length === 0) return [];

  return tracks.filter((track) => {
    const outcomes: boolean[] = [];
    for (const qId of quickIds) {
      outcomes.push(evaluateQuickCriterion(track, qId, playStats, genreMap));
    }
    for (const rule of rules) {
      outcomes.push(evaluateCustomFilterRule(track, rule, playStats, genreMap));
    }
    if (outcomes.length === 0) return false;
    return matchMode === 'all' ? outcomes.every(Boolean) : outcomes.some(Boolean);
  });
}

export function createEmptyCustomRule(field: CustomFilterField = 'durationMin'): CustomFilterRule {
  const meta = CUSTOM_FILTER_FIELDS.find((f) => f.field === field) ?? CUSTOM_FILTER_FIELDS[0];
  const firstOp = meta.operators[0];
  let defaultVal = '';
  if (field === 'durationMin') defaultVal = '10';
  else if (field === 'format') defaultVal = 'FLAC';
  else if (field === 'matchStatus') defaultVal = 'unmatched';
  else if (field === 'playCount') defaultVal = '0';

  return {
    id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    field,
    operator: firstOp.op,
    value: firstOp.needsValue ? defaultVal : '',
  };
}

export function loadSavedSmartFilters(): SavedDashboardSmartFilter[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedDashboardSmartFilter =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        Array.isArray(item.quickIds) &&
        Array.isArray(item.rules)
    );
  } catch {
    return [];
  }
}

export function saveSavedSmartFilters(filters: SavedDashboardSmartFilter[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Ignore storage quota errors
  }
}
