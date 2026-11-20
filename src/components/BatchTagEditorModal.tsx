import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ExternalLink,
  Globe,
  Loader2,
  RotateCcw,
  Tags,
  X,
} from 'lucide-react';
import type { LocalTrack, MatchStatus } from '../types/music';
import { inferTrackGenre } from '../utils/genreInference';
import {
  fetchMetadataSuggestions,
  type MetadataSuggestion,
  type SearchGroundingSource,
} from '../utils/metadataLookup';

export type BatchTrackPatch = Partial<
  Pick<LocalTrack, 'title' | 'artist' | 'album' | 'genre' | 'year' | 'trackNumber' | 'matchStatus'>
>;

interface BatchTagEditorModalProps {
  isOpen: boolean;
  tracks: LocalTrack[];
  contextLabel?: string;
  onClose: () => void;
  onApply: (patchesById: Record<string, BatchTrackPatch>) => void;
}

const COMMON_GENRES = [
  'Electronic',
  'Hip-Hop / Rap',
  'Rock',
  'Indie / Alternative',
  'Pop',
  'R&B / Soul',
  'Jazz',
  'Classical',
  'Ambient / Lo-Fi',
  'Metal',
  'Country / Folk',
  'Latin / Reggae',
  'Soundtrack / Score',
  'Podcast / Spoken',
];

