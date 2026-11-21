import type { Booking, BookingStatus } from '../types/paperflow.js';

export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  summaryOverride?: string;
  description?: string;
  primary?: boolean;
  accessRole?: 'freeBusyReader' | 'reader' | 'writer' | 'owner' | string;
  backgroundColor?: string;
  timeZone?: string;
}

export interface GoogleCalendarAttendee {
  email?: string;
  displayName?: string;
  organizer?: boolean;
  self?: boolean;
  responseStatus?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  organizer?: {
    email?: string;
    displayName?: string;
    self?: boolean;
  };
  creator?: {
    email?: string;
    displayName?: string;
    self?: boolean;
  };
  attendees?: GoogleCalendarAttendee[];
}

export interface CalendarImportDefaults {
  defaultStatus: BookingStatus;
  defaultPackage: string;
  availablePackages: string[];
  timeZone?: string;
}

export const BOOKING_FIELD_LIMITS = {
  clientName: 120,
  eventTitle: 160,
  packageName: 160,
  eventDate: 32,
  eventTime: 16,
  venue: 200,
  notes: 2000,
  googleEventId: 200,
  googleCalendarId: 200,
  googleCalendarName: 160,
  importedAt: 64,
} as const;

function fnv1aHex(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Generates a deterministic Firestore document ID matching `^[a-zA-Z0-9_-]{1,128}$`
 * so re-importing the same Google Calendar event never creates duplicate bookings.
 */
export function buildGoogleBookingId(calendarId: string, eventId: string): string {
  const normalizedKey = `${calendarId.trim()}::${eventId.trim()}`;
  const hashA = fnv1aHex(normalizedKey, 0x811c9dc5);
  const hashB = fnv1aHex(`${eventId.trim()}::${calendarId.trim()}`, 0x9e3779b1);
  const safeEventPrefix = eventId
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 36);
  const prefix = safeEventPrefix ? `gcal_${safeEventPrefix}_${hashA}${hashB}` : `gcal_${hashA}${hashB}`;
  return prefix.slice(0, 120);
}

/**
 * Converts Google Calendar descriptions (which may contain HTML markup) into
 * clean plain text suitable for PaperFlow booking notes.
 */
export function stripHtmlToPlainText(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extracts `YYYY-MM-DD` and `HH:mm` in the target studio timezone (default Asia/Manila)
 * from either an all-day (`start.date`) or timed (`start.dateTime`) Google Calendar event.
 */
export function extractEventDateAndTime(
  event: GoogleCalendarEvent,
  timeZone = 'Asia/Manila'
): { eventDate: string; eventTime: string; isAllDay: boolean } {
  const allDayDate = event.start?.date?.trim();
  if (allDayDate && /^\d{4}-\d{2}-\d{2}$/.test(allDayDate)) {
    return {
      eventDate: allDayDate,
      eventTime: '09:00',
      isAllDay: true,
    };
  }

  const dateTimeStr = event.start?.dateTime?.trim();
  if (dateTimeStr) {
    const parsed = new Date(dateTimeStr);
    if (!Number.isNaN(parsed.getTime())) {
      try {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).formatToParts(parsed);

        const getPart = (type: Intl.DateTimeFormatPartTypes) =>
          parts.find((p) => p.type === type)?.value ?? '';

        const year = getPart('year');
        const month = getPart('month');
        const day = getPart('day');
        let hour = getPart('hour');
        const minute = getPart('minute');

        if (hour === '24') hour = '00';

        if (year && month && day && hour && minute) {
          return {
            eventDate: `${year}-${month}-${day}`,
            eventTime: `${hour}:${minute}`,
            isAllDay: false,
          };
        }
      } catch {
        // Fall through to ISO fallback if timezone identifier is unsupported
      }

      const isoFallback = parsed.toISOString();
      return {
        eventDate: isoFallback.slice(0, 10),
        eventTime: isoFallback.slice(11, 16),
        isAllDay: false,
      };
    }
  }

  return {
    eventDate: new Date().toISOString().slice(0, 10),
    eventTime: '17:00',
    isAllDay: false,
  };
}

/**
 * Infers a client name from attendees, structured description lines, or the event title.
 */
export function inferClientNameFromEvent(event: GoogleCalendarEvent): string {
  const guestAttendee = (event.attendees ?? []).find(
    (a) => !a.self && !a.organizer && (a.displayName?.trim() || a.email?.trim())
  );
  if (guestAttendee?.displayName?.trim()) {
    return guestAttendee.displayName.trim().slice(0, BOOKING_FIELD_LIMITS.clientName);
  }

  const plainNotes = stripHtmlToPlainText(event.description);
  const clientLineMatch = plainNotes.match(/^(?:client|name|booked\s*by|contact)\s*[:\-]\s*(.+)$/im);
  if (clientLineMatch?.[1]?.trim()) {
    return clientLineMatch[1].trim().slice(0, BOOKING_FIELD_LIMITS.clientName);
  }

  const summary = event.summary?.trim();
  if (summary) {
    // Strip common trailing event-type labels if separated by " - " or " | "
    const dashParts = summary.split(/\s+[-–—|]\s+/);
    if (dashParts.length >= 2 && dashParts[0].trim().length >= 2) {
      return dashParts[0].trim().slice(0, BOOKING_FIELD_LIMITS.clientName);
    }
    return summary.slice(0, BOOKING_FIELD_LIMITS.clientName);
  }

  if (guestAttendee?.email?.trim()) {
    return guestAttendee.email.trim().slice(0, BOOKING_FIELD_LIMITS.clientName);
  }

  return 'Calendar Event Client';
}

