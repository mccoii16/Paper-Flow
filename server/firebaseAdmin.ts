import { cert, getApp, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getFirebaseRuntimeConfig } from './firebaseConfig.js';

export { getFirebaseRuntimeConfig };

function parseServiceAccountFromEnv(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount & { private_key?: string };
    if (typeof parsed.private_key === 'string' && !parsed.private_key.includes('\n')) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed;
  } catch {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON environment variable.');
  }
}

function getOrInitAdminApp() {
  const config = getFirebaseRuntimeConfig();
  if (!config) {
    throw new Error('Firebase is not configured: missing valid firebase-applet-config.json');
  }
  if (getApps().length > 0) {
    return getApp();
  }
  const serviceAccount = parseServiceAccountFromEnv();
  if (serviceAccount) {
    return initializeApp({
      credential: cert(serviceAccount),
      projectId: config.projectId,
    });
  }
  return initializeApp({
    projectId: config.projectId,
  });
}

export function getAdminFirestore(): Firestore {
  const config = getFirebaseRuntimeConfig();
  const app = getOrInitAdminApp();
  if (config?.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)') {
    return getFirestore(app, config.firestoreDatabaseId);
  }
  return getFirestore(app);
}

export async function verifyFirebaseBearerToken(idToken: string): Promise<DecodedIdToken> {
  const { getAuth } = await import('firebase-admin/auth');
  const app = getOrInitAdminApp();
  const auth = getAuth(app);
  return auth.verifyIdToken(idToken);
}
