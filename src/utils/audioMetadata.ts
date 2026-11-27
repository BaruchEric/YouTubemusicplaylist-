import type { LocalTrack } from '../types/music';
import { cleanRawGenreTag, lookupId3v1Genre } from './genreInference';

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'm4b',
  'm4p',
  'mp4',
  'flac',
  'wav',
  'ogg',
  'oga',
  'opus',
  'aac',
  'wma',
  'aiff',
  'aif',
  'aifc',
  'alac',
  'caf',
  '3gp',
  'amr',
  'webm',
]);

export function isAudioFile(file: File): boolean {
  if (file.type && file.type.startsWith('audio/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTENSIONS.has(ext);
}

interface ParsedTags {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: string;
  trackNumber?: number | null;
  coverArtUrl?: string | null;
}

function decodeText(bytes: Uint8Array, encodingByte: number): string {
  try {
    if (encodingByte === 1 || encodingByte === 2) {
      // UTF-16 with BOM or UTF-16BE
      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(bytes.subarray(2)).replace(/\0+$/, '').trim();
      }
      if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(bytes.subarray(2)).replace(/\0+$/, '').trim();
      }
      return new TextDecoder(encodingByte === 2 ? 'utf-16be' : 'utf-16le')
        .decode(bytes)
        .replace(/\0+$/, '')
        .trim();
    }
    if (encodingByte === 3) {
      return new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '').trim();
    }
    // ISO-8859-1
    return new TextDecoder('iso-8859-1').decode(bytes).replace(/\0+$/, '').trim();
  } catch {
    return '';
  }
}

function readSynchsafeInt(view: DataView, offset: number): number {
  return (
    ((view.getUint8(offset) & 0x7f) << 21) |
    ((view.getUint8(offset + 1) & 0x7f) << 14) |
    ((view.getUint8(offset + 2) & 0x7f) << 7) |
    (view.getUint8(offset + 3) & 0x7f)
  );
}

/** Turns the cover art embedded in a file into the small image a song stores, or null. */
export type CoverArtCompressor = (image: Blob) => Promise<string | null>;

/**
 * Resize embedded album cover art into a compact 160x160 JPEG Data URL
 * so IndexedDB storage remains light even with hundreds of tracks.
 */
async function compressCoverArt(blob: Blob): Promise<string | null> {
  // The resize draws on a canvas. Where there is no page, as in a test, the song gets no cover.
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const size = 160;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          resolve(null);
          return;
        }
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        URL.revokeObjectURL(objectUrl);
        resolve(dataUrl);
      } catch {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
}

async function parseID3v2(
  buffer: ArrayBuffer,
  compressCover: CoverArtCompressor = compressCoverArt
): Promise<ParsedTags> {
  const result: ParsedTags = {};
  if (buffer.byteLength < 10) return result;

  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // "ID3" magic header
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return result;
  }

  const version = bytes[3]; // 2, 3, or 4
  const flags = bytes[5];
  const tagSize = readSynchsafeInt(view, 6);
  const endOffset = Math.min(buffer.byteLength, 10 + tagSize);

  let offset = 10;
  // Skip extended header if present
  if ((flags & 0x40) !== 0 && offset + 4 <= endOffset) {
    const extSize =
      version === 4 ? readSynchsafeInt(view, offset) : view.getUint32(offset, false);
    offset += version === 4 ? extSize : 4 + extSize;
  }

  const headerLen = version === 2 ? 6 : 10;

  while (offset + headerLen <= endOffset) {
    let frameId = '';
    let frameSize = 0;

    if (version === 2) {
      frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2]);
      frameSize =
        (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
    } else {
      frameId = String.fromCharCode(
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3]
      );
      frameSize =
        version === 4
          ? readSynchsafeInt(view, offset + 4)
          : view.getUint32(offset + 4, false);
    }

    if (!frameId.trim() || frameId.charCodeAt(0) === 0) {
      break;
    }
    if (frameSize <= 0) {
      // MusicMatch wrote frames with a name and nothing in them, often ahead of the title and
      // the artist. The loop steps over a frame named like one. Anything else is padding.
      if (!/^[A-Z0-9]+$/.test(frameId)) break;
      offset += headerLen;
      continue;
    }

    const frameStart = offset + headerLen;
    const frameEnd = Math.min(endOffset, frameStart + frameSize);

    if (frameEnd <= frameStart) break;

    const frameData = bytes.subarray(frameStart, frameEnd);

    if (frameId === 'TIT2' || frameId === 'TT2') {
      result.title = decodeText(frameData.subarray(1), frameData[0]);
    } else if (frameId === 'TPE1' || frameId === 'TP1') {
      result.artist = decodeText(frameData.subarray(1), frameData[0]);
    } else if (frameId === 'TALB' || frameId === 'TAL') {
      result.album = decodeText(frameData.subarray(1), frameData[0]);
    } else if (frameId === 'TCON' || frameId === 'TCO') {
      const rawGenre = decodeText(frameData.subarray(1), frameData[0]);
      const cleaned = cleanRawGenreTag(rawGenre);
      if (cleaned) result.genre = cleaned;
    } else if (frameId === 'TYER' || frameId === 'TDRC' || frameId === 'TYE') {
      const rawYear = decodeText(frameData.subarray(1), frameData[0]);
      const match = rawYear.match(/\d{4}/);
      if (match) result.year = match[0];
    } else if (frameId === 'TRCK' || frameId === 'TRK') {
      const rawTrack = decodeText(frameData.subarray(1), frameData[0]);
      const num = parseInt(rawTrack.split('/')[0], 10);
      if (Number.isFinite(num) && num > 0) result.trackNumber = num;
    } else if ((frameId === 'APIC' || frameId === 'PIC') && !result.coverArtUrl) {
      try {
        const encoding = frameData[0];
        let ptr = 1;
        let mime = 'image/jpeg';

        if (frameId === 'APIC') {
          const mimeStart = ptr;
          while (ptr < frameData.length && frameData[ptr] !== 0) ptr++;
          mime =
            new TextDecoder('iso-8859-1').decode(frameData.subarray(mimeStart, ptr)) ||
            'image/jpeg';
          ptr++; // skip null terminator
        } else {
          const fmt = String.fromCharCode(
            frameData[ptr],
            frameData[ptr + 1],
            frameData[ptr + 2]
          ).toLowerCase();
          mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
          ptr += 3;
        }

        ptr++; // picture type byte

        // Skip description string
        if (encoding === 1 || encoding === 2) {
          while (ptr + 1 < frameData.length && !(frameData[ptr] === 0 && frameData[ptr + 1] === 0)) {
            ptr += 2;
          }
          ptr += 2;
        } else {
          while (ptr < frameData.length && frameData[ptr] !== 0) ptr++;
          ptr++;
        }

        if (ptr < frameData.length) {
          const imgBytes = frameData.slice(ptr);
          const blob = new Blob([imgBytes], { type: mime });
          result.coverArtUrl = await compressCover(blob);
        }
      } catch {
        // Ignore malformed embedded cover art
      }
    }

    offset = frameEnd;
  }

  return result;
}

