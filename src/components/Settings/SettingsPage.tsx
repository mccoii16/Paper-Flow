import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Database,
  Edit3,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { FIRESTORE_COLLECTIONS } from '../../services/firebaseBlueprint';
import type { KnowledgeBaseItem, KnowledgeCategory } from '../../types/paperflow';
import { formatPhp } from '../Common/StatusLabel';

type SettingsTab = 'knowledge' | 'meta' | 'firebase' | 'workspace';

const KB_CATEGORIES: Array<{ id: KnowledgeCategory; label: string }> = [
  { id: 'packages', label: 'Packages' },
  { id: 'faqs', label: 'FAQs' },
  { id: 'services', label: 'Services' },
  { id: 'policies', label: 'Policies' },
];

function createBlankKbItem(category: KnowledgeCategory): KnowledgeBaseItem {
  return {
    id: `kb-${Date.now()}`,
    category,
    title: '',
    summary: '',
    details: '',
    pricePhp: category === 'packages' ? 15000 : undefined,
    durationOrLeadTime: '',
    keywords: [],
    updatedAt: new Date().toISOString().slice(0, 10),
    active: true,
  };
}

export function SettingsPage() {
  const {
    workspace,
    isDemoMode,
    firestoreConnected,
    seedStarterTemplates,
    upsertKnowledgeItem,
    deleteKnowledgeItem,
    updateWorkspaceProfile,
    resetDemoData,
    theme,
    setTheme,
    health,
    refreshHealth,
    session,
    signOut,
  } = useApp();

  const [activeTab, setActiveTab] = useState<SettingsTab>('knowledge');
  const [kbCategory, setKbCategory] = useState<KnowledgeCategory>('packages');
  const [editingKb, setEditingKb] = useState<KnowledgeBaseItem | null>(null);
  const [kbKeywordsText, setKbKeywordsText] = useState('');

  const [profileForm, setProfileForm] = useState(workspace.profile);

  useEffect(() => {
    setProfileForm(workspace.profile);
  }, [workspace.profile]);

  const filteredKb = useMemo(
    () => workspace.knowledgeBase.filter((item) => item.category === kbCategory),
    [workspace.knowledgeBase, kbCategory]
  );

  const openKbModal = (item: KnowledgeBaseItem) => {
    setEditingKb({ ...item });
    setKbKeywordsText(item.keywords.join(', '));
  };

  const handleSaveKb = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingKb || !editingKb.title.trim()) return;
    const keywords = kbKeywordsText
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    upsertKnowledgeItem({
      ...editingKb,
      title: editingKb.title.trim(),
      summary: editingKb.summary.trim(),
      details: editingKb.details.trim(),
      keywords,
    });
    setEditingKb(null);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateWorkspaceProfile(profileForm);
  };

  return (
    <div className="space-y-6">
      {/* Settings Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-[#EFEBF3] dark:bg-slate-900 overflow-x-auto max-w-full self-start">
        {(
          [
            { id: 'knowledge', label: 'Business Knowledge Base' },
            { id: 'meta', label: 'Meta & Messenger Setup' },
            { id: 'firebase', label: 'Firebase & Auth Readiness' },
            { id: 'workspace', label: 'Workspace & Appearance' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-white dark:bg-[#131C31] text-[#0F172A] dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Editable Business Knowledge Base */}
      {activeTab === 'knowledge' && (
        <section className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-bold text-[#0F172A] dark:text-white">
                Paper Dreams Cebu Knowledge Base
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Entries added or edited here immediately power the Unified Inbox simulated AI auto-replies.
              </p>
            </div>

            <button
              type="button"
              onClick={() => openKbModal(createBlankKbItem(kbCategory))}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] dark:bg-pink-600 dark:hover:bg-pink-500 text-white text-xs font-semibold whitespace-nowrap self-start sm:self-auto"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Add Entry</span>
            </button>
          </div>

          {/* Category Sub-tabs */}
          <div className="flex items-center gap-2 border-b border-[#E7E4ED] dark:border-slate-800 pb-3 overflow-x-auto">
            {KB_CATEGORIES.map((cat) => {
              const count = workspace.knowledgeBase.filter((k) => k.category === cat.id).length;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setKbCategory(cat.id)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap ${
                    kbCategory === cat.id
                      ? 'bg-pink-100 text-pink-900 dark:bg-pink-950/60 dark:text-pink-200'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {cat.label} ({count})
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredKb.map((item) => (
              <article
                key={item.id}
                className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-5 flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <BookOpen className="h-3.5 w-3.5 text-pink-600 dark:text-pink-400" aria-hidden="true" />
                        <span>{item.active ? 'Active in AI Matcher' : 'Inactive'}</span>
                        {item.pricePhp !== undefined && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono font-semibold text-[#0F172A] dark:text-slate-200">
                              {formatPhp(item.pricePhp)}
                            </span>
                          </>
                        )}
                      </div>
                      <h3 className="mt-1.5 font-display text-base font-bold text-[#0F172A] dark:text-white">
                        {item.title}
                      </h3>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openKbModal(item)}
                        aria-label={`Edit ${item.title}`}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-[#0F172A] dark:hover:text-white"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteKnowledgeItem(item.id)}
                        aria-label={`Delete ${item.title}`}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 dark:hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="mt-2 text-xs font-medium text-slate-700 dark:text-slate-200">
                    {item.summary}
                  </p>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {item.details}
                  </p>
                </div>

                <div className="pt-3 border-t border-[#EFEBF3] dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                  Keywords: {item.keywords.length ? item.keywords.join(', ') : 'None'}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Tab 2: Meta & Messenger Setup Readiness */}
      {activeTab === 'meta' && (
        <section className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-6 space-y-5 max-w-3xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold text-[#0F172A] dark:text-white">
                Meta Messenger Connection Status
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                PaperFlow never simulates or claims a live Messenger connection. Server environment verification is required.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshHealth()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E7E4ED] dark:border-slate-700 text-xs font-medium"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Recheck Server</span>
            </button>
          </div>

          <div
            className={`rounded-xl border p-4 flex items-start gap-3 ${
              health?.metaConnected
                ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/70 dark:bg-emerald-950/25'
                : 'border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/25'
            }`}
          >
            <AlertTriangle
              className={`h-4 w-4 shrink-0 mt-0.5 ${
                health?.metaConnected
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
              aria-hidden="true"
            />
            <div className="text-xs text-[#0F172A] dark:text-amber-100 space-y-1">
              <div className="font-semibold">
                {health?.metaConnected
                  ? 'Connected to Meta Graph API & Webhook Secrets'
                  : 'Messenger Not Connected (Meta Server Secrets Missing)'}
              </div>
              <p className="text-slate-600 dark:text-amber-200/80">
                Missing server environment variables:{' '}
                <span className="font-mono">
                  {health?.metaMissingEnvVars.length
                    ? health.metaMissingEnvVars.join(', ')
                    : 'None — all configured'}
                </span>
              </p>
              <div className="pt-1 flex flex-wrap gap-4 text-[11px] font-mono text-slate-600 dark:text-slate-300">
                <span>Send API: {health?.metaSendApiReady ? 'Ready' : 'Pending META_PAGE_ACCESS_TOKEN'}</span>
                <span>Webhook HMAC: {health?.metaWebhookSignatureReady ? 'Ready' : 'Pending META_APP_SECRET'}</span>
              </div>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <h3 className="font-display text-sm font-semibold text-[#0F172A] dark:text-white">
              Production Meta Integration & App Review Checklist
            </h3>
            <ul className="space-y-2 text-slate-600 dark:text-slate-300 list-disc pl-5">
              <li>Register a Meta Business App and enable the Messenger Platform product.</li>
              <li>Request <code className="font-mono">pages_messaging</code> and <code className="font-mono">pages_manage_metadata</code> permissions via Meta App Review.</li>
              <li>Point the Meta Webhook callback URL to <code className="font-mono">/api/webhooks/meta</code> on this backend server.</li>
              <li>Store <code className="font-mono">META_APP_ID</code>, <code className="font-mono">META_APP_SECRET</code>, <code className="font-mono">META_PAGE_ACCESS_TOKEN</code>, <code className="font-mono">META_VERIFY_TOKEN</code>, and <code className="font-mono">META_PAGE_ID</code> exclusively in server secrets.</li>
            </ul>
          </div>
        </section>
      )}

      {/* Tab 3: Firebase & Auth Architecture */}
      {activeTab === 'firebase' && (
        <section className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-6 space-y-5 max-w-3xl">
          <div className="flex items-start gap-3">
            <Database className="h-5 w-5 text-pink-600 dark:text-pink-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="font-display text-lg font-bold text-[#0F172A] dark:text-white">
                Firebase Authentication & Firestore Status
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Real-time Firestore persistence paired with Firebase Admin SDK Bearer verification on Express <code className="font-mono">/api/*</code> routes.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#E7E4ED] dark:border-slate-800 bg-[#FAF8FB] dark:bg-[#0B1120] p-4 space-y-2 text-xs">
            <div className="font-semibold text-[#0F172A] dark:text-white flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span>Active Operator Session & Firebase Target</span>
            </div>
            <div className="text-slate-600 dark:text-slate-300">
              {session
                ? `${session.displayName} (${session.email}) · Role: ${session.role} · Provider: ${session.authProvider}`
                : 'Signed out'}
            </div>
            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
              <div>Project: {health?.firebaseProjectId ?? 'paperflow-46498'}</div>
              <div>Workspace Doc: workspaces/{session?.workspaceId ?? 'paper-dreams-cebu'}</div>
              <div>Firestore Reachable: {firestoreConnected ? 'Yes' : 'Offline / Check Network'}</div>
            </div>
            <div className="pt-2 flex flex-wrap gap-2">
              {!isDemoMode && (
                <button
                  type="button"
                  onClick={() => void seedStarterTemplates()}
                  className="px-3 py-1.5 rounded-lg bg-[#0F172A] dark:bg-pink-600 text-white font-semibold"
                >
                  Load Starter KB & Workflows
                </button>
              )}
              <button
                type="button"
                onClick={() => void signOut()}
                className="px-3 py-1.5 rounded-lg border border-[#E7E4ED] dark:border-slate-700 bg-white dark:bg-[#131C31] font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Sign Out
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="font-display text-sm font-semibold text-[#0F172A] dark:text-white">
              Production Firestore Collection Paths
            </h3>
            <div className="rounded-xl border border-[#E7E4ED] dark:border-slate-800 divide-y divide-[#EFEBF3] dark:divide-slate-800 text-xs font-mono">
              {Object.entries(FIRESTORE_COLLECTIONS).map(([key, path]) => (
                <div key={key} className="px-3.5 py-2 flex justify-between gap-4">
                  <span className="text-slate-500 dark:text-slate-400">{key}</span>
                  <span className="text-[#0F172A] dark:text-slate-200 truncate">{path}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Tab 4: Workspace & Appearance */}
      {activeTab === 'workspace' && (
        <section className="rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-6 space-y-6 max-w-2xl">
          <div>
            <h2 className="font-display text-lg font-bold text-[#0F172A] dark:text-white">
              Workspace Profile & Theme
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Configure Paper Dreams Cebu studio defaults and light/dark appearance.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 pb-5 border-b border-[#EFEBF3] dark:border-slate-800">
            <div>
              <div className="text-sm font-semibold text-[#0F172A] dark:text-white">Color Theme</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Soft pink, crisp white & dark navy palette
              </div>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#EFEBF3] dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                  theme === 'light'
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Light
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                  theme === 'dark'
                    ? 'bg-[#131C31] text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Dark
              </button>
            </div>
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="ws-name" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Business Name
                </label>
                <input
                  id="ws-name"
                  type="text"
                  value={profileForm.businessName}
                  onChange={(e) =>
                    setProfileForm({ ...profileForm, businessName: e.target.value })
                  }
                  className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="ws-hours" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Operating Hours
                </label>
                <input
                  id="ws-hours"
                  type="text"
                  value={profileForm.operatingHours}
                  onChange={(e) =>
                    setProfileForm({ ...profileForm, operatingHours: e.target.value })
                  }
                  className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="ws-fallback" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Default Simulated Auto-Reply Fallback
              </label>
              <textarea
                id="ws-fallback"
                rows={2}
                value={profileForm.defaultAiFallbackMessage}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, defaultAiFallbackMessage: e.target.value })
                }
                className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              {isDemoMode ? (
                <button
                  type="button"
                  onClick={() => void resetDemoData()}
                  className="px-3.5 py-2 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-medium hover:bg-rose-50 dark:hover:bg-rose-950/30"
                >
                  Reset Demo Data
                </button>
              ) : (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Saved directly to Cloud Firestore
                </span>
              )}

              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#0F172A] dark:bg-pink-600 text-white font-semibold"
              >
                Save Workspace Settings
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Knowledge Base Entry Modal */}
      {editingKb && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kb-modal-title"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 id="kb-modal-title" className="font-display text-lg font-bold text-[#0F172A] dark:text-white">
                {workspace.knowledgeBase.some((k) => k.id === editingKb.id)
                  ? 'Edit Knowledge Base Entry'
                  : 'Add Knowledge Base Entry'}
              </h2>
              <button
                type="button"
                onClick={() => setEditingKb(null)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveKb} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="kb-cat" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Category
                  </label>
                  <select
                    id="kb-cat"
                    value={editingKb.category}
                    onChange={(e) =>
                      setEditingKb({
                        ...editingKb,
                        category: e.target.value as KnowledgeCategory,
                      })
                    }
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                  >
                    {KB_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="kb-price" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Price PHP (optional)
                  </label>
                  <input
                    id="kb-price"
                    type="number"
                    min={0}
                    step={100}
                    value={editingKb.pricePhp ?? ''}
                    onChange={(e) =>
                      setEditingKb({
                        ...editingKb,
                        pricePhp: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                    className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="kb-title" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Title / Question
                </label>
                <input
                  id="kb-title"
                  type="text"
                  required
                  value={editingKb.title}
                  onChange={(e) => setEditingKb({ ...editingKb, title: e.target.value })}
                  className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="kb-summary" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Short Summary
                </label>
                <input
                  id="kb-summary"
                  type="text"
                  required
                  value={editingKb.summary}
                  onChange={(e) => setEditingKb({ ...editingKb, summary: e.target.value })}
                  className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="kb-details" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Full Answer / Inclusions
                </label>
                <textarea
                  id="kb-details"
                  rows={3}
                  required
                  value={editingKb.details}
                  onChange={(e) => setEditingKb({ ...editingKb, details: e.target.value })}
                  className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="kb-keywords" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  AI Trigger Keywords (comma separated)
                </label>
                <input
                  id="kb-keywords"
                  type="text"
                  value={kbKeywordsText}
                  onChange={(e) => setKbKeywordsText(e.target.value)}
                  placeholder="mirror, booth, price, cebu"
                  className="w-full rounded-xl border border-[#E7E4ED] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingKb(null)}
                  className="px-4 py-2 rounded-xl border border-[#E7E4ED] dark:border-slate-700 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#0F172A] dark:bg-pink-600 text-white font-semibold"
                >
                  Save Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
