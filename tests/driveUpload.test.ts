/// <reference types="bun" />
import { afterEach, describe, expect, test } from 'bun:test';
import {
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
  syncCanonicalManifestToDrive,
  uploadAudioFileToDrive,
  buildLibraryBackupPayload,
} from '../src/utils/googleDriveApi';

interface Call {
  method: string;
  url: string;
  headers: Headers;
  bodySize: number;
}

interface FakeDriveOptions {
  /** Hide Location on the session response, as a CORS-filtered response would. */
  hideLocation?: boolean;
  /** Bytes the first content PUT delivers before the connection drops. */
  dropFirstPutAfter?: number;
  /** Status of the first content PUT, e.g. 503, after storing nothing. */
  failFirstPutWith?: number;
  /** Leave Range off the 308 status reply, as a CORS-filtered response would. */
  hideRange?: boolean;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * A stand-in for Drive's upload endpoint that speaks the resumable protocol: session start,
 * content PUT, status query with Content-Range "bytes *\/N", and 308 + Range replies.
 */
function installFakeDrive(opts: FakeDriveOptions = {}) {
  const calls: Call[] = [];
  const sessions = new Map<string, { size: number; received: number }>();
  let contentPuts = 0;
  let nextSession = 1;

  const fake = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const body = init.body instanceof Blob ? init.body : null;
    calls.push({ method, url, headers, bodySize: body?.size ?? 0 });
    const parsed = new URL(url);

    if (parsed.searchParams.get('uploadType') === 'multipart') {
      return Response.json({ id: 'file-multipart', name: 'x', modifiedTime: '2026-11-23T00:00:00Z' });
    }

    const uploadId = parsed.searchParams.get('upload_id');
    if (!uploadId) {
      // Session start.
      const id = `s${nextSession++}`;
      sessions.set(id, { size: Number(headers.get('X-Upload-Content-Length')), received: 0 });
      const sessionUrl = `${url}&upload_id=${id}`;
      return new Response(null, {
        status: 200,
        headers: opts.hideLocation
          ? { 'X-GUploader-UploadID': id }
          : { Location: sessionUrl, 'X-GUploader-UploadID': id },
      });
    }

    const session = sessions.get(uploadId);
    if (!session) return new Response(null, { status: 404 });
    const range = headers.get('Content-Range');

    if (range?.startsWith('bytes */')) {
      if (session.received >= session.size) {
        return Response.json({ id: `file-${uploadId}`, name: 'x', modifiedTime: '2026-11-23T00:00:00Z' });
      }
      return new Response(null, {
        status: 308,
        headers:
          session.received > 0 && !opts.hideRange ? { Range: `bytes=0-${session.received - 1}` } : {},
      });
    }

    contentPuts += 1;
    const start = range ? Number(range.match(/^bytes (\d+)-/)?.[1]) : 0;
    if (start !== session.received) return new Response('bad offset', { status: 400 });

    if (contentPuts === 1 && opts.failFirstPutWith) {
      return new Response(null, { status: opts.failFirstPutWith });
    }
    if (contentPuts === 1 && opts.dropFirstPutAfter !== undefined) {
      session.received += opts.dropFirstPutAfter;
      throw new TypeError('Failed to fetch');
    }
    session.received += body?.size ?? 0;
    if (session.received !== session.size) return new Response('short', { status: 400 });
    return Response.json({ id: `file-${uploadId}`, name: 'x', modifiedTime: '2026-11-23T00:00:00Z' });
  };
  globalThis.fetch = fake as typeof fetch;
  return { calls };
}

const BIG = RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1024 * 1024;
const bigAudio = () => new Blob([new Uint8Array(BIG)], { type: 'audio/flac' });

describe('uploadAudioFileToDrive', () => {
  test('sends files up to 5 MB as one multipart request', async () => {
    const { calls } = installFakeDrive();
    const file = await uploadAudioFileToDrive('tok', new Blob([new Uint8Array(1000)], { type: 'audio/mpeg' }), 'a.mp3');
    expect(file.id).toBe('file-multipart');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('uploadType=multipart');
  });

  test('sends larger files as a resumable upload', async () => {
    const { calls } = installFakeDrive();
    const file = await uploadAudioFileToDrive('tok', bigAudio(), 'big.flac', {
      folderId: 'folder-1',
      trackId: 't1',
    });
    expect(file.id).toBe('file-s1');
    const [init, put] = calls;
    expect(init.method).toBe('POST');
    expect(init.url).toContain('uploadType=resumable');
    expect(init.headers.get('Authorization')).toBe('Bearer tok');
    expect(init.headers.get('X-Upload-Content-Type')).toBe('audio/flac');
    expect(init.headers.get('X-Upload-Content-Length')).toBe(String(BIG));
    expect(put.method).toBe('PUT');
    expect(put.bodySize).toBe(BIG);
    expect(calls).toHaveLength(2);
  });

  test('rebuilds the session URL from the upload id when Location is hidden', async () => {
    const { calls } = installFakeDrive({ hideLocation: true });
    const file = await uploadAudioFileToDrive('tok', bigAudio(), 'big.flac');
    expect(file.id).toBe('file-s1');
    expect(calls[1].url).toContain('upload_id=s1');
  });

  test('resumes after a dropped connection from the byte the session reports', async () => {
    const { calls } = installFakeDrive({ dropFirstPutAfter: 2 * 1024 * 1024 });
    const file = await uploadAudioFileToDrive('tok', bigAudio(), 'big.flac');
    expect(file.id).toBe('file-s1');
    const status = calls.find((c) => c.headers.get('Content-Range')?.startsWith('bytes */'));
    expect(status?.headers.get('Content-Range')).toBe(`bytes */${BIG}`);
    const resumed = calls[calls.length - 1];
    expect(resumed.headers.get('Content-Range')).toBe(`bytes ${2 * 1024 * 1024}-${BIG - 1}/${BIG}`);
    expect(resumed.bodySize).toBe(BIG - 2 * 1024 * 1024);
  });

  test('starts a fresh session when the stored byte count cannot be read', async () => {
    const { calls } = installFakeDrive({ dropFirstPutAfter: 1024, hideRange: true });
    const file = await uploadAudioFileToDrive('tok', bigAudio(), 'big.flac');
    expect(file.id).toBe('file-s2');
    expect(calls.filter((c) => !new URL(c.url).searchParams.get('upload_id'))).toHaveLength(2);
  });

  test('retries a 503 from the upload server', async () => {
    installFakeDrive({ failFirstPutWith: 503 });
    const file = await uploadAudioFileToDrive('tok', bigAudio(), 'big.flac');
    expect(file.id).toBe('file-s2');
  });
});

describe('syncCanonicalManifestToDrive', () => {
  test('updates a large manifest in place with a resumable PATCH', async () => {
    const { calls } = installFakeDrive();
    const payload = buildLibraryBackupPayload({
      tracks: [],
      playlists: [],
      smartPlaylists: [],
      syncHistory: [],
      watchedFolderName: 'x'.repeat(BIG),
    });
    await syncCanonicalManifestToDrive('tok', payload, { existingFileId: 'manifest-1' });
    const init = calls[0];
    expect(init.method).toBe('PATCH');
    expect(init.url).toContain('/files/manifest-1?uploadType=resumable');
    expect(init.headers.get('X-Upload-Content-Type')).toBe('application/json; charset=UTF-8');
  });
});
