import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import type {
  AutomationLog,
  BackendHealthStatus,
  Booking,
  Conversation,
  KnowledgeBaseItem,
  Lead,
  LeadStatus,
  Message,
  MessengerProfileStatus,
  NavPageId,
  OperatorSession,
  ThemeMode,
  Workflow,
  WorkspaceProfile,
  WorkspaceSnapshot,
} from '../types/paperflow';
import {
  createInitialWorkspaceSnapshot,
  DEFAULT_OPERATOR_SESSION,
} from '../data/demoSeed';
import { auth, googleProvider, testFirestoreConnection } from '../services/firebase';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  resolveWorkspaceIdForUser,
} from '../services/firebaseBlueprint';
import {
  isDemoModePreferred,
  paperflowRepository,
  readDemoWorkspace,
  resetDemoWorkspace,
  setDemoModePreferred,
  writeDemoWorkspace,
} from '../services/repository';
import { buildSimulatedAutoReply } from '../utils/automationEngine';

interface ToastNotification {
  id: string;
  message: string;
  tone: 'neutral' | 'success' | 'warning';
}

interface AppContextValue {
  theme: ThemeMode;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
  activePage: NavPageId;
  setActivePage: (page: NavPageId) => void;
  selectedConversationId: string;
  setSelectedConversationId: (id: string) => void;
  selectedWorkflowId: string;
  setSelectedWorkflowId: (id: string) => void;
  openConversationInInbox: (conversationId: string) => void;
  openWorkflowInBuilder: (workflowId: string) => void;
  session: OperatorSession | null;
  isDemoMode: boolean;
  firestoreConnected: boolean;
  authReady: boolean;
  signInWithGoogle: () => Promise<void>;
  enterDemoMode: (email?: string, displayName?: string, role?: OperatorSession['role']) => void;
  signOut: () => Promise<void>;
  health: BackendHealthStatus | null;
  refreshHealth: () => Promise<void>;
  workspace: WorkspaceSnapshot;
  isLoading: boolean;
  toasts: ToastNotification[];
  notify: (message: string, tone?: ToastNotification['tone']) => void;
  dismissToast: (id: string) => void;
  // Inbox actions
  sendManualReply: (conversationId: string, text: string) => Promise<void>;
  simulateGuestMessage: (conversationId: string, text: string) => Promise<void>;
  createSimulatedConversation: (guestName: string) => Promise<void>;
  toggleConversationAi: (conversationId: string) => Promise<void>;
  updateConversationStatus: (conversationId: string, status: LeadStatus) => Promise<void>;
  addConversationTag: (conversationId: string, tag: string) => Promise<void>;
  removeConversationTag: (conversationId: string, tag: string) => Promise<void>;
  markConversationRead: (conversationId: string) => Promise<void>;
  refreshConversationProfile: (conversationId: string) => Promise<{
    updated: boolean;
    statusMessage: string;
    profileStatus?: MessengerProfileStatus;
    metaErrorCode?: number;
  }>;
  // Workflows CRUD
  saveWorkflow: (workflow: Workflow) => Promise<void>;
  createWorkflow: (workflow: Omit<Workflow, 'id' | 'updatedAt'>) => Promise<Workflow>;
  deleteWorkflow: (workflowId: string) => Promise<void>;
  toggleWorkflowStatus: (workflowId: string) => Promise<void>;
  // Leads CRUD
  upsertLead: (lead: Lead) => Promise<void>;
  deleteLead: (leadId: string) => Promise<void>;
  // Bookings CRUD
  upsertBooking: (booking: Booking) => Promise<void>;
  deleteBooking: (bookingId: string) => Promise<void>;
  // Knowledge Base CRUD
  upsertKnowledgeItem: (item: KnowledgeBaseItem) => Promise<void>;
  deleteKnowledgeItem: (id: string) => Promise<void>;
  // Workspace & Templates
  updateWorkspaceProfile: (profile: WorkspaceProfile) => Promise<void>;
  seedStarterTemplates: () => Promise<void>;
  resetDemoData: () => Promise<void>;
}

const THEME_KEY = 'paperflow_theme_v1';

const AppContext = createContext<AppContextValue | null>(null);

