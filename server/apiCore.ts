import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getFirebaseRuntimeConfig } from './firebaseConfig.js';
import { verifyMetaSignature, type MetaMessagingEvent } from './webhookSafeguards.js';
import { resolveWorkspaceIdForUser } from '../src/services/firebaseBlueprint.js';
import type { BackendHealthStatus, Message } from '../src/types/paperflow.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB hard cap

export interface NodeApiRequest extends IncomingMessage {
  rawBody?: Buffer;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

export function getIntegrationReadiness(): BackendHealthStatus {
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
    metaWebhookSignatureReady: Boolean(
      process.env.META_APP_SECRET && process.env.META_VERIFY_TOKEN
    ),
    metaMissingEnvVars: missingMeta,
    firebaseConfigured: Boolean(fbConfig),
    firebaseProjectId: fbConfig?.projectId ?? null,
    firestoreDatabaseId: fbConfig?.firestoreDatabaseId ?? null,
    serverTimestamp: new Date().toISOString(),
  };
}

export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

export function sendPlainText(res: ServerResponse, statusCode: number, text: string): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(text);
}

export function getQueryParam(req: NodeApiRequest, key: string): string {
  if (req.query && key in req.query) {
    const val = req.query[key];
    if (Array.isArray(val)) return String(val[0] ?? '');
    if (val !== undefined) return String(val);
  }
  if (req.url) {
    const parsedUrl = new URL(req.url, 'http://localhost');
    return parsedUrl.searchParams.get(key) ?? '';
  }
  return '';
}

export async function readRawRequestBody(req: NodeApiRequest): Promise<Buffer> {
  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody;
  }

  if (!req.readableEnded) {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      req.on('data', (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.length;
        if (totalBytes > MAX_BODY_BYTES) {
          reject(new Error('PAYLOAD_TOO_LARGE'));
          req.destroy();
          return;
        }
        chunks.push(buf);
      });

      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', (err) => reject(err));
    });
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    return Buffer.from(req.body, 'utf8');
  }
  if (req.body && typeof req.body === 'object') {
    return Buffer.from(JSON.stringify(req.body), 'utf8');
  }
  return Buffer.alloc(0);
}

export function getHeaderValue(req: IncomingMessage, name: string): string | undefined {
  const val = req.headers[name.toLowerCase()];
  if (Array.isArray(val)) return val[0];
  return val;
}

/**
 * Constant-time Meta webhook GET verification (`hub.mode`, `hub.verify_token`, `hub.challenge`).
 * Publicly accessible without Firebase login so Meta can verify the callback URL.
 */
export function handleMetaWebhookGet(req: NodeApiRequest, res: ServerResponse): void {
  const verifyToken = process.env.META_VERIFY_TOKEN;
  if (!verifyToken) {
    sendPlainText(res, 501, 'META_VERIFY_TOKEN is not configured on the server.');
    return;
  }

  const mode = getQueryParam(req, 'hub.mode');
  const token = getQueryParam(req, 'hub.verify_token');
  const challenge = getQueryParam(req, 'hub.challenge');

  const expectedBuf = Buffer.from(verifyToken, 'utf8');
  const providedBuf = Buffer.from(token, 'utf8');
  const tokensMatch =
    expectedBuf.length === providedBuf.length &&
    crypto.timingSafeEqual(expectedBuf, providedBuf);

  if (mode === 'subscribe' && tokensMatch && challenge.length > 0 && challenge.length <= 256) {
    sendPlainText(res, 200, challenge);
    return;
  }

  sendPlainText(res, 403, 'Forbidden');
}

/**
 * Handles incoming Meta Messenger webhook POST events with raw-body HMAC-SHA256 verification.
 */
export async function handleMetaWebhookPost(
  req: NodeApiRequest,
  res: ServerResponse
): Promise<void> {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    sendJson(res, 501, {
      connected: false,
      error: 'META_APP_SECRET is not configured on the server.',
    });
    return;
  }

  let rawBody: Buffer;
  try {
    rawBody = await readRawRequestBody(req);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'Webhook payload exceeds size limit.' });
      return;
    }
    sendJson(res, 400, { error: 'Failed to read webhook request body.' });
    return;
  }

  const signature = getHeaderValue(req, 'x-hub-signature-256');
  if (!verifyMetaSignature(rawBody, signature, appSecret)) {
    sendJson(res, 401, { error: 'Invalid Meta webhook signature.' });
    return;
  }

  let payload: {
    object?: string;
    entry?: Array<{ messaging?: MetaMessagingEvent[] }>;
  };
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as typeof payload;
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON webhook payload.' });
    return;
  }

  if (payload.object !== 'page' || !Array.isArray(payload.entry)) {
    sendPlainText(res, 404, 'Not Found');
    return;
  }

  const results: Array<{ status: string; psid?: string }> = [];
  const hasMessagingEvents = payload.entry.some(
    (entry) => Array.isArray(entry.messaging) && entry.messaging.length > 0
  );

  if (hasMessagingEvents) {
    const { processIncomingMetaEvent } = await import('./metaMessenger.js');
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
  }

  sendJson(res, 200, { received: true, processed: results.length });
}

