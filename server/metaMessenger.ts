import type { Firestore } from 'firebase-admin/firestore';
import { getAdminFirestore } from './firebaseAdmin.js';
import { buildSimulatedAutoReply } from '../src/utils/automationEngine.js';
import type {
  Booking,
  ContactNameSource,
  Conversation,
  KnowledgeBaseItem,
  Lead,
  Message,
  MessengerProfileStatus,
  Workflow,
  WorkspaceProfile,
} from '../src/types/paperflow.js';
import {
  buildWebhookDedupKey,
  evaluateWebhookSafeguards,
  type MetaMessagingEvent,
} from './webhookSafeguards.js';
import {
  buildAutomationLogDoc,
  buildAvatarInitials,
  buildFallbackGuestName,
  buildReplyMessageDoc,
  isFallbackGuestName,
  sanitizeFirestoreData,
} from './firestoreSanitizer.js';
import {
  extractPsidFromContact,
  fetchMessengerUserProfile,
  isManualContactName,
  mapFetchStatusToProfileStatus,
  shouldFetchMessengerProfile,
  type MetaProfileFetchResult,
} from './metaProfile.js';

interface ProfileAttemptRecord {
  attemptedAtMs: number;
  rateLimited: boolean;
}

const RECENT_DEDUP_CACHE = new Map<string, number>();
const RECENT_AUTOREPLY_BY_PSID = new Map<string, number>();
const RECENT_PROFILE_ATTEMPT_BY_PSID = new Map<string, ProfileAttemptRecord>();

function cleanExpiredCache(map: Map<string, number>, maxAgeMs: number, nowMs: number) {
  for (const [k, ts] of map.entries()) {
    if (nowMs - ts > maxAgeMs) map.delete(k);
  }
}

function cleanExpiredProfileAttempts(nowMs: number) {
  for (const [k, rec] of RECENT_PROFILE_ATTEMPT_BY_PSID.entries()) {
    const maxAge = rec.rateLimited ? 60 * 60_000 : 15 * 60_000;
    if (nowMs - rec.attemptedAtMs > maxAge) {
      RECENT_PROFILE_ATTEMPT_BY_PSID.delete(k);
    }
  }
}

export function resetMetaMessengerCachesForTests(): void {
  RECENT_DEDUP_CACHE.clear();
  RECENT_AUTOREPLY_BY_PSID.clear();
  RECENT_PROFILE_ATTEMPT_BY_PSID.clear();
}

function isFirestoreAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as { code?: unknown; message?: unknown };
  if (record.code === 6 || record.code === 'already-exists' || record.code === 'ALREADY_EXISTS') {
    return true;
  }
  if (typeof record.message === 'string' && /already exists/i.test(record.message)) {
    return true;
  }
  return false;
}

function logProfileLookupFailure(psid: string, result: MetaProfileFetchResult): void {
  const maskedPsid = `...${psid.slice(-4)}`;
  const codePart =
    result.metaErrorCode !== undefined ? ` code=${result.metaErrorCode}` : '';
  const subcodePart =
    result.metaErrorSubcode !== undefined ? ` subcode=${result.metaErrorSubcode}` : '';
  const typePart = result.metaErrorType ? ` type=${result.metaErrorType}` : '';
  const httpPart = result.httpStatus !== undefined ? ` http=${result.httpStatus}` : '';
  // Never log access_token or full Graph URL
  console.warn(
    `Meta User Profile API (${result.status}) for PSID ${maskedPsid}:${httpPart}${codePart}${subcodePart}${typePart} — ${
      result.reason || result.userStatusMessage
    }`
  );
}

/**
 * Calls Meta's Graph Send API strictly on the server using META_PAGE_ACCESS_TOKEN.
 */
