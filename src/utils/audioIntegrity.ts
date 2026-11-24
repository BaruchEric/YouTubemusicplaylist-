import type { LocalTrack } from '../types/music';

export type IntegrityIssueCode =
  | 'corrupt-header'
  | 'unplayable-stream'
  | 'empty-or-truncated'
  | 'container-mismatch'
  | 'missing-duration'
  | 'implausible-duration'
  | 'duration-mismatch'
  | 'corrupt-text-tags';

export type IntegritySeverity = 'error' | 'warning';

export interface IntegrityIssue {
  code: IntegrityIssueCode;
  severity: IntegritySeverity;
  label: string;
  detail: string;
}

export interface TrackIntegrityScanResult {
  trackId: string;
  scannedAt: number;
  blobAvailable: boolean;
  detectedContainer: string | null;
  probedDuration: number | null;
  suggestedFormat: string | null;
  issues: IntegrityIssue[];
}

export interface TrackIntegrityReport {
  track: LocalTrack;
  issues: IntegrityIssue[];
  hasHeaderIssue: boolean;
  hasDurationIssue: boolean;
  hasError: boolean;
  deepScanned: boolean;
  blobAvailable: boolean | null;
  detectedContainer: string | null;
  suggestedDuration: number | null;
  suggestedFormat: string | null;
  canAutoFix: boolean;
}

export interface IntegritySummary {
  totalFlagged: number;
  headerIssueCount: number;
  durationIssueCount: number;
  autoFixableCount: number;
  deepScannedCount: number;
  corruptUnrecoverableIds: string[];
  reports: TrackIntegrityReport[];
}

const HEADER_ISSUE_CODES = new Set<IntegrityIssueCode>([
  'corrupt-header',
  'unplayable-stream',
  'empty-or-truncated',
  'container-mismatch',
  'corrupt-text-tags',
]);

const DURATION_ISSUE_CODES = new Set<IntegrityIssueCode>([
  'missing-duration',
  'implausible-duration',
  'duration-mismatch',
]);

const NON_LOCAL_FORMATS = new Set(['YT', 'LIST']);

const COMPRESSED_FORMATS = new Set(['MP3', 'M4A', 'M4B', 'M4P', 'MP4', 'AAC', 'OGG', 'OGA', 'OPUS', 'WMA', 'WEBM']);

function hasCorruptTagChars(value: string | undefined): boolean {
  if (!value) return false;
  // Replacement char (mojibake) or ASCII control characters excluding common whitespace
  // eslint-disable-next-line no-control-regex
  return /\uFFFD|[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value);
}

function readSynchsafeInt(view: DataView, offset: number): number {
  return (
    ((view.getUint8(offset) & 0x7f) << 21) |
    ((view.getUint8(offset + 1) & 0x7f) << 14) |
    ((view.getUint8(offset + 2) & 0x7f) << 7) |
    (view.getUint8(offset + 3) & 0x7f)
  );
}

function matchesAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function findMpegFrameSync(bytes: Uint8Array, startOffset: number): boolean {
  const limit = Math.min(bytes.length - 2, startOffset + 16384);
  for (let i = Math.max(0, startOffset); i < limit; i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) {
      const mpegVersionBits = (bytes[i + 1] >> 3) & 0x03;
      const layerBits = (bytes[i + 1] >> 1) & 0x03;
      // Reject reserved MPEG version (01) and reserved layer (00)
      if (mpegVersionBits !== 1 && layerBits !== 0) {
        return true;
      }
    }
  }
  return false;
}

