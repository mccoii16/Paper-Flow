import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import {
  buildAutomationLogDoc,
  buildAvatarInitials,
  buildFallbackGuestName,
  buildReplyMessageDoc,
  formatMessengerDisplayName,
  isFallbackGuestName,
  isSafeHttpsProfilePicUrl,
  sanitizeFirestoreData,
} from './firestoreSanitizer.js';
import {
  fetchMessengerUserProfile,
  shouldFetchMessengerProfile,
} from './metaProfile.js';
import {
  processIncomingMetaEvent,
  resetMetaMessengerCachesForTests,
} from './metaMessenger.js';
import { buildWebhookDedupKey } from './webhookSafeguards.js';

function assertNoUndefinedDeep(value: unknown, path = 'root'): void {
  if (value === undefined) {
    throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${path}").`);
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, idx) => assertNoUndefinedDeep(item, `${path}[${idx}]`));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    assertNoUndefinedDeep(v, `${path}.${k}`);
  }
}

/**
 * Strict in-memory Firestore double that mirrors Firebase Admin SDK's
 * rejection of `undefined` values and atomic `.create()` semantics.
 */
function createStrictFakeFirestore(options?: {
  failCollections?: Set<string>;
}) {
  const store = new Map<string, Record<string, unknown>>();
  const failCollections = options?.failCollections ?? new Set<string>();

  function getCollectionName(fullPath: string): string {
    const parts = fullPath.split('/');
    return parts.length >= 2 ? parts[parts.length - 2] : fullPath;
  }

  function makeDocRef(docPath: string) {
    const colName = getCollectionName(docPath);
    return {
      id: docPath.split('/').pop() || '',
      path: docPath,
      async get() {
        const data = store.get(docPath);
        return {
          exists: data !== undefined,
          id: docPath.split('/').pop() || '',
          data: () => (data ? structuredClone(data) : undefined),
        };
      },
      async create(data: Record<string, unknown>) {
        if (failCollections.has(colName)) {
          throw new Error(`Simulated write failure on ${colName}`);
        }
        assertNoUndefinedDeep(data, docPath);
        if (store.has(docPath)) {
          const err = new Error(`Document already exists: ${docPath}`) as Error & { code?: number };
          err.code = 6;
          throw err;
        }
        store.set(docPath, structuredClone(data));
      },
      async set(data: Record<string, unknown>) {
        if (failCollections.has(colName)) {
          throw new Error(`Simulated write failure on ${colName}`);
        }
        assertNoUndefinedDeep(data, docPath);
        store.set(docPath, structuredClone(data));
      },
      async update(patch: Record<string, unknown>) {
        if (failCollections.has(colName)) {
          throw new Error(`Simulated update failure on ${colName}`);
        }
        assertNoUndefinedDeep(patch, docPath);
        const existing = store.get(docPath);
        if (!existing) {
          throw new Error(`NOT_FOUND: ${docPath}`);
        }
        store.set(docPath, { ...existing, ...structuredClone(patch) });
      },
      collection(subName: string) {
        return makeCollectionRef(`${docPath}/${subName}`);
      },
    };
  }

  function makeCollectionRef(colPath: string) {
    return {
      doc(docId: string) {
        return makeDocRef(`${colPath}/${docId}`);
      },
      async get() {
        const prefix = `${colPath}/`;
        const docs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
        for (const [k, v] of store.entries()) {
          if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) {
            docs.push({
              id: k.slice(prefix.length),
              data: () => structuredClone(v),
            });
          }
        }
        return { docs };
      },
    };
  }

  const db = {
    collection(name: string) {
      return makeCollectionRef(name);
    },
  } as unknown as Firestore;

  return { db, store };
}

