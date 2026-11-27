/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import {
  ID3_MAX_READ_BYTES,
  ID3_TAIL_MARGIN_BYTES,
  TAG_HEAD_BYTES,
  extractLocalTrack,
  readTagsFromBlob,
  readTagsFromFileHead,
  type CoverArtCompressor,
} from '../src/utils/audioMetadata';
import {
  MPEG1_128,
  MPEG1_128_CHECKSUM,
  MPEG25_32,
  MPEG2_64_MONO,
  atom,
  concat,
  flacHead,
  ftypAtom,
  id3EmptyFrame,
  id3Picture,
  id3Text,
  id3v1Tag,
  id3v2Tag,
  latin1,
  moovAtom,
  mpegFrames,
  padTo,
  readerOf,
  riffChunk,
  vbriFrame,
  wavHead,
  wideAtom,
  xingFrame,
  zeros,
} from './audioFixtures';

const MB = 1024 * 1024;

const firefliesFrames = [
  id3Text('TIT2', 'Fireflies'),
  id3Text('TPE1', 'Owl City'),
  id3Text('TALB', 'Ocean Eyes'),
  id3Text('TYER', '2009'),
  id3Text('TRCK', '9/12'),
  id3Text('TCON', 'Electronic'),
];

/** Stands in for the canvas resize, which needs a browser, and shows which image it was given. */
const coverBySize: CoverArtCompressor = async (image) => `cover:${image.type}:${image.size}`;

