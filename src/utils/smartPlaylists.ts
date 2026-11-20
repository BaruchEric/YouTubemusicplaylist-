import type {
  LocalTrack,
  SmartPlaylist,
  SmartPlaylistMatchMode,
  SmartPlaylistRule,
  SmartPlaylistSortBy,
  SmartPlaylistSortDir,
  SmartRuleField,
  SmartRuleOperator,
  TrackPlayStats,
} from '../types/music';
import { inferTrackGenre } from './genreInference';

export interface SmartRuleFieldMeta {
  field: SmartRuleField;
  label: string;
  kind: 'text' | 'number' | 'select' | 'duration';
  operators: SmartRuleOperator[];
  defaultOperator: SmartRuleOperator;
  defaultValue: string;
  placeholder: string;
  options?: Array<{ value: string; label: string }>;
}

const TEXT_OPERATORS: SmartRuleOperator[] = ['contains', 'not_contains', 'equals', 'not_equals'];
const NUMBER_OPERATORS: SmartRuleOperator[] = ['gte', 'gt', 'lte', 'lt', 'equals', 'not_equals'];
const SELECT_OPERATORS: SmartRuleOperator[] = ['equals', 'not_equals'];

export const SMART_RULE_OPERATOR_LABELS: Record<SmartRuleOperator, string> = {
  contains: 'contains',
  not_contains: 'does not contain',
  equals: 'is',
  not_equals: 'is not',
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
};

export const SMART_RULE_FIELD_META: Record<SmartRuleField, SmartRuleFieldMeta> = {
  genre: {
    field: 'genre',
    label: 'Genre',
    kind: 'text',
    operators: TEXT_OPERATORS,
    defaultOperator: 'contains',
    defaultValue: '',
    placeholder: 'e.g. Electronic, Hip-Hop, Jazz',
  },
  artist: {
    field: 'artist',
    label: 'Artist',
    kind: 'text',
    operators: TEXT_OPERATORS,
    defaultOperator: 'contains',
    defaultValue: '',
    placeholder: 'e.g. Daft Punk, Miles Davis',
  },
  album: {
    field: 'album',
    label: 'Album',
    kind: 'text',
    operators: TEXT_OPERATORS,
    defaultOperator: 'contains',
    defaultValue: '',
    placeholder: 'e.g. Discovery',
  },
  title: {
    field: 'title',
    label: 'Track Title',
    kind: 'text',
    operators: TEXT_OPERATORS,
    defaultOperator: 'contains',
    defaultValue: '',
    placeholder: 'e.g. Remix, Live, Acoustic',
  },
  format: {
    field: 'format',
    label: 'Audio Format',
    kind: 'text',
    operators: ['equals', 'not_equals', 'contains'],
    defaultOperator: 'equals',
    defaultValue: 'FLAC',
    placeholder: 'FLAC, MP3, WAV, M4A',
  },
  playCount: {
    field: 'playCount',
    label: 'Play Count',
    kind: 'number',
    operators: NUMBER_OPERATORS,
    defaultOperator: 'gte',
    defaultValue: '3',
    placeholder: 'e.g. 3',
  },
  matchStatus: {
    field: 'matchStatus',
    label: 'YouTube Match',
    kind: 'select',
    operators: SELECT_OPERATORS,
    defaultOperator: 'equals',
    defaultValue: 'matched',
    placeholder: '',
    options: [
      { value: 'matched', label: 'Matched on YouTube' },
      { value: 'unmatched', label: 'Unmatched' },
      { value: 'skipped', label: 'Skipped' },
    ],
  },
  duration: {
    field: 'duration',
    label: 'Duration',
    kind: 'duration',
    operators: NUMBER_OPERATORS,
    defaultOperator: 'gte',
    defaultValue: '4:00',
    placeholder: 'mm:ss or seconds (e.g. 4:00)',
  },
  year: {
    field: 'year',
    label: 'Release Year',
    kind: 'number',
    operators: NUMBER_OPERATORS,
    defaultOperator: 'gte',
    defaultValue: '2020',
    placeholder: 'e.g. 2020',
  },
  folderName: {
    field: 'folderName',
    label: 'Folder',
    kind: 'text',
    operators: TEXT_OPERATORS,
    defaultOperator: 'contains',
    defaultValue: '',
    placeholder: 'Folder name',
  },
  addedDaysAgo: {
    field: 'addedDaysAgo',
    label: 'Added (Days Ago)',
    kind: 'number',
    operators: NUMBER_OPERATORS,
    defaultOperator: 'lte',
    defaultValue: '14',
    placeholder: 'e.g. 14',
  },
};

export const SMART_RULE_FIELD_LIST: SmartRuleFieldMeta[] = Object.values(SMART_RULE_FIELD_META);

export const SMART_SORT_OPTIONS: Array<{ value: SmartPlaylistSortBy; label: string }> = [
  { value: 'addedAt', label: 'Recently Added' },
  { value: 'playCount', label: 'Play Count' },
  { value: 'lastPlayedAt', label: 'Recently Played' },
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
  { value: 'duration', label: 'Duration' },
  { value: 'year', label: 'Release Year' },
];

