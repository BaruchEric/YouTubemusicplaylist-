/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { computePlaylistDiff, isInFolderScope } from '../src/utils/syncEngine';
import { countDeviceFiles, isListOnlyTrack } from '../src/utils/trackSource';
import { makePlaylist, makeTrack } from './factories';

const file = makeTrack({ id: 'file' });
const gone = makeTrack({ id: 'gone', isMissingOnDevice: true });
const listed = makeTrack({ id: 'listed', format: 'LIST', fileSize: 0, folderName: 'Imported' });
const video = makeTrack({ id: 'video', format: 'YT', fileSize: 0, folderName: 'Imported' });

describe('isListOnlyTrack', () => {
  test('is true for an imported line with no audio file behind it', () => {
    expect(isListOnlyTrack(listed)).toBe(true);
    expect(isListOnlyTrack(video)).toBe(true);
    expect(isListOnlyTrack(file)).toBe(false);
  });
});

describe('countDeviceFiles', () => {
  test('counts files on the device, not imported lines or missing files', () => {
    expect(countDeviceFiles([file, gone, listed, video])).toBe(1);
  });
});

describe('computePlaylistDiff', () => {
  test('does not queue imported lines for a playlist that follows every folder', () => {
    const playlist = makePlaylist({
      id: 'p',
      syncRule: { autoAddNewFiles: true, removeMissingFiles: false, folderFilter: '' },
    });
    const trackMap = new Map([file, listed, video].map((t) => [t.id, t]));
    const diff = computePlaylistDiff(playlist, trackMap);
    expect(diff.toAdd.map((t) => t.id)).toEqual(['file']);
  });

  test('still queues an imported line the user put in the playlist', () => {
    const playlist = makePlaylist({ id: 'p', trackIds: ['video'] });
    const diff = computePlaylistDiff(playlist, new Map([[video.id, video]]));
    expect(diff.toAdd.map((t) => t.id)).toEqual(['video']);
  });
});

describe('isInFolderScope', () => {
  const nested = makeTrack({ id: 'nested', relativePath: 'Music/Live/nested.mp3', folderName: 'Live' });

  test('takes every device file when the rule names no folder', () => {
    expect(isInFolderScope(file, '')).toBe(true);
    expect(isInFolderScope(nested, '  ')).toBe(true);
  });

  test('matches the folder name or the start of the path, in any case', () => {
    expect(isInFolderScope(nested, 'live')).toBe(true);
    expect(isInFolderScope(nested, 'MUSIC/')).toBe(true);
    expect(isInFolderScope(file, 'Live')).toBe(false);
  });

  test('leaves out imported lines and missing files', () => {
    expect(isInFolderScope(listed, '')).toBe(false);
    expect(isInFolderScope(video, 'Imported')).toBe(false);
    expect(isInFolderScope(gone, '')).toBe(false);
  });
});