describe('readTagsFromFileHead, MP3', () => {
  test('reads the tags and estimates a constant bitrate file from its size', async () => {
    const tag = id3v2Tag(firefliesFrames, 256);
    const audioBytes = MPEG1_128.length * 9600;
    const file = padTo(concat(tag, mpegFrames(MPEG1_128, 4)), tag.length + audioBytes);
    const { readRange, calls } = readerOf(file);

    const tags = await readTagsFromFileHead('09 Fireflies.mp3', file.length, readRange);

    expect(calls).toEqual([[0, TAG_HEAD_BYTES]]);
    expect(tags.title).toBe('Fireflies');
    expect(tags.artist).toBe('Owl City');
    expect(tags.album).toBe('Ocean Eyes');
    expect(tags.year).toBe('2009');
    expect(tags.trackNumber).toBe(9);
    expect(tags.genre).toBe('Electronic');
    expect(tags.coverArtUrl).toBeNull();
    expect(tags.duration).toBeCloseTo((audioBytes * 8) / MPEG1_128.bitrate, 2);
  });

  test('takes the frame count of a Xing header over the size estimate', async () => {
    const tag = id3v2Tag(firefliesFrames);
    const file = padTo(
      concat(tag, xingFrame(MPEG1_128, 9571), mpegFrames(MPEG1_128, 3)),
      3 * MB
    );
    const { readRange, calls } = readerOf(file);

    const tags = await readTagsFromFileHead('a.mp3', file.length, readRange);

    expect(calls).toHaveLength(1);
    expect(tags.duration).toBeCloseTo((9571 * 1152) / 44100, 2);
  });

  test('reads an Info header, which a constant bitrate encoder writes, the same way', async () => {
    const file = padTo(concat(xingFrame(MPEG1_128, 1000, 'Info'), mpegFrames(MPEG1_128, 3)), MB);

    const tags = await readTagsFromFileHead('a.mp3', file.length, readerOf(file).readRange);

    expect(tags.duration).toBeCloseTo((1000 * 1152) / 44100, 2);
  });

  test('finds the Xing header of an MPEG 2 mono frame, 576 samples to the frame', async () => {
    const file = padTo(concat(xingFrame(MPEG2_64_MONO, 2000), mpegFrames(MPEG2_64_MONO, 3)), MB);

    const tags = await readTagsFromFileHead('a.mp3', file.length, readerOf(file).readRange);

    expect(tags.duration).toBeCloseTo((2000 * 576) / 22050, 2);
  });

  test('finds a Xing header at the usual place in a frame whose header claims a checksum', async () => {
    const file = padTo(
      concat(xingFrame(MPEG1_128_CHECKSUM, 10752), mpegFrames(MPEG1_128_CHECKSUM, 3)),
      6 * MB
    );

    const tags = await readTagsFromFileHead('a.mp3', file.length, readerOf(file).readRange);

    expect(tags.duration).toBeCloseTo((10752 * 1152) / 44100, 2);
  });

  test('finds a Xing header that sits 2 bytes later, after the checksum', async () => {
    const shifted = { ...MPEG1_128_CHECKSUM, xingOffset: MPEG1_128_CHECKSUM.xingOffset + 2 };
    const file = padTo(concat(xingFrame(shifted, 10752), mpegFrames(shifted, 3)), 6 * MB);

    const tags = await readTagsFromFileHead('a.mp3', file.length, readerOf(file).readRange);

    expect(tags.duration).toBeCloseTo((10752 * 1152) / 44100, 2);
  });

  test('estimates an MPEG 2.5 file from its bitrate', async () => {
    const audioBytes = MPEG25_32.length * 3000;
    const file = padTo(mpegFrames(MPEG25_32, 4), audioBytes);

    const tags = await readTagsFromFileHead('a.mp3', file.length, readerOf(file).readRange);

    expect(tags.duration).toBeCloseTo((audioBytes * 8) / MPEG25_32.bitrate, 2);
  });

  test('takes the frame count of a VBRI header', async () => {
    const tag = id3v2Tag(firefliesFrames);
    const file = padTo(concat(tag, vbriFrame(MPEG1_128, 5000), mpegFrames(MPEG1_128, 3)), 2 * MB);

    const tags = await readTagsFromFileHead('a.mp3', file.length, readerOf(file).readRange);

    expect(tags.duration).toBeCloseTo((5000 * 1152) / 44100, 2);
  });

  test('reads once more, to the end of the tag plus a margin, when the tag is longer than the head', async () => {
    const cover = zeros(300_000).fill(7);
    const tag = id3v2Tag([...firefliesFrames, id3Picture(cover)]);
    expect(tag.length).toBeGreaterThan(TAG_HEAD_BYTES);
    const file = padTo(concat(tag, xingFrame(MPEG1_128, 9571), mpegFrames(MPEG1_128, 3)), 5 * MB);
    const { readRange, calls } = readerOf(file);

    const tags = await readTagsFromFileHead('a.mp3', file.length, readRange, {
      compressCover: coverBySize,
    });

    expect(calls).toEqual([
      [0, TAG_HEAD_BYTES],
      [TAG_HEAD_BYTES, tag.length + ID3_TAIL_MARGIN_BYTES],
    ]);
    expect(tags.title).toBe('Fireflies');
    expect(tags.coverArtUrl).toBe('cover:image/jpeg:300000');
    expect(tags.duration).toBeCloseTo((9571 * 1152) / 44100, 2);
  });

  test('stops the tag read at 2 MB and fetches the first audio frame on its own', async () => {
    const tag = id3v2Tag([...firefliesFrames, id3Picture(zeros(3 * MB))]);
    const file = padTo(concat(tag, xingFrame(MPEG1_128, 9571), mpegFrames(MPEG1_128, 3)), 8 * MB);
    const { readRange, calls } = readerOf(file);

    const tags = await readTagsFromFileHead('a.mp3', file.length, readRange, {
      compressCover: coverBySize,
    });

    expect(calls).toEqual([
      [0, TAG_HEAD_BYTES],
      [TAG_HEAD_BYTES, ID3_MAX_READ_BYTES],
      [tag.length, tag.length + ID3_TAIL_MARGIN_BYTES],
    ]);
    expect(tags.title).toBe('Fireflies');
    expect(tags.duration).toBeCloseTo((9571 * 1152) / 44100, 2);
  });

  test('fetches the first audio frame when the tag ends at the edge of the head', async () => {
    // The frame starts 20 bytes before the head ends, so its Xing header is not in hand.
    const framesLength = concat(...firefliesFrames).length;
    const tag = id3v2Tag(firefliesFrames, TAG_HEAD_BYTES - 20 - 10 - framesLength);
    expect(tag.length).toBe(TAG_HEAD_BYTES - 20);
    const file = padTo(concat(tag, xingFrame(MPEG1_128, 9571), mpegFrames(MPEG1_128, 3)), 4 * MB);
    const { readRange, calls } = readerOf(file);

    const tags = await readTagsFromFileHead('a.mp3', file.length, readRange);

    expect(calls).toEqual([
      [0, TAG_HEAD_BYTES],
      [tag.length, tag.length + ID3_TAIL_MARGIN_BYTES],
    ]);
    expect(tags.duration).toBeCloseTo((9571 * 1152) / 44100, 2);
  });

  test('falls back to the ID3v1 tag at the end of a file with no ID3v2 tag', async () => {
    const v1 = id3v1Tag({ title: 'Up Where We Belong', artist: 'Joe Cocker', album: 'Live', year: '1990', track: 4 });
    const audioBytes = MPEG1_128.length * 4000;
    const file = concat(padTo(mpegFrames(MPEG1_128, 4), audioBytes), v1);
    const { readRange, calls } = readerOf(file);

    const tags = await readTagsFromFileHead('04 Up Where We Belong.mp3', file.length, readRange);

    expect(calls).toEqual([
      [0, TAG_HEAD_BYTES],
      [file.length - 128, file.length],
    ]);
    expect(tags.title).toBe('Up Where We Belong');
    expect(tags.artist).toBe('Joe Cocker');
    expect(tags.trackNumber).toBe(4);
    expect(tags.duration).toBeCloseTo((audioBytes * 8) / MPEG1_128.bitrate, 2);
  });

  test('reads a file shorter than the head in one request and no further', async () => {
    const tag = id3v2Tag(firefliesFrames);
    const file = concat(tag, mpegFrames(MPEG1_128, 20));
    const { readRange, calls } = readerOf(file);

    const tags = await readTagsFromFileHead('a.mp3', file.length, readRange);

    expect(calls).toEqual([[0, file.length]]);
    expect(tags.duration).toBeCloseTo((MPEG1_128.length * 20 * 8) / MPEG1_128.bitrate, 2);
  });

  test('reports no tags and no duration for bytes that are not audio', async () => {
    const file = zeros(200_000).fill(0x41);
    const tags = await readTagsFromFileHead('a.mp3', file.length, readerOf(file).readRange);

    expect(tags).toEqual({
      title: null,
      artist: null,
      album: null,
      genre: null,
      year: null,
      trackNumber: null,
      coverArtUrl: null,
      duration: 0,
    });
  });

  test('reads the frames that follow an empty frame', async () => {
    const tag = id3v2Tag(
      [id3Text('TRCK', '2'), id3EmptyFrame('WCOM'), ...firefliesFrames.slice(0, 3), id3EmptyFrame('WOAR')],
      512
    );
    const file = concat(tag, mpegFrames(MPEG1_128, 20));

    const tags = await readTagsFromFileHead('a.mp3', file.length, readerOf(file).readRange);

    expect(tags.trackNumber).toBe(2);
    expect(tags.title).toBe('Fireflies');
    expect(tags.artist).toBe('Owl City');
    expect(tags.album).toBe('Ocean Eyes');
  });

  test('leaves cover art out, without failing, where there is no browser to resize it', async () => {
    const tag = id3v2Tag([...firefliesFrames, id3Picture(zeros(2000))]);
    const file = concat(tag, mpegFrames(MPEG1_128, 20));

    const tags = await readTagsFromFileHead('a.mp3', file.length, readerOf(file).readRange);

    expect(tags.title).toBe('Fireflies');
    expect(tags.coverArtUrl).toBeNull();
  });
});