export interface SmartPlaylistPreset {
  id: string;
  label: string;
  name: string;
  description: string;
  matchMode: SmartPlaylistMatchMode;
  rules: Array<{ field: SmartRuleField; operator: SmartRuleOperator; value: string }>;
  sortBy: SmartPlaylistSortBy;
  sortDir: SmartPlaylistSortDir;
  excludeMissing: boolean;
}

export const SMART_PLAYLIST_PRESETS: SmartPlaylistPreset[] = [
  {
    id: 'most-played',
    label: 'Most Played',
    name: 'Heavy Rotation',
    description: 'Tracks played at least once, ordered by play count.',
    matchMode: 'all',
    rules: [{ field: 'playCount', operator: 'gte', value: '1' }],
    sortBy: 'playCount',
    sortDir: 'desc',
    excludeMissing: true,
  },
  {
    id: 'lossless-vault',
    label: 'Lossless Vault',
    name: 'Lossless Audio',
    description: 'FLAC, WAV, and AIFF masters from device storage.',
    matchMode: 'any',
    rules: [
      { field: 'format', operator: 'equals', value: 'FLAC' },
      { field: 'format', operator: 'equals', value: 'WAV' },
      { field: 'format', operator: 'equals', value: 'AIFF' },
    ],
    sortBy: 'addedAt',
    sortDir: 'desc',
    excludeMissing: true,
  },
  {
    id: 'yt-ready',
    label: 'YouTube Ready',
    name: 'Matched for YouTube Music',
    description: 'Verified local tracks ready to launch in YouTube Music.',
    matchMode: 'all',
    rules: [{ field: 'matchStatus', operator: 'equals', value: 'matched' }],
    sortBy: 'playCount',
    sortDir: 'desc',
    excludeMissing: true,
  },
  {
    id: 'recently-added',
    label: 'Fresh Crates (14d)',
    name: 'Fresh Crates',
    description: 'Tracks imported or discovered in the last 14 days.',
    matchMode: 'all',
    rules: [{ field: 'addedDaysAgo', operator: 'lte', value: '14' }],
    sortBy: 'addedAt',
    sortDir: 'desc',
    excludeMissing: true,
  },
  {
    id: 'extended-mixes',
    label: 'Long Mixes (5m+)',
    name: 'Extended Cuts',
    description: 'Longer tracks and extended mixes over 5 minutes.',
    matchMode: 'all',
    rules: [{ field: 'duration', operator: 'gte', value: '5:00' }],
    sortBy: 'duration',
    sortDir: 'desc',
    excludeMissing: true,
  },
];

export function createRuleId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createBlankRule(field: SmartRuleField = 'genre'): SmartPlaylistRule {
  const meta = SMART_RULE_FIELD_META[field];
  return {
    id: createRuleId(),
    field,
    operator: meta.defaultOperator,
    value: meta.defaultValue,
  };
}

/**
 * Parses a duration string in either "mm:ss" (or "hh:mm:ss") or raw seconds into seconds.
 */
export function parseDurationValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((p) => Number(p.trim()));
    if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  }
  const num = Number(trimmed);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function compareText(actual: string, operator: SmartRuleOperator, rawTarget: string): boolean {
  const target = rawTarget.trim().toLowerCase();
  if (!target) return true; // Ignore empty draft value so partial rules don't zero everything unexpectedly
  const norm = actual.trim().toLowerCase();

  switch (operator) {
    case 'contains':
      return norm.includes(target);
    case 'not_contains':
      return !norm.includes(target);
    case 'equals':
      return norm === target;
    case 'not_equals':
      return norm !== target;
    default:
      return norm.includes(target);
  }
}

function compareNumber(
  actual: number | null,
  operator: SmartRuleOperator,
  target: number | null
): boolean {
  if (target === null) return true;
  if (actual === null || !Number.isFinite(actual)) return false;

  switch (operator) {
    case 'gt':
      return actual > target;
    case 'gte':
      return actual >= target;
    case 'lt':
      return actual < target;
    case 'lte':
      return actual <= target;
    case 'equals':
      return Math.abs(actual - target) < 0.0001;
    case 'not_equals':
      return Math.abs(actual - target) >= 0.0001;
    default:
      return false;
  }
}

function getEffectivePlayCount(
  track: LocalTrack,
  playStats: Record<string, TrackPlayStats>
): number {
  return playStats[track.id]?.playCount ?? track.playCount ?? 0;
}

function getEffectiveLastPlayedAt(
  track: LocalTrack,
  playStats: Record<string, TrackPlayStats>
): number {
  return playStats[track.id]?.lastPlayedAt ?? track.lastPlayedAt ?? 0;
}

