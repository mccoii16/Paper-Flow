import type { ServerResponse } from 'node:http';
import {
  getIntegrationReadiness,
  sendJson,
  sendPlainText,
  type NodeApiRequest,
} from '../server/apiCore';

export default function handler(req: NodeApiRequest, res: ServerResponse): void {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendPlainText(res, 405, 'Method Not Allowed');
    return;
  }

  sendJson(res, 200, getIntegrationReadiness());
}
