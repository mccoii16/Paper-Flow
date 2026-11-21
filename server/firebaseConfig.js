import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let cachedConfig;
export function getFirebaseRuntimeConfig() {
    if (cachedConfig !== undefined) {
        return cachedConfig;
    }
    const candidates = [path.resolve(process.cwd(), 'firebase-applet-config.json')];
    try {
        const currentDir = path.dirname(fileURLToPath(import.meta.url));
        candidates.push(path.resolve(currentDir, '..', 'firebase-applet-config.json'));
    }
    catch {
        // Ignore when bundled into CJS or non-file URL
    }
    for (const configPath of candidates) {
        try {
            if (!fs.existsSync(configPath))
                continue;
            const raw = fs.readFileSync(configPath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed.projectId && parsed.projectId !== 'remixed-project-id') {
                cachedConfig = parsed;
                return cachedConfig;
            }
        }
        catch {
            // Try next candidate
        }
    }
    if (process.env.FIREBASE_PROJECT_ID) {
        cachedConfig = {
            projectId: process.env.FIREBASE_PROJECT_ID,
            firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID,
        };
        return cachedConfig;
    }
    cachedConfig = null;
    return cachedConfig;
}