function evaluateSingleRule(
  rule: SmartPlaylistRule,
  track: LocalTrack,
  playStats: Record<string, TrackPlayStats>,
  nowMs: number
): boolean {
  switch (rule.field) {
    case 'genre': {
      const inferred = inferTrackGenre(track).genre;
      const combined = track.genre ? `${track.genre} ${inferred}` : inferred;
      if (rule.operator === 'equals' || rule.operator === 'not_equals') {
        const target = rule.value.trim().toLowerCase();
        if (!target) return true;
        const exactMatch =
          inferred.toLowerCase() === target || (track.genre?.trim().toLowerCase() ?? '') === target;
        return rule.operator === 'equals' ? exactMatch : !exactMatch;
      }
      return compareText(combined, rule.operator, rule.value);
    }
    case 'artist':
      return compareText(track.artist, rule.operator, rule.value);
    case 'album':
      return compareText(track.album, rule.operator, rule.value);
    case 'title':
      return compareText(track.title, rule.operator, rule.value);
    case 'format':
      return compareText(track.format, rule.operator, rule.value);
    case 'folderName':
      return compareText(`${track.folderName} ${track.relativePath}`, rule.operator, rule.value);
    case 'matchStatus': {
      const actualStatus = track.youtubeVideoId ? 'matched' : track.matchStatus;
      return compareText(actualStatus, rule.operator, rule.value);
    }
    case 'playCount': {
      const trimmed = rule.value.trim();
      const target = trimmed === '' ? null : Number(trimmed);
      return compareNumber(
        getEffectivePlayCount(track, playStats),
        rule.operator,
        target !== null && Number.isFinite(target) ? target : null
      );
    }
    case 'duration': {
      const targetSec = parseDurationValue(rule.value);
      return compareNumber(track.duration > 0 ? track.duration : null, rule.operator, targetSec);
    }
    case 'year': {
      const trimmed = rule.value.trim();
      const targetYear = trimmed === '' ? null : Number(trimmed);
      const parsedYear = track.year ? Number(track.year.slice(0, 4)) : NaN;
      return compareNumber(
        Number.isFinite(parsedYear) && parsedYear > 0 ? parsedYear : null,
        rule.operator,
        targetYear !== null && Number.isFinite(targetYear) ? targetYear : null
      );
    }
    case 'addedDaysAgo': {
      const trimmed = rule.value.trim();
      const targetDays = trimmed === '' ? null : Number(trimmed);
      const daysAgo = Math.max(0, (nowMs - track.addedAt) / 86_400_000);
      return compareNumber(
        daysAgo,
        rule.operator,
        targetDays !== null && Number.isFinite(targetDays) ? targetDays : null
      );
    }
  }
}

export function evaluateSmartPlaylist(
  playlist: Pick<
    SmartPlaylist,
    'matchMode' | 'rules' | 'sortBy' | 'sortDir' | 'excludeMissing'
  >,
  tracks: LocalTrack[],
  playStats: Record<string, TrackPlayStats>
): LocalTrack[] {
  const nowMs = Date.now();
  const activeRules = playlist.rules.filter((r) => r.value.trim().length > 0);

  const matched = tracks.filter((track) => {
    if (playlist.excludeMissing && track.isMissingOnDevice) {
      return false;
    }
    if (activeRules.length === 0) {
      return true;
    }
    if (playlist.matchMode === 'all') {
      return activeRules.every((rule) => evaluateSingleRule(rule, track, playStats, nowMs));
    }
    return activeRules.some((rule) => evaluateSingleRule(rule, track, playStats, nowMs));
  });

  const dir = playlist.sortDir === 'asc' ? 1 : -1;
  matched.sort((a, b) => {
    let cmp = 0;
    switch (playlist.sortBy) {
      case 'playCount':
        cmp = getEffectivePlayCount(a, playStats) - getEffectivePlayCount(b, playStats);
        break;
      case 'lastPlayedAt':
        cmp = getEffectiveLastPlayedAt(a, playStats) - getEffectiveLastPlayedAt(b, playStats);
        break;
      case 'title':
        cmp = a.title.localeCompare(b.title);
        break;
      case 'artist':
        cmp = a.artist.localeCompare(b.artist);
        break;
      case 'duration':
        cmp = (a.duration || 0) - (b.duration || 0);
        break;
      case 'year': {
        const ya = Number(a.year?.slice(0, 4)) || 0;
        const yb = Number(b.year?.slice(0, 4)) || 0;
        cmp = ya - yb;
        break;
      }
      case 'addedAt':
      default:
        cmp = a.addedAt - b.addedAt;
        break;
    }
    if (cmp !== 0) return cmp * dir;
    return a.title.localeCompare(b.title);
  });

  return matched;
}

export function summarizeSmartRule(rule: SmartPlaylistRule): string {
  const meta = SMART_RULE_FIELD_META[rule.field];
  const opLabel = SMART_RULE_OPERATOR_LABELS[rule.operator] ?? rule.operator;
  let valueLabel = rule.value.trim();

  if (rule.field === 'matchStatus' && meta.options) {
    valueLabel = meta.options.find((o) => o.value === valueLabel)?.label ?? valueLabel;
  } else if (rule.field === 'addedDaysAgo' && valueLabel) {
    valueLabel = `${valueLabel}d`;
  }

  return `${meta.label} ${opLabel} ${valueLabel || '…'}`;
}
