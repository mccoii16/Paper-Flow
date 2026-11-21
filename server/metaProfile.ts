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
  reason?: string;
}

export interface ShouldFetchProfileParams {
  existingName?: string | null;
  existingProfilePicUrl?: string | null;
  existingProfileFetchedAt?: string | null;
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

/**
 * Decides whether the webhook should query Meta's User Profile API for this sender.
 * Avoids repeated Graph API requests when a real name is already cached or when a
 * recent lookup failed / was rate-limited.
 */
export function shouldFetchMessengerProfile(params: ShouldFetchProfileParams): boolean {
  const retryCooldownMs = params.retryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS;
  const rateLimitCooldownMs = params.rateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  const refreshTtlMs = params.refreshTtlMs ?? DEFAULT_REFRESH_TTL_MS;

  if (params.lastAttemptAtMs !== undefined) {
    const cooldown = params.lastAttemptRateLimited ? rateLimitCooldownMs : retryCooldownMs;
    if (params.nowMs - params.lastAttemptAtMs < cooldown) {
      return false;
    }
  }

  const hasRealName = !isFallbackGuestName(params.existingName);

  if (hasRealName) {
    if (!params.existingProfileFetchedAt) {
      // Name was manually edited or already known without needing refresh unless stale
      return false;
    }
    const fetchedMs = Date.parse(params.existingProfileFetchedAt);
    if (!Number.isNaN(fetchedMs) && params.nowMs - fetchedMs < refreshTtlMs) {
      return false;
    }
  }

  return true;
}

/**
 * Fetches a Messenger sender's profile strictly by their Page-scoped ID (PSID)
 * using the server-side META_PAGE_ACCESS_TOKEN. Never queries `/me` or the Page ID
 * so the Facebook Page's or app admin's name can never be confused with the customer.
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
    return { status: 'invalid_psid', reason: 'Malformed sender PSID' };
  }

  if (pageId && psid === pageId) {
    return {
      status: 'invalid_psid',
      reason: 'Sender ID matches META_PAGE_ID; refusing to fetch Page profile as customer',
    };
  }

  const token = params.pageAccessToken?.trim();
  if (!token) {
    return { status: 'no_token', reason: 'META_PAGE_ACCESS_TOKEN is not configured' };
  }

  const fetchFn = params.fetchImpl ?? fetch;
  const timeoutMs = params.timeoutMs ?? 3500;
  const endpoint = `https://graph.facebook.com/v21.0/${encodeURIComponent(
    psid
  )}?fields=first_name,last_name,name,profile_pic&access_token=${encodeURIComponent(token)}`;

  try {
    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined;

    const response = await fetchFn(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });

    let payload: {
      id?: string;
      first_name?: string;
      last_name?: string;
      name?: string;
      profile_pic?: string;
      error?: { message?: string; code?: number; error_subcode?: number };
    };

    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      return {
        status: 'unavailable',
        httpStatus: response.status,
        reason: 'Non-JSON response from Meta User Profile API',
      };
    }

    const errCode = payload.error?.code;

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
        reason: payload.error?.message || 'Meta Graph API rate limit reached',
      };
    }

    if (
      response.status === 401 ||
      response.status === 403 ||
      errCode === 10 ||
      errCode === 190 ||
      errCode === 200
    ) {
      return {
        status: 'permission_denied',
        httpStatus: response.status,
        metaErrorCode: errCode,
        reason: payload.error?.message || 'Meta User Profile permission not granted',
      };
    }

    if (!response.ok || payload.error) {
      return {
        status: 'unavailable',
        httpStatus: response.status,
        metaErrorCode: errCode,
        reason: payload.error?.message || `Meta User Profile HTTP ${response.status}`,
      };
    }

    // Defensive check: if Graph API returned an ID, ensure it matches the requested PSID
    if (typeof payload.id === 'string' && payload.id.trim() && payload.id.trim() !== psid) {
      return {
        status: 'unavailable',
        httpStatus: response.status,
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
      reason: message,
    };
  }
}