async function parseID3v1(file: File): Promise<ParsedTags> {
  if (file.size < 128) return {};
  return parseID3v1Bytes(new Uint8Array(await file.slice(file.size - 128).arrayBuffer()));
}

/** Reads the 128-byte ID3v1 tag that ends some files. Takes exactly those last 128 bytes. */
function parseID3v1Bytes(bytes: Uint8Array): ParsedTags {
  if (bytes.length < 128) return {};
  if (bytes[0] !== 0x54 || bytes[1] !== 0x41 || bytes[2] !== 0x47) return {}; // "TAG"

  const dec = new TextDecoder('iso-8859-1');
  const clean = (start: number, end: number) =>
    dec.decode(bytes.subarray(start, end)).replace(/\0+$/, '').trim();

  const title = clean(3, 33);
  const artist = clean(33, 63);
  const album = clean(63, 93);
  const year = clean(93, 97);
  const trackNumber = bytes[125] === 0 && bytes[126] > 0 ? bytes[126] : null;
  const genre = lookupId3v1Genre(bytes[127]);

  return {
    title: title || undefined,
    artist: artist || undefined,
    album: album || undefined,
    genre: genre || undefined,
    year: /^\d{4}$/.test(year) ? year : undefined,
    trackNumber,
  };
}

async function parseFLAC(
  buffer: ArrayBuffer,
  compressCover: CoverArtCompressor = compressCoverArt
): Promise<ParsedTags> {
  const result: ParsedTags = {};
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // "fLaC"
  if (
    bytes.length < 8 ||
    bytes[0] !== 0x66 ||
    bytes[1] !== 0x4c ||
    bytes[2] !== 0x61 ||
    bytes[3] !== 0x43
  ) {
    return result;
  }

  let offset = 4;
  while (offset + 4 <= bytes.length) {
    const header = bytes[offset];
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const length =
      (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const blockStart = offset + 4;
    const blockEnd = Math.min(bytes.length, blockStart + length);

    if (blockType === 4 && blockEnd <= bytes.length) {
      // VORBIS_COMMENT
      try {
        let p = blockStart;
        const vendorLen = view.getUint32(p, true);
        p += 4 + vendorLen;
        const commentCount = view.getUint32(p, true);
        p += 4;
        const utf8 = new TextDecoder('utf-8');
        for (let i = 0; i < commentCount && p + 4 <= blockEnd; i++) {
          const len = view.getUint32(p, true);
          p += 4;
          const entry = utf8.decode(bytes.subarray(p, Math.min(blockEnd, p + len)));
          p += len;
          const eq = entry.indexOf('=');
          if (eq === -1) continue;
          const key = entry.slice(0, eq).toUpperCase();
          const val = entry.slice(eq + 1).trim();
          if (key === 'TITLE') result.title = val;
          else if (key === 'ARTIST') result.artist = val;
          else if (key === 'ALBUM') result.album = val;
          else if (key === 'GENRE') {
            const cleaned = cleanRawGenreTag(val);
            if (cleaned) result.genre = cleaned;
          } else if (key === 'DATE' || key === 'YEAR') {
            const m = val.match(/\d{4}/);
            if (m) result.year = m[0];
          } else if (key === 'TRACKNUMBER') {
            const n = parseInt(val.split('/')[0], 10);
            if (Number.isFinite(n) && n > 0) result.trackNumber = n;
          }
        }
      } catch {
        // Skip malformed comment block
      }
    } else if (blockType === 6 && !result.coverArtUrl && blockEnd <= bytes.length) {
      // PICTURE block
      try {
        let p = blockStart + 4; // skip picture type
        const mimeLen = view.getUint32(p, false);
        p += 4;
        const mime =
          new TextDecoder('iso-8859-1').decode(bytes.subarray(p, p + mimeLen)) || 'image/jpeg';
        p += mimeLen;
        const descLen = view.getUint32(p, false);
        p += 4 + descLen + 16; // skip width, height, depth, colors
        const dataLen = view.getUint32(p, false);
        p += 4;
        if (p + dataLen <= blockEnd) {
          const blob = new Blob([bytes.slice(p, p + dataLen)], { type: mime });
          result.coverArtUrl = await compressCover(blob);
        }
      } catch {
        // Skip malformed picture block
      }
    }

    offset = blockEnd;
    if (isLast) break;
  }

  return result;
}

async function parseMP4(
  buffer: ArrayBuffer,
  compressCover: CoverArtCompressor = compressCoverArt
): Promise<ParsedTags> {
  if (!startsWithFtyp(new Uint8Array(buffer))) return {};
  return parseMP4Atoms(buffer, compressCover);
}

function startsWithFtyp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && asciiAt(bytes, 4, 4) === 'ftyp';
}

