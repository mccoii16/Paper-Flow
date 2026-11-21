import type { ServerResponse } from 'node:http';
import {
  authenticateFirebaseRequest,
  sendJson,
  sendPlainText,
  type NodeApiRequest,
} from '../../server/apiCore.js';

export default async function handler(
  req: NodeApiRequest,
  res: ServerResponse
): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendPlainText(res, 405, 'Method Not Allowed');
      return;
    }

    const user = await authenticateFirebaseRequest(req, res);
    if (!user) return;

    sendJson(res, 200, {
      authenticated: true,
      provider: 'firebase-admin-verified',
      uid: user.uid,
      email: user.email ?? null,
    });
  } catch (err) {
    console.error('Unhandled /api/auth/session error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Session verification failed.' });
    }
  }
}
