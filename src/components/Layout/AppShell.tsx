import React, { useState } from 'react';
import {
  BarChart3,
  Bot,
  CalendarCheck,
  GitBranch,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { NavPageId } from '../../types/paperflow';

interface NavItem {
  id: NavPageId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'inbox', label: 'Unified Inbox', icon: Inbox },
  { id: 'automations', label: 'Automations', icon: Bot },
  { id: 'builder', label: 'Workflow Builder', icon: GitBranch },
  { id: 'contacts', label: 'Contacts & Leads', icon: Users },
  { id: 'bookings', label: 'Bookings', icon: CalendarCheck },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const PAGE_TITLES: Record<NavPageId, { title: string; subtitle: string }> = {
  overview: {
    title: 'Overview',
    subtitle: 'Studio activity, simulated Messenger queues, and upcoming Cebu bookings',
  },
  inbox: {
    title: 'Unified Inbox',
    subtitle: 'Simulated Messenger conversations, manual replies, AI toggle, and lead tagging',
  },
  automations: {
    title: 'Automations',
    subtitle: 'Manage Paper Dreams Cebu auto-reply flows and escalation rules',
  },
  builder: {
    title: 'Workflow Builder',
    subtitle: 'Visual node editor with triggers, conditions, replies, lead updates, and handoff',
  },
  contacts: {
    title: 'Contacts & Leads',
    subtitle: 'Client inquiry directory, event dates, venues, and estimated package values',
  },
  bookings: {
    title: 'Bookings',
    subtitle: 'Reserved photobooths, bespoke stationery suites, and deposit tracking',
  },
  analytics: {
    title: 'Analytics',
    subtitle: 'Simulated funnel metrics, response times, and package demand trends',
  },
  settings: {
    title: 'Settings',
    subtitle: 'Business Knowledge Base, Meta readiness, Firebase schema, and appearance',
  },
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    activePage,
    setActivePage,
    theme,
    toggleTheme,
    workspace,
    session,
    isDemoMode,
    firestoreConnected,
    signOut,
    health,
    toasts,
    dismissToast,
  } = useApp();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const unreadTotal = workspace.conversations.reduce((sum, c) => sum + c.unreadCount, 0);
  const currentMeta = PAGE_TITLES[activePage];

  const handleSelectPage = (page: NavPageId) => {
    setActivePage(page);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen flex bg-[#FAF8FB] text-[#0F172A] dark:bg-[#0B1120] dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-[252px] lg:shrink-0 lg:flex-col bg-[#0F172A] dark:bg-[#080D1A] text-slate-100 border-r border-slate-800/80">
        <div className="px-5 py-5 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-pink-500 text-white font-display font-bold text-sm">
              PF
            </div>
            <div className="min-w-0">
              <div className="font-display text-base font-bold tracking-tight text-white whitespace-nowrap truncate">
                PaperFlow
              </div>
              <div className="text-[11px] text-pink-200/80 whitespace-nowrap truncate">
                Paper Dreams Cebu
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Primary Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectPage(item.id)}
                className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors text-left whitespace-nowrap ${
                  isActive
                    ? 'bg-pink-500/18 text-pink-200'
                    : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-pink-300' : 'text-slate-400'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'inbox' && unreadTotal > 0 && (
                  <span className="font-mono text-xs tabular-nums text-pink-300 shrink-0">
                    {unreadTotal}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800/80 space-y-3">
          <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-3 text-xs space-y-1">
            <div className="font-medium text-pink-200">
              {isDemoMode
                ? 'Demo Mode Active'
                : firestoreConnected
                ? 'Firebase Live Connected'
                : 'Firebase Auth Active'}
            </div>
            <div className="text-slate-400 leading-relaxed">
              {health?.metaConnected
                ? 'Meta Messenger webhook active'
                : 'Meta Messenger pending secrets'}
            </div>
          </div>

          {session && (
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="min-w-0">
                <div className="text-xs font-medium text-white truncate">
                  {session.displayName}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {session.role} · {isDemoMode ? 'Demo Auth' : 'Google Auth'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void signOut()}
                title="Sign out of operator session"
                aria-label="Sign out"
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-72 max-w-[85vw] bg-[#0F172A] text-slate-100 flex flex-col h-full z-10 border-r border-slate-800">
            <div className="px-4 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-500 text-white font-display font-bold text-xs">
                  PF
                </div>
                <span className="font-display font-bold text-base text-white">PaperFlow</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Mobile Navigation">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectPage(item.id)}
                    className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-pink-500/20 text-pink-200'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </span>
                    {item.id === 'inbox' && unreadTotal > 0 && (
                      <span className="font-mono text-xs tabular-nums text-pink-300">
                        {unreadTotal}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {session && (
              <div className="p-4 border-t border-slate-800 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white truncate">{session.displayName}</div>
                  <div className="text-[11px] text-slate-400 truncate">{session.role}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-200"
                >
                  Sign Out
                </button>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar (3-zone contract, <=15% height on mobile) */}
        <header className="sticky top-0 z-30 bg-white/95 dark:bg-[#0F172A]/95 backdrop-blur border-b border-[#E7E4ED] dark:border-slate-800 px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-1 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-pink-50 dark:hover:bg-slate-800"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                <span className="font-medium text-[#0F172A] dark:text-slate-200 truncate">
                  {workspace.profile.businessName}
                </span>
                <span aria-hidden="true" className="shrink-0">/</span>
                <span className="truncate">{currentMeta.title}</span>
              </div>
              <h1 className="font-display text-base sm:text-lg font-bold tracking-tight text-[#0F172A] dark:text-white truncate">
                {currentMeta.title}
              </h1>
            </div>
          </div>

          <div className="hidden md:block text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
            {isDemoMode ? 'Local Demo Data' : 'Firestore Live'} ·{' '}
            {health?.metaConnected ? 'Meta Messenger Connected' : 'Meta Messenger Not Connected'}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-white dark:bg-[#131C31] text-xs font-medium text-[#0F172A] dark:text-slate-200 hover:bg-pink-50/70 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              {theme === 'light' ? (
                <>
                  <Moon className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              ) : (
                <>
                  <Sun className="h-3.5 w-3.5 text-pink-300" aria-hidden="true" />
                  <span className="hidden sm:inline">Light</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSelectPage('builder')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] dark:bg-pink-600 dark:hover:bg-pink-500 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
            >
              <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Open Builder</span>
              <span className="sm:hidden">Builder</span>
            </button>
          </div>
        </header>

        {/* Page Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Toast Stack */}
      {toasts.length > 0 && (
        <div
          className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)]"
          aria-live="polite"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#0F172A] dark:bg-slate-900 text-white px-4 py-3 text-xs font-medium shadow-lg"
            >
              <span>{toast.message}</span>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
                className="text-slate-400 hover:text-white shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
