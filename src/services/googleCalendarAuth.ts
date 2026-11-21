import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type Auth,
} from 'firebase/auth';
import calendarOAuthConfig from '../../firebase-oauth-config.json';

/**
 * Minimal read-only Google Calendar scopes synchronized with Workspace OAuth setup:
 * - calendar.calendarlist.readonly: list user's own and shared calendars
 * - calendar.events.readonly: read events from the selected calendar
 */
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
] as const;

const CALENDAR_AUTH_APP_NAME = 'paperflow-google-calendar-oauth';

let cachedCalendarApp: FirebaseApp | null = null;
let cachedCalendarAuth: Auth | null = null;

// Strictly in-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let cachedAccountEmail: string | null = null;
let isConnecting = false;

function getCalendarAuth(): Auth {
  if (cachedCalendarAuth) return cachedCalendarAuth;

  const existing = getApps().find((a) => a.name === CALENDAR_AUTH_APP_NAME);
  cachedCalendarApp =
    existing ?? initializeApp(calendarOAuthConfig, CALENDAR_AUTH_APP_NAME);
  cachedCalendarAuth = getAuth(cachedCalendarApp);

  onAuthStateChanged(cachedCalendarAuth, (user) => {
    if (!user && !isConnecting) {
      cachedAccessToken = null;
      cachedAccountEmail = null;
    }
  });

  return cachedCalendarAuth;
}

export function getCachedGoogleCalendarToken(): string | null {
  return cachedAccessToken;
}

export function getCachedGoogleCalendarAccountEmail(): string | null {
  return cachedAccountEmail;
}

export function clearGoogleCalendarToken(): void {
  cachedAccessToken = null;
  cachedAccountEmail = null;
}

export async function disconnectGoogleCalendar(): Promise<void> {
  clearGoogleCalendarToken();
  try {
    const calAuth = getCalendarAuth();
    if (calAuth.currentUser) {
      await firebaseSignOut(calAuth);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Prompts the user via Google Sign-In popup for read-only Google Calendar access
 * using the isolated secondary Firebase Auth app so the primary PaperFlow Firestore
 * session is never overwritten or signed out.
 */
export async function connectGoogleCalendar(): Promise<{
  accessToken: string;
  email: string;
}> {
  const calAuth = getCalendarAuth();
  const provider = new GoogleAuthProvider();
  for (const scope of GOOGLE_CALENDAR_SCOPES) {
    provider.addScope(scope);
  }
  provider.setCustomParameters({ prompt: 'select_account' });

  isConnecting = true;
  try {
    const result = await signInWithPopup(calAuth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Google Calendar access was not granted. Please try again and allow read-only calendar access.'
      );
    }
    cachedAccessToken = credential.accessToken;
    cachedAccountEmail = result.user.email || result.user.displayName || 'Connected Google Account';
    return {
      accessToken: cachedAccessToken,
      email: cachedAccountEmail,
    };
  } finally {
    isConnecting = false;
  }
}
