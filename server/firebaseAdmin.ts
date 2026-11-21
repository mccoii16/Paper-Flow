import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getFirebaseRuntimeConfig } from './firebaseConfig.js';

export { getFirebaseRuntimeConfig };

interface RawServiceAccountJson {
  project_id?: unknown;
  projectId?: unknown;
  client_email?: unknown;
  clientEmail?: unknown;
  private_key?: unknown;
  privateKey?: unknown;
}

/**
 * Strictly parses FIREBASE_SERVICE_ACCOUNT_JSON into a minimal ServiceAccount
 * containing only projectId, clientEmail, and privateKey.
 */
function parseServiceAccountFromEnv(fallbackProjectId: string): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;

  let parsed: RawServiceAccountJson;
  try {
    parsed = JSON.parse(raw) as RawServiceAccountJson;
  } catch {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON environment variable.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be a JSON object.');
  }

  const clientEmail =
    typeof parsed.client_email === 'string'
      ? parsed.client_email.trim()
      : typeof parsed.clientEmail === 'string'
      ? parsed.clientEmail.trim()
      : '';

  const rawPrivateKey =
    typeof parsed.private_key === 'string'
      ? parsed.private_key
      : typeof parsed.privateKey === 'string'
      ? parsed.privateKey
      : '';

  const privateKey = rawPrivateKey.includes('\n')
    ? rawPrivateKey
    : rawPrivateKey.replace(/\\n/g, '\n');

  const projectId =
    typeof parsed.project_id === 'string' && parsed.project_id.trim()
      ? parsed.project_id.trim()
      : typeof parsed.projectId === 'string' && parsed.projectId.trim()
      ? parsed.projectId.trim()
      : fallbackProjectId;

  if (!clientEmail || !privateKey) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is missing required client_email or private_key fields.'
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

function getOrInitAdminApp() {
  const config = getFirebaseRuntimeConfig();
  if (!config) {
    throw new Error('Firebase is not configured: missing valid firebase-applet-config.json');
  }
  if (getApps().length > 0) {
    return getApp();
  }
  const serviceAccount = parseServiceAccountFromEnv(config.projectId);
  if (serviceAccount) {
    return initializeApp({
      credential: cert(serviceAccount),
      projectId: config.projectId,
    });
  }
  return initializeApp({
    credential: applicationDefault(),
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
