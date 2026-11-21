import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  LogOut,
  MapPin,
  RefreshCw,
  Search,
  Share2,
  X,
} from 'lucide-react';
import type { Booking, BookingStatus } from '../../types/paperflow';
import {
  clearGoogleCalendarToken,
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  getCachedGoogleCalendarAccountEmail,
  getCachedGoogleCalendarToken,
} from '../../services/googleCalendarAuth';
import {
  fetchGoogleCalendarEvents,
  fetchGoogleCalendars,
  GoogleCalendarApiError,
} from '../../services/googleCalendarApi';
import {
  extractEventDateAndTime,
  findExistingImportedBooking,
  inferClientNameFromEvent,
  inferPackageNameFromEvent,
  mapGoogleEventToBooking,
  type GoogleCalendarEvent,
  type GoogleCalendarListItem,
} from '../../utils/googleCalendarImport';
import { formatShortDate } from '../Common/StatusLabel';

type DateRangePreset = 'next_30' | 'next_90' | 'next_365' | 'past_30_next_90' | 'custom';

interface GoogleCalendarImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingBookings: Booking[];
  packageNames: string[];
  studioEmail?: string;
  onImportBookings: (
    bookings: Booking[]
  ) => Promise<{ created: number; updated: number; failed: number }>;
}

function toLocalDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function computePresetDates(preset: Exclude<DateRangePreset, 'custom'>): {
  startDate: string;
  endDate: string;
} {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  if (preset === 'next_30') {
    end.setDate(end.getDate() + 30);
  } else if (preset === 'next_90') {
    end.setDate(end.getDate() + 90);
  } else if (preset === 'next_365') {
    end.setDate(end.getDate() + 365);
  } else {
    start.setDate(start.getDate() - 30);
    end.setDate(end.getDate() + 90);
  }

  return {
    startDate: toLocalDateInput(start),
    endDate: toLocalDateInput(end),
  };
}