function cleanNoiseFromTitle(raw: string): string {
  return raw
    .replace(/^\d{1,3}\s*[.\-–_]\s+/, '')
    .replace(
      /\s*[([]\s*(official\s*(music\s*)?video|official\s*audio|lyric\s*video|lyrics|hd|hq|320\s*kbps|flac|remastered|visualizer)\s*[)\]]/gi,
      ''
    )
    .replace(/_/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function toTitleCase(input: string): string {
  const minor = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);
  const words = input.trim().split(/\s+/);
  return words
    .map((word, idx) => {
      const lower = word.toLowerCase();
      if (idx > 0 && idx < words.length - 1 && minor.has(lower)) {
        return lower;
      }
      return lower.replace(/^(['"(]?)([a-z])/, (_, prefix, ch) => `${prefix}${ch.toUpperCase()}`);
    })
    .join(' ');
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function summarizeSharedValue(values: string[]): { shared: string | null; distinctCount: number } {
  const nonEmpty = values.map((v) => v.trim());
  const set = new Set(nonEmpty);
  if (set.size === 1) {
    return { shared: nonEmpty[0] ?? '', distinctCount: 1 };
  }
  return { shared: null, distinctCount: set.size };
}

function isMissingTag(value: string | undefined, unknownSentinel?: string): boolean {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return true;
  if (unknownSentinel && trimmed.toLowerCase() === unknownSentinel.toLowerCase()) return true;
  return false;
}

export function BatchTagEditorModal({
  isOpen,
  tracks,
  contextLabel,
  onClose,
  onApply,
}: BatchTagEditorModalProps) {
  const [applyArtist, setApplyArtist] = useState(false);
  const [artistValue, setArtistValue] = useState('');

  const [applyAlbum, setApplyAlbum] = useState(false);
  const [albumValue, setAlbumValue] = useState('');

  const [applyGenre, setApplyGenre] = useState(false);
  const [genreValue, setGenreValue] = useState('');

  const [applyYear, setApplyYear] = useState(false);
  const [yearValue, setYearValue] = useState('');

  const [applyMatchStatus, setApplyMatchStatus] = useState(false);
  const [matchStatusValue, setMatchStatusValue] = useState<MatchStatus>('unmatched');

  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);

  const [cleanTitleNoise, setCleanTitleNoise] = useState(false);
  const [applyTitleCase, setApplyTitleCase] = useState(false);
  const [autoNumberTracks, setAutoNumberTracks] = useState(false);

  // Google Search Metadata Suggestion State
  const [lookupScope, setLookupScope] = useState<'unmatched' | 'all'>('unmatched');
  const [onlyFillMissing, setOnlyFillMissing] = useState(false);
  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);
  const [lookupProgress, setLookupProgress] = useState<{ done: number; total: number } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [suggestionsById, setSuggestionsById] = useState<Record<string, MetadataSuggestion>>({});
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(new Set());
  const [searchSources, setSearchSources] = useState<SearchGroundingSource[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const unmatchedTracks = useMemo(
    () => tracks.filter((t) => !t.youtubeVideoId && t.matchStatus !== 'matched'),
    [tracks]
  );

  const targetLookupTracks = useMemo(
    () => (lookupScope === 'unmatched' ? unmatchedTracks : tracks),
    [lookupScope, unmatchedTracks, tracks]
  );

  const sharedSummary = useMemo(() => {
    return {
      artist: summarizeSharedValue(tracks.map((t) => t.artist)),
      album: summarizeSharedValue(tracks.map((t) => t.album)),
      genre: summarizeSharedValue(tracks.map((t) => t.genre || '')),
      year: summarizeSharedValue(tracks.map((t) => t.year || '')),
    };
  }, [tracks]);

  // Reset form cleanly whenever opened for a track batch
  useEffect(() => {
    if (!isOpen) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      return;
    }
    setApplyArtist(false);
    setArtistValue(sharedSummary.artist.shared ?? '');
    setApplyAlbum(false);
    setAlbumValue(sharedSummary.album.shared ?? '');
    setApplyGenre(false);
    setGenreValue(sharedSummary.genre.shared ?? '');
    setApplyYear(false);
    setYearValue(sharedSummary.year.shared ?? '');
    setApplyMatchStatus(false);
    setMatchStatusValue('unmatched');
    setFindText('');
    setReplaceText('');
    setCaseSensitive(false);
    setCleanTitleNoise(false);
    setApplyTitleCase(false);
    setAutoNumberTracks(false);

    setLookupScope(unmatchedTracks.length > 0 ? 'unmatched' : 'all');
    setOnlyFillMissing(false);
    setIsFetchingMetadata(false);
    setLookupProgress(null);
    setLookupError(null);
    setSuggestionsById({});
    setSelectedSuggestionIds(new Set());
    setSearchSources([]);
  }, [isOpen, sharedSummary, unmatchedTracks.length]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const handleFetchGoogleMetadata = async () => {
    if (isFetchingMetadata || targetLookupTracks.length === 0) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsFetchingMetadata(true);
    setLookupError(null);
    setLookupProgress({ done: 0, total: targetLookupTracks.length });

    try {
      const result = await fetchMetadataSuggestions(targetLookupTracks, {
        signal: controller.signal,
        onProgress: (done, total) => setLookupProgress({ done, total }),
      });

      setSuggestionsById(result.suggestionsById);
      setSearchSources(result.sources);

      // Auto-select high/medium confidence suggestions that actually provide artist, album, or year
      const autoSelected = new Set<string>();
      for (const [trackId, sug] of Object.entries(result.suggestionsById)) {
        const hasUsefulField = Boolean(sug.artist.trim() || sug.album.trim() || sug.year.trim());
        if (hasUsefulField && sug.confidence !== 'low') {
          autoSelected.add(trackId);
        }
      }
      setSelectedSuggestionIds(autoSelected);
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'AbortError') {
        return;
      }
      setLookupError(
        err instanceof Error ? err.message : 'Unable to fetch metadata suggestions.'
      );
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsFetchingMetadata(false);
      setLookupProgress(null);
    }
  };

  const handleCancelLookup = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsFetchingMetadata(false);
    setLookupProgress(null);
  };

  const handleClearSuggestions = () => {
    setSuggestionsById({});
    setSelectedSuggestionIds(new Set());
    setSearchSources([]);
    setLookupError(null);
  };

  const handleToggleSuggestion = (trackId: string) => {
    setSelectedSuggestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const handleUpdateSuggestionField = (
    trackId: string,
    field: 'artist' | 'album' | 'year',
    value: string
  ) => {
    setSuggestionsById((prev) => {
      const existing = prev[trackId];
      if (!existing) return prev;
      return {
        ...prev,
        [trackId]: {
          ...existing,
          [field]: value,
        },
      };
    });
    setSelectedSuggestionIds((prev) => {
      const next = new Set(prev);
      next.add(trackId);
      return next;
    });
  };

  const suggestionList = useMemo(() => {
    return tracks
      .map((track) => {
        const suggestion = suggestionsById[track.id];
        return suggestion ? { track, suggestion } : null;
      })
      .filter((item): item is { track: LocalTrack; suggestion: MetadataSuggestion } =>
        Boolean(item)
      );
  }, [tracks, suggestionsById]);

  const previewRows = useMemo(() => {
    const regex =
      findText.length > 0
        ? new RegExp(escapeRegExp(findText), caseSensitive ? 'g' : 'gi')
        : null;

    return tracks.map((track, idx) => {
      const patch: BatchTrackPatch = {};
      const changes: string[] = [];
      const activeSuggestion = selectedSuggestionIds.has(track.id)
        ? suggestionsById[track.id]
        : undefined;

      let nextTitle = track.title;
      if (regex) {
        nextTitle = nextTitle.replace(regex, replaceText);
      }
      if (cleanTitleNoise) {
        nextTitle = cleanNoiseFromTitle(nextTitle);
      }
      if (applyTitleCase) {
        nextTitle = toTitleCase(nextTitle);
      }
      if (nextTitle.trim() && nextTitle.trim() !== track.title) {
        patch.title = nextTitle.trim();
        changes.push(`Title → ${patch.title}`);
      }

      // Artist: explicit manual overwrite takes precedence, otherwise apply accepted Google Search suggestion
      if (applyArtist) {
        const nextArtist = artistValue.trim() || 'Unknown Artist';
        const formatted = applyTitleCase ? toTitleCase(nextArtist) : nextArtist;
        if (formatted !== track.artist) {
          patch.artist = formatted;
          changes.push(`Artist → ${formatted}`);
        }
      } else if (
        activeSuggestion?.artist.trim() &&
        (!onlyFillMissing || isMissingTag(track.artist, 'Unknown Artist'))
      ) {
        const nextArtist = applyTitleCase
          ? toTitleCase(activeSuggestion.artist.trim())
          : activeSuggestion.artist.trim();
        if (nextArtist !== track.artist) {
          patch.artist = nextArtist;
          changes.push(`Artist → ${nextArtist}`);
        }
      } else if (applyTitleCase && track.artist !== 'Unknown Artist') {
        const formatted = toTitleCase(track.artist);
        if (formatted !== track.artist) {
          patch.artist = formatted;
          changes.push(`Artist → ${formatted}`);
        }
      }

      // Album: explicit manual overwrite takes precedence, otherwise apply accepted Google Search suggestion
      if (applyAlbum) {
        const nextAlbum = albumValue.trim() || 'Unknown Album';
        const formatted = applyTitleCase ? toTitleCase(nextAlbum) : nextAlbum;
        if (formatted !== track.album) {
          patch.album = formatted;
          changes.push(`Album → ${formatted}`);
        }
      } else if (
        activeSuggestion?.album.trim() &&
        (!onlyFillMissing || isMissingTag(track.album, 'Unknown Album'))
      ) {
        const nextAlbum = applyTitleCase
          ? toTitleCase(activeSuggestion.album.trim())
          : activeSuggestion.album.trim();
        if (nextAlbum !== track.album) {
          patch.album = nextAlbum;
          changes.push(`Album → ${nextAlbum}`);
        }
      } else if (applyTitleCase && track.album !== 'Unknown Album') {
        const formatted = toTitleCase(track.album);
        if (formatted !== track.album) {
          patch.album = formatted;
          changes.push(`Album → ${formatted}`);
        }
      }

      if (applyGenre) {
        const nextGenre = genreValue.trim() || undefined;
        if ((nextGenre ?? '') !== (track.genre ?? '')) {
          patch.genre = nextGenre;
          changes.push(nextGenre ? `Genre → ${nextGenre}` : 'Genre → Auto-infer');
        }
      }

      // Year: explicit manual overwrite takes precedence, otherwise apply accepted Google Search suggestion
      if (applyYear) {
        const nextYear = yearValue.trim();
        if (nextYear !== track.year) {
          patch.year = nextYear;
          changes.push(nextYear ? `Year → ${nextYear}` : 'Year cleared');
        }
      } else if (
        activeSuggestion?.year.trim() &&
        (!onlyFillMissing || isMissingTag(track.year))
      ) {
        const nextYear = activeSuggestion.year.trim();
        if (nextYear !== track.year) {
          patch.year = nextYear;
          changes.push(`Year → ${nextYear}`);
        }
      }

      if (applyMatchStatus) {
        if (matchStatusValue !== track.matchStatus) {
          patch.matchStatus = matchStatusValue;
          changes.push(`Status → ${matchStatusValue}`);
        }
      }

      if (autoNumberTracks) {
        const nextNum = idx + 1;
        if (track.trackNumber !== nextNum) {
          patch.trackNumber = nextNum;
          changes.push(`#${nextNum}`);
        }
      }

      return {
        track,
        patch,
        changes,
        hasChanges: Object.keys(patch).length > 0,
      };
    });
  }, [
    tracks,
    suggestionsById,
    selectedSuggestionIds,
    onlyFillMissing,
    findText,
    replaceText,
    caseSensitive,
    cleanTitleNoise,
    applyTitleCase,
    applyArtist,
    artistValue,
    applyAlbum,
    albumValue,
    applyGenre,
    genreValue,
    applyYear,
    yearValue,
    applyMatchStatus,
    matchStatusValue,
    autoNumberTracks,
  ]);

  const modifiedCount = useMemo(
    () => previewRows.filter((row) => row.hasChanges).length,
    [previewRows]
  );

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (modifiedCount === 0) return;

    const patchesById: Record<string, BatchTrackPatch> = {};
    for (const row of previewRows) {
      if (row.hasChanges) {
        patchesById[row.track.id] = row.patch;
      }
    }
    onApply(patchesById);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-tag-editor-title"
    >
      <div className="w-full max-w-3xl max-h-[90vh] rounded-lg bg-[#14171D] border border-white/[0.1] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Tags className="h-4 w-4 text-[#FF4D64] shrink-0" />
              <h2
                id="batch-tag-editor-title"
                className="font-display text-lg font-semibold text-white truncate"
              >
                Batch Tag Editor
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-[#8B92A2] font-mono tabular-nums">
              {tracks.length} track{tracks.length === 1 ? '' : 's'} loaded
              {contextLabel ? ` · ${contextLabel}` : ''} · Only checked fields or suggestions are
              applied
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close batch tag editor"
            className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Form & Live Preview */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Section 0: Google Search Auto-Fetch Metadata */}
            <div className="rounded-lg bg-[#0E1015] border border-white/[0.09] p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Globe className="h-3.5 w-3.5 text-[#FF4D64] shrink-0" />
                    <span>Auto-Fetch Metadata via Google Search</span>
                  </div>
                  <p className="text-[11px] text-[#8B92A2] leading-relaxed">
                    Cross-references filenames and folder/album structures with Google Search to
                    suggest Artist, Album, and Release Year.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <select
                    aria-label="Tracks to look up via Google Search"
                    value={lookupScope}
                    disabled={isFetchingMetadata}
                    onChange={(e) => setLookupScope(e.target.value as 'unmatched' | 'all')}
                    className="px-2.5 py-1.5 rounded-md bg-[#14171D] border border-white/[0.1] text-xs text-[#E5E7EB] focus:border-[#FF1F3D] focus:outline-none disabled:opacity-50"
                  >
                    <option value="unmatched">
                      Unmatched tracks ({unmatchedTracks.length})
                    </option>
                    <option value="all">All in batch ({tracks.length})</option>
                  </select>

                  {isFetchingMetadata ? (
                    <button
                      type="button"
                      onClick={handleCancelLookup}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white/[0.08] hover:bg-white/[0.14] text-white transition-colors whitespace-nowrap"
                    >
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FF4D64]" />
                      <span>
                        {lookupProgress
                          ? `Searching ${lookupProgress.done}/${lookupProgress.total} · Cancel`
                          : 'Searching…'}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={targetLookupTracks.length === 0}
                      onClick={handleFetchGoogleMetadata}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-40 disabled:pointer-events-none transition-colors whitespace-nowrap"
                    >
                      <Globe className="h-3.5 w-3.5" />
                      <span>
                        {suggestionList.length > 0 ? 'Re-Fetch' : 'Fetch Suggestions'}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {lookupScope === 'unmatched' && unmatchedTracks.length === 0 && (
                <div className="text-[11px] text-[#8B92A2]">
                  All tracks in this batch are already matched. Switch scope to{' '}
                  <button
                    type="button"
                    onClick={() => setLookupScope('all')}
                    className="text-[#FF4D64] hover:text-[#FF7588] underline underline-offset-2"
                  >
                    All in batch ({tracks.length})
                  </button>{' '}
                  to fetch suggestions anyway.
                </div>
              )}

              {lookupError && (
                <div className="flex items-start gap-2 rounded-md bg-[#EF4444]/10 border border-[#EF4444]/30 px-3 py-2 text-xs text-[#FCA5A5]">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-[#EF4444]" />
                  <span>{lookupError}</span>
                </div>
              )}

              {suggestionList.length > 0 && (
                <div className="pt-3 border-t border-white/[0.08] space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-3">
                      <span className="font-mono tabular-nums text-[#D1D5DB]">
                        {selectedSuggestionIds.size} / {suggestionList.length} suggestions selected
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedSuggestionIds(new Set(suggestionList.map((s) => s.track.id)))
                        }
                        className="text-[#9CA3AF] hover:text-white underline underline-offset-2"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedSuggestionIds(new Set())}
                        className="text-[#9CA3AF] hover:text-white underline underline-offset-2"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={handleClearSuggestions}
                        title="Discard fetched suggestions"
                        className="inline-flex items-center gap-1 text-[#8B92A2] hover:text-white"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Reset</span>
                      </button>
                    </div>

                    <label className="inline-flex items-center gap-1.5 text-[#9CA3AF] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={onlyFillMissing}
                        onChange={(e) => setOnlyFillMissing(e.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-[#FF1F3D]"
                      />
                      <span>Only fill missing/unknown fields</span>
                    </label>
                  </div>

                  <div className="max-h-56 overflow-y-auto rounded-md border border-white/[0.08] bg-[#14171D] divide-y divide-white/[0.06]">
                    {suggestionList.map(({ track, suggestion }) => {
                      const isChecked = selectedSuggestionIds.has(track.id);
                      const confColor =
                        suggestion.confidence === 'high'
                          ? 'text-[#22C55E]'
                          : suggestion.confidence === 'medium'
                            ? 'text-[#F59E0B]'
                            : 'text-[#8B92A2]';

                      return (
                        <div
                          key={track.id}
                          className={`p-3 space-y-2 transition-colors ${
                            isChecked ? 'bg-[#FF1F3D]/[0.04]' : 'opacity-70'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <label className="flex items-start gap-2.5 min-w-0 cursor-pointer flex-1">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleSuggestion(track.id)}
                                className="mt-0.5 h-3.5 w-3.5 rounded accent-[#FF1F3D] shrink-0"
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-white truncate">
                                  {track.fileName}
                                </div>
                                {suggestion.reason && (
                                  <div className="text-[11px] text-[#8B92A2] truncate mt-0.5">
                                    {suggestion.reason}
                                  </div>
                                )}
                              </div>
                            </label>
                            <span
                              className={`font-mono text-[10px] uppercase tracking-wider shrink-0 ${confColor}`}
                            >
                              {suggestion.confidence} confidence
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_84px] gap-2 pl-6">
                            <input
                              type="text"
                              value={suggestion.artist}
                              onChange={(e) =>
                                handleUpdateSuggestionField(track.id, 'artist', e.target.value)
                              }
                              placeholder="Artist"
                              aria-label={`Suggested artist for ${track.fileName}`}
                              className="px-2.5 py-1.5 rounded bg-[#0D0F13] border border-white/[0.09] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                            />
                            <input
                              type="text"
                              value={suggestion.album}
                              onChange={(e) =>
                                handleUpdateSuggestionField(track.id, 'album', e.target.value)
                              }
                              placeholder="Album"
                              aria-label={`Suggested album for ${track.fileName}`}
                              className="px-2.5 py-1.5 rounded bg-[#0D0F13] border border-white/[0.09] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                            />
                            <input
                              type="text"
                              value={suggestion.year}
                              onChange={(e) =>
                                handleUpdateSuggestionField(track.id, 'year', e.target.value)
                              }
                              placeholder="Year"
                              aria-label={`Suggested year for ${track.fileName}`}
                              className="px-2.5 py-1.5 rounded bg-[#0D0F13] border border-white/[0.09] text-xs font-mono tabular-nums text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {searchSources.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#8B92A2] pt-0.5">
                      <span className="font-medium text-[#9CA3AF]">Google Search sources:</span>
                      {searchSources.slice(0, 6).map((src) => (
                        <a
                          key={src.uri}
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#9CA3AF] hover:text-white underline underline-offset-2 max-w-[200px] truncate"
                        >
                          <span className="truncate">{src.title}</span>
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Section 1: Bulk Field Overwrites */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Artist */}
              <div className="space-y-1.5">
                <label className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-2 text-[#D1D5DB] font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyArtist}
                      onChange={(e) => setApplyArtist(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-[#FF1F3D]"
                    />
                    <span>Artist</span>
                  </span>
                  <span className="text-[11px] font-mono text-[#6B7280]">
                    {applyArtist ? 'Overwrite' : 'Keep existing'}
                  </span>
                </label>
                <input
                  type="text"
                  value={artistValue}
                  onChange={(e) => {
                    setArtistValue(e.target.value);
                    setApplyArtist(true);
                  }}
                  placeholder={
                    sharedSummary.artist.shared !== null
                      ? sharedSummary.artist.shared || 'Unknown Artist'
                      : `Multiple values (${sharedSummary.artist.distinctCount} distinct)`
                  }
                  className="w-full px-3 py-2 rounded-md bg-[#0D0F13] border border-white/[0.1] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                />
              </div>

              {/* Album */}
              <div className="space-y-1.5">
                <label className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-2 text-[#D1D5DB] font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyAlbum}
                      onChange={(e) => setApplyAlbum(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-[#FF1F3D]"
                    />
                    <span>Album</span>
                  </span>
                  <span className="text-[11px] font-mono text-[#6B7280]">
                    {applyAlbum ? 'Overwrite' : 'Keep existing'}
                  </span>
                </label>
                <input
                  type="text"
                  value={albumValue}
                  onChange={(e) => {
                    setAlbumValue(e.target.value);
                    setApplyAlbum(true);
                  }}
                  placeholder={
                    sharedSummary.album.shared !== null
                      ? sharedSummary.album.shared || 'Unknown Album'
                      : `Multiple values (${sharedSummary.album.distinctCount} distinct)`
                  }
                  className="w-full px-3 py-2 rounded-md bg-[#0D0F13] border border-white/[0.1] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                />
              </div>

              {/* Genre */}
              <div className="space-y-1.5">
                <label className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-2 text-[#D1D5DB] font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyGenre}
                      onChange={(e) => setApplyGenre(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-[#FF1F3D]"
                    />
                    <span>Genre</span>
                  </span>
                  <span className="text-[11px] font-mono text-[#6B7280]">
                    {applyGenre ? (genreValue.trim() ? 'Overwrite' : 'Reset to auto') : 'Keep existing'}
                  </span>
                </label>
                <input
                  type="text"
                  list="batch-common-genres"
                  value={genreValue}
                  onChange={(e) => {
                    setGenreValue(e.target.value);
                    setApplyGenre(true);
                  }}
                  placeholder="e.g. Electronic, Indie / Alternative, Jazz (blank resets to auto)"
                  className="w-full px-3 py-2 rounded-md bg-[#0D0F13] border border-white/[0.1] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                />
                <datalist id="batch-common-genres">
                  {COMMON_GENRES.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </div>

              {/* Year & Match Status */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-2 text-[#D1D5DB] font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={applyYear}
                        onChange={(e) => setApplyYear(e.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-[#FF1F3D]"
                      />
                      <span>Year</span>
                    </span>
                  </label>
                  <input
                    type="text"
                    value={yearValue}
                    onChange={(e) => {
                      setYearValue(e.target.value);
                      setApplyYear(true);
                    }}
                    placeholder={sharedSummary.year.shared || '2025'}
                    className="w-full px-3 py-2 rounded-md bg-[#0D0F13] border border-white/[0.1] text-xs font-mono tabular-nums text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-2 text-[#D1D5DB] font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={applyMatchStatus}
                        onChange={(e) => setApplyMatchStatus(e.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-[#FF1F3D]"
                      />
                      <span>Match Status</span>
                    </span>
                  </label>
                  <select
                    value={matchStatusValue}
                    onChange={(e) => {
                      setMatchStatusValue(e.target.value as MatchStatus);
                      setApplyMatchStatus(true);
                    }}
                    className="w-full px-2.5 py-2 rounded-md bg-[#0D0F13] border border-white/[0.1] text-xs text-white focus:border-[#FF1F3D] focus:outline-none"
                  >
                    <option value="unmatched">Unmatched</option>
                    <option value="skipped">Skipped</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Section 2: Title Find & Replace + Cleanup Transforms */}
            <div className="pt-5 border-t border-white/[0.08] space-y-4">
              <div className="text-xs font-medium text-[#D1D5DB]">
                Title Find &amp; Replace and Tag Cleanup
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                <input
                  type="text"
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  placeholder="Find in track titles (e.g. (Official Audio))"
                  aria-label="Find text in track titles"
                  className="sm:col-span-5 px-3 py-2 rounded-md bg-[#0D0F13] border border-white/[0.1] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                />
                <input
                  type="text"
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder="Replace with (leave empty to remove)"
                  aria-label="Replacement text for track titles"
                  className="sm:col-span-5 px-3 py-2 rounded-md bg-[#0D0F13] border border-white/[0.1] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                />
                <label className="sm:col-span-2 inline-flex items-center gap-2 text-xs text-[#9CA3AF] cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={caseSensitive}
                    onChange={(e) => setCaseSensitive(e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-[#FF1F3D]"
                  />
                  <span>Match case</span>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-[#D1D5DB]">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cleanTitleNoise}
                    onChange={(e) => setCleanTitleNoise(e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-[#FF1F3D]"
                  />
                  <span>Strip track prefixes &amp; YouTube tags (Official Audio, Lyrics, _)</span>
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyTitleCase}
                    onChange={(e) => setApplyTitleCase(e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-[#FF1F3D]"
                  />
                  <span>Normalize Title Case</span>
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoNumberTracks}
                    onChange={(e) => setAutoNumberTracks(e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-[#FF1F3D]"
                  />
                  <span>Auto-number tracks (1–{tracks.length})</span>
                </label>
              </div>
            </div>

            {/* Section 3: Live Change Preview */}
            <div className="pt-5 border-t border-white/[0.08] space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#D1D5DB]">Live Preview</span>
                <span className="font-mono tabular-nums text-[#8B92A2]">
                  {modifiedCount} of {tracks.length} track{tracks.length === 1 ? '' : 's'} will be
                  updated
                </span>
              </div>

              <div className="max-h-48 overflow-y-auto rounded-md border border-white/[0.08] bg-[#0D0F13] divide-y divide-white/[0.05] text-xs">
                {previewRows.slice(0, 60).map(({ track, changes, hasChanges }, idx) => (
                  <div
                    key={track.id}
                    className={`px-3.5 py-2 flex items-start justify-between gap-3 ${
                      hasChanges ? 'bg-[#FF1F3D]/[0.05]' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] tabular-nums text-[#6B7280] w-5 shrink-0">
                          {idx + 1}
                        </span>
                        <span className="text-white font-medium truncate">{track.title}</span>
                        <span className="text-[#6B7280] truncate hidden sm:inline">
                          {track.artist} · {inferTrackGenre(track).genre}
                        </span>
                      </div>
                      {hasChanges && (
                        <div className="mt-1 pl-7 text-[11px] font-mono text-[#FCA5A5] truncate">
                          {changes.join(' · ')}
                        </div>
                      )}
                    </div>
                    <span
                      className={`text-[11px] font-mono shrink-0 ${
                        hasChanges ? 'text-[#22C55E]' : 'text-[#525866]'
                      }`}
                    >
                      {hasChanges ? 'Modified' : 'Unchanged'}
                    </span>
                  </div>
                ))}
                {previewRows.length > 60 && (
                  <div className="px-3.5 py-2 text-center text-[11px] text-[#717786] font-mono">
                    +{previewRows.length - 60} additional tracks in this batch
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-[#101217] border-t border-white/[0.08] flex items-center justify-between gap-3 shrink-0">
            <span className="text-xs text-[#717786]">
              Updates CrateSync catalog metadata locally without altering original audio files.
            </span>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-md text-xs font-medium text-[#D1D5DB] hover:text-white hover:bg-white/[0.06] transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={modifiedCount === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                <Check className="h-3.5 w-3.5" />
                <span>
                  Apply to {modifiedCount} Track{modifiedCount === 1 ? '' : 's'}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
