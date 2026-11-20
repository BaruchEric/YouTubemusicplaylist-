import { useEffect, useMemo, useState } from 'react';
import { Plus, SlidersHorizontal, Trash2, X } from 'lucide-react';
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
import { inferTrackGenre } from '../utils/genreInference';
import {
  SMART_PLAYLIST_PRESETS,
  SMART_RULE_FIELD_LIST,
  SMART_RULE_FIELD_META,
  SMART_RULE_OPERATOR_LABELS,
  SMART_SORT_OPTIONS,
  createBlankRule,
  createRuleId,
  evaluateSmartPlaylist,
  type SmartPlaylistPreset,
} from '../utils/smartPlaylists';

export interface SmartPlaylistFormPayload {
  name: string;
  description: string;
  matchMode: SmartPlaylistMatchMode;
  rules: SmartPlaylistRule[];
  sortBy: SmartPlaylistSortBy;
  sortDir: SmartPlaylistSortDir;
  excludeMissing: boolean;
}

interface SmartPlaylistModalProps {
  isOpen: boolean;
  editingPlaylist: SmartPlaylist | null;
  tracks: LocalTrack[];
  playStats: Record<string, TrackPlayStats>;
  availableFolders: string[];
  onClose: () => void;
  onSave: (payload: SmartPlaylistFormPayload, editingId?: string) => void;
}