export function GoogleCalendarImportModal({
  isOpen,
  onClose,
  existingBookings,
  packageNames,
  studioEmail,
  onImportBookings,
}: GoogleCalendarImportModalProps) {
  const initialRange = useMemo(() => computePresetDates('next_90'), []);
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    getCachedGoogleCalendarToken()
  );
  const [connectedEmail, setConnectedEmail] = useState<string | null>(() =>
    getCachedGoogleCalendarAccountEmail()
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoadingCalendars, setIsLoadingCalendars] = useState(false);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const [calendars, setCalendars] = useState<GoogleCalendarListItem[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('');
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());

  const [rangePreset, setRangePreset] = useState<DateRangePreset>('next_90');
  const [startDate, setStartDate] = useState<string>(initialRange.startDate);
  const [endDate, setEndDate] = useState<string>(initialRange.endDate);
  const [defaultStatus, setDefaultStatus] = useState<BookingStatus>('Confirmed');
  const [defaultPackage, setDefaultPackage] = useState<string>(
    packageNames[0] || 'Google Calendar Booking'
  );
  const [updateExisting, setUpdateExisting] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showShareGuide, setShowShareGuide] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isImporting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isImporting, onClose]);

  useEffect(() => {
    if (isOpen) {
      setAccessToken(getCachedGoogleCalendarToken());
      setConnectedEmail(getCachedGoogleCalendarAccountEmail());
    }
  }, [isOpen]);

  const selectedCalendar = useMemo(
    () => calendars.find((c) => c.id === selectedCalendarId) ?? null,
    [calendars, selectedCalendarId]
  );

  const loadCalendars = useCallback(async (token: string) => {
    setIsLoadingCalendars(true);
    setErrorMessage(null);
    setNeedsReconnect(false);
    try {
      const list = await fetchGoogleCalendars(token);
      setCalendars(list);
      setSelectedCalendarId((prev) => {
        if (prev && list.some((c) => c.id === prev)) return prev;
        // Prefer a readable non-primary shared calendar if only one exists? Keep primary or first readable selected by default
        const firstReadable = list.find((c) => c.accessRole !== 'freeBusyReader');
        return firstReadable?.id ?? list[0]?.id ?? '';
      });
    } catch (err) {
      if (err instanceof GoogleCalendarApiError && err.isAuthError) {
        clearGoogleCalendarToken();
        setAccessToken(null);
        setNeedsReconnect(true);
        setErrorMessage(
          'Your Google Calendar session expired or permission was revoked. Please sign in again.'
        );
      } else {
        setErrorMessage(
          err instanceof Error ? err.message : 'Unable to load Google Calendars.'
        );
      }
    } finally {
      setIsLoadingCalendars(false);
    }
  }, []);

  const loadEvents = useCallback(
    async (token: string, calendarId: string, rangeStart: string, rangeEnd: string) => {
      if (!calendarId || !rangeStart || !rangeEnd) return;
      const startObj = new Date(`${rangeStart}T00:00:00+08:00`);
      const endObj = new Date(`${rangeEnd}T23:59:59+08:00`);
      if (Number.isNaN(startObj.getTime()) || Number.isNaN(endObj.getTime()) || startObj > endObj) {
        setErrorMessage('Please choose an end date on or after the start date.');
        setEvents([]);
        return;
      }

      setIsLoadingEvents(true);
      setErrorMessage(null);
      setNeedsReconnect(false);
      try {
        const fetched = await fetchGoogleCalendarEvents(token, {
          calendarId,
          timeMinIso: startObj.toISOString(),
          timeMaxIso: endObj.toISOString(),
        });
        setEvents(fetched);

        // Pre-select events that have not yet been imported
        const preselected = new Set<string>();
        for (const ev of fetched) {
          const existing = findExistingImportedBooking(existingBookings, calendarId, ev.id);
          if (!existing || updateExisting) {
            preselected.add(ev.id);
          }
        }
        setSelectedEventIds(preselected);
      } catch (err) {
        setEvents([]);
        if (err instanceof GoogleCalendarApiError && err.isAuthError) {
          clearGoogleCalendarToken();
          setAccessToken(null);
          setNeedsReconnect(true);
          setErrorMessage(
            'Google Calendar permission expired or was denied for this calendar. Please reconnect.'
          );
        } else {
          setErrorMessage(
            err instanceof Error ? err.message : 'Unable to fetch events from this calendar.'
          );
        }
      } finally {
        setIsLoadingEvents(false);
      }
    },
    [existingBookings, updateExisting]
  );

  // Load calendars once connected
  useEffect(() => {
    if (!isOpen || !accessToken) return;
    if (calendars.length === 0) {
      void loadCalendars(accessToken);
    }
  }, [isOpen, accessToken, calendars.length, loadCalendars]);

  // Load events whenever calendar or date range changes
  useEffect(() => {
    if (!isOpen || !accessToken || !selectedCalendarId) return;
    if (selectedCalendar?.accessRole === 'freeBusyReader') {
      setEvents([]);
      setSelectedEventIds(new Set());
      return;
    }
    void loadEvents(accessToken, selectedCalendarId, startDate, endDate);
  }, [
    isOpen,
    accessToken,
    selectedCalendarId,
    selectedCalendar?.accessRole,
    startDate,
    endDate,
    loadEvents,
  ]);

  const handleConnect = async () => {
    setIsConnecting(true);
    setErrorMessage(null);
    setNeedsReconnect(false);
    try {
      const { accessToken: token, email } = await connectGoogleCalendar();
      setAccessToken(token);
      setConnectedEmail(email);
      setCalendars([]);
      await loadCalendars(token);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Could not connect to Google Calendar. Please allow popups and try again.';
      setErrorMessage(msg);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await disconnectGoogleCalendar();
    setAccessToken(null);
    setConnectedEmail(null);
    setCalendars([]);
    setSelectedCalendarId('');
    setEvents([]);
    setSelectedEventIds(new Set());
    setErrorMessage(null);
    setNeedsReconnect(false);
  };

  const handlePresetChange = (preset: DateRangePreset) => {
    setRangePreset(preset);
    if (preset !== 'custom') {
      const next = computePresetDates(preset);
      setStartDate(next.startDate);
      setEndDate(next.endDate);
    }
  };

  const eventRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return events
      .map((ev) => {
        const existing = selectedCalendarId
          ? findExistingImportedBooking(existingBookings, selectedCalendarId, ev.id)
          : undefined;
        const { eventDate, eventTime, isAllDay } = extractEventDateAndTime(ev, 'Asia/Manila');
        const inferredClient = inferClientNameFromEvent(ev);
        const inferredPackage = inferPackageNameFromEvent(ev, packageNames, defaultPackage);
        return {
          event: ev,
          existing,
          eventDate,
          eventTime,
          isAllDay,
          inferredClient,
          inferredPackage,
        };
      })
      .filter((row) => {
        if (!query) return true;
        const haystack = [
          row.event.summary,
          row.event.location,
          row.inferredClient,
          row.inferredPackage,
          row.eventDate,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      });
  }, [events, existingBookings, selectedCalendarId, packageNames, defaultPackage, searchQuery]);

  const selectableRows = useMemo(
    () => eventRows.filter((r) => !r.existing || updateExisting),
    [eventRows, updateExisting]
  );

  const selectedVisibleCount = useMemo(
    () => selectableRows.filter((r) => selectedEventIds.has(r.event.id)).length,
    [selectableRows, selectedEventIds]
  );

  const toggleEvent = (eventId: string) => {
    setSelectedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    setSelectedEventIds((prev) => {
      const next = new Set(prev);
      for (const row of selectableRows) {
        next.add(row.event.id);
      }
      return next;
    });
  };

  const handleClearVisible = () => {
    setSelectedEventIds((prev) => {
      const next = new Set(prev);
      for (const row of selectableRows) {
        next.delete(row.event.id);
      }
      return next;
    });
  };

  const handleImportSelected = async () => {
    if (!selectedCalendar || selectedVisibleCount === 0) return;
    setIsImporting(true);
    setErrorMessage(null);
    try {
      const calendarName =
        selectedCalendar.summaryOverride || selectedCalendar.summary || selectedCalendar.id;
      const toImport: Booking[] = selectableRows
        .filter((row) => selectedEventIds.has(row.event.id))
        .map((row) =>
          mapGoogleEventToBooking({
            event: row.event,
            calendarId: selectedCalendar.id,
            calendarName,
            defaults: {
              defaultStatus,
              defaultPackage,
              availablePackages: packageNames,
              timeZone: 'Asia/Manila',
            },
            existingBooking: row.existing,
          })
        );

      const result = await onImportBookings(toImport);
      if (result.created + result.updated > 0) {
        onClose();
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to import selected bookings.'
      );
    } finally {
      setIsImporting(false);
    }
  };

  if (!isOpen) return null;

  const targetShareEmail = studioEmail?.trim() || '';
  const targetShareLabel = targetShareEmail || 'your Google account';
  const isFreeBusyOnly = selectedCalendar?.accessRole === 'freeBusyReader';

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gcal-import-title"
    >
      <div className="w-full max-w-3xl rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E7E4ED] dark:border-slate-800 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-pink-600 dark:text-pink-400" aria-hidden="true" />
              <h2
                id="gcal-import-title"
                className="font-display text-lg font-bold text-[#0F172A] dark:text-white"
              >
                Import from Google Calendar
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Read-only import from your primary or shared Google Calendars into PaperFlow Bookings.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isImporting}
            aria-label="Close Google Calendar import dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Option 1 Shared Calendar Guide */}
          <div className="rounded-xl border border-[#E7E4ED] dark:border-slate-800 bg-[#FAF8FB] dark:bg-[#0B1120] px-4 py-3">
            <button
              type="button"
              onClick={() => setShowShareGuide((v) => !v)}
              aria-expanded={showShareGuide}
              className="w-full flex items-start justify-between gap-2 text-left text-xs font-semibold text-[#0F172A] dark:text-slate-100"
            >
              <span className="inline-flex items-start gap-2">
                <Share2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-pink-600 dark:text-pink-400" aria-hidden="true" />
                <span>Using a different email for bookings? Share it with {targetShareLabel}</span>
              </span>
              {showShareGuide ? (
                <ChevronUp className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
              )}
            </button>
            {showShareGuide && (
              <ol className="mt-2.5 ml-5 list-decimal space-y-1 text-xs text-slate-600 dark:text-slate-300">
                <li>
                  Open <strong>Google Calendar</strong> on your bookings email and open{' '}
                  <strong>Settings and sharing</strong> for that calendar.
                </li>
                <li>
                  Under <strong>Share with specific people or groups</strong>, add{' '}
                  {targetShareEmail ? (
                    <span className="font-mono text-[11px] font-semibold text-[#0F172A] dark:text-white">
                      {targetShareEmail}
                    </span>
                  ) : (
                    <strong>your PaperFlow Google email</strong>
                  )}{' '}
                  with permission <strong>See all event details</strong>.
                </li>
                <li>
                  Click <strong>Refresh calendars</strong> below and pick the shared bookings calendar from the dropdown.
                </li>
              </ol>
            )}
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2.5"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
              <div className="flex-1">
                <p className="font-medium">{errorMessage}</p>
                {needsReconnect && (
                  <button
                    type="button"
                    onClick={handleConnect}
                    className="mt-2 inline-flex items-center gap-1.5 font-semibold underline"
                  >
                    Reconnect Google Calendar
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Not Connected State */}
          {!accessToken ? (
            <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-[#FAF8FB]/60 dark:bg-[#0B1120]/60 p-6 sm:p-8 text-center space-y-4">
              <div className="mx-auto h-11 w-11 rounded-2xl bg-pink-50 dark:bg-pink-950/50 border border-pink-100 dark:border-pink-900/60 flex items-center justify-center">
                <Calendar className="h-5 w-5 text-pink-600 dark:text-pink-400" aria-hidden="true" />
              </div>
              <div className="max-w-md mx-auto space-y-1.5">
                <h3 className="font-display text-base font-bold text-[#0F172A] dark:text-white">
                  Connect Google Calendar (Read-Only)
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Sign in with <strong>{targetShareLabel}</strong> to list your primary and shared
                  Google Calendars. PaperFlow only reads events and never edits or deletes anything
                  in Google Calendar.
                </p>
              </div>

              <div className="pt-1 flex justify-center">
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="inline-flex items-center justify-center gap-3 px-5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800 text-sm font-medium text-[#1F1F1F] dark:text-white shadow-xs transition-colors disabled:opacity-60"
                >
                  {isConnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin text-slate-500" aria-hidden="true" />
                  ) : (
                    <svg
                      className="h-4 w-4 shrink-0"
                      viewBox="0 0 48 48"
                      aria-hidden="true"
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                  )}
                  <span>{isConnecting ? 'Connecting to Google...' : 'Sign in with Google'}</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Connected Account Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/25 px-3.5 py-2.5 text-xs">
                <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-200 min-w-0">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="truncate">
                    Connected: <strong>{connectedEmail || 'Google Calendar'}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void loadCalendars(accessToken)}
                    disabled={isLoadingCalendars}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-emerald-300/80 dark:border-emerald-800 bg-white dark:bg-slate-900 text-emerald-900 dark:text-emerald-200 font-medium hover:bg-emerald-50 dark:hover:bg-slate-800 disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${isLoadingCalendars ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>Refresh calendars</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDisconnect()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 font-medium"
                  >
                    <LogOut className="h-3 w-3" aria-hidden="true" />
                    <span>Disconnect</span>
                  </button>
                </div>
              </div>

              {/* Calendar Picker + Range Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label
                    htmlFor="gcal-select"
                    className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Source Calendar
                  </label>
                  <select
                    id="gcal-select"
                    value={selectedCalendarId}
                    onChange={(e) => setSelectedCalendarId(e.target.value)}
                    disabled={isLoadingCalendars || calendars.length === 0}
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm text-[#0F172A] dark:text-white"
                  >
                    {calendars.length === 0 ? (
                      <option value="">
                        {isLoadingCalendars ? 'Loading calendars...' : 'No calendars found'}
                      </option>
                    ) : (
                      calendars.map((cal) => {
                        const label = cal.summaryOverride || cal.summary || cal.id;
                        const tag = cal.primary
                          ? 'Primary'
                          : cal.accessRole === 'freeBusyReader'
                          ? 'Shared — Free/Busy only'
                          : 'Shared';
                        return (
                          <option key={cal.id} value={cal.id}>
                            {label} ({tag})
                          </option>
                        );
                      })
                    )}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="gcal-range-preset"
                    className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Date Range
                  </label>
                  <select
                    id="gcal-range-preset"
                    value={rangePreset}
                    onChange={(e) => handlePresetChange(e.target.value as DateRangePreset)}
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm text-[#0F172A] dark:text-white"
                  >
                    <option value="next_30">Next 30 days</option>
                    <option value="next_90">Next 90 days</option>
                    <option value="next_365">Next 12 months</option>
                    <option value="past_30_next_90">Past 30 days → Next 90 days</option>
                    <option value="custom">Custom dates...</option>
                  </select>
                </div>
              </div>

              {rangePreset === 'custom' && (
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label
                      htmlFor="gcal-start-date"
                      className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      From
                    </label>
                    <input
                      id="gcal-start-date"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="gcal-end-date"
                      className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      To
                    </label>
                    <input
                      id="gcal-end-date"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}

              {/* Free/Busy Permission Warning */}
              {isFreeBusyOnly && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                  <div>
                    <p className="font-semibold">This calendar is shared as Free/Busy only</p>
                    <p className="mt-0.5 leading-relaxed">
                      Google Calendar hides event titles, venues, and descriptions under Free/Busy
                      sharing. In your bookings email&apos;s Google Calendar settings, change{' '}
                      <strong>{targetShareLabel}</strong>&apos;s permission to{' '}
                      <strong>See all event details</strong>, then click{' '}
                      <strong>Refresh calendars</strong>.
                    </p>
                  </div>
                </div>
              )}

              {/* Import Defaults Row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label
                    htmlFor="gcal-default-status"
                    className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Default Status (New Bookings)
                  </label>
                  <select
                    id="gcal-default-status"
                    value={defaultStatus}
                    onChange={(e) => setDefaultStatus(e.target.value as BookingStatus)}
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm text-[#0F172A] dark:text-white"
                  >
                    <option value="Confirmed">Confirmed</option>
                    <option value="Pending Deposit">Pending Deposit</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="gcal-default-package"
                    className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Fallback Package
                  </label>
                  <input
                    id="gcal-default-package"
                    type="text"
                    list="gcal-packages-datalist"
                    value={defaultPackage}
                    onChange={(e) => setDefaultPackage(e.target.value)}
                    placeholder="Google Calendar Booking"
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm text-[#0F172A] dark:text-white"
                  />
                  <datalist id="gcal-packages-datalist">
                    {packageNames.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </div>

                <div className="flex items-end">
                  <label className="w-full flex items-center gap-2 rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={updateExisting}
                      onChange={(e) => setUpdateExisting(e.target.checked)}
                      className="rounded border-slate-300 text-pink-600 focus:ring-pink-500"
                    />
                    <span className="text-xs text-slate-700 dark:text-slate-200 leading-tight">
                      Update already-imported events
                    </span>
                  </label>
                </div>
              </div>

              {/* Search & Bulk Selection Bar */}
              {!isFreeBusyOnly && (
                <div className="space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="relative flex-1">
                      <Search
                        className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filter events by title, client, or venue..."
                        aria-label="Filter calendar events"
                        className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] pl-8 pr-3 py-1.5 text-xs text-[#0F172A] dark:text-white"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs shrink-0">
                      <button
                        type="button"
                        onClick={handleSelectAllVisible}
                        disabled={selectableRows.length === 0}
                        className="px-2.5 py-1.5 rounded-lg border border-[#E7E4ED] dark:border-slate-700 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                      >
                        Select all ({selectableRows.length})
                      </button>
                      <button
                        type="button"
                        onClick={handleClearVisible}
                        disabled={selectedVisibleCount === 0}
                        className="px-2.5 py-1.5 rounded-lg border border-[#E7E4ED] dark:border-slate-700 font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* Events List */}
                  <div className="rounded-xl border border-[#E7E4ED] dark:border-slate-800 divide-y divide-[#EFEBF3] dark:divide-slate-800/80 max-h-72 overflow-y-auto">
                    {isLoadingEvents ? (
                      <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-pink-600" aria-hidden="true" />
                        <span>Loading calendar events...</span>
                      </div>
                    ) : eventRows.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1">
                        <p className="font-medium text-[#0F172A] dark:text-slate-200">
                          No events found in this date range
                        </p>
                        <p>Try picking a different calendar above or widening the date range.</p>
                      </div>
                    ) : (
                      eventRows.map((row) => {
                        const isLockedDuplicate = Boolean(row.existing && !updateExisting);
                        const isChecked = !isLockedDuplicate && selectedEventIds.has(row.event.id);
                        return (
                          <label
                            key={row.event.id}
                            className={`flex items-start gap-3 px-3.5 py-3 text-xs transition-colors ${
                              isLockedDuplicate
                                ? 'opacity-60 bg-slate-50/70 dark:bg-slate-900/40 cursor-not-allowed'
                                : 'hover:bg-pink-50/35 dark:hover:bg-slate-800/40 cursor-pointer'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={isLockedDuplicate}
                              onChange={() => toggleEvent(row.event.id)}
                              className="mt-0.5 rounded border-slate-300 text-pink-600 focus:ring-pink-500"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold text-sm text-[#0F172A] dark:text-white truncate">
                                  {row.event.summary?.trim() || 'Untitled Calendar Event'}
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {row.isAllDay && (
                                    <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                                      All-day
                                    </span>
                                  )}
                                  {row.existing && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                      <Check className="h-2.5 w-2.5" aria-hidden="true" />
                                      <span>
                                        {updateExisting ? 'Will update' : 'Already imported'}
                                      </span>
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                                <span className="font-mono tabular-nums font-medium text-pink-700 dark:text-pink-300">
                                  {formatShortDate(row.eventDate)} · {row.eventTime}
                                </span>
                                <span>Client: {row.inferredClient}</span>
                                {row.event.location && (
                                  <span className="inline-flex items-center gap-1 truncate max-w-[240px]">
                                    <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                                    <span className="truncate">{row.event.location}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[#E7E4ED] dark:border-slate-800 bg-[#FAF8FB]/60 dark:bg-[#0B1120]/60 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {accessToken
              ? `${selectedVisibleCount} event${selectedVisibleCount === 1 ? '' : 's'} selected for import`
              : 'Your existing PaperFlow bookings will stay untouched.'}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="px-4 py-2 rounded-xl border border-[#E7E4ED] dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50"
            >
              Cancel
            </button>
            {accessToken && (
              <button
                type="button"
                onClick={() => void handleImportSelected()}
                disabled={isImporting || selectedVisibleCount === 0 || isFreeBusyOnly}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] dark:bg-pink-600 dark:hover:bg-pink-500 text-white text-xs font-semibold disabled:opacity-40"
              >
                {isImporting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                <span>
                  {isImporting
                    ? 'Importing...'
                    : `Import ${selectedVisibleCount} Event${selectedVisibleCount === 1 ? '' : 's'}`}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
