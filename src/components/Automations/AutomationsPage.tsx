import React, { useMemo, useState } from 'react';
import { Copy, GitBranch, Plus, Search, Trash2, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { WorkflowStatus } from '../../types/paperflow';
import { WorkflowStatusText, formatShortDate } from '../Common/StatusLabel';

export function AutomationsPage() {
  const {
    workspace,
    createWorkflow,
    deleteWorkflow,
    toggleWorkflowStatus,
    openWorkflowInBuilder,
  } = useApp();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | WorkflowStatus>('All');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newKeywords, setNewKeywords] = useState('quote, price, package');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return workspace.workflows.filter((wf) => {
      if (statusFilter !== 'All' && wf.status !== statusFilter) return false;
      if (!q) return true;
      return (
        wf.name.toLowerCase().includes(q) ||
        wf.description.toLowerCase().includes(q) ||
        wf.triggerSummary.toLowerCase().includes(q)
      );
    });
  }, [workspace.workflows, search, statusFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const kwList = newKeywords
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const ts = Date.now();
    const n1Id = `n-${ts}-1`;
    const n2Id = `n-${ts}-2`;

    const created = await createWorkflow({
      name: newName.trim(),
      description: newDesc.trim() || 'Custom Messenger automation flow for Paper Dreams Cebu.',
      status: 'Draft',
      triggerSummary: kwList.length
        ? `Keyword contains ${kwList.map((k) => `"${k}"`).join(', ')}`
        : 'Any incoming Messenger message',
      runsSimulated: 0,
      handoffRatePct: 0,
      nodes: [
        {
          id: n1Id,
          type: 'trigger',
          title: 'Messenger Trigger',
          x: 80,
          y: 160,
          config: {
            triggerEvent: 'keyword_match',
            keywords: kwList,
          },
        },
        {
          id: n2Id,
          type: 'send_reply',
          title: 'Send Studio Reply',
          x: 400,
          y: 160,
          config: {
            replyText: 'Hi {{first_name}}! Thanks for messaging Paper Dreams Cebu.',
            useKnowledgeBase: true,
          },
        },
      ],
      edges: [
        {
          id: `e-${ts}`,
          source: n1Id,
          target: n2Id,
          branch: 'default',
        },
      ],
    });

    setShowCreateModal(false);
    setNewName('');
    setNewDesc('');
    openWorkflowInBuilder(created.id);
  };

  const handleDuplicate = (wfId: string) => {
    const source = workspace.workflows.find((w) => w.id === wfId);
    if (!source) return;
    void createWorkflow({
      name: `${source.name} (Copy)`,
      description: source.description,
      status: 'Draft',
      triggerSummary: source.triggerSummary,
      runsSimulated: 0,
      handoffRatePct: source.handoffRatePct,
      nodes: structuredClone(source.nodes),
      edges: structuredClone(source.edges),
    });
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
              placeholder="Search workflows..."
              aria-label="Search automation workflows"
              className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-white dark:bg-[#131C31] pl-9 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-pink-500/40"
            />
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#EFEBF3] dark:bg-slate-900 self-start">
            {(['All', 'Active', 'Paused', 'Draft'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
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

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] dark:bg-pink-600 dark:hover:bg-pink-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>New Workflow</span>
        </button>
      </div>

      {/* Workflows Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-10 text-center space-y-3">
          <p className="text-sm font-medium text-[#0F172A] dark:text-white">
            No automation workflows match your filter
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Create a new Messenger workflow to test triggers, conditions, Knowledge Base replies, and handoffs.
          </p>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0F172A] dark:bg-pink-600 text-white text-xs font-semibold"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Create First Workflow</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((wf) => (
            <article
              key={wf.id}
              className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-5 flex flex-col justify-between gap-5"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display text-base font-bold text-[#0F172A] dark:text-white">
                      {wf.name}
                    </h2>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <WorkflowStatusText status={wf.status} />
                      <span aria-hidden="true">·</span>
                      <span>Updated {formatShortDate(wf.updatedAt)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={wf.status === 'Active'}
                    aria-label={`Toggle ${wf.name}`}
                    onClick={() => toggleWorkflowStatus(wf.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      wf.status === 'Active'
                        ? 'bg-pink-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {wf.status === 'Active' ? 'On' : 'Off'}
                  </button>
                </div>

                <p className="mt-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {wf.description}
                </p>

                <div className="mt-4 pt-3 border-t border-[#EFEBF3] dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 space-y-1">
                  <div className="truncate">Trigger: {wf.triggerSummary}</div>
                  <div className="font-mono tabular-nums">
                    {wf.nodes.length} nodes · {wf.runsSimulated} sim runs · {wf.handoffRatePct}% handoff
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => openWorkflowInBuilder(wf.id)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] dark:bg-pink-600 dark:hover:bg-pink-500 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Open in Builder</span>
                </button>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleDuplicate(wf.id)}
                    aria-label={`Duplicate ${wf.name}`}
                    title="Duplicate workflow"
                    className="p-2 rounded-xl border border-[#E7E4ED] dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteWorkflow(wf.id)}
                    aria-label={`Delete ${wf.name}`}
                    title="Delete workflow"
                    className="p-2 rounded-xl border border-[#E7E4ED] dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-rose-600 hover:border-rose-300 dark:hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-wf-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 id="create-wf-title" className="font-display text-lg font-bold text-[#0F172A] dark:text-white">
                New Automation Workflow
              </h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label htmlFor="wf-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Workflow Name
                </label>
                <input
                  id="wf-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Debut Monogram Inquiry Flow"
                  required
                  className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/40"
                />
              </div>

              <div>
                <label htmlFor="wf-desc" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Description
                </label>
                <textarea
                  id="wf-desc"
                  rows={2}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Describe what Messenger trigger this flow handles..."
                  className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/40"
                />
              </div>

              <div>
                <label htmlFor="wf-kw" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Trigger Keywords (comma separated)
                </label>
                <input
                  id="wf-kw"
                  type="text"
                  value={newKeywords}
                  onChange={(e) => setNewKeywords(e.target.value)}
                  className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/40"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#E7E4ED] dark:border-slate-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#0F172A] dark:bg-pink-600 text-white text-xs font-semibold"
                >
                  Create & Open Builder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
