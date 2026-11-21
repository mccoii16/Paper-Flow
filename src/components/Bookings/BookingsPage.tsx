import React, { useMemo, useState } from 'react';
import { Calendar, Edit3, List, Plus, Trash2, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { Booking, BookingStatus } from '../../types/paperflow';
import { BookingStatusText, formatPhp, formatShortDate } from '../Common/StatusLabel';

const BOOKING_STATUSES: Array<'All' | BookingStatus> = [
  'All',
  'Confirmed',
  'Pending Deposit',
  'Completed',
  'Cancelled',
];

function createBlankBooking(defaultPackage: string): Booking {
  return {
    id: `bk-${Date.now()}`,
    clientName: '',
    eventTitle: '',
    packageName: defaultPackage,
    eventDate: '2027-02-20',
    eventTime: '17:00',
    venue: '',
    totalPhp: 18500,
    depositPaidPhp: 5550,
    status: 'Pending Deposit',
    notes: '',
  };
}

export function BookingsPage() {
  const { workspace, upsertBooking, deleteBooking } = useApp();
  const [viewMode, setViewMode] = useState<'table' | 'timeline'>('table');
  const [statusFilter, setStatusFilter] = useState<'All' | BookingStatus>('All');
  const [editing, setEditing] = useState<Booking | null>(null);

  const packageNames = useMemo(
    () =>
      workspace.knowledgeBase
        .filter((k) => k.category === 'packages')
        .map((k) => k.title),
    [workspace.knowledgeBase]
  );

  const filtered = useMemo(() => {
    const items = workspace.bookings.filter(
      (b) => statusFilter === 'All' || b.status === statusFilter
    );
    return [...items].sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  }, [workspace.bookings, statusFilter]);

  const totalBookedValue = filtered.reduce((sum, b) => sum + b.totalPhp, 0);
  const totalDeposits = filtered.reduce((sum, b) => sum + b.depositPaidPhp, 0);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !editing.clientName.trim() || !editing.eventTitle.trim()) return;
    upsertBooking({
      ...editing,
      clientName: editing.clientName.trim(),
      eventTitle: editing.eventTitle.trim(),
    });
    setEditing(null);
  };

  return (
    <div className="space-y-6">
      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Visible Bookings</div>
          <div className="mt-1 font-display text-xl font-bold tabular-nums text-[#0F172A] dark:text-white">
            {filtered.length}
          </div>
        </div>
        <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Gross Package Value</div>
          <div className="mt-1 font-display text-xl font-bold tabular-nums text-[#0F172A] dark:text-white">
            {formatPhp(totalBookedValue)}
          </div>
        </div>
        <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Deposits Recorded</div>
          <div className="mt-1 font-display text-xl font-bold tabular-nums text-pink-700 dark:text-pink-300">
            {formatPhp(totalDeposits)}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#EFEBF3] dark:bg-slate-900 overflow-x-auto">
          {BOOKING_STATUSES.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-white dark:bg-[#131C31] text-[#0F172A] dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#EFEBF3] dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-[#131C31] text-[#0F172A] dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <List className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Table</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('timeline')}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                viewMode === 'timeline'
                  ? 'bg-white dark:bg-[#131C31] text-[#0F172A] dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Timeline</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() =>
              setEditing(createBlankBooking(packageNames[0] || 'Luxe Mirror Keepsake Booth'))
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] dark:bg-pink-600 dark:hover:bg-pink-500 text-white text-xs font-semibold whitespace-nowrap"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>New Booking</span>
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-10 text-center text-sm text-slate-500">
          No bookings in this status category.
        </div>
      ) : viewMode === 'table' ? (
        <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[740px] text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E7E4ED] dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Event & Client</th>
                  <th className="py-3 px-4">Package</th>
                  <th className="py-3 px-4">Date & Venue</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Total / Deposit</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFEBF3] dark:divide-slate-800/80 text-xs">
                {filtered.map((bk) => (
                  <tr
                    key={bk.id}
                    className="hover:bg-pink-50/35 dark:hover:bg-slate-800/35 transition-colors"
                  >
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-sm text-[#0F172A] dark:text-white">
                        {bk.eventTitle}
                      </div>
                      <div className="text-slate-500 dark:text-slate-400 mt-0.5">{bk.clientName}</div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 dark:text-slate-200">{bk.packageName}</td>
                    <td className="py-3.5 px-4">
                      <div className="font-mono tabular-nums text-[#0F172A] dark:text-slate-200">
                        {formatShortDate(bk.eventDate)} · {bk.eventTime}
                      </div>
                      <div className="text-slate-500 dark:text-slate-400 mt-0.5">{bk.venue}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <BookingStatusText status={bk.status} />
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                      <div className="font-semibold text-[#0F172A] dark:text-white">
                        {formatPhp(bk.totalPhp)}
                      </div>
                      <div className="text-slate-500 dark:text-slate-400">
                        Paid: {formatPhp(bk.depositPaidPhp)}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing({ ...bk })}
                          aria-label={`Edit ${bk.eventTitle}`}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-[#0F172A] dark:hover:text-white"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteBooking(bk.id)}
                          aria-label={`Delete ${bk.eventTitle}`}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 dark:hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((bk) => (
            <article
              key={bk.id}
              className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-5 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono tabular-nums font-semibold text-pink-700 dark:text-pink-300">
                    {formatShortDate(bk.eventDate)} · {bk.eventTime}
                  </span>
                  <BookingStatusText status={bk.status} />
                </div>
                <h2 className="mt-2 font-display text-base font-bold text-[#0F172A] dark:text-white">
                  {bk.eventTitle}
                </h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  {bk.clientName} · {bk.venue}
                </p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{bk.packageName}</p>
              </div>
              <div className="pt-3 border-t border-[#EFEBF3] dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="font-mono tabular-nums font-semibold text-[#0F172A] dark:text-white">
                  {formatPhp(bk.totalPhp)} (Paid {formatPhp(bk.depositPaidPhp)})
                </span>
                <button
                  type="button"
                  onClick={() => setEditing({ ...bk })}
                  className="font-semibold text-pink-700 dark:text-pink-300 hover:underline"
                >
                  Edit
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Booking Modal */}
      {editing && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="booking-modal-title"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 id="booking-modal-title" className="font-display text-lg font-bold text-[#0F172A] dark:text-white">
                {workspace.bookings.some((b) => b.id === editing.id)
                  ? 'Edit Event Booking'
                  : 'New Event Booking'}
              </h2>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="bk-title" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Event Title
                  </label>
                  <input
                    id="bk-title"
                    type="text"
                    required
                    value={editing.eventTitle}
                    onChange={(e) => setEditing({ ...editing, eventTitle: e.target.value })}
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="bk-client" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Client Name
                  </label>
                  <input
                    id="bk-client"
                    type="text"
                    required
                    value={editing.clientName}
                    onChange={(e) => setEditing({ ...editing, clientName: e.target.value })}
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="bk-pkg" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Package
                </label>
                <input
                  id="bk-pkg"
                  type="text"
                  list="kb-packages-list"
                  value={editing.packageName}
                  onChange={(e) => setEditing({ ...editing, packageName: e.target.value })}
                  className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                />
                <datalist id="kb-packages-list">
                  {packageNames.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label htmlFor="bk-date" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Event Date
                  </label>
                  <input
                    id="bk-date"
                    type="date"
                    value={editing.eventDate}
                    onChange={(e) => setEditing({ ...editing, eventDate: e.target.value })}
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="bk-time" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Call Time
                  </label>
                  <input
                    id="bk-time"
                    type="time"
                    value={editing.eventTime}
                    onChange={(e) => setEditing({ ...editing, eventTime: e.target.value })}
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="bk-status" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Status
                  </label>
                  <select
                    id="bk-status"
                    value={editing.status}
                    onChange={(e) =>
                      setEditing({ ...editing, status: e.target.value as BookingStatus })
                    }
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                  >
                    {BOOKING_STATUSES.filter((s) => s !== 'All').map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="bk-venue" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Cebu Venue
                </label>
                <input
                  id="bk-venue"
                  type="text"
                  value={editing.venue}
                  onChange={(e) => setEditing({ ...editing, venue: e.target.value })}
                  className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="bk-total" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Total Amount (PHP)
                  </label>
                  <input
                    id="bk-total"
                    type="number"
                    min={0}
                    step={500}
                    value={editing.totalPhp}
                    onChange={(e) =>
                      setEditing({ ...editing, totalPhp: Number(e.target.value) || 0 })
                    }
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="bk-deposit" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Deposit Paid (PHP)
                  </label>
                  <input
                    id="bk-deposit"
                    type="number"
                    min={0}
                    step={500}
                    value={editing.depositPaidPhp}
                    onChange={(e) =>
                      setEditing({ ...editing, depositPaidPhp: Number(e.target.value) || 0 })
                    }
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="px-4 py-2 rounded-xl border border-[#E7E4ED] dark:border-slate-700 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#0F172A] dark:bg-pink-600 text-white font-semibold"
                >
                  Save Booking
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
