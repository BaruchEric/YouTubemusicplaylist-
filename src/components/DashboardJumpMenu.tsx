import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowUp,
  BarChart3,
  CalendarClock,
  Clock,
  Compass,
  CornerDownLeft,
  Disc3,
  Filter,
  FolderOpen,
  Grid2x2,
  History,
  LayoutGrid,
  ListMusic,
  Mic2,
  PieChart,
  Search,
  SlidersHorizontal,
  TrendingUp,
  X,
} from 'lucide-react';

export type DashboardSectionId =
  | 'overview'
  | 'smart-filter'
  | 'genres'
  | 'global-genres'
  | 'recommendations'
  | 'daily-listening'
  | 'weekly-habits'
  | 'listening-heatmap'
  | 'top-played'
  | 'albums'
  | 'tracks-added-trend'
  | 'recently-added'
  | 'playlists'
  | 'folders'
  | 'top-artists'
  | 'sync-history';

export type DashboardSectionGroup = 'Analytics' | 'Library' | 'Storage & Sync';

export interface DashboardSectionItem {
  id: DashboardSectionId;
  label: string;
  description: string;
  group: DashboardSectionGroup;
  metric: string;
  keywords: string[];
  icon:
    | 'overview'
    | 'smart-filter'
    | 'genres'
    | 'global-genres'
    | 'recommendations'
    | 'daily-listening'
    | 'weekly-habits'
    | 'listening-heatmap'
    | 'top-played'
    | 'albums'
    | 'tracks-added-trend'
    | 'recently-added'
    | 'playlists'
    | 'folders'
    | 'top-artists'
    | 'sync-history';
}

interface DashboardJumpMenuProps {
  sections: DashboardSectionItem[];
  activeSectionId: DashboardSectionId;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onJumpToSection: (sectionId: DashboardSectionId) => void;
  onScrollToTop: () => void;
}

function renderSectionIcon(icon: DashboardSectionItem['icon'], isActive: boolean) {
  const cls = `h-4 w-4 shrink-0 ${isActive ? 'text-[#FF4D64]' : 'text-[#8B92A2]'}`;
  switch (icon) {
    case 'overview':
      return <LayoutGrid className={cls} />;
    case 'smart-filter':
      return <Filter className={cls} />;
    case 'genres':
      return <PieChart className={cls} />;
    case 'global-genres':
      return <BarChart3 className={cls} />;
    case 'recommendations':
      return <SlidersHorizontal className={cls} />;
    case 'daily-listening':
      return <BarChart3 className={cls} />;
    case 'weekly-habits':
      return <CalendarClock className={cls} />;
    case 'listening-heatmap':
      return <Grid2x2 className={cls} />;
    case 'top-played':
      return <Activity className={cls} />;
    case 'albums':
      return <Disc3 className={cls} />;
    case 'tracks-added-trend':
      return <TrendingUp className={cls} />;
    case 'recently-added':
      return <Clock className={cls} />;
    case 'playlists':
      return <ListMusic className={cls} />;
    case 'folders':
      return <FolderOpen className={cls} />;
    case 'top-artists':
      return <Mic2 className={cls} />;
    case 'sync-history':
      return <History className={cls} />;
  }
}

const GROUP_ORDER: DashboardSectionGroup[] = ['Analytics', 'Library', 'Storage & Sync'];

