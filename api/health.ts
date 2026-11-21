import type { ServerResponse } from 'node:http';
import {
  getIntegrationReadiness,
  sendJson,
  sendPlainText,
  type NodeApiRequest,
} from '../server/apiCore.js';

export default function handler(req: NodeApiRequest, res: ServerResponse): void {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendPlainText(res, 405, 'Method Not Allowed');
      return;
    }

    sendJson(res, 200, getIntegrationReadiness());
  } catch (err) {
    console.error('Unhandled /api/health error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Health check failed.' });
    }
  }
}
