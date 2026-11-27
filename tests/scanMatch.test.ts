/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { createScanMatcher, linkDriveSongToLocalFile, type ScannedFile } from '../src/utils/scanMatch';
import type { LocalTrack } from '../src/types/music';
import { makeTrack } from './factories';

function file(relativePath: string, size = 5_601_094): ScannedFile {
  return { name: relativePath.split('/').pop() ?? relativePath, size, relativePath };
}

/** A song listed from Drive whose audio was never read on this device. */
function driveSong(id: string, drivePath: string, fileName: string, size = 5_601_094): LocalTrack {
  return makeTrack({
    id,
    fileKey: `gdrive::${id}`,
    fileName,
    relativePath: `${drivePath}/${fileName}`,
    folderName: drivePath.split('/').pop() ?? drivePath,
    fileSize: size,
    duration: 0,
    driveFileId: id,
    drivePath,
    cachedOnDeviceAt: null,
  });
}

const noAudio = () => false;

describe('createScanMatcher', () => {
  test('knows a file it scanned before by its path and size', () => {
    const track = makeTrack({
      id: 'a',
      fileKey: 'music/a.mp3::1000',
      relativePath: 'Music/a.mp3',
      fileSize: 1000,
    });
    const matcher = createScanMatcher([track], noAudio);

    expect(matcher.match(file('Music/A.mp3', 1000))).toEqual({ kind: 'known', track });
  });

  test('knows a Drive song that already points at this file', () => {
    const track = {
      ...driveSong('d1', 'Google Drive/Music/Joe Cocker/Live', '04 Up.mp3'),
      relativePath: 'Music/Joe Cocker/Live/04 Up.mp3',
      folderName: 'Music',
    };
    const matcher = createScanMatcher([track], () => true);

    expect(matcher.match(file('Music/Joe Cocker/Live/04 Up.mp3'))).toEqual({ kind: 'known', track });
  });

  test('gives a loose file back to a missing song with the same name and size', () => {
    const track = makeTrack({
      id: 'a',
      fileKey: 'old folder/song.mp3::1000',
      fileName: 'song.mp3',
      relativePath: 'Old Folder/song.mp3',
      fileSize: 1000,
      isMissingOnDevice: true,
    });
    const matcher = createScanMatcher([track], noAudio);

    expect(matcher.match(file('song.mp3', 1000))).toEqual({ kind: 'known', track });
  });

  test('treats a loose file as new when the song with its name still has its audio here', () => {
    const track = makeTrack({
      id: 'a',
      fileKey: 'old folder/song.mp3::1000',
      fileName: 'song.mp3',
      relativePath: 'Old Folder/song.mp3',
      fileSize: 1000,
    });
    const matcher = createScanMatcher([track], (fileKey) => fileKey === track.fileKey);

    expect(matcher.match(file('song.mp3', 1000))).toEqual({ kind: 'new' });
  });

  test('links a file in a folder to the Drive song with its name and size', () => {
    const track = driveSong('d1', 'Google Drive/Music/Joe Cocker/Live', '04 Up.mp3');
    const matcher = createScanMatcher([track], noAudio);

    expect(matcher.match(file('Music/Joe Cocker/Live/04 Up.mp3'))).toEqual({
      kind: 'drive-copy',
      track,
    });
  });

  test('links the file even when the Drive audio was already downloaded here', () => {
    const track = driveSong('d1', 'Google Drive/Music/Joe Cocker/Live', '04 Up.mp3');
    const matcher = createScanMatcher([track], () => true);

    expect(matcher.match(file('Music/Joe Cocker/Live/04 Up.mp3')).kind).toBe('drive-copy');
  });

  test('a file picked on its own leaves the Drive song at its Drive path', () => {
    const track = driveSong('d1', 'Google Drive/Music/Joe Cocker/Live', '04 Up.mp3');
    const matcher = createScanMatcher([track], () => true);

    expect(matcher.match(file('04 Up.mp3'))).toEqual({ kind: 'known', track });
  });

  test('does not link a file in a folder to a scanned song that lives elsewhere', () => {
    const track = makeTrack({
      id: 'a',
      fileKey: 'old/04 up.mp3::5601094',
      fileName: '04 Up.mp3',
      relativePath: 'Old/04 Up.mp3',
      fileSize: 5_601_094,
      isMissingOnDevice: true,
    });
    const matcher = createScanMatcher([track], noAudio);

    expect(matcher.match(file('Music/Joe Cocker/Live/04 Up.mp3'))).toEqual({ kind: 'new' });
  });

  test('does not take a Drive song that another local file already holds', () => {
    const track = {
      ...driveSong('d1', 'Google Drive/Music/Joe Cocker/Live', '04 Up.mp3'),
      relativePath: 'Music/Joe Cocker/Live/04 Up.mp3',
      folderName: 'Music',
    };
    const matcher = createScanMatcher([track], () => true);

    expect(matcher.match(file('Backup/Joe Cocker/Live/04 Up.mp3'))).toEqual({ kind: 'new' });
  });

  test('gives the Drive song to the first of two copies in one scan', () => {
    const track = driveSong('d1', 'Google Drive/Music/Joe Cocker/Live', '04 Up.mp3');
    const matcher = createScanMatcher([track], noAudio);

    expect(matcher.match(file('Music/Joe Cocker/Live/04 Up.mp3')).kind).toBe('drive-copy');
    expect(matcher.match(file('Backup/Joe Cocker/Live/04 Up.mp3'))).toEqual({ kind: 'new' });
  });

  test('picks the Drive song whose folders match when two share a name and size', () => {
    const best = driveSong('d1', 'Google Drive/Music/Various/Best Of', '01 Intro.mp3');
    const live = driveSong('d2', 'Google Drive/Music/Various/Live', '01 Intro.mp3');
    const matcher = createScanMatcher([best, live], noAudio);

    expect(matcher.match(file('Music/Various/Live/01 Intro.mp3'))).toEqual({
      kind: 'drive-copy',
      track: live,
    });
    expect(matcher.match(file('Music/Various/Best Of/01 Intro.mp3'))).toEqual({
      kind: 'drive-copy',
      track: best,
    });
  });

  // A folder on a Mac can hand back "é" as "e" plus a combining accent. The Drive listing sends one character.
  test('links a Drive song to a file whose name spells an accent with two characters', () => {
    const song = driveSong('d1', 'Google Drive/Music/Joe Dassin/Vol.1', "01 L'Et\u00e9 Indien.mp3");
    const matcher = createScanMatcher([song], noAudio);

    expect(matcher.match(file("Music/Joe Dassin/Vol.1/01 L'Ete\u0301 Indien.mp3"))).toEqual({
      kind: 'drive-copy',
      track: song,
    });
  });

  test('knows a scanned file again when its accent is spelled the other way', () => {
    const track = makeTrack({
      id: 'a',
      fileKey: 'music/caf\u00e9.mp3::1000',
      fileName: 'Caf\u00e9.mp3',
      relativePath: 'Music/Caf\u00e9.mp3',
      fileSize: 1000,
    });
    const matcher = createScanMatcher([track], noAudio);

    expect(matcher.match(file('Music/Cafe\u0301.mp3', 1000))).toEqual({ kind: 'known', track });
  });

  test('counts a folder as shared when its accent is spelled the other way', () => {
    const wrong = driveSong('d1', 'Google Drive/Music/Various/Hits', '01 Halo.mp3');
    const right = driveSong('d2', 'Google Drive/Music/Beyonc\u00e9/Hits', '01 Halo.mp3');
    const matcher = createScanMatcher([wrong, right], noAudio);

    expect(matcher.match(file('Music/Beyonce\u0301/Hits/01 Halo.mp3'))).toEqual({
      kind: 'drive-copy',
      track: right,
    });
  });

  test('never links an empty file by name', () => {
    const track = driveSong('d1', 'Google Drive/Music/Joe Cocker/Live', '04 Up.mp3', 0);
    const matcher = createScanMatcher([track], noAudio);

    expect(matcher.match(file('Music/Joe Cocker/Live/04 Up.mp3', 0))).toEqual({ kind: 'new' });
  });
});

describe('linkDriveSongToLocalFile', () => {
  test('points the song at the local file and keeps its Drive identity', () => {
    const track = driveSong('d1', 'Google Drive/Music/Joe Cocker/Live', '04 Up.mp3');

    const linked = linkDriveSongToLocalFile(track, file('Music/Joe Cocker/Live/04 Up.mp3'));

    expect(linked.relativePath).toBe('Music/Joe Cocker/Live/04 Up.mp3');
    expect(linked.folderName).toBe('Music');
    expect(linked.fileKey).toBe('gdrive::d1');
    expect(linked.drivePath).toBe('Google Drive/Music/Joe Cocker/Live');
    expect(linked.id).toBe('d1');
  });
});
