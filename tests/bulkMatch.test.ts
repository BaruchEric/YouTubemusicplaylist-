/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import {
  applyMatches,
  candidatesFromSeeds,
  describeLookupFailure,
  normalizeForMatch,
  orderForSearch,
  pickSearchResult,
  planBulkMatch,
  playlistIdForLookup,
  scoreCandidate,
  searchForMatches,
  searchQueryFor,
  songsToMatch,
  type MatchCandidate,
} from '../src/utils/bulkMatch';
import { YouTubeApiError } from '../src/utils/youtubeApi';
import { makePlaylist, makeTrack } from './factories';

function video(title: string, channel = '', videoId = 'aaaaaaaaaaa'): MatchCandidate {
  return { videoId, title, channel };
}

function song(title: string, artist: string, id = 't1') {
  return makeTrack({ id, title, artist, fileName: `${title}.mp3` });
}

describe('normalizeForMatch', () => {
  test('drops case, accents, apostrophes and punctuation', () => {
    expect(normalizeForMatch("Beyoncé – Don't Stop  Believin'!")).toBe('beyonce dont stop believin');
  });

  test('reads an ampersand as the word and', () => {
    expect(normalizeForMatch('Simon & Garfunkel')).toBe('simon and garfunkel');
  });

  test('keeps letters of other scripts', () => {
    expect(normalizeForMatch('אריק איינשטיין')).toBe('אריק איינשטיין');
  });
});

describe('scoreCandidate', () => {
  test('an "Artist - Title (Official Video)" upload is an exact match', () => {
    const track = song('Up Where We Belong', 'Joe Cocker');
    const candidate = video('Joe Cocker - Up Where We Belong (Official Video) [HD]', 'JoeCockerVEVO');
    expect(scoreCandidate(track, candidate)).toBe('exact');
  });

  test('a Topic channel names the artist', () => {
    expect(scoreCandidate(song('Fireflies', 'Owl City'), video('Fireflies', 'Owl City - Topic'))).toBe(
      'exact'
    );
  });

  test('a title taken from the file name loses its track number', () => {
    const track = makeTrack({
      id: 't1',
      title: '09 Fireflies',
      artist: 'Owl City',
      fileName: '09 Fireflies.mp3',
    });
    expect(scoreCandidate(track, video('Fireflies', 'Owl City - Topic'))).toBe('exact');
  });

  test('a title that starts with a number matches as it is', () => {
    expect(scoreCandidate(song('99 Luftballons', 'Nena'), video('Nena - 99 Luftballons', 'Nena'))).toBe(
      'exact'
    );
  });

  test('the same title by another artist is no match', () => {
    const track = song('Sweet Dreams', 'Eurythmics');
    expect(scoreCandidate(track, video('Beyoncé - Sweet Dreams', 'BeyonceVEVO'))).toBeNull();
  });

  test('a live recording is no match for the studio song', () => {
    const track = song('Hotel California', 'Eagles');
    expect(scoreCandidate(track, video('Eagles - Hotel California (Live 1977)', 'Eagles'))).toBeNull();
  });

  test('a live recording matches a live song', () => {
    const track = song('Hotel California (Live)', 'Eagles');
    expect(scoreCandidate(track, video('Eagles - Hotel California (Live 1977)', 'Eagles'))).toBe(
      'exact'
    );
  });

  test('a karaoke or cover upload is no match', () => {
    const track = song('Fireflies', 'Owl City');
    expect(scoreCandidate(track, video('Owl City - Fireflies (Karaoke Version)', 'Sing King'))).toBeNull();
    expect(scoreCandidate(track, video('Fireflies - Owl City (Cover by Ann)', 'Ann'))).toBeNull();
  });

  test('a remaster note and a featured artist do not count against the title', () => {
    const track = song('Stan', 'Eminem');
    expect(scoreCandidate(track, video('Eminem - Stan (Long Version) ft. Dido', 'EminemVEVO'))).toBe(
      'exact'
    );
    expect(
      scoreCandidate(song('Heroes', 'David Bowie'), video('Heroes - 2017 Remaster', 'David Bowie - Topic'))
    ).toBe('exact');
  });

  test('the first of several tagged artists is enough', () => {
    const track = song('Up Where We Belong', 'Joe Cocker & Jennifer Warnes');
    expect(scoreCandidate(track, video('Joe Cocker - Up Where We Belong', 'Joe Cocker'))).toBe('exact');
  });

  test('an unknown artist makes the match likely at most', () => {
    const track = song('Fireflies', 'Unknown Artist');
    expect(scoreCandidate(track, video('Fireflies', 'Owl City - Topic'))).toBe('likely');
  });

  test('a close title by the same artist is likely', () => {
    const track = song('Boys of Summer', 'Don Henley');
    expect(scoreCandidate(track, video('Don Henley - The Boys Of Summer', 'DonHenleyVEVO'))).toBe(
      'likely'
    );
  });

  test('a song from a live album takes the live video or the studio one', () => {
    const track = makeTrack({
      id: 't1',
      title: 'Up Where We Belong',
      artist: 'Joe Cocker',
      album: 'Live at the Greek',
    });
    expect(scoreCandidate(track, video('Up Where We Belong (Live)', 'Joe Cocker - Topic'))).toBe('exact');
    expect(scoreCandidate(track, video('Up Where We Belong', 'Joe Cocker - Topic'))).toBe('exact');
    expect(scoreCandidate(track, video('Up Where We Belong (Karaoke)', 'Joe Cocker - Topic'))).toBeNull();
  });

  test('one short name out of a tagged pair is not enough', () => {
    const track = song('Angel', 'Simon & Garfunkel');
    expect(scoreCandidate(track, video('Paul Simon - Angel', 'PaulSimonVEVO'))).toBeNull();
    expect(scoreCandidate(track, video('Angel', 'Simon & Garfunkel - Topic'))).toBe('exact');
  });

  test('a band name with a slash or a comma matches whole', () => {
    expect(scoreCandidate(song('Thunderstruck', 'AC/DC'), video('Thunderstruck', 'AC/DC - Topic'))).toBe(
      'exact'
    );
    expect(
      scoreCandidate(song('September', 'Earth, Wind & Fire'), video('Earth, Wind & Fire - September', 'EarthWindandFireVEVO'))
    ).toBe('exact');
  });

  test('a short artist name has to appear as a word', () => {
    const track = song('One', 'U2');
    expect(scoreCandidate(track, video('One', 'Metallica - Topic'))).toBeNull();
    expect(scoreCandidate(track, video('U2 - One', 'U2'))).toBe('exact');
  });
});

