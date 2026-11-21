import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  buildWebhookDedupKey,
  evaluateWebhookSafeguards,
  verifyMetaSignature,
} from './webhookSafeguards';

test('verifyMetaSignature accepts valid sha256 HMAC and rejects tampered body', () => {
  const secret = 'test_meta_app_secret_123';
  const payload = Buffer.from(JSON.stringify({ object: 'page', entry: [] }), 'utf8');
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');

  assert.equal(verifyMetaSignature(payload, sig, secret), true);
  assert.equal(verifyMetaSignature(Buffer.from('{"tampered":true}'), sig, secret), false);
  assert.equal(verifyMetaSignature(payload, 'sha256=deadbeef', secret), false);
  assert.equal(verifyMetaSignature(payload, undefined, secret), false);
});

test('evaluateWebhookSafeguards blocks echo and page-originated loops', () => {
  const echoResult = evaluateWebhookSafeguards({
    event: { sender: { id: 'psid-1' }, message: { mid: 'm1', text: 'hi', is_echo: true } },
    alreadyProcessed: false,
    conversationAiEnabled: true,
    needsHumanHandoff: false,
    nowMs: 100_000,
  });
  assert.equal(echoResult.allowProcess, false);
  assert.equal(echoResult.reason, 'echo_ignored');

  const pageSenderResult = evaluateWebhookSafeguards({
    event: { sender: { id: 'page-99' }, message: { mid: 'm2', text: 'hi' } },
    pageId: 'page-99',
    alreadyProcessed: false,
    conversationAiEnabled: true,
    needsHumanHandoff: false,
    nowMs: 100_000,
  });
  assert.equal(pageSenderResult.allowProcess, false);
  assert.equal(pageSenderResult.reason, 'page_sender_ignored');
});

test('evaluateWebhookSafeguards blocks duplicate webhook mid events', () => {
  const dup = evaluateWebhookSafeguards({
    event: { sender: { id: 'psid-1' }, message: { mid: 'm_dup_1', text: 'Price?' } },
    alreadyProcessed: true,
    conversationAiEnabled: true,
    needsHumanHandoff: false,
    nowMs: 100_000,
  });
  assert.equal(dup.allowProcess, false);
  assert.equal(dup.reason, 'duplicate_mid');
  assert.equal(dup.dedupKey, 'mid_m_dup_1');
});

test('evaluateWebhookSafeguards enforces auto-reply cooldown while still saving message', () => {
  const cooldown = evaluateWebhookSafeguards({
    event: { sender: { id: 'psid-1' }, message: { mid: 'm3', text: 'Hello again' } },
    alreadyProcessed: false,
    conversationAiEnabled: true,
    needsHumanHandoff: false,
    lastAutoReplyAtMs: 95_000,
    nowMs: 100_000,
    cooldownMs: 15_000,
  });
  assert.equal(cooldown.allowProcess, true);
  assert.equal(cooldown.allowAutoReply, false);
  assert.equal(cooldown.reason, 'cooldown_active');
});

test('buildWebhookDedupKey handles mid and postback deterministically', () => {
  assert.equal(
    buildWebhookDedupKey({ sender: { id: '1' }, message: { mid: 'm.123/abc' } }),
    'mid_m_123_abc'
  );
  const pbKey = buildWebhookDedupKey({
    sender: { id: 'psid-1' },
    timestamp: 1700000000,
    postback: { payload: 'GET_STARTED' },
  });
  assert.ok(pbKey?.startsWith('pb_'));
});
