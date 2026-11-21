import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import metaWebhookHandler, { config as metaWebhookConfig } from '../api/webhooks/meta';
import healthHandler from '../api/health';

async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>,
  fn: (baseUrl: string) => Promise<void>
) {
  const server = http.createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch((err) => {
      res.statusCode = 500;
      res.end(String(err));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

test('Vercel /api/webhooks/meta disables default bodyParser to preserve raw HMAC bytes', () => {
  assert.equal(metaWebhookConfig.api.bodyParser, false);
});

test('GET /api/webhooks/meta returns 200 text/plain with exact challenge for valid verify token without Firebase auth', async () => {
  const prevToken = process.env.META_VERIFY_TOKEN;
  process.env.META_VERIFY_TOKEN = 'VALID_TOKEN';

  try {
    await withServer(metaWebhookHandler, async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=VALID_TOKEN&hub.challenge=123456`
      );
      const body = await res.text();
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /^text\/plain\b/i);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(body, '123456');
    });
  } finally {
    if (prevToken === undefined) delete process.env.META_VERIFY_TOKEN;
    else process.env.META_VERIFY_TOKEN = prevToken;
  }
});

test('GET /api/webhooks/meta returns 403 for invalid verify token or non-subscribe mode', async () => {
  const prevToken = process.env.META_VERIFY_TOKEN;
  process.env.META_VERIFY_TOKEN = 'VALID_TOKEN';

  try {
    await withServer(metaWebhookHandler, async (baseUrl) => {
      const wrongToken = await fetch(
        `${baseUrl}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=WRONG_TOKEN&hub.challenge=123456`
      );
      assert.equal(wrongToken.status, 403);

      const wrongMode = await fetch(
        `${baseUrl}/api/webhooks/meta?hub.mode=unsubscribe&hub.verify_token=VALID_TOKEN&hub.challenge=123456`
      );
      assert.equal(wrongMode.status, 403);
    });
  } finally {
    if (prevToken === undefined) delete process.env.META_VERIFY_TOKEN;
    else process.env.META_VERIFY_TOKEN = prevToken;
  }
});

test('POST /api/webhooks/meta enforces X-Hub-Signature-256 HMAC verification on raw body', async () => {
  const prevSecret = process.env.META_APP_SECRET;
  process.env.META_APP_SECRET = 'paperflow_test_app_secret';

  try {
    await withServer(metaWebhookHandler, async (baseUrl) => {
      const rawJson = JSON.stringify({ object: 'page', entry: [] });
      const validSig = `sha256=${crypto
        .createHmac('sha256', process.env.META_APP_SECRET!)
        .update(Buffer.from(rawJson, 'utf8'))
        .digest('hex')}`;

      // Missing signature -> 401
      const missingRes = await fetch(`${baseUrl}/api/webhooks/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawJson,
      });
      assert.equal(missingRes.status, 401);

      // Valid signature -> 200
      const okRes = await fetch(`${baseUrl}/api/webhooks/meta`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': validSig,
        },
        body: rawJson,
      });
      assert.equal(okRes.status, 200);
      const parsed = (await okRes.json()) as { received: boolean; processed: number };
      assert.deepEqual(parsed, { received: true, processed: 0 });

      // Tampered payload with original signature -> 401
      const tamperedRes = await fetch(`${baseUrl}/api/webhooks/meta`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': validSig,
        },
        body: `${rawJson} `,
      });
      assert.equal(tamperedRes.status, 401);

      // Unsupported method -> 405
      const putRes = await fetch(`${baseUrl}/api/webhooks/meta`, { method: 'PUT' });
      assert.equal(putRes.status, 405);
      assert.equal(putRes.headers.get('allow'), 'GET, POST');
    });
  } finally {
    if (prevSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = prevSecret;
  }
});

test('GET /api/health returns 200 non-secret readiness JSON', async () => {
  await withServer(healthHandler, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.status, 'ok');
    assert.equal(json.firebaseProjectId, 'paperflow-46498');
    assert.equal('META_VERIFY_TOKEN' in json, false);
    assert.equal('META_APP_SECRET' in json, false);
  });
});

test('vercel.json SPA rewrite excludes /api/* endpoints and includes firebase-applet-config.json for functions', () => {
  const vercelJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8')
  ) as {
    functions?: Record<string, { includeFiles?: string }>;
    rewrites?: Array<{ source: string; destination: string }>;
  };

  assert.equal(
    vercelJson.functions?.['api/**/*.ts']?.includeFiles,
    'firebase-applet-config.json'
  );
  const spaRewrite = vercelJson.rewrites?.[0];
  assert.ok(spaRewrite, 'Missing SPA rewrite rule');
  assert.equal(spaRewrite.destination, '/index.html');

  const regex = new RegExp(`^${spaRewrite.source}$`);
  assert.equal(regex.test('/api/webhooks/meta'), false);
  assert.equal(regex.test('/api/health'), false);
  assert.equal(regex.test('/api/messenger/send'), false);
  assert.equal(regex.test('/api'), false);
  assert.equal(regex.test('/'), true);
  assert.equal(regex.test('/inbox'), true);
  assert.equal(regex.test('/settings'), true);
});
