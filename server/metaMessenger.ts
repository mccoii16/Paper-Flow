import { getAdminFirestore } from './firebaseAdmin';
import {
  buildSimulatedAutoReply,
} from '../src/utils/automationEngine';
import type {
  AutomationLog,
  Booking,
  Conversation,
  KnowledgeBaseItem,
  Lead,
  Message,
  Workflow,
  WorkspaceProfile,
} from '../src/types/paperflow';
import {
  buildWebhookDedupKey,
  evaluateWebhookSafeguards,
  type MetaMessagingEvent,
} from './webhookSafeguards';

const RECENT_DEDUP_CACHE = new Map<string, number>();
const RECENT_AUTOREPLY_BY_PSID = new Map<string, number>();

function cleanExpiredCache(map: Map<string, number>, maxAgeMs: number, nowMs: number) {
  for (const [k, ts] of map.entries()) {
    if (nowMs - ts > maxAgeMs) map.delete(k);
  }
}

/**
 * Calls Meta's Graph Send API strictly on the server using META_PAGE_ACCESS_TOKEN.
 */
export async function sendMetaMessengerMessage(params: {
  recipientPsid: string;
  text: string;
}): Promise<{ messageId: string }> {
  const pageToken = process.env.META_PAGE_ACCESS_TOKEN;
  if (!pageToken) {
    throw new Error('META_PAGE_ACCESS_TOKEN is not configured on the server.');
  }

  const response = await fetch(
    `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(pageToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_type: 'RESPONSE',
        recipient: { id: params.recipientPsid },
        message: { text: params.recipientPsid ? params.text : '' },
      }),
    }
  );

  const payload = (await response.json()) as {
    message_id?: string;
    error?: { message?: string; code?: number };
  };

  if (!response.ok || payload.error) {
    throw new Error(
      `Meta Send API error (${response.status}): ${payload.error?.message || 'Unknown error'}`
    );
  }

  return { messageId: payload.message_id || `meta_${Date.now()}` };
}

function getWorkspaceId(): string {
  return process.env.PAPERFLOW_WORKSPACE_ID || 'paper-dreams-cebu';
}

/**
 * Processes an incoming Meta Messenger webhook event:
 * 1. Runs anti-loop, duplicate mid, and cooldown safeguards
 * 2. Saves guest message + lead/contact to Firestore
 * 3. Checks for booking inquiry keywords and saves booking inquiry if detected
 * 4. Evaluates active Firestore workflows & Knowledge Base, sends auto-reply via Send API,
 *    and records automationLogs + sent message in Firestore.
 */
export async function processIncomingMetaEvent(event: MetaMessagingEvent): Promise<{
  status: string;
  psid?: string;
}> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  cleanExpiredCache(RECENT_DEDUP_CACHE, 10 * 60_000, nowMs);
  cleanExpiredCache(RECENT_AUTOREPLY_BY_PSID, 60_000, nowMs);

  const db = getAdminFirestore();
  const workspaceId = getWorkspaceId();
  const wsRef = db.collection('workspaces').doc(workspaceId);

  const dedupCandidate = buildWebhookDedupKey(event);
  let alreadyProcessed = Boolean(dedupCandidate && RECENT_DEDUP_CACHE.has(dedupCandidate));

  if (!alreadyProcessed && dedupCandidate) {
    const dedupSnap = await wsRef.collection('webhookDedup').doc(dedupCandidate).get();
    if (dedupSnap.exists) {
      alreadyProcessed = true;
    }
  }

  const psid = event.sender?.id || '';
  const convId = psid ? `meta_${psid.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
  const convRef = convId ? wsRef.collection('conversations').doc(convId) : null;
  const convSnap = convRef ? await convRef.get() : null;
  const existingConv = convSnap?.exists ? (convSnap.data() as Omit<Conversation, 'messages'>) : null;

  const safeguard = evaluateWebhookSafeguards({
    event,
    pageId: process.env.META_PAGE_ID,
    alreadyProcessed,
    conversationAiEnabled: existingConv ? existingConv.aiEnabled : true,
    needsHumanHandoff: existingConv ? existingConv.needsHumanHandoff : false,
    lastAutoReplyAtMs: psid ? RECENT_AUTOREPLY_BY_PSID.get(psid) : undefined,
    nowMs,
  });

  if (!safeguard.allowProcess) {
    return { status: safeguard.reason, psid };
  }

  if (safeguard.dedupKey) {
    RECENT_DEDUP_CACHE.set(safeguard.dedupKey, nowMs);
    await wsRef.collection('webhookDedup').doc(safeguard.dedupKey).set({
      eventId: safeguard.dedupKey,
      psid,
      processedAt: nowIso,
    });
  }

  const wsSnap = await wsRef.get();
  const wsProfile = wsSnap.exists ? (wsSnap.data() as WorkspaceProfile) : null;
  const ownerUid = wsProfile?.ownerUid || 'studio-admin';

  const incomingText =
    event.message?.text?.trim() ||
    event.postback?.title?.trim() ||
    event.postback?.payload?.trim() ||
    '';

  const leadId = `lead_${convId}`;
  const leadRef = wsRef.collection('leads').doc(leadId);
  const leadSnap = await leadRef.get();

  const guestDisplayName =
    existingConv?.guestName ||
    (leadSnap.exists ? (leadSnap.data() as Lead).name : null) ||
    `Messenger Guest ${psid.slice(-4)}`;

  if (!leadSnap.exists) {
    const newLead: Lead = {
      id: leadId,
      ownerUid,
      psid,
      name: guestDisplayName,
      messengerHandle: `psid:${psid}`,
      email: '',
      phone: '',
      eventType: 'Messenger Inquiry',
      eventDate: '',
      venue: '',
      estimatedValuePhp: 0,
      status: 'New Inquiry',
      tags: ['Live Messenger'],
      source: 'Messenger (Live)',
      lastContactAt: nowIso,
      notes: 'Captured automatically via Meta Messenger webhook.',
    };
    await leadRef.set(newLead);
  } else {
    await leadRef.update({ lastContactAt: nowIso });
  }

  if (!existingConv && convRef) {
    const initials = guestDisplayName
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'MG';

    const newConv: Omit<Conversation, 'messages'> = {
      id: convId,
      ownerUid,
      leadId,
      psid,
      guestName: guestDisplayName,
      messengerHandle: `psid:${psid}`,
      avatarInitials: initials,
      avatarTone: 'pink',
      aiEnabled: true,
      leadStatus: 'New Inquiry',
      tags: ['Live Messenger'],
      unreadCount: 1,
      lastMessagePreview: incomingText.slice(0, 500),
      lastMessageAt: nowIso,
      channel: 'Messenger (Live)',
      needsHumanHandoff: false,
    };
    await convRef.set(newConv);
  } else if (convRef && existingConv) {
    await convRef.update({
      unreadCount: (existingConv.unreadCount || 0) + 1,
      lastMessagePreview: incomingText.slice(0, 500),
      lastMessageAt: nowIso,
    });
  }

  const incomingMsgId = safeguard.dedupKey || `msg_${nowMs}`;
  const incomingMessage: Message = {
    id: incomingMsgId,
    ownerUid,
    conversationId: convId,
    externalMid: event.message?.mid || '',
    sender: 'guest',
    senderName: guestDisplayName,
    text: incomingText,
    timestamp: nowIso,
    isSimulated: false,
  };
  await convRef?.collection('messages').doc(incomingMsgId).set(incomingMessage);

  // Detect booking inquiry keywords and store in Firestore bookings collection
  if (/\b(book|booking|reserve|reservation|date|availab)\b/i.test(incomingText)) {
    const bookingId = `bk_inq_${convId}`;
    const bookingRef = wsRef.collection('bookings').doc(bookingId);
    const bkSnap = await bookingRef.get();
    if (!bkSnap.exists) {
      const bookingInquiry: Booking = {
        id: bookingId,
        ownerUid,
        leadId,
        clientName: guestDisplayName,
        eventTitle: `Messenger Booking Inquiry (${guestDisplayName})`,
        packageName: 'Package Pending Confirmation',
        eventDate: '',
        eventTime: '',
        venue: 'Cebu (Pending)',
        totalPhp: 0,
        depositPaidPhp: 0,
        status: 'Pending Deposit',
        notes: `Initial inquiry message: "${incomingText.slice(0, 300)}"`,
      };
      await bookingRef.set(bookingInquiry);
    }
  }

  if (!safeguard.allowAutoReply) {
    const skipLog: AutomationLog = {
      id: `log_${nowMs}`,
      ownerUid,
      conversationId: convId,
      channel: 'Messenger (Live)',
      outcome:
        safeguard.reason === 'cooldown_active'
          ? 'skipped_cooldown'
          : 'manual_only',
      createdAt: nowIso,
    };
    await wsRef.collection('automationLogs').doc(skipLog.id).set(skipLog);
    return { status: safeguard.reason, psid };
  }

  // Load Workflows & Knowledge Base from Firestore to build automated reply
  const [wfSnaps, kbSnaps] = await Promise.all([
    wsRef.collection('workflows').get(),
    wsRef.collection('knowledgeBase').get(),
  ]);

  const workflows = wfSnaps.docs.map((d) => d.data() as Workflow);
  const knowledgeBase = kbSnaps.docs.map((d) => d.data() as KnowledgeBaseItem);

  const convContext: Conversation = {
    id: convId,
    ownerUid,
    leadId,
    psid,
    guestName: guestDisplayName,
    messengerHandle: `psid:${psid}`,
    avatarInitials: 'MG',
    avatarTone: 'pink',
    aiEnabled: true,
    leadStatus: existingConv?.leadStatus ?? 'New Inquiry',
    tags: existingConv?.tags ?? ['Live Messenger'],
    unreadCount: 0,
    lastMessagePreview: incomingText,
    lastMessageAt: nowIso,
    channel: 'Messenger (Live)',
    needsHumanHandoff: false,
    messages: [],
  };

  const replyPlan = buildSimulatedAutoReply({
    conversation: convContext,
    incomingText,
    workflows,
    knowledgeBase,
    fallbackMessage:
      wsProfile?.defaultAiFallbackMessage ||
      'Thank you for messaging Paper Dreams Cebu! Our studio coordinator will review your event details shortly.',
  });

  if (process.env.META_PAGE_ACCESS_TOKEN) {
    RECENT_AUTOREPLY_BY_PSID.set(psid, Date.now());
    const sent = await sendMetaMessengerMessage({
      recipientPsid: psid,
      text: replyPlan.replyText,
    });

    const replyTs = new Date().toISOString();
    const replyMsgId = `msg_ai_${Date.now()}`;
    const replyMessage: Message = {
      id: replyMsgId,
      ownerUid,
      conversationId: convId,
      externalMid: sent.messageId,
      sender: 'ai_live',
      senderName: 'PaperFlow Auto-Reply',
      text: replyPlan.replyText,
      timestamp: replyTs,
      isSimulated: false,
      matchedKbTitle: replyPlan.matchedKbItem?.title,
      matchedWorkflowName: replyPlan.matchedWorkflow?.name,
    };

    await convRef?.collection('messages').doc(replyMsgId).set(replyMessage);
    await convRef?.update({
      lastMessagePreview: replyPlan.replyText.slice(0, 500),
      lastMessageAt: replyTs,
      needsHumanHandoff: replyPlan.triggeredHandoff,
      aiEnabled: replyPlan.triggeredHandoff ? false : true,
      leadStatus: replyPlan.suggestedStatus ?? convContext.leadStatus,
    });

    if (replyPlan.suggestedStatus) {
      await leadRef.update({
        status: replyPlan.suggestedStatus,
        lastContactAt: replyTs,
      });
    }

    const logEntry: AutomationLog = {
      id: `log_${Date.now()}`,
      ownerUid,
      conversationId: convId,
      workflowId: replyPlan.matchedWorkflow?.id,
      workflowName: replyPlan.matchedWorkflow?.name,
      matchedKbTitle: replyPlan.matchedKbItem?.title,
      channel: 'Messenger (Live)',
      outcome: replyPlan.triggeredHandoff ? 'handoff' : 'replied',
      createdAt: replyTs,
    };
    await wsRef.collection('automationLogs').doc(logEntry.id).set(logEntry);
  }

  return { status: 'processed', psid };
}
