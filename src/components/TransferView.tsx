import { useRef, useState } from 'react';
import { Check, Copy, Download, ExternalLink, FileText, Upload } from 'lucide-react';
import type {
  DeviceFolderBinding,
  DriveFolderMapping,
  LocalTrack,
  Playlist,
  SmartPlaylist,
  SyncDeviceProfile,
  SyncEvent,
} from '../types/music';
import type { TagReadUpdates } from '../utils/driveTagReader';
import type { CrateSyncLibraryBackupPayload, DriveFileItem } from '../utils/googleDriveApi';
import type { ManifestFolderState } from '../utils/folderMappings';
import type { LibraryPushMerge, LocalLibraryForPush } from '../utils/libraryMerge';
import type { ScannedFileEntry } from '../utils/syncEngine';
import {
  buildInstantQueueBatches,
  exportPlaylistToCSV,
  exportPlaylistToJSON,
  exportPlaylistToM3U8,
  exportPlaylistToPlainText,
  parseImportedText,
  triggerFileDownload,
  type ImportedTrackSeed,
} from '../utils/youtubeLinks';
import { GoogleDriveTransferSection } from './GoogleDriveTransferSection';

interface TransferViewProps {
  tracks: LocalTrack[];
  playlists: Playlist[];
  smartPlaylists: SmartPlaylist[];
  syncHistory: SyncEvent[];
  watchedFolderName: string | null;
  availableLocalFolders: string[];
  currentDevice: SyncDeviceProfile;
  devices: SyncDeviceProfile[];
  folderMappings: DriveFolderMapping[];
  trackMap: Map<string, LocalTrack>;
  storedAudioKeys: Set<string>;
  deviceCacheBytes: number;
  hasPlayableFile: (fileKey: string) => boolean;
  getCachedAudioBlob: (fileKey: string) => Promise<Blob | null>;
  onRenameCurrentDevice: (newName: string) => void;
  onSaveFolderMapping: (params: {
    driveFolderId: string;
    driveFolderName: string;
    binding: DeviceFolderBinding;
  }) => void;
  onUnbindDeviceFromMapping: (mappingId: string, deviceId: string) => void;
  onDeleteFolderMapping: (mappingId: string) => void;
  onMarkMappingSynced: (mappingId: string, deviceId: string) => void;
  /**
   * Merges a downloaded Drive manifest's devices and folder mappings into this device (or,
   * given null, changes nothing) and returns the state a push should write to the manifest.
   */
  onPrepareManifestForPush: (
    remote: CrateSyncLibraryBackupPayload | null,
    local: LocalLibraryForPush
  ) => ManifestFolderState & LibraryPushMerge;
  onImportPlaylist: (name: string, seeds: ImportedTrackSeed[]) => void;
  onRestoreLibraryBackup: (
    backup: CrateSyncLibraryBackupPayload,
    mode: 'merge' | 'replace'
  ) => void;
  onSyncFromDriveSourceOfTruth: (payload: {
    manifest: CrateSyncLibraryBackupPayload | null;
    driveAudioFiles: DriveFileItem[];
    folderLabel: string;
    mappedDriveFolderId?: string | null;
    replaceWithSourceOfTruth: boolean;
  }) => { addedSongs: number; updatedSongs: number; playlistCount: number; syncedTrackIds: string[] };
  onLinkUploadedDriveTracks: (
    updates: Array<{ trackId: string; driveFileId: string; driveModifiedTime: string; drivePath: string }>
  ) => void;
  onCacheDriveTrackAudio: (trackId: string, blob: Blob, driveFile?: DriveFileItem) => Promise<void>;
  /** Saves the fields a tag read changed, by track id. */
  onApplyTrackTagUpdates: (updates: TagReadUpdates) => void;
  onEvictTrackCache: (fileKeys: string[]) => Promise<void>;
  onClearAllDeviceCache: () => Promise<void>;
  onPlayTrack: (trackId: string, queueIds?: string[]) => void;
  onIngestLocalFolderEntries?: (
    entries: ScannedFileEntry[],
    folderRootName: string
  ) => Promise<void> | void;
  onNotify?: (payload: {
    title: string;
    description?: string;
    tone?: 'neutral' | 'success' | 'warning';
  }) => void;
}

