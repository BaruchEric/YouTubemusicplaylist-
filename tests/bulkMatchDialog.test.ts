/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { BulkMatchDialog, type BulkMatchDialogState } from '../src/components/BulkMatchDialog';
import type { MatchProposal } from '../src/utils/bulkMatch';
import { PRIVACY_URL, TERMS_URL, YOUTUBE_TERMS_URL } from '../src/utils/legalLinks';
import { makeTrack } from './factories';

const tracks = [
  makeTrack({ id: 'a', title: 'Fireflies', artist: 'Owl City' }),
  makeTrack({ id: 'b', title: 'Boys of Summer', artist: 'Don Henley' }),
];

const proposals: MatchProposal[] = [
  {
    trackId: 'a',
    candidate: { videoId: 'vvvvvvvvvv1', title: 'Fireflies', channel: 'Owl City - Topic' },
    confidence: 'exact',
  },
  {
    trackId: 'b',
    candidate: {
      videoId: 'vvvvvvvvvv2',
      title: 'Don Henley - The Boys Of Summer',
      channel: 'DonHenleyVEVO',
    },
    confidence: 'likely',
  },
];

function render(
  state: BulkMatchDialogState,
  counts: { unmatchedCount: number; searchableCount: number; selectedCount?: number } = {
    unmatchedCount: 2568,
    searchableCount: 2568,
  }
): string {
  return renderToString(
    createElement(BulkMatchDialog, {
      tracks,
      selectedCount: null,
      ...counts,
      state,
      isConnected: false,
      onSearch: () => {},
      onReadPlaylist: () => {},
      onReadList: () => {},
      onForgetSearched: () => {},
      onStop: () => {},
      onApply: () => {},
      onBack: () => {},
      onClose: () => {},
    })
  );
}

/** React writes a comment between a number and the text next to it. */
function text(html: string): string {
  return html.replace(/<!-- -->/g, '');
}

describe('the bulk match window, choosing a source', () => {
  test('says how many songs have no video and what a search costs', () => {
    const html = text(render({ phase: 'choose', error: null }));

    expect(html).toContain('2568 songs have no YouTube video yet');
    expect(html).toContain('100 songs a day');
  });

  test('names YouTube API Services and links the terms a search falls under', () => {
    const html = render({ phase: 'choose', error: null });

    expect(html).toContain('YouTube API Services');
    expect(html).toContain(`href="${YOUTUBE_TERMS_URL}"`);
    expect(html).toContain(`href="${TERMS_URL}"`);
    expect(html).toContain(`href="${PRIVACY_URL}"`);
  });

  test('counts within the selection when it was opened for selected songs', () => {
    const html = text(
      render(
        { phase: 'choose', error: null },
        { unmatchedCount: 7, searchableCount: 7, selectedCount: 12 }
      )
    );

    expect(html).toContain('7 of the 12 selected songs have no YouTube video yet');
  });

  test('says how many songs a recent search leaves out', () => {
    const html = text(
      render({ phase: 'choose', error: null }, { unmatchedCount: 100, searchableCount: 60 })
    );

    expect(html).toContain('40 songs were searched in the last 30 days');
  });

  test('shows why the last try failed', () => {
    const html = render({ phase: 'choose', error: 'That link holds no playlist.' });

    expect(html).toContain('That link holds no playlist.');
  });
});

describe('the bulk match window, working', () => {
  test('counts the songs searched and found, with a way to stop', () => {
    const html = text(
      render({
        phase: 'working',
        label: 'Searching YouTube',
        progress: { done: 12, total: 25, found: 9 },
        canStop: true,
      })
    );

    expect(html).toContain('12 of 25 songs, 9 found');
    expect(html).toContain('Stop');
  });
});

describe('the bulk match window, reviewing', () => {
  test('lists each song next to its video, linked to YouTube Music', () => {
    const html = text(render({ phase: 'review', proposals, note: null }));

    expect(html).toContain('Owl City - Fireflies');
    expect(html).toContain('href="https://music.youtube.com/watch?v=vvvvvvvvvv1"');
    expect(html).toContain('Owl City - Topic');
    expect(html).toContain('Don Henley - The Boys Of Summer');
  });

  test('ticks the exact matches and leaves the likely ones for the user', () => {
    const html = text(render({ phase: 'review', proposals, note: null }));

    expect(html).toContain('Apply 1 match');
    expect(html).toContain('1 likely match is not ticked');
  });

  test('says so when nothing matched', () => {
    const html = text(render({ phase: 'review', proposals: [], note: null }));

    expect(html).toContain('No song matched');
  });

  test('passes on why a search stopped early', () => {
    const html = render({
      phase: 'review',
      proposals,
      note: 'Stopped. Search again to look up the rest.',
    });

    expect(html).toContain('Stopped. Search again to look up the rest.');
  });
});

describe('the bulk match window, done', () => {
  test('says how many songs now have a video', () => {
    const html = text(render({ phase: 'done', appliedCount: 3 }));

    expect(html).toContain('3 songs now have a YouTube video');
  });
});