function detectBinaryContainer(bytes: Uint8Array): {
  container: string | null;
  headerError: string | null;
  isHtmlOrTextPayload: boolean;
} {
  if (bytes.length < 12) {
    return {
      container: null,
      headerError: `File header is truncated (${bytes.length} bytes)`,
      isHtmlOrTextPayload: false,
    };
  }

  // Detect HTML / XML / JSON error payloads saved with an audio extension
  const headAscii = new TextDecoder('iso-8859-1')
    .decode(bytes.subarray(0, Math.min(64, bytes.length)))
    .trimStart()
    .toLowerCase();
  if (
    headAscii.startsWith('<!doctype html') ||
    headAscii.startsWith('<html') ||
    headAscii.startsWith('<?xml') ||
    (headAscii.startsWith('{') && headAscii.includes('"error"'))
  ) {
    return {
      container: 'HTML/Text',
      headerError: 'File contains HTML/text data instead of a valid audio header',
      isHtmlOrTextPayload: true,
    };
  }

  // FLAC magic: "fLaC"
  if (matchesAscii(bytes, 0, 'fLaC')) {
    // First metadata block after "fLaC" must be STREAMINFO (type 0) with length 34
    if (bytes.length >= 8) {
      const blockType = bytes[4] & 0x7f;
      const blockLen = (bytes[5] << 16) | (bytes[6] << 8) | bytes[7];
      if (blockType !== 0 || blockLen !== 34) {
        return {
          container: 'FLAC',
          headerError: `Corrupt FLAC STREAMINFO block (type ${blockType}, length ${blockLen})`,
          isHtmlOrTextPayload: false,
        };
      }
    }
    return { container: 'FLAC', headerError: null, isHtmlOrTextPayload: false };
  }

  // WAV / RIFF: "RIFF" ... "WAVE"
  if (matchesAscii(bytes, 0, 'RIFF')) {
    if (!matchesAscii(bytes, 8, 'WAVE')) {
      return {
        container: 'RIFF',
        headerError: 'RIFF container is missing the WAVE audio format identifier',
        isHtmlOrTextPayload: false,
      };
    }
    return { container: 'WAV', headerError: null, isHtmlOrTextPayload: false };
  }

  // AIFF: "FORM" ... "AIFF" or "AIFC"
  if (matchesAscii(bytes, 0, 'FORM')) {
    if (matchesAscii(bytes, 8, 'AIFF') || matchesAscii(bytes, 8, 'AIFC')) {
      return { container: 'AIFF', headerError: null, isHtmlOrTextPayload: false };
    }
    return {
      container: 'FORM',
      headerError: 'FORM container is missing AIFF/AIFC signature',
      isHtmlOrTextPayload: false,
    };
  }

  // OGG / OPUS: "OggS"
  if (matchesAscii(bytes, 0, 'OggS')) {
    const isOpus = matchesAscii(bytes, 28, 'OpusHead');
    return {
      container: isOpus ? 'OPUS' : 'OGG',
      headerError: null,
      isHtmlOrTextPayload: false,
    };
  }

  // ISO BMFF (M4A / MP4 / ALAC): bytes 4..7 === "ftyp"
  if (matchesAscii(bytes, 4, 'ftyp')) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const boxSize = view.getUint32(0, false);
    if (boxSize < 16) {
      return {
        container: 'M4A',
        headerError: `Corrupt MP4/M4A ftyp header box size (${boxSize} bytes)`,
        isHtmlOrTextPayload: false,
      };
    }
    return { container: 'M4A', headerError: null, isHtmlOrTextPayload: false };
  }

  // WebM / Matroska EBML header
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { container: 'WEBM', headerError: null, isHtmlOrTextPayload: false };
  }

  // WMA / ASF GUID header
  if (bytes[0] === 0x30 && bytes[1] === 0x26 && bytes[2] === 0xb2 && bytes[3] === 0x75) {
    return { container: 'WMA', headerError: null, isHtmlOrTextPayload: false };
  }

  // ID3v2 header (typically MP3, occasionally AAC or ID3-wrapped FLAC)
  if (matchesAscii(bytes, 0, 'ID3')) {
    const version = bytes[3];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tagSize = readSynchsafeInt(view, 6);
    if (version > 4) {
      return {
        container: 'MP3',
        headerError: `Unsupported or corrupt ID3v2.${version} header version`,
        isHtmlOrTextPayload: false,
      };
    }
    // Check if ID3-wrapped FLAC
    const afterId3 = 10 + tagSize;
    if (afterId3 + 4 <= bytes.length && matchesAscii(bytes, afterId3, 'fLaC')) {
      return { container: 'FLAC', headerError: null, isHtmlOrTextPayload: false };
    }
    return { container: 'MP3', headerError: null, isHtmlOrTextPayload: false };
  }

  // Raw ADTS AAC or MPEG MP3 frame sync without ID3v2 header
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) {
    return { container: 'AAC', headerError: null, isHtmlOrTextPayload: false };
  }
  if (findMpegFrameSync(bytes, 0)) {
    return { container: 'MP3', headerError: null, isHtmlOrTextPayload: false };
  }

  return {
    container: null,
    headerError: 'Unrecognized or corrupt audio header (no valid magic bytes or frame sync)',
    isHtmlOrTextPayload: false,
  };
}

