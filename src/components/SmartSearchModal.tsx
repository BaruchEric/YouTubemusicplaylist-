import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Disc3,
  Layers,
  ListMusic,
  Pause,
  Play,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { LocalTrack, Playlist, TrackPlayStats } from '../types/music';
import {
  runGlobalSmartSearch,
  SMART_SEARCH_PRESETS,
} from '../utils/smartSearch';
import { formatDuration } from '../utils/youtubeLinks';

interface SmartSearchModalProps {
  open: boolean;
  tracks: LocalTrack[];
  playlists: Playlist[];
  playStats: Record<string, TrackPlayStats>;
  activePlayingTrackId: string | null;
  isAudioPlaying: boolean;
  onClose: () => void;
  onPlayTrack: (trackId: string, queueIds: string[]) => void;
  onPlayList: (trackIds: string[], options?: { shuffle?: boolean }) => void;
  onInspectTrack: (trackId: string) => void;
  onOpenPlaylist: (playlistId: string) => void;
  onOpenScannerWithQuery: (options: {
    query?: string;
    genre?: string;
    groupByGenre?: boolean;
    openCleanup?: boolean;
  }) => void;
}

type ResultActionItem =
  | { kind: 'track'; id: string; trackId: string; queueIds: string[] }
  | { kind: 'playlist'; id: string; playlistId: string }
  | { kind: 'album'; id: string; trackIds: string[] }
  | { kind: 'genre'; id: string; genre: string };

