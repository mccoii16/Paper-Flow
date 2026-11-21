import type { ContactNameSource, MessengerProfileStatus } from '../src/types/paperflow.js';
import {
  formatMessengerDisplayName,
  isFallbackGuestName,
  isSafeHttpsProfilePicUrl,
  normalizeOptionalString,
} from './firestoreSanitizer.js';

export type MetaProfileFetchStatus =
  | 'ok'
  | 'no_token'
  | 'invalid_psid'
  | 'permission_denied'
  | 'rate_limited'
  | 'unavailable';

export interface MessengerUserProfile {
  psid: string;
  firstName?: string;
  lastName?: string;
  displayName: string;
  profilePicUrl?: string;
}

export interface MetaProfileFetchResult {
  status: MetaProfileFetchStatus;
  profile?: MessengerUserProfile;
  httpStatus?: number;
  metaErrorCode?: number;
  metaErrorSubcode?: number;
  metaErrorType?: string;
  userStatusMessage: string;
  reason?: string;
}

export interface ShouldFetchProfileParams {
  existingName?: string | null;
  existingNameSource?: ContactNameSource | null;
  existingProfilePicUrl?: string | null;
  existingProfileFetchedAt?: string | null;
  existingProfileLastAttemptAt?: string | null;
  existingProfileStatus?: MessengerProfileStatus | null;
  lastAttemptAtMs?: number;
  lastAttemptRateLimited?: boolean;
  nowMs: number;
  retryCooldownMs?: number;
  rateLimitCooldownMs?: number;
  refreshTtlMs?: number;
}

const DEFAULT_RETRY_COOLDOWN_MS = 15 * 60_000; // 15 minutes
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60 * 60_000; // 60 minutes
const DEFAULT_REFRESH_TTL_MS = 24 * 60 * 60_000; // 24 hours
const VALID_PSID_PATTERN = /^[a-zA-Z0-9_-]{3,128}$/;

