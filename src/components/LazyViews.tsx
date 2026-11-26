import { Component, lazy, Suspense, type ReactNode } from 'react';
import { fetchCodeQuietly } from '../utils/staleCode';

/**
 * The seven screens. The browser fetches each one's code the first time it opens, so the
 * first page load carries the app shell and one screen.
 */
const loaders = {
  dashboard: () => import('./DashboardView'),
  scanner: () => import('./ScannerView'),
  playlist: () => import('./PlaylistView'),
  smartPlaylist: () => import('./SmartPlaylistView'),
  sync: () => import('./SyncQueueView'),
  scanLogs: () => import('./ScanLogView'),
  transfer: () => import('./TransferView'),
};

export const DashboardView = lazy(async () => ({
  default: (await loaders.dashboard()).DashboardView,
}));
export const ScannerView = lazy(async () => ({ default: (await loaders.scanner()).ScannerView }));
export const PlaylistView = lazy(async () => ({
  default: (await loaders.playlist()).PlaylistView,
}));
export const SmartPlaylistView = lazy(async () => ({
  default: (await loaders.smartPlaylist()).SmartPlaylistView,
}));
export const SyncQueueView = lazy(async () => ({ default: (await loaders.sync()).SyncQueueView }));
export const ScanLogView = lazy(async () => ({ default: (await loaders.scanLogs()).ScanLogView }));
export const TransferView = lazy(async () => ({
  default: (await loaders.transfer()).TransferView,
}));

/**
 * Fetches the code of the screens that are not open yet. Call it once the first screen is
 * up. A later click then opens at once, and a tab that stays open through a deploy already
 * holds every screen.
 */
export function fetchAllViews(): void {
  for (const load of Object.values(loaders)) void fetchCodeQuietly(load);
}

interface ViewBoundaryProps {
  children: ReactNode;
}

interface ViewBoundaryState {
  failed: boolean;
}

/**
 * Wraps the open screen. While its code is on the way the space stays empty, and a screen
 * that fails to load or to draw shows a message here while the sidebar and the player keep
 * working. Give it the open screen's name as `key`, so opening another screen clears the
 * message.
 */
export class ViewBoundary extends Component<ViewBoundaryProps, ViewBoundaryState> {
  state: ViewBoundaryState = { failed: false };

  static getDerivedStateFromError(): ViewBoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div
          role="alert"
          className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center"
        >
          <p className="text-sm text-[#B8BECB]">
            This screen did not load. Reload the page to try again.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-md text-xs font-medium text-white bg-[#FF1F3D] hover:bg-[#E11934] transition-colors"
          >
            Reload
          </button>
        </div>
      );
    }
    return (
      <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
        {this.props.children}
      </Suspense>
    );
  }
}