export function SmartSearchModal({
  open,
  tracks,
  playlists,
  playStats,
  activePlayingTrackId,
  isAudioPlaying,
  onClose,
  onPlayTrack,
  onPlayList,
  onInspectTrack,
  onOpenPlaylist,
  onOpenScannerWithQuery,
}: SmartSearchModalProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
    return () => window.clearTimeout(id);
  }, [open]);

  const searchResults = useMemo(
    () => runGlobalSmartSearch(query, tracks, playlists, playStats),
    [query, tracks, playlists, playStats]
  );

  const visibleTracks = useMemo(
    () => searchResults.tracks.slice(0, 8),
    [searchResults.tracks]
  );
  const visibleTrackQueue = useMemo(
    () => searchResults.tracks.map((r) => r.track.id),
    [searchResults.tracks]
  );
  const visiblePlaylists = useMemo(
    () => searchResults.playlists.slice(0, 4),
    [searchResults.playlists]
  );
  const visibleAlbums = useMemo(
    () => searchResults.albums.slice(0, 4),
    [searchResults.albums]
  );
  const visibleGenres = useMemo(
    () => searchResults.genres.slice(0, 4),
    [searchResults.genres]
  );

  const flatActions = useMemo<ResultActionItem[]>(() => {
    const items: ResultActionItem[] = [];
    for (const r of visibleTracks) {
      items.push({
        kind: 'track',
        id: `track:${r.track.id}`,
        trackId: r.track.id,
        queueIds: visibleTrackQueue,
      });
    }
    for (const r of visiblePlaylists) {
      items.push({
        kind: 'playlist',
        id: `playlist:${r.playlist.id}`,
        playlistId: r.playlist.id,
      });
    }
    for (const a of visibleAlbums) {
      items.push({
        kind: 'album',
        id: `album:${a.key}`,
        trackIds: a.trackIds,
      });
    }
    for (const g of visibleGenres) {
      items.push({
        kind: 'genre',
        id: `genre:${g.genre}`,
        genre: g.genre,
      });
    }
    return items;
  }, [visibleTracks, visibleTrackQueue, visiblePlaylists, visibleAlbums, visibleGenres]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const executeAction = (item: ResultActionItem) => {
    if (item.kind === 'track') {
      onPlayTrack(item.trackId, item.queueIds);
      return;
    }
    if (item.kind === 'playlist') {
      onOpenPlaylist(item.playlistId);
      onClose();
      return;
    }
    if (item.kind === 'album') {
      onPlayList(item.trackIds, { shuffle: false });
      onClose();
      return;
    }
    if (item.kind === 'genre') {
      onOpenScannerWithQuery({ genre: item.genre, groupByGenre: false });
      onClose();
    }
  };

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (flatActions.length > 0 ? (prev + 1) % flatActions.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) =>
          flatActions.length > 0 ? (prev - 1 + flatActions.length) % flatActions.length : 0
        );
      } else if (e.key === 'Enter' && flatActions[activeIndex]) {
        e.preventDefault();
        executeAction(flatActions[activeIndex]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, flatActions, activeIndex, onClose]);

  if (!open) return null;

  const missingMatchCount = searchResults.tracks.filter((r) => r.track.isMissingOnDevice).length;
  const activeActionId = flatActions[activeIndex]?.id ?? null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-start justify-center pt-[8vh] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Smart Search"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-white/[0.12] bg-[#12141A] shadow-2xl overflow-hidden flex flex-col max-h-[78vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Header */}
        <div className="px-4 py-3.5 border-b border-white/[0.08] flex items-center gap-3">
          <Search className="h-4 w-4 text-[#FF4D64] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Smart search tracks, playlists, or use genre:rock, format:flac, is:missing, plays:>2..."
            aria-label="Smart search query"
            className="flex-1 bg-transparent text-sm text-white placeholder-[#6B7280] focus:outline-none min-w-0"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search query"
              className="p-1 rounded text-[#717786] hover:text-white transition-colors shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 rounded text-[11px] font-mono text-[#717786] bg-white/[0.05] hover:text-white transition-colors shrink-0"
          >
            ESC
          </button>
        </div>

        {/* Parsed Smart Filter Readout OR Quick Presets */}
        <div className="px-4 py-2.5 border-b border-white/[0.06] bg-[#0E1015] flex flex-wrap items-center justify-between gap-2 text-xs">
          {searchResults.parsed.activeDescriptors.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#9CA3AF]">
              <Sparkles className="h-3 w-3 text-[#FF4D64] shrink-0" />
              <span className="text-[#D1D5DB]">Interpreted:</span>
              <span>{searchResults.parsed.activeDescriptors.join(' · ')}</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-[#6B7280] mr-1">Smart filters:</span>
              {SMART_SEARCH_PRESETS.map((preset) => (
                <button
                  key={preset.query}
                  type="button"
                  onClick={() => setQuery(preset.query)}
                  title={preset.hint}
                  className="px-2 py-0.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-[11px] font-mono text-[#C2C8D4] hover:text-white transition-colors whitespace-nowrap"
                >
                  {preset.query}
                </button>
              ))}
            </div>
          )}

          {query.trim() && searchResults.tracks.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onOpenScannerWithQuery({ query: query.trim() });
                onClose();
              }}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors whitespace-nowrap shrink-0"
            >
              <span>Filter {searchResults.tracks.length} in Storage</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Missing Files Quick Cleanup Action when searching missing tracks */}
        {missingMatchCount > 0 && query.toLowerCase().includes('missing') && (
          <div className="px-4 py-2.5 border-b border-[#EF4444]/20 bg-[#EF4444]/[0.08] flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-[#FCA5A5]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Found <strong className="font-mono tabular-nums">{missingMatchCount}</strong> track
                {missingMatchCount === 1 ? '' : 's'} with missing files on device.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                onOpenScannerWithQuery({ openCleanup: true });
                onClose();
              }}
              className="font-medium text-white hover:underline underline-offset-2 whitespace-nowrap"
            >
              Open Library Cleanup →
            </button>
          </div>
        )}

        {/* Results Body */}
        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.06]">
          {tracks.length === 0 && playlists.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#717786]">
              Scan a local music folder or upload audio files to search across tracks, genres,
              albums, and playlists.
            </div>
          ) : flatActions.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-[#9CA3AF]">No matches for &ldquo;{query}&rdquo;.</p>
              <p className="mt-1.5 text-xs text-[#6B7280] font-mono">
                Try operators like genre:electronic, format:flac, year:2020-2026, plays:&gt;0, or
                is:unmatched
              </p>
            </div>
          ) : (
            <>
              {/* Tracks Section */}
              {visibleTracks.length > 0 && (
                <div className="py-2">
                  <div className="px-4 py-1.5 flex items-center justify-between text-[11px] font-medium text-[#717786]">
                    <span>
                      Tracks ({searchResults.tracks.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onPlayList(visibleTrackQueue, { shuffle: false });
                        onClose();
                      }}
                      className="text-[#A1A7B5] hover:text-white transition-colors"
                    >
                      Play all results
                    </button>
                  </div>

                  {visibleTracks.map((res) => {
                    const { track, genre } = res;
                    const itemId = `track:${track.id}`;
                    const isHighlighted = activeActionId === itemId;
                    const isPlayingTrack = activePlayingTrackId === track.id;
                    const plays = playStats[track.id]?.playCount ?? track.playCount ?? 0;

                    return (
                      <div
                        key={track.id}
                        className={`px-4 py-2 flex items-center justify-between gap-3 text-xs transition-colors ${
                          isHighlighted ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onPlayTrack(track.id, visibleTrackQueue)}
                          className="flex items-center gap-3 min-w-0 flex-1 text-left"
                        >
                          <span
                            className={`h-7 w-7 rounded flex items-center justify-center shrink-0 ${
                              isPlayingTrack
                                ? 'text-[#FF1F3D] bg-[#FF1F3D]/12'
                                : 'text-[#8B92A2] bg-white/[0.04]'
                            }`}
                          >
                            {isPlayingTrack && isAudioPlaying ? (
                              <Pause className="h-3.5 w-3.5 fill-current" />
                            ) : (
                              <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div
                              className={`font-medium truncate ${
                                track.isMissingOnDevice
                                  ? 'text-[#717786] line-through'
                                  : isPlayingTrack
                                    ? 'text-[#FF4D64]'
                                    : 'text-white'
                              }`}
                            >
                              {track.title}
                            </div>
                            <div className="text-[11px] text-[#717786] truncate">
                              {track.artist} · {genre} · {track.format}
                              {track.isMissingOnDevice ? ' · Missing' : ''}
                              {plays > 0 ? ` · ${plays} ${plays === 1 ? 'play' : 'plays'}` : ''}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-3 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              onInspectTrack(track.id);
                              onClose();
                            }}
                            className="text-[11px] text-[#8B92A2] hover:text-white transition-colors whitespace-nowrap"
                          >
                            {track.youtubeVideoId ? 'Matched' : 'Match ID'}
                          </button>
                          <span className="font-mono tabular-nums text-[11px] text-[#6B7280] w-10 text-right">
                            {formatDuration(track.duration)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Playlists Section */}
              {visiblePlaylists.length > 0 && (
                <div className="py-2">
                  <div className="px-4 py-1.5 text-[11px] font-medium text-[#717786]">
                    Playlists ({searchResults.playlists.length})
                  </div>
                  {visiblePlaylists.map(({ playlist }) => {
                    const itemId = `playlist:${playlist.id}`;
                    const isHighlighted = activeActionId === itemId;
                    return (
                      <button
                        key={playlist.id}
                        type="button"
                        onClick={() => {
                          onOpenPlaylist(playlist.id);
                          onClose();
                        }}
                        className={`w-full px-4 py-2 flex items-center justify-between gap-3 text-xs text-left transition-colors ${
                          isHighlighted ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <ListMusic className="h-3.5 w-3.5 text-[#8B92A2] shrink-0" />
                          <span className="font-medium text-white truncate">{playlist.name}</span>
                        </div>
                        <span className="font-mono tabular-nums text-[11px] text-[#717786] shrink-0">
                          {playlist.trackIds.length} tracks
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Albums & Genres Quick Jumps */}
              {(visibleAlbums.length > 0 || visibleGenres.length > 0) && (
                <div className="py-2 grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06]">
                  {visibleAlbums.length > 0 && (
                    <div>
                      <div className="px-4 py-1.5 text-[11px] font-medium text-[#717786]">
                        Albums
                      </div>
                      {visibleAlbums.map((album) => {
                        const itemId = `album:${album.key}`;
                        const isHighlighted = activeActionId === itemId;
                        return (
                          <button
                            key={album.key}
                            type="button"
                            onClick={() => {
                              onPlayList(album.trackIds, { shuffle: false });
                              onClose();
                            }}
                            className={`w-full px-4 py-2 flex items-center justify-between gap-2 text-xs text-left transition-colors ${
                              isHighlighted ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Disc3 className="h-3.5 w-3.5 text-[#717786] shrink-0" />
                              <div className="min-w-0">
                                <div className="font-medium text-white truncate">{album.album}</div>
                                <div className="text-[11px] text-[#717786] truncate">
                                  {album.artist}
                                </div>
                              </div>
                            </div>
                            <span className="font-mono tabular-nums text-[11px] text-[#6B7280] shrink-0">
                              {album.trackCount}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {visibleGenres.length > 0 && (
                    <div>
                      <div className="px-4 py-1.5 text-[11px] font-medium text-[#717786]">
                        Genres
                      </div>
                      {visibleGenres.map((g) => {
                        const itemId = `genre:${g.genre}`;
                        const isHighlighted = activeActionId === itemId;
                        return (
                          <button
                            key={g.genre}
                            type="button"
                            onClick={() => {
                              onOpenScannerWithQuery({ genre: g.genre, groupByGenre: false });
                              onClose();
                            }}
                            className={`w-full px-4 py-2 flex items-center justify-between gap-2 text-xs text-left transition-colors ${
                              isHighlighted ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Layers className="h-3.5 w-3.5 text-[#717786] shrink-0" />
                              <span className="font-medium text-white truncate">{g.genre}</span>
                            </div>
                            <span className="font-mono tabular-nums text-[11px] text-[#6B7280] shrink-0">
                              {g.count} tracks
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Syntax Cheat Sheet */}
        <div className="px-4 py-2 border-t border-white/[0.07] bg-[#0D0F14] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6B7280]">
          <span className="font-mono truncate">
            Operators: genre: · artist: · format: · year:2015-2025 · plays:&gt;2 · duration:&gt;4m ·
            is:missing · -exclude
          </span>
          <span className="font-mono shrink-0">↑↓ navigate · Enter open</span>
        </div>
      </div>
    </div>
  );
}