function areFormatsCompatible(declaredFormat: string, detectedContainer: string): boolean {
  const decl = declaredFormat.toUpperCase();
  const det = detectedContainer.toUpperCase();
  if (decl === det) return true;
  if ((decl === 'MP4' || decl === 'M4A' || decl === 'M4B' || decl === 'M4P' || decl === 'ALAC' || decl === '3GP') && det === 'M4A') {
    return true;
  }
  if ((decl === 'OGG' || decl === 'OGA' || decl === 'OPUS') && (det === 'OGG' || det === 'OPUS')) {
    return true;
  }
  if ((decl === 'AIF' || decl === 'AIFF' || decl === 'AIFC') && det === 'AIFF') {
    return true;
  }
  if ((decl === 'MP3' || decl === 'AAC') && (det === 'MP3' || det === 'AAC')) {
    return true;
  }
  return false;
}

/**
 * Synchronous metadata-level integrity audit so Dashboard Quick Actions and Scanner badges
 * immediately reflect incomplete durations, truncated/empty files, and corrupt text tags.
 */
export function evaluateTrackMetadataIntegrity(track: LocalTrack): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const fmt = (track.format || '').toUpperCase();
  const isLocalAudio = !NON_LOCAL_FORMATS.has(fmt);
  // Duration is unknown by design for YouTube/list placeholders and for Drive songs whose
  // audio has not been cached yet (the stub is built from Drive file metadata only).
  const durationNotReadYet =
    !isLocalAudio || (Boolean(track.driveFileId) && !track.cachedOnDeviceAt);

  // 1. Incomplete / missing duration metadata
  if (!Number.isFinite(track.duration) || track.duration <= 0) {
    if (!durationNotReadYet) {
      issues.push({
        code: 'missing-duration',
        severity: 'error',
        label: 'Missing duration',
        detail: 'Duration metadata is 0:00 or missing from file header',
      });
    }
  } else if (track.duration < 3) {
    issues.push({
      code: 'implausible-duration',
      severity: 'warning',
      label: 'Truncated duration',
      detail: `Reported duration is only ${Math.round(track.duration)}s (file may be truncated)`,
    });
  } else if (isLocalAudio && track.fileSize > 0) {
    const kbps = (track.fileSize * 8) / track.duration / 1000;
    if (kbps < 12) {
      issues.push({
        code: 'implausible-duration',
        severity: 'warning',
        label: 'Abnormal bitrate / duration',
        detail: `Implied bitrate (${Math.round(kbps)} kbps) suggests a corrupt VBR duration header`,
      });
    } else if (COMPRESSED_FORMATS.has(fmt) && kbps > 4500) {
      issues.push({
        code: 'implausible-duration',
        severity: 'warning',
        label: 'Implausible duration metadata',
        detail: `Duration (${Math.round(track.duration)}s) looks too short for ${Math.round(track.fileSize / 1024)} KB ${fmt}`,
      });
    }
  }

  // 2. Empty or truncated local audio file
  if (isLocalAudio && !track.isMissingOnDevice) {
    if (!track.fileSize || track.fileSize <= 0) {
      issues.push({
        code: 'empty-or-truncated',
        severity: 'error',
        label: 'Empty 0-byte file',
        detail: 'File size is 0 bytes — header and audio payload are missing',
      });
    } else if (track.fileSize < 1024) {
      issues.push({
        code: 'empty-or-truncated',
        severity: 'error',
        label: 'Truncated file',
        detail: `File is only ${track.fileSize} bytes — too small to contain valid audio frames`,
      });
    }
  }

  // 3. Corrupt / malformed tag encoding characters
  if (
    hasCorruptTagChars(track.title) ||
    hasCorruptTagChars(track.artist) ||
    hasCorruptTagChars(track.album)
  ) {
    issues.push({
      code: 'corrupt-text-tags',
      severity: 'warning',
      label: 'Corrupt tag encoding',
      detail: 'Embedded ID3/Vorbis text fields contain invalid control bytes or mojibake characters',
    });
  }

  return issues;
}

/**
 * Probes the real playable duration and decoder validity of a local audio Blob via HTMLAudioElement.
 */
