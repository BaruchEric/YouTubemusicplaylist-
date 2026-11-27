/**
 * Audio files built byte by byte, so the tag and duration parsers can be tested with no binary
 * file in the repo. Each builder writes only what a parser reads and leaves the rest zero.
 */

export type Bytes = Uint8Array<ArrayBuffer>;

export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function latin1(text: string): Bytes {
  return Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);
}

export function zeros(length: number): Bytes {
  return new Uint8Array(length);
}

export function u16le(value: number): Bytes {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

export function u32le(value: number): Bytes {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

export function u32be(value: number): Bytes {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

export function u64be(value: number): Bytes {
  return concat(u32be(Math.floor(value / 2 ** 32)), u32be(value % 2 ** 32));
}

function synchsafe(value: number): Bytes {
  return Uint8Array.of((value >>> 21) & 0x7f, (value >>> 14) & 0x7f, (value >>> 7) & 0x7f, value & 0x7f);
}

// ---------- ID3 ----------

function id3Frame(id: string, data: Uint8Array): Bytes {
  return concat(latin1(id), u32be(data.length), zeros(2), data);
}

/** An ID3v2.3 text frame such as TIT2, in ISO-8859-1. */
export function id3Text(id: string, text: string): Bytes {
  return id3Frame(id, concat(Uint8Array.of(0), latin1(text)));
}

/** A frame with a name and no content. The standard forbids it and MusicMatch wrote it anyway. */
export function id3EmptyFrame(id: string): Bytes {
  return id3Frame(id, zeros(0));
}

/** An ID3v2.3 APIC frame holding a front cover. */
export function id3Picture(image: Uint8Array, mime = 'image/jpeg'): Bytes {
  return id3Frame('APIC', concat(Uint8Array.of(0), latin1(mime), Uint8Array.of(0, 3, 0), image));
}

/** An ID3v2.3 tag. The length its header declares covers the frames and the padding. */
export function id3v2Tag(frames: Uint8Array[], padding = 0): Bytes {
  const body = concat(...frames, zeros(padding));
  return concat(latin1('ID3'), Uint8Array.of(3, 0, 0), synchsafe(body.length), body);
}

/** The 128-byte ID3v1.1 tag some files end with. */
export function id3v1Tag(fields: { title: string; artist: string; album: string; year: string; track: number }): Bytes {
  const tag = zeros(128);
  tag.set(latin1('TAG'), 0);
  tag.set(latin1(fields.title).subarray(0, 30), 3);
  tag.set(latin1(fields.artist).subarray(0, 30), 33);
  tag.set(latin1(fields.album).subarray(0, 30), 63);
  tag.set(latin1(fields.year).subarray(0, 4), 93);
  tag[126] = fields.track;
  tag[127] = 17; // Rock
  return tag;
}

// ---------- MPEG audio ----------

export interface MpegFrameSpec {
  /** The four header bytes. */
  header: readonly [number, number, number, number];
  /** Bytes in one frame, header included. */
  length: number;
  /** Where a Xing or Info header starts inside the frame: 4 plus the side information. */
  xingOffset: number;
  samplesPerFrame: number;
  sampleRate: number;
  bitrate: number;
}

/** MPEG 1 layer 3, 128 kbit/s, 44.1 kHz, stereo. */
export const MPEG1_128: MpegFrameSpec = {
  header: [0xff, 0xfb, 0x90, 0x00],
  length: 417,
  xingOffset: 36,
  samplesPerFrame: 1152,
  sampleRate: 44100,
  bitrate: 128_000,
};

/**
 * The same frame with the header bit that says a 2-byte checksum follows the header. Some
 * encoders set the bit and still write the Xing header where an unchecked frame has it.
 */
export const MPEG1_128_CHECKSUM: MpegFrameSpec = {
  ...MPEG1_128,
  header: [0xff, 0xfa, 0x90, 0x64],
};

/** MPEG 2 layer 3, 64 kbit/s, 22.05 kHz, mono. */
export const MPEG2_64_MONO: MpegFrameSpec = {
  header: [0xff, 0xf3, 0x80, 0xc0],
  length: 208,
  xingOffset: 13,
  samplesPerFrame: 576,
  sampleRate: 22050,
  bitrate: 64_000,
};

/** MPEG 2.5 layer 3, 32 kbit/s, 11.025 kHz, stereo. */
export const MPEG25_32: MpegFrameSpec = {
  header: [0xff, 0xe3, 0x40, 0x00],
  length: 208,
  xingOffset: 21,
  samplesPerFrame: 576,
  sampleRate: 11025,
  bitrate: 32_000,
};

export function mpegFrame(spec: MpegFrameSpec): Bytes {
  const frame = zeros(spec.length);
  frame.set(spec.header, 0);
  return frame;
}

export function mpegFrames(spec: MpegFrameSpec, count: number): Bytes {
  return concat(...Array.from({ length: count }, () => mpegFrame(spec)));
}

/** A first frame that carries a Xing (variable bitrate) or Info (constant bitrate) header. */
export function xingFrame(spec: MpegFrameSpec, frameCount: number, label: 'Xing' | 'Info' = 'Xing'): Bytes {
  const frame = mpegFrame(spec);
  // Flags 0x3: a frame count, then a byte count.
  frame.set(concat(latin1(label), u32be(0x3), u32be(frameCount), u32be(frameCount * spec.length)), spec.xingOffset);
  return frame;
}

/** A first frame that carries the Fraunhofer VBRI header, always 32 bytes after the frame header. */
export function vbriFrame(spec: MpegFrameSpec, frameCount: number): Bytes {
  const frame = mpegFrame(spec);
  frame.set(concat(latin1('VBRI'), zeros(6), u32be(frameCount * spec.length), u32be(frameCount)), 36);
  return frame;
}

// ---------- MP4 ----------

export function atom(type: string, ...payload: Uint8Array[]): Bytes {
  const body = concat(...payload);
  return concat(u32be(8 + body.length), latin1(type), body);
}

/** An atom whose header gives its length as 64 bits, as large mdat atoms do. */
export function wideAtom(type: string, payloadLength: number): Bytes {
  return concat(u32be(1), latin1(type), u64be(16 + payloadLength), zeros(payloadLength));
}

function ilstText(type: string, text: string): Bytes {
  return atom(type, atom('data', u32be(1), u32be(0), new TextEncoder().encode(text)));
}

export interface Mp4Tags {
  title: string;
  artist: string;
  album: string;
  year: string;
  track: number;
  cover?: Uint8Array;
}

/** A moov atom with an mvhd (version 0) and iTunes-style tags under udta, meta, ilst. */
export function moovAtom(tags: Mp4Tags, timescale: number, duration: number): Bytes {
  const mvhd = atom('mvhd', u32be(0), u32be(0), u32be(0), u32be(timescale), u32be(duration), zeros(80));
  const items = [
    ilstText('©nam', tags.title),
    ilstText('©ART', tags.artist),
    ilstText('©alb', tags.album),
    ilstText('©day', tags.year),
    atom('trkn', atom('data', u32be(0), u32be(0), Uint8Array.of(0, 0, 0, tags.track, 0, 12, 0, 0))),
  ];
  if (tags.cover) items.push(atom('covr', atom('data', u32be(13), u32be(0), tags.cover)));
  const meta = atom('meta', u32be(0), atom('hdlr', zeros(25)), atom('ilst', ...items));
  return atom('moov', mvhd, atom('trak', zeros(64)), atom('udta', meta));
}

export function ftypAtom(): Bytes {
  return atom('ftyp', latin1('M4A '), u32be(0), latin1('M4A mp42isom'));
}

// ---------- FLAC ----------

function flacBlock(type: number, data: Uint8Array, isLast: boolean): Bytes {
  return concat(
    Uint8Array.of((isLast ? 0x80 : 0) | type, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff),
    data
  );
}

/** A FLAC head: the marker, STREAMINFO and one Vorbis comment block. */
export function flacHead(sampleRate: number, totalSamples: number, comments: string[]): Bytes {
  const info = zeros(34);
  // 20 bits of sample rate, 3 of channels, 5 of bit depth, then 36 of total samples.
  info[10] = (sampleRate >>> 12) & 0xff;
  info[11] = (sampleRate >>> 4) & 0xff;
  info[12] = ((sampleRate & 0x0f) << 4) | (1 << 1);
  info[13] = (15 << 4) | (Math.floor(totalSamples / 2 ** 32) & 0x0f);
  info.set(u32be(totalSamples % 2 ** 32), 14);

  const vendor = latin1('fixture');
  const entries = comments.map((comment) => {
    const encoded = new TextEncoder().encode(comment);
    return concat(u32le(encoded.length), encoded);
  });
  const vorbis = concat(u32le(vendor.length), vendor, u32le(comments.length), ...entries);
  return concat(latin1('fLaC'), flacBlock(0, info, false), flacBlock(4, vorbis, true));
}

// ---------- WAV ----------

/** A RIFF/WAVE header for PCM audio, with optional chunks between "fmt " and "data". */
export function wavHead(
  format: { sampleRate: number; channels: number; bitsPerSample: number },
  dataBytes: number,
  extraChunks: Uint8Array[] = []
): Bytes {
  const blockAlign = (format.channels * format.bitsPerSample) / 8;
  const fmt = concat(
    latin1('fmt '),
    u32le(16),
    u16le(1),
    u16le(format.channels),
    u32le(format.sampleRate),
    u32le(format.sampleRate * blockAlign),
    u16le(blockAlign),
    u16le(format.bitsPerSample)
  );
  const body = concat(latin1('WAVE'), fmt, ...extraChunks, latin1('data'), u32le(dataBytes));
  return concat(latin1('RIFF'), u32le(body.length + dataBytes), body);
}

export function riffChunk(id: string, data: Uint8Array): Bytes {
  return concat(latin1(id), u32le(data.length), data, zeros(data.length % 2));
}

// ---------- reading ----------

export interface RecordedReader {
  readRange: (start: number, end: number) => Promise<ArrayBuffer>;
  /** Every range asked for, in order, as [start, end]. */
  calls: Array<[number, number]>;
}

/** Serves ranges of a file held in memory and records each range asked for. */
export function readerOf(file: Uint8Array): RecordedReader {
  const calls: Array<[number, number]> = [];
  return {
    calls,
    readRange: async (start, end) => {
      calls.push([start, end]);
      return file.slice(start, Math.min(end, file.length)).buffer;
    },
  };
}

/** Pads a file with zero bytes up to a total size. */
export function padTo(file: Uint8Array, size: number): Bytes {
  return concat(file, zeros(Math.max(0, size - file.length)));
}