/**
 * Reads iTunes-style tags from a run of whole MP4 atoms: a file from its first byte, or a moov
 * atom on its own.
 */
async function parseMP4Atoms(
  buffer: ArrayBuffer,
  compressCover: CoverArtCompressor
): Promise<ParsedTags> {
  const result: ParsedTags = {};
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const utf8 = new TextDecoder('utf-8');

  function readAtomType(offset: number): string {
    return String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
  }

  async function scanContainer(start: number, end: number) {
    let offset = start;
    while (offset + 8 <= end) {
      const size = view.getUint32(offset, false);
      if (size < 8) break;
      const atomEnd = Math.min(end, offset + size);
      const type = readAtomType(offset + 4);

      if (type === 'moov' || type === 'udta' || type === 'ilst') {
        await scanContainer(offset + 8, atomEnd);
      } else if (type === 'meta') {
        // FullBox has 4 bytes version/flags before children
        await scanContainer(offset + 12, atomEnd);
      } else if (
        type === '\u00a9nam' ||
        type === '\u00a9ART' ||
        type === '\u00a9alb' ||
        type === '\u00a9gen' ||
        type === 'gnre' ||
        type === '\u00a9day' ||
        type === 'covr' ||
        type === 'trkn'
      ) {
        // Look for child 'data' atom
        let child = offset + 8;
        while (child + 16 <= atomEnd) {
          const cSize = view.getUint32(child, false);
          if (cSize < 16) break;
          const cEnd = Math.min(atomEnd, child + cSize);
          const cType = readAtomType(child + 4);
          if (cType === 'data') {
            const payload = bytes.subarray(child + 16, cEnd);
            if (type === '\u00a9nam') result.title = utf8.decode(payload).trim();
            else if (type === '\u00a9ART') result.artist = utf8.decode(payload).trim();
            else if (type === '\u00a9alb') result.album = utf8.decode(payload).trim();
            else if (type === '\u00a9gen') {
              const cleaned = cleanRawGenreTag(utf8.decode(payload));
              if (cleaned) result.genre = cleaned;
            } else if (type === 'gnre' && payload.length >= 2) {
              // MP4 gnre stores 1-based ID3v1 genre code
              const code = ((payload[0] << 8) | payload[1]) - 1;
              const mapped = lookupId3v1Genre(code);
              if (mapped) result.genre = mapped;
            } else if (type === '\u00a9day') {
              const m = utf8.decode(payload).match(/\d{4}/);
              if (m) result.year = m[0];
            } else if (type === 'trkn' && payload.length >= 4) {
              const trackNum = (payload[2] << 8) | payload[3];
              if (trackNum > 0) result.trackNumber = trackNum;
            } else if (type === 'covr' && !result.coverArtUrl) {
              const dataType = view.getUint32(child + 8, false);
              const mime = dataType === 14 ? 'image/png' : 'image/jpeg';
              const blob = new Blob([payload.slice()], { type: mime });
              result.coverArtUrl = await compressCover(blob);
            }
          }
          child = cEnd;
        }
      }

      offset = atomEnd;
    }
  }

  await scanContainer(0, bytes.length);

  return result;
}

