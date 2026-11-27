import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { WatchedFoldersPanel } from '../src/components/WatchedFoldersPanel';
import type { FolderRow } from '../src/utils/watchedFolders';

function panel(rows: FolderRow[], isScanning = false): string {
  return renderToString(
    createElement(WatchedFoldersPanel, {
      rows,
      isScanning,
      onAllowFolder: () => {},
      onRemoveFolder: () => {},
      onAddFolder: () => {},
      onClose: () => {},
    })
  );
}

/** The markup of one row, found by the id the row carries. */
function rowOf(html: string, id: string): string {
  const start = html.indexOf(`data-folder-id="${id}"`);
  expect(start).toBeGreaterThan(-1);
  const next = html.indexOf('data-folder-id="', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

const rows: FolderRow[] = [
  { id: 'home', name: 'Music', songCount: 2573, state: 'watching' },
  { id: 'disk', name: 'Music', songCount: 1, state: 'needs-access' },
  { id: 'talk', name: 'Podcasts', songCount: 0, state: 'idle' },
];

describe('the list of watched folders', () => {
  test('shows each folder with its name and the songs its last scan saw', () => {
    const html = panel(rows);

    expect(rowOf(html, 'home')).toContain('Music');
    expect(rowOf(html, 'home')).toContain('2573 songs');
    expect(rowOf(html, 'disk')).toContain('1 song');
    expect(rowOf(html, 'disk')).not.toContain('1 songs');
    expect(rowOf(html, 'talk')).toContain('Podcasts');
    expect(rowOf(html, 'talk')).toContain('0 songs');
  });

  test('says which folders are watched and which need access', () => {
    const html = panel(rows);

    expect(rowOf(html, 'home')).toContain('Watching');
    expect(rowOf(html, 'disk')).toContain('Needs access');
    expect(rowOf(html, 'talk')).toContain('Idle');
  });

  test('offers to allow only the folder that needs access', () => {
    const html = panel(rows);

    expect(rowOf(html, 'disk')).toContain('Allow access to Music');
    expect(rowOf(html, 'home')).not.toContain('Allow access');
    expect(rowOf(html, 'talk')).not.toContain('Allow access');
  });

  test('offers to remove every folder', () => {
    const html = panel(rows);

    expect(rowOf(html, 'home')).toContain('Remove Music from your folders');
    expect(rowOf(html, 'disk')).toContain('Remove Music from your folders');
    expect(rowOf(html, 'talk')).toContain('Remove Podcasts from your folders');
  });

  test('keeps a folder from being removed while a scan runs', () => {
    const scanning = rowOf(panel(rows, true), 'home');
    const resting = rowOf(panel(rows), 'home');

    expect(scanning).toContain('disabled=""');
    expect(resting).not.toContain('disabled=""');
  });

  test('says so when no folder is picked', () => {
    expect(panel([])).toContain('No folder picked yet');
  });

  test('has no close button where the list always shows', () => {
    const pinned = renderToString(
      createElement(WatchedFoldersPanel, {
        rows,
        isScanning: false,
        onAllowFolder: () => {},
        onRemoveFolder: () => {},
        onAddFolder: () => {},
      })
    );

    expect(panel(rows)).toContain('Close the list of watched folders');
    expect(pinned).not.toContain('Close the list of watched folders');
    expect(rowOf(pinned, 'home')).toContain('2573 songs');
  });
});