export function DashboardJumpMenu({
  sections,
  activeSectionId,
  isOpen,
  onOpenChange,
  onJumpToSection,
  onScrollToTop,
}: DashboardJumpMenuProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Global keyboard shortcut: Cmd/Ctrl + J or bare 'j' when not typing in an input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        onOpenChange(!isOpen);
        return;
      }

      if (!isOpen && !isEditable && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === 'j') {
        e.preventDefault();
        onOpenChange(true);
        return;
      }

      if (isOpen && e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onOpenChange]);

  // Reset filter and focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      const currentIdx = Math.max(
        0,
        sections.findIndex((s) => s.id === activeSectionId)
      );
      setSelectedIndex(currentIdx);
      const timer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 20);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen, activeSectionId, sections]);

  const filteredSections = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return sections;

    const tokens = trimmed.split(/\s+/).filter(Boolean);
    return sections.filter((item) => {
      const haystack = `${item.label} ${item.description} ${item.group} ${item.keywords.join(' ')}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [sections, query]);

  // Keep selectedIndex in bounds as query narrows
  useEffect(() => {
    if (selectedIndex >= filteredSections.length) {
      setSelectedIndex(Math.max(0, filteredSections.length - 1));
    }
  }, [filteredSections.length, selectedIndex]);

  // Ensure keyboard-highlighted item stays scrolled into view inside the palette list
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>('[data-selected="true"]');
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, isOpen, query]);

  const groupedEntries = useMemo(() => {
    if (query.trim()) {
      return [
        {
          group: 'Matching Sections' as const,
          items: filteredSections.map((item, idx) => ({ item, flatIndex: idx })),
        },
      ];
    }

    const result: Array<{
      group: DashboardSectionGroup;
      items: Array<{ item: DashboardSectionItem; flatIndex: number }>;
    }> = [];

    let cursor = 0;
    for (const group of GROUP_ORDER) {
      const inGroup = filteredSections.filter((s) => s.group === group);
      if (inGroup.length > 0) {
        result.push({
          group,
          items: inGroup.map((item) => ({ item, flatIndex: cursor++ })),
        });
      }
    }
    return result;
  }, [filteredSections, query]);

  // Flat list in display order for arrow-key indexing
  const orderedItems = useMemo(
    () => groupedEntries.flatMap((g) => g.items.map((entry) => entry.item)),
    [groupedEntries]
  );

  const handleSelect = (sectionId: DashboardSectionId) => {
    onOpenChange(false);
    onJumpToSection(sectionId);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (orderedItems.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % orderedItems.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (orderedItems.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + orderedItems.length) % orderedItems.length);
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      setSelectedIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setSelectedIndex(Math.max(0, orderedItems.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = orderedItems[selectedIndex];
      if (target) {
        handleSelect(target.id);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 backdrop-blur-[2px] px-4 pt-[12vh] pb-6"
      role="dialog"
      aria-modal="true"
      aria-label="Jump to Dashboard Section"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-white/[0.12] bg-[#111319] shadow-2xl overflow-hidden flex flex-col max-h-[72vh]">
        {/* Search Input Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.08]">
          <Search className="h-4 w-4 text-[#717786] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Jump to section (e.g. Recently Added, Top Played, Folders)..."
            aria-label="Filter dashboard sections"
            className="flex-1 bg-transparent text-sm text-white placeholder-[#6B7280] focus:outline-none min-w-0"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSelectedIndex(0);
                inputRef.current?.focus();
              }}
              aria-label="Clear filter"
              className="p-1 rounded text-[#717786] hover:text-white transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-[11px] font-mono text-[#717786] hover:text-white px-1.5 py-0.5 rounded border border-white/[0.09] transition-colors shrink-0"
          >
            Esc
          </button>
        </div>

        {/* Section List */}
        <div ref={listRef} className="overflow-y-auto py-2 flex-1">
          {orderedItems.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <Compass className="h-5 w-5 text-[#525866] mx-auto" />
              <p className="mt-2 text-xs text-[#9CA3AF]">
                No dashboard sections match &ldquo;{query}&rdquo;
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setSelectedIndex(0);
                  inputRef.current?.focus();
                }}
                className="mt-2.5 text-xs font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors"
              >
                Show all sections
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {groupedEntries.map((groupBlock) => (
                <div key={groupBlock.group}>
                  <div className="px-4 py-1 text-[11px] font-medium text-[#6B7280]">
                    {groupBlock.group}
                  </div>
                  <div className="px-2">
                    {groupBlock.items.map(({ item, flatIndex }) => {
                      const isHighlighted = flatIndex === selectedIndex;
                      const isCurrent = item.id === activeSectionId;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          data-selected={isHighlighted ? 'true' : 'false'}
                          onMouseEnter={() => setSelectedIndex(flatIndex)}
                          onClick={() => handleSelect(item.id)}
                          className={`w-full flex items-center justify-between gap-3 px-2.5 py-2.5 rounded-md text-left transition-colors ${
                            isHighlighted
                              ? 'bg-white/[0.08] text-white'
                              : 'text-[#D1D5DB] hover:bg-white/[0.04]'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {renderSectionIcon(item.icon, isHighlighted || isCurrent)}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs font-medium text-white truncate">
                                  {item.label}
                                </span>
                                {isCurrent && (
                                  <span className="text-[11px] font-mono text-[#FF4D64] shrink-0">
                                    In view
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-[#717786] truncate">
                                {item.description}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5 shrink-0">
                            <span className="font-mono tabular-nums text-[11px] text-[#8B92A2] whitespace-nowrap">
                              {item.metric}
                            </span>
                            {isHighlighted && (
                              <CornerDownLeft className="h-3.5 w-3.5 text-[#717786]" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quiet Footer Controls */}
        <div className="px-4 py-2.5 border-t border-white/[0.08] bg-[#0D0F14] flex items-center justify-between gap-3 text-[11px] text-[#717786]">
          <div className="flex items-center gap-3 font-mono">
            <span>↑↓ Navigate</span>
            <span aria-hidden="true">·</span>
            <span>↵ Jump</span>
            <span aria-hidden="true">·</span>
            <span>J Toggle</span>
          </div>
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onScrollToTop();
            }}
            className="inline-flex items-center gap-1 text-[#A1A7B5] hover:text-white transition-colors whitespace-nowrap"
          >
            <ArrowUp className="h-3 w-3" />
            <span>Back to top</span>
          </button>
        </div>
      </div>
    </div>
  );
}