export function extractPsidFromContact(params: {
  psid?: string | null;
  messengerHandle?: string | null;
  conversationId?: string | null;
}): string | null {
  const candidates = [
    params.psid,
    params.messengerHandle?.startsWith('psid:')
      ? params.messengerHandle.slice('psid:'.length)
      : undefined,
    params.conversationId?.startsWith('meta_')
      ? params.conversationId.slice('meta_'.length)
      : undefined,
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && VALID_PSID_PATTERN.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

export function isManualContactName(params: {
  existingName?: string | null;
  existingNameSource?: ContactNameSource | null;
  existingProfileFetchedAt?: string | null;
}): boolean {
  if (params.existingNameSource === 'manual') return true;
  if (params.existingNameSource === 'meta' || params.existingNameSource === 'fallback') {
    return false;
  }
  // Legacy records before nameSource existed: if a non-fallback name is present
  // without a Meta profileFetchedAt timestamp, treat it as operator-assigned.
  return !isFallbackGuestName(params.existingName) && !params.existingProfileFetchedAt;
}

/**
 * Decides whether an incoming webhook should automatically query Meta's User Profile API.
 * Checks both in-memory attempt cache AND persisted Firestore `profileLastAttemptAt`
 * so rate limits and cooldowns hold reliably across Vercel serverless cold starts.
 */
export function shouldFetchMessengerProfile(params: ShouldFetchProfileParams): boolean {
  const retryCooldownMs = params.retryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS;
  const rateLimitCooldownMs = params.rateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  const refreshTtlMs = params.refreshTtlMs ?? DEFAULT_REFRESH_TTL_MS;

  const persistedAttemptMs = params.existingProfileLastAttemptAt
    ? Date.parse(params.existingProfileLastAttemptAt)
    : Number.NaN;
  const effectiveLastAttemptMs =
    params.lastAttemptAtMs !== undefined && !Number.isNaN(persistedAttemptMs)
      ? Math.max(params.lastAttemptAtMs, persistedAttemptMs)
      : params.lastAttemptAtMs !== undefined
      ? params.lastAttemptAtMs
      : !Number.isNaN(persistedAttemptMs)
      ? persistedAttemptMs
      : undefined;

  const wasRateLimited =
    Boolean(params.lastAttemptRateLimited) || params.existingProfileStatus === 'rate_limited';

  if (effectiveLastAttemptMs !== undefined) {
    const cooldown = wasRateLimited ? rateLimitCooldownMs : retryCooldownMs;
    if (params.nowMs - effectiveLastAttemptMs < cooldown) {
      return false;
    }
  }

  // Never trigger background lookup solely to overwrite a manually assigned contact name
  // when we already have a photo or previously fetched profile.
  const manualName = isManualContactName({
    existingName: params.existingName,
    existingNameSource: params.existingNameSource,
    existingProfileFetchedAt: params.existingProfileFetchedAt,
  });

  if (manualName) {
    return false;
  }

  const hasRealName = !isFallbackGuestName(params.existingName);
  if (hasRealName) {
    if (!params.existingProfileFetchedAt) {
      return false;
    }
    const fetchedMs = Date.parse(params.existingProfileFetchedAt);
    if (!Number.isNaN(fetchedMs) && params.nowMs - fetchedMs < refreshTtlMs) {
      return false;
    }
  }

  return true;
}

export function mapFetchStatusToProfileStatus(
  status: MetaProfileFetchStatus
): MessengerProfileStatus {
  switch (status) {
    case 'ok':
      return 'synced';
    case 'permission_denied':
      return 'permission_denied';
    case 'rate_limited':
      return 'rate_limited';
    default:
      return 'unavailable';
  }
}

interface RawMetaGraphProfileResponse {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  profile_pic?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
}

async function queryMetaProfileFields(params: {
  psid: string;
  fields: string;
  pageAccessToken: string;
  fetchFn: typeof fetch;
  timeoutMs: number;
}): Promise<{
  response: Response;
  payload: RawMetaGraphProfileResponse | null;
}> {
  const endpoint = `https://graph.facebook.com/v21.0/${encodeURIComponent(
    params.psid
  )}?fields=${encodeURIComponent(params.fields)}&access_token=${encodeURIComponent(
    params.pageAccessToken
  )}`;

  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(params.timeoutMs)
      : undefined;

  const response = await params.fetchFn(endpoint, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });

  let payload: RawMetaGraphProfileResponse | null = null;
  try {
    payload = (await response.json()) as RawMetaGraphProfileResponse;
  } catch {
    payload = null;
  }

  return { response, payload };
}

/**
 * Fetches a Messenger sender's profile strictly by their Page-scoped ID (PSID)
 * using the server-side META_PAGE_ACCESS_TOKEN.
 *
 * Uses Meta Messenger User Profile API's documented PSID fields
 * (`first_name,last_name,profile_pic`) — avoiding the unsupported `name` field
 * on PSID User objects which triggers Graph API error code 100.
 * If Meta rejects `profile_pic` with error code 100, retries once with `first_name,last_name`.
 */
export async function fetchMessengerUserProfile(params: {
  psid: string;
  pageAccessToken?: string;
  pageId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<MetaProfileFetchResult> {
  const psid = params.psid.trim();
  const pageId = params.pageId?.trim();

  if (!VALID_PSID_PATTERN.test(psid)) {
    return {
      status: 'invalid_psid',
      userStatusMessage: 'Profile unavailable from Meta (invalid Messenger ID)',
      reason: 'Malformed sender PSID',
    };
  }

  if (pageId && psid === pageId) {
    return {
      status: 'invalid_psid',
      userStatusMessage: 'Profile unavailable from Meta',
      reason: 'Sender ID matches META_PAGE_ID; refusing to fetch Page profile as customer',
    };
  }

  const token = params.pageAccessToken?.trim();
  if (!token) {
    return {
      status: 'no_token',
      userStatusMessage: 'Profile unavailable from Meta (Page Access Token not configured)',
      reason: 'META_PAGE_ACCESS_TOKEN is not configured',
    };
  }

  const fetchFn = params.fetchImpl ?? fetch;
  const timeoutMs = params.timeoutMs ?? 4000;

  try {
    let { response, payload } = await queryMetaProfileFields({
      psid,
      fields: 'first_name,last_name,profile_pic',
      pageAccessToken: token,
      fetchFn,
      timeoutMs,
    });

    // If Meta rejects a field (e.g., profile_pic unavailable on this app tier, code 100),
    // retry once requesting only first_name and last_name so we still recover the real name.
    if ((!response.ok || payload?.error) && payload?.error?.code === 100) {
      const retry = await queryMetaProfileFields({
        psid,
        fields: 'first_name,last_name',
        pageAccessToken: token,
        fetchFn,
        timeoutMs,
      });
      if (retry.response.ok && retry.payload && !retry.payload.error) {
        response = retry.response;
        payload = retry.payload;
      }
    }

    if (!payload) {
      return {
        status: 'unavailable',
        httpStatus: response.status,
        userStatusMessage: 'Profile unavailable from Meta',
        reason: 'Non-JSON response from Meta User Profile API',
      };
    }

    const errCode = payload.error?.code;
    const errSubcode = payload.error?.error_subcode;
    const errType = payload.error?.type;

    if (
      response.status === 429 ||
      errCode === 4 ||
      errCode === 17 ||
      errCode === 32 ||
      errCode === 613
    ) {
      return {
        status: 'rate_limited',
        httpStatus: response.status,
        metaErrorCode: errCode,
        metaErrorSubcode: errSubcode,
        metaErrorType: errType,
        userStatusMessage: 'Profile unavailable from Meta (rate limit reached)',
        reason: payload.error?.message || 'Meta Graph API rate limit reached',
      };
    }

    if (
      response.status === 401 ||
      response.status === 403 ||
      errCode === 10 ||
      errCode === 190 ||
      errCode === 200 ||
      errCode === 230
    ) {
      return {
        status: 'permission_denied',
        httpStatus: response.status,
        metaErrorCode: errCode,
        metaErrorSubcode: errSubcode,
        metaErrorType: errType,
        userStatusMessage: 'Profile unavailable from Meta',
        reason: payload.error?.message || 'Meta User Profile permission not granted',
      };
    }

    if (!response.ok || payload.error) {
      return {
        status: 'unavailable',
        httpStatus: response.status,
        metaErrorCode: errCode,
        metaErrorSubcode: errSubcode,
        metaErrorType: errType,
        userStatusMessage: 'Profile unavailable from Meta',
        reason: payload.error?.message || `Meta User Profile HTTP ${response.status}`,
      };
    }

    // Defensive check: if Graph API returned an ID, ensure it matches the requested PSID
    if (typeof payload.id === 'string' && payload.id.trim() && payload.id.trim() !== psid) {
      return {
        status: 'unavailable',
        httpStatus: response.status,
        userStatusMessage: 'Profile unavailable from Meta',
        reason: 'Returned Graph profile ID did not match sender PSID',
      };
    }

    const firstName = normalizeOptionalString(payload.first_name, 80);
    const lastName = normalizeOptionalString(payload.last_name, 80);
    const fullName = normalizeOptionalString(payload.name, 120);
    const profilePicUrl = isSafeHttpsProfilePicUrl(payload.profile_pic);

    if (!firstName && !lastName && !fullName && !profilePicUrl) {
      return {
        status: 'unavailable',
        httpStatus: response.status,
        userStatusMessage: 'Profile unavailable from Meta',
        reason: 'Meta User Profile API returned no public name or picture fields',
      };
    }

    const displayName = formatMessengerDisplayName({
      firstName,
      lastName,
      fullName,
      psid,
    });

    return {
      status: 'ok',
      httpStatus: response.status,
      userStatusMessage: 'Profile synced from Meta',
      profile: {
        psid,
        firstName,
        lastName,
        displayName,
        profilePicUrl,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    return {
      status: 'unavailable',
      userStatusMessage: 'Profile unavailable from Meta',
      reason: message,
    };
  }
}
