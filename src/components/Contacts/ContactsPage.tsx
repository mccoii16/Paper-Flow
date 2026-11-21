import React, { useMemo, useState } from 'react';
import { Download, Edit3, MessageSquare, Plus, Search, Trash2, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { Lead, LeadStatus } from '../../types/paperflow';
import { formatCsvReport } from '../../utils/automationEngine';
import { LeadStatusText, formatPhp, formatShortDate } from '../Common/StatusLabel';

const STATUS_OPTIONS: Array<'All' | LeadStatus> = [
  'All',
  'New Inquiry',
  'Qualified',
  'Proposal Sent',
  'Booked',
  'Needs Handoff',
  'Archived',
];

function createBlankLead(): Lead {
  return {
    id: `lead-${Date.now()}`,
    name: '',
    messengerHandle: '',
    email: '',
    phone: '',
    eventType: 'Wedding Reception',
    eventDate: '2027-01-15',
    venue: '',
    estimatedValuePhp: 18500,
    status: 'New Inquiry',
    tags: [],
    source: 'Manual Entry',
    lastContactAt: new Date().toISOString(),
    notes: '',
  };
}

export function ContactsPage() {
  const { workspace, upsertLead, deleteLead, openConversationInInbox, notify } = useApp();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | LeadStatus>('All');
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [tagsText, setTagsText] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return workspace.leads.filter((lead) => {
      if (statusFilter !== 'All' && lead.status !== statusFilter) return false;
      if (!q) return true;
      return (
        lead.name.toLowerCase().includes(q) ||
        lead.eventType.toLowerCase().includes(q) ||
        lead.venue.toLowerCase().includes(q) ||
        lead.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [workspace.leads, search, statusFilter]);

  const openModal = (lead: Lead) => {
    setEditingLead({ ...lead });
    setTagsText(lead.tags.join(', '));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLead || !editingLead.name.trim()) return;
    const parsedTags = tagsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    upsertLead({
      ...editingLead,
      name: editingLead.name.trim(),
      tags: parsedTags,
      lastContactAt: new Date().toISOString(),
    });
    setEditingLead(null);
  };

  const handleExportCsv = () => {
    const csv = formatCsvReport(
      ['Name', 'Event Type', 'Event Date', 'Venue', 'Status', 'Estimated Value (PHP)', 'Tags'],
      filtered.map((l) => [
        l.name,
        l.eventType,
        l.eventDate,
        l.venue,
        l.status,
        l.estimatedValuePhp,
        l.tags.join('; '),
      ])
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'paperflow-demo-leads.csv';
    a.click();
    URL.revokeObjectURL(url);
    notify('Exported demo leads CSV', 'success');
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
          <div className="relative sm:max-w-xs w-full">
            <Search
              className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search lead, venue, or tag..."
              aria-label="Search contacts and leads"
              className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-white dark:bg-[#131C31] pl-9 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-pink-500/40"
            />
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#EFEBF3] dark:bg-slate-900 overflow-x-auto max-w-full">
            {STATUS_OPTIONS.map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-white dark:bg-[#131C31] text-[#0F172A] dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-white dark:bg-[#131C31] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => openModal(createBlankLead())}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] dark:bg-pink-600 dark:hover:bg-pink-500 text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Add Lead</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm font-medium text-[#0F172A] dark:text-white">
              No contacts match your current filter
            </p>
            <button
              type="button"
              onClick={() => openModal(createBlankLead())}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0F172A] dark:bg-pink-600 text-white text-xs font-semibold"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add Contact</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[740px] text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E7E4ED] dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Client</th>
                  <th className="py-3 px-4">Event & Venue</th>
                  <th className="py-3 px-4">Event Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Est. Value</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFEBF3] dark:divide-slate-800/80 text-xs">
                {filtered.map((lead) => {
                  const linkedConv = workspace.conversations.find((c) => c.leadId === lead.id);
                  return (
                    <tr
                      key={lead.id}
                      className="hover:bg-pink-50/35 dark:hover:bg-slate-800/35 transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-sm text-[#0F172A] dark:text-white">
                          {lead.name}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                          {lead.tags.length ? lead.tags.join(' · ') : lead.source}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-[#0F172A] dark:text-slate-200">
                          {lead.eventType}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                          {lead.venue || 'Venue TBD'}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {lead.eventDate ? formatShortDate(lead.eventDate) : 'TBD'}
                      </td>
                      <td className="py-3.5 px-4">
                        <LeadStatusText status={lead.status} />
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold tabular-nums text-[#0F172A] dark:text-slate-100 whitespace-nowrap">
                        {formatPhp(lead.estimatedValuePhp)}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          {linkedConv && (
                            <button
                              type="button"
                              onClick={() => openConversationInInbox(linkedConv.id)}
                              title="Open simulated thread in Inbox"
                              aria-label={`Open inbox thread for ${lead.name}`}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-pink-600 dark:hover:text-pink-300 hover:bg-pink-50 dark:hover:bg-slate-800"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openModal(lead)}
                            aria-label={`Edit ${lead.name}`}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-[#0F172A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteLead(lead.id)}
                            aria-label={`Delete ${lead.name}`}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-slate-800"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Lead Modal */}
      {editingLead && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lead-modal-title"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 id="lead-modal-title" className="font-display text-lg font-bold text-[#0F172A] dark:text-white">
                {workspace.leads.some((l) => l.id === editingLead.id) ? 'Edit Contact' : 'New Contact'}
              </h2>
              <button
                type="button"
                onClick={() => setEditingLead(null)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="lead-name" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Client Name
                  </label>
                  <input
                    id="lead-name"
                    type="text"
                    required
                    value={editingLead.name}
                    onChange={(e) => setEditingLead({ ...editingLead, name: e.target.value })}
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="lead-status" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Lead Status
                  </label>
                  <select
                    id="lead-status"
                    value={editingLead.status}
                    onChange={(e) =>
                      setEditingLead({ ...editingLead, status: e.target.value as LeadStatus })
                    }
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                  >
                    {STATUS_OPTIONS.filter((s) => s !== 'All').map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="lead-event" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Event Type
                  </label>
                  <input
                    id="lead-event"
                    type="text"
                    value={editingLead.eventType}
                    onChange={(e) => setEditingLead({ ...editingLead, eventType: e.target.value })}
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="lead-date" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Event Date
                  </label>
                  <input
                    id="lead-date"
                    type="date"
                    value={editingLead.eventDate}
                    onChange={(e) => setEditingLead({ ...editingLead, eventDate: e.target.value })}
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="lead-venue" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Venue
                  </label>
                  <input
                    id="lead-venue"
                    type="text"
                    value={editingLead.venue}
                    onChange={(e) => setEditingLead({ ...editingLead, venue: e.target.value })}
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="lead-value" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Estimated Value (PHP)
                  </label>
                  <input
                    id="lead-value"
                    type="number"
                    min={0}
                    step={500}
                    value={editingLead.estimatedValuePhp}
                    onChange={(e) =>
                      setEditingLead({
                        ...editingLead,
                        estimatedValuePhp: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="lead-tags" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Tags (comma separated)
                </label>
                <input
                  id="lead-tags"
                  type="text"
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="lead-notes" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Notes
                </label>
                <textarea
                  id="lead-notes"
                  rows={2}
                  value={editingLead.notes}
                  onChange={(e) => setEditingLead({ ...editingLead, notes: e.target.value })}
                  className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingLead(null)}
                  className="px-4 py-2 rounded-xl border border-[#E7E4ED] dark:border-slate-700 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#0F172A] dark:bg-pink-600 text-white font-semibold"
                >
                  Save Contact
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