describe('readTagsFromFileHead, MP4', () => {
  const tags = { title: 'Clocks', artist: 'Coldplay', album: 'A Rush of Blood', year: '2002-08-26', track: 5 };

  test('reads tags and duration from a moov atom inside the head', async () => {
    const file = concat(ftypAtom(), moovAtom(tags, 44100, 44100 * 307), atom('mdat', zeros(MB)));
    const { readRange, calls } = readerOf(file);

    const read = await readTagsFromFileHead('05 Clocks.m4a', file.length, readRange);

    expect(calls).toEqual([[0, TAG_HEAD_BYTES]]);
    expect(read.title).toBe('Clocks');
    expect(read.artist).toBe('Coldplay');
    expect(read.album).toBe('A Rush of Blood');
    expect(read.year).toBe('2002');
    expect(read.trackNumber).toBe(5);
    expect(read.duration).toBe(307);
  });

  test('walks past an mdat atom to a moov atom at the end of the file', async () => {
    const ftyp = ftypAtom();
    const mdat = atom('mdat', zeros(2 * MB));
    const moov = moovAtom({ ...tags, cover: zeros(5000) }, 1000, 215_500);
    const file = concat(ftyp, mdat, moov);
    const moovStart = ftyp.length + mdat.length;
    const { readRange, calls } = readerOf(file);

    const read = await readTagsFromFileHead('05 Clocks.m4a', file.length, readRange, {
      compressCover: coverBySize,
    });

    expect(calls).toEqual([
      [0, TAG_HEAD_BYTES],
      [moovStart, moovStart + 16],
      [moovStart, file.length],
    ]);
    expect(read.title).toBe('Clocks');
    expect(read.artist).toBe('Coldplay');
    expect(read.trackNumber).toBe(5);
    expect(read.coverArtUrl).toBe('cover:image/jpeg:5000');
    expect(read.duration).toBe(215.5);
  });

  test('walks past an mdat atom with a 64-bit length', async () => {
    const ftyp = ftypAtom();
    const mdat = wideAtom('mdat', MB);
    const file = concat(ftyp, atom('free', zeros(8)), mdat, moovAtom(tags, 600, 600 * 90));
    const { readRange, calls } = readerOf(file);

    const read = await readTagsFromFileHead('a.m4b', file.length, readRange);

    expect(calls).toHaveLength(3);
    expect(read.title).toBe('Clocks');
    expect(read.duration).toBe(90);
  });

  test('reads only the missing part of a moov atom that starts inside the head', async () => {
    const ftyp = ftypAtom();
    const filler = atom('free', zeros(TAG_HEAD_BYTES - ftyp.length - 8 - 1000));
    const moov = moovAtom({ ...tags, cover: zeros(40_000) }, 1000, 60_000);
    const file = concat(ftyp, filler, moov, atom('mdat', zeros(1000)));
    const moovEnd = ftyp.length + filler.length + moov.length;
    const { readRange, calls } = readerOf(file);

    const read = await readTagsFromFileHead('a.mp4', file.length, readRange, { compressCover: coverBySize });

    expect(calls).toEqual([
      [0, TAG_HEAD_BYTES],
      [TAG_HEAD_BYTES, moovEnd],
    ]);
    expect(read.title).toBe('Clocks');
    expect(read.coverArtUrl).toBe('cover:image/jpeg:40000');
    expect(read.duration).toBe(60);
  });

  test('gives up, with no tags, on a file whose atoms lead nowhere', async () => {
    const file = concat(ftypAtom(), atom('mdat', zeros(MB)));
    const read = await readTagsFromFileHead('a.m4a', file.length, readerOf(file).readRange);

    expect(read.title).toBeNull();
    expect(read.duration).toBe(0);
  });
});