export function SmartPlaylistModal({
  isOpen,
  editingPlaylist,
  tracks,
  playStats,
  availableFolders,
  onClose,
  onSave,
}: SmartPlaylistModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [matchMode, setMatchMode] = useState<SmartPlaylistMatchMode>('all');
  const [rules, setRules] = useState<SmartPlaylistRule[]>([createBlankRule('genre')]);
  const [sortBy, setSortBy] = useState<SmartPlaylistSortBy>('addedAt');
  const [sortDir, setSortDir] = useState<SmartPlaylistSortDir>('desc');
  const [excludeMissing, setExcludeMissing] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    if (editingPlaylist) {
      setName(editingPlaylist.name);
      setDescription(editingPlaylist.description);
      setMatchMode(editingPlaylist.matchMode);
      setRules(
        editingPlaylist.rules.length > 0
          ? editingPlaylist.rules.map((r) => ({ ...r }))
          : [createBlankRule('genre')]
      );
      setSortBy(editingPlaylist.sortBy);
      setSortDir(editingPlaylist.sortDir);
      setExcludeMissing(editingPlaylist.excludeMissing);
    } else {
      setName('');
      setDescription('');
      setMatchMode('all');
      setRules([createBlankRule('genre')]);
      setSortBy('addedAt');
      setSortDir('desc');
      setExcludeMissing(true);
    }
  }, [isOpen, editingPlaylist]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const availableGenres = useMemo(() => {
    const set = new Set<string>();
    for (const t of tracks) {
      const g = inferTrackGenre(t).genre;
      if (g && g !== 'Unclassified') set.add(g);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tracks]);

  const availableFormats = useMemo(() => {
    const set = new Set<string>(['FLAC', 'MP3', 'M4A', 'WAV', 'OGG', 'OPUS', 'AAC']);
    for (const t of tracks) {
      if (t.format) set.add(t.format.toUpperCase());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tracks]);

  const liveMatches = useMemo(() => {
    if (!isOpen) return [];
    return evaluateSmartPlaylist(
      {
        matchMode,
        rules,
        sortBy,
        sortDir,
        excludeMissing,
      },
      tracks,
      playStats
    );
  }, [isOpen, matchMode, rules, sortBy, sortDir, excludeMissing, tracks, playStats]);

  if (!isOpen) return null;

  const applyPreset = (preset: SmartPlaylistPreset) => {
    setName(preset.name);
    setDescription(preset.description);
    setMatchMode(preset.matchMode);
    setRules(
      preset.rules.map((r) => ({
        id: createRuleId(),
        field: r.field,
        operator: r.operator,
        value: r.value,
      }))
    );
    setSortBy(preset.sortBy);
    setSortDir(preset.sortDir);
    setExcludeMissing(preset.excludeMissing);
  };

  const handleRuleFieldChange = (ruleId: string, nextField: SmartRuleField) => {
    const meta = SMART_RULE_FIELD_META[nextField];
    setRules((prev) =>
      prev.map((rule) => {
        if (rule.id !== ruleId) return rule;
        const keepOperator = meta.operators.includes(rule.operator)
          ? rule.operator
          : meta.defaultOperator;
        return {
          ...rule,
          field: nextField,
          operator: keepOperator,
          value: meta.kind === 'select' ? meta.defaultValue : meta.defaultValue,
        };
      })
    );
  };

  const handleRuleOperatorChange = (ruleId: string, operator: SmartRuleOperator) => {
    setRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, operator } : r)));
  };

  const handleRuleValueChange = (ruleId: string, value: string) => {
    setRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, value } : r)));
  };

  const handleAddRule = () => {
    setRules((prev) => [...prev, createBlankRule('artist')]);
  };

  const handleRemoveRule = (ruleId: string) => {
    setRules((prev) => {
      const next = prev.filter((r) => r.id !== ruleId);
      return next.length > 0 ? next : [createBlankRule('genre')];
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;

    const cleanedRules = rules
      .map((r) => ({ ...r, value: r.value.trim() }))
      .filter((r) => r.value.length > 0);

    onSave(
      {
        name: cleanName,
        description: description.trim(),
        matchMode,
        rules: cleanedRules,
        sortBy,
        sortDir,
        excludeMissing,
      },
      editingPlaylist?.id
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="smart-playlist-modal-title"
    >
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-lg bg-[#14171D] border border-white/[0.1] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <SlidersHorizontal className="h-4 w-4 text-[#FF4D64] shrink-0" />
            <h2
              id="smart-playlist-modal-title"
              className="font-display text-lg font-semibold text-white truncate"
            >
              {editingPlaylist ? 'Edit Smart Playlist' : 'Create Smart Playlist'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* One-click templates in Create mode */}
            {!editingPlaylist && (
              <div className="space-y-2">
                <div className="text-[11px] font-medium uppercase tracking-wider text-[#8B92A2]">
                  Quick Templates
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SMART_PLAYLIST_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="px-2.5 py-1.5 rounded bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.07] text-xs text-[#D1D5DB] hover:text-white transition-colors whitespace-nowrap"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Name & Description */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="sp-name" className="block text-xs font-medium text-[#D1D5DB]">
                  Smart Playlist Name
                </label>
                <input
                  id="sp-name"
                  type="text"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Late Night Electronic, Heavy Rotation"
                  className="w-full px-3.5 py-2 rounded-md bg-[#0D0F13] border border-white/[0.1] text-sm text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="sp-desc" className="block text-xs font-medium text-[#D1D5DB]">
                  Description (optional)
                </label>
                <input
                  id="sp-desc"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Auto-updated rule-based playlist"
                  className="w-full px-3.5 py-2 rounded-md bg-[#0D0F13] border border-white/[0.1] text-sm text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                />
              </div>
            </div>

            {/* Rules Builder */}
            <div className="pt-4 border-t border-white/[0.07] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-[#D1D5DB]">
                  <span>Include tracks matching</span>
                  <select
                    aria-label="Rule match logic"
                    value={matchMode}
                    onChange={(e) => setMatchMode(e.target.value as SmartPlaylistMatchMode)}
                    className="px-2.5 py-1 rounded bg-[#0D0F13] border border-white/[0.12] text-xs font-medium text-white focus:border-[#FF1F3D] focus:outline-none"
                  >
                    <option value="all">ALL rules (AND)</option>
                    <option value="any">ANY rule (OR)</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleAddRule}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-[#FF4D64] hover:text-white hover:bg-[#FF1F3D]/15 transition-colors whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Rule</span>
                </button>
              </div>

              <div className="space-y-2">
                {rules.map((rule) => {
                  const meta = SMART_RULE_FIELD_META[rule.field];
                  const datalistId =
                    rule.field === 'genre'
                      ? 'sp-genres-list'
                      : rule.field === 'format'
                        ? 'sp-formats-list'
                        : rule.field === 'folderName'
                          ? 'sp-folders-list'
                          : undefined;

                  return (
                    <div
                      key={rule.id}
                      className="grid grid-cols-1 sm:grid-cols-[150px_145px_1fr_auto] gap-2 items-center p-2.5 rounded-md bg-[#0E1015] border border-white/[0.07]"
                    >
                      <select
                        aria-label="Rule field"
                        value={rule.field}
                        onChange={(e) =>
                          handleRuleFieldChange(rule.id, e.target.value as SmartRuleField)
                        }
                        className="px-2.5 py-1.5 rounded bg-[#14171D] border border-white/[0.1] text-xs text-white focus:border-[#FF1F3D] focus:outline-none"
                      >
                        {SMART_RULE_FIELD_LIST.map((f) => (
                          <option key={f.field} value={f.field}>
                            {f.label}
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label="Rule operator"
                        value={rule.operator}
                        onChange={(e) =>
                          handleRuleOperatorChange(rule.id, e.target.value as SmartRuleOperator)
                        }
                        className="px-2.5 py-1.5 rounded bg-[#14171D] border border-white/[0.1] text-xs text-white focus:border-[#FF1F3D] focus:outline-none"
                      >
                        {meta.operators.map((op) => (
                          <option key={op} value={op}>
                            {SMART_RULE_OPERATOR_LABELS[op]}
                          </option>
                        ))}
                      </select>

                      {meta.kind === 'select' && meta.options ? (
                        <select
                          aria-label="Rule value"
                          value={rule.value}
                          onChange={(e) => handleRuleValueChange(rule.id, e.target.value)}
                          className="px-2.5 py-1.5 rounded bg-[#14171D] border border-white/[0.1] text-xs text-white focus:border-[#FF1F3D] focus:outline-none"
                        >
                          {meta.options.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={meta.kind === 'number' ? 'number' : 'text'}
                          min={meta.kind === 'number' ? 0 : undefined}
                          list={datalistId}
                          value={rule.value}
                          onChange={(e) => handleRuleValueChange(rule.id, e.target.value)}
                          placeholder={meta.placeholder}
                          aria-label="Rule value"
                          className="w-full px-2.5 py-1.5 rounded bg-[#14171D] border border-white/[0.1] text-xs text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                        />
                      )}

                      <button
                        type="button"
                        onClick={() => handleRemoveRule(rule.id)}
                        aria-label="Remove rule"
                        title="Remove rule"
                        className="p-1.5 rounded text-[#717786] hover:text-[#EF4444] hover:bg-white/[0.05] transition-colors justify-self-end"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Contextual autocomplete datalists */}
              <datalist id="sp-genres-list">
                {availableGenres.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
              <datalist id="sp-formats-list">
                {availableFormats.map((fmt) => (
                  <option key={fmt} value={fmt} />
                ))}
              </datalist>
              <datalist id="sp-folders-list">
                {availableFolders.map((folder) => (
                  <option key={folder} value={folder} />
                ))}
              </datalist>
            </div>

            {/* Sort & Missing filter */}
            <div className="pt-4 border-t border-white/[0.07] grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="sp-sort-by" className="block text-xs text-[#9CA3AF]">
                  Sort Tracks By
                </label>
                <select
                  id="sp-sort-by"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SmartPlaylistSortBy)}
                  className="w-full px-3 py-2 rounded-md bg-[#0D0F13] border border-white/[0.1] text-xs text-white focus:border-[#FF1F3D] focus:outline-none"
                >
                  {SMART_SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="sp-sort-dir" className="block text-xs text-[#9CA3AF]">
                  Order
                </label>
                <select
                  id="sp-sort-dir"
                  value={sortDir}
                  onChange={(e) => setSortDir(e.target.value as SmartPlaylistSortDir)}
                  className="w-full px-3 py-2 rounded-md bg-[#0D0F13] border border-white/[0.1] text-xs text-white focus:border-[#FF1F3D] focus:outline-none"
                >
                  <option value="desc">Descending (High → Low)</option>
                  <option value="asc">Ascending (Low → High)</option>
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={excludeMissing}
                onChange={(e) => setExcludeMissing(e.target.checked)}
                className="h-4 w-4 rounded accent-[#FF1F3D]"
              />
              <span className="text-xs text-[#D1D5DB]">
                Exclude tracks currently missing on device storage
              </span>
            </label>

            {/* Live Preview Strip */}
            <div className="rounded-md bg-[#0E1015] border border-white/[0.08] p-3.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#D1D5DB]">Live Rule Preview</span>
                <span className="font-mono text-xs tabular-nums text-white">
                  {liveMatches.length}{' '}
                  <span className="text-[#8B92A2]">/ {tracks.length} tracks matched</span>
                </span>
              </div>
              {liveMatches.length > 0 ? (
                <div className="text-[11px] text-[#8B92A2] truncate">
                  Top matches:{' '}
                  <span className="text-[#D1D5DB]">
                    {liveMatches
                      .slice(0, 3)
                      .map((t) => `${t.title} — ${t.artist}`)
                      .join(' · ')}
                  </span>
                </div>
              ) : (
                <div className="text-[11px] text-[#717786]">
                  No tracks currently match these rules. You can still save and it will auto-populate
                  as matching audio is scanned.
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2.5 px-6 py-4 bg-[#101217] border-t border-white/[0.07] shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md text-xs font-medium text-[#D1D5DB] hover:text-white hover:bg-white/[0.06] transition-colors whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
            >
              {editingPlaylist ? 'Save Changes' : 'Create Smart Playlist'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
