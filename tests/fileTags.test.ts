/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { applyFileTags, guessTrackFieldsFromDrivePath, type FileTagValues } from '../src/utils/fileTags';
import { buildTrackStubFromDriveAudio, type DriveFileItem } from '../src/utils/googleDriveApi';
import type { LocalTrack } from '../src/types/music';

function driveFile(name: string, folderPath?: string): DriveFileItem {
  return {
    id: `id-${name}`,
    name,
    mimeType: 'audio/mpeg',
    size: 5_000_000,
    modifiedTime: '2026-11-20T10:00:00Z',
    folderPath,
  };
}

/** A song as the Drive listing leaves it: guessed from its name and folders, never downloaded. */
function stub(name: string, folderPath?: string, overrides: Partial<LocalTrack> = {}): LocalTrack {
  return { ...buildTrackStubFromDriveAudio(driveFile(name, folderPath)), ...overrides };
}

const fireflies: FileTagValues = {
  title: 'Fireflies',
  artist: 'Owl City',
  album: 'Ocean Eyes (Deluxe)',
  genre: 'Electronic',
  year: '2009',
  trackNumber: 9,
  coverArtUrl: 'data:image/jpeg;base64,AAAA',
  duration: 228.4,
};

describe('guessTrackFieldsFromDrivePath', () => {
  test('takes artist and album from the two folders above the file', () => {
    const guess = guessTrackFieldsFromDrivePath(
      '04 Up Where We Belong.mp3',
      'Google Drive/Music/Joe Cocker/VG;Live!'
    );
    expect(guess.title).toBe('04 Up Where We Belong');
    expect(guess.artist).toBe('Joe Cocker');
    expect(guess.album).toBe('VG;Live!');
    expect(guess.trackNumber).toBeNull();
    expect(guess.effectivePath).toBe('Google Drive/Music/Joe Cocker/VG;Live!');
    expect(guess.leafFolder).toBe('VG;Live!');
  });

  test('splits a track number and an artist out of the file name', () => {
    const guess = guessTrackFieldsFromDrivePath('03 - Daft Punk - One More Time.flac', 'Music');
    expect(guess.trackNumber).toBe(3);
    expect(guess.artist).toBe('Daft Punk');
    expect(guess.title).toBe('One More Time');
    expect(guess.album).toBe('Music');
  });

  test('falls back to placeholders when there is no folder path', () => {
    const guess = guessTrackFieldsFromDrivePath('song.mp3', undefined);
    expect(guess.artist).toBe('Unknown Artist');
    expect(guess.album).toBe('Google Drive Library');
    expect(guess.effectivePath).toBe('Google Drive');
  });
});

describe('buildTrackStubFromDriveAudio', () => {
  test('fills a stub from the shared path guess', () => {
    const track = stub('09 Fireflies.mp3', '/Google Drive/Music/Owl City/Ocean Eyes/');
    expect(track.title).toBe('09 Fireflies');
    expect(track.artist).toBe('Owl City');
    expect(track.album).toBe('Ocean Eyes');
    expect(track.trackNumber).toBeNull();
    expect(track.folderName).toBe('Ocean Eyes');
    expect(track.drivePath).toBe('Google Drive/Music/Owl City/Ocean Eyes');
    expect(track.relativePath).toBe('Google Drive/Music/Owl City/Ocean Eyes/09 Fireflies.mp3');
    expect(track.fileKey).toBe('gdrive::id-09 Fireflies.mp3');
    expect(track.duration).toBe(0);
    expect(track.coverArtUrl).toBeNull();
    expect(track.format).toBe('MP3');
  });

  test('uses the artist folder for a song that sits right under it', () => {
    const track = stub('01. Intro.mp3', 'Music/Joe Cocker');
    expect(track.trackNumber).toBe(1);
    expect(track.title).toBe('Intro');
    expect(track.artist).toBe('Joe Cocker');
    expect(track.album).toBe('Joe Cocker');
  });
});