test('sanitizeFirestoreData strips undefined recursively while preserving falsy primitives', () => {
  const input = {
    ownerUid: 'u1',
    matchedKbTitle: undefined,
    unreadCount: 0,
    aiEnabled: false,
    notes: '',
    nullable: null,
    nested: {
      keep: 'ok',
      drop: undefined,
    },
    list: ['a', undefined, { x: 1, y: undefined }],
  };

  const cleaned = sanitizeFirestoreData(input);
  assertNoUndefinedDeep(cleaned);
  assert.equal('matchedKbTitle' in cleaned, false);
  assert.equal(cleaned.unreadCount, 0);
  assert.equal(cleaned.aiEnabled, false);
  assert.equal(cleaned.notes, '');
  assert.equal(cleaned.nullable, null);
  assert.deepEqual(cleaned.nested, { keep: 'ok' });
  assert.deepEqual(cleaned.list, ['a', { x: 1 }]);
});

test('buildReplyMessageDoc and buildAutomationLogDoc omit matchedKbTitle when unmatched and preserve it when matched', () => {
  const unmatchedReply = buildReplyMessageDoc({
    ownerUid: 'owner-1',
    conversationId: 'meta_8660',
    externalMid: 'm_1',
    sender: 'ai_live',
    senderName: 'PaperFlow Auto-Reply',
    text: 'Thanks for reaching out!',
    timestamp: '2026-06-01T10:00:00.000Z',
    isSimulated: false,
    matchedKbTitle: undefined,
    matchedWorkflowName: undefined,
  });

  assertNoUndefinedDeep(unmatchedReply);
  assert.equal('matchedKbTitle' in unmatchedReply, false);
  assert.equal('matchedWorkflowName' in unmatchedReply, false);
  assert.equal('id' in unmatchedReply, false);

  const matchedReply = buildReplyMessageDoc({
    ownerUid: 'owner-1',
    conversationId: 'meta_8660',
    externalMid: 'm_2',
    sender: 'ai_live',
    senderName: 'PaperFlow Auto-Reply',
    text: 'Our Luxe Mirror Booth starts at ₱18,500.',
    timestamp: '2026-06-01T10:01:00.000Z',
    isSimulated: false,
    matchedKbTitle: 'Luxe Mirror Keepsake Booth',
    matchedWorkflowName: 'Package Pricing Inquiry Flow',
  });

  assertNoUndefinedDeep(matchedReply);
  assert.equal(matchedReply.matchedKbTitle, 'Luxe Mirror Keepsake Booth');
  assert.equal(matchedReply.matchedWorkflowName, 'Package Pricing Inquiry Flow');

  const unmatchedLog = buildAutomationLogDoc({
    ownerUid: 'owner-1',
    conversationId: 'meta_8660',
    workflowId: undefined,
    workflowName: undefined,
    matchedKbTitle: undefined,
    channel: 'Messenger (Live)',
    outcome: 'replied',
    createdAt: '2026-06-01T10:00:00.000Z',
  });
  assertNoUndefinedDeep(unmatchedLog);
  assert.equal('matchedKbTitle' in unmatchedLog, false);
  assert.equal('workflowId' in unmatchedLog, false);

  const errorLog = buildAutomationLogDoc({
    ownerUid: 'owner-1',
    conversationId: 'meta_8660',
    channel: 'Messenger (Live)',
    outcome: 'error',
    errorMessage: 'Meta Send API error (500): transient failure',
    createdAt: '2026-06-01T10:02:00.000Z',
  });
  assertNoUndefinedDeep(errorLog);
  assert.equal(errorLog.outcome, 'error');
  assert.match(errorLog.errorMessage || '', /Meta Send API error/);
});

