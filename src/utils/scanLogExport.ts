import type { DirectoryWatcherStatus, ScanLogEntry } from '../types/music';
import type { WatchIntervalSec } from './folderWatch';
import type { FileDownload } from './youtubeLinks';

/** The calendar day where the user is, as YYYY-MM-DD. */
export function localDateStamp(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function buildScanLogExport(input: {
  scanLogs: readonly ScanLogEntry[];
  watcherStatus: DirectoryWatcherStatus;
  watchedFolderName: string | null;
  autoWatchIntervalSec: WatchIntervalSec;
  now: Date;
}): FileDownload {
  const content = JSON.stringify(
    {
      exportedAt: input.now.toISOString(),
      watcherStatus: input.watcherStatus,
      watchedFolder: input.watchedFolderName,
      autoWatchIntervalSec: input.autoWatchIntervalSec,
      totalScans: input.scanLogs.length,
      logs: input.scanLogs,
    },
    null,
    2
  );
  return {
    fileName: `cratesync-scan-logs-${localDateStamp(input.now)}.json`,
    content,
    mimeType: 'application/json',
  };
}
