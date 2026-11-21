import dotenv from 'dotenv';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  authenticateFirebaseRequest,
  getIntegrationReadiness,
  handleMessengerSend,
  handleMetaWebhookGet,
  handleMetaWebhookPost,
  sendJson,
  type NodeApiRequest,
} from './server/apiCore.js';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

async function startServer() {
  const app = express();

  // Preserve raw body Buffer specifically for Meta X-Hub-Signature-256 verification
  app.use(
    express.json({
      limit: '2mb',
      verify: (req: RawBodyRequest, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // Public health & non-secret integration readiness endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    sendJson(res, 200, getIntegrationReadiness());
  });

  // Firebase Auth session verification endpoint
  app.get('/api/auth/session', async (req: Request, res: Response) => {
    const user = await authenticateFirebaseRequest(req, res);
    if (!user) return;
    sendJson(res, 200, {
      authenticated: true,
      provider: 'firebase-admin-verified',
      uid: user.uid,
      email: user.email ?? null,
    });
  });

  // Protected manual outbound Messenger reply endpoint
  app.post('/api/messenger/send', async (req: RawBodyRequest, res: Response) => {
    await handleMessengerSend(req as unknown as NodeApiRequest, res);
  });

  // Public Meta Messenger Webhook Verification (GET)
  app.get('/api/webhooks/meta', (req: Request, res: Response) => {
    handleMetaWebhookGet(req as unknown as NodeApiRequest, res);
  });

  // Public Meta Messenger Webhook Event Receiver (POST)
  app.post('/api/webhooks/meta', async (req: RawBodyRequest, res: Response) => {
    await handleMetaWebhookPost(req as unknown as NodeApiRequest, res);
  });

  if (!IS_PRODUCTION) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    const readiness = getIntegrationReadiness();
    console.log(
      `PaperFlow server running at http://localhost:${PORT} (Firebase=${readiness.firebaseProjectId ?? 'unconfigured'}, Meta=${readiness.metaConnected ? 'configured' : 'pending'})`
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start PaperFlow server:', err);
  process.exit(1);
});
