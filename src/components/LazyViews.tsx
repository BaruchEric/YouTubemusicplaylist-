import type { ReactNode } from 'react';
import { fetchCodeQuietly } from '../utils/staleCode';
import { CodeBoundary, ReloadButton } from './CodeBoundary';
import { lazyComponent } from './lazyComponent';

/**
 * The seven screens. The browser fetches each one's code the first time it opens, so the
 * first page load carries the app shell and one screen.
 */
const views = {
  dashboard: lazyComponent(async () => (await import('./DashboardView')).DashboardView),
  scanner: lazyComponent(async () => (await import('./ScannerView')).ScannerView),
  playlist: lazyComponent(async () => (await import('./PlaylistView')).PlaylistView),
  smartPlaylist: lazyComponent(
    async () => (await import('./SmartPlaylistView')).SmartPlaylistView
  ),
  sync: lazyComponent(async () => (await import('./SyncQueueView')).SyncQueueView),
  scanLogs: lazyComponent(async () => (await import('./ScanLogView')).ScanLogView),
  transfer: lazyComponent(async () => (await import('./TransferView')).TransferView),
};

export const DashboardView = views.dashboard.Component;
export const ScannerView = views.scanner.Component;
export const PlaylistView = views.playlist.Component;
export const SmartPlaylistView = views.smartPlaylist.Component;
export const SyncQueueView = views.sync.Component;
export const ScanLogView = views.scanLogs.Component;
export const TransferView = views.transfer.Component;

/**
 * Fetches the code of the screens that are not open yet. Call it once the first screen is
 * up. A later click then opens at once, and a tab that stays open through a deploy already
 * holds every screen.
 */
export function fetchAllViews(): void {
  for (const view of Object.values(views)) void fetchCodeQuietly(view.fetch);
}

/**
 * Wraps the open screen. While its code is on the way the space stays empty, and a screen
 * that fails to load or to draw shows a message here while the sidebar and the player keep
 * working. Give it the open screen's name as `key`, so opening another screen clears the
 * message.
 */
export function ViewBoundary({ children }: { children: ReactNode }) {
  return (
    <CodeBoundary
      waiting={<div className="flex-1" aria-busy="true" />}
      failed={
        <div
          role="alert"
          className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center"
        >
          <p className="text-sm text-[#B8BECB]">
            This screen did not load. Reload the page to try again.
          </p>
          <ReloadButton />
        </div>
      }
    >
      {children}
    </CodeBoundary>
  );
}