/**
 * Attempts to match an existing studio package from Knowledge Base titles
 * inside the calendar event's summary or description.
 */
export function inferPackageNameFromEvent(
  event: GoogleCalendarEvent,
  availablePackages: string[],
  defaultPackage: string
): string {
  const haystack = `${event.summary ?? ''}\n${stripHtmlToPlainText(event.description)}`.toLowerCase();
  for (const pkg of availablePackages) {
    const trimmed = pkg.trim();
    if (trimmed && haystack.includes(trimmed.toLowerCase())) {
      return trimmed.slice(0, BOOKING_FIELD_LIMITS.packageName);
    }
  }
  const fallback = defaultPackage.trim() || 'Google Calendar Booking';
  return fallback.slice(0, BOOKING_FIELD_LIMITS.packageName);
}

/**
 * Finds an already-imported PaperFlow booking matching this Google Calendar event.
 */
export function findExistingImportedBooking(
  existingBookings: Booking[],
  calendarId: string,
  eventId: string
): Booking | undefined {
  const deterministicId = buildGoogleBookingId(calendarId, eventId);
  return existingBookings.find(
    (b) =>
      b.id === deterministicId ||
      (b.googleEventId === eventId &&
        (!b.googleCalendarId || b.googleCalendarId === calendarId))
  );
}

/**
 * Maps a Google Calendar event into a PaperFlow `Booking` record, clamping every
 * field to the Firestore blueprint constraints and preserving manual financial edits
 * when updating an existing imported booking.
 */
export function mapGoogleEventToBooking(params: {
  event: GoogleCalendarEvent;
  calendarId: string;
  calendarName: string;
  defaults: CalendarImportDefaults;
  existingBooking?: Booking;
  importedAtIso?: string;
}): Booking {
  const { event, calendarId, calendarName, defaults, existingBooking } = params;
  const importedAt = (params.importedAtIso ?? new Date().toISOString()).slice(
    0,
    BOOKING_FIELD_LIMITS.importedAt
  );
  const { eventDate, eventTime } = extractEventDateAndTime(
    event,
    defaults.timeZone ?? 'Asia/Manila'
  );

  const eventTitle = (event.summary?.trim() || 'Untitled Calendar Event').slice(
    0,
    BOOKING_FIELD_LIMITS.eventTitle
  );
  const inferredClient = inferClientNameFromEvent(event);
  const inferredPackage = inferPackageNameFromEvent(
    event,
    defaults.availablePackages,
    defaults.defaultPackage
  );
  const venue = (event.location?.trim() || existingBooking?.venue || 'TBD (From Google Calendar)').slice(
    0,
    BOOKING_FIELD_LIMITS.venue
  );
  const cleanedDescription = stripHtmlToPlainText(event.description);
  const notes = (cleanedDescription || existingBooking?.notes || '').slice(
    0,
    BOOKING_FIELD_LIMITS.notes
  );

  const id = existingBooking?.id ?? buildGoogleBookingId(calendarId, event.id);

  return {
    id,
    ownerUid: existingBooking?.ownerUid,
    leadId: existingBooking?.leadId,
    clientName: (existingBooking?.clientName?.trim() || inferredClient).slice(
      0,
      BOOKING_FIELD_LIMITS.clientName
    ),
    eventTitle,
    packageName: (existingBooking?.packageName?.trim() || inferredPackage).slice(
      0,
      BOOKING_FIELD_LIMITS.packageName
    ),
    eventDate: eventDate.slice(0, BOOKING_FIELD_LIMITS.eventDate),
    eventTime: eventTime.slice(0, BOOKING_FIELD_LIMITS.eventTime),
    venue,
    totalPhp: existingBooking?.totalPhp ?? 0,
    depositPaidPhp: existingBooking?.depositPaidPhp ?? 0,
    status: existingBooking?.status ?? defaults.defaultStatus,
    notes,
    googleEventId: event.id.slice(0, BOOKING_FIELD_LIMITS.googleEventId),
    googleCalendarId: calendarId.slice(0, BOOKING_FIELD_LIMITS.googleCalendarId),
    googleCalendarName: calendarName.trim().slice(0, BOOKING_FIELD_LIMITS.googleCalendarName),
    importedAt,
  };
}

/**
 * Sorts Google Calendar list entries with primary calendar first, followed by
 * readable shared/secondary calendars alphabetically, and free/busy-only calendars last.
 */
export function sortGoogleCalendars(calendars: GoogleCalendarListItem[]): GoogleCalendarListItem[] {
  return [...calendars].sort((a, b) => {
    if (Boolean(a.primary) !== Boolean(b.primary)) {
      return a.primary ? -1 : 1;
    }
    const aFreeBusy = a.accessRole === 'freeBusyReader';
    const bFreeBusy = b.accessRole === 'freeBusyReader';
    if (aFreeBusy !== bFreeBusy) {
      return aFreeBusy ? 1 : -1;
    }
    const nameA = (a.summaryOverride || a.summary || a.id).toLowerCase();
    const nameB = (b.summaryOverride || b.summary || b.id).toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

/**
 * Filters out cancelled events or events without an ID.
 */
export function filterImportableGoogleEvents(events: GoogleCalendarEvent[]): GoogleCalendarEvent[] {
  return events.filter(
    (ev) => Boolean(ev && ev.id && ev.status !== 'cancelled' && (ev.start?.date || ev.start?.dateTime))
  );
}
