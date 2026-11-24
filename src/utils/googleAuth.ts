import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
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

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
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
  await signOut(auth);
}
