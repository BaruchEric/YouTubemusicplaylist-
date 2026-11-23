import { useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  Check,
  Disc3,
  ExternalLink,
  Filter,
  Link2,
  ListPlus,
  Pause,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import type { LocalTrack, TrackPlayStats } from '../types/music';
import {
  CUSTOM_FILTER_FIELDS,
  QUICK_CRITERIA,
  createEmptyCustomRule,
  evaluateQuickCriterion,
  filterTracksBySmartCriteria,
  hasValidYearTag,
  isTrackMissingGenre,
  loadSavedSmartFilters,
  saveSavedSmartFilters,
  type CustomFilterField,
  type CustomFilterOperator,
  type CustomFilterRule,
  type QuickCriterionId,
  type SavedDashboardSmartFilter,
  type SmartFilterMatchMode,
} from '../utils/dashboardSmartFilters';
import type { InferredGenreResult } from '../utils/genreInference';
import type { ShuffleMode } from '../utils/smartShuffle';
import {
  buildTrackYouTubeMusicUrl,
  formatDuration,
  formatTotalRuntime,
} from '../utils/youtubeLinks';

type ResultSortMode = 'default' | 'duration-desc' | 'duration-asc' | 'title' | 'year' | 'plays';

const INITIAL_VISIBLE_ROWS = 12;

interface DashboardSmartFilterProps {
  tracks: LocalTrack[];
  trackGenreMap: Map<string, InferredGenreResult>;
  playStats: Record<string, TrackPlayStats>;
  activePlayingTrackId: string | null;
  isAudioPlaying: boolean;
  onPlayTrack: (trackId: string, queueIds: string[]) => void;
  onPlayList: (trackIds: string[], options?: { shuffle?: boolean | ShuffleMode }) => void;
  onCreatePlaylistFromTracks: (trackIds: string[]) => void;
  onInspectTrack: (trackId: string) => void;
  onOpenBatchTagEditor?: (trackIds: string[], contextLabel: string) => void;
}

export function DashboardSmartFilter({
  tracks,
  trackGenreMap,
  playStats,
  activePlayingTrackId,
  isAudioPlaying,
  onPlayTrack,
  onPlayList,
  onCreatePlaylistFromTracks,
  onInspectTrack,
  onOpenBatchTagEditor,
}: DashboardSmartFilterProps) {
  const [selectedQuickIds, setSelectedQuickIds] = useState<QuickCriterionId[]>([]);
  const [customRules, setCustomRules] = useState<CustomFilterRule[]>([]);
  const [matchMode, setMatchMode] = useState<SmartFilterMatchMode>('all');
  const [builderOpen, setBuilderOpen] = useState(false);

  const [savedFilters, setSavedFilters] = useState<SavedDashboardSmartFilter[]>(() =>
    loadSavedSmartFilters()
  );
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);

  const [inlineSearch, setInlineSearch] = useState('');
  const [sortBy, setSortBy] = useState<ResultSortMode>('default');
  const [showAllRows, setShowAllRows] = useState(false);

  useEffect(() => {
    saveSavedSmartFilters(savedFilters);
  }, [savedFilters]);

  // Live count for each built-in quick criterion
  const quickCounts = useMemo(() => {
    const counts = new Map<QuickCriterionId, number>();
    for (const def of QUICK_CRITERIA) {
      let n = 0;
      for (const track of tracks) {
        if (evaluateQuickCriterion(track, def.id, playStats, trackGenreMap)) {
          n += 1;
        }
      }
      counts.set(def.id, n);
    }
    return counts;
  }, [tracks, playStats, trackGenreMap]);

  // Live count for each saved custom filter
  const savedFilterCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const sf of savedFilters) {
      map.set(
        sf.id,
        filterTracksBySmartCriteria(
          tracks,
          sf.quickIds,
          sf.rules,
          sf.matchMode,
          playStats,
          trackGenreMap
        ).length
      );
    }
    return map;
  }, [savedFilters, tracks, playStats, trackGenreMap]);

  const hasActiveFilter = selectedQuickIds.length > 0 || customRules.length > 0;
  const totalCriteriaCount = selectedQuickIds.length + customRules.length;

  const matchedTracks = useMemo(() => {
    if (!hasActiveFilter) return [];
    return filterTracksBySmartCriteria(
      tracks,
      selectedQuickIds,
      customRules,
      matchMode,
      playStats,
      trackGenreMap
    );
  }, [hasActiveFilter, tracks, selectedQuickIds, customRules, matchMode, playStats, trackGenreMap]);

  const displayedTracks = useMemo(() => {
    const q = inlineSearch.trim().toLowerCase();
    const filtered = q
      ? matchedTracks.filter((t) => {
          const genre = trackGenreMap.get(t.id)?.genre ?? t.genre ?? '';
          return (
            t.title.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            t.album.toLowerCase().includes(q) ||
            genre.toLowerCase().includes(q) ||
            (t.year || '').includes(q)
          );
        })
      : matchedTracks;

    if (sortBy === 'default') return filtered;

    return [...filtered].sort((a, b) => {
      if (sortBy === 'duration-desc') return (b.duration || 0) - (a.duration || 0);
      if (sortBy === 'duration-asc') return (a.duration || 0) - (b.duration || 0);
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      if (sortBy === 'year') {
        const ay = parseInt(a.year || '0', 10) || 0;
        const by = parseInt(b.year || '0', 10) || 0;
        return by - ay || a.title.localeCompare(b.title);
      }
      const ap = playStats[a.id]?.playCount ?? a.playCount ?? 0;
      const bp = playStats[b.id]?.playCount ?? b.playCount ?? 0;
      return bp - ap || a.title.localeCompare(b.title);
    });
  }, [matchedTracks, inlineSearch, sortBy, trackGenreMap, playStats]);

  const displayedTrackIds = useMemo(() => displayedTracks.map((t) => t.id), [displayedTracks]);
  const totalMatchedDuration = useMemo(
    () => displayedTracks.reduce((acc, t) => acc + (t.duration || 0), 0),
    [displayedTracks]
  );

  const visibleTracks = showAllRows
    ? displayedTracks
    : displayedTracks.slice(0, INITIAL_VISIBLE_ROWS);

  const activeFilterLabel = useMemo(() => {
    if (activeSavedId) {
      const sf = savedFilters.find((f) => f.id === activeSavedId);
      if (sf) return sf.name;
    }
    const labels: string[] = [];
    for (const id of selectedQuickIds) {
      const def = QUICK_CRITERIA.find((q) => q.id === id);
      if (def) labels.push(def.label);
    }
    if (customRules.length > 0) {
      labels.push(`${customRules.length} custom ${customRules.length === 1 ? 'rule' : 'rules'}`);
    }
    return labels.join(matchMode === 'all' ? ' + ' : ' or ') || 'Smart Filter';
  }, [activeSavedId, savedFilters, selectedQuickIds, customRules.length, matchMode]);

  const handleToggleQuick = (id: QuickCriterionId) => {
    setActiveSavedId(null);
    setShowAllRows(false);
    setSelectedQuickIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleActivateSaved = (sf: SavedDashboardSmartFilter) => {
    if (activeSavedId === sf.id) {
      handleClearAll();
      return;
    }
    setActiveSavedId(sf.id);
    setSelectedQuickIds([...sf.quickIds]);
    setCustomRules(sf.rules.map((r) => ({ ...r })));
    setMatchMode(sf.matchMode);
    setShowAllRows(false);
    setBuilderOpen(sf.rules.length > 0);
  };

  const handleDeleteSaved = (id: string) => {
    setSavedFilters((prev) => prev.filter((sf) => sf.id !== id));
    if (activeSavedId === id) {
      setActiveSavedId(null);
    }
  };

  const handleAddRule = () => {
    setActiveSavedId(null);
    setBuilderOpen(true);
    setCustomRules((prev) => [...prev, createEmptyCustomRule('durationMin')]);
  };

  const handleUpdateRuleField = (ruleId: string, nextField: CustomFilterField) => {
    setActiveSavedId(null);
    const meta =
      CUSTOM_FILTER_FIELDS.find((f) => f.field === nextField) ?? CUSTOM_FILTER_FIELDS[0];
    const firstOp = meta.operators[0];
    let defaultVal = '';
    if (firstOp.needsValue) {
      if (nextField === 'durationMin') defaultVal = '10';
      else if (nextField === 'format') defaultVal = 'FLAC';
      else if (nextField === 'matchStatus') defaultVal = 'unmatched';
      else if (nextField === 'playCount') defaultVal = '0';
    }
    setCustomRules((prev) =>
      prev.map((r) =>
        r.id === ruleId ? { ...r, field: nextField, operator: firstOp.op, value: defaultVal } : r
      )
    );
  };

  const handleUpdateRuleOperator = (ruleId: string, nextOp: CustomFilterOperator) => {
    setActiveSavedId(null);
    setCustomRules((prev) =>
      prev.map((r) => {
        if (r.id !== ruleId) return r;
        const meta = CUSTOM_FILTER_FIELDS.find((f) => f.field === r.field);
        const opMeta = meta?.operators.find((o) => o.op === nextOp);
        return {
          ...r,
          operator: nextOp,
          value: opMeta?.needsValue ? r.value : '',
        };
      })
    );
  };

  const handleUpdateRuleValue = (ruleId: string, nextValue: string) => {
    setActiveSavedId(null);
    setCustomRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, value: nextValue } : r))
    );
  };

  const handleRemoveRule = (ruleId: string) => {
    setActiveSavedId(null);
    setCustomRules((prev) => prev.filter((r) => r.id !== ruleId));
  };

  const handleSaveCurrentFilter = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = saveName.trim();
    if (!trimmed || !hasActiveFilter) return;

    const next: SavedDashboardSmartFilter = {
      id: `sf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      matchMode,
      quickIds: [...selectedQuickIds],
      rules: customRules.map((r) => ({ ...r })),
      createdAt: Date.now(),
    };
    setSavedFilters((prev) => [next, ...prev]);
    setActiveSavedId(next.id);
    setSaveName('');
    setShowSaveInput(false);
  };

  const handleClearAll = () => {
    setSelectedQuickIds([]);
    setCustomRules([]);
    setActiveSavedId(null);
    setInlineSearch('');
    setSortBy('default');
    setShowAllRows(false);
    setShowSaveInput(false);
    setBuilderOpen(false);
  };

  if (tracks.length === 0) return null;

  return (
    <section
      aria-label="Dashboard Smart Filter"
      className="rounded-lg border border-white/[0.08] bg-[#12141A] overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-[#FF4D64] shrink-0" />
            <h2 className="font-display text-base font-semibold text-white truncate">
              Smart Filter
            </h2>
            {hasActiveFilter && (
              <span className="text-xs font-mono tabular-nums text-[#FF4D64] whitespace-nowrap">
                · {displayedTracks.length} match{displayedTracks.length === 1 ? '' : 'es'}
              </span>
            )}
          </div>
          <p className="text-xs text-[#717786] mt-0.5">
            {hasActiveFilter
              ? `Showing tracks matching ${activeFilterLabel} without leaving the dashboard`
              : 'Select one or more criteria or build a custom filter to inspect matching tracks inline'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {totalCriteriaCount >= 2 && (
            <div
              className="inline-flex items-center p-0.5 rounded bg-[#0C0E13] border border-white/[0.08]"
              role="group"
              aria-label="Criteria match logic"
            >
              <button
                type="button"
                onClick={() => {
                  setActiveSavedId(null);
                  setMatchMode('all');
                }}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  matchMode === 'all'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                Match All
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveSavedId(null);
                  setMatchMode('any');
                }}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                  matchMode === 'any'
                    ? 'bg-white/[0.12] text-white'
                    : 'text-[#8B92A2] hover:text-white'
                }`}
              >
                Match Any
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              if (!builderOpen && customRules.length === 0) {
                setCustomRules([createEmptyCustomRule('durationMin')]);
              }
              setBuilderOpen((prev) => !prev);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors whitespace-nowrap ${
              builderOpen
                ? 'bg-white/[0.1] border-white/[0.16] text-white'
                : 'bg-[#161920] border-white/[0.09] text-[#D1D5DB] hover:bg-[#1E222B] hover:text-white'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Custom Rules</span>
          </button>

          {hasActiveFilter && (
            <button
              type="button"
              onClick={handleClearAll}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-[#8B92A2] hover:text-white transition-colors whitespace-nowrap"
            >
              <X className="h-3.5 w-3.5" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Quick Criteria Selector Bar + Saved Custom Filters */}
      <div className="px-5 py-3.5 bg-[#0F1116]/60 border-b border-white/[0.07] space-y-2.5">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Quick smart filter criteria"
        >
          {QUICK_CRITERIA.map((item) => {
            const count = quickCounts.get(item.id) ?? 0;
            if (item.hideWhenZero && count === 0) return null;
            const isActive = selectedQuickIds.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => handleToggleQuick(item.id)}
                title={item.shortDescription}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-[#FF1F3D]/18 border-[#FF1F3D]/50 text-white'
                    : 'bg-[#151820] border-white/[0.08] text-[#B4BAC6] hover:border-white/[0.16] hover:text-white'
                }`}
              >
                <span>{item.label}</span>
                <span
                  className={`font-mono tabular-nums text-[11px] ${
                    isActive ? 'text-[#FF8A9A]' : 'text-[#6B7280]'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* User-Created Saved Smart Filters */}
        {savedFilters.length > 0 && (
          <div className="pt-2 border-t border-white/[0.06] flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] text-[#717786] mr-1">
              <Bookmark className="h-3 w-3" />
              <span>Saved:</span>
            </span>
            {savedFilters.map((sf) => {
              const isSelected = activeSavedId === sf.id;
              const count = savedFilterCounts.get(sf.id) ?? 0;
              return (
                <div
                  key={sf.id}
                  className={`inline-flex items-center rounded border text-xs transition-colors ${
                    isSelected
                      ? 'bg-white/[0.12] border-white/[0.24] text-white'
                      : 'bg-[#151820] border-white/[0.08] text-[#D1D5DB] hover:border-white/[0.16]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleActivateSaved(sf)}
                    className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 font-medium whitespace-nowrap"
                  >
                    <span>{sf.name}</span>
                    <span className="font-mono tabular-nums text-[11px] text-[#8B92A2]">
                      {count}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSaved(sf.id)}
                    aria-label={`Delete saved filter ${sf.name}`}
                    title={`Delete ${sf.name}`}
                    className="px-1.5 py-1 text-[#6B7280] hover:text-[#EF4444] transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Inline Custom Filter Rule Builder */}
      {builderOpen && (
        <div className="px-5 py-4 border-b border-white/[0.07] bg-[#0D0F14] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium text-[#D1D5DB]">
              Custom Filter Conditions
            </div>
            <button
              type="button"
              onClick={handleAddRule}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add condition</span>
            </button>
          </div>

          {customRules.length === 0 ? (
            <div className="text-xs text-[#6B7280]">
              Click &ldquo;Add condition&rdquo; to filter by duration, year, genre, format, play
              count, or artwork.
            </div>
          ) : (
            <div className="space-y-2">
              {customRules.map((rule) => {
                const fieldMeta =
                  CUSTOM_FILTER_FIELDS.find((f) => f.field === rule.field) ??
                  CUSTOM_FILTER_FIELDS[0];
                const opMeta =
                  fieldMeta.operators.find((o) => o.op === rule.operator) ?? fieldMeta.operators[0];

                return (
                  <div
                    key={rule.id}
                    className="flex flex-wrap sm:flex-nowrap items-center gap-2 text-xs"
                  >
                    <select
                      value={rule.field}
                      onChange={(e) =>
                        handleUpdateRuleField(rule.id, e.target.value as CustomFilterField)
                      }
                      aria-label="Filter field"
                      className="rounded bg-[#161922] border border-white/[0.1] px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#FF1F3D]/60"
                    >
                      {CUSTOM_FILTER_FIELDS.map((f) => (
                        <option key={f.field} value={f.field}>
                          {f.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={rule.operator}
                      onChange={(e) =>
                        handleUpdateRuleOperator(rule.id, e.target.value as CustomFilterOperator)
                      }
                      aria-label="Filter operator"
                      className="rounded bg-[#161922] border border-white/[0.1] px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#FF1F3D]/60"
                    >
                      {fieldMeta.operators.map((op) => (
                        <option key={op.op} value={op.op}>
                          {op.label}
                        </option>
                      ))}
                    </select>

                    {opMeta.needsValue &&
                      (fieldMeta.inputType === 'select' && fieldMeta.selectOptions ? (
                        <select
                          value={rule.value}
                          onChange={(e) => handleUpdateRuleValue(rule.id, e.target.value)}
                          aria-label="Filter value"
                          className="flex-1 min-w-[120px] rounded bg-[#161922] border border-white/[0.1] px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#FF1F3D]/60"
                        >
                          {fieldMeta.selectOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={fieldMeta.inputType}
                          value={rule.value}
                          onChange={(e) => handleUpdateRuleValue(rule.id, e.target.value)}
                          placeholder={fieldMeta.placeholder}
                          aria-label="Filter value"
                          className="flex-1 min-w-[120px] rounded bg-[#161922] border border-white/[0.1] px-2.5 py-1.5 text-xs text-white placeholder-[#6B7280] font-mono tabular-nums focus:outline-none focus:border-[#FF1F3D]/60"
                        />
                      ))}

                    <button
                      type="button"
                      onClick={() => handleRemoveRule(rule.id)}
                      aria-label="Remove condition"
                      className="p-1.5 rounded text-[#717786] hover:text-[#EF4444] hover:bg-white/[0.06] transition-colors shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Save Custom Filter Form */}
          {hasActiveFilter && (
            <div className="pt-2.5 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-2">
              {showSaveInput ? (
                <form
                  onSubmit={handleSaveCurrentFilter}
                  className="flex flex-wrap items-center gap-2 flex-1"
                >
                  <input
                    type="text"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="Filter name (e.g. Long Untagged Mixes)"
                    autoFocus
                    className="flex-1 min-w-[180px] rounded bg-[#161922] border border-white/[0.12] px-2.5 py-1.5 text-xs text-white placeholder-[#6B7280] focus:outline-none focus:border-[#FF1F3D]/60"
                  />
                  <button
                    type="submit"
                    disabled={!saveName.trim()}
                    className="px-3 py-1.5 rounded text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-40 transition-colors whitespace-nowrap"
                  >
                    Save Filter
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSaveInput(false);
                      setSaveName('');
                    }}
                    className="px-2 py-1.5 text-xs text-[#8B92A2] hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setSaveName(activeFilterLabel);
                    setShowSaveInput(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#D1D5DB] hover:text-white transition-colors whitespace-nowrap"
                >
                  <Bookmark className="h-3.5 w-3.5 text-[#FF4D64]" />
                  <span>Save this Smart Filter for quick access</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Inline Filtered Track Results (renders directly inside Dashboard without leaving view) */}
      {hasActiveFilter && (
        <div>
          {/* Results Action Bar */}
          <div className="px-5 py-3 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-3 bg-[#12141A]">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <span className="text-xs font-mono tabular-nums text-white font-medium whitespace-nowrap">
                {displayedTracks.length}{' '}
                {displayedTracks.length === 1 ? 'track' : 'tracks'}
              </span>
              <span className="text-[#4B5563]" aria-hidden="true">
                ·
              </span>
              <span className="text-xs font-mono tabular-nums text-[#8B92A2] whitespace-nowrap">
                {formatTotalRuntime(totalMatchedDuration)}
              </span>

              {matchedTracks.length > 0 && (
                <div className="relative flex items-center ml-1">
                  <Search className="h-3 w-3 text-[#6B7280] absolute left-2.5 pointer-events-none" />
                  <input
                    type="text"
                    value={inlineSearch}
                    onChange={(e) => setInlineSearch(e.target.value)}
                    placeholder="Refine results..."
                    aria-label="Refine smart filter results"
                    className="w-36 sm:w-44 rounded bg-[#0C0E13] border border-white/[0.08] pl-7 pr-2 py-1 text-xs text-white placeholder-[#6B7280] focus:outline-none focus:border-white/[0.2]"
                  />
                </div>
              )}

              {matchedTracks.length > 1 && (
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as ResultSortMode)}
                  aria-label="Sort matching tracks"
                  className="rounded bg-[#0C0E13] border border-white/[0.08] px-2 py-1 text-xs text-[#D1D5DB] focus:outline-none focus:border-white/[0.2]"
                >
                  <option value="default">Sort: Library Order</option>
                  <option value="duration-desc">Duration (Longest)</option>
                  <option value="duration-asc">Duration (Shortest)</option>
                  <option value="title">Title (A–Z)</option>
                  <option value="year">Year (Newest)</option>
                  <option value="plays">Most Played</option>
                </select>
              )}
            </div>

            {displayedTracks.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onPlayList(displayedTrackIds, { shuffle: false })}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#0B0C0E] bg-white hover:bg-[#E5E7EB] transition-colors whitespace-nowrap"
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>Play All</span>
                </button>
                {onOpenBatchTagEditor && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenBatchTagEditor(
                        displayedTrackIds,
                        `${activeFilterLabel} (${displayedTracks.length} tracks)`
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
                  >
                    <Tags className="h-3 w-3" />
                    <span>Batch Tag ({displayedTracks.length})</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onCreatePlaylistFromTracks(displayedTrackIds)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#D1D5DB] bg-[#161920] border border-white/[0.09] hover:bg-[#1E222B] hover:text-white transition-colors whitespace-nowrap"
                >
                  <ListPlus className="h-3.5 w-3.5" />
                  <span>Playlist</span>
                </button>
                {!builderOpen && !activeSavedId && (
                  <button
                    type="button"
                    onClick={() => {
                      setBuilderOpen(true);
                      setSaveName(activeFilterLabel);
                      setShowSaveInput(true);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded text-xs text-[#8B92A2] hover:text-white transition-colors whitespace-nowrap"
                    title="Save current filter preset"
                  >
                    <Bookmark className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Save</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Results List */}
          {displayedTracks.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-[#8B92A2]">
              <p>
                No tracks match{' '}
                <span className="text-white font-medium">{activeFilterLabel}</span>
                {inlineSearch.trim() ? ` with "${inlineSearch.trim()}"` : ''}.
              </p>
              <button
                type="button"
                onClick={inlineSearch.trim() ? () => setInlineSearch('') : handleClearAll}
                className="mt-2.5 text-xs font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors"
              >
                {inlineSearch.trim() ? 'Clear search text' : 'Reset smart filter'}
              </button>
            </div>
          ) : (
            <>
              <div className="divide-y divide-white/[0.05] text-xs">
                {visibleTracks.map((track) => {
                  const isActive = activePlayingTrackId === track.id;
                  const missingGenre = isTrackMissingGenre(track, trackGenreMap);
                  const missingYear = !hasValidYearTag(track);
                  const resolvedGenre =
                    trackGenreMap.get(track.id)?.genre ?? track.genre ?? 'Unclassified';
                  const plays = playStats[track.id]?.playCount ?? track.playCount ?? 0;

                  return (
                    <div
                      key={track.id}
                      className="px-5 py-2.5 flex items-center justify-between gap-4 hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => onPlayTrack(track.id, displayedTrackIds)}
                          aria-label={
                            isActive && isAudioPlaying
                              ? `Pause ${track.title}`
                              : `Play ${track.title}`
                          }
                          className={`h-7 w-7 rounded flex items-center justify-center shrink-0 transition-colors ${
                            isActive
                              ? 'text-[#FF1F3D] bg-[#FF1F3D]/10'
                              : 'text-[#8B92A2] hover:text-white hover:bg-white/[0.07]'
                          }`}
                        >
                          {isActive && isAudioPlaying ? (
                            <Pause className="h-3.5 w-3.5 fill-current" />
                          ) : (
                            <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                          )}
                        </button>

                        <div className="h-8 w-8 rounded bg-[#181B22] border border-white/[0.06] overflow-hidden flex items-center justify-center shrink-0">
                          {track.coverArtUrl ? (
                            <img
                              src={track.coverArtUrl}
                              alt={`${track.title} cover`}
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Disc3 className="h-3.5 w-3.5 text-[#525866]" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-white truncate">{track.title}</div>
                          <div className="text-[11px] text-[#8B92A2] truncate">
                            <span>{track.artist}</span>
                            <span aria-hidden="true"> · </span>
                            <span>{track.album}</span>
                            <span aria-hidden="true"> · </span>
                            <span className={missingGenre ? 'text-[#F59E0B]' : 'text-[#8B92A2]'}>
                              {missingGenre ? 'No genre' : resolvedGenre}
                            </span>
                            <span aria-hidden="true"> · </span>
                            <span
                              className={`font-mono tabular-nums ${
                                missingYear ? 'text-[#F59E0B]' : 'text-[#8B92A2]'
                              }`}
                            >
                              {missingYear ? 'No year' : track.year}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <span className="font-mono tabular-nums text-[11px] text-[#8B92A2] hidden md:inline">
                          {track.format} · {formatDuration(track.duration)}
                          {plays > 0 ? ` · ${plays}×` : ''}
                        </span>
                        <a
                          href={buildTrackYouTubeMusicUrl(track)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#A1A7B5] hover:text-[#FF4D64] transition-colors whitespace-nowrap hidden sm:inline-flex"
                          title="Open in YouTube Music"
                        >
                          <span>YT Music</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <button
                          type="button"
                          onClick={() => onInspectTrack(track.id)}
                          className={`inline-flex items-center gap-1 whitespace-nowrap transition-colors ${
                            track.youtubeVideoId
                              ? 'text-[#22C55E] font-mono'
                              : 'text-[#D1D5DB] hover:text-white'
                          }`}
                        >
                          {track.youtubeVideoId ? (
                            <>
                              <Check className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">{track.youtubeVideoId}</span>
                            </>
                          ) : (
                            <>
                              <Link2 className="h-3.5 w-3.5 text-[#8B92A2]" />
                              <span>Match</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {displayedTracks.length > INITIAL_VISIBLE_ROWS && (
                <div className="px-5 py-2.5 border-t border-white/[0.07] bg-[#0F1116]/50 flex items-center justify-between text-xs">
                  <span className="font-mono tabular-nums text-[#717786]">
                    Showing {visibleTracks.length} of {displayedTracks.length} matching tracks
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAllRows((prev) => !prev)}
                    className="font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors whitespace-nowrap"
                  >
                    {showAllRows
                      ? `Show first ${INITIAL_VISIBLE_ROWS}`
                      : `Show all ${displayedTracks.length} tracks`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
