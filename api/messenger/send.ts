import type { ServerResponse } from 'node:http';
import {
  handleMessengerSend,
  sendJson,
  sendPlainText,
  type NodeApiRequest,
} from '../../server/apiCore.js';

export default async function handler(
  req: NodeApiRequest,
  res: ServerResponse
): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendPlainText(res, 405, 'Method Not Allowed');
      return;
    }

    await handleMessengerSend(req, res);
  } catch (err) {
    console.error('Unhandled /api/messenger/send error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Messenger send failed.' });
    }
  }
}