test('contact name formatting, initials, fallback detection, and profile URL validation', () => {
  assert.equal(
    formatMessengerDisplayName({ firstName: 'Maria', lastName: 'Santos', psid: '9876548660' }),
    'Maria Santos'
  );
  assert.equal(
    formatMessengerDisplayName({ fullName: 'Carlo Reyes', psid: '9876548660' }),
    'Carlo Reyes'
  );
  assert.equal(
    formatMessengerDisplayName({ psid: '9876548660' }),
    'Messenger Guest 8660'
  );
  assert.equal(buildFallbackGuestName('9876548660'), 'Messenger Guest 8660');
  assert.equal(isFallbackGuestName('Messenger Guest 8660'), true);
  assert.equal(isFallbackGuestName('Maria Santos'), false);
  assert.equal(buildAvatarInitials('Maria Santos'), 'MS');
  assert.equal(buildAvatarInitials('Messenger Guest 8660'), 'MG');
  assert.equal(
    isSafeHttpsProfilePicUrl('https://platform-lookaside.fbsbx.com/pic.jpg'),
    'https://platform-lookaside.fbsbx.com/pic.jpg'
  );
  assert.equal(isSafeHttpsProfilePicUrl('javascript:alert(1)'), undefined);
  assert.equal(isSafeHttpsProfilePicUrl('http://insecure.example/pic.jpg'), undefined);
});