async function probeAudioBlobDuration(blob: Blob): Promise<{
  duration: number | null;
  decodeError: string | null;
}> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = 'metadata';

    let settled = false;
    const finish = (result: { duration: number | null; decodeError: string | null }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(objectUrl);
      resolve(result);
    };

    const timeout = window.setTimeout(() => {
      finish({ duration: null, decodeError: 'Timed out reading audio container metadata' });
    }, 3500);

    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        finish({ duration: Math.round(audio.duration), decodeError: null });
      } else {
        finish({
          duration: null,
          decodeError: 'Decoder loaded file but duration metadata is still missing or infinite',
        });
      }
    };

    audio.onerror = () => {
      const code = audio.error?.code;
      const reason =
        code === MediaError.MEDIA_ERR_DECODE
          ? 'Browser audio decoder failed (MEDIA_ERR_DECODE — corrupt header or frames)'
          : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
            ? 'Audio container header rejected or unsupported (MEDIA_ERR_SRC_NOT_SUPPORTED)'
            : 'Audio stream could not be decoded';
      finish({ duration: null, decodeError: reason });
    };

    audio.src = objectUrl;
  });
}

/**
 * Deep binary header & duration verification on a cached/mounted local audio Blob.
 */
export async function inspectAudioBlobIntegrity(
  track: LocalTrack,
  blob: Blob | null
): Promise<TrackIntegrityScanResult> {
  const scannedAt = Date.now();
  if (!blob) {
    return {
      trackId: track.id,
      scannedAt,
      blobAvailable: false,
      detectedContainer: null,
      probedDuration: null,
      suggestedFormat: null,
      issues: [],
    };
  }

  const issues: IntegrityIssue[] = [];
  let detectedContainer: string | null = null;
  let suggestedFormat: string | null = null;

  // Step 1: Inspect leading 64 KB of raw binary header
  try {
    const headBuffer = await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer();
    const bytes = new Uint8Array(headBuffer);
    const view = new DataView(headBuffer);

    const binaryCheck = detectBinaryContainer(bytes);
    detectedContainer = binaryCheck.container;

    if (binaryCheck.headerError) {
      issues.push({
        code: 'corrupt-header',
        severity: 'error',
        label: binaryCheck.isHtmlOrTextPayload ? 'Corrupt file (HTML/Text)' : 'Corrupt header',
        detail: binaryCheck.headerError,
      });
    } else if (matchesAscii(bytes, 0, 'ID3') && bytes.length >= 10) {
      // Extra ID3v2 structural integrity check: tag size must fit inside blob
      const tagSize = readSynchsafeInt(view, 6);
      if (10 + tagSize >= blob.size) {
        issues.push({
          code: 'corrupt-header',
          severity: 'error',
          label: 'Corrupt ID3v2 header',
          detail: `ID3v2 tag header declares ${tagSize.toLocaleString()} bytes, exceeding total file size (${blob.size.toLocaleString()} bytes)`,
        });
      }
    }

    // Check container vs declared extension mismatch
    const declaredFmt = (track.format || '').toUpperCase();
    if (
      detectedContainer &&
      !binaryCheck.isHtmlOrTextPayload &&
      !NON_LOCAL_FORMATS.has(declaredFmt) &&
      declaredFmt !== 'AUDIO' &&
      !areFormatsCompatible(declaredFmt, detectedContainer)
    ) {
      suggestedFormat = detectedContainer;
      issues.push({
        code: 'container-mismatch',
        severity: 'warning',
        label: 'Format header mismatch',
        detail: `File extension says ${declaredFmt}, but binary header is ${detectedContainer}`,
      });
    }
  } catch {
    issues.push({
      code: 'corrupt-header',
      severity: 'error',
      label: 'Unreadable header',
      detail: 'Could not read binary bytes from local audio file',
    });
  }

  // Step 2: Probe real playable duration via HTMLAudioElement
  const probe = await probeAudioBlobDuration(blob);
  const probedDuration = probe.duration;

  if (probe.decodeError && !issues.some((i) => i.code === 'corrupt-header')) {
    issues.push({
      code: 'unplayable-stream',
      severity: 'error',
      label: 'Unplayable audio stream',
      detail: probe.decodeError,
    });
  } else if (probedDuration && probedDuration > 0) {
    if (track.duration > 0 && Math.abs(track.duration - probedDuration) >= 5) {
      issues.push({
        code: 'duration-mismatch',
        severity: 'warning',
        label: 'Inaccurate duration metadata',
        detail: `Catalog reports ${formatSec(track.duration)}, but audio stream decodes to ${formatSec(probedDuration)}`,
      });
    }
  }

  return {
    trackId: track.id,
    scannedAt,
    blobAvailable: true,
    detectedContainer,
    probedDuration,
    suggestedFormat,
    issues,
  };
}