describe('songsToMatch', () => {
  test('leaves out songs that have a video and songs marked skipped', () => {
    const tracks = [
      makeTrack({ id: 'a' }),
      makeTrack({ id: 'b', youtubeVideoId: 'bbbbbbbbbbb', matchStatus: 'matched' }),
      makeTrack({ id: 'c', matchStatus: 'skipped' }),
    ];
    expect(songsToMatch(tracks).map((t) => t.id)).toEqual(['a']);
  });
});

describe('planBulkMatch', () => {
  test('gives each unmatched song its best video from the pool', () => {
    const tracks = [
      song('Fireflies', 'Owl City', 'a'),
      song('Up Where We Belong', 'Joe Cocker', 'b'),
      song('Nothing Like It', 'Nobody', 'c'),
    ];
    const candidates = [
      video('Joe Cocker - Up Where We Belong', 'Joe Cocker', 'vvvvvvvvvv1'),
      video('Fireflies (Lyrics)', 'Some Lyrics Channel', 'vvvvvvvvvv2'),
      video('Fireflies', 'Owl City - Topic', 'vvvvvvvvvv3'),
    ];

    const proposals = planBulkMatch({ tracks, candidates });

    expect(proposals.map((p) => [p.trackId, p.candidate.videoId, p.confidence])).toEqual([
      ['a', 'vvvvvvvvvv3', 'exact'],
      ['b', 'vvvvvvvvvv1', 'exact'],
    ]);
  });

  test('skips a song that already has a video', () => {
    const tracks = [
      makeTrack({
        id: 'a',
        title: 'Fireflies',
        artist: 'Owl City',
        youtubeVideoId: 'zzzzzzzzzzz',
        matchStatus: 'matched',
      }),
    ];
    expect(planBulkMatch({ tracks, candidates: [video('Fireflies', 'Owl City - Topic')] })).toEqual([]);
  });

  test('finds a close title through the words the two share', () => {
    const tracks = [song('Boys of Summer', 'Don Henley', 'a')];
    const candidates = [video('Don Henley - The Boys Of Summer', 'DonHenleyVEVO', 'vvvvvvvvvv1')];
    expect(planBulkMatch({ tracks, candidates })[0]?.confidence).toBe('likely');
  });
});

describe('pickSearchResult', () => {
  test('takes an exact result over an earlier likely one', () => {
    const track = song('Boys of Summer', 'Don Henley');
    const results = [
      video('Don Henley - The Boys Of Summer', 'DonHenleyVEVO', 'vvvvvvvvvv1'),
      video('Boys of Summer', 'Don Henley - Topic', 'vvvvvvvvvv2'),
    ];
    expect(pickSearchResult(track, results)?.candidate.videoId).toBe('vvvvvvvvvv2');
  });

  test('takes the live video for a song from a live album', () => {
    const track = makeTrack({
      id: 't1',
      title: 'Up Where We Belong',
      artist: 'Joe Cocker',
      album: 'Live at the Greek',
    });
    const results = [
      video('Up Where We Belong', 'Joe Cocker - Topic', 'vvvvvvvvvv1'),
      video('Up Where We Belong (Live)', 'Joe Cocker - Topic', 'vvvvvvvvvv2'),
    ];
    expect(pickSearchResult(track, results)?.candidate.videoId).toBe('vvvvvvvvvv2');
  });

  test('returns null when no result fits', () => {
    const track = song('Fireflies', 'Owl City');
    expect(pickSearchResult(track, [video('Something Else', 'Somebody')])).toBeNull();
  });
});

