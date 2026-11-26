import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

/**
 * Exact provisioned Google Drive OAuth scopes (least privilege):
 * - drive.readonly: browse, search, and download existing playlist files & audio from Drive
 * - drive.file: create, update, and manage CrateSync library metadata backups & uploads in Drive
 */
export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
] as const;

/**
 * The YouTube scope "Connect YouTube" asks for. It lets CrateSync create playlists on the
 * user's YouTube account and add or remove their songs. The app asks for it only when the
 * user pushes a playlist, and never together with the Drive scopes.
 */
export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube';

/** Google access tokens last an hour. CrateSync stops using one ten minutes before that. */
const YOUTUBE_TOKEN_LIFETIME_MS = 50 * 60 * 1000;

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

/**
 * Firebase App Check: each Firebase Auth request carries a token showing it came from this
 * app, attested by the reCAPTCHA Enterprise site key in firebase-applet-config.json. It needs
 * a browser (reCAPTCHA loads a script), and it is skipped when the key is empty. Calling it
 * again with the same key, as a hot reload does, returns the instance already running.
 * The Firebase project enforces App Check for Authentication (since 2026-11-24), so without
 * this token Google sign-in fails with "Firebase App Check token is invalid".
 */
export const appCheck: AppCheck | null = startAppCheck(app, firebaseConfig.recaptchaSiteKey);

function startAppCheck(firebaseApp: FirebaseApp, siteKey: string): AppCheck | null {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !siteKey) return null;
  return initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);

// Strictly in-memory OAuth access token cache — never written to localStorage or sessionStorage.
let cachedAccessToken: string | null = null;
let tokenIssuedAt: number | null = null;
let isSigningIn = false;

export interface GoogleDriveAuthState {
  user: User | null;
  hasAccessToken: boolean;
  tokenIssuedAt: number | null;
}

/**
 * Returns a Firebase ID token for the signed-in Google user, or null when nobody is signed in.
 * The server's AI endpoints require it. Unlike the Drive access token it survives reloads,
 * because Firebase keeps the session; authStateReady waits for that session to load so a
 * fresh page does not look signed out for its first moment.
 */
export async function getFirebaseIdToken(): Promise<string | null> {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return null;
  return user.getIdToken();
}

export function getDriveAccessToken(): string | null {
  return cachedAccessToken;
}

export function getDriveTokenIssuedAt(): number | null {
  return tokenIssuedAt;
}

export function clearDriveAccessToken(): void {
  cachedAccessToken = null;
  tokenIssuedAt = null;
}

export function initGoogleAuth(
  callback: (state: GoogleDriveAuthState) => void
): () => void {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedAccessToken = null;
      tokenIssuedAt = null;
      callback({
        user: null,
        hasAccessToken: false,
        tokenIssuedAt: null,
      });
      return;
    }

    // Avoid firing a transient hasAccessToken=false while signInWithPopup is completing
    if (isSigningIn && !cachedAccessToken) {
      return;
    }

    callback({
      user,
      hasAccessToken: Boolean(cachedAccessToken),
      tokenIssuedAt: cachedAccessToken ? tokenIssuedAt : null,
    });
  });
}

export async function signInWithGoogleDrive(): Promise<{
  user: User;
  accessToken: string;
}> {
  const provider = new GoogleAuthProvider();
  for (const scope of GOOGLE_DRIVE_SCOPES) {
    provider.addScope(scope);
  }

  // When reconnecting an already-signed-in user, pass login_hint so Google skips re-prompting full consent
  const existingEmail = auth.currentUser?.email;
  if (existingEmail) {
    provider.setCustomParameters({
      login_hint: existingEmail,
    });
  } else {
    provider.setCustomParameters({
      prompt: 'select_account',
    });
  }

  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken ?? null;

    if (!accessToken) {
      throw new Error(
        'Google sign-in succeeded, but no Google Drive access token was returned. Please try again.'
      );
    }

    cachedAccessToken = accessToken;
    tokenIssuedAt = Date.now();
    return { user: result.user, accessToken };
  } finally {
    isSigningIn = false;
  }
}

export async function signOutGoogleDrive(): Promise<void> {
  cachedAccessToken = null;
  tokenIssuedAt = null;
  youtubeToken = null;
  await signOut(auth);
}

// The YouTube access token, kept in memory only, like the Drive one.
let youtubeToken: { value: string; issuedAt: number } | null = null;

/** The YouTube access token while it is still fresh, or null when the user has to connect. */
export function getYouTubeAccessToken(now: number = Date.now()): string | null {
  if (!youtubeToken) return null;
  if (now - youtubeToken.issuedAt > YOUTUBE_TOKEN_LIFETIME_MS) {
    youtubeToken = null;
    return null;
  }
  return youtubeToken.value;
}

export function clearYouTubeAccessToken(): void {
  youtubeToken = null;
}

/**
 * Opens Google's popup and asks for the YouTube scope. Call it straight from a click, or the
 * browser blocks the popup.
 *
 * A user who is already signed in confirms with the same Google account: reauthenticate
 * refuses any other, so the Drive session and the AI sign-in keep pointing at one person.
 * With nobody signed in it is an ordinary Google sign-in.
 */
export async function connectYouTube(): Promise<string> {
  const provider = new GoogleAuthProvider();
  provider.addScope(YOUTUBE_SCOPE);

  const current = auth.currentUser;
  const signedIn = current && !current.isAnonymous ? current : null;
  if (signedIn?.email) {
    provider.setCustomParameters({ login_hint: signedIn.email });
  } else {
    provider.setCustomParameters({ prompt: 'select_account' });
  }

  const result = signedIn
    ? await reauthenticateWithPopup(signedIn, provider)
    : await signInWithPopup(auth, provider);
  const accessToken = GoogleAuthProvider.credentialFromResult(result)?.accessToken ?? null;
  if (!accessToken) {
    throw new Error('Google sign-in worked, but it returned no YouTube access. Please try again.');
  }

  youtubeToken = { value: accessToken, issuedAt: Date.now() };
  return accessToken;
}

/** A sentence for the person at the screen when "Connect YouTube" fails. */
export function describeYouTubeConnectError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string'
      ? err.code
      : '';
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'The Google window closed before YouTube was connected. Nothing was sent.';
    case 'auth/popup-blocked':
      return 'The browser blocked the Google window. Allow popups for this site and try again.';
    case 'auth/user-mismatch':
      return 'That is a different Google account from the one signed in here. Pick the same account, or sign out first under Drive Sync & Transfer.';
    case 'auth/unauthorized-domain':
      return 'Google does not accept sign-in from this address. Open CrateSync at an address its Firebase project lists.';
    case 'auth/network-request-failed':
      return 'CrateSync could not reach Google. Check the connection and try again.';
    default:
      return err instanceof Error && err.message
        ? err.message
        : 'Connecting YouTube failed. Please try again.';
  }
}
