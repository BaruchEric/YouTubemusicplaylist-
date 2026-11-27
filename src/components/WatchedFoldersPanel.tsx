import { FolderOpen, FolderPlus, Trash2, X } from 'lucide-react';
import type { FolderRow, FolderRowState } from '../utils/watchedFolders';

interface WatchedFoldersPanelProps {
  rows: FolderRow[];
  isScanning: boolean;
  /** Asks the browser for one folder. Called from the click, which is what lets it ask. */
  onAllowFolder: (folderId: string) => void;
  onRemoveFolder: (folderId: string) => void;
  onAddFolder: () => void;
  /** Closes the list. Left out where the list always shows, and then it has no close button. */
  onClose?: () => void;
}

const STATE_LABEL: Record<FolderRowState, string> = {
  watching: 'Watching',
  idle: 'Idle',
  'needs-access': 'Needs access',
};

const STATE_DOT: Record<FolderRowState, string> = {
  watching: 'h-1.5 w-1.5 rounded-full shrink-0 bg-[#22C55E]',
  idle: 'h-1.5 w-1.5 rounded-full shrink-0 bg-[#6B7280]',
  'needs-access': 'h-1.5 w-1.5 rounded-full shrink-0 bg-[#F59E0B]',
};

const STATE_TEXT: Record<FolderRowState, string> = {
  watching: 'text-xs whitespace-nowrap text-[#E5E7EB]',
  idle: 'text-xs whitespace-nowrap text-[#8B92A2]',
  'needs-access': 'text-xs whitespace-nowrap text-[#FCD34D]',
};

/** The folders picked with the folder chooser: what each holds, its state, and its controls. */
export function WatchedFoldersPanel({
  rows,
  isScanning,
  onAllowFolder,
  onRemoveFolder,
  onAddFolder,
  onClose,
}: WatchedFoldersPanelProps) {
  return (
    <section
      aria-label="Watched folders"
      className="rounded-lg border border-white/[0.1] bg-[#11141B] overflow-hidden text-left"
    >
      <div className="px-4 sm:px-5 py-3 border-b border-white/[0.08] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold text-white truncate">Watched folders</h2>
          <p className="text-[11px] text-[#717786]">
            Songs play from these folders. CrateSync keeps no copy of them.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onAddFolder}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#D1D5DB] bg-[#181B24] border border-white/[0.09] hover:text-white hover:bg-[#222634] disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span>Add folder</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the list of watched folders"
              className="p-1.5 rounded text-[#8B92A2] hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 sm:px-5 py-4 text-xs text-[#9CA3AF]">
          No folder picked yet. Add one and CrateSync plays its songs from it.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {rows.map((row) => (
            <li
              key={row.id}
              data-folder-id={row.id}
              className="px-4 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
            >
              {/* On a phone the name has the row to itself and the controls sit under it. */}
              <div className="flex items-center gap-2.5 min-w-0 flex-1 basis-full sm:basis-40">
                <FolderOpen className="h-4 w-4 text-[#8B92A2] shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm text-white truncate">{row.name}</div>
                  <div className="text-[11px] font-mono tabular-nums text-[#717786]">
                    {row.songCount === 1 ? '1 song' : `${row.songCount} songs`}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="inline-flex items-center gap-1.5 mr-1">
                  <span className={STATE_DOT[row.state]} aria-hidden="true" />
                  <span className={STATE_TEXT[row.state]}>{STATE_LABEL[row.state]}</span>
                </span>
                {row.state === 'needs-access' && (
                  <button
                    type="button"
                    onClick={() => onAllowFolder(row.id)}
                    aria-label={`Allow access to ${row.name}`}
                    className="px-2.5 py-1.5 rounded text-xs font-medium text-[#0B0C0E] bg-[#FCD34D] hover:bg-[#FDE68A] transition-colors whitespace-nowrap"
                  >
                    Allow
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveFolder(row.id)}
                  disabled={isScanning}
                  aria-label={`Remove ${row.name} from your folders`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#D1D5DB] bg-[#181B24] border border-white/[0.09] hover:text-white hover:bg-[#222634] disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Remove</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