function parseFromFilePath(fileName: string, relativePath: string): {
  title: string;
  artist: string;
  album: string;
  trackNumber: number | null;
  folderName: string;
} {
  const withoutExt = fileName.replace(/\.[^.]+$/, '').trim();
  let trackNumber: number | null = null;
  let cleaned = withoutExt;

  const trackPrefix = cleaned.match(/^(\d{1,3})\s*[.\-–_]\s*(.+)$/);
  if (trackPrefix) {
    trackNumber = parseInt(trackPrefix[1], 10);
    cleaned = trackPrefix[2].trim();
  }

  let artist = 'Unknown Artist';
  let title = cleaned;

  const dashParts = cleaned.split(/\s+[-–—]\s+/);
  if (dashParts.length >= 2) {
    artist = dashParts[0].trim();
    title = dashParts.slice(1).join(' - ').trim();
  }

  const pathSegments = relativePath.split('/').filter(Boolean);
  const folderName = pathSegments.length > 1 ? pathSegments[0] : 'Local Files';
  let album = 'Unknown Album';

  // Common folder hierarchy: Root/Artist/Album/Track.mp3 or Artist/Album/Track.mp3
  if (pathSegments.length >= 3) {
    album = pathSegments[pathSegments.length - 2];
    if (artist === 'Unknown Artist') {
      artist = pathSegments[pathSegments.length - 3];
    }
  } else if (pathSegments.length === 2) {
    album = pathSegments[0];
  }

  return { title: title || withoutExt, artist, album, trackNumber, folderName };
}

function readAudioDuration(file: Blob): Promise<number> {
  if (typeof document === 'undefined') return Promise.resolve(0);
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    let settled = false;

    const finish = (dur: number) => {
      if (settled) return;
      settled = true;
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(dur) && dur > 0 ? dur : 0);
    };

    const timer = window.setTimeout(() => finish(0), 2500);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish(audio.duration);
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      finish(0);
    };
    audio.src = url;
  });
}

const FULL_HASH_THRESHOLD_BYTES = 16 * 1024 * 1024; // 16 MB

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Computes a deterministic SHA-256 fingerprint for an audio Blob/File.
 * Hashes the complete file for files <= 16 MB; for larger lossless files,
 * hashes head (4 MB) + mid (2 MB) + tail (4 MB) + exact byte length.
 */
/**
 * True for a hex SHA-256 digest as produced by computeAudioHash. Older Drive stubs stored
 * Drive's 32-char MD5 in contentHash, which never matches a local file's SHA-256.
 */
export function isSha256Hash(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

export async function computeAudioHash(blob: Blob): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle || blob.size === 0) {
    return null;
  }
  try {
    if (blob.size <= FULL_HASH_THRESHOLD_BYTES) {
      const buf = await blob.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return bufferToHex(digest);
    }

    const headLen = 4 * 1024 * 1024;
    const midLen = 2 * 1024 * 1024;
    const tailLen = 4 * 1024 * 1024;
    const midStart = Math.max(headLen, Math.floor((blob.size - midLen) / 2));
    const tailStart = Math.max(0, blob.size - tailLen);

    const [headBuf, midBuf, tailBuf] = await Promise.all([
      blob.slice(0, headLen).arrayBuffer(),
      blob.slice(midStart, midStart + midLen).arrayBuffer(),
      blob.slice(tailStart, blob.size).arrayBuffer(),
    ]);

    const sizeHeader = new ArrayBuffer(8);
    new DataView(sizeHeader).setFloat64(0, blob.size, false);

    const combined = new Uint8Array(
      sizeHeader.byteLength + headBuf.byteLength + midBuf.byteLength + tailBuf.byteLength
    );
    let offset = 0;
    combined.set(new Uint8Array(sizeHeader), offset);
    offset += sizeHeader.byteLength;
    combined.set(new Uint8Array(headBuf), offset);
    offset += headBuf.byteLength;
    combined.set(new Uint8Array(midBuf), offset);
    offset += midBuf.byteLength;
    combined.set(new Uint8Array(tailBuf), offset);

    const digest = await crypto.subtle.digest('SHA-256', combined);
    return bufferToHex(digest);
  } catch {
    return null;
  }
}

