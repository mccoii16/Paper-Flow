import {
  ArrowUpRight,
  Bot,
  CalendarCheck,
  Inbox,
  Settings,
  Users,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { computeDashboardMetrics } from '../../utils/automationEngine';
import {
  AvatarMonogram,
  BookingStatusText,
  LeadStatusText,
  WorkflowStatusText,
  formatPhp,
  formatShortDate,
  formatShortTime,
} from '../Common/StatusLabel';

const WEEKLY_INQUIRY_SERIES = [
  { day: 'Mon', total: 14, automated: 10 },
  { day: 'Tue', total: 19, automated: 14 },
  { day: 'Wed', total: 16, automated: 12 },
  { day: 'Thu', total: 24, automated: 18 },
  { day: 'Fri', total: 29, automated: 21 },
  { day: 'Sat', total: 34, automated: 25 },
  { day: 'Sun', total: 22, automated: 17 },
];

export function OverviewPage() {
  const {
    workspace,
    isDemoMode,
    seedStarterTemplates,
    setActivePage,
    openConversationInInbox,
    openWorkflowInBuilder,
    toggleWorkflowStatus,
    health,
  } = useApp();

  const metrics = computeDashboardMetrics({
    conversations: workspace.conversations,
    workflows: workspace.workflows,
    leads: workspace.leads,
    bookings: workspace.bookings,
  });

  const maxWeekly = Math.max(...WEEKLY_INQUIRY_SERIES.map((d) => d.total), 1);
  const canSeedStarter =
    !isDemoMode && workspace.workflows.length === 0 && workspace.knowledgeBase.length === 0;

  return (
    <div className="space-y-6">
      {/* Honest Workspace & Meta Connection Notice */}
      <div className="rounded-2xl border border-pink-200/80 dark:border-pink-900/50 bg-pink-50/70 dark:bg-pink-950/25 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="text-xs sm:text-sm text-[#0F172A] dark:text-pink-100 leading-relaxed">
          <span className="font-semibold">
            {isDemoMode ? 'Local Demo Workspace:' : 'Firestore Live Workspace:'}
          </span>{' '}
          {isDemoMode
            ? 'Displaying sample Paper Dreams Cebu data.'
            : 'Synced with Cloud Firestore.'}{' '}
          <span className="text-slate-600 dark:text-pink-200/80">
            {health?.metaConnected
              ? 'Meta Messenger webhook and Send API active.'
              : 'Meta Messenger is not connected yet — configure Meta server secrets and App Review before going live.'}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
          {canSeedStarter && (
            <button
              type="button"
              onClick={() => void seedStarterTemplates()}
              className="px-3 py-1.5 rounded-xl bg-[#0F172A] dark:bg-pink-600 text-white text-xs font-semibold whitespace-nowrap"
            >
              Load Starter KB & Flows
            </button>
          )}
          <button
            type="button"
            onClick={() => setActivePage('settings')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-pink-700 dark:text-pink-300 hover:underline whitespace-nowrap"
          >
            <Settings className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Review Readiness</span>
          </button>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <section aria-label="Key Performance Metrics" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>{isDemoMode ? 'Simulated Conversations' : 'Active Conversations'}</span>
            <Inbox className="h-4 w-4 text-pink-600 dark:text-pink-400" aria-hidden="true" />
          </div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums text-[#0F172A] dark:text-white">
            {metrics.activeConversations}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {metrics.aiActiveConversations} AI active · {metrics.handoffQueue} handoff
          </div>
        </div>

        <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>{isDemoMode ? 'Auto-Replies Sent (Demo)' : 'Auto-Replies Sent'}</span>
            <Bot className="h-4 w-4 text-pink-600 dark:text-pink-400" aria-hidden="true" />
          </div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums text-[#0F172A] dark:text-white">
            {metrics.automatedRepliesCount}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {metrics.activeWorkflowsCount} of {workspace.workflows.length} workflows active
          </div>
        </div>

        <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Qualified & Active Leads</span>
            <Users className="h-4 w-4 text-pink-600 dark:text-pink-400" aria-hidden="true" />
          </div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums text-[#0F172A] dark:text-white">
            {metrics.qualifiedLeadsCount}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {workspace.leads.length} total contacts in CRM
          </div>
        </div>

        <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Confirmed Bookings Value</span>
            <CalendarCheck className="h-4 w-4 text-pink-600 dark:text-pink-400" aria-hidden="true" />
          </div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums text-[#0F172A] dark:text-white">
            {formatPhp(metrics.confirmedRevenuePhp)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {metrics.confirmedBookingsCount} confirmed / completed events
          </div>
        </div>
      </section>

      {/* Main 12-Col Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Cols: Recent Inbox + Weekly Demo Chart */}
        <div className="lg:col-span-7 space-y-6">
          <section className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E7E4ED] dark:border-slate-800 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">
                  {isDemoMode ? 'Recent Simulated Conversations' : 'Recent Messenger Conversations'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Select a guest thread to reply manually or test Knowledge Base auto-replies
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActivePage('inbox')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-pink-700 dark:text-pink-300 hover:underline whitespace-nowrap shrink-0"
              >
                <span>Open Inbox</span>
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="divide-y divide-[#EFEBF3] dark:divide-slate-800/80">
              {workspace.conversations.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  No Messenger threads yet. Open Unified Inbox to create a simulated test thread or receive live Meta webhooks.
                </div>
              ) : (
                workspace.conversations.slice(0, 6).map((conv) => (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => openConversationInInbox(conv.id)}
                    className="w-full text-left px-5 py-3.5 hover:bg-pink-50/40 dark:hover:bg-slate-800/40 transition-colors flex items-start justify-between gap-4"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <AvatarMonogram initials={conv.avatarInitials} tone={conv.avatarTone} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-[#0F172A] dark:text-white truncate">
                            {conv.guestName}
                          </span>
                          <span className="text-xs text-slate-400" aria-hidden="true">·</span>
                          <LeadStatusText status={conv.leadStatus} />
                          <span className="text-xs text-slate-400" aria-hidden="true">·</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {conv.channel}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 line-clamp-1">
                          {conv.lastMessagePreview}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                        {formatShortTime(conv.lastMessageAt)}
                      </div>
                      {conv.unreadCount > 0 && (
                        <div className="mt-1 text-[11px] font-semibold tabular-nums text-pink-600 dark:text-pink-400">
                          {conv.unreadCount} unread
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          {/* Weekly Simulated Inquiry Volume SVG Chart */}
          <section className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-5">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">
                  Weekly Inquiry & Automation Volume (Demo Sample)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Simulated 7-day distribution across wedding, debut, and corporate threads
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-300 shrink-0">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#0F172A] dark:bg-slate-400" aria-hidden="true" />
                  Total
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-pink-500" aria-hidden="true" />
                  Auto-Replied
                </span>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-3 items-end h-40 pt-4">
              {WEEKLY_INQUIRY_SERIES.map((entry) => {
                const totalPct = Math.round((entry.total / maxWeekly) * 100);
                const autoPct = Math.round((entry.automated / maxWeekly) * 100);
                return (
                  <div key={entry.day} className="flex flex-col items-center gap-2 h-full justify-end">
                    <div className="w-full max-w-[40px] flex items-end justify-center gap-1 h-28">
                      <div
                        className="w-3.5 rounded-t-md bg-[#0F172A] dark:bg-slate-500 transition-all"
                        style={{ height: `${totalPct}%` }}
                        title={`${entry.day}: ${entry.total} total`}
                      />
                      <div
                        className="w-3.5 rounded-t-md bg-pink-500 transition-all"
                        style={{ height: `${autoPct}%` }}
                        title={`${entry.day}: ${entry.automated} automated`}
                      />
                    </div>
                    <div className="text-center">
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        {entry.day}
                      </div>
                      <div className="font-mono text-[11px] tabular-nums text-slate-400">
                        {entry.total}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right 5 Cols: Workflows & Upcoming Bookings */}
        <div className="lg:col-span-5 space-y-6">
          <section className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E7E4ED] dark:border-slate-800 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">
                  Automation Workflows
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Toggle active flows or edit nodes in the builder
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActivePage('automations')}
                className="text-xs font-semibold text-pink-700 dark:text-pink-300 hover:underline whitespace-nowrap shrink-0"
              >
                Manage All
              </button>
            </div>

            <div className="divide-y divide-[#EFEBF3] dark:divide-slate-800/80">
              {workspace.workflows.length === 0 ? (
                <div className="px-5 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  No workflows saved in Firestore yet. Load starter flows above or create one in Workflow Builder.
                </div>
              ) : (
                workspace.workflows.map((wf) => (
                  <div key={wf.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => openWorkflowInBuilder(wf.id)}
                        className="text-sm font-semibold text-[#0F172A] dark:text-white hover:text-pink-600 dark:hover:text-pink-300 transition-colors text-left truncate block max-w-full"
                      >
                        {wf.name}
                      </button>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <WorkflowStatusText status={wf.status} />
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{wf.nodes.length} nodes</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{wf.runsSimulated} runs</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={wf.status === 'Active'}
                      aria-label={`Toggle ${wf.name}`}
                      onClick={() => void toggleWorkflowStatus(wf.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        wf.status === 'Active'
                          ? 'bg-[#0F172A] text-white dark:bg-pink-600 dark:text-white'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {wf.status === 'Active' ? 'Active' : 'Paused'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E7E4ED] dark:border-slate-800 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">
                  Upcoming Cebu Bookings
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Reserved studio dates and pending deposits
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActivePage('bookings')}
                className="text-xs font-semibold text-pink-700 dark:text-pink-300 hover:underline whitespace-nowrap shrink-0"
              >
                View Schedule
              </button>
            </div>

            <div className="divide-y divide-[#EFEBF3] dark:divide-slate-800/80">
              {workspace.bookings.length === 0 ? (
                <div className="px-5 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  No bookings recorded yet. Incoming Messenger booking inquiries appear here automatically.
                </div>
              ) : (
                workspace.bookings.slice(0, 4).map((bk) => (
                  <div key={bk.id} className="px-5 py-3.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#0F172A] dark:text-white truncate">
                        {bk.eventTitle}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                        {bk.venue} · {formatShortDate(bk.eventDate)}
                      </div>
                      <div className="mt-1">
                        <BookingStatusText status={bk.status} />
                      </div>
                    </div>
                    <div className="text-right shrink-0 font-mono text-xs font-semibold tabular-nums text-[#0F172A] dark:text-slate-200">
                      {formatPhp(bk.totalPhp)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