export async function sendMetaMessengerMessage(params: {
  recipientPsid: string;
  text: string;
  pageAccessToken?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ messageId: string }> {
  const pageToken = params.pageAccessToken ?? process.env.META_PAGE_ACCESS_TOKEN;
  if (!pageToken) {
    throw new Error('META_PAGE_ACCESS_TOKEN is not configured on the server.');
  }

  const fetchFn = params.fetchImpl ?? fetch;
  const timeoutMs = params.timeoutMs ?? 8000;
  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;

  const response = await fetchFn(
    `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(pageToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
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

export interface ProcessMetaEventDeps {
  db?: Firestore;
  fetchImpl?: typeof fetch;
  pageAccessToken?: string;
  pageId?: string;
  workspaceId?: string;
  nowMs?: number;
}

export interface RefreshMessengerProfileResult {
  updated: boolean;
  status: 'synced' | 'permission_denied' | 'rate_limited' | 'unavailable' | 'no_token' | 'invalid_psid' | 'not_found' | 'forbidden';
  profileStatus: MessengerProfileStatus;
  statusMessage: string;
  guestName?: string;
  firstName?: string;
  lastName?: string;
  profilePicUrl?: string;
  avatarInitials?: string;
  nameSource?: ContactNameSource;
  profileFetchedAt?: string;
  profileLastAttemptAt?: string;
  metaErrorCode?: number;
}

/**
 * Refreshes an existing Messenger contact's profile from Meta on demand.
 * Updates the existing Conversation and linked Lead in-place without creating
 * duplicates and while preserving all messages, bookings, tags, lead status,
 * and manually assigned customer names.
 */
export async function refreshMessengerContactProfile(
  params: {
    workspaceId: string;
    conversationId: string;
    callerUid?: string;
    isAdmin?: boolean;
  },
  deps?: ProcessMetaEventDeps
): Promise<RefreshMessengerProfileResult> {
  const nowMs = deps?.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const db = deps?.db ?? getAdminFirestore();
  const wsRef = db.collection('workspaces').doc(params.workspaceId);
  const convRef = wsRef.collection('conversations').doc(params.conversationId);
  const convSnap = await convRef.get();

  if (!convSnap.exists) {
    return {
      updated: false,
      status: 'not_found',
      profileStatus: 'unavailable',
      statusMessage: 'Conversation not found.',
    };
  }

  const existingConv = convSnap.data() as Omit<Conversation, 'id' | 'messages'>;

  if (
    !params.isAdmin &&
    params.callerUid &&
    existingConv.ownerUid &&
    existingConv.ownerUid !== params.callerUid
  ) {
    return {
      updated: false,
      status: 'forbidden',
      profileStatus: existingConv.profileStatus ?? 'unavailable',
      statusMessage: 'Not authorized to refresh this contact.',
    };
  }

  const leadId = existingConv.leadId || `lead_${params.conversationId}`;
  const leadRef = wsRef.collection('leads').doc(leadId);
  const leadSnap = await leadRef.get();
  const existingLead = leadSnap.exists ? (leadSnap.data() as Omit<Lead, 'id'>) : null;

  const psid = extractPsidFromContact({
    psid: existingConv.psid ?? existingLead?.psid,
    messengerHandle: existingConv.messengerHandle ?? existingLead?.messengerHandle,
    conversationId: params.conversationId,
  });

  if (!psid) {
    return {
      updated: false,
      status: 'invalid_psid',
      profileStatus: 'unavailable',
      statusMessage: 'This conversation does not have a live Meta Messenger PSID.',
    };
  }

  const pageAccessToken = deps?.pageAccessToken ?? process.env.META_PAGE_ACCESS_TOKEN;
  const pageId = deps?.pageId ?? process.env.META_PAGE_ID;

  const profileResult = await fetchMessengerUserProfile({
    psid,
    pageAccessToken,
    pageId,
    fetchImpl: deps?.fetchImpl,
  });

  RECENT_PROFILE_ATTEMPT_BY_PSID.set(psid, {
    attemptedAtMs: nowMs,
    rateLimited: profileResult.status === 'rate_limited',
  });

  const existingName = existingConv.guestName || existingLead?.name || buildFallbackGuestName(psid);
  const manualName = isManualContactName({
    existingName,
    existingNameSource: existingConv.nameSource ?? existingLead?.nameSource,
    existingProfileFetchedAt: existingConv.profileFetchedAt ?? existingLead?.profileFetchedAt,
  });

  if (profileResult.status === 'ok' && profileResult.profile) {
    const p = profileResult.profile;
    const nextName =
      manualName
        ? existingName
        : !isFallbackGuestName(p.displayName)
        ? p.displayName
        : existingName;
    const nextNameSource: ContactNameSource = manualName
      ? 'manual'
      : !isFallbackGuestName(nextName)
      ? 'meta'
      : 'fallback';
    const nextInitials = buildAvatarInitials(nextName);
    const statusMessage = manualName
      ? 'Profile synced from Meta (manual name preserved)'
      : 'Profile synced from Meta';

    const convPatch = sanitizeFirestoreData({
      guestName: nextName.slice(0, 120),
      avatarInitials: nextInitials,
      firstName: p.firstName,
      lastName: p.lastName,
      profilePicUrl: p.profilePicUrl,
      profileFetchedAt: nowIso,
      profileLastAttemptAt: nowIso,
      profileStatus: 'synced' as MessengerProfileStatus,
      profileStatusMessage: statusMessage,
      nameSource: nextNameSource,
    });
    await convRef.update(convPatch);

    if (existingLead) {
      const leadPatch = sanitizeFirestoreData({
        name: nextName.slice(0, 120),
        firstName: p.firstName,
        lastName: p.lastName,
        profilePicUrl: p.profilePicUrl,
        profileFetchedAt: nowIso,
        profileLastAttemptAt: nowIso,
        profileStatus: 'synced' as MessengerProfileStatus,
        profileStatusMessage: statusMessage,
        nameSource: nextNameSource,
      });
      await leadRef.update(leadPatch);
    }

    return {
      updated: true,
      status: 'synced',
      profileStatus: 'synced',
      statusMessage,
      guestName: nextName,
      firstName: p.firstName,
      lastName: p.lastName,
      profilePicUrl: p.profilePicUrl,
      avatarInitials: nextInitials,
      nameSource: nextNameSource,
      profileFetchedAt: nowIso,
      profileLastAttemptAt: nowIso,
    };
  }

  // Meta denied access or profile unavailable: log precise error code securely,
  // retain existing manual name or stable PSID fallback name, never create duplicates.
  logProfileLookupFailure(psid, profileResult);
  const mappedProfileStatus = mapFetchStatusToProfileStatus(profileResult.status);
  const stableName = manualName
    ? existingName
    : !isFallbackGuestName(existingName)
    ? existingName
    : buildFallbackGuestName(psid);
  const preservedNameSource: ContactNameSource = manualName
    ? 'manual'
    : !isFallbackGuestName(stableName)
    ? existingConv.nameSource ?? 'meta'
    : 'fallback';

  const statusMessage = profileResult.userStatusMessage;

  const failureConvPatch = sanitizeFirestoreData({
    profileLastAttemptAt: nowIso,
    profileStatus: mappedProfileStatus,
    profileStatusMessage: statusMessage.slice(0, 240),
    profileLastErrorCode: profileResult.metaErrorCode,
    nameSource: preservedNameSource,
  });
  await convRef.update(failureConvPatch);

  if (existingLead) {
    const failureLeadPatch = sanitizeFirestoreData({
      profileLastAttemptAt: nowIso,
      profileStatus: mappedProfileStatus,
      profileStatusMessage: statusMessage.slice(0, 240),
      profileLastErrorCode: profileResult.metaErrorCode,
      nameSource: preservedNameSource,
    });
    await leadRef.update(failureLeadPatch);
  }

  return {
    updated: false,
    status:
      profileResult.status === 'permission_denied' ||
      profileResult.status === 'rate_limited' ||
      profileResult.status === 'no_token' ||
      profileResult.status === 'invalid_psid'
        ? profileResult.status
        : 'unavailable',
    profileStatus: mappedProfileStatus,
    statusMessage,
    guestName: stableName,
    nameSource: preservedNameSource,
    profileLastAttemptAt: nowIso,
    metaErrorCode: profileResult.metaErrorCode,
  };
}

/**
 * Processes an incoming Meta Messenger webhook event reliably:
 * 1. Runs anti-loop, duplicate mid (atomic Firestore create), and cooldown safeguards
 * 2. Resolves sender display name & profile picture via Meta User Profile API (with persisted + in-memory rate limiting & fallback)
 * 3. Persists customer lead, conversation, and incoming message FIRST (sanitized, zero undefined fields)
 * 4. Runs optional booking inquiry detection, automation evaluation, Meta Send API auto-reply,
 *    and automationLogs writes in isolated try/catch blocks so secondary failures never lose messages.
 */
export async function processIncomingMetaEvent(
  event: MetaMessagingEvent,
  deps?: ProcessMetaEventDeps
): Promise<{
  status: string;
  psid?: string;
}> {
  const nowMs = deps?.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  cleanExpiredCache(RECENT_DEDUP_CACHE, 10 * 60_000, nowMs);
  cleanExpiredCache(RECENT_AUTOREPLY_BY_PSID, 60_000, nowMs);
  cleanExpiredProfileAttempts(nowMs);

  const pageId = deps?.pageId ?? process.env.META_PAGE_ID;
  const pageAccessToken = deps?.pageAccessToken ?? process.env.META_PAGE_ACCESS_TOKEN;

  // Fast pre-check before touching Firestore (echoes, page self-messages, empty events)
  const dedupCandidate = buildWebhookDedupKey(event);
  const inMemoryDuplicate = Boolean(dedupCandidate && RECENT_DEDUP_CACHE.has(dedupCandidate));

  const preCheck = evaluateWebhookSafeguards({
    event,
    pageId,
    alreadyProcessed: inMemoryDuplicate,
    conversationAiEnabled: true,
    needsHumanHandoff: false,
    nowMs,
  });

  const psid = event.sender?.id?.trim() || '';
  if (!preCheck.allowProcess) {
    return { status: preCheck.reason, psid: psid || undefined };
  }

  const db = deps?.db ?? getAdminFirestore();
  const workspaceId = deps?.workspaceId ?? getWorkspaceId();
  const wsRef = db.collection('workspaces').doc(workspaceId);

  // Atomic Firestore deduplication guard so concurrent Vercel invocations never double-process
  if (preCheck.dedupKey) {
    const dedupRef = wsRef.collection('webhookDedup').doc(preCheck.dedupKey);
    const dedupPayload = sanitizeFirestoreData({
      eventId: preCheck.dedupKey.slice(0, 200),
      psid: psid.slice(0, 128),
      processedAt: nowIso,
    });
    try {
      if (typeof dedupRef.create === 'function') {
        await dedupRef.create(dedupPayload);
      } else {
        const existingDedup = await dedupRef.get();
        if (existingDedup.exists) {
          RECENT_DEDUP_CACHE.set(preCheck.dedupKey, nowMs);
          return { status: 'duplicate_mid', psid };
        }
        await dedupRef.set(dedupPayload);
      }
      RECENT_DEDUP_CACHE.set(preCheck.dedupKey, nowMs);
    } catch (err) {
      if (isFirestoreAlreadyExistsError(err)) {
        RECENT_DEDUP_CACHE.set(preCheck.dedupKey, nowMs);
        return { status: 'duplicate_mid', psid };
      }
      console.error('Meta webhook dedup write warning (continuing safely):', err);
    }
  }

  const convId = `meta_${psid.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const convRef = wsRef.collection('conversations').doc(convId);
  const leadId = `lead_${convId}`;
  const leadRef = wsRef.collection('leads').doc(leadId);

  const [wsSnap, convSnap, leadSnap] = await Promise.all([
    wsRef.get(),
    convRef.get(),
    leadRef.get(),
  ]);

  const wsProfile = wsSnap.exists ? (wsSnap.data() as WorkspaceProfile) : null;
  const ownerUid = wsProfile?.ownerUid || 'studio-admin';
  const existingConv = convSnap.exists
    ? (convSnap.data() as Omit<Conversation, 'id' | 'messages'>)
    : null;
  const existingLead = leadSnap.exists ? (leadSnap.data() as Omit<Lead, 'id'>) : null;

  // Evaluate conversation-level safeguards (AI pause, handoff, auto-reply cooldown)
  const safeguard = evaluateWebhookSafeguards({
    event,
    pageId,
    alreadyProcessed: false,
    conversationAiEnabled: existingConv ? existingConv.aiEnabled : true,
    needsHumanHandoff: existingConv ? existingConv.needsHumanHandoff : false,
    lastAutoReplyAtMs: RECENT_AUTOREPLY_BY_PSID.get(psid),
    nowMs,
  });

  if (!safeguard.allowProcess) {
    return { status: safeguard.reason, psid };
  }

  const incomingText =
    event.message?.text?.trim() ||
    event.postback?.title?.trim() ||
    event.postback?.payload?.trim() ||
    '';

  // Step 2: Resolve Messenger contact profile via Graph API when allowed & needed
  const currentKnownName =
    (!isFallbackGuestName(existingConv?.guestName) ? existingConv?.guestName : undefined) ??
    (!isFallbackGuestName(existingLead?.name) ? existingLead?.name : undefined) ??
    existingConv?.guestName ??
    existingLead?.name;

  const existingNameSource = existingConv?.nameSource ?? existingLead?.nameSource;
  const existingProfileFetchedAt =
    existingConv?.profileFetchedAt ?? existingLead?.profileFetchedAt;
  const existingProfileLastAttemptAt =
    existingConv?.profileLastAttemptAt ?? existingLead?.profileLastAttemptAt;
  const existingProfileStatus =
    existingConv?.profileStatus ?? existingLead?.profileStatus;
  const existingProfilePicUrl =
    existingConv?.profilePicUrl ?? existingLead?.profilePicUrl;
  const lastAttempt = RECENT_PROFILE_ATTEMPT_BY_PSID.get(psid);

  const manualName = isManualContactName({
    existingName: currentKnownName,
    existingNameSource,
    existingProfileFetchedAt,
  });

  let resolvedFirstName = existingConv?.firstName ?? existingLead?.firstName;
  let resolvedLastName = existingConv?.lastName ?? existingLead?.lastName;
  let resolvedProfilePicUrl = existingProfilePicUrl;
  let resolvedProfileFetchedAt = existingProfileFetchedAt;
  let resolvedProfileLastAttemptAt = existingProfileLastAttemptAt;
  let resolvedProfileStatus: MessengerProfileStatus | undefined = existingProfileStatus;
  let resolvedProfileStatusMessage: string | undefined =
    existingConv?.profileStatusMessage ?? existingLead?.profileStatusMessage;
  let resolvedProfileErrorCode: number | undefined =
    existingConv?.profileLastErrorCode ?? existingLead?.profileLastErrorCode;
  let resolvedNameSource: ContactNameSource = manualName
    ? 'manual'
    : !isFallbackGuestName(currentKnownName)
    ? existingNameSource ?? 'meta'
    : 'fallback';
  let guestDisplayName = currentKnownName || buildFallbackGuestName(psid);

  const needsProfileFetch = shouldFetchMessengerProfile({
    existingName: currentKnownName,
    existingNameSource,
    existingProfilePicUrl,
    existingProfileFetchedAt,
    existingProfileLastAttemptAt,
    existingProfileStatus,
    lastAttemptAtMs: lastAttempt?.attemptedAtMs,
    lastAttemptRateLimited: lastAttempt?.rateLimited,
    nowMs,
  });

  if (needsProfileFetch && pageAccessToken) {
    const profileResult = await fetchMessengerUserProfile({
      psid,
      pageAccessToken,
      pageId,
      fetchImpl: deps?.fetchImpl,
    });

    RECENT_PROFILE_ATTEMPT_BY_PSID.set(psid, {
      attemptedAtMs: nowMs,
      rateLimited: profileResult.status === 'rate_limited',
    });
    resolvedProfileLastAttemptAt = nowIso;

    if (profileResult.status === 'ok' && profileResult.profile) {
      const p = profileResult.profile;
      if (!manualName && !isFallbackGuestName(p.displayName)) {
        guestDisplayName = p.displayName;
        resolvedNameSource = 'meta';
      }
      if (p.firstName) resolvedFirstName = p.firstName;
      if (p.lastName) resolvedLastName = p.lastName;
      if (p.profilePicUrl) resolvedProfilePicUrl = p.profilePicUrl;
      resolvedProfileFetchedAt = nowIso;
      resolvedProfileStatus = 'synced';
      resolvedProfileStatusMessage = 'Profile synced from Meta';
      resolvedProfileErrorCode = undefined;
    } else {
      logProfileLookupFailure(psid, profileResult);
      resolvedProfileStatus = mapFetchStatusToProfileStatus(profileResult.status);
      resolvedProfileStatusMessage = profileResult.userStatusMessage;
      resolvedProfileErrorCode = profileResult.metaErrorCode;
      // Preserve stable fallback or existing non-fallback/manual name
      if (!manualName && isFallbackGuestName(guestDisplayName)) {
        guestDisplayName = buildFallbackGuestName(psid);
        resolvedNameSource = 'fallback';
      }
    }
  } else if (!existingConv && !pageAccessToken) {
    resolvedProfileStatus = 'unavailable';
    resolvedProfileStatusMessage = 'Profile unavailable from Meta';
  }

  const avatarInitials = buildAvatarInitials(guestDisplayName);

  // Step 3: Persist Lead, Conversation, and Incoming Message FIRST (sanitized, no undefined values, no extra `id` field)
  if (!existingLead) {
    const newLeadDoc = sanitizeFirestoreData<Omit<Lead, 'id'>>({
      ownerUid,
      psid,
      name: guestDisplayName.slice(0, 120),
      firstName: resolvedFirstName,
      lastName: resolvedLastName,
      profilePicUrl: resolvedProfilePicUrl,
      profileFetchedAt: resolvedProfileFetchedAt,
      profileLastAttemptAt: resolvedProfileLastAttemptAt,
      profileStatus: resolvedProfileStatus,
      profileStatusMessage: resolvedProfileStatusMessage?.slice(0, 240),
      profileLastErrorCode: resolvedProfileErrorCode,
      nameSource: resolvedNameSource,
      messengerHandle: `psid:${psid}`.slice(0, 120),
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
    });
    await leadRef.set(newLeadDoc);
  } else {
    const leadPatch: Record<string, unknown> = { lastContactAt: nowIso };
    if (!manualName && isFallbackGuestName(existingLead.name) && !isFallbackGuestName(guestDisplayName)) {
      leadPatch.name = guestDisplayName.slice(0, 120);
      leadPatch.nameSource = resolvedNameSource;
    }
    if (resolvedFirstName && resolvedFirstName !== existingLead.firstName) {
      leadPatch.firstName = resolvedFirstName;
    }
    if (resolvedLastName && resolvedLastName !== existingLead.lastName) {
      leadPatch.lastName = resolvedLastName;
    }
    if (resolvedProfilePicUrl && resolvedProfilePicUrl !== existingLead.profilePicUrl) {
      leadPatch.profilePicUrl = resolvedProfilePicUrl;
    }
    if (resolvedProfileFetchedAt && resolvedProfileFetchedAt !== existingLead.profileFetchedAt) {
      leadPatch.profileFetchedAt = resolvedProfileFetchedAt;
    }
    if (resolvedProfileLastAttemptAt && resolvedProfileLastAttemptAt !== existingLead.profileLastAttemptAt) {
      leadPatch.profileLastAttemptAt = resolvedProfileLastAttemptAt;
    }
    if (resolvedProfileStatus && resolvedProfileStatus !== existingLead.profileStatus) {
      leadPatch.profileStatus = resolvedProfileStatus;
    }
    if (
      resolvedProfileStatusMessage &&
      resolvedProfileStatusMessage !== existingLead.profileStatusMessage
    ) {
      leadPatch.profileStatusMessage = resolvedProfileStatusMessage.slice(0, 240);
    }
    if (
      resolvedProfileErrorCode !== undefined &&
      resolvedProfileErrorCode !== existingLead.profileLastErrorCode
    ) {
      leadPatch.profileLastErrorCode = resolvedProfileErrorCode;
    }
    await leadRef.update(sanitizeFirestoreData(leadPatch));
  }

  if (!existingConv) {
    const newConvDoc = sanitizeFirestoreData<Omit<Conversation, 'id' | 'messages'>>({
      ownerUid,
      leadId,
      psid,
      guestName: guestDisplayName.slice(0, 120),
      firstName: resolvedFirstName,
      lastName: resolvedLastName,
      profilePicUrl: resolvedProfilePicUrl,
      profileFetchedAt: resolvedProfileFetchedAt,
      profileLastAttemptAt: resolvedProfileLastAttemptAt,
      profileStatus: resolvedProfileStatus,
      profileStatusMessage: resolvedProfileStatusMessage?.slice(0, 240),
      profileLastErrorCode: resolvedProfileErrorCode,
      nameSource: resolvedNameSource,
      messengerHandle: `psid:${psid}`.slice(0, 120),
      avatarInitials,
      avatarTone: 'pink',
      aiEnabled: true,
      leadStatus: 'New Inquiry',
      tags: ['Live Messenger'],
      unreadCount: 1,
      lastMessagePreview: incomingText.slice(0, 500),
      lastMessageAt: nowIso,
      channel: 'Messenger (Live)',
      needsHumanHandoff: false,
    });
    await convRef.set(newConvDoc);
  } else {
    const convPatch: Record<string, unknown> = {
      unreadCount: (existingConv.unreadCount || 0) + 1,
      lastMessagePreview: incomingText.slice(0, 500),
      lastMessageAt: nowIso,
    };
    if (
      !manualName &&
      isFallbackGuestName(existingConv.guestName) &&
      !isFallbackGuestName(guestDisplayName)
    ) {
      convPatch.guestName = guestDisplayName.slice(0, 120);
      convPatch.avatarInitials = avatarInitials;
      convPatch.nameSource = resolvedNameSource;
    }
    if (resolvedFirstName && resolvedFirstName !== existingConv.firstName) {
      convPatch.firstName = resolvedFirstName;
    }
    if (resolvedLastName && resolvedLastName !== existingConv.lastName) {
      convPatch.lastName = resolvedLastName;
    }
    if (resolvedProfilePicUrl && resolvedProfilePicUrl !== existingConv.profilePicUrl) {
      convPatch.profilePicUrl = resolvedProfilePicUrl;
    }
    if (resolvedProfileFetchedAt && resolvedProfileFetchedAt !== existingConv.profileFetchedAt) {
      convPatch.profileFetchedAt = resolvedProfileFetchedAt;
    }
    if (resolvedProfileLastAttemptAt && resolvedProfileLastAttemptAt !== existingConv.profileLastAttemptAt) {
      convPatch.profileLastAttemptAt = resolvedProfileLastAttemptAt;
    }
    if (resolvedProfileStatus && resolvedProfileStatus !== existingConv.profileStatus) {
      convPatch.profileStatus = resolvedProfileStatus;
    }
    if (
      resolvedProfileStatusMessage &&
      resolvedProfileStatusMessage !== existingConv.profileStatusMessage
    ) {
      convPatch.profileStatusMessage = resolvedProfileStatusMessage.slice(0, 240);
    }
    if (
      resolvedProfileErrorCode !== undefined &&
      resolvedProfileErrorCode !== existingConv.profileLastErrorCode
    ) {
      convPatch.profileLastErrorCode = resolvedProfileErrorCode;
    }
    await convRef.update(sanitizeFirestoreData(convPatch));
  }

  const incomingMsgId = preCheck.dedupKey || `msg_${nowMs}`;
  const incomingMessageDoc = buildReplyMessageDoc({
    ownerUid,
    conversationId: convId,
    externalMid: event.message?.mid,
    sender: 'guest',
    senderName: guestDisplayName,
    text: incomingText,
    timestamp: nowIso,
    isSimulated: false,
  });
  await convRef.collection('messages').doc(incomingMsgId).set(incomingMessageDoc);

  // Helper to record automationLogs safely without ever aborting webhook handling
  const safeWriteAutomationLog = async (
    logId: string,
    payload: Parameters<typeof buildAutomationLogDoc>[0]
  ) => {
    try {
      const cleanLog = buildAutomationLogDoc(payload);
      await wsRef.collection('automationLogs').doc(logId).set(cleanLog);
    } catch (logErr) {
      console.error('Failed to write automationLogs entry (non-fatal):', logErr);
    }
  };

  // Step 4a: Optional booking inquiry detection (isolated so failure never loses message)
  if (/\b(book|booking|reserve|reservation|date|availab)\b/i.test(incomingText)) {
    try {
      const bookingId = `bk_inq_${convId}`;
      const bookingRef = wsRef.collection('bookings').doc(bookingId);
      const bkSnap = await bookingRef.get();
      if (!bkSnap.exists) {
        const bookingDoc = sanitizeFirestoreData<Omit<Booking, 'id'>>({
          ownerUid,
          leadId,
          clientName: guestDisplayName.slice(0, 120),
          eventTitle: `Messenger Booking Inquiry (${guestDisplayName})`.slice(0, 160),
          packageName: 'Package Pending Confirmation',
          eventDate: '',
          eventTime: '',
          venue: 'Cebu (Pending)',
          totalPhp: 0,
          depositPaidPhp: 0,
          status: 'Pending Deposit',
          notes: `Initial inquiry message: "${incomingText.slice(0, 300)}"`,
        });
        await bookingRef.set(bookingDoc);
      }
    } catch (bookingErr) {
      console.error('Booking inquiry creation failed (non-fatal):', bookingErr);
    }
  }

  // Step 4b: Respect manual-only / handoff / cooldown safeguards
  if (!safeguard.allowAutoReply) {
    await safeWriteAutomationLog(`log_${nowMs}`, {
      ownerUid,
      conversationId: convId,
      channel: 'Messenger (Live)',
      outcome:
        safeguard.reason === 'cooldown_active'
          ? 'skipped_cooldown'
          : 'manual_only',
      createdAt: nowIso,
    });
    return { status: safeguard.reason, psid };
  }

  // Step 4c: Optional automation evaluation & Meta Send API auto-reply (isolated)
  if (!pageAccessToken) {
    return { status: 'saved_no_send_token', psid };
  }

  let matchedWorkflowId: string | undefined;
  let matchedWorkflowName: string | undefined;
  let matchedKbTitle: string | undefined;

  try {
    const [wfSnaps, kbSnaps] = await Promise.all([
      wsRef.collection('workflows').get(),
      wsRef.collection('knowledgeBase').get(),
    ]);

    const workflows = wfSnaps.docs.map(
      (d) => ({ ...(d.data() as Omit<Workflow, 'id'>), id: d.id }) as Workflow
    );
    const knowledgeBase = kbSnaps.docs.map(
      (d) => ({ ...(d.data() as Omit<KnowledgeBaseItem, 'id'>), id: d.id }) as KnowledgeBaseItem
    );

    const convContext: Conversation = {
      id: convId,
      ownerUid,
      leadId,
      psid,
      guestName: guestDisplayName,
      firstName: resolvedFirstName,
      lastName: resolvedLastName,
      profilePicUrl: resolvedProfilePicUrl,
      profileFetchedAt: resolvedProfileFetchedAt,
      profileLastAttemptAt: resolvedProfileLastAttemptAt,
      profileStatus: resolvedProfileStatus,
      profileStatusMessage: resolvedProfileStatusMessage,
      profileLastErrorCode: resolvedProfileErrorCode,
      nameSource: resolvedNameSource,
      messengerHandle: `psid:${psid}`,
      avatarInitials,
      avatarTone: existingConv?.avatarTone ?? 'pink',
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

    matchedWorkflowId = replyPlan.matchedWorkflow?.id;
    matchedWorkflowName = replyPlan.matchedWorkflow?.name;
    matchedKbTitle = replyPlan.matchedKbItem?.title;

    RECENT_AUTOREPLY_BY_PSID.set(psid, Date.now());
    const sent = await sendMetaMessengerMessage({
      recipientPsid: psid,
      text: replyPlan.replyText,
      pageAccessToken,
      fetchImpl: deps?.fetchImpl,
    });

    const replyMs = Date.now();
    const replyTs = new Date(replyMs).toISOString();
    const replyMsgId = `msg_ai_${replyMs}`;

    const replyMessageDoc: Omit<Message, 'id'> = buildReplyMessageDoc({
      ownerUid,
      conversationId: convId,
      externalMid: sent.messageId,
      sender: 'ai_live',
      senderName: 'PaperFlow Auto-Reply',
      text: replyPlan.replyText,
      timestamp: replyTs,
      isSimulated: false,
      matchedKbTitle,
      matchedWorkflowName,
    });

    await convRef.collection('messages').doc(replyMsgId).set(replyMessageDoc);
    await convRef.update(
      sanitizeFirestoreData({
        lastMessagePreview: replyPlan.replyText.slice(0, 500),
        lastMessageAt: replyTs,
        needsHumanHandoff: replyPlan.triggeredHandoff,
        aiEnabled: replyPlan.triggeredHandoff ? false : true,
        leadStatus: replyPlan.suggestedStatus ?? convContext.leadStatus,
      })
    );

    if (replyPlan.suggestedStatus) {
      await leadRef.update(
        sanitizeFirestoreData({
          status: replyPlan.suggestedStatus,
          lastContactAt: replyTs,
        })
      );
    }

    await safeWriteAutomationLog(`log_${replyMs}`, {
      ownerUid,
      conversationId: convId,
      workflowId: matchedWorkflowId,
      workflowName: matchedWorkflowName,
      matchedKbTitle,
      channel: 'Messenger (Live)',
      outcome: replyPlan.triggeredHandoff ? 'handoff' : 'replied',
      createdAt: replyTs,
    });

    return { status: 'processed', psid };
  } catch (automationErr) {
    const errMsg =
      automationErr instanceof Error ? automationErr.message : 'Automation processing error';
    console.error('Meta Messenger automation/reply error (incoming message preserved):', automationErr);

    await safeWriteAutomationLog(`log_err_${Date.now()}`, {
      ownerUid,
      conversationId: convId,
      workflowId: matchedWorkflowId,
      workflowName: matchedWorkflowName,
      matchedKbTitle,
      channel: 'Messenger (Live)',
      outcome: 'error',
      errorMessage: errMsg,
      createdAt: new Date().toISOString(),
    });

    return { status: 'saved_automation_error', psid };
  }
}
