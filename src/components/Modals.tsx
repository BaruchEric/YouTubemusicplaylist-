import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { SyncRule } from '../types/music';

interface CreatePlaylistModalProps {
  isOpen: boolean;
  defaultFolderName: string | null;
  availableFolders: string[];
  initialTrackCount?: number;
  onClose: () => void;
  onCreate: (payload: {
    name: string;
    description: string;
    youtubePlaylistUrl: string;
    syncRule: SyncRule;
  }) => void;
}

export function CreatePlaylistModal({
  isOpen,
  defaultFolderName,
  availableFolders,
  initialTrackCount = 0,
  onClose,
  onCreate,
}: CreatePlaylistModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [youtubePlaylistUrl, setYoutubePlaylistUrl] = useState('');
  const [autoAddNewFiles, setAutoAddNewFiles] = useState(true);
  const [removeMissingFiles, setRemoveMissingFiles] = useState(true);
  const [folderFilter, setFolderFilter] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName(defaultFolderName ? `${defaultFolderName}` : '');
      setDescription('');
      setYoutubePlaylistUrl('');
      setAutoAddNewFiles(true);
      setRemoveMissingFiles(true);
      setFolderFilter(defaultFolderName ?? '');
    }
  }, [isOpen, defaultFolderName]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    onCreate({
      name: cleanName,
      description: description.trim(),
      youtubePlaylistUrl: youtubePlaylistUrl.trim(),
      syncRule: {
        autoAddNewFiles,
        removeMissingFiles,
        folderFilter: folderFilter.trim(),
      },
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-playlist-title"
    >
      <div className="w-full max-w-lg rounded-lg bg-[#14171D] border border-white/[0.1] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08]">
          <h2 id="create-playlist-title" className="font-display text-lg font-semibold text-white">
            New playlist
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {initialTrackCount > 0 && (
            <p className="text-xs text-[#9CA3AF]">
              Starting with{' '}
              <span className="font-mono tabular-nums text-white font-medium">
                {initialTrackCount}
              </span>{' '}
              selected local track{initialTrackCount === 1 ? '' : 's'}.
            </p>
          )}

          <div className="space-y-1.5">
            <label htmlFor="pl-name" className="block text-xs font-medium text-[#D1D5DB]">
              Playlist Name
            </label>
            <input
              id="pl-name"
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Late Night Vinyl, Workout FLACs"
              className="w-full px-3.5 py-2.5 rounded-md bg-[#0D0F13] border border-white/[0.1] text-sm text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="pl-desc" className="block text-xs font-medium text-[#D1D5DB]">
              Description (optional)
            </label>
            <input
              id="pl-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Synced from device music folder"
              className="w-full px-3.5 py-2.5 rounded-md bg-[#0D0F13] border border-white/[0.1] text-sm text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="pl-yt-url" className="block text-xs font-medium text-[#D1D5DB]">
              YouTube playlist link (optional)
            </label>
            <input
              id="pl-yt-url"
              type="url"
              value={youtubePlaylistUrl}
              onChange={(e) => setYoutubePlaylistUrl(e.target.value)}
              placeholder="https://music.youtube.com/playlist?list=..."
              className="w-full px-3.5 py-2.5 rounded-md bg-[#0D0F13] border border-white/[0.1] text-sm font-mono text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
            />
            <p className="text-xs text-[#8B92A2]">
              Paste one to send this playlist to a YouTube playlist you already have. Leave it
              empty and the first Push to YouTube creates the playlist for you.
            </p>
          </div>

          <div className="pt-2 border-t border-white/[0.07] space-y-3.5">
            <div className="text-xs font-medium text-[#9CA3AF]">Folder Auto-Sync Rules</div>

            {availableFolders.length > 0 && (
              <div className="space-y-1.5">
                <label htmlFor="pl-folder" className="block text-xs text-[#9CA3AF]">
                  Bind to Local Folder
                </label>
                <select
                  id="pl-folder"
                  value={folderFilter}
                  onChange={(e) => setFolderFilter(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-[#0D0F13] border border-white/[0.1] text-sm text-white focus:border-[#FF1F3D] focus:outline-none"
                >
                  <option value="">All scanned device folders</option>
                  {availableFolders.map((folder) => (
                    <option key={folder} value={folder}>
                      {folder}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoAddNewFiles}
                onChange={(e) => setAutoAddNewFiles(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-[#FF1F3D]"
              />
              <span className="text-xs text-[#D1D5DB] leading-relaxed">
                Automatically queue newly added audio files from this folder
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={removeMissingFiles}
                onChange={(e) => setRemoveMissingFiles(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-[#FF1F3D]"
              />
              <span className="text-xs text-[#D1D5DB] leading-relaxed">
                Queue removals when local audio files are deleted from device storage
              </span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/[0.07]">
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
              Create Playlist
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel,
  destructive = false,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="w-full max-w-md rounded-lg bg-[#14171D] border border-white/[0.1] overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h2 id="confirm-modal-title" className="font-display text-base font-semibold text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close confirmation"
            className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-sm text-[#B8BECB] leading-relaxed">{message}</p>
        </div>

        <div className="px-6 py-4 bg-[#101217] border-t border-white/[0.07] flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-md text-xs font-medium text-[#D1D5DB] hover:text-white hover:bg-white/[0.06] transition-colors whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded-md text-xs font-medium text-white transition-colors whitespace-nowrap ${
              destructive
                ? 'bg-[#DC2626] hover:bg-[#B91C1C]'
                : 'bg-[#FF1F3D] hover:bg-[#E11934]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