test('fetchMessengerUserProfile retrieves real customer profile and handles errors gracefully', async () => {
  const happyFetch = (async () =>
    new Response(
      JSON.stringify({
        id: '24001122338660',
        first_name: 'Maria',
        last_name: 'Santos',
        profile_pic: 'https://platform-lookaside.fbsbx.com/maria.jpg',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )) as unknown as typeof fetch;

  const okRes = await fetchMessengerUserProfile({
    psid: '24001122338660',
    pageAccessToken: 'EAA_TEST_TOKEN',
    pageId: '100999888',
    fetchImpl: happyFetch,
  });
  assert.equal(okRes.status, 'ok');
  assert.equal(okRes.profile?.displayName, 'Maria Santos');
  assert.equal(okRes.profile?.firstName, 'Maria');
  assert.equal(okRes.profile?.lastName, 'Santos');
  assert.equal(okRes.profile?.profilePicUrl, 'https://platform-lookaside.fbsbx.com/maria.jpg');

  // Guard: refuse if sender ID matches META_PAGE_ID
  const pageGuard = await fetchMessengerUserProfile({
    psid: '100999888',
    pageAccessToken: 'EAA_TEST_TOKEN',
    pageId: '100999888',
    fetchImpl: happyFetch,
  });
  assert.equal(pageGuard.status, 'invalid_psid');

  // Permission denied
  const permDeniedFetch = (async () =>
    new Response(
      JSON.stringify({ error: { message: '(#200) Permissions error', code: 200 } }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    )) as unknown as typeof fetch;
  const deniedRes = await fetchMessengerUserProfile({
    psid: '24001122338660',
    pageAccessToken: 'EAA_TEST_TOKEN',
    fetchImpl: permDeniedFetch,
  });
  assert.equal(deniedRes.status, 'permission_denied');

  // Rate limited
  const rateLimitFetch = (async () =>
    new Response(
      JSON.stringify({ error: { message: 'Application request limit reached', code: 4 } }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    )) as unknown as typeof fetch;
  const rateRes = await fetchMessengerUserProfile({
    psid: '24001122338660',
    pageAccessToken: 'EAA_TEST_TOKEN',
    fetchImpl: rateLimitFetch,
  });
  assert.equal(rateRes.status, 'rate_limited');

  // Network timeout / abort
  const failingFetch = (async () => {
    throw new Error('The operation was aborted due to timeout');
  }) as unknown as typeof fetch;
  const errRes = await fetchMessengerUserProfile({
    psid: '24001122338660',
    pageAccessToken: 'EAA_TEST_TOKEN',
    fetchImpl: failingFetch,
  });
  assert.equal(errRes.status, 'unavailable');
});

test('shouldFetchMessengerProfile respects cooldowns and cached real names', () => {
  const now = Date.UTC(2026, 5, 1, 12, 0, 0);

  // Fallback name with no prior attempt -> fetch
  assert.equal(
    shouldFetchMessengerProfile({ existingName: 'Messenger Guest 8660', nowMs: now }),
    true
  );

  // Fallback name attempted 5 minutes ago -> skip (15m retry cooldown)
  assert.equal(
    shouldFetchMessengerProfile({
      existingName: 'Messenger Guest 8660',
      lastAttemptAtMs: now - 5 * 60_000,
      nowMs: now,
    }),
    false
  );

  // Rate-limited 30 minutes ago -> skip (60m rate-limit cooldown)
  assert.equal(
    shouldFetchMessengerProfile({
      existingName: 'Messenger Guest 8660',
      lastAttemptAtMs: now - 30 * 60_000,
      lastAttemptRateLimited: true,
      nowMs: now,
    }),
    false
  );

  // Real name fetched 2 hours ago -> skip (24h refresh TTL)
  assert.equal(
    shouldFetchMessengerProfile({
      existingName: 'Maria Santos',
      existingProfileFetchedAt: new Date(now - 2 * 60 * 60_000).toISOString(),
      nowMs: now,
    }),
    false
  );
});

test('processIncomingMetaEvent saves unmatched message without undefined Firestore error and enriches real contact name', async () => {
  resetMetaMessengerCachesForTests();
  const { db, store } = createStrictFakeFirestore();

  store.set('workspaces/paper-dreams-cebu', {
    ownerUid: 'owner-uid-1',
    businessName: 'Paper Dreams Cebu',
    currency: 'PHP',
    defaultAiFallbackMessage: 'Hi! Thanks for messaging Paper Dreams Cebu.',
  });

  const mockFetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes('/me/messages')) {
      return new Response(JSON.stringify({ message_id: 'm_out_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        id: '900012348660',
        first_name: 'Maria',
        last_name: 'Santos',
        profile_pic: 'https://platform-lookaside.fbsbx.com/maria-avatar.jpg',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as unknown as typeof fetch;

  const result = await processIncomingMetaEvent(
    {
      sender: { id: '900012348660' },
      recipient: { id: '100999888' },
      timestamp: 1760000000000,
      message: { mid: 'm_in_unmatched_1', text: 'Hello there, good afternoon!' },
    },
    {
      db,
      fetchImpl: mockFetch,
      pageAccessToken: 'EAA_TEST_TOKEN',
      pageId: '100999888',
      workspaceId: 'paper-dreams-cebu',
      nowMs: 1760000000000,
    }
  );

  assert.equal(result.status, 'processed');

  const conv = store.get('workspaces/paper-dreams-cebu/conversations/meta_900012348660');
  assert.ok(conv, 'Conversation should be saved');
  assert.equal(conv.guestName, 'Maria Santos');
  assert.equal(conv.firstName, 'Maria');
  assert.equal(conv.lastName, 'Santos');
  assert.equal(conv.avatarInitials, 'MS');
  assert.equal(conv.profilePicUrl, 'https://platform-lookaside.fbsbx.com/maria-avatar.jpg');
  assert.equal('id' in conv, false, 'Firestore doc body should omit redundant id field');

  const lead = store.get('workspaces/paper-dreams-cebu/leads/lead_meta_900012348660');
  assert.ok(lead, 'Lead should be saved');
  assert.equal(lead.name, 'Maria Santos');

  const expectedMsgId = buildWebhookDedupKey({ message: { mid: 'm_in_unmatched_1' } });
  const guestMsg = store.get(
    `workspaces/paper-dreams-cebu/conversations/meta_900012348660/messages/${expectedMsgId}`
  );
  assert.ok(guestMsg, 'Incoming guest message must be saved');
  assert.equal(guestMsg.senderName, 'Maria Santos');
  assert.equal(guestMsg.externalMid, 'm_in_unmatched_1');

  // Verify AI reply message and automation log exist with NO matchedKbTitle key
  const replyEntry = [...store.entries()].find(([k]) => k.includes('/messages/msg_ai_'));
  assert.ok(replyEntry, 'Auto-reply message should be saved');
  assert.equal('matchedKbTitle' in replyEntry[1], false);

  const logEntry = [...store.entries()].find(([k]) => k.includes('/automationLogs/log_'));
  assert.ok(logEntry, 'Automation log should be saved');
  assert.equal('matchedKbTitle' in logEntry[1], false);
  assert.equal(logEntry[1].outcome, 'replied');
});

test('processIncomingMetaEvent preserves matchedKbTitle when a Knowledge Base article matches and upgrades fallback guest names', async () => {
  resetMetaMessengerCachesForTests();
  const { db, store } = createStrictFakeFirestore();

  store.set('workspaces/paper-dreams-cebu', {
    ownerUid: 'owner-uid-1',
    businessName: 'Paper Dreams Cebu',
    currency: 'PHP',
  });
  store.set('workspaces/paper-dreams-cebu/knowledgeBase/kb_mirror', {
    ownerUid: 'owner-uid-1',
    category: 'packages',
    title: 'Luxe Mirror Keepsake Booth',
    summary: 'Interactive full-length mirror booth with instant prints.',
    details: 'Includes 3 hours unlimited prints and custom template.',
    pricePhp: 18500,
    keywords: ['mirror', 'booth', 'price', 'wedding'],
    updatedAt: '2026-05-01T00:00:00.000Z',
    active: true,
  });
  // Existing conversation still has fallback name "Messenger Guest 8660"
  store.set('workspaces/paper-dreams-cebu/conversations/meta_7770008660', {
    ownerUid: 'owner-uid-1',
    leadId: 'lead_meta_7770008660',
    psid: '7770008660',
    guestName: 'Messenger Guest 8660',
    messengerHandle: 'psid:7770008660',
    avatarInitials: 'MG',
    avatarTone: 'pink',
    aiEnabled: true,
    leadStatus: 'New Inquiry',
    tags: ['Live Messenger'],
    unreadCount: 1,
    lastMessagePreview: 'Hi',
    lastMessageAt: '2026-05-01T00:00:00.000Z',
    channel: 'Messenger (Live)',
    needsHumanHandoff: false,
  });
  store.set('workspaces/paper-dreams-cebu/leads/lead_meta_7770008660', {
    ownerUid: 'owner-uid-1',
    psid: '7770008660',
    name: 'Messenger Guest 8660',
    messengerHandle: 'psid:7770008660',
    email: '',
    phone: '',
    eventType: 'Messenger Inquiry',
    eventDate: '',
    venue: '',
    estimatedValuePhp: 0,
    status: 'New Inquiry',
    tags: ['Live Messenger'],
    source: 'Messenger (Live)',
    lastContactAt: '2026-05-01T00:00:00.000Z',
    notes: '',
  });

  const mockFetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes('/me/messages')) {
      return new Response(JSON.stringify({ message_id: 'm_out_kb' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        id: '7770008660',
        first_name: 'Ana',
        last_name: 'Villanueva',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as unknown as typeof fetch;

  const result = await processIncomingMetaEvent(
    {
      sender: { id: '7770008660' },
      recipient: { id: '100999888' },
      timestamp: 1760000100000,
      message: { mid: 'm_in_kb_1', text: 'How much is the mirror booth for a wedding?' },
    },
    {
      db,
      fetchImpl: mockFetch,
      pageAccessToken: 'EAA_TEST_TOKEN',
      pageId: '100999888',
      workspaceId: 'paper-dreams-cebu',
      nowMs: 1760000100000,
    }
  );

  assert.equal(result.status, 'processed');

  // Fallback name upgraded to real contact name on both conversation and lead
  const conv = store.get('workspaces/paper-dreams-cebu/conversations/meta_7770008660');
  assert.equal(conv?.guestName, 'Ana Villanueva');
  assert.equal(conv?.avatarInitials, 'AV');

  const lead = store.get('workspaces/paper-dreams-cebu/leads/lead_meta_7770008660');
  assert.equal(lead?.name, 'Ana Villanueva');

  const replyEntry = [...store.entries()].find(([k]) => k.includes('/messages/msg_ai_'));
  assert.equal(replyEntry?.[1].matchedKbTitle, 'Luxe Mirror Keepsake Booth');

  const logEntry = [...store.entries()].find(([k]) => k.includes('/automationLogs/log_'));
  assert.equal(logEntry?.[1].matchedKbTitle, 'Luxe Mirror Keepsake Booth');
});

test('processIncomingMetaEvent preserves incoming message even when automationLogs write or Meta Send API fails', async () => {
  resetMetaMessengerCachesForTests();
  const { db, store } = createStrictFakeFirestore({
    failCollections: new Set(['automationLogs']),
  });

  store.set('workspaces/paper-dreams-cebu', {
    ownerUid: 'owner-uid-1',
    businessName: 'Paper Dreams Cebu',
    currency: 'PHP',
  });

  const failingSendFetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes('/me/messages')) {
      return new Response(
        JSON.stringify({ error: { message: 'Temporary Send API outage', code: 2 } }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({ error: { message: '(#200) Permissions error', code: 200 } }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }) as unknown as typeof fetch;

  const result = await processIncomingMetaEvent(
    {
      sender: { id: '555500004321' },
      recipient: { id: '100999888' },
      timestamp: 1760000200000,
      message: { mid: 'm_in_resilient_1', text: 'Are you available on Dec 12?' },
    },
    {
      db,
      fetchImpl: failingSendFetch,
      pageAccessToken: 'EAA_TEST_TOKEN',
      pageId: '100999888',
      workspaceId: 'paper-dreams-cebu',
      nowMs: 1760000200000,
    }
  );

  assert.equal(result.status, 'saved_automation_error');

  // Incoming message, lead, and conversation are all preserved with clean fallback name
  const conv = store.get('workspaces/paper-dreams-cebu/conversations/meta_555500004321');
  assert.equal(conv?.guestName, 'Messenger Guest 4321');
  const expectedResilientMsgId = buildWebhookDedupKey({
    message: { mid: 'm_in_resilient_1' },
  });
  const guestMsg = store.get(
    `workspaces/paper-dreams-cebu/conversations/meta_555500004321/messages/${expectedResilientMsgId}`
  );
  assert.equal(guestMsg?.text, 'Are you available on Dec 12?');
  assert.equal(guestMsg?.externalMid, 'm_in_resilient_1');

  // Duplicate delivery of the same mid is skipped
  const dup = await processIncomingMetaEvent(
    {
      sender: { id: '555500004321' },
      recipient: { id: '100999888' },
      timestamp: 1760000205000,
      message: { mid: 'm_in_resilient_1', text: 'Are you available on Dec 12?' },
    },
    {
      db,
      fetchImpl: failingSendFetch,
      pageAccessToken: 'EAA_TEST_TOKEN',
      pageId: '100999888',
      workspaceId: 'paper-dreams-cebu',
      nowMs: 1760000205000,
    }
  );
  assert.equal(dup.status, 'duplicate_mid');

  // Page echo is ignored completely
  const echo = await processIncomingMetaEvent(
    {
      sender: { id: '100999888' },
      recipient: { id: '555500004321' },
      timestamp: 1760000210000,
      message: { mid: 'm_echo_1', is_echo: true, text: 'Page reply echo' },
    },
    {
      db,
      fetchImpl: failingSendFetch,
      pageAccessToken: 'EAA_TEST_TOKEN',
      pageId: '100999888',
      workspaceId: 'paper-dreams-cebu',
      nowMs: 1760000210000,
    }
  );
  assert.equal(echo.status, 'echo_ignored');
});
