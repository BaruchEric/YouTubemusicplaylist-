import fs from 'node:fs';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

// Google publishes the keys that sign Firebase Auth ID tokens here, in JWK form.
const SECURETOKEN_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export const SIGN_IN_REQUIRED_MESSAGE =
  'Sign in with Google (Drive Sync & Transfer) to use AI lookups.';

export interface AiCaller {
  uid: string;
  /** Null when the token carries no email claim. */
  email: { address: string; verified: boolean } | null;
}

export interface AiAccessOptions {
  /** Firebase project id. Null turns the endpoints off with a 503. */
  projectId: string | null;
  /** Lowercase emails allowed to call the endpoints. Empty or absent allows any Google account. */
  allowedEmails?: string[];
  /** Key source for verifying tokens. Defaults to Google's published securetoken keys. */
  getKey?: JWTVerifyGetKey;
  /**
   * Let requests from this machine through without a token. Meant for the dev server only:
   * the Firebase project authorizes sign-in on the deployed domain, not on localhost, so a
   * local run cannot get a token. Token-bearing requests are still verified.
   */
  trustLoopback?: boolean;
  windowMs?: number;
  maxRequestsPerWindow?: number;
  maxConcurrent?: number;
  now?: () => number;
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * A browser talking straight to the dev server sends none of these. A proxy on the same host
 * (tailscale serve, Caddy, nginx, a hosted preview) adds one, and its requests arrive from
 * loopback, so a loopback peer only counts as this machine when they are all absent.
 */
function hasProxyHeaders(req: Request): boolean {
  return Boolean(req.get('x-forwarded-for') || req.get('forwarded') || req.get('x-real-ip'));
}

const LOCAL_DEV_CALLER: AiCaller = { uid: 'local-dev', email: null };

/**
 * Reads the Firebase project id from the same config file the client uses, so the server
 * and the browser can never disagree about which project's tokens count.
 */
export function readFirebaseProjectId(configPath: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: unknown };
    return typeof parsed.projectId === 'string' && parsed.projectId.trim()
      ? parsed.projectId.trim()
      : null;
  } catch {
    return null;
  }
}

export function parseEmailList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

let defaultKeySet: JWTVerifyGetKey | null = null;
function googleSecuretokenKeys(): JWTVerifyGetKey {
  defaultKeySet ??= createRemoteJWKSet(new URL(SECURETOKEN_JWKS_URL));
  return defaultKeySet;
}

/**
 * Verifies a Firebase Auth ID token the way the Admin SDK does: RS256 signature from Google's
 * keys, issuer and audience bound to this project, and a non-empty subject. Only Google
 * sign-ins pass, because an anonymous Firebase user would make the check meaningless.
 */
export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  getKey: JWTVerifyGetKey = googleSecuretokenKeys()
): Promise<AiCaller> {
  const { payload } = await jwtVerify(token, getKey, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    algorithms: ['RS256'],
    clockTolerance: 30,
    requiredClaims: ['sub', 'iat', 'exp'],
  });

  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) {
    throw new Error('Token has no valid subject.');
  }
  const firebaseClaim = payload.firebase as { sign_in_provider?: unknown } | undefined;
  if (firebaseClaim?.sign_in_provider !== 'google.com') {
    throw new Error('Token is not from a Google sign-in.');
  }

  return {
    uid: payload.sub,
    email:
      typeof payload.email === 'string' && payload.email
        ? { address: payload.email.toLowerCase(), verified: payload.email_verified === true }
        : null,
  };
}

interface CallerUsage {
  windowStart: number;
  count: number;
  inFlight: number;
}

/**
 * Express middleware for the Gemini endpoints. It requires a Firebase ID token from a Google
 * sign-in (or, with trustLoopback, a connection from this machine), applies the optional email
 * allowlist, and limits each account to a request budget per window plus a small number of
 * requests in flight.
 *
 * The default budget (240 per 10 minutes, 2 at once) sits well above what the app's own
 * sequential batch loops send: a 20,000-song deep genre run is about 400 requests over half
 * an hour. It exists to stop scripted abuse, not to slow down normal use.
 */
export function createAiAccessGuard(options: AiAccessOptions): RequestHandler {
  const windowMs = options.windowMs ?? 10 * 60 * 1000;
  const maxRequests = options.maxRequestsPerWindow ?? 240;
  const maxConcurrent = options.maxConcurrent ?? 2;
  const now = options.now ?? Date.now;
  const allowed = new Set(options.allowedEmails ?? []);
  const usage = new Map<string, CallerUsage>();

  function pruneUsage(at: number) {
    if (usage.size < 1000) return;
    for (const [uid, u] of usage) {
      if (u.inFlight === 0 && at - u.windowStart >= windowMs) usage.delete(uid);
    }
  }

  async function identify(req: Request, res: Response): Promise<AiCaller | null> {
    const header = req.get('authorization') ?? '';
    const match = header.match(/^Bearer\s+(\S+)$/i);
    // req.socket is the TCP peer, which a client cannot fake the way it can fake X-Forwarded-For.
    if (
      !match &&
      options.trustLoopback &&
      isLoopbackAddress(req.socket.remoteAddress) &&
      !hasProxyHeaders(req)
    ) {
      return LOCAL_DEV_CALLER;
    }

    if (!options.projectId) {
      res.status(503).json({
        error: 'AI lookups are off: firebase-applet-config.json has no projectId to verify sign-ins against.',
      });
      return null;
    }
    if (!match) {
      res.status(401).json({ error: SIGN_IN_REQUIRED_MESSAGE });
      return null;
    }

    let caller: AiCaller;
    try {
      caller = await verifyFirebaseIdToken(match[1], options.projectId, options.getKey);
    } catch {
      res.status(401).json({ error: SIGN_IN_REQUIRED_MESSAGE });
      return null;
    }

    if (allowed.size > 0 && !(caller.email?.verified && allowed.has(caller.email.address))) {
      res.status(403).json({
        error: 'This Google account is not on the AI lookup allowlist for this server.',
      });
      return null;
    }
    return caller;
  }

  async function guard(req: Request, res: Response, next: NextFunction): Promise<void> {
    const caller = await identify(req, res);
    if (!caller) return;

    const at = now();
    pruneUsage(at);
    let entry = usage.get(caller.uid);
    if (!entry || at - entry.windowStart >= windowMs) {
      entry = { windowStart: at, count: 0, inFlight: entry?.inFlight ?? 0 };
      usage.set(caller.uid, entry);
    }

    if (entry.inFlight >= maxConcurrent) {
      res.setHeader('Retry-After', '5');
      res.status(429).json({ error: 'Too many AI lookups running at once. Wait for one to finish.' });
      return;
    }
    if (entry.count >= maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.windowStart + windowMs - at) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: `AI lookup limit reached (${maxRequests} requests per ${Math.round(windowMs / 60000)} minutes). Try again in ${retryAfterSec} seconds.`,
      });
      return;
    }

    entry.count += 1;
    entry.inFlight += 1;
    const tracked = entry;
    let released = false;
    // 'close' fires once the response is sent or the client goes away, whichever comes first.
    res.on('close', () => {
      if (released) return;
      released = true;
      tracked.inFlight = Math.max(0, tracked.inFlight - 1);
    });

    next();
  }

  return (req, res, next) => {
    guard(req, res, next).catch(next);
  };
}