describe('readTagsFromFileHead, other formats', () => {
  test('reads WAV duration from the fmt and data chunks', async () => {
    const dataBytes = 44100 * 2 * 2 * 10;
    const file = padTo(wavHead({ sampleRate: 44100, channels: 2, bitsPerSample: 16 }, dataBytes), 44 + dataBytes);
    const { readRange, calls } = readerOf(file);

    const tags = await readTagsFromFileHead('take.wav', file.length, readRange);

    expect(calls).toEqual([[0, TAG_HEAD_BYTES]]);
    expect(tags.duration).toBe(10);
    expect(tags.title).toBeNull();
  });

  test('finds a WAV data chunk that sits past the head', async () => {
    const dataBytes = 48000 * 3 * 4;
    const head = wavHead({ sampleRate: 48000, channels: 1, bitsPerSample: 24 }, dataBytes, [
      riffChunk('LIST', zeros(200_001)),
    ]);
    const file = padTo(head, head.length + dataBytes);
    const { readRange, calls } = readerOf(file);

    const tags = await readTagsFromFileHead('take.wav', file.length, readRange);

    expect(calls).toEqual([
      [0, TAG_HEAD_BYTES],
      [head.length - 8, head.length],
    ]);
    expect(tags.duration).toBe(4);
  });

  test('reads FLAC tags and takes the duration from STREAMINFO', async () => {
    const head = flacHead(96000, 96000 * 200, ['TITLE=Aja', 'ARTIST=Steely Dan', 'ALBUM=Aja', 'DATE=1977', 'TRACKNUMBER=3']);
    const file = padTo(head, MB);

    const tags = await readTagsFromFileHead('03 Aja.flac', file.length, readerOf(file).readRange);

    expect(tags.title).toBe('Aja');
    expect(tags.artist).toBe('Steely Dan');
    expect(tags.year).toBe('1977');
    expect(tags.trackNumber).toBe(3);
    expect(tags.duration).toBe(200);
  });

  test('reads an ID3v2 tag from any other format and leaves the duration at 0', async () => {
    const file = padTo(concat(id3v2Tag(firefliesFrames), latin1('OggS')), MB);
    const { readRange, calls } = readerOf(file);

    const tags = await readTagsFromFileHead('a.ogg', file.length, readRange);

    expect(calls).toHaveLength(1);
    expect(tags.title).toBe('Fireflies');
    expect(tags.duration).toBe(0);
  });

  test('reads the first 128 KB when Drive gave no size for the file', async () => {
    const file = concat(id3v2Tag(firefliesFrames), xingFrame(MPEG1_128, 9571), mpegFrames(MPEG1_128, 3));
    const { readRange, calls } = readerOf(file);

    const tags = await readTagsFromFileHead('a.mp3', 0, readRange);

    expect(calls).toEqual([[0, TAG_HEAD_BYTES]]);
    expect(tags.title).toBe('Fireflies');
    expect(tags.duration).toBeCloseTo((9571 * 1152) / 44100, 2);
  });
});

