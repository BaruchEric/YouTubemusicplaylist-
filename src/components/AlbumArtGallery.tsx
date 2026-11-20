import { type ChangeEvent, useMemo, useRef, useState } from 'react';
import {
  Check,
  Disc3,
  ExternalLink,
  FolderOpen,
  Image as ImageIcon,
  ImagePlus,
  Link2,
  ListPlus,
  Pause,
  Play,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { LocalTrack } from '../types/music';
import { inferTrackGenre } from '../utils/genreInference';
import type { ShuffleMode } from '../utils/smartShuffle';
import {
  buildTrackYouTubeMusicUrl,
  formatDuration,
  formatFileSize,
  formatTotalRuntime,
} from '../utils/youtubeLinks';

interface AlbumGroup {
  key: string;
  album: string;
  artist: string;
  year: string;
  genre: string;
  coverArtUrl: string | null;
  tracks: LocalTrack[];
  trackIds: string[];
  totalDuration: number;
  totalSize: number;
  matchedCount: number;
  latestAddedAt: number;
  formats: string[];
}

interface AlbumArtGalleryProps {
  tracks: LocalTrack[];
  activeGenre: string;
  activePlayingTrackId: string | null;
  isAudioPlaying: boolean;
  onPlayTrack: (trackId: string, queueIds: string[]) => void;
  onPlayList: (trackIds: string[], options?: { shuffle?: boolean | ShuffleMode }) => void;
  onCreatePlaylistFromTracks: (trackIds: string[]) => void;
  onInspectTrack: (trackId: string) => void;
  onUpdateAlbumCoverArt?: (trackIds: string[], coverArtUrl: string | null) => void;
  onOpenBatchTagEditor?: (trackIds: string[], contextLabel: string) => void;
  onMountFolder: () => void;
  onPickFilesFallback: () => void;
}

const SLEEVE_GRADIENTS = [
  'from-[#1E222D] via-[#151822] to-[#0D0F14]',
  'from-[#261A20] via-[#19141A] to-[#0E0D12]',
  'from-[#18222B] via-[#131922] to-[#0C1016]',
  'from-[#231F18] via-[#181613] to-[#0F0E0D]',
  'from-[#1D1B2A] via-[#151420] to-[#0D0D14]',
  'from-[#162420] via-[#111B19] to-[#0B1110]',
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getMonogram(album: string, artist: string): string {
  const source = album && album !== 'Unknown Album' ? album : artist || 'AL';
  const words = source.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

async function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read image file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported image format'));
      img.onload = () => {
        const size = 320;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas unavailable'));
          return;
        }
        // Center-crop square
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function AlbumCoverVisual({
  album,
  failed,
  onError,
  large = false,
}: {
  album: AlbumGroup;
  failed: boolean;
  onError: () => void;
  large?: boolean;
}) {
  if (album.coverArtUrl && !failed) {
    return (
      <img
        src={album.coverArtUrl}
        alt={`${album.album} by ${album.artist} cover art`}
        referrerPolicy="no-referrer"
        onError={onError}
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
      />
    );
  }

  const grad = SLEEVE_GRADIENTS[hashString(album.key) % SLEEVE_GRADIENTS.length];
  const monogram = getMonogram(album.album, album.artist);

  return (
    <div
      className={`h-full w-full bg-gradient-to-br ${grad} relative flex flex-col items-center justify-center p-4 select-none overflow-hidden`}
    >
      {/* Subtle geometric vinyl groove rings */}
      <svg
        viewBox="0 0 120 120"
        className="absolute inset-0 h-full w-full opacity-[0.16] pointer-events-none"
        aria-hidden="true"
      >
        <circle cx="60" cy="60" r="52" fill="none" stroke="white" strokeWidth="0.6" />
        <circle cx="60" cy="60" r="42" fill="none" stroke="white" strokeWidth="0.5" />
        <circle cx="60" cy="60" r="32" fill="none" stroke="white" strokeWidth="0.5" />
        <circle cx="60" cy="60" r="20" fill="none" stroke="white" strokeWidth="0.7" />
      </svg>

      <span
        className={`font-display font-semibold tracking-tight text-white/75 ${
          large ? 'text-4xl' : 'text-2xl'
        }`}
      >
        {monogram}
      </span>
      <span
        className={`mt-1 font-mono text-[#8B92A2] truncate max-w-full ${
          large ? 'text-xs' : 'text-[10px]'
        }`}
      >
        {album.year || album.genre}
      </span>
    </div>
  );
}

export function AlbumArtGallery({
  tracks,
  activeGenre,
  activePlayingTrackId,
  isAudioPlaying,
  onPlayTrack,
  onPlayList,
  onCreatePlaylistFromTracks,
  onInspectTrack,
  onUpdateAlbumCoverArt,
  onOpenBatchTagEditor,
  onMountFolder,
  onPickFilesFallback,
}: AlbumArtGalleryProps) {
  const [artFilter, setArtFilter] = useState<'all' | 'with-art' | 'missing-art'>('all');
  const [sortBy, setSortBy] = useState<'tracks' | 'alpha' | 'year' | 'recent'>('tracks');
  const [searchQuery, setSearchQuery] = useState('');
  const [failedKeys, setFailedKeys] = useState<Set<string>>(() => new Set());
  const [selectedAlbumKey, setSelectedAlbumKey] = useState<string | null>(null);
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const albums = useMemo<AlbumGroup[]>(() => {
    const map = new Map<
      string,
      {
        album: string;
        artists: Map<string, number>;
        years: Map<string, number>;
        genres: Map<string, number>;
        coverArtUrl: string | null;
        tracks: LocalTrack[];
        totalDuration: number;
        totalSize: number;
        matchedCount: number;
        latestAddedAt: number;
        formats: Set<string>;
      }
    >();

    for (const track of tracks) {
      const albumTitle = (track.album || 'Unknown Album').trim() || 'Unknown Album';
      const artistName = (track.artist || 'Unknown Artist').trim() || 'Unknown Artist';
      // Group "Unknown Album" by artist so unrelated singles don't merge into one giant tile
      const key =
        albumTitle.toLowerCase() === 'unknown album'
          ? `single::${artistName.toLowerCase()}`
          : `album::${albumTitle.toLowerCase()}`;

      let entry = map.get(key);
      if (!entry) {
        entry = {
          album:
            albumTitle.toLowerCase() === 'unknown album' ? `${artistName} — Singles` : albumTitle,
          artists: new Map(),
          years: new Map(),
          genres: new Map(),
          coverArtUrl: null,
          tracks: [],
          totalDuration: 0,
          totalSize: 0,
          matchedCount: 0,
          latestAddedAt: 0,
          formats: new Set(),
        };
        map.set(key, entry);
      }

      entry.tracks.push(track);
      entry.artists.set(artistName, (entry.artists.get(artistName) ?? 0) + 1);
      if (track.year) {
        entry.years.set(track.year, (entry.years.get(track.year) ?? 0) + 1);
      }
      const inferredGenre = inferTrackGenre(track).genre;
      entry.genres.set(inferredGenre, (entry.genres.get(inferredGenre) ?? 0) + 1);

      if (!entry.coverArtUrl && track.coverArtUrl) {
        entry.coverArtUrl = track.coverArtUrl;
      }
      entry.totalDuration += track.duration || 0;
      entry.totalSize += track.fileSize || 0;
      if (track.youtubeVideoId) entry.matchedCount += 1;
      if (track.addedAt > entry.latestAddedAt) entry.latestAddedAt = track.addedAt;
      if (track.format) entry.formats.add(track.format.toUpperCase());
    }

    const pickTop = (counts: Map<string, number>, fallback: string) => {
      let best = fallback;
      let bestCount = 0;
      for (const [val, count] of counts.entries()) {
        if (count > bestCount) {
          best = val;
          bestCount = count;
        }
      }
      return best;
    };

    return Array.from(map.entries()).map(([key, data]) => {
      const sortedTracks = [...data.tracks].sort((a, b) => {
        if (a.trackNumber !== null && b.trackNumber !== null && a.trackNumber !== b.trackNumber) {
          return a.trackNumber - b.trackNumber;
        }
        if (a.trackNumber !== null && b.trackNumber === null) return -1;
        if (a.trackNumber === null && b.trackNumber !== null) return 1;
        return a.title.localeCompare(b.title);
      });

      const distinctArtists = Array.from(data.artists.keys()).filter(
        (a) => a !== 'Unknown Artist'
      );
      const artistLabel =
        distinctArtists.length > 2
          ? 'Various Artists'
          : pickTop(data.artists, 'Unknown Artist');

      return {
        key,
        album: data.album,
        artist: artistLabel,
        year: pickTop(data.years, ''),
        genre: pickTop(data.genres, 'Unclassified'),
        coverArtUrl: data.coverArtUrl,
        tracks: sortedTracks,
        trackIds: sortedTracks.map((t) => t.id),
        totalDuration: data.totalDuration,
        totalSize: data.totalSize,
        matchedCount: data.matchedCount,
        latestAddedAt: data.latestAddedAt,
        formats: Array.from(data.formats),
      };
    });
  }, [tracks]);

  const artworkCounts = useMemo(() => {
    let withArt = 0;
    for (const a of albums) {
      if (a.coverArtUrl && !failedKeys.has(a.key)) withArt++;
    }
    return {
      total: albums.length,
      withArt,
      missingArt: albums.length - withArt,
    };
  }, [albums, failedKeys]);

  const visibleAlbums = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = albums.filter((album) => {
      const hasArt = Boolean(album.coverArtUrl && !failedKeys.has(album.key));
      if (artFilter === 'with-art' && !hasArt) return false;
      if (artFilter === 'missing-art' && hasArt) return false;
      if (q) {
        const hay = `${album.album} ${album.artist} ${album.genre} ${album.year}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      if (sortBy === 'alpha') return a.album.localeCompare(b.album);
      if (sortBy === 'year') {
        const ya = parseInt(a.year, 10) || 0;
        const yb = parseInt(b.year, 10) || 0;
        return yb - ya || a.album.localeCompare(b.album);
      }
      if (sortBy === 'recent') return b.latestAddedAt - a.latestAddedAt;
      // Default: prioritize albums with artwork & more tracks
      const aHasArt = a.coverArtUrl && !failedKeys.has(a.key) ? 1 : 0;
      const bHasArt = b.coverArtUrl && !failedKeys.has(b.key) ? 1 : 0;
      return b.tracks.length - a.tracks.length || bHasArt - aHasArt || a.album.localeCompare(b.album);
    });
  }, [albums, artFilter, sortBy, searchQuery, failedKeys]);

  const selectedAlbum = useMemo(
    () => (selectedAlbumKey ? albums.find((a) => a.key === selectedAlbumKey) ?? null : null),
    [albums, selectedAlbumKey]
  );

  const handleMarkImageFailed = (key: string) => {
    setFailedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const handleCoverFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedAlbum || !onUpdateAlbumCoverArt) return;

    setCoverUploadError(null);
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setFailedKeys((prev) => {
        if (!prev.has(selectedAlbum.key)) return prev;
        const next = new Set(prev);
        next.delete(selectedAlbum.key);
        return next;
      });
      onUpdateAlbumCoverArt(selectedAlbum.trackIds, dataUrl);
    } catch {
      setCoverUploadError('Could not process that image. Please choose a JPG, PNG, or WebP file.');
    }
  };

  return (
    <section
      aria-label="Album Art Gallery"
      className="rounded-lg border border-white/[0.08] bg-[#12141A] overflow-hidden"
    >
      {/* Hidden cover art uploader for selected album */}
      <input
        ref={coverInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleCoverFileSelected}
      />

      {/* Gallery Header */}
      <div className="px-5 py-4 border-b border-white/[0.07] flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-[#FF4D64] shrink-0" />
            <h2 className="font-display text-base font-semibold text-white truncate">
              {activeGenre === 'all' ? 'Album Art Gallery' : `${activeGenre} Album Art Gallery`}
            </h2>
          </div>
          <p className="text-xs text-[#717786] mt-0.5 font-mono tabular-nums">
            {albums.length === 0
              ? 'Embedded cover art and studio sleeves from your local library'
              : `${artworkCounts.total} album${artworkCounts.total === 1 ? '' : 's'} · ${artworkCounts.withArt} with cover art · ${artworkCounts.missingArt} studio sleeve${artworkCounts.missingArt === 1 ? '' : 's'}`}
          </p>
        </div>

        {albums.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Search */}
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-[#6B7280] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter albums..."
                aria-label="Filter albums"
                className="w-36 sm:w-44 pl-8 pr-2.5 py-1.5 rounded bg-[#0C0E13] border border-white/[0.08] text-xs text-white placeholder-[#6B7280] focus:outline-none focus:border-white/25"
              />
            </div>

            {/* Artwork Filter */}
            <div
              className="inline-flex items-center p-0.5 rounded bg-[#0C0E13] border border-white/[0.08]"
              role="group"
              aria-label="Filter albums by artwork status"
            >
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'with-art', label: 'Artwork' },
                  { id: 'missing-art', label: 'No Art' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setArtFilter(tab.id)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    artFilter === tab.id
                      ? 'bg-white/[0.12] text-white'
                      : 'text-[#8B92A2] hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Sort Select */}
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as 'tracks' | 'alpha' | 'year' | 'recent')
              }
              aria-label="Sort albums"
              className="px-2.5 py-1.5 rounded bg-[#0C0E13] border border-white/[0.08] text-[11px] font-medium text-[#D1D5DB] focus:outline-none focus:border-white/25"
            >
              <option value="tracks">Most Tracks</option>
              <option value="alpha">Title A–Z</option>
              <option value="year">Release Year</option>
              <option value="recent">Recently Added</option>
            </select>
          </div>
        )}
      </div>

      {/* Gallery Grid / Empty States */}
      {albums.length === 0 ? (
        <div className="p-8 flex flex-col sm:flex-row items-center justify-center gap-6 text-center sm:text-left">
          <div className="flex items-center -space-x-4 shrink-0" aria-hidden="true">
            {[0, 1, 2].map((idx) => (
              <div
                key={idx}
                className={`h-20 w-20 rounded-md border border-white/[0.09] bg-gradient-to-br ${SLEEVE_GRADIENTS[idx]} flex items-center justify-center shadow-lg`}
                style={{ transform: `rotate(${(idx - 1) * 4}deg)` }}
              >
                <Disc3 className="h-6 w-6 text-white/25" />
              </div>
            ))}
          </div>
          <div className="max-w-sm">
            <div className="text-sm font-medium text-[#E5E7EB]">
              Your album artwork wall will populate automatically
            </div>
            <p className="mt-1 text-xs text-[#717786] leading-relaxed">
              Scan a local music folder or upload audio files to extract embedded APIC, FLAC, and
              MP4 cover art, play full albums, or attach custom covers.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
              <button
                type="button"
                onClick={onMountFolder}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span>Scan Folder</span>
              </button>
              <button
                type="button"
                onClick={onPickFilesFallback}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[#D1D5DB] bg-[#1A1D24] border border-white/[0.08] hover:bg-[#232732] transition-colors whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Upload Audio</span>
              </button>
            </div>
          </div>
        </div>
      ) : visibleAlbums.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm text-[#9CA3AF]">No albums match the current filter.</p>
          <button
            type="button"
            onClick={() => {
              setArtFilter('all');
              setSearchQuery('');
            }}
            className="mt-3 px-3 py-1.5 rounded text-xs font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors"
          >
            Reset gallery filters
          </button>
        </div>
      ) : (
        <div className="p-5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {visibleAlbums.map((album) => {
            const isAlbumPlaying =
              Boolean(activePlayingTrackId) &&
              album.trackIds.includes(activePlayingTrackId as string);
            const hasFailed = failedKeys.has(album.key);

            return (
              <div key={album.key} className="group flex flex-col min-w-0">
                {/* Square Cover Tile */}
                <div
                  className={`relative aspect-square rounded-md overflow-hidden bg-[#161920] border transition-colors ${
                    isAlbumPlaying
                      ? 'border-[#FF1F3D]'
                      : 'border-white/[0.08] group-hover:border-white/25'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setCoverUploadError(null);
                      setSelectedAlbumKey(album.key);
                    }}
                    aria-label={`Open album ${album.album} by ${album.artist}`}
                    className="block h-full w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF1F3D]"
                  >
                    <AlbumCoverVisual
                      album={album}
                      failed={hasFailed}
                      onError={() => handleMarkImageFailed(album.key)}
                    />
                  </button>

                  {/* Hover Contrast Scrim & Direct Playback Control */}
                  <div
                    className={`pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent transition-opacity duration-150 ${
                      isAlbumPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    aria-hidden="true"
                  />

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isAlbumPlaying && activePlayingTrackId) {
                        onPlayTrack(activePlayingTrackId, album.trackIds);
                      } else {
                        onPlayList(album.trackIds, { shuffle: false });
                      }
                    }}
                    aria-label={
                      isAlbumPlaying && isAudioPlaying
                        ? `Pause ${album.album}`
                        : `Play ${album.album}`
                    }
                    className={`absolute bottom-2.5 right-2.5 h-9 w-9 rounded-full flex items-center justify-center shadow-lg transition-all duration-150 ${
                      isAlbumPlaying
                        ? 'bg-[#FF1F3D] text-white opacity-100 translate-y-0'
                        : 'bg-[#FF1F3D] text-white opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 hover:bg-[#E11934]'
                    }`}
                  >
                    {isAlbumPlaying && isAudioPlaying ? (
                      <Pause className="h-4 w-4 fill-current" />
                    ) : (
                      <Play className="h-4 w-4 fill-current ml-0.5" />
                    )}
                  </button>
                </div>

                {/* Clean Unboxed Metadata Caption */}
                <button
                  type="button"
                  onClick={() => {
                    setCoverUploadError(null);
                    setSelectedAlbumKey(album.key);
                  }}
                  className="mt-2.5 text-left min-w-0 group/caption"
                >
                  <div className="text-xs font-medium text-white truncate group-hover/caption:text-[#FF4D64] transition-colors">
                    {album.album}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#9CA3AF] truncate">{album.artist}</div>
                  <div className="mt-0.5 text-[11px] font-mono tabular-nums text-[#6B7280] truncate">
                    {album.tracks.length} {album.tracks.length === 1 ? 'track' : 'tracks'} ·{' '}
                    {formatTotalRuntime(album.totalDuration)}
                    {album.year ? ` · ${album.year}` : ''}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Album Detail Lightbox Modal */}
      {selectedAlbum && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Album details for ${selectedAlbum.album}`}
          onClick={() => setSelectedAlbumKey(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[86vh] rounded-lg border border-white/[0.12] bg-[#12141A] shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Album Hero */}
            <div className="p-5 sm:p-6 border-b border-white/[0.08] flex flex-col sm:flex-row gap-5 items-start">
              <div className="h-36 w-36 sm:h-40 sm:w-40 rounded-md overflow-hidden border border-white/[0.1] bg-[#161920] shrink-0">
                <AlbumCoverVisual
                  album={selectedAlbum}
                  failed={failedKeys.has(selectedAlbum.key)}
                  onError={() => handleMarkImageFailed(selectedAlbum.key)}
                  large
                />
              </div>

              <div className="min-w-0 flex-1 w-full">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] text-[#8B92A2] font-mono tabular-nums">
                      {selectedAlbum.genre}
                      {selectedAlbum.year ? ` · ${selectedAlbum.year}` : ''}
                      {selectedAlbum.formats.length > 0
                        ? ` · ${selectedAlbum.formats.join(' / ')}`
                        : ''}
                    </div>
                    <h3 className="mt-1 font-display text-xl font-semibold text-white truncate">
                      {selectedAlbum.album}
                    </h3>
                    <div className="mt-0.5 text-sm text-[#A1A7B5] truncate">
                      {selectedAlbum.artist}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedAlbumKey(null)}
                    aria-label="Close album details"
                    className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.07] transition-colors shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-2 text-xs font-mono tabular-nums text-[#717786]">
                  {selectedAlbum.tracks.length} track
                  {selectedAlbum.tracks.length === 1 ? '' : 's'} ·{' '}
                  {formatTotalRuntime(selectedAlbum.totalDuration)} ·{' '}
                  {formatFileSize(selectedAlbum.totalSize)} ·{' '}
                  <span className="text-[#22C55E]">
                    {selectedAlbum.matchedCount}/{selectedAlbum.tracks.length} matched
                  </span>
                </div>

                {/* Primary Album Actions */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onPlayList(selectedAlbum.trackIds, { shuffle: false })}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>Play Album</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onPlayList(selectedAlbum.trackIds, { shuffle: 'smart' })}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-[#E5E7EB] bg-[#1C2029] border border-white/[0.09] hover:bg-[#242935] transition-colors whitespace-nowrap"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-[#FF4D64]" />
                    <span>Smart Shuffle</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onCreatePlaylistFromTracks(selectedAlbum.trackIds);
                      setSelectedAlbumKey(null);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-[#D1D5DB] bg-[#161920] border border-white/[0.08] hover:bg-[#1E222B] transition-colors whitespace-nowrap"
                  >
                    <ListPlus className="h-3.5 w-3.5" />
                    <span>Create Playlist</span>
                  </button>
                </div>

                {/* Cover Art & Metadata Utilities */}
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  {onUpdateAlbumCoverArt && (
                    <button
                      type="button"
                      onClick={() => coverInputRef.current?.click()}
                      className="inline-flex items-center gap-1 text-[#A1A7B5] hover:text-white transition-colors whitespace-nowrap"
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                      <span>{selectedAlbum.coverArtUrl ? 'Replace Cover Art' : 'Set Cover Art'}</span>
                    </button>
                  )}
                  {onUpdateAlbumCoverArt && selectedAlbum.coverArtUrl && (
                    <button
                      type="button"
                      onClick={() => onUpdateAlbumCoverArt(selectedAlbum.trackIds, null)}
                      className="inline-flex items-center gap-1 text-[#717786] hover:text-[#EF4444] transition-colors whitespace-nowrap"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Remove Cover</span>
                    </button>
                  )}
                  {onOpenBatchTagEditor && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenBatchTagEditor(
                          selectedAlbum.trackIds,
                          `Album: ${selectedAlbum.album}`
                        );
                        setSelectedAlbumKey(null);
                      }}
                      className="inline-flex items-center gap-1 text-[#A1A7B5] hover:text-white transition-colors whitespace-nowrap"
                    >
                      <Tag className="h-3.5 w-3.5" />
                      <span>Batch Edit Tags</span>
                    </button>
                  )}
                </div>

                {coverUploadError && (
                  <p className="mt-2 text-xs text-[#EF4444]">{coverUploadError}</p>
                )}
              </div>
            </div>

            {/* Album Tracklist */}
            <div className="flex-1 overflow-y-auto divide-y divide-white/[0.05] text-xs">
              {selectedAlbum.tracks.map((track, idx) => {
                const isActive = activePlayingTrackId === track.id;
                return (
                  <div
                    key={track.id}
                    className={`px-5 py-2.5 flex items-center justify-between gap-4 transition-colors ${
                      isActive ? 'bg-[#FF1F3D]/[0.08]' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onPlayTrack(track.id, selectedAlbum.trackIds)}
                        aria-label={
                          isActive && isAudioPlaying
                            ? `Pause ${track.title}`
                            : `Play ${track.title}`
                        }
                        className={`h-7 w-7 rounded flex items-center justify-center shrink-0 transition-colors ${
                          isActive
                            ? 'text-[#FF1F3D] bg-[#FF1F3D]/15'
                            : 'text-[#8B92A2] hover:text-white hover:bg-white/[0.07]'
                        }`}
                      >
                        {isActive && isAudioPlaying ? (
                          <Pause className="h-3.5 w-3.5 fill-current" />
                        ) : (
                          <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                        )}
                      </button>

                      <span className="font-mono tabular-nums text-[#6B7280] w-6 shrink-0">
                        {String(track.trackNumber ?? idx + 1).padStart(2, '0')}
                      </span>

                      <div className="min-w-0">
                        <div
                          className={`font-medium truncate ${
                            isActive ? 'text-[#FF4D64]' : 'text-white'
                          }`}
                        >
                          {track.title}
                        </div>
                        <div className="text-[11px] text-[#717786] truncate">
                          {track.artist} · {track.format}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3.5 shrink-0">
                      <a
                        href={buildTrackYouTubeMusicUrl(track)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[#8B92A2] hover:text-[#FF4D64] transition-colors whitespace-nowrap"
                        title="Open in YouTube Music"
                      >
                        <span>YT Music</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedAlbumKey(null);
                          onInspectTrack(track.id);
                        }}
                        className={`inline-flex items-center gap-1 whitespace-nowrap transition-colors ${
                          track.youtubeVideoId
                            ? 'text-[#22C55E] font-mono'
                            : 'text-[#D1D5DB] hover:text-white'
                        }`}
                      >
                        {track.youtubeVideoId ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span>{track.youtubeVideoId}</span>
                          </>
                        ) : (
                          <>
                            <Link2 className="h-3.5 w-3.5 text-[#8B92A2]" />
                            <span>Match ID</span>
                          </>
                        )}
                      </button>
                      <span className="font-mono tabular-nums text-[#717786] w-11 text-right">
                        {formatDuration(track.duration)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
