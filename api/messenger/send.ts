import type { ServerResponse } from 'node:http';
import {
  handleMessengerSend,
  sendPlainText,
  type NodeApiRequest,
} from '../../server/apiCore';

export default async function handler(
  req: NodeApiRequest,
  res: ServerResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendPlainText(res, 405, 'Method Not Allowed');
    return;
  }

  await handleMessengerSend(req, res);
}