export function TransferView({
  tracks,
  playlists,
  smartPlaylists,
  syncHistory,
  watchedFolderName,
  availableLocalFolders,
  currentDevice,
  devices,
  folderMappings,
  trackMap,
  storedAudioKeys,
  deviceCacheBytes,
  hasPlayableFile,
  getCachedAudioBlob,
  onRenameCurrentDevice,
  onSaveFolderMapping,
  onUnbindDeviceFromMapping,
  onDeleteFolderMapping,
  onMarkMappingSynced,
  onPrepareManifestForPush,
  onImportPlaylist,
  onRestoreLibraryBackup,
  onSyncFromDriveSourceOfTruth,
  onLinkUploadedDriveTracks,
  onCacheDriveTrackAudio,
  onApplyTrackTagUpdates,
  onEvictTrackCache,
  onClearAllDeviceCache,
  onPlayTrack,
  onIngestLocalFolderEntries,
  onNotify,
}: TransferViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedExportPlaylistId, setSelectedExportPlaylistId] = useState(
    playlists[0]?.id ?? ''
  );
  const [pasteText, setPasteText] = useState('');
  const [playlistNameDraft, setPlaylistNameDraft] = useState('');
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const exportPlaylist =
    playlists.find((p) => p.id === selectedExportPlaylistId) ?? playlists[0] ?? null;

  const exportTracks: LocalTrack[] = exportPlaylist
    ? exportPlaylist.trackIds
        .map((id) => trackMap.get(id))
        .filter((t): t is LocalTrack => Boolean(t))
    : [];

  const matchedIds = exportTracks
    .map((t) => t.youtubeVideoId)
    .filter((id): id is string => Boolean(id));
  const queueBatches = buildInstantQueueBatches(matchedIds);

  const handleFileImport = async (file: File) => {
    const content = await file.text();
    const { suggestedName, tracks } = parseImportedText(content, file.name);
    if (tracks.length === 0) {
      setImportFeedback('No valid tracks were found in that file.');
      return;
    }
    const finalName = playlistNameDraft.trim() || suggestedName;
    onImportPlaylist(finalName, tracks);
    setImportFeedback(`Imported ${tracks.length} tracks into "${finalName}".`);
    setPlaylistNameDraft('');
  };

  const handlePasteImport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteText.trim()) return;
    const { suggestedName, tracks } = parseImportedText(pasteText, 'Pasted Tracklist.txt');
    if (tracks.length === 0) {
      setImportFeedback('Could not parse any tracks. Use "Artist - Title" or YouTube URLs, one per line.');
      return;
    }
    const finalName = playlistNameDraft.trim() || suggestedName;
    onImportPlaylist(finalName, tracks);
    setImportFeedback(`Created "${finalName}" with ${tracks.length} imported tracks.`);
    setPasteText('');
    setPlaylistNameDraft('');
  };

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Clipboard blocked
    }
  };

  const safeFileBase = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'playlist';

  return (
    <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="pb-5 border-b border-white/[0.08]">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
            Cloud Sync, Import &amp; Export
          </h1>
          <p className="mt-1 text-sm text-[#8B92A2]">
            Use Google Drive as your master library source of truth, map folders across playing
            devices, cache songs offline, and transfer playlists to YouTube Music.
          </p>
        </div>

        {/* Google Drive Source-of-Truth Sync, Cross-Device Folder Mappings & Playing Device Cache */}
        <GoogleDriveTransferSection
          tracks={tracks}
          playlists={playlists}
          smartPlaylists={smartPlaylists}
          syncHistory={syncHistory}
          watchedFolderName={watchedFolderName}
          availableLocalFolders={availableLocalFolders}
          currentDevice={currentDevice}
          devices={devices}
          folderMappings={folderMappings}
          trackMap={trackMap}
          storedAudioKeys={storedAudioKeys}
          deviceCacheBytes={deviceCacheBytes}
          hasPlayableFile={hasPlayableFile}
          getCachedAudioBlob={getCachedAudioBlob}
          onRenameCurrentDevice={onRenameCurrentDevice}
          onSaveFolderMapping={onSaveFolderMapping}
          onUnbindDeviceFromMapping={onUnbindDeviceFromMapping}
          onDeleteFolderMapping={onDeleteFolderMapping}
          onMarkMappingSynced={onMarkMappingSynced}
          onPrepareManifestForPush={onPrepareManifestForPush}
          onImportPlaylist={onImportPlaylist}
          onRestoreLibraryBackup={onRestoreLibraryBackup}
          onSyncFromDriveSourceOfTruth={onSyncFromDriveSourceOfTruth}
          onLinkUploadedDriveTracks={onLinkUploadedDriveTracks}
          onCacheDriveTrackAudio={onCacheDriveTrackAudio}
          onApplyTrackTagUpdates={onApplyTrackTagUpdates}
          onEvictTrackCache={onEvictTrackCache}
          onClearAllDeviceCache={onClearAllDeviceCache}
          onPlayTrack={onPlayTrack}
          onIngestLocalFolderEntries={onIngestLocalFolderEntries}
          onNotify={onNotify}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Column 1: Export to YouTube Music / Local Formats */}
          <section className="rounded-lg border border-white/[0.08] bg-[#12141A] p-6 space-y-5">
            <div>
              <h2 className="font-display text-lg font-semibold text-white">
                Export to YouTube Music
              </h2>
              <p className="mt-1 text-xs text-[#8B92A2] leading-relaxed">
                Launch a ready-to-save YouTube queue from matched video IDs or download a clean CSV
                for bulk YouTube Music library importers.
              </p>
            </div>

            {playlists.length === 0 ? (
              <p className="text-xs text-[#6B7280] py-4">
                Create a playlist first to export or generate YouTube Music queue links.
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label htmlFor="export-pl-select" className="block text-xs text-[#9CA3AF]">
                    Select Playlist
                  </label>
                  <select
                    id="export-pl-select"
                    value={exportPlaylist?.id ?? ''}
                    onChange={(e) => setSelectedExportPlaylistId(e.target.value)}
                    className="w-full px-3 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-sm text-white focus:border-[#FF1F3D] focus:outline-none"
                  >
                    {playlists.map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.name} ({pl.trackIds.length} tracks)
                      </option>
                    ))}
                  </select>
                </div>

                {exportPlaylist && (
                  <>
                    <div className="text-xs font-mono tabular-nums text-[#8B92A2]">
                      {exportTracks.length} total tracks ·{' '}
                      <span className="text-[#22C55E]">{matchedIds.length} matched on YouTube</span>
                    </div>

                    {/* Instant YouTube Queue Links */}
                    <div className="pt-4 border-t border-white/[0.07] space-y-2.5">
                      <div className="text-xs font-medium text-[#D1D5DB]">
                        Instant YouTube Queue Launcher
                      </div>
                      {queueBatches.length === 0 ? (
                        <p className="text-xs text-[#6B7280]">
                          Match tracks in this playlist to YouTube Music video IDs to unlock
                          one-click YouTube queue creation.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {queueBatches.map((batch) => (
                            <div
                              key={batch.label}
                              className="flex items-center justify-between gap-2 p-2.5 rounded-md bg-[#0B0C0E] border border-white/[0.07]"
                            >
                              <span className="text-xs text-[#D1D5DB] truncate">{batch.label}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleCopy(batch.label, batch.url)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs text-[#9CA3AF] hover:text-white hover:bg-white/[0.06] transition-colors"
                                >
                                  {copiedKey === batch.label ? (
                                    <Check className="h-3.5 w-3.5 text-[#22C55E]" />
                                  ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                  )}
                                  <span>Copy</span>
                                </button>
                                <a
                                  href={batch.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors whitespace-nowrap"
                                >
                                  <span>Open</span>
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* File Downloads */}
                    <div className="pt-4 border-t border-white/[0.07] space-y-2.5">
                      <div className="text-xs font-medium text-[#D1D5DB]">Download Files</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          onClick={() =>
                            triggerFileDownload({
                              content: exportPlaylistToCSV(exportPlaylist, exportTracks),
                              fileName: `${safeFileBase(exportPlaylist.name)}.csv`,
                              mimeType: 'text/csv;charset=utf-8',
                            })
                          }
                          className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-md text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#232834] transition-colors whitespace-nowrap"
                        >
                          <Download className="h-3.5 w-3.5 text-[#9CA3AF]" />
                          <span>CSV (Transfer Ready)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            triggerFileDownload({
                              content: exportPlaylistToM3U8(exportPlaylist, exportTracks),
                              fileName: `${safeFileBase(exportPlaylist.name)}.m3u8`,
                              mimeType: 'audio/x-mpegurl;charset=utf-8',
                            })
                          }
                          className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-md text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#232834] transition-colors whitespace-nowrap"
                        >
                          <Download className="h-3.5 w-3.5 text-[#9CA3AF]" />
                          <span>M3U8 Playlist</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            triggerFileDownload({
                              content: exportPlaylistToJSON(exportPlaylist, exportTracks),
                              fileName: `${safeFileBase(exportPlaylist.name)}.json`,
                              mimeType: 'application/json;charset=utf-8',
                            })
                          }
                          className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-md text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#232834] transition-colors whitespace-nowrap"
                        >
                          <FileText className="h-3.5 w-3.5 text-[#9CA3AF]" />
                          <span>JSON Backup</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleCopy('plain', exportPlaylistToPlainText(exportTracks))
                          }
                          className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-md text-xs font-medium text-white bg-[#1B1F28] border border-white/[0.09] hover:bg-[#232834] transition-colors whitespace-nowrap"
                        >
                          {copiedKey === 'plain' ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-[#22C55E]" />
                              <span className="text-[#22C55E]">Copied Text</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 text-[#9CA3AF]" />
                              <span>Copy Plain List</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </section>

          {/* Column 2: Import Existing M3U / CSV / JSON / Tracklist */}
          <section className="rounded-lg border border-white/[0.08] bg-[#12141A] p-6 space-y-5">
            <div>
              <h2 className="font-display text-lg font-semibold text-white">
                Import Playlist or Tracklist
              </h2>
              <p className="mt-1 text-xs text-[#8B92A2] leading-relaxed">
                Load an existing M3U, M3U8, CSV, or JSON playlist from your device, or paste lines
                with YouTube Music URLs to match against local files.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="import-pl-name" className="block text-xs text-[#9CA3AF]">
                Target Playlist Name (optional)
              </label>
              <input
                id="import-pl-name"
                type="text"
                value={playlistNameDraft}
                onChange={(e) => setPlaylistNameDraft(e.target.value)}
                placeholder="Defaults to imported file name"
                className="w-full px-3 py-2 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-sm text-white placeholder-[#6B7280] focus:border-[#FF1F3D] focus:outline-none"
              />
            </div>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".m3u,.m3u8,.csv,.json,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleFileImport(file);
                  }
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-5 px-4 rounded-md border border-dashed border-white/[0.15] bg-[#0D0F13] hover:border-white/[0.3] hover:bg-[#14171F] transition-colors flex flex-col items-center gap-1.5"
              >
                <Upload className="h-4 w-4 text-[#9CA3AF]" />
                <span className="text-xs font-medium text-white">
                  Choose M3U8, CSV, or JSON file
                </span>
                <span className="text-[11px] text-[#6B7280]">
                  Automatically extracts track names, artists, and YouTube links
                </span>
              </button>
            </div>

            <form onSubmit={handlePasteImport} className="space-y-3 pt-2 border-t border-white/[0.07]">
              <label htmlFor="paste-tracklist" className="block text-xs text-[#9CA3AF]">
                Or paste tracklist / YouTube Music URLs (one per line)
              </label>
              <textarea
                id="paste-tracklist"
                rows={5}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={`Daft Punk - Instant Crush https://music.youtube.com/watch?v=a5uQMwRMHcs\nTame Impala - Let It Happen`}
                className="w-full px-3 py-2.5 rounded-md bg-[#0B0C0E] border border-white/[0.1] text-xs font-mono text-white placeholder-[#525866] focus:border-[#FF1F3D] focus:outline-none resize-y"
              />
              <button
                type="submit"
                disabled={!pasteText.trim()}
                className="px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                Import Tracklist
              </button>
            </form>

            {importFeedback && (
              <p className="text-xs text-[#22C55E] pt-1">{importFeedback}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
