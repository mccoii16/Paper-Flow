import test from 'node:test';
import assert from 'node:assert/strict';
import type { Booking } from '../types/paperflow.js';
import {
  BOOKING_FIELD_LIMITS,
  buildGoogleBookingId,
  extractEventDateAndTime,
  filterImportableGoogleEvents,
  findExistingImportedBooking,
  inferClientNameFromEvent,
  inferPackageNameFromEvent,
  mapGoogleEventToBooking,
  sortGoogleCalendars,
  stripHtmlToPlainText,
  type GoogleCalendarEvent,
} from './googleCalendarImport.js';

test('buildGoogleBookingId produces deterministic Firestore-safe IDs', () => {
  const id1 = buildGoogleBookingId('bookings@paperdreams.ph', 'evt_12345@google.com');
  const id2 = buildGoogleBookingId('bookings@paperdreams.ph', 'evt_12345@google.com');
  const idOtherCal = buildGoogleBookingId('other@paperdreams.ph', 'evt_12345@google.com');

  assert.equal(id1, id2);
  assert.notEqual(id1, idOtherCal);
  assert.match(id1, /^[a-zA-Z0-9_-]{1,128}$/);
  assert.ok(id1.length <= 128);
});

test('extractEventDateAndTime handles Asia/Manila timed events and all-day events', () => {
  // 2027-04-10T09:30:00Z is 17:30 in Asia/Manila (UTC+8)
  const timedEvent: GoogleCalendarEvent = {
    id: 'evt-timed',
    summary: 'Cruz Wedding',
    start: { dateTime: '2027-04-10T09:30:00Z' },
  };
  const timed = extractEventDateAndTime(timedEvent, 'Asia/Manila');
  assert.equal(timed.eventDate, '2027-04-10');
  assert.equal(timed.eventTime, '17:30');
  assert.equal(timed.isAllDay, false);

  const allDayEvent: GoogleCalendarEvent = {
    id: 'evt-allday',
    summary: 'Full Day Corporate Expo',
    start: { date: '2027-05-02' },
  };
  const allDay = extractEventDateAndTime(allDayEvent, 'Asia/Manila');
  assert.equal(allDay.eventDate, '2027-05-02');
  assert.equal(allDay.eventTime, '09:00');
  assert.equal(allDay.isAllDay, true);
});

test('stripHtmlToPlainText removes Google Calendar HTML markup cleanly', () => {
  const html = '<p>Client: <b>Maria &amp; Jose</b></p><br><div>Setup at 4:00 PM &nbsp;Sharp</div>';
  assert.equal(stripHtmlToPlainText(html), 'Client: Maria & Jose\n\nSetup at 4:00 PM Sharp');
});

test('inferClientNameFromEvent prioritizes non-organizer attendee, then description label, then title', () => {
  const withAttendee: GoogleCalendarEvent = {
    id: 'e1',
    summary: 'Wedding Reception',
    attendees: [
      { email: 'owner@studio.com', displayName: 'Studio Owner', organizer: true, self: true },
      { email: 'claire@example.com', displayName: 'Claire Mendoza' },
    ],
  };
  assert.equal(inferClientNameFromEvent(withAttendee), 'Claire Mendoza');

  const withDescriptionClient: GoogleCalendarEvent = {
    id: 'e2',
    summary: 'Photobooth Booking',
    description: 'Client: Bea Alonzo\nVenue: Radisson Blu Cebu',
  };
  assert.equal(inferClientNameFromEvent(withDescriptionClient), 'Bea Alonzo');

  const withDashTitle: GoogleCalendarEvent = {
    id: 'e3',
    summary: 'Reyes Family - 18th Debut',
  };
  assert.equal(inferClientNameFromEvent(withDashTitle), 'Reyes Family');
});

test('inferPackageNameFromEvent detects matching studio package title', () => {
  const packages = ['Luxe Mirror Keepsake Booth', '360 Video Booth Package'];
  const ev: GoogleCalendarEvent = {
    id: 'e-pkg',
    summary: 'Santos Wedding',
    description: 'Booked the luxe mirror keepsake booth for 4 hours.',
  };
  assert.equal(
    inferPackageNameFromEvent(ev, packages, 'Google Calendar Booking'),
    'Luxe Mirror Keepsake Booth'
  );
  assert.equal(
    inferPackageNameFromEvent({ id: 'e-none', summary: 'Birthday Party' }, packages, 'Custom Booth'),
    'Custom Booth'
  );
});

