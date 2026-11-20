import { useEffect, useState } from 'react';
import {
  Check,
  ChevronRight,
  Disc3,
  ExternalLink,
  Link2,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react';
import type { LocalTrack } from '../types/music';
import { inferTrackGenre } from '../utils/genreInference';
import {
  buildYouTubeMusicSearchUrl,
  buildYouTubeMusicWatchUrl,
  buildYouTubeThumbnailUrl,
  extractYouTubeVideoId,
  formatDuration,
  formatFileSize,
} from '../utils/youtubeLinks';

interface TrackMatchDrawerProps {
  track: LocalTrack | null;
  hasNextUnmatched: boolean;
  onClose: () => void;
  onSave: (
    trackId: string,
    updates: Partial<
      Pick<
        LocalTrack,
        'title' | 'artist' | 'album' | 'genre' | 'year' | 'youtubeVideoId' | 'matchStatus'
      >
    >,
    advanceToNext?: boolean
  ) => void;
}

export function TrackMatchDrawer({
  track,
  hasNextUnmatched,
  onClose,
  onSave,
}: TrackMatchDrawerProps) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [genre, setGenre] = useState('');
  const [year, setYear] = useState('');
  const [ytInput, setYtInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);

  useEffect(() => {
    if (track) {
      setTitle(track.title);
      setArtist(track.artist);
      setAlbum(track.album);
      setGenre(track.genre || '');
      setYear(track.year);
      setYtInput(track.youtubeVideoId ? buildYouTubeMusicWatchUrl(track.youtubeVideoId) : '');
      setInputError(null);
      setThumbFailed(false);
    }
  }, [track]);

  useEffect(() => {
    if (!track) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [track, onClose]);

  if (!track) return null;

  const inferredGenre = inferTrackGenre(track);
  const parsedVideoId = extractYouTubeVideoId(ytInput);
  const searchUrl = buildYouTubeMusicSearchUrl({
    title: title.trim() || track.title,
    artist: artist.trim() || track.artist,
    album: album.trim() || track.album,
  });

  const handleSave = (advance: boolean) => {
    const trimmedYt = ytInput.trim();
    if (trimmedYt && !parsedVideoId) {
      setInputError('Enter a valid YouTube or YouTube Music video URL, or an 11-character video ID.');
      return;
    }

    onSave(
      track.id,
      {
        title: title.trim() || track.title,
        artist: artist.trim() || 'Unknown Artist',
        album: album.trim() || 'Unknown Album',
        genre: genre.trim() || undefined,
        year: year.trim(),
        youtubeVideoId: parsedVideoId,
        matchStatus: parsedVideoId ? 'matched' : 'unmatched',
      },
      advance
    );
  };

  const handleSkip = () => {
    onSave(
      track.id,
      {
        matchStatus: 'skipped',
        youtubeVideoId: null,
      },
      true
    );
  };

  const handleClearMatch = () => {
    setYtInput('');
    setInputError(null);
    setThumbFailed(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" role="dialog" aria-modal="true">
      <div className="flex-1" onClick={onClose} aria-hidden="true" />
      <aside className="w-full max-w-md h-full bg-[#12141A] border-l border-white/[0.09] flex flex-col">
        {/* Header */}
        <div className="h-14 px-6 border-b border-white/[0.08] flex items-center justify-between gap-3 shrink-0">
          <h2 className="font-display text-base font-semibold text-white truncate">
            Match Track to YouTube Music
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close track inspector"
            className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* File Summary */}
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 rounded-md bg-[#1A1D24] border border-white/[0.08] overflow-hidden flex items-center justify-center shrink-0">
              {track.coverArtUrl ? (
                <img
                  src={track.coverArtUrl}
                  alt={`${track.title} album art`}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              ) : (
                <Disc3 className="h-6 w-6 text-[#6B7280]" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-white truncate">{track.fileName}</div>
              <div className="mt-1 text-xs text-[#8B92A2] font-mono tabular-nums">
                {track.format} · {formatDuration(track.duration)} · {formatFileSize(track.fileSize)}
              </div>
              <div className="mt-1 text-xs text-[#6B7280] truncate" title={track.relativePath}>
                {track.relativePath}
              </div>
            </div>
          </div>

          {/* Step 1: Search & Paste YouTube Link */}
          <div className="pt-5 border-t border-white/[0.07] space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#D1D5DB]">YouTube Music Match</span>
              <a
                href={searchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#FF4D64] hover:text-[#FF7588] transition-colors whitespace-nowrap"
              >
                <span>Search on YouTube Music</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="yt-match-input" className="block text-xs text-[#8B92A2]">
                Paste YouTube Music track URL or Video ID
              </label>
              <div className="relative">
                <Link2 className="h-4 w-4 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="yt-match-input"
                  type="text"
                  value={ytInput}
                  onChange={(e) => {
                    setYtInput(e.target.value);
                    setInputError(null);
                    setThumbFailed(false);
                  }}
                  placeholder="https://music.youtube.com/watch?v=..."
                  className="w-full pl-9 pr-9 py-2.5 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-xs font-mono text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
                />
                {ytInput && (
                  <button
                    type="button"
                    onClick={handleClearMatch}
                    aria-label="Clear YouTube link"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#6B7280] hover:text-white"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {inputError && <p className="text-xs text-[#EF4444]">{inputError}</p>}
            </div>

            {/* Live Matched Preview */}
            {parsedVideoId && (
              <div className="rounded-md bg-[#0D0F13] border border-white/[0.08] p-3 flex items-center gap-3">
                <div className="h-12 w-20 rounded bg-[#181B22] overflow-hidden shrink-0 flex items-center justify-center">
                  {!thumbFailed ? (
                    <img
                      src={buildYouTubeThumbnailUrl(parsedVideoId)}
                      alt="YouTube track thumbnail"
                      referrerPolicy="no-referrer"
                      onError={() => setThumbFailed(true)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Disc3 className="h-4 w-4 text-[#6B7280]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-[#22C55E]">
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    <span>Valid YouTube Music ID</span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-[#9CA3AF] truncate">
                    {parsedVideoId}
                  </div>
                  <a
                    href={buildYouTubeMusicWatchUrl(parsedVideoId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#D1D5DB] hover:text-white underline underline-offset-2"
                  >
                    <span>Verify on YouTube Music</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* Step 2: Editable Extracted Metadata */}
          <div className="pt-5 border-t border-white/[0.07] space-y-4">
            <div className="text-xs font-medium text-[#D1D5DB]">Extracted Audio Metadata</div>

            <div className="space-y-1.5">
              <label htmlFor="meta-title" className="block text-xs text-[#8B92A2]">
                Title
              </label>
              <input
                id="meta-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-sm text-white focus:border-[#FF1F3D] focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="meta-artist" className="block text-xs text-[#8B92A2]">
                Artist
              </label>
              <input
                id="meta-artist"
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-sm text-white focus:border-[#FF1F3D] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <label htmlFor="meta-album" className="block text-xs text-[#8B92A2]">
                  Album
                </label>
                <input
                  id="meta-album"
                  type="text"
                  value={album}
                  onChange={(e) => setAlbum(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-sm text-white focus:border-[#FF1F3D] focus:outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="meta-year" className="block text-xs text-[#8B92A2]">
                  Year
                </label>
                <input
                  id="meta-year"
                  type="text"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="2024"
                  className="w-full px-3 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-sm font-mono tabular-nums text-white focus:border-[#FF1F3D] focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="meta-genre" className="block text-xs text-[#8B92A2]">
                  Genre
                </label>
                <span className="text-[11px] text-[#6B7280]">
                  {inferredGenre.source === 'tag'
                    ? `Tagged: ${inferredGenre.genre}`
                    : `Inferred: ${inferredGenre.genre}`}
                </span>
              </div>
              <input
                id="meta-genre"
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder={`Leave blank to infer (${inferredGenre.genre})`}
                className="w-full px-3 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-sm text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-white/[0.08] bg-[#0F1116] flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSkip}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-[#9CA3AF] hover:text-white hover:bg-white/[0.06] transition-colors whitespace-nowrap"
          >
            <SkipForward className="h-3.5 w-3.5" />
            <span>Skip</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSave(false)}
              className="px-3.5 py-2 rounded-md text-xs font-medium text-[#E5E7EB] bg-[#1C2029] hover:bg-[#252A36] transition-colors whitespace-nowrap"
            >
              Save
            </button>
            {hasNextUnmatched && (
              <button
                type="button"
                onClick={() => handleSave(true)}
                className="inline-flex items-center gap-1 px-3.5 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
              >
                <span>Save &amp; Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
