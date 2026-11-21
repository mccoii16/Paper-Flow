import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { computeDashboardMetrics, formatCsvReport } from '../../utils/automationEngine';
import { formatPhp } from '../Common/StatusLabel';

type RangeWindow = '7d' | '30d' | '90d';

const RANGE_MULTIPLIERS: Record<RangeWindow, { label: string; factor: number; avgResponseSec: number }> = {
  '7d': { label: 'Last 7 Days (Demo)', factor: 1, avgResponseSec: 9 },
  '30d': { label: 'Last 30 Days (Demo)', factor: 3.6, avgResponseSec: 11 },
  '90d': { label: 'Last Quarter (Demo)', factor: 9.8, avgResponseSec: 12 },
};

export function AnalyticsPage() {
  const { workspace, notify } = useApp();
  const [range, setRange] = useState<RangeWindow>('30d');

  const base = useMemo(
    () =>
      computeDashboardMetrics({
        conversations: workspace.conversations,
        workflows: workspace.workflows,
        leads: workspace.leads,
        bookings: workspace.bookings,
      }),
    [workspace]
  );

  const cfg = RANGE_MULTIPLIERS[range];
  const simulatedInquiries = Math.round((base.activeConversations * 18) * cfg.factor);
  const aiResolved = Math.round(simulatedInquiries * 0.72);
  const humanHandled = simulatedInquiries - aiResolved;

  const funnelStages = useMemo(() => {
    const counts = {
      'New Inquiry': workspace.leads.filter((l) => l.status === 'New Inquiry').length,
      Qualified: workspace.leads.filter((l) => l.status === 'Qualified').length,
      'Proposal Sent': workspace.leads.filter((l) => l.status === 'Proposal Sent').length,
      Booked: workspace.leads.filter((l) => l.status === 'Booked').length,
      'Needs Handoff': workspace.leads.filter((l) => l.status === 'Needs Handoff').length,
    };
    const max = Math.max(...Object.values(counts), 1);
    return Object.entries(counts).map(([stage, count]) => ({
      stage,
      count,
      pct: Math.round((count / max) * 100),
    }));
  }, [workspace.leads]);

  const packageDemand = useMemo(() => {
    const map = new Map<string, { count: number; revenue: number }>();
    for (const bk of workspace.bookings) {
      const prev = map.get(bk.packageName) ?? { count: 0, revenue: 0 };
      map.set(bk.packageName, {
        count: prev.count + 1,
        revenue: prev.revenue + bk.totalPhp,
      });
    }
    return Array.from(map.entries()).map(([pkg, data]) => ({ pkg, ...data }));
  }, [workspace.bookings]);

  const handleExportReport = () => {
    const csv = formatCsvReport(
      ['Metric', 'Value', 'Timeframe'],
      [
        ['Simulated Messenger Inquiries', simulatedInquiries, cfg.label],
        ['Simulated AI Resolved', aiResolved, cfg.label],
        ['Human Handoff Count', humanHandled, cfg.label],
        ['Confirmed Revenue (PHP)', base.confirmedRevenuePhp, 'Current Workspace'],
      ]
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paperflow-demo-analytics-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Downloaded demo analytics CSV', 'success');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="text-xs text-slate-600 dark:text-slate-300">
          Metrics below combine live workspace records with clearly labeled simulated Messenger volume.
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#EFEBF3] dark:bg-slate-900">
            {(
              [
                { id: '7d', label: '7 Days' },
                { id: '30d', label: '30 Days' },
                { id: '90d', label: 'Quarter' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setRange(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                  range === opt.id
                    ? 'bg-white dark:bg-[#131C31] text-[#0F172A] dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleExportReport}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-white dark:bg-[#131C31] text-xs font-medium whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* 4 Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">Simulated Inquiries ({cfg.label})</div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums text-[#0F172A] dark:text-white">
            {simulatedInquiries}
          </div>
        </div>
        <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">AI Automated Resolution</div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums text-pink-700 dark:text-pink-300">
            72%
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">{aiResolved} simulated threads</div>
        </div>
        <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">Median First Response</div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums text-[#0F172A] dark:text-white">
            {cfg.avgResponseSec}s
          </div>
          <div className="mt-1 text-xs text-slate-500">Simulated auto-reply latency</div>
        </div>
        <div className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">Confirmed Revenue</div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums text-[#0F172A] dark:text-white">
            {formatPhp(base.confirmedRevenuePhp)}
          </div>
        </div>
      </div>

      {/* Breakdown Grids */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-5 space-y-4">
          <div>
            <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">
              Live CRM Lead Funnel (Current Workspace)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Updates automatically as you update lead statuses in Inbox or Contacts
            </p>
          </div>
          <div className="space-y-3">
            {funnelStages.map((item) => (
              <div key={item.stage} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-[#0F172A] dark:text-slate-200">{item.stage}</span>
                  <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    {item.count}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[#EFEBF3] dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-pink-500 transition-all"
                    style={{ width: `${Math.max(item.pct, item.count > 0 ? 10 : 0)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-5 space-y-4">
          <div>
            <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">
              Bookings by Paper Dreams Package
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Aggregated directly from the Bookings ledger
            </p>
          </div>

          <div className="divide-y divide-[#EFEBF3] dark:divide-slate-800/80 text-xs">
            {packageDemand.map((row) => (
              <div key={row.pkg} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-[#0F172A] dark:text-slate-100 truncate">
                    {row.pkg}
                  </div>
                  <div className="text-slate-500 dark:text-slate-400 tabular-nums">
                    {row.count} booking{row.count === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="font-mono font-semibold tabular-nums text-[#0F172A] dark:text-white shrink-0">
                  {formatPhp(row.revenue)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
