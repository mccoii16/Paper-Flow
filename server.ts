import dotenv from 'dotenv';
import crypto from 'node:crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  getAdminFirestore,
  getFirebaseRuntimeConfig,
  verifyFirebaseBearerToken,
} from './server/firebaseAdmin';
import { processIncomingMetaEvent, sendMetaMessengerMessage } from './server/metaMessenger';
import { verifyMetaSignature, type MetaMessagingEvent } from './server/webhookSafeguards';
import type { BackendHealthStatus, Message } from './src/types/paperflow';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

interface AuthenticatedRequest extends Request {
  rawBody?: Buffer;
  firebaseUser?: {
    uid: string;
    email?: string;
    emailVerified?: boolean;
  };
}

function getIntegrationReadiness(): BackendHealthStatus {
  const missingMeta: string[] = [];
  if (!process.env.META_APP_ID) missingMeta.push('META_APP_ID');
  if (!process.env.META_APP_SECRET) missingMeta.push('META_APP_SECRET');
  if (!process.env.META_PAGE_ACCESS_TOKEN) missingMeta.push('META_PAGE_ACCESS_TOKEN');
  if (!process.env.META_VERIFY_TOKEN) missingMeta.push('META_VERIFY_TOKEN');

  const fbConfig = getFirebaseRuntimeConfig();

  return {
    status: 'ok',
    mode: fbConfig ? 'production-ready' : 'demo',
    metaConnected: missingMeta.length === 0,
    metaSendApiReady: Boolean(process.env.META_PAGE_ACCESS_TOKEN),
    metaWebhookSignatureReady: Boolean(process.env.META_APP_SECRET && process.env.META_VERIFY_TOKEN),
    metaMissingEnvVars: missingMeta,
    firebaseConfigured: Boolean(fbConfig),
    firebaseProjectId: fbConfig?.projectId ?? null,
    firestoreDatabaseId: fbConfig?.firestoreDatabaseId ?? null,
    serverTimestamp: new Date().toISOString(),
  };
}

/**
 * Production authentication boundary using Firebase Admin SDK `verifyIdToken`.
 * Rejects any request without a valid, verified Firebase ID token.
 */
async function requireFirebaseAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing Authorization Bearer Firebase ID token.',
    });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Unauthorized', message: 'Empty Bearer token.' });
    return;
  }

  try {
    const decoded = await verifyFirebaseBearerToken(token);
    if (!decoded.email_verified) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Verified email address required for PaperFlow workspace access.',
      });
      return;
    }
    req.firebaseUser = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified,
    };
    next();
  } catch {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired Firebase ID token.',
    });
  }
}

async function startServer() {
  const app = express();

  // Preserve raw body Buffer specifically for Meta X-Hub-Signature-256 verification
  app.use(
    express.json({
      limit: '2mb',
      verify: (req: AuthenticatedRequest, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // Public health & non-secret integration readiness endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json(getIntegrationReadiness());
  });

  // Firebase Auth session verification endpoint
  app.get('/api/auth/session', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({
      authenticated: true,
      provider: 'firebase-admin-verified',
      uid: req.firebaseUser?.uid ?? null,
      email: req.firebaseUser?.email ?? null,
    });
  });

  // Protected manual outbound Messenger reply endpoint
  app.post('/api/messenger/send', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (!process.env.META_PAGE_ACCESS_TOKEN) {
      res.status(501).json({
        connected: false,
        error: 'Meta Send API is not configured. Set META_PAGE_ACCESS_TOKEN on the server.',
      });
      return;
    }

    const body = req.body as {
      workspaceId?: string;
      conversationId?: string;
      recipientPsid?: string;
      text?: string;
      senderName?: string;
    };

    const recipientPsid = body.recipientPsid?.trim();
    const text = body.text?.trim();
    const workspaceId = body.workspaceId?.trim();
    const conversationId = body.conversationId?.trim();

    if (!recipientPsid || !text || !workspaceId || !conversationId) {
      res.status(400).json({
        error: 'Missing required fields: workspaceId, conversationId, recipientPsid, text.',
      });
      return;
    }

    try {
      const sent = await sendMetaMessengerMessage({ recipientPsid, text });
      const nowIso = new Date().toISOString();
      const db = getAdminFirestore();
      const msgId = `msg_op_${Date.now()}`;
      const ownerUid = req.firebaseUser?.uid || 'studio-admin';

      const msgDoc: Message = {
        id: msgId,
        ownerUid,
        conversationId,
        externalMid: sent.messageId,
        sender: 'operator',
        senderName: body.senderName || req.firebaseUser?.email || 'Studio Coordinator',
        text,
        timestamp: nowIso,
        isSimulated: false,
      };

      const convRef = db
        .collection('workspaces')
        .doc(workspaceId)
        .collection('conversations')
        .doc(conversationId);

      await convRef.collection('messages').doc(msgId).set(msgDoc);
      await convRef.update({
        unreadCount: 0,
        needsHumanHandoff: false,
        lastMessagePreview: text.slice(0, 500),
        lastMessageAt: nowIso,
      });

      res.json({
        sent: true,
        externalMid: sent.messageId,
        message: msgDoc,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send Messenger reply.';
      res.status(502).json({ error: message });
    }
  });

  // Meta Messenger Webhook Verification (GET)
  app.get('/api/webhooks/meta', (req: Request, res: Response) => {
    const verifyToken = process.env.META_VERIFY_TOKEN;
    if (!verifyToken) {
      res.status(501).json({
        connected: false,
        error: 'Meta webhook verify token is not configured on the server.',
      });
      return;
    }

    const mode = String(req.query['hub.mode'] ?? '');
    const token = String(req.query['hub.verify_token'] ?? '');
    const challenge = String(req.query['hub.challenge'] ?? '');

    const expectedBuf = Buffer.from(verifyToken);
    const providedBuf = Buffer.from(token);
    const tokensMatch =
      expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf);

    if (mode === 'subscribe' && tokensMatch) {
      res.status(200).send(challenge);
      return;
    }

    res.sendStatus(403);
  });

  // Meta Messenger Webhook Event Receiver (POST)
  app.post('/api/webhooks/meta', async (req: AuthenticatedRequest, res: Response) => {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
      res.status(501).json({
        connected: false,
        error: 'META_APP_SECRET is not configured on the server.',
      });
      return;
    }

    const signature = req.header('x-hub-signature-256');
    const rawBody = req.rawBody ?? Buffer.from('');

    if (!verifyMetaSignature(rawBody, signature, appSecret)) {
      res.status(401).json({ error: 'Invalid Meta webhook signature.' });
      return;
    }

    const payload = req.body as {
      object?: string;
      entry?: Array<{ messaging?: MetaMessagingEvent[] }>;
    };

    if (payload.object !== 'page' || !Array.isArray(payload.entry)) {
      res.sendStatus(404);
      return;
    }

    // Acknowledge Meta promptly after validating signature, while safely recording events
    const results: Array<{ status: string; psid?: string }> = [];
    for (const entry of payload.entry) {
      if (!Array.isArray(entry.messaging)) continue;
      for (const event of entry.messaging) {
        try {
          const outcome = await processIncomingMetaEvent(event);
          results.push(outcome);
        } catch (err) {
          console.error('Meta webhook event processing error:', err);
        }
      }
    }

    res.status(200).json({ received: true, processed: results.length });
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