test('mapGoogleEventToBooking maps fields, enforces schema limits, and preserves financial edits on re-import', () => {
  const longText = 'X'.repeat(2500);
  const ev: GoogleCalendarEvent = {
    id: 'evt-999',
    summary: 'Dela Cruz Wedding - Mirror Booth',
    location: 'Shangri-La Mactan, Cebu',
    description: `<p>${longText}</p>`,
    start: { dateTime: '2027-06-15T18:00:00+08:00' },
  };

  const created = mapGoogleEventToBooking({
    event: ev,
    calendarId: 'bookings@paperdreams.ph',
    calendarName: 'Studio Bookings',
    defaults: {
      defaultStatus: 'Confirmed',
      defaultPackage: 'Luxe Mirror Keepsake Booth',
      availablePackages: ['Luxe Mirror Keepsake Booth'],
    },
    importedAtIso: '2027-01-01T10:00:00.000Z',
  });

  assert.equal(created.eventTitle, 'Dela Cruz Wedding - Mirror Booth');
  assert.equal(created.clientName, 'Dela Cruz Wedding');
  assert.equal(created.eventDate, '2027-06-15');
  assert.equal(created.eventTime, '18:00');
  assert.equal(created.venue, 'Shangri-La Mactan, Cebu');
  assert.equal(created.status, 'Confirmed');
  assert.equal(created.notes.length, BOOKING_FIELD_LIMITS.notes);
  assert.equal(created.googleEventId, 'evt-999');
  assert.equal(created.googleCalendarId, 'bookings@paperdreams.ph');
  assert.equal(created.googleCalendarName, 'Studio Bookings');

  // Simulate user editing price/deposit/status in PaperFlow, then re-importing updated event time & venue
  const existingEdited: Booking = {
    ...created,
    clientName: 'Carlo & Mia Dela Cruz',
    totalPhp: 28000,
    depositPaidPhp: 10000,
    status: 'Pending Deposit',
    leadId: 'lead-42',
  };

  const found = findExistingImportedBooking([existingEdited], 'bookings@paperdreams.ph', 'evt-999');
  assert.equal(found?.id, existingEdited.id);

  const updated = mapGoogleEventToBooking({
    event: {
      ...ev,
      location: 'Nustar Resort Cebu',
      start: { dateTime: '2027-06-15T19:00:00+08:00' },
    },
    calendarId: 'bookings@paperdreams.ph',
    calendarName: 'Studio Bookings',
    defaults: {
      defaultStatus: 'Confirmed',
      defaultPackage: 'Luxe Mirror Keepsake Booth',
      availablePackages: ['Luxe Mirror Keepsake Booth'],
    },
    existingBooking: found,
  });

  assert.equal(updated.id, existingEdited.id);
  assert.equal(updated.venue, 'Nustar Resort Cebu');
  assert.equal(updated.eventTime, '19:00');
  // User edits preserved!
  assert.equal(updated.clientName, 'Carlo & Mia Dela Cruz');
  assert.equal(updated.totalPhp, 28000);
  assert.equal(updated.depositPaidPhp, 10000);
  assert.equal(updated.status, 'Pending Deposit');
  assert.equal(updated.leadId, 'lead-42');
});

test('filterImportableGoogleEvents excludes cancelled or undated events and sortGoogleCalendars orders properly', () => {
  const filtered = filterImportableGoogleEvents([
    { id: '1', status: 'confirmed', start: { date: '2027-03-01' } },
    { id: '2', status: 'cancelled', start: { date: '2027-03-02' } },
    { id: '3', status: 'confirmed' },
  ]);
  assert.deepEqual(filtered.map((e) => e.id), ['1']);

  const sorted = sortGoogleCalendars([
    { id: 'fb', summary: 'Busy Only', accessRole: 'freeBusyReader' },
    { id: 'shared', summary: 'Studio Bookings', accessRole: 'reader' },
    { id: 'primary', summary: 'Main Account', primary: true, accessRole: 'owner' },
  ]);
  assert.deepEqual(sorted.map((c) => c.id), ['primary', 'shared', 'fb']);
});
