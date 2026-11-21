import type { ServerResponse } from 'node:http';
import {
  handleMetaWebhookGet,
  handleMetaWebhookPost,
  sendPlainText,
  type NodeApiRequest,
} from '../../server/apiCore';

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
}