function formatSec(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/**
 * Parses a human-entered duration string such as "3:45", "1:02:10", or "225" into seconds.
 * Returns null if invalid.
 */
export function parseDurationInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const val = parseInt(trimmed, 10);
    return val > 0 && val < 86400 ? val : null;
  }

  const parts = trimmed.split(':').map((p) => p.trim());
  if (parts.some((p) => !/^\d+$/.test(p))) return null;

  if (parts.length === 2) {
    const mins = parseInt(parts[0], 10);
    const secs = parseInt(parts[1], 10);
    if (secs >= 60) return null;
    const total = mins * 60 + secs;
    return total > 0 && total < 86400 ? total : null;
  }

  if (parts.length === 3) {
    const hrs = parseInt(parts[0], 10);
    const mins = parseInt(parts[1], 10);
    const secs = parseInt(parts[2], 10);
    if (mins >= 60 || secs >= 60) return null;
    const total = hrs * 3600 + mins * 60 + secs;
    return total > 0 && total < 86400 ? total : null;
  }

  return null;
}

/**
 * Combines instant metadata audit + optional deep binary scan results into a unified report.
 */
export function summarizeIntegrityIssues(
  tracks: LocalTrack[],
  deepResults: Record<string, TrackIntegrityScanResult> = {}
): IntegritySummary {
  const reports: TrackIntegrityReport[] = [];
  let headerIssueCount = 0;
  let durationIssueCount = 0;
  let autoFixableCount = 0;
  let deepScannedCount = 0;
  const corruptUnrecoverableIds: string[] = [];

  for (const track of tracks) {
    const metaIssues = evaluateTrackMetadataIntegrity(track);
    const deep = deepResults[track.id];
    if (deep?.blobAvailable) {
      deepScannedCount += 1;
    }

    // Merge issues without duplicating codes
    const seenCodes = new Set<IntegrityIssueCode>();
    const combined: IntegrityIssue[] = [];

    for (const issue of deep?.issues ?? []) {
      if (!seenCodes.has(issue.code)) {
        seenCodes.add(issue.code);
        combined.push(issue);
      }
    }
    for (const issue of metaIssues) {
      // If deep probe already confirmed an accurate duration that differs only by duration-mismatch, avoid redundant warning
      if (issue.code === 'implausible-duration' && seenCodes.has('duration-mismatch')) continue;
      if (!seenCodes.has(issue.code)) {
        seenCodes.add(issue.code);
        combined.push(issue);
      }
    }

    if (combined.length === 0) continue;

    const hasHeaderIssue = combined.some((i) => HEADER_ISSUE_CODES.has(i.code));
    const hasDurationIssue = combined.some((i) => DURATION_ISSUE_CODES.has(i.code));
    const hasError = combined.some((i) => i.severity === 'error');

    const suggestedDuration =
      deep?.probedDuration &&
      deep.probedDuration > 0 &&
      (track.duration <= 0 || Math.abs(track.duration - deep.probedDuration) >= 5)
        ? deep.probedDuration
        : null;

    const suggestedFormat =
      deep?.suggestedFormat && deep.suggestedFormat !== track.format.toUpperCase()
        ? deep.suggestedFormat
        : null;

    const canAutoFix = Boolean(suggestedDuration || suggestedFormat);

    if (hasHeaderIssue) headerIssueCount += 1;
    if (hasDurationIssue) durationIssueCount += 1;
    if (canAutoFix) autoFixableCount += 1;
    if (
      combined.some(
        (i) =>
          i.code === 'corrupt-header' ||
          i.code === 'unplayable-stream' ||
          i.code === 'empty-or-truncated'
      )
    ) {
      corruptUnrecoverableIds.push(track.id);
    }

    reports.push({
      track,
      issues: combined,
      hasHeaderIssue,
      hasDurationIssue,
      hasError,
      deepScanned: Boolean(deep),
      blobAvailable: deep ? deep.blobAvailable : null,
      detectedContainer: deep?.detectedContainer ?? null,
      suggestedDuration,
      suggestedFormat,
      canAutoFix,
    });
  }

  // Sort errors before warnings, then header issues before duration issues
  reports.sort((a, b) => {
    if (a.hasError !== b.hasError) return a.hasError ? -1 : 1;
    if (a.hasHeaderIssue !== b.hasHeaderIssue) return a.hasHeaderIssue ? -1 : 1;
    return a.track.title.localeCompare(b.track.title);
  });

  return {
    totalFlagged: reports.length,
    headerIssueCount,
    durationIssueCount,
    autoFixableCount,
    deepScannedCount,
    corruptUnrecoverableIds,
    reports,
  };
}
