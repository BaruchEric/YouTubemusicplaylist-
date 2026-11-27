/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { DriveApiError, downloadDriveFileRange, type DriveFetch } from '../src/utils/googleDriveApi';

interface Call {
  url: string;
  range: string | null;
  authorization: string | null;
  signal: AbortSignal | null;
}

/** A fetch that records each request and answers with what the test hands it. */
function fakeFetch(reply: () => Response): { fetch: DriveFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: DriveFetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      range: headers.get('Range'),
      authorization: headers.get('Authorization'),
      signal: init?.signal ?? null,
    });
    return reply();
  };
  return { fetch: fetchImpl, calls };
}

function bytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = i % 251;
  return out;
}

async function failureOf(run: () => Promise<unknown>): Promise<DriveApiError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof DriveApiError) return err;
    throw err;
  }
  throw new Error('expected the call to fail');
}

describe('downloadDriveFileRange', () => {
  test('asks Drive for the bytes from start up to, not including, end', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(bytes(100).subarray(10, 60), { status: 206 }));

    const buffer = await downloadDriveFileRange('tok', 'file/1', 10, 60, fetch);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://www.googleapis.com/drive/v3/files/file%2F1?alt=media');
    expect(calls[0].range).toBe('bytes=10-59');
    expect(calls[0].authorization).toBe('Bearer tok');
    expect(new Uint8Array(buffer)).toEqual(bytes(100).subarray(10, 60));
  });

  test('cuts the range out of the body when Drive answers 200 with the whole file', async () => {
    const { fetch } = fakeFetch(() => new Response(bytes(100), { status: 200 }));

    const buffer = await downloadDriveFileRange('tok', 'f', 10, 60, fetch);

    expect(new Uint8Array(buffer)).toEqual(bytes(100).subarray(10, 60));
  });

  test('returns what the file has when the range runs past its end', async () => {
    const { fetch } = fakeFetch(() => new Response(bytes(40), { status: 206 }));

    const buffer = await downloadDriveFileRange('tok', 'f', 0, 1000, fetch);

    expect(buffer.byteLength).toBe(40);
  });

  test('returns no bytes, and asks for none, when the range is empty', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 500 }));

    const buffer = await downloadDriveFileRange('tok', 'f', 50, 50, fetch);

    expect(buffer.byteLength).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test('returns no bytes when the range starts past the end of the file', async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 416 }));

    const buffer = await downloadDriveFileRange('tok', 'f', 5000, 6000, fetch);

    expect(buffer.byteLength).toBe(0);
  });

  test('reports a Drive error with its status and reason', async () => {
    const { fetch } = fakeFetch(() =>
      Response.json(
        { error: { code: 403, message: 'Slow down', errors: [{ reason: 'userRateLimitExceeded' }] } },
        { status: 403 }
      )
    );

    const err = await failureOf(() => downloadDriveFileRange('tok', 'f', 0, 10, fetch));

    expect(err.status).toBe(403);
    expect(err.reason).toBe('userRateLimitExceeded');
    expect(err.isRateLimit).toBe(true);
    expect(err.message).toBe('Slow down');
  });

  test('reports an expired session as an auth error', async () => {
    const { fetch } = fakeFetch(() => new Response('nope', { status: 401 }));

    const err = await failureOf(() => downloadDriveFileRange('tok', 'f', 0, 10, fetch));

    expect(err.status).toBe(401);
    expect(err.isAuthError).toBe(true);
  });

  test('hands the abort signal to fetch', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(bytes(10), { status: 206 }));
    const controller = new AbortController();

    await downloadDriveFileRange('tok', 'f', 0, 10, fetch, controller.signal);

    expect(calls[0].signal).toBe(controller.signal);
  });
});
