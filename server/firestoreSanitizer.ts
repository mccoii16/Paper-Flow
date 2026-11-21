import type {
  AutomationLog,
  Message,
  MessengerChannel,
} from '../src/types/paperflow.js';

/**
 * Recursively strips any object properties whose value is `undefined`
 * (and filters `undefined` entries inside arrays) so Firestore never throws
 * `Cannot use "undefined" as a Firestore value`.
 *
 * Preserves meaningful falsy values (`false`, `0`, `''`, `null`) and `Date` instances.
 */
export function sanitizeFirestoreData<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    const cleanedArray = value
      .filter((item) => item !== undefined)
      .map((item) => sanitizeFirestoreData(item));
    return cleanedArray as unknown as T;
  }

  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val !== undefined) {
        result[key] = sanitizeFirestoreData(val);
      }
    }
    return result as T;
  }

  return value;
}

export function buildFallbackGuestName(psid: string): string {
  const cleaned = psid.trim();
  const suffix = cleaned.length >= 4 ? cleaned.slice(-4) : cleaned || 'Guest';
  return `Messenger Guest ${suffix}`;
}

export function isFallbackGuestName(name?: string | null): boolean {
  if (!name || !name.trim()) return true;
  return /^Messenger Guest\b/i.test(name.trim());
}

export function formatMessengerDisplayName(params: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  psid: string;
}): string {
  const first = typeof params.firstName === 'string' ? params.firstName.trim() : '';
  const last = typeof params.lastName === 'string' ? params.lastName.trim() : '';
  const combined = [first, last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (combined.length > 0) {
    return combined.slice(0, 120);
  }

  const full =
    typeof params.fullName === 'string'
      ? params.fullName.replace(/\s+/g, ' ').trim()
      : '';
  if (full.length > 0) {
    return full.slice(0, 120);
  }

  return buildFallbackGuestName(params.psid);
}

export function buildAvatarInitials(displayName: string): string {
  const cleaned = displayName.trim();
  if (!cleaned || isFallbackGuestName(cleaned)) {
    return 'MG';
  }
  const letters = cleaned
    .split(/\s+/)
    .map((part) => part.replace(/[^a-zA-Z0-9]/g, '')[0] ?? '')
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return letters || 'MG';
}

export function isSafeHttpsProfilePicUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 1000) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}

export function normalizeOptionalString(
  val: unknown,
  maxLength: number
): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

export function buildReplyMessageDoc(params: {
  ownerUid: string;
  conversationId: string;
  externalMid?: string;
  sender: Message['sender'];
  senderName: string;
  text: string;
  timestamp: string;
  isSimulated?: boolean;
  matchedKbTitle?: string | null;
  matchedWorkflowName?: string | null;
}): Omit<Message, 'id'> {
  return sanitizeFirestoreData<Omit<Message, 'id'>>({
    ownerUid: params.ownerUid,
    conversationId: params.conversationId,
    externalMid: normalizeOptionalString(params.externalMid, 200),
    sender: params.sender,
    senderName: params.senderName.slice(0, 120),
    text: params.text.slice(0, 4000),
    timestamp: params.timestamp.slice(0, 64),
    isSimulated: params.isSimulated,
    matchedKbTitle: normalizeOptionalString(params.matchedKbTitle, 200),
    matchedWorkflowName: normalizeOptionalString(params.matchedWorkflowName, 200),
  });
}

export function buildAutomationLogDoc(params: {
  ownerUid: string;
  conversationId: string;
  workflowId?: string | null;
  workflowName?: string | null;
  matchedKbTitle?: string | null;
  channel: MessengerChannel;
  outcome: AutomationLog['outcome'];
  errorMessage?: string | null;
  createdAt: string;
}): Omit<AutomationLog, 'id'> {
  return sanitizeFirestoreData<Omit<AutomationLog, 'id'>>({
    ownerUid: params.ownerUid,
    conversationId: params.conversationId,
    workflowId: normalizeOptionalString(params.workflowId, 128),
    workflowName: normalizeOptionalString(params.workflowName, 140),
    matchedKbTitle: normalizeOptionalString(params.matchedKbTitle, 160),
    channel: params.channel,
    outcome: params.outcome,
    errorMessage: normalizeOptionalString(params.errorMessage, 400),
    createdAt: params.createdAt.slice(0, 64),
  });
}