export interface VerifiedFirebaseUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
}

export async function authenticateFirebaseRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<VerifiedFirebaseUser | null> {
  const authHeader = getHeaderValue(req, 'authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendJson(res, 401, {
      error: 'Unauthorized',
      message: 'Missing Authorization Bearer Firebase ID token.',
    });
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    sendJson(res, 401, { error: 'Unauthorized', message: 'Empty Bearer token.' });
    return null;
  }

  try {
    const { verifyFirebaseBearerToken } = await import('./firebaseAdmin.js');
    const decoded = await verifyFirebaseBearerToken(token);
    if (!decoded.email_verified) {
      sendJson(res, 403, {
        error: 'Forbidden',
        message: 'Verified email address required for PaperFlow workspace access.',
      });
      return null;
    }
    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: Boolean(decoded.email_verified),
    };
  } catch (err) {
    console.error('Firebase auth verification error:', err);
    sendJson(res, 401, {
      error: 'Unauthorized',
      message: 'Invalid or expired Firebase ID token.',
    });
    return null;
  }
}

export async function handleMessengerSend(
  req: NodeApiRequest,
  res: ServerResponse
): Promise<void> {
  const firebaseUser = await authenticateFirebaseRequest(req, res);
  if (!firebaseUser) return;

  if (!process.env.META_PAGE_ACCESS_TOKEN) {
    sendJson(res, 501, {
      connected: false,
      error: 'Meta Send API is not configured. Set META_PAGE_ACCESS_TOKEN on the server.',
    });
    return;
  }

  let body: {
    workspaceId?: string;
    conversationId?: string;
    recipientPsid?: string;
    text?: string;
    senderName?: string;
  };

  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    body = req.body as typeof body;
  } else {
    try {
      const raw = await readRawRequestBody(req);
      body = JSON.parse(raw.toString('utf8')) as typeof body;
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON request body.' });
      return;
    }
  }

  const recipientPsid = body.recipientPsid?.trim();
  const text = body.text?.trim();
  const workspaceId = body.workspaceId?.trim();
  const conversationId = body.conversationId?.trim();

  if (!recipientPsid || !text || !workspaceId || !conversationId) {
    sendJson(res, 400, {
      error: 'Missing required fields: workspaceId, conversationId, recipientPsid, text.',
    });
    return;
  }

  // Enforce workspace authorization matching Firebase rules
  const allowedWorkspaceId = resolveWorkspaceIdForUser(firebaseUser.email, firebaseUser.uid);
  if (workspaceId !== allowedWorkspaceId) {
    sendJson(res, 403, {
      error: 'Forbidden',
      message: 'Not authorized to send messages for this workspace.',
    });
    return;
  }

  try {
    const [{ sendMetaMessengerMessage }, { getAdminFirestore }, { buildReplyMessageDoc, sanitizeFirestoreData }] =
      await Promise.all([
        import('./metaMessenger.js'),
        import('./firebaseAdmin.js'),
        import('./firestoreSanitizer.js'),
      ]);
    const sent = await sendMetaMessengerMessage({ recipientPsid, text });
    const nowIso = new Date().toISOString();
    const db = getAdminFirestore();
    const msgId = `msg_op_${Date.now()}`;
    const ownerUid = firebaseUser.uid;

    const msgFirestoreDoc = buildReplyMessageDoc({
      ownerUid,
      conversationId,
      externalMid: sent.messageId,
      sender: 'operator',
      senderName: body.senderName || firebaseUser.email || 'Studio Coordinator',
      text: text.slice(0, 4000),
      timestamp: nowIso,
      isSimulated: false,
    });

    const convRef = db
      .collection('workspaces')
      .doc(workspaceId)
      .collection('conversations')
      .doc(conversationId);

    await convRef.collection('messages').doc(msgId).set(msgFirestoreDoc);
    await convRef.update(
      sanitizeFirestoreData({
        unreadCount: 0,
        needsHumanHandoff: false,
        lastMessagePreview: text.slice(0, 500),
        lastMessageAt: nowIso,
      })
    );

    const responseMessage: Message = {
      id: msgId,
      ...msgFirestoreDoc,
    };

    sendJson(res, 200, {
      sent: true,
      externalMid: sent.messageId,
      message: responseMessage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send Messenger reply.';
    sendJson(res, 502, { error: message });
  }
}