export async function extractLocalTrack(
  file: File,
  relativePathOverride?: string
): Promise<LocalTrack> {
  const webkitPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  const relativePath = relativePathOverride || webkitPath || file.name;
  const ext = file.name.split('.').pop()?.toUpperCase() || 'AUDIO';

  // Read up to first 2 MB for headers/embedded art (fast even on large WAV/FLAC)
  let tags: ParsedTags = {};
  try {
    const headSlice = await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer();
    if (ext === 'MP3') {
      tags = await parseID3v2(headSlice);
      if (!tags.title && !tags.artist) {
        const v1 = await parseID3v1(file);
        tags = { ...v1, ...tags };
      }
    } else if (ext === 'FLAC') {
      tags = await parseFLAC(headSlice);
    } else if (ext === 'M4A' || ext === 'MP4' || ext === 'AAC' || ext === 'M4B') {
      tags = await parseMP4(headSlice);
    } else {
      tags = await parseID3v2(headSlice);
    }
  } catch {
    // Gracefully fall back to filename & folder hierarchy parsing
    tags = {};
  }

  const fallback = parseFromFilePath(file.name, relativePath);
  let duration = 0;
  try {
    duration = await readAudioDuration(file);
  } catch {
    duration = 0;
  }
  const contentHash = await computeAudioHash(file);
  const now = Date.now();
  const fileKey = `${relativePath.toLowerCase()}::${file.size}`;

  return {
    id: crypto.randomUUID(),
    fileKey,
    fileName: file.name,
    relativePath,
    folderName: fallback.folderName,
    title: tags.title || fallback.title,
    artist: tags.artist || fallback.artist,
    album: tags.album || fallback.album,
    genre: tags.genre || undefined,
    year: tags.year || '',
    trackNumber: tags.trackNumber ?? fallback.trackNumber,
    duration,
    format: ext,
    fileSize: file.size,
    contentHash,
    coverArtUrl: tags.coverArtUrl ?? null,
    addedAt: now,
    lastSeenAt: now,
    isMissingOnDevice: false,
    youtubeVideoId: null,
    youtubeTitle: null,
    matchStatus: 'unmatched',
  };
}

// ---------- Reading tags and duration from the first bytes of a file ----------

/** The first read of every file. Most tags and the audio frame after them fit in it. */
export const TAG_HEAD_BYTES = 128 * 1024;
/** Read this far past the end of an ID3v2 tag, so the first audio frame is in hand too. */
export const ID3_TAIL_MARGIN_BYTES = 16 * 1024;
/** The most to read for one ID3v2 tag, head included. Larger tags are nearly all cover art. */
export const ID3_MAX_READ_BYTES = 2 * 1024 * 1024;
/** The most of a moov atom to read. */
export const MP4_MOOV_MAX_BYTES = 4 * 1024 * 1024;

const MP4_MAX_TOP_LEVEL_ATOMS = 64;
const WAV_MAX_CHUNKS = 64;
/** A Xing, Info or VBRI header ends within this many bytes of the start of its frame. */
const MPEG_VBR_HEADER_SPAN = 64;
const MP4_EXTENSIONS: ReadonlySet<string> = new Set(['M4A', 'MP4', 'M4B', 'AAC']);

/** Returns the bytes of a file from start up to, not including, end. */
export type AudioRangeReader = (start: number, end: number) => Promise<ArrayBuffer>;

/** What a file says about itself. A null field means the file has no such tag. */
export interface AudioFileTags {
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: string | null;
  trackNumber: number | null;
  coverArtUrl: string | null;
  /** Seconds, 0 when the bytes read do not say. */
  duration: number;
}

type FileBytes = Uint8Array<ArrayBuffer>;

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let text = '';
  for (let i = offset; i < offset + length && i < bytes.length; i++) {
    text += String.fromCharCode(bytes[i]);
  }
  return text;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function joinBytes(first: Uint8Array, second: Uint8Array): FileBytes {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first, 0);
  joined.set(second, first.length);
  return joined;
}

/** The tag parsers take a whole ArrayBuffer, and a view may cover only part of one. */
function bufferOf(bytes: FileBytes): ArrayBuffer {
  const coversWholeBuffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  return coversWholeBuffer ? bytes.buffer : bytes.slice().buffer;
}

interface FileSource {
  /** Bytes in the file, or null when the listing gave no size. */
  size: number | null;
  /** Keeps a read from running past the end of the file. */
  clamp: (end: number) => number;
  /** Bytes from start up to end: from the head when it holds them, otherwise a new read. */
  read: (start: number, end: number) => Promise<FileBytes>;
  /** A new read, whatever the head holds. */
  fetch: (start: number, end: number) => Promise<FileBytes>;
}

function fileSource(head: FileBytes, size: number | null, readRange: AudioRangeReader): FileSource {
  const clamp = (end: number) => (size === null ? end : Math.min(end, size));
  const fetch = async (start: number, end: number): Promise<FileBytes> => {
    const stop = clamp(end);
    return stop <= start ? new Uint8Array(0) : new Uint8Array(await readRange(start, stop));
  };
  return {
    size,
    clamp,
    fetch,
    read: async (start, end) => {
      const stop = clamp(end);
      if (stop <= start) return new Uint8Array(0);
      return stop <= head.length ? head.subarray(start, stop) : fetch(start, stop);
    },
  };
}

function toAudioFileTags(tags: ParsedTags, duration: number): AudioFileTags {
  return {
    title: tags.title || null,
    artist: tags.artist || null,
    album: tags.album || null,
    genre: tags.genre || null,
    year: tags.year || null,
    trackNumber: tags.trackNumber ?? null,
    coverArtUrl: tags.coverArtUrl ?? null,
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) / 1000 : 0,
  };
}

