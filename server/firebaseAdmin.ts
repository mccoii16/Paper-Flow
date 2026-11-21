import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApp, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseAppletConfig(): FirebaseAppletConfig | null {
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
  ];

  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(currentDir, '..', 'firebase-applet-config.json'));
  } catch {
    // Ignore when bundled into CJS or non-file URL
  }

  for (const configPath of candidates) {
    try {
      if (!fs.existsSync(configPath)) continue;
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as FirebaseAppletConfig;
      if (parsed.projectId && parsed.projectId !== 'remixed-project-id') {
        return parsed;
      }
    } catch {
      // Try next candidate
    }
  }

  if (process.env.FIREBASE_PROJECT_ID) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID,
    };
  }

  return null;
}

const config = loadFirebaseAppletConfig();

function parseServiceAccountFromEnv(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    return parsed;
  } catch {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON environment variable.');
  }
}

function getOrInitAdminApp() {
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

export function getFirebaseRuntimeConfig(): FirebaseAppletConfig | null {
  return config;
}

export function getAdminFirestore(): Firestore {
  const app = getOrInitAdminApp();
  if (config?.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)') {
    return getFirestore(app, config.firestoreDatabaseId);
  }
  return getFirestore(app);
}

export async function verifyFirebaseBearerToken(idToken: string): Promise<DecodedIdToken> {
  const app = getOrInitAdminApp();
  const auth = getAuth(app);
  return auth.verifyIdToken(idToken);
}