describe('readTagsFromBlob', () => {
  test('reads a whole file held in memory with the same parser', async () => {
    const audioBytes = MPEG1_128.length * 9600;
    const tag = id3v2Tag(firefliesFrames);
    const blob = new Blob([padTo(concat(tag, mpegFrames(MPEG1_128, 4)), tag.length + audioBytes)]);

    const tags = await readTagsFromBlob(blob, '09 Fireflies.mp3');

    expect(tags.title).toBe('Fireflies');
    expect(tags.duration).toBeCloseTo((audioBytes * 8) / MPEG1_128.bitrate, 2);
  });
});

describe('extractLocalTrack', () => {
  test('still reads a local file: tags from the file, the rest from its path', async () => {
    const bytes = concat(id3v2Tag([id3Text('TIT2', 'Fireflies'), id3Text('TRCK', '9')]), mpegFrames(MPEG1_128, 20));
    const file = new File([bytes], '09 Fireflies.mp3', { type: 'audio/mpeg' });

    const track = await extractLocalTrack(file, 'Music/Owl City/Ocean Eyes/09 Fireflies.mp3');

    expect(track.title).toBe('Fireflies');
    expect(track.artist).toBe('Owl City');
    expect(track.album).toBe('Ocean Eyes');
    expect(track.trackNumber).toBe(9);
    expect(track.format).toBe('MP3');
    expect(track.fileSize).toBe(bytes.length);
    expect(track.fileKey).toBe(`music/owl city/ocean eyes/09 fireflies.mp3::${bytes.length}`);
    expect(track.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