// MPEG audio frame headers. Bitrates are in kbit/s by the 4-bit index in the header. Index 0
// means free format and index 15 is invalid, so neither gives a frame length.
const MPEG1_LAYER1_KBPS = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448];
const MPEG1_LAYER2_KBPS = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
const MPEG1_LAYER3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_LAYER1_KBPS = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256];
const MPEG2_LAYER23_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
/** MPEG 1 sample rates by header index. MPEG 2 halves them and MPEG 2.5 quarters them. */
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000];

interface MpegFrameHeader {
  /** Bits per second. */
  bitrate: number;
  sampleRate: number;
  samplesPerFrame: number;
  /** Bytes in the frame, header included. */
  length: number;
  /** The places a Xing or Info header can start, counted from the first byte of the frame. */
  xingOffsets: readonly number[];
}

interface MpegFrame extends MpegFrameHeader {
  /** Index of the frame's first byte in the bytes the search covered. */
  offset: number;
}

function parseMpegFrameHeader(bytes: Uint8Array, offset: number): MpegFrameHeader | null {
  if (offset + 4 > bytes.length) return null;
  // Eleven set bits mark the start of a frame.
  if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return null;

  const versionBits = (bytes[offset + 1] >> 3) & 0x03; // 3 = MPEG 1, 2 = MPEG 2, 0 = MPEG 2.5
  const layerBits = (bytes[offset + 1] >> 1) & 0x03; // 3 = layer 1, 2 = layer 2, 1 = layer 3
  const bitrateIndex = bytes[offset + 2] >> 4;
  const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x03;
  if (versionBits === 1 || layerBits === 0) return null;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;

  const isMpeg1 = versionBits === 3;
  const layer = 4 - layerBits;
  const kbps = isMpeg1
    ? layer === 1
      ? MPEG1_LAYER1_KBPS
      : layer === 2
        ? MPEG1_LAYER2_KBPS
        : MPEG1_LAYER3_KBPS
    : layer === 1
      ? MPEG2_LAYER1_KBPS
      : MPEG2_LAYER23_KBPS;
  const bitrate = kbps[bitrateIndex] * 1000;
  const sampleRate = MPEG1_SAMPLE_RATES[sampleRateIndex] / (isMpeg1 ? 1 : versionBits === 2 ? 2 : 4);
  const padding = (bytes[offset + 2] >> 1) & 0x01;
  const samplesPerFrame = layer === 1 ? 384 : layer === 2 || isMpeg1 ? 1152 : 576;
  const length =
    layer === 1
      ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
      : Math.floor(((samplesPerFrame / 8) * bitrate) / sampleRate) + padding;

  // The Xing header follows the side information, whose size depends on version and channels.
  // A header that claims a 2-byte checksum should push it 2 bytes on, but encoders that set
  // the bit often leave the Xing header where it was, so both places count.
  const isMono = bytes[offset + 3] >> 6 === 3;
  const hasChecksum = (bytes[offset + 1] & 0x01) === 0;
  const sideInfoBytes = isMpeg1 ? (isMono ? 17 : 32) : isMono ? 9 : 17;
  const xingOffset = 4 + sideInfoBytes;

  return {
    bitrate,
    sampleRate,
    samplesPerFrame,
    length,
    xingOffsets: hasChecksum ? [xingOffset, xingOffset + 2] : [xingOffset],
  };
}

function findFirstMpegFrame(bytes: Uint8Array, from: number): MpegFrame | null {
  for (let offset = Math.max(0, from); offset + 4 <= bytes.length; offset++) {
    if (bytes[offset] !== 0xff) continue;
    const header = parseMpegFrameHeader(bytes, offset);
    if (!header) continue;
    // The same bit pattern turns up inside tag padding and cover art. Another frame at the same
    // sample rate follows a real frame, so check that when the bytes are in hand.
    const next = offset + header.length;
    if (next + 4 <= bytes.length) {
      const following = parseMpegFrameHeader(bytes, next);
      if (!following || following.sampleRate !== header.sampleRate) continue;
    }
    return { ...header, offset };
  }
  return null;
}

/** The frame count an encoder wrote into the first frame, or null when it wrote none. */
function readVbrFrameCount(bytes: Uint8Array, frame: MpegFrame): number | null {
  const view = viewOf(bytes);

  for (const xingOffset of frame.xingOffsets) {
    const xing = frame.offset + xingOffset;
    if (xing + 12 > bytes.length) continue;
    const label = asciiAt(bytes, xing, 4);
    // Bit 0 of the flags says a frame count follows them.
    if ((label === 'Xing' || label === 'Info') && (view.getUint32(xing + 4) & 0x01) !== 0) {
      const frames = view.getUint32(xing + 8);
      if (frames > 0) return frames;
    }
  }

  // The Fraunhofer encoder puts its header 32 bytes after the frame header, whatever the mode.
  const vbri = frame.offset + 36;
  if (vbri + 18 <= bytes.length && asciiAt(bytes, vbri, 4) === 'VBRI') {
    const frames = view.getUint32(vbri + 14);
    if (frames > 0) return frames;
  }

  return null;
}

