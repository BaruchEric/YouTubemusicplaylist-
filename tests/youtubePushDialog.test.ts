import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { YouTubePushDialog } from '../src/components/YouTubePushDialog';
import type { YouTubePushEstimate, YouTubePushOutcome } from '../src/utils/youtubePush';

const estimate: YouTubePushEstimate = {
  linkedPlaylistId: null,
  knowsWhatIsThere: false,
  matchedCount: 4,
  sendCount: 4,
  removeCount: 0,
  moveCount: 0,
  unmatchedCount: 0,
  quotaUnits: 250,
  days: 1,
};

function finishedWindow(playlist: YouTubePushOutcome['playlist']): string {
  const outcome: YouTubePushOutcome = {
    playlist,
    inserted: ['dQw4w9WgXcQ'],
    removed: [],
    moved: [],
    order: { state: 'in-order' },
    alreadyThere: 0,
    leftAlone: 0,
    unavailable: [],
    notSent: 0,
    onYouTube: ['dQw4w9WgXcQ'],
    stopped: null,
    record: null,
  };
  return renderToString(
    createElement(YouTubePushDialog, {
      playlistName: 'Road trip',
      estimate,
      state: { phase: 'done', outcome },
      isConnected: true,
      onStart: () => {},
      onStop: () => {},
      onClose: () => {},
    })
  );
}

const ACCOUNT_HINT = 'switch YouTube to the Google account you connected';

describe('the finished push window', () => {
  test('says which Google account opens the private playlist', () => {
    const html = finishedWindow({ id: 'PLtest', created: true });

    expect(html).toContain('Open the playlist in YouTube Music');
    expect(html).toContain(ACCOUNT_HINT);
  });

  test('leaves the account hint out when there is no playlist to open', () => {
    const html = finishedWindow(null);

    expect(html).not.toContain('Open the playlist in YouTube Music');
    expect(html).not.toContain(ACCOUNT_HINT);
  });
});
