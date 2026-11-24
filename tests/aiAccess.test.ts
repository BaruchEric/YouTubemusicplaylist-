/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import {
  createAiAccessGuard,
  verifyFirebaseIdToken,
  type AiAccessOptions,
} from '../server/aiAccess.ts';

const PROJECT = 'test-project';
let privateKey: CryptoKey;
let getKey: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  getKey = createLocalJWKSet({ keys: [jwk] });
});

interface TokenOverrides {
  aud?: string;
  iss?: string;
  sub?: string | null;
  provider?: string;
  email?: string;
  emailVerified?: boolean;
  expiresIn?: string | number;
}

async function makeToken(o: TokenOverrides = {}): Promise<string> {
  const jwt = new SignJWT({
    firebase: { sign_in_provider: o.provider ?? 'google.com' },
    ...(o.email ? { email: o.email, email_verified: o.emailVerified ?? true } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(o.iss ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience(o.aud ?? PROJECT)
    .setIssuedAt()
    .setExpirationTime(o.expiresIn ?? '1h');
  if (o.sub !== null) jwt.setSubject(o.sub ?? 'user-1');
  return jwt.sign(privateKey);
}

describe('verifyFirebaseIdToken', () => {
  test('accepts a Google sign-in token for this project', async () => {
    const caller = await verifyFirebaseIdToken(
      await makeToken({ email: 'Me@Example.com' }),
      PROJECT,
      getKey
    );
    expect(caller).toEqual({ uid: 'user-1', email: { address: 'me@example.com', verified: true } });
  });

  const rejected: Array<[string, TokenOverrides]> = [
    ['another project audience', { aud: 'other-project' }],
    ['another issuer', { iss: 'https://securetoken.google.com/other-project' }],
    ['an anonymous sign-in', { provider: 'anonymous' }],
    ['a missing subject', { sub: null }],
    ['an expired token', { expiresIn: Math.floor(Date.now() / 1000) - 120 }],
  ];
  for (const [name, overrides] of rejected) {
    test(`rejects ${name}`, async () => {
      const token = await makeToken(overrides);
      await expect(verifyFirebaseIdToken(token, PROJECT, getKey)).rejects.toThrow();
    });
  }

  test('rejects a token signed by a different key', async () => {
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({ firebase: { sign_in_provider: 'google.com' } })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(`https://securetoken.google.com/${PROJECT}`)
      .setAudience(PROJECT)
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(other.privateKey);
    await expect(verifyFirebaseIdToken(forged, PROJECT, getKey)).rejects.toThrow();
  });
});

describe('createAiAccessGuard', () => {
  const servers: Server[] = [];
  afterAll(() => {
    for (const s of servers) s.close();
  });

  async function startApp(
    options: Partial<AiAccessOptions>,
    handlerDelayMs = 0
  ): Promise<string> {
    const app = express();
    app.use('/api', createAiAccessGuard({ projectId: PROJECT, getKey, ...options }));
    app.post('/api/echo', (_req, res) => {
      setTimeout(() => res.json({ ok: true }), handlerDelayMs);
    });
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/echo`;
  }

  function call(url: string, token?: string): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }

  test('turns away requests without a valid token', async () => {
    const url = await startApp({});
    expect((await call(url)).status).toBe(401);
    expect((await call(url, 'not-a-jwt')).status).toBe(401);
    expect((await call(url, await makeToken({ provider: 'anonymous' }))).status).toBe(401);
    const ok = await call(url, await makeToken());
    expect(ok.status).toBe(200);
  });

  test('a request from this machine still needs a token', async () => {
    // The guard used to wave loopback requests through in development. It no longer does.
    const url = await startApp({});
    expect((await call(url)).status).toBe(401);
  });

  test('answers 503 when no project id is configured', async () => {
    const url = await startApp({ projectId: null });
    expect((await call(url, await makeToken())).status).toBe(503);
  });

  test('applies the email allowlist to verified emails only', async () => {
    const url = await startApp({ allowedEmails: ['me@example.com'] });
    expect((await call(url, await makeToken({ email: 'me@example.com' }))).status).toBe(200);
    expect((await call(url, await makeToken({ email: 'someone@example.com' }))).status).toBe(403);
    expect(
      (await call(url, await makeToken({ email: 'me@example.com', emailVerified: false }))).status
    ).toBe(403);
    expect((await call(url, await makeToken())).status).toBe(403);
  });

  test('limits requests per window and sends Retry-After', async () => {
    let clock = 1_000_000;
    const url = await startApp({ maxRequestsPerWindow: 2, windowMs: 60_000, now: () => clock });
    const token = await makeToken();
    expect((await call(url, token)).status).toBe(200);
    expect((await call(url, token)).status).toBe(200);
    const limited = await call(url, token);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    // Another account has its own budget.
    expect((await call(url, await makeToken({ sub: 'user-2' }))).status).toBe(200);
    clock += 60_000;
    expect((await call(url, token)).status).toBe(200);
  });

  test('limits requests in flight per account', async () => {
    const url = await startApp({ maxConcurrent: 1 }, 150);
    const token = await makeToken();
    const first = call(url, token);
    await new Promise((r) => setTimeout(r, 30));
    const second = await call(url, token);
    expect(second.status).toBe(429);
    expect((await first).status).toBe(200);
    // The slot frees once the first response is sent.
    expect((await call(url, token)).status).toBe(200);
  });
});
