/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { clearDeviceCacheMessage, summarizeDeviceCache } from '../src/utils/deviceCache';
import { makeTrack } from './factories';

describe('summarizeDeviceCache', () => {
  test('counts cached songs that have no copy in Google Drive', () => {
    const inDrive = makeTrack({ id: 'a', fileKey: 'a::1', driveFileId: 'drive-a' });
    const localOnly = makeTrack({ id: 'b', fileKey: 'b::1' });
    const notCached = makeTrack({ id: 'c', fileKey: 'c::1' });
    const summary = summarizeDeviceCache([inDrive, localOnly, notCached], new Set(['a::1', 'b::1']));
    expect(summary).toEqual({ cachedCount: 2, withoutDriveCopyCount: 1 });
  });
});

describe('clearDeviceCacheMessage', () => {
  test('warns about songs that Google Drive cannot give back', () => {
    const message = clearDeviceCacheMessage({ cachedCount: 5, withoutDriveCopyCount: 2, sizeLabel: '40 MB' });
    expect(message).toContain('5 cached audio files (40 MB)');
    expect(message).toContain('2 of them have no copy in Google Drive');
    expect(message).not.toContain('completely safe');
  });

  test('says Drive can give every song back when all of them are there', () => {
    const message = clearDeviceCacheMessage({ cachedCount: 1, withoutDriveCopyCount: 0, sizeLabel: '8 MB' });
    expect(message).toContain('1 cached audio file (8 MB)');
    expect(message).toContain('Every one has a copy in Google Drive');
  });
});
