import fs from 'node:fs';
import path from 'node:path';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseAppletConfig(): FirebaseAppletConfig | null {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as FirebaseAppletConfig;
    if (!parsed.projectId || parsed.projectId === 'remixed-project-id') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const config = loadFirebaseAppletConfig();

function getOrInitAdminApp() {
  if (!config) {
    throw new Error('Firebase is not configured: missing valid firebase-applet-config.json');
  }
  if (getApps().length > 0) {
    return getApp();
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