/** Where the ID3v2 tag at the start of a file ends, or 0 when the file starts with none. */
function id3v2TagEnd(bytes: Uint8Array): number {
  if (bytes.length < 10 || asciiAt(bytes, 0, 3) !== 'ID3') return 0;
  const hasFooter = (bytes[5] & 0x10) !== 0;
  return 10 + readSynchsafeInt(viewOf(bytes), 6) + (hasFooter ? 10 : 0);
}

async function readMp3Head(
  head: FileBytes,
  source: FileSource,
  compressCover: CoverArtCompressor
): Promise<AudioFileTags> {
  let bytes = head;
  const tagEnd = id3v2TagEnd(head);
  if (tagEnd > bytes.length) {
    const target = source.clamp(Math.min(tagEnd + ID3_TAIL_MARGIN_BYTES, ID3_MAX_READ_BYTES));
    if (target > bytes.length) bytes = joinBytes(bytes, await source.fetch(bytes.length, target));
  }

  let tags = await parseID3v2(bufferOf(bytes), compressCover);

  let audio: Uint8Array = bytes;
  let audioStart = 0;
  let frame = findFirstMpegFrame(bytes, tagEnd);
  const reachedEndOfFile = source.size !== null && bytes.length >= source.size;
  const frameInHand =
    frame !== null && (frame.offset + MPEG_VBR_HEADER_SPAN <= bytes.length || reachedEndOfFile);
  // The tag ran past the 2 MB cap, or ended so close to the last byte read that the read cut
  // the first frame short. One short read at the end of the tag fetches that frame.
  if (!frameInHand && !reachedEndOfFile && tagEnd + ID3_TAIL_MARGIN_BYTES > bytes.length) {
    const probe = await source.fetch(tagEnd, tagEnd + ID3_TAIL_MARGIN_BYTES);
    const found = findFirstMpegFrame(probe, 0);
    if (found) {
      frame = found;
      audio = probe;
      audioStart = tagEnd;
    }
  }

  // Older files carry only the ID3v1 tag in their last 128 bytes.
  let id3v1Bytes = 0;
  if (!tags.title && !tags.artist && source.size !== null && source.size >= 128) {
    const tail = await source.read(source.size - 128, source.size);
    const v1 = parseID3v1Bytes(tail);
    if (asciiAt(tail, 0, 3) === 'TAG') id3v1Bytes = 128;
    tags = { ...v1, ...tags };
  }

  let duration = 0;
  if (frame) {
    const frameCount = readVbrFrameCount(audio, frame);
    if (frameCount !== null) {
      duration = (frameCount * frame.samplesPerFrame) / frame.sampleRate;
    } else if (source.size !== null) {
      // No frame count, so take the file for constant bitrate: audio bytes over bytes a second.
      const audioBytes = source.size - (audioStart + frame.offset) - id3v1Bytes;
      duration = (audioBytes * 8) / frame.bitrate;
    }
  }
  return toAudioFileTags(tags, duration);
}

/**
 * Finds the moov atom by walking the headers of the top-level atoms. A file written for
 * streaming has it right after ftyp; most others put it after mdat, which holds the audio.
 */
async function readMoovAtom(head: FileBytes, source: FileSource): Promise<FileBytes | null> {
  let offset = 0;
  for (let step = 0; step < MP4_MAX_TOP_LEVEL_ATOMS; step++) {
    const header = await source.read(offset, offset + 16);
    if (header.length < 8) return null;
    const view = viewOf(header);
    let atomSize = view.getUint32(0);
    let headerBytes = 8;
    if (atomSize === 1) {
      // The real length is the 64-bit number after the type.
      if (header.length < 16) return null;
      atomSize = view.getUint32(8) * 2 ** 32 + view.getUint32(12);
      headerBytes = 16;
    } else if (atomSize === 0) {
      // Zero means the atom runs to the end of the file.
      if (source.size === null) return null;
      atomSize = source.size - offset;
    }
    if (atomSize < headerBytes) return null;

    if (asciiAt(header, 4, 4) === 'moov') {
      const end = source.clamp(offset + Math.min(atomSize, MP4_MOOV_MAX_BYTES));
      if (end <= head.length) return head.subarray(offset, end);
      if (offset < head.length) {
        return joinBytes(head.subarray(offset), await source.fetch(head.length, end));
      }
      return source.fetch(offset, end);
    }
    offset += atomSize;
  }
  return null;
}

/** The length of the movie in seconds, from the mvhd atom inside a moov atom. */
function readMvhdDuration(moov: Uint8Array): number {
  if (moov.length < 16) return 0;
  const view = viewOf(moov);
  let offset = view.getUint32(0) === 1 ? 16 : 8;
  while (offset + 8 <= moov.length) {
    const size = view.getUint32(offset);
    if (size < 8) return 0;
    if (asciiAt(moov, offset + 4, 4) === 'mvhd') {
      const body = offset + 8;
      // Version 1 stores the two dates and the duration as 64 bits, version 0 as 32.
      if (moov[body] === 1) {
        if (body + 32 > moov.length) return 0;
        const timescale = view.getUint32(body + 20);
        const units = view.getUint32(body + 24) * 2 ** 32 + view.getUint32(body + 28);
        return timescale > 0 ? units / timescale : 0;
      }
      if (body + 20 > moov.length) return 0;
      const timescale = view.getUint32(body + 12);
      const units = view.getUint32(body + 16);
      // All ones means the writer did not know the length.
      return timescale > 0 && units !== 0xffffffff ? units / timescale : 0;
    }
    offset += size;
  }
  return 0;
}