describe('searchQueryFor', () => {
  test('joins artist and title', () => {
    expect(searchQueryFor(song('Fireflies', 'Owl City'))).toBe('Owl City Fireflies');
  });

  test('leaves out an unknown artist and a track number from the file name', () => {
    const track = makeTrack({
      id: 't1',
      title: '09 Fireflies',
      artist: 'Unknown Artist',
      fileName: '09 Fireflies.mp3',
    });
    expect(searchQueryFor(track)).toBe('Fireflies');
  });
});

describe('orderForSearch', () => {
  test('puts songs that are in a playlist first', () => {
    const tracks = [makeTrack({ id: 'a' }), makeTrack({ id: 'b' }), makeTrack({ id: 'c' })];
    const playlists = [makePlaylist({ id: 'p', trackIds: ['c', 'b'] })];
    expect(orderForSearch(tracks, playlists).map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('playlistIdForLookup', () => {
  test('reads the id out of a YouTube or YouTube Music link', () => {
    expect(playlistIdForLookup('https://music.youtube.com/playlist?list=PLabc123def456&si=x')).toBe(
      'PLabc123def456'
    );
    expect(playlistIdForLookup('youtube.com/watch?v=dQw4w9WgXcQ&list=OLAK5uy_abc')).toBe('OLAK5uy_abc');
  });

  test('takes a bare id', () => {
    expect(playlistIdForLookup('  PLabc123def456 ')).toBe('PLabc123def456');
  });

  test('reads liked songs as the liked videos list', () => {
    expect(playlistIdForLookup('https://www.youtube.com/playlist?list=LL')).toBe('LL');
    expect(playlistIdForLookup('https://music.youtube.com/playlist?list=LM')).toBe('LL');
  });

  test('returns null for anything else', () => {
    expect(playlistIdForLookup('')).toBeNull();
    expect(playlistIdForLookup('my road trip songs')).toBeNull();
    expect(playlistIdForLookup('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
});

describe('candidatesFromSeeds', () => {
  test('keeps the lines that carry a video and names each by artist and title', () => {
    const seeds = [
      { title: 'Fireflies', artist: 'Owl City', album: '', duration: 0, youtubeVideoId: 'vvvvvvvvvv1', relativePath: '' },
      { title: 'No Link', artist: 'Nobody', album: '', duration: 0, youtubeVideoId: null, relativePath: '' },
      { title: 'Stan', artist: 'Unknown Artist', album: '', duration: 0, youtubeVideoId: 'vvvvvvvvvv2', relativePath: '' },
    ];

    expect(candidatesFromSeeds(seeds)).toEqual([
      { videoId: 'vvvvvvvvvv1', title: 'Owl City - Fireflies', channel: '' },
      { videoId: 'vvvvvvvvvv2', title: 'Stan', channel: '' },
    ]);
  });

  test('a pasted line matches the song it names', () => {
    const tracks = [song('Fireflies', 'Owl City', 'a')];
    const seeds = [
      { title: 'Fireflies', artist: 'Owl City', album: '', duration: 0, youtubeVideoId: 'vvvvvvvvvv1', relativePath: '' },
    ];

    const proposals = planBulkMatch({ tracks, candidates: candidatesFromSeeds(seeds) });

    expect(proposals).toEqual([
      {
        trackId: 'a',
        candidate: { videoId: 'vvvvvvvvvv1', title: 'Owl City - Fireflies', channel: '' },
        confidence: 'exact',
      },
    ]);
  });
});

describe('searchForMatches', () => {
  const tracks = [
    song('Fireflies', 'Owl City', 'a'),
    song('Nothing Like It', 'Nobody', 'b'),
    song('Up Where We Belong', 'Joe Cocker', 'c'),
  ];

  function apiFrom(replies: Array<MatchCandidate[] | Error>) {
    const queries: string[] = [];
    const queue = [...replies];
    return {
      queries,
      api: {
        async searchVideos(query: string): Promise<MatchCandidate[]> {
          queries.push(query);
          const reply = queue.shift();
          if (!reply) throw new Error('ran out of replies');
          if (reply instanceof Error) throw reply;
          return reply;
        },
      },
    };
  }

  function failure(kind: 'quota' | 'busy' | 'auth'): YouTubeApiError {
    return new YouTubeApiError({ failure: kind, status: 403, reason: kind, message: kind });
  }

  test('searches each song once and sorts the answers', async () => {
    const { api, queries } = apiFrom([
      [video('Fireflies', 'Owl City - Topic', 'vvvvvvvvvv1')],
      [video('Unrelated', 'Someone', 'vvvvvvvvvv2')],
      [video('Joe Cocker - Up Where We Belong', 'Joe Cocker', 'vvvvvvvvvv3')],
    ]);
    const seen: number[] = [];

    const outcome = await searchForMatches({
      api,
      tracks,
      onProgress: (progress) => seen.push(progress.done),
    });

    expect(queries).toEqual(['Owl City Fireflies', 'Nobody Nothing Like It', 'Joe Cocker Up Where We Belong']);
    expect(outcome.proposals.map((p) => p.trackId)).toEqual(['a', 'c']);
    expect(outcome.searchedIds).toEqual(['a', 'b', 'c']);
    expect(outcome.stopped).toBeNull();
    expect(seen).toEqual([1, 2, 3]);
  });

  test('stops when the daily allowance runs out and keeps what it found', async () => {
    const { api } = apiFrom([[video('Fireflies', 'Owl City - Topic')], failure('quota')]);

    const outcome = await searchForMatches({ api, tracks });

    expect(outcome.proposals).toHaveLength(1);
    expect(outcome.searchedIds).toEqual(['a']);
    expect(outcome.stopped?.failure).toBe('quota');
  });

  test('tries a busy search once more', async () => {
    const { api, queries } = apiFrom([
      failure('busy'),
      [video('Fireflies', 'Owl City - Topic')],
      [],
      [],
    ]);

    const outcome = await searchForMatches({ api, tracks, wait: async () => {} });

    expect(queries).toHaveLength(4);
    expect(outcome.searchedIds).toEqual(['a', 'b', 'c']);
    expect(outcome.stopped).toBeNull();
  });

  test('stops at once when the user stops it', async () => {
    const controller = new AbortController();
    const { api, queries } = apiFrom([[video('Fireflies', 'Owl City - Topic')], [], []]);

    const outcome = await searchForMatches({
      api,
      tracks,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });

    expect(queries).toHaveLength(1);
    expect(outcome.stopped?.failure).toBe('cancelled');
  });
});

describe('applyMatches', () => {
  const proposal = (trackId: string, videoId: string) => ({
    trackId,
    candidate: video('Any', 'Any', videoId),
    confidence: 'exact' as const,
  });

  test('gives each song its video and marks it matched', () => {
    const tracks = [makeTrack({ id: 'a' }), makeTrack({ id: 'b' })];

    const result = applyMatches(tracks, [proposal('a', 'vvvvvvvvvv1')]);

    expect(result.appliedCount).toBe(1);
    expect(result.tracks[0]).toMatchObject({ youtubeVideoId: 'vvvvvvvvvv1', matchStatus: 'matched' });
    expect(result.tracks[1]).toBe(tracks[1]);
  });

  test('keeps the video a song already has', () => {
    const tracks = [makeTrack({ id: 'a', youtubeVideoId: 'zzzzzzzzzzz', matchStatus: 'matched' })];

    const result = applyMatches(tracks, [proposal('a', 'vvvvvvvvvv1')]);

    expect(result.appliedCount).toBe(0);
    expect(result.tracks[0]).toBe(tracks[0]);
  });

  test('records the time when the videos came from YouTube just now', () => {
    const tracks = [makeTrack({ id: 'a' })];

    const result = applyMatches(tracks, [proposal('a', 'vvvvvvvvvv1')], 5_000);

    expect(result.tracks[0]?.youtubeChecked).toEqual({ videoId: 'vvvvvvvvvv1', at: 5_000 });
  });

  test('records no check for videos from a pasted list', () => {
    const tracks = [makeTrack({ id: 'a' })];

    const result = applyMatches(tracks, [proposal('a', 'vvvvvvvvvv1')]);

    expect(result.tracks[0]?.youtubeChecked).toBeUndefined();
  });

  test('does not keep the title YouTube returned', () => {
    const tracks = [makeTrack({ id: 'a' })];

    const result = applyMatches(tracks, [proposal('a', 'vvvvvvvvvv1')]);

    expect(result.tracks[0]?.youtubeTitle).toBeNull();
  });
});

describe('describeLookupFailure', () => {
  test('says when the allowance comes back', () => {
    expect(describeLookupFailure('quota', 'search')).toContain('midnight Pacific time');
  });

  test('says who can open a playlist YouTube will not show', () => {
    expect(describeLookupFailure('playlist-missing', 'playlist')).toContain('account that owns it');
    expect(describeLookupFailure('forbidden', 'playlist')).toContain('account that owns it');
  });
});
