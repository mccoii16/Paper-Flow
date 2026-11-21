import crypto from 'node:crypto';
/**
 * Verifies Meta's X-Hub-Signature-256 header against raw request body bytes.
 */
export function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
    if (!appSecret || !signatureHeader || !signatureHeader.startsWith('sha256=')) {
        return false;
    }
    const providedHex = signatureHeader.slice('sha256='.length).trim();
    if (!/^[a-fA-F0-9]{64}$/.test(providedHex)) {
        return false;
    }
    const expectedHex = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const providedBuf = Buffer.from(providedHex, 'hex');
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (providedBuf.length !== expectedBuf.length) {
        return false;
    }
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
}
/**
 * Produces a deterministic deduplication key for incoming Meta webhook events.
 */
export function buildWebhookDedupKey(event) {
    const mid = event.message?.mid;
    if (mid && mid.trim()) {
        return `mid_${mid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)}`;
    }
    const senderId = event.sender?.id;
    const ts = event.timestamp;
    const postbackPayload = event.postback?.payload;
    if (senderId && ts && postbackPayload) {
        const hash = crypto
            .createHash('sha256')
            .update(`${senderId}:${ts}:${postbackPayload}`)
            .digest('hex')
            .slice(0, 24);
        return `pb_${hash}`;
    }
    return null;
}
/**
 * Evaluates echo/loop, duplicate event, AI toggle, handoff, and cooldown safeguards.
 */
export function evaluateWebhookSafeguards(params) {
    const { event, pageId, alreadyProcessed, conversationAiEnabled, needsHumanHandoff, lastAutoReplyAtMs, nowMs, cooldownMs = 15_000, } = params;
    // 1. Bot reply loop guard: ignore echo messages sent by our own Page
    if (event.message?.is_echo) {
        return {
            allowProcess: false,
            allowAutoReply: false,
            reason: 'echo_ignored',
            dedupKey: null,
        };
    }
    // 2. Ignore events originating from our own Page ID
    if (pageId && event.sender?.id && event.sender.id === pageId) {
        return {
            allowProcess: false,
            allowAutoReply: false,
            reason: 'page_sender_ignored',
            dedupKey: null,
        };
    }
    // 3. Ignore delivery/read receipts and empty payloads
    const text = event.message?.text?.trim() || event.postback?.title?.trim() || event.postback?.payload?.trim();
    if (!event.sender?.id || !text) {
        return {
            allowProcess: false,
            allowAutoReply: false,
            reason: 'non_message_event',
            dedupKey: null,
        };
    }
    // 4. Duplicate webhook event guard
    const dedupKey = buildWebhookDedupKey(event);
    if (alreadyProcessed) {
        return {
            allowProcess: false,
            allowAutoReply: false,
            reason: 'duplicate_mid',
            dedupKey,
        };
    }
    // 5. Respect AI toggle and human handoff state (still save guest message!)
    if (!conversationAiEnabled) {
        return {
            allowProcess: true,
            allowAutoReply: false,
            reason: 'ai_disabled',
            dedupKey,
        };
    }
    if (needsHumanHandoff) {
        return {
            allowProcess: true,
            allowAutoReply: false,
            reason: 'handoff_active',
            dedupKey,
        };
    }
    // 6. Repeated auto-reply cooldown guard
    if (lastAutoReplyAtMs && nowMs - lastAutoReplyAtMs < cooldownMs) {
        return {
            allowProcess: true,
            allowAutoReply: false,
            reason: 'cooldown_active',
            dedupKey,
        };
    }
    return {
        allowProcess: true,
        allowAutoReply: true,
        reason: 'ok',
        dedupKey,
    };
}