/** Total samples over sample rate, both from the STREAMINFO block that opens every FLAC file. */
function readFlacDuration(bytes: Uint8Array): number {
  // "fLaC", a 4-byte block header, then 34 bytes of STREAMINFO. Byte 18 of the file starts 20
  // bits of sample rate; the low half of byte 21 starts 36 bits of sample count.
  if (bytes.length < 26 || asciiAt(bytes, 0, 4) !== 'fLaC' || (bytes[4] & 0x7f) !== 0) return 0;
  const sampleRate = (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4);
  const totalSamples = (bytes[21] & 0x0f) * 2 ** 32 + viewOf(bytes).getUint32(22);
  return sampleRate > 0 ? totalSamples / sampleRate : 0;
}

/** Bytes of audio in the "data" chunk over the bytes a second that the "fmt " chunk declares. */
async function readWavDuration(head: Uint8Array, source: FileSource): Promise<number> {
  if (head.length < 12 || asciiAt(head, 0, 4) !== 'RIFF' || asciiAt(head, 8, 4) !== 'WAVE') return 0;
  let offset = 12;
  let bytesPerSecond = 0;
  for (let step = 0; step < WAV_MAX_CHUNKS; step++) {
    const header = await source.read(offset, offset + 8);
    if (header.length < 8) return 0;
    const id = asciiAt(header, 0, 4);
    const chunkSize = viewOf(header).getUint32(4, true);
    if (id === 'fmt ') {
      const format = await source.read(offset + 8, offset + 24);
      if (format.length >= 12) bytesPerSecond = viewOf(format).getUint32(8, true);
    } else if (id === 'data') {
      if (bytesPerSecond <= 0) return 0;
      const dataStart = offset + 8;
      // A recorder that could not seek back leaves the length at 0 or all ones.
      const declared = chunkSize === 0 || chunkSize === 0xffffffff ? Infinity : chunkSize;
      const dataBytes =
        source.size === null ? declared : Math.min(declared, source.size - dataStart);
      return Number.isFinite(dataBytes) && dataBytes > 0 ? dataBytes / bytesPerSecond : 0;
    }
    // Chunks start on even offsets.
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return 0;
}

/**
 * Reads a file's tags, cover art and duration without the whole file: one read of the first
 * 128 KB, then a few short reads only where the format needs them. The file name picks the
 * parser. A fileSize of 0 means the size is unknown.
 */
export async function readTagsFromFileHead(
  fileName: string,
  fileSize: number,
  readRange: AudioRangeReader,
  options: { compressCover?: CoverArtCompressor } = {}
): Promise<AudioFileTags> {
  const compressCover = options.compressCover ?? compressCoverArt;
  const size = fileSize > 0 ? fileSize : null;
  const head = new Uint8Array(
    await readRange(0, size === null ? TAG_HEAD_BYTES : Math.min(TAG_HEAD_BYTES, size))
  );
  const source = fileSource(head, size, readRange);
  const ext = fileName.split('.').pop()?.toUpperCase() ?? '';

  if (ext === 'MP3') return readMp3Head(head, source, compressCover);

  if (ext === 'FLAC') {
    return toAudioFileTags(await parseFLAC(bufferOf(head), compressCover), readFlacDuration(head));
  }

  if (MP4_EXTENSIONS.has(ext) && startsWithFtyp(head)) {
    const moov = await readMoovAtom(head, source);
    if (!moov) return toAudioFileTags({}, 0);
    return toAudioFileTags(
      await parseMP4Atoms(bufferOf(moov), compressCover),
      readMvhdDuration(moov)
    );
  }

  const tags = await parseID3v2(bufferOf(head), compressCover);
  const duration = ext === 'WAV' || ext === 'WAVE' ? await readWavDuration(head, source) : 0;
  return toAudioFileTags(tags, duration);
}

/**
 * Reads the tags and duration of a file that is already in memory, with the same parser a
 * ranged read uses, so a song reads the same whether it was downloaded whole or in part.
 */
export async function readTagsFromBlob(
  blob: Blob,
  fileName: string,
  options: { compressCover?: CoverArtCompressor } = {}
): Promise<AudioFileTags> {
  const tags = await readTagsFromFileHead(
    fileName,
    blob.size,
    (start, end) => blob.slice(start, end).arrayBuffer(),
    options
  );
  if (tags.duration > 0) return tags;
  // The parsers cannot measure every format, OGG for one. An audio element can.
  return { ...tags, duration: await readAudioDuration(blob) };
}
