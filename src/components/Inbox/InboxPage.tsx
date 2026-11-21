import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Plus,
  Search,
  Send,
  Sparkles,
  Tag,
  User,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { LeadStatus } from '../../types/paperflow';
import {
  AvatarMonogram,
  LeadStatusText,
  formatPhp,
  formatShortDate,
  formatShortTime,
} from '../Common/StatusLabel';

const LEAD_STATUSES: LeadStatus[] = [
  'New Inquiry',
  'Qualified',
  'Proposal Sent',
  'Booked',
  'Needs Handoff',
  'Archived',
];

const QUICK_SIM_PROMPTS = [
  'How much is the Luxe Mirror Booth for a wedding?',
  'What is your GCash deposit policy?',
  'We need a rush corporate quote with BIR invoice',
];

export function InboxPage() {
  const {
    workspace,
    selectedConversationId,
    setSelectedConversationId,
    sendManualReply,
    simulateGuestMessage,
    createSimulatedConversation,
    toggleConversationAi,
    updateConversationStatus,
    addConversationTag,
    removeConversationTag,
    markConversationRead,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'handoff' | 'ai' | 'unread'>('all');
  const [replyInput, setReplyInput] = useState('');
  const [simInput, setSimInput] = useState('');
  const [showSimPanel, setShowSimPanel] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [mobileShowThread, setMobileShowThread] = useState(false);

  const filteredConversations = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return workspace.conversations.filter((c) => {
      if (filterMode === 'handoff' && !c.needsHumanHandoff && c.leadStatus !== 'Needs Handoff') {
        return false;
      }
      if (filterMode === 'ai' && !c.aiEnabled) return false;
      if (filterMode === 'unread' && c.unreadCount === 0) return false;
      if (!q) return true;
      return (
        c.guestName.toLowerCase().includes(q) ||
        c.lastMessagePreview.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [workspace.conversations, searchQuery, filterMode]);

  const activeConv =
    workspace.conversations.find((c) => c.id === selectedConversationId) ??
    filteredConversations[0] ??
    workspace.conversations[0];

  const linkedLead = workspace.leads.find((l) => l.id === activeConv?.leadId);

  useEffect(() => {
    if (activeConv && activeConv.unreadCount > 0) {
      markConversationRead(activeConv.id);
    }
  }, [activeConv, markConversationRead]);

  const handleSelectThread = (id: string) => {
    setSelectedConversationId(id);
    setMobileShowThread(true);
  };

  const handleSendManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !replyInput.trim()) return;
    sendManualReply(activeConv.id, replyInput);
    setReplyInput('');
  };

  const handleSimulateIncoming = (textToSend: string) => {
    if (!activeConv || !textToSend.trim()) return;
    simulateGuestMessage(activeConv.id, textToSend);
    setSimInput('');
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !tagInput.trim()) return;
    addConversationTag(activeConv.id, tagInput);
    setTagInput('');
  };

  return (
    <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-[600px] lg:h-[calc(100vh-124px)]">
      {/* Column 1: Conversation List */}
      <section
        aria-label="Conversation Threads"
        className={`lg:col-span-4 xl:col-span-3 border-b lg:border-b-0 lg:border-r border-[#E7E4ED] dark:border-slate-800 flex flex-col min-h-0 ${
          mobileShowThread ? 'hidden lg:flex' : 'flex'
        }`}
      >
        <div className="p-4 border-b border-[#E7E4ED] dark:border-slate-800 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search
                className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search guest or tag..."
                aria-label="Search conversations"
                className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] pl-9 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-pink-500/40"
              />
            </div>
            <button
              type="button"
              onClick={() => void createSimulatedConversation('Cebu Guest Inquiry')}
              title="Create a simulated Messenger test thread"
              className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl border border-[#E7E4ED] dark:border-slate-700 text-xs font-medium text-[#0F172A] dark:text-slate-200 hover:bg-pink-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Test</span>
            </button>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#F4F1F6] dark:bg-slate-900 overflow-x-auto">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'handoff', label: 'Handoff' },
                { id: 'ai', label: 'AI On' },
                { id: 'unread', label: 'Unread' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterMode(tab.id)}
                className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  filterMode === tab.id
                    ? 'bg-white dark:bg-[#131C31] text-[#0F172A] dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#EFEBF3] dark:divide-slate-800/70">
          {filteredConversations.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
              <div>No threads match the selected filter.</div>
              <button
                type="button"
                onClick={() => void createSimulatedConversation('Cebu Guest Inquiry')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0F172A] dark:bg-pink-600 text-white text-xs font-semibold"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Create Simulated Thread</span>
              </button>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const selected = activeConv?.id === conv.id;
              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => handleSelectThread(conv.id)}
                  className={`w-full text-left p-4 transition-colors flex items-start gap-3 ${
                    selected
                      ? 'bg-pink-50/70 dark:bg-pink-950/20'
                      : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/30'
                  }`}
                >
                  <AvatarMonogram initials={conv.avatarInitials} tone={conv.avatarTone} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[#0F172A] dark:text-white truncate">
                        {conv.guestName}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-400 shrink-0">
                        {formatShortTime(conv.lastMessageAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                      {conv.lastMessagePreview}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <LeadStatusText status={conv.leadStatus} />
                      <span aria-hidden="true">·</span>
                      <span>{conv.channel === 'Messenger (Live)' ? 'Live Meta' : 'Simulated'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{conv.aiEnabled ? 'AI On' : 'Manual'}</span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* Column 2: Active Simulated Thread */}
      <section
        aria-label="Active Conversation Thread"
        className={`lg:col-span-5 xl:col-span-6 flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-[#E7E4ED] dark:border-slate-800 ${
          mobileShowThread ? 'flex' : 'hidden lg:flex'
        }`}
      >
        {activeConv ? (
          <>
            {/* Thread Header */}
            <div className="px-5 py-3.5 border-b border-[#E7E4ED] dark:border-slate-800 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setMobileShowThread(false)}
                  aria-label="Back to conversation list"
                  className="lg:hidden p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <AvatarMonogram initials={activeConv.avatarInitials} tone={activeConv.avatarTone} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#0F172A] dark:text-white truncate">
                    {activeConv.guestName}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    @{activeConv.messengerHandle} · {activeConv.channel}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {activeConv.channel === 'Messenger (Simulated)' && (
                  <button
                    type="button"
                    onClick={() => setShowSimPanel((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E7E4ED] dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-pink-50/70 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-pink-600 dark:text-pink-400" aria-hidden="true" />
                    <span>Simulate Guest</span>
                  </button>
                )}

                <button
                  type="button"
                  role="switch"
                  aria-checked={activeConv.aiEnabled}
                  aria-label="Toggle AI Auto-Reply for this conversation"
                  onClick={() => void toggleConversationAi(activeConv.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                    activeConv.aiEnabled
                      ? 'bg-pink-600 text-white hover:bg-pink-500'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{activeConv.aiEnabled ? 'AI Auto-Reply: On' : 'AI Auto-Reply: Off'}</span>
                </button>
              </div>
            </div>

            {/* Simulator Panel */}
            {showSimPanel && (
              <div className="px-5 py-3.5 bg-pink-50/70 dark:bg-pink-950/25 border-b border-pink-200/80 dark:border-pink-900/40 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#0F172A] dark:text-pink-100">
                    Simulate Incoming Guest Message (Tests Active Workflows & Knowledge Base)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSimPanel(false)}
                    aria-label="Close guest simulator"
                    className="text-slate-500 hover:text-slate-800 dark:hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {QUICK_SIM_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => handleSimulateIncoming(prompt)}
                      className="text-left px-3 py-1.5 rounded-lg border border-pink-200 dark:border-pink-800/70 bg-white dark:bg-[#131C31] text-xs text-slate-700 dark:text-slate-200 hover:border-pink-400 transition-colors"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={simInput}
                    onChange={(e) => setSimInput(e.target.value)}
                    placeholder="Type custom simulated guest message..."
                    aria-label="Custom simulated guest message"
                    className="flex-1 rounded-xl border border-pink-200 dark:border-pink-800/70 bg-white dark:bg-[#0B1120] px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-pink-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => handleSimulateIncoming(simInput)}
                    className="px-3.5 py-2 rounded-xl bg-[#0F172A] dark:bg-pink-600 text-white text-xs font-medium whitespace-nowrap"
                  >
                    Trigger Message
                  </button>
                </div>
              </div>
            )}

            {/* Message Feed */}
            <div className="flex-1 p-5 overflow-y-auto space-y-4 bg-[#FAF8FB]/60 dark:bg-[#0B1120]/50">
              <div className="text-center text-[11px] text-slate-500 dark:text-slate-400">
                {activeConv.channel === 'Messenger (Live)'
                  ? 'Live Meta Messenger Thread · Manual replies dispatch via Meta Send API'
                  : 'Simulated Messenger Thread · Safe local/Firestore testing (no Meta API delivery)'}
              </div>

              {activeConv.messages.map((msg) => {
                const isGuest = msg.sender === 'guest';
                const isAi = msg.sender === 'ai_sim' || msg.sender === 'ai_live';
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isGuest ? 'items-start' : 'items-end'}`}
                  >
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1.5">
                      {isGuest ? (
                        <User className="h-3 w-3" aria-hidden="true" />
                      ) : isAi ? (
                        <Bot className="h-3 w-3 text-pink-600 dark:text-pink-400" aria-hidden="true" />
                      ) : null}
                      <span>{msg.senderName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{formatShortTime(msg.timestamp)}</span>
                    </div>

                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                        isGuest
                          ? 'bg-white dark:bg-[#131C31] border border-[#E7E4ED] dark:border-slate-800 text-[#0F172A] dark:text-slate-100'
                          : isAi
                          ? 'bg-pink-100/80 dark:bg-pink-950/55 border border-pink-200 dark:border-pink-800/60 text-[#0F172A] dark:text-pink-50'
                          : 'bg-[#0F172A] dark:bg-slate-800 text-white'
                      }`}
                    >
                      {msg.text}
                    </div>

                    {(msg.matchedWorkflowName || msg.matchedKbTitle) && (
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        {[
                          msg.matchedWorkflowName ? `Flow: ${msg.matchedWorkflowName}` : null,
                          msg.matchedKbTitle ? `KB: ${msg.matchedKbTitle}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Manual Reply Composer */}
            <form
              onSubmit={handleSendManual}
              className="p-4 border-t border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] flex items-end gap-3"
            >
              <div className="flex-1">
                <label htmlFor="manual-reply-input" className="sr-only">
                  Manual studio reply
                </label>
                <textarea
                  id="manual-reply-input"
                  rows={2}
                  value={replyInput}
                  onChange={(e) => setReplyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendManual(e);
                    }
                  }}
                  placeholder={`Reply manually as studio coordinator to ${activeConv.guestName}...`}
                  className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-pink-500/40"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] dark:bg-pink-600 dark:hover:bg-pink-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Send Reply</span>
              </button>
            </form>
          </>
        ) : (
          <div className="p-10 text-center text-sm text-slate-500">
            Select a conversation to view messages.
          </div>
        )}
      </section>

      {/* Column 3: Lead Status, Tags & Context */}
      <aside
        aria-label="Lead Details and Tags"
        className="lg:col-span-3 p-5 space-y-6 bg-[#FAF8FB]/40 dark:bg-[#0F172A]/40 overflow-y-auto min-h-0"
      >
        {activeConv && (
          <>
            <div>
              <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-white mb-2">
                Lead Status
              </h2>
              <label htmlFor="inbox-lead-status" className="sr-only">
                Lead status
              </label>
              <select
                id="inbox-lead-status"
                value={activeConv.leadStatus}
                onChange={(e) =>
                  updateConversationStatus(activeConv.id, e.target.value as LeadStatus)
                }
                className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-white dark:bg-[#131C31] px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-pink-500/40"
              >
                {LEAD_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <div className="pt-4 border-t border-[#E7E4ED] dark:border-slate-800">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-[#0F172A] dark:text-white mb-2.5 font-display">
                <Tag className="h-3.5 w-3.5 text-pink-600 dark:text-pink-400" aria-hidden="true" />
                <span>Conversation Tags</span>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {activeConv.tags.length === 0 ? (
                  <span className="text-xs text-slate-500 dark:text-slate-400">No tags applied</span>
                ) : (
                  activeConv.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => removeConversationTag(activeConv.id, tag)}
                      title={`Remove tag ${tag}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#E7E4ED] dark:border-slate-700 bg-white dark:bg-[#131C31] text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-rose-400 transition-colors"
                    >
                      <span>{tag}</span>
                      <X className="h-3 w-3 text-slate-400" aria-hidden="true" />
                    </button>
                  ))
                )}
              </div>

              <form onSubmit={handleAddTag} className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="Add tag..."
                  aria-label="New conversation tag"
                  className="flex-1 min-w-0 rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-white dark:bg-[#0B1120] px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-pink-500/40"
                />
                <button
                  type="submit"
                  aria-label="Add tag"
                  className="p-2 rounded-xl bg-[#0F172A] dark:bg-pink-600 text-white shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </form>
            </div>

            {linkedLead && (
              <div className="pt-4 border-t border-[#E7E4ED] dark:border-slate-800 space-y-3">
                <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-white">
                  Event & Contact Profile
                </h2>
                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">Event</dt>
                    <dd className="font-medium text-right text-[#0F172A] dark:text-slate-200">
                      {linkedLead.eventType}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">Date</dt>
                    <dd className="font-mono tabular-nums text-right text-[#0F172A] dark:text-slate-200">
                      {linkedLead.eventDate ? formatShortDate(linkedLead.eventDate) : 'TBD'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">Venue</dt>
                    <dd className="font-medium text-right text-[#0F172A] dark:text-slate-200">
                      {linkedLead.venue || 'TBD'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">Est. Value</dt>
                    <dd className="font-mono font-semibold tabular-nums text-right text-pink-700 dark:text-pink-300">
                      {formatPhp(linkedLead.estimatedValuePhp)}
                    </dd>
                  </div>
                  <div className="pt-2">
                    <dt className="text-slate-500 dark:text-slate-400 mb-1">Coordinator Notes</dt>
                    <dd className="text-slate-700 dark:text-slate-300 leading-relaxed">
                      {linkedLead.notes}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
