import type { ServerResponse } from 'node:http';
import {
  handleMetaWebhookGet,
  handleMetaWebhookPost,
  sendJson,
  sendPlainText,
  type NodeApiRequest,
} from '../../server/apiCore.js';

// Disable Vercel's default body parser so the exact raw request bytes
// are preserved for Meta's X-Hub-Signature-256 HMAC-SHA256 verification.
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: NodeApiRequest,
  res: ServerResponse
): Promise<void> {
  try {
    if (req.method === 'GET') {
      handleMetaWebhookGet(req, res);
      return;
    }

    if (req.method === 'POST') {
      await handleMetaWebhookPost(req, res);
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    sendPlainText(res, 405, 'Method Not Allowed');
  } catch (err) {
    console.error('Unhandled /api/webhooks/meta error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Internal webhook error.' });
    }
  }
}
