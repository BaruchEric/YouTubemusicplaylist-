/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { removeDuplicateTracks } from '../src/utils/duplicateRemoval';
import { makeTrack } from './factories';

describe('removeDuplicateTracks', () => {
  test('the kept copy takes the YouTube match of the duplicate that goes', () => {
    const kept = makeTrack({ id: 'kept', title: 'Shout', fileName: '04 Shout.mp3' });
    const copy = makeTrack({
      id: 'copy',
      title: 'Shout',
      fileName: '04 Shout 1.mp3',
      youtubeVideoId: 'ldAp-mZqAro',
      youtubeTitle: 'Shout',
      matchStatus: 'matched',
      youtubeChecked: { videoId: 'ldAp-mZqAro', at: 1_700_000_000_000 },
    });

    const result = removeDuplicateTracks([kept, copy], ['copy'], { copy: 'kept' });

    expect(result.map((track) => track.id)).toEqual(['kept']);
    expect(result[0]?.youtubeVideoId).toBe('ldAp-mZqAro');
    expect(result[0]?.youtubeTitle).toBe('Shout');
    expect(result[0]?.matchStatus).toBe('matched');
    expect(result[0]?.youtubeChecked).toEqual({ videoId: 'ldAp-mZqAro', at: 1_700_000_000_000 });
  });

  test('a kept copy with its own match keeps it', () => {
    const kept = makeTrack({ id: 'kept', youtubeVideoId: 'aaaaaaaaaaa', matchStatus: 'matched' });
    const copy = makeTrack({ id: 'copy', youtubeVideoId: 'bbbbbbbbbbb', matchStatus: 'matched' });

    const result = removeDuplicateTracks([kept, copy], ['copy'], { copy: 'kept' });

    expect(result).toHaveLength(1);
    expect(result[0]?.youtubeVideoId).toBe('aaaaaaaaaaa');
  });

  test('a song that is not a duplicate is returned as it was', () => {
    const other = makeTrack({ id: 'other' });
    const kept = makeTrack({ id: 'kept' });
    const copy = makeTrack({ id: 'copy' });

    const result = removeDuplicateTracks([other, kept, copy], ['copy'], { copy: 'kept' });

    expect(result[0]).toBe(other);
    expect(result[1]).toBe(kept);
  });
});