function createEmptyLiveWorkspace(uid: string): WorkspaceSnapshot {
  return {
    profile: {
      ownerUid: uid,
      businessName: 'Paper Dreams Cebu',
      brandTagline: 'Bespoke Event Stationery, Keepsake Booths & Celebrations',
      location: 'Cebu City, Philippines',
      timezone: 'Asia/Manila (UTC+8)',
      currency: 'PHP',
      operatingHours: 'Mon–Sat, 9:00 AM – 7:00 PM PHT',
      defaultAiFallbackMessage:
        'Thank you for messaging Paper Dreams Cebu! Our studio coordinator will review your event details shortly and send a custom quote.',
      isDemoWorkspace: false,
    },
    conversations: [],
    workflows: [],
    leads: [],
    bookings: [],
    knowledgeBase: [],
    automationLogs: [],
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // ignore
    }
    return 'light';
  });

  const [activePage, setActivePage] = useState<NavPageId>('overview');
  const [session, setSession] = useState<OperatorSession | null>(() =>
    isDemoModePreferred() ? DEFAULT_OPERATOR_SESSION : null
  );
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [firestoreConnected, setFirestoreConnected] = useState<boolean>(false);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(() =>
    isDemoModePreferred() ? readDemoWorkspace() : createInitialWorkspaceSnapshot()
  );
  const [selectedConversationId, setSelectedConversationId] = useState<string>('conv-1');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('wf-1');
  const [health, setHealth] = useState<BackendHealthStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const isDemoMode = session?.authProvider === 'demo-local';

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => setThemeState(mode), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === 'light' ? 'dark' : 'light')),
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastNotification['tone'] = 'neutral') => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3800);
    },
    []
  );

  const refreshHealth = useCallback(async () => {
    const result = await paperflowRepository.fetchHealth();
    setHealth(result);
  }, []);

  // Boot connection test & Firebase Auth listener
  useEffect(() => {
    void refreshHealth();
    void testFirestoreConnection().then((ok) => setFirestoreConnected(ok));

    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        setDemoModePreferred(false);
        const wsId = resolveWorkspaceIdForUser(fbUser.email, fbUser.uid);
        const role: OperatorSession['role'] =
          fbUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()
            ? 'Owner'
            : 'Coordinator';

        setSession({
          uid: fbUser.uid,
          displayName: fbUser.displayName || fbUser.email || 'Studio Operator',
          email: fbUser.email || '',
          emailVerified: fbUser.emailVerified,
          role,
          authProvider: 'firebase-google',
          workspaceId: wsId,
          signedInAt: new Date().toISOString(),
        });
      } else if (isDemoModePreferred()) {
        setSession(DEFAULT_OPERATOR_SESSION);
      } else {
        setSession(null);
      }
      setAuthReady(true);
    });

    return () => unsub();
  }, [refreshHealth]);

  // Load either Firestore live subscriptions OR isolated local Demo workspace
  useEffect(() => {
    if (!authReady) return;
    if (!session) {
      setIsLoading(false);
      return;
    }

    if (session.authProvider === 'demo-local') {
      const loaded = readDemoWorkspace();
      setWorkspace(loaded);
      setSelectedConversationId(loaded.conversations[0]?.id ?? '');
      setSelectedWorkflowId(loaded.workflows[0]?.id ?? '');
      setIsLoading(false);
      return;
    }

    // Production Firebase Firestore subscription
    let active = true;
    let unsubFirestore: (() => void) | null = null;

    async function connectFirestore() {
      if (!session) return;
      setIsLoading(true);
      setWorkspace(createEmptyLiveWorkspace(session.uid));

      try {
        const profile = await paperflowRepository.ensureFirestoreWorkspace(session);
        if (!active) return;

        setWorkspace((prev) => ({ ...prev, profile }));

        unsubFirestore = paperflowRepository.subscribeToWorkspace(session, {
          onProfile: (p) => setWorkspace((prev) => ({ ...prev, profile: p })),
          onConversations: (convs) => {
            setWorkspace((prev) => ({ ...prev, conversations: convs }));
            setSelectedConversationId((prevId) =>
              convs.some((c) => c.id === prevId) ? prevId : convs[0]?.id ?? ''
            );
          },
          onWorkflows: (wfs) => {
            setWorkspace((prev) => ({ ...prev, workflows: wfs }));
            setSelectedWorkflowId((prevId) =>
              wfs.some((w) => w.id === prevId) ? prevId : wfs[0]?.id ?? ''
            );
          },
          onLeads: (leads) => setWorkspace((prev) => ({ ...prev, leads })),
          onBookings: (bookings) => setWorkspace((prev) => ({ ...prev, bookings })),
          onKnowledgeBase: (knowledgeBase) =>
            setWorkspace((prev) => ({ ...prev, knowledgeBase })),
          onAutomationLogs: (automationLogs) =>
            setWorkspace((prev) => ({ ...prev, automationLogs })),
          onError: (err) => {
            notify(`Firestore sync error: ${err.message}`, 'warning');
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to connect to Firestore.';
        notify(msg, 'warning');
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void connectFirestore();

    return () => {
      active = false;
      if (unsubFirestore) unsubFirestore();
    };
  }, [authReady, session, notify]);

  const updateDemoWorkspace = useCallback(
    (updater: (prev: WorkspaceSnapshot) => WorkspaceSnapshot) => {
      setWorkspace((prev) => {
        const next = updater(prev);
        writeDemoWorkspace(next);
        return next;
      });
    },
    []
  );

  const signInWithGoogle = useCallback(async () => {
    try {
      setDemoModePreferred(false);
      await signInWithPopup(auth, googleProvider);
      notify('Signed in with Google (Firebase Auth)', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed.';
      notify(msg, 'warning');
      throw err;
    }
  }, [notify]);

  const enterDemoMode = useCallback(
    (
      email = DEFAULT_OPERATOR_SESSION.email,
      displayName = DEFAULT_OPERATOR_SESSION.displayName,
      role: OperatorSession['role'] = 'Owner'
    ) => {
      setDemoModePreferred(true);
      const demoSession: OperatorSession = {
        ...DEFAULT_OPERATOR_SESSION,
        email: email.trim() || DEFAULT_OPERATOR_SESSION.email,
        displayName: displayName.trim() || DEFAULT_OPERATOR_SESSION.displayName,
        role,
        signedInAt: new Date().toISOString(),
      };
      setSession(demoSession);
      notify('Entered Local Demo Mode (sample data only)', 'neutral');
    },
    [notify]
  );

  const signOut = useCallback(async () => {
    setDemoModePreferred(false);
    if (auth.currentUser) {
      await firebaseSignOut(auth);
    }
    setSession(null);
  }, []);

  const openConversationInInbox = useCallback((conversationId: string) => {
    setSelectedConversationId(conversationId);
    setActivePage('inbox');
  }, []);

  const openWorkflowInBuilder = useCallback((workflowId: string) => {
    setSelectedWorkflowId(workflowId);
    setActivePage('builder');
  }, []);

  const markConversationRead = useCallback(
    async (conversationId: string) => {
      const target = workspace.conversations.find((c) => c.id === conversationId);
      if (!target || target.unreadCount === 0) return;

      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({
          ...prev,
          conversations: prev.conversations.map((c) =>
            c.id === conversationId ? { ...c, unreadCount: 0 } : c
          ),
        }));
      } else if (session) {
        await paperflowRepository.saveConversationMeta(session, { ...target, unreadCount: 0 });
      }
    },
    [workspace.conversations, isDemoMode, updateDemoWorkspace, session]
  );

  const sendManualReply = useCallback(
    async (conversationId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !session) return;
      const target = workspace.conversations.find((c) => c.id === conversationId);
      if (!target) return;

      const now = new Date().toISOString();
      const operatorName = session.displayName || 'Studio Coordinator';

      // Real Meta Messenger Send API when thread is Live Messenger
      if (!isDemoMode && target.channel === 'Messenger (Live)' && target.psid) {
        try {
          await paperflowRepository.sendLiveMessengerReply({
            workspaceId: session.workspaceId,
            conversationId: target.id,
            recipientPsid: target.psid,
            text: trimmed,
            senderName: operatorName,
          });
          notify('Reply sent via Meta Messenger Send API', 'success');
        } catch (err) {
          notify(
            err instanceof Error ? err.message : 'Meta Send API failed',
            'warning'
          );
        }
        return;
      }

      const msg: Message = {
        id: `msg_${Date.now()}`,
        ownerUid: session.uid,
        conversationId,
        sender: 'operator',
        senderName: operatorName,
        text: trimmed,
        timestamp: now,
        isSimulated: true,
      };

      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({
          ...prev,
          conversations: prev.conversations.map((conv) =>
            conv.id !== conversationId
              ? conv
              : {
                  ...conv,
                  unreadCount: 0,
                  needsHumanHandoff: false,
                  lastMessagePreview: trimmed,
                  lastMessageAt: now,
                  messages: [...conv.messages, msg],
                }
          ),
        }));
        notify('Manual reply added to simulated thread', 'success');
      } else {
        await paperflowRepository.appendMessage(session, msg);
        await paperflowRepository.saveConversationMeta(session, {
          ...target,
          unreadCount: 0,
          needsHumanHandoff: false,
          lastMessagePreview: trimmed,
          lastMessageAt: now,
        });
        notify('Reply saved to Firestore simulated thread', 'success');
      }
    },
    [session, workspace.conversations, isDemoMode, updateDemoWorkspace, notify]
  );

  const simulateGuestMessage = useCallback(
    async (conversationId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !session) return;
      const targetConv = workspace.conversations.find((c) => c.id === conversationId);
      if (!targetConv) return;

      const now = new Date().toISOString();
      const replyNow = new Date(Date.now() + 800).toISOString();

      const guestMsg: Message = {
        id: `msg_${Date.now()}`,
        ownerUid: session.uid,
        conversationId,
        sender: 'guest',
        senderName: targetConv.guestName,
        text: trimmed,
        timestamp: now,
        isSimulated: true,
      };

      let nextStatus = targetConv.leadStatus;
      let nextTags = [...targetConv.tags];
      let nextAiEnabled = targetConv.aiEnabled;
      let nextHandoff = targetConv.needsHumanHandoff;
      let lastPreview = trimmed;
      let lastAt = now;
      let aiMsg: Message | null = null;

      if (targetConv.aiEnabled) {
        const simResult = buildSimulatedAutoReply({
          conversation: targetConv,
          incomingText: trimmed,
          workflows: workspace.workflows,
          knowledgeBase: workspace.knowledgeBase,
          fallbackMessage: workspace.profile.defaultAiFallbackMessage,
        });

        aiMsg = {
          id: `msg_ai_${Date.now() + 1}`,
          ownerUid: session.uid,
          conversationId,
          sender: 'ai_sim',
          senderName: 'PaperFlow Auto-Reply (Simulated)',
          text: simResult.replyText,
          timestamp: replyNow,
          isSimulated: true,
          matchedKbTitle: simResult.matchedKbItem?.title,
          matchedWorkflowName: simResult.matchedWorkflow?.name,
        };

        lastPreview = simResult.replyText;
        lastAt = replyNow;

        if (simResult.suggestedStatus) nextStatus = simResult.suggestedStatus;
        for (const t of simResult.suggestedTags) {
          if (!nextTags.includes(t)) nextTags.push(t);
        }
        if (simResult.triggeredHandoff) {
          nextHandoff = true;
          nextAiEnabled = false;
          nextStatus = 'Needs Handoff';
        }
      }

      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({
          ...prev,
          conversations: prev.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  aiEnabled: nextAiEnabled,
                  leadStatus: nextStatus,
                  tags: nextTags,
                  needsHumanHandoff: nextHandoff,
                  lastMessagePreview: lastPreview,
                  lastMessageAt: lastAt,
                  messages: aiMsg ? [...c.messages, guestMsg, aiMsg] : [...c.messages, guestMsg],
                }
              : c
          ),
          leads: prev.leads.map((l) =>
            l.id === targetConv.leadId
              ? { ...l, status: nextStatus, tags: nextTags, lastContactAt: lastAt }
              : l
          ),
        }));
      } else {
        await paperflowRepository.appendMessage(session, guestMsg);
        if (aiMsg) {
          await paperflowRepository.appendMessage(session, aiMsg);
        }
        await paperflowRepository.saveConversationMeta(session, {
          ...targetConv,
          aiEnabled: nextAiEnabled,
          leadStatus: nextStatus,
          tags: nextTags,
          needsHumanHandoff: nextHandoff,
          lastMessagePreview: lastPreview,
          lastMessageAt: lastAt,
        });
        if (aiMsg) {
          try {
            await paperflowRepository.logAutomationRun(session, {
              id: `log_${Date.now()}`,
              ownerUid: session.uid,
              conversationId,
              workflowName: aiMsg.matchedWorkflowName,
              matchedKbTitle: aiMsg.matchedKbTitle,
              channel: 'Messenger (Simulated)',
              outcome: nextHandoff ? 'handoff' : 'replied',
              createdAt: replyNow,
            });
          } catch (logErr) {
            console.warn('Simulated automation log write failed (message preserved):', logErr);
          }
        }
      }
    },
    [session, workspace, isDemoMode, updateDemoWorkspace]
  );

  const createSimulatedConversation = useCallback(
    async (guestName: string) => {
      if (!session) return;
      const cleanName = guestName.trim() || 'Simulated Cebu Client';
      const ts = Date.now();
      const convId = `sim_conv_${ts}`;
      const leadId = `sim_lead_${ts}`;
      const nowIso = new Date(ts).toISOString();
      const initials =
        cleanName
          .split(/\s+/)
          .map((p) => p[0])
          .join('')
          .slice(0, 2)
          .toUpperCase() || 'SC';

      const lead: Lead = {
        id: leadId,
        ownerUid: session.uid,
        name: cleanName,
        messengerHandle: `${cleanName.toLowerCase().replace(/\s+/g, '.')} (Simulated)`,
        email: '',
        phone: '',
        eventType: 'Simulated Test Inquiry',
        eventDate: '',
        venue: 'Cebu',
        estimatedValuePhp: 0,
        status: 'New Inquiry',
        tags: ['Simulated'],
        source: 'Messenger (Simulated)',
        lastContactAt: nowIso,
        notes: 'Created for local automation testing.',
      };

      const conv: Conversation = {
        id: convId,
        ownerUid: session.uid,
        leadId,
        guestName: cleanName,
        messengerHandle: lead.messengerHandle,
        avatarInitials: initials,
        avatarTone: 'pink',
        aiEnabled: true,
        leadStatus: 'New Inquiry',
        tags: ['Simulated'],
        unreadCount: 0,
        lastMessagePreview: 'Simulated sandbox thread ready',
        lastMessageAt: nowIso,
        channel: 'Messenger (Simulated)',
        needsHumanHandoff: false,
        messages: [],
      };

      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({
          ...prev,
          leads: [lead, ...prev.leads],
          conversations: [conv, ...prev.conversations],
        }));
      } else {
        await paperflowRepository.saveLead(session, lead);
        await paperflowRepository.saveConversationMeta(session, conv);
      }
      setSelectedConversationId(convId);
      notify(`Created simulated test thread for ${cleanName}`, 'success');
    },
    [session, isDemoMode, updateDemoWorkspace, notify]
  );

  const toggleConversationAi = useCallback(
    async (conversationId: string) => {
      const target = workspace.conversations.find((c) => c.id === conversationId);
      if (!target || !session) return;
      const nextAi = !target.aiEnabled;
      const nextHandoff = nextAi ? false : target.needsHumanHandoff;

      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({
          ...prev,
          conversations: prev.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, aiEnabled: nextAi, needsHumanHandoff: nextHandoff }
              : c
          ),
        }));
      } else {
        await paperflowRepository.saveConversationMeta(session, {
          ...target,
          aiEnabled: nextAi,
          needsHumanHandoff: nextHandoff,
        });
      }
    },
    [workspace.conversations, session, isDemoMode, updateDemoWorkspace]
  );

  const updateConversationStatus = useCallback(
    async (conversationId: string, status: LeadStatus) => {
      const conv = workspace.conversations.find((c) => c.id === conversationId);
      if (!conv || !session) return;
      const linkedLead = workspace.leads.find((l) => l.id === conv.leadId);

      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({
          ...prev,
          conversations: prev.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, leadStatus: status, needsHumanHandoff: status === 'Needs Handoff' }
              : c
          ),
          leads: prev.leads.map((l) => (l.id === conv.leadId ? { ...l, status } : l)),
        }));
      } else {
        await paperflowRepository.saveConversationMeta(session, {
          ...conv,
          leadStatus: status,
          needsHumanHandoff: status === 'Needs Handoff',
        });
        if (linkedLead) {
          await paperflowRepository.saveLead(session, { ...linkedLead, status });
        }
      }
    },
    [workspace.conversations, workspace.leads, session, isDemoMode, updateDemoWorkspace]
  );

  const addConversationTag = useCallback(
    async (conversationId: string, tag: string) => {
      const clean = tag.trim();
      const conv = workspace.conversations.find((c) => c.id === conversationId);
      if (!clean || !conv || conv.tags.includes(clean) || !session) return;
      const nextTags = [...conv.tags, clean];
      const linkedLead = workspace.leads.find((l) => l.id === conv.leadId);

      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({
          ...prev,
          conversations: prev.conversations.map((c) =>
            c.id === conversationId ? { ...c, tags: nextTags } : c
          ),
          leads: prev.leads.map((l) => (l.id === conv.leadId ? { ...l, tags: nextTags } : l)),
        }));
      } else {
        await paperflowRepository.saveConversationMeta(session, { ...conv, tags: nextTags });
        if (linkedLead) {
          await paperflowRepository.saveLead(session, { ...linkedLead, tags: nextTags });
        }
      }
    },
    [workspace.conversations, workspace.leads, session, isDemoMode, updateDemoWorkspace]
  );

  const removeConversationTag = useCallback(
    async (conversationId: string, tag: string) => {
      const conv = workspace.conversations.find((c) => c.id === conversationId);
      if (!conv || !session) return;
      const nextTags = conv.tags.filter((t) => t !== tag);
      const linkedLead = workspace.leads.find((l) => l.id === conv.leadId);

      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({
          ...prev,
          conversations: prev.conversations.map((c) =>
            c.id === conversationId ? { ...c, tags: nextTags } : c
          ),
          leads: prev.leads.map((l) => (l.id === conv.leadId ? { ...l, tags: nextTags } : l)),
        }));
      } else {
        await paperflowRepository.saveConversationMeta(session, { ...conv, tags: nextTags });
        if (linkedLead) {
          await paperflowRepository.saveLead(session, { ...linkedLead, tags: nextTags });
        }
      }
    },
    [workspace.conversations, workspace.leads, session, isDemoMode, updateDemoWorkspace]
  );

  const saveWorkflow = useCallback(
    async (workflow: Workflow) => {
      if (!session) return;
      const updated = { ...workflow, updatedAt: new Date().toISOString().slice(0, 10) };
      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({
          ...prev,
          workflows: prev.workflows.map((w) => (w.id === updated.id ? updated : w)),
        }));
      } else {
        await paperflowRepository.saveWorkflow(session, updated);
      }
      notify(`Saved workflow "${updated.name}"`, 'success');
    },
    [session, isDemoMode, updateDemoWorkspace, notify]
  );

  const createWorkflow = useCallback(
    async (input: Omit<Workflow, 'id' | 'updatedAt'>): Promise<Workflow> => {
      const created: Workflow = {
        ...input,
        id: `wf_${Date.now()}`,
        ownerUid: session?.uid,
        updatedAt: new Date().toISOString().slice(0, 10),
      };
      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({
          ...prev,
          workflows: [created, ...prev.workflows],
        }));
      } else if (session) {
        await paperflowRepository.saveWorkflow(session, created);
      }
      setSelectedWorkflowId(created.id);
      notify(`Created workflow "${created.name}"`, 'success');
      return created;
    },
    [session, isDemoMode, updateDemoWorkspace, notify]
  );

  const deleteWorkflow = useCallback(
    async (workflowId: string) => {
      if (!session) return;
      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({
          ...prev,
          workflows: prev.workflows.filter((w) => w.id !== workflowId),
        }));
      } else {
        await paperflowRepository.deleteWorkflow(session, workflowId);
      }
      notify('Workflow deleted', 'neutral');
    },
    [session, isDemoMode, updateDemoWorkspace, notify]
  );

  const toggleWorkflowStatus = useCallback(
    async (workflowId: string) => {
      const wf = workspace.workflows.find((w) => w.id === workflowId);
      if (!wf || !session) return;
      const updated: Workflow = {
        ...wf,
        status: wf.status === 'Active' ? 'Paused' : 'Active',
        updatedAt: new Date().toISOString().slice(0, 10),
      };
      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({
          ...prev,
          workflows: prev.workflows.map((w) => (w.id === workflowId ? updated : w)),
        }));
      } else {
        await paperflowRepository.saveWorkflow(session, updated);
      }
    },
    [workspace.workflows, session, isDemoMode, updateDemoWorkspace]
  );

  const refreshConversationProfile = useCallback(
    async (conversationId: string) => {
      if (!session) {
        return {
          updated: false,
          statusMessage: 'Sign in to refresh Messenger contact profiles.',
          profileStatus: 'unavailable' as MessengerProfileStatus,
        };
      }
      const targetConv = workspace.conversations.find((c) => c.id === conversationId);
      if (!targetConv) {
        return {
          updated: false,
          statusMessage: 'Conversation not found.',
          profileStatus: 'unavailable' as MessengerProfileStatus,
        };
      }
      if (isDemoMode || targetConv.channel !== 'Messenger (Live)') {
        const msg =
          'Profile refresh connects to Meta Graph API for live Messenger threads only.';
        notify(msg, 'neutral');
        return {
          updated: false,
          statusMessage: msg,
          profileStatus: targetConv.profileStatus ?? ('unavailable' as MessengerProfileStatus),
        };
      }

      try {
        const result = await paperflowRepository.refreshMessengerProfile({
          workspaceId: session.workspaceId,
          conversationId: targetConv.id,
        });
        if (result.updated) {
          notify(result.statusMessage, 'success');
        } else {
          notify(
            result.metaErrorCode !== undefined
              ? `${result.statusMessage} (Meta code ${result.metaErrorCode})`
              : result.statusMessage,
            'warning'
          );
        }
        return {
          updated: result.updated,
          statusMessage: result.statusMessage,
          profileStatus: result.profileStatus,
          metaErrorCode: result.metaErrorCode,
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Profile unavailable from Meta';
        notify(message, 'warning');
        return {
          updated: false,
          statusMessage: message,
          profileStatus: 'unavailable' as MessengerProfileStatus,
        };
      }
    },
    [session, workspace.conversations, isDemoMode, notify]
  );

  const upsertLead = useCallback(
    async (lead: Lead) => {
      if (!session) return;
      const existingLead = workspace.leads.find((l) => l.id === lead.id);
      const trimmedName = lead.name.trim();
      const isFallbackName = /^Messenger Guest\b/i.test(trimmedName);
      const nameWasEditedManually =
        !isFallbackName &&
        (!existingLead || existingLead.name.trim() !== trimmedName);

      const preparedLead: Lead = {
        ...lead,
        name: trimmedName,
        nameSource: nameWasEditedManually
          ? 'manual'
          : lead.nameSource ?? existingLead?.nameSource,
        profileStatus: nameWasEditedManually
          ? 'manual'
          : lead.profileStatus ?? existingLead?.profileStatus,
        profileStatusMessage: nameWasEditedManually
          ? 'Manually assigned name'
          : lead.profileStatusMessage ?? existingLead?.profileStatusMessage,
      };

      const initials =
        trimmedName
          .split(/\s+/)
          .map((w) => w.replace(/[^a-zA-Z0-9]/g, '')[0] ?? '')
          .filter(Boolean)
          .join('')
          .slice(0, 2)
          .toUpperCase() || 'MG';

      if (isDemoMode) {
        updateDemoWorkspace((prev) => {
          const exists = prev.leads.some((l) => l.id === preparedLead.id);
          return {
            ...prev,
            leads: exists
              ? prev.leads.map((l) => (l.id === preparedLead.id ? preparedLead : l))
              : [preparedLead, ...prev.leads],
            conversations: prev.conversations.map((c) =>
              c.leadId === preparedLead.id
                ? {
                    ...c,
                    leadStatus: preparedLead.status,
                    tags: preparedLead.tags,
                    guestName: preparedLead.name,
                    avatarInitials: isFallbackName ? c.avatarInitials : initials,
                    nameSource: preparedLead.nameSource ?? c.nameSource,
                    profileStatus: preparedLead.profileStatus ?? c.profileStatus,
                    profileStatusMessage:
                      preparedLead.profileStatusMessage ?? c.profileStatusMessage,
                  }
                : c
            ),
          };
        });
      } else {
        await paperflowRepository.saveLead(session, preparedLead);
        const linkedConv = workspace.conversations.find((c) => c.leadId === preparedLead.id);
        if (linkedConv) {
          await paperflowRepository.saveConversationMeta(session, {
            ...linkedConv,
            guestName: preparedLead.name,
            avatarInitials: isFallbackName ? linkedConv.avatarInitials : initials,
            leadStatus: preparedLead.status,
            tags: preparedLead.tags,
            nameSource: preparedLead.nameSource ?? linkedConv.nameSource,
            profileStatus: preparedLead.profileStatus ?? linkedConv.profileStatus,
            profileStatusMessage:
              preparedLead.profileStatusMessage ?? linkedConv.profileStatusMessage,
          });
        }
      }
      notify(`Saved contact "${preparedLead.name}"`, 'success');
    },
    [session, workspace.leads, workspace.conversations, isDemoMode, updateDemoWorkspace, notify]
  );

  const deleteLead = useCallback(
    async (leadId: string) => {
      if (!session) return;
      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({
          ...prev,
          leads: prev.leads.filter((l) => l.id !== leadId),
        }));
      } else {
        await paperflowRepository.deleteLead(session, leadId);
      }
      notify('Contact removed', 'neutral');
    },
    [session, isDemoMode, updateDemoWorkspace, notify]
  );

  const upsertBooking = useCallback(
    async (booking: Booking) => {
      if (!session) return;
      if (isDemoMode) {
        updateDemoWorkspace((prev) => {
          const exists = prev.bookings.some((b) => b.id === booking.id);
          return {
            ...prev,
            bookings: exists
              ? prev.bookings.map((b) => (b.id === booking.id ? booking : b))
              : [booking, ...prev.bookings],
          };
        });
      } else {
        await paperflowRepository.saveBooking(session, booking);
      }
      notify(`Saved booking "${booking.eventTitle}"`, 'success');
    },
    [session, isDemoMode, updateDemoWorkspace, notify]
  );

  const deleteBooking = useCallback(
    async (bookingId: string) => {
      if (!session) return;
      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({
          ...prev,
          bookings: prev.bookings.filter((b) => b.id !== bookingId),
        }));
      } else {
        await paperflowRepository.deleteBooking(session, bookingId);
      }
      notify('Booking removed', 'neutral');
    },
    [session, isDemoMode, updateDemoWorkspace, notify]
  );

  const upsertKnowledgeItem = useCallback(
    async (item: KnowledgeBaseItem) => {
      if (!session) return;
      const updated = { ...item, updatedAt: new Date().toISOString().slice(0, 10) };
      if (isDemoMode) {
        updateDemoWorkspace((prev) => {
          const exists = prev.knowledgeBase.some((k) => k.id === updated.id);
          return {
            ...prev,
            knowledgeBase: exists
              ? prev.knowledgeBase.map((k) => (k.id === updated.id ? updated : k))
              : [updated, ...prev.knowledgeBase],
          };
        });
      } else {
        await paperflowRepository.saveKnowledgeItem(session, updated);
      }
      notify(`Saved Knowledge Base entry "${updated.title}"`, 'success');
    },
    [session, isDemoMode, updateDemoWorkspace, notify]
  );

  const deleteKnowledgeItem = useCallback(
    async (id: string) => {
      if (!session) return;
      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({
          ...prev,
          knowledgeBase: prev.knowledgeBase.filter((k) => k.id !== id),
        }));
      } else {
        await paperflowRepository.deleteKnowledgeItem(session, id);
      }
      notify('Knowledge Base entry deleted', 'neutral');
    },
    [session, isDemoMode, updateDemoWorkspace, notify]
  );

  const updateWorkspaceProfile = useCallback(
    async (profile: WorkspaceProfile) => {
      if (!session) return;
      if (isDemoMode) {
        updateDemoWorkspace((prev) => ({ ...prev, profile }));
      } else {
        await paperflowRepository.updateProfile(session, profile);
      }
      notify('Workspace settings saved', 'success');
    },
    [session, isDemoMode, updateDemoWorkspace, notify]
  );

  const seedStarterTemplates = useCallback(async () => {
    if (!session || isDemoMode) return;
    await paperflowRepository.seedStarterTemplatesToFirestore(session);
    notify('Loaded Paper Dreams Cebu starter workflows & Knowledge Base into Firestore', 'success');
  }, [session, isDemoMode, notify]);

  const resetDemoData = useCallback(async () => {
    if (!isDemoMode) return;
    const fresh = resetDemoWorkspace();
    setWorkspace(fresh);
    setSelectedConversationId(fresh.conversations[0]?.id ?? '');
    setSelectedWorkflowId(fresh.workflows[0]?.id ?? '');
    notify('Local demo workspace reset to initial Paper Dreams Cebu data', 'success');
  }, [isDemoMode, notify]);

  return (
    <AppContext.Provider
      value={{
        theme,
        toggleTheme,
        setTheme,
        activePage,
        setActivePage,
        selectedConversationId,
        setSelectedConversationId,
        selectedWorkflowId,
        setSelectedWorkflowId,
        openConversationInInbox,
        openWorkflowInBuilder,
        session,
        isDemoMode,
        firestoreConnected,
        authReady,
        signInWithGoogle,
        enterDemoMode,
        signOut,
        health,
        refreshHealth,
        workspace,
        isLoading,
        toasts,
        notify,
        dismissToast,
        sendManualReply,
        simulateGuestMessage,
        createSimulatedConversation,
        toggleConversationAi,
        updateConversationStatus,
        addConversationTag,
        removeConversationTag,
        markConversationRead,
        refreshConversationProfile,
        saveWorkflow,
        createWorkflow,
        deleteWorkflow,
        toggleWorkflowStatus,
        upsertLead,
        deleteLead,
        upsertBooking,
        deleteBooking,
        upsertKnowledgeItem,
        deleteKnowledgeItem,
        updateWorkspaceProfile,
        seedStarterTemplates,
        resetDemoData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
