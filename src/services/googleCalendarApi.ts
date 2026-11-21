import {
  filterImportableGoogleEvents,
  sortGoogleCalendars,
  type GoogleCalendarEvent,
  type GoogleCalendarListItem,
} from '../utils/googleCalendarImport';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

export class GoogleCalendarApiError extends Error {
  status: number;
  isAuthError: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'GoogleCalendarApiError';
    this.status = status;
    this.isAuthError = status === 401 || status === 403;
  }
}

async function parseGoogleErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as {
      error?: { message?: string; status?: string };
    };
    if (body?.error?.message) {
      return body.error.message;
    }
  } catch {
    // Ignore JSON parse errors
  }
  return `${fallback} (HTTP ${res.status})`;
}

/**
 * Lists all calendars visible in the connected user's Google Calendar sidebar,
 * including calendars shared with them from another email address.
 */
export async function fetchGoogleCalendars(
  accessToken: string
): Promise<GoogleCalendarListItem[]> {
  const url = new URL(`${CALENDAR_API_BASE}/users/me/calendarList`);
  url.searchParams.set('showHidden', 'false');
  url.searchParams.set('maxResults', '100');

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const msg = await parseGoogleErrorMessage(res, 'Could not load Google Calendars');
    throw new GoogleCalendarApiError(msg, res.status);
  }

  const data = (await res.json()) as { items?: GoogleCalendarListItem[] };
  return sortGoogleCalendars(data.items ?? []);
}

/**
 * Reads upcoming/range events from the chosen Google Calendar (strictly read-only GET).
 */
export async function fetchGoogleCalendarEvents(
  accessToken: string,
  params: {
    calendarId: string;
    timeMinIso: string;
    timeMaxIso: string;
    maxEvents?: number;
  }
): Promise<GoogleCalendarEvent[]> {
  const maxEvents = params.maxEvents ?? 250;
  const collected: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;

  while (collected.length < maxEvents) {
    const url = new URL(
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(params.calendarId)}/events`
    );
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('timeMin', params.timeMinIso);
    url.searchParams.set('timeMax', params.timeMaxIso);
    url.searchParams.set('maxResults', String(Math.min(250, maxEvents - collected.length)));
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const msg = await parseGoogleErrorMessage(res, 'Could not read events from Google Calendar');
      throw new GoogleCalendarApiError(msg, res.status);
    }

    const data = (await res.json()) as {
      items?: GoogleCalendarEvent[];
      nextPageToken?: string;
    };

    const pageItems = filterImportableGoogleEvents(data.items ?? []);
    collected.push(...pageItems);

    if (!data.nextPageToken || pageItems.length === 0) {
      break;
    }
    pageToken = data.nextPageToken;
  }

  return collected;
}