describe('applyFileTags', () => {
  test('replaces every value the path guessed with the value in the file', () => {
    const track = stub('09 Fireflies.mp3', 'Google Drive/Music/Owl City/Ocean Eyes');

    expect(applyFileTags(track, fireflies)).toEqual({
      title: 'Fireflies',
      album: 'Ocean Eyes (Deluxe)',
      genre: 'Electronic',
      year: '2009',
      trackNumber: 9,
      coverArtUrl: 'data:image/jpeg;base64,AAAA',
      duration: 228.4,
    });
  });

  test('replaces placeholders', () => {
    const track = stub('song.mp3', undefined);
    expect(track.artist).toBe('Unknown Artist');
    expect(track.album).toBe('Google Drive Library');

    const changes = applyFileTags(track, fireflies);

    expect(changes.artist).toBe('Owl City');
    expect(changes.album).toBe('Ocean Eyes (Deluxe)');
    expect(applyFileTags({ ...track, album: 'Unknown Album' }, fireflies).album).toBe(
      'Ocean Eyes (Deluxe)'
    );
    expect(applyFileTags({ ...track, title: '  ' }, fireflies).title).toBe('Fireflies');
  });

  test('keeps a value the user typed', () => {
    const track = stub('09 Fireflies.mp3', 'Google Drive/Music/Owl City/Ocean Eyes', {
      title: 'Fireflies (my edit)',
      artist: 'Owl City feat. Nobody',
      album: 'Road Trip',
      genre: 'Synthpop',
      year: '2010',
    });

    const changes = applyFileTags(track, fireflies);

    expect(changes.title).toBeUndefined();
    expect(changes.artist).toBeUndefined();
    expect(changes.album).toBeUndefined();
    expect(changes.genre).toBeUndefined();
    expect(changes.year).toBeUndefined();
  });

  test('keeps the guessed value when the file has none', () => {
    const track = stub('09 Fireflies.mp3', 'Google Drive/Music/Owl City/Ocean Eyes');

    expect(applyFileTags(track, { duration: 0 })).toEqual({});
    expect(applyFileTags(track, { title: '', artist: '  ', album: null, genre: null })).toEqual({});
  });

  test('still knows the path guess after a later scan changed the Drive path', () => {
    const track = stub('01. Intro.mp3', 'Music/Joe Cocker', { drivePath: 'Joe Cocker' });
    expect(track.artist).toBe('Joe Cocker');

    expect(applyFileTags(track, { artist: 'Joe Cocker & Friends' }).artist).toBe('Joe Cocker & Friends');
  });

  test('treats a title that is the bare file name as a guess', () => {
    const track = stub('03 - Intro.mp3', 'Music/A/B', { title: '03 - Intro' });
    expect(guessTrackFieldsFromDrivePath(track.fileName, track.drivePath).title).toBe('Intro');

    expect(applyFileTags(track, { title: 'Intro (Live)' }).title).toBe('Intro (Live)');
  });

  test('takes the duration of the file only when it is above 0', () => {
    const track = stub('a.mp3', 'Music/A/B', { duration: 200 });

    expect(applyFileTags(track, { duration: 0 }).duration).toBeUndefined();
    expect(applyFileTags(track, { duration: 201.5 }).duration).toBe(201.5);
  });

  test('keeps cover art the song already has', () => {
    const track = stub('a.mp3', 'Music/A/B', { coverArtUrl: 'data:image/png;base64,MINE' });

    expect(applyFileTags(track, fireflies).coverArtUrl).toBeUndefined();
  });

  test('takes the track number tag of the file over the current one', () => {
    const track = stub('04 - Song.mp3', 'Music/A/B');
    expect(track.trackNumber).toBe(4);

    expect(applyFileTags(track, { trackNumber: 7 }).trackNumber).toBe(7);
    expect(applyFileTags(track, { trackNumber: null }).trackNumber).toBeUndefined();
    expect(applyFileTags(track, { trackNumber: 0 }).trackNumber).toBeUndefined();
  });

  test('never sets the edit time', () => {
    const track = stub('09 Fireflies.mp3', 'Google Drive/Music/Owl City/Ocean Eyes');

    expect('updatedAt' in applyFileTags(track, fireflies)).toBe(false);
  });

  test('reports nothing when the song already matches the file', () => {
    const track = stub('09 Fireflies.mp3', 'Google Drive/Music/Owl City/Ocean Eyes');
    const read = { ...track, ...applyFileTags(track, fireflies) };

    expect(applyFileTags(read, fireflies)).toEqual({});
  });
});
