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

/**
 * Resize embedded album cover art into a compact 160x160 JPEG Data URL
 * so IndexedDB storage remains light even with hundreds of tracks.
 */
async function compressCoverArt(blob: Blob): Promise<string | null> {
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

async function parseID3v2(buffer: ArrayBuffer): Promise<ParsedTags> {
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

    if (!frameId.trim() || frameId.charCodeAt(0) === 0 || frameSize <= 0) {
      break;
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
          result.coverArtUrl = await compressCoverArt(blob);
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
  const tail = await file.slice(file.size - 128).arrayBuffer();
  const bytes = new Uint8Array(tail);
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

async function parseFLAC(buffer: ArrayBuffer): Promise<ParsedTags> {
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
          result.coverArtUrl = await compressCoverArt(blob);
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

async function parseMP4(buffer: ArrayBuffer): Promise<ParsedTags> {
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
              result.coverArtUrl = await compressCoverArt(blob);
            }
          }
          child = cEnd;
        }
      }

      offset = atomEnd;
    }
  }

  if (bytes.length >= 12 && readAtomType(4) === 'ftyp') {
    await scanContainer(0, bytes.length);
  }

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

function readAudioDuration(file: File): Promise<number> {
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
