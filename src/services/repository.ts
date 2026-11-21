import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  createInitialWorkspaceSnapshot,
  DEMO_KNOWLEDGE_BASE,
  DEMO_WORKFLOWS,
} from '../data/demoSeed';
import type {
  AutomationLog,
  BackendHealthStatus,
  Booking,
  Conversation,
  KnowledgeBaseItem,
  Lead,
  Message,
  OperatorSession,
  Workflow,
  WorkspaceProfile,
  WorkspaceSnapshot,
} from '../types/paperflow';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  DEFAULT_STUDIO_WORKSPACE_ID,
} from './firebaseBlueprint';

const DEMO_STORAGE_KEY = 'paperflow_demo_workspace_v1';
const DEMO_MODE_FLAG_KEY = 'paperflow_demo_mode_active_v1';

function omitUndefinedValue<T>(value: T): T {
  if (value === null || value === undefined || value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => omitUndefinedValue(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val !== undefined) {
        clean[key] = omitUndefinedValue(val);
      }
    }
    return clean as T;
  }
  return value;
}

function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  return omitUndefinedValue(obj);
}

function sanitizeId(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return clean || `id_${Date.now()}`;
}

function isAdminEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase());
}

function scopedQuery(workspaceId: string, subcollection: string, session: OperatorSession) {
  const colRef = collection(db, 'workspaces', workspaceId, subcollection);
  if (isAdminEmail(session.email)) {
    return colRef;
  }
  return query(colRef, where('ownerUid', '==', session.uid));
}

// --- Local Demo Mode Helpers (explicitly isolated from production Firestore) ---
export function readDemoWorkspace(): WorkspaceSnapshot {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WorkspaceSnapshot;
      if (parsed && parsed.profile && Array.isArray(parsed.conversations)) {
        return parsed;
      }
    }
  } catch {
    // fall back to seed
  }
  const seed = createInitialWorkspaceSnapshot();
  writeDemoWorkspace(seed);
  return seed;
}

export function writeDemoWorkspace(snapshot: WorkspaceSnapshot): void {
  try {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore storage quota
  }
}

export function resetDemoWorkspace(): WorkspaceSnapshot {
  const fresh = createInitialWorkspaceSnapshot();
  writeDemoWorkspace(fresh);
  return fresh;
}

export function isDemoModePreferred(): boolean {
  try {
    return localStorage.getItem(DEMO_MODE_FLAG_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setDemoModePreferred(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(DEMO_MODE_FLAG_KEY, 'true');
    } else {
      localStorage.removeItem(DEMO_MODE_FLAG_KEY);
    }
  } catch {
    // ignore
  }
}

// --- Production Backend & Firestore Repository ---
export const paperflowRepository = {
  async fetchHealth(): Promise<BackendHealthStatus> {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error('Health check failed');
      return (await res.json()) as BackendHealthStatus;
    } catch {
      return {
        status: 'ok',
        mode: 'demo',
        metaConnected: false,
        metaSendApiReady: false,
        metaWebhookSignatureReady: false,
        metaMissingEnvVars: [
          'META_APP_ID',
          'META_APP_SECRET',
          'META_PAGE_ACCESS_TOKEN',
          'META_VERIFY_TOKEN',
        ],
        firebaseConfigured: false,
        firebaseProjectId: null,
        firestoreDatabaseId: null,
        serverTimestamp: new Date().toISOString(),
      };
    }
  },

  async ensureFirestoreWorkspace(session: OperatorSession): Promise<WorkspaceProfile> {
    const wsId = session.workspaceId || DEFAULT_STUDIO_WORKSPACE_ID;
    const wsPath = `workspaces/${wsId}`;
    const wsRef = doc(db, 'workspaces', wsId);

    try {
      const snap = await getDoc(wsRef);
      if (snap.exists()) {
        return snap.data() as WorkspaceProfile;
      }

      const nowIso = new Date().toISOString();
      const initialProfile: WorkspaceProfile & { createdAt: string; updatedAt: string } = {
        ownerUid: session.uid,
        businessName: 'Paper Dreams Cebu',
        brandTagline: 'Bespoke Event Stationery, Keepsake Booths & Celebrations',
        location: 'Cebu City, Philippines',
        timezone: 'Asia/Manila (UTC+8)',
        currency: 'PHP',
        operatingHours: 'Mon–Sat, 9:00 AM – 7:00 PM PHT',
        defaultAiFallbackMessage:
          'Thank you for messaging Paper Dreams Cebu! Our studio coordinator will review your event details shortly and send a custom quote.',
        isDemoWorkspace: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      await setDoc(wsRef, initialProfile);
      await setDoc(doc(db, 'workspaces', wsId, 'members', session.uid), {
        uid: session.uid,
        email: session.email,
        displayName: session.displayName,
        role: 'Owner',
        createdAt: nowIso,
      });

      return initialProfile;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, wsPath);
    }
  },

  async seedStarterTemplatesToFirestore(session: OperatorSession): Promise<void> {
    const wsId = session.workspaceId;
    try {
      for (const wf of DEMO_WORKFLOWS) {
        const wfId = sanitizeId(wf.id);
        await setDoc(
          doc(db, 'workspaces', wsId, 'workflows', wfId),
          omitUndefined({
            ...wf,
            id: undefined,
            ownerUid: session.uid,
          })
        );
      }
      for (const kb of DEMO_KNOWLEDGE_BASE) {
        const kbId = sanitizeId(kb.id);
        await setDoc(
          doc(db, 'workspaces', wsId, 'knowledgeBase', kbId),
          omitUndefined({
            ...kb,
            id: undefined,
            ownerUid: session.uid,
          })
        );
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `workspaces/${wsId}/knowledgeBase`);
    }
  },

  subscribeToWorkspace(
    session: OperatorSession,
    handlers: {
      onProfile: (profile: WorkspaceProfile) => void;
      onConversations: (conversations: Conversation[]) => void;
      onWorkflows: (workflows: Workflow[]) => void;
      onLeads: (leads: Lead[]) => void;
      onBookings: (bookings: Booking[]) => void;
      onKnowledgeBase: (items: KnowledgeBaseItem[]) => void;
      onAutomationLogs: (logs: AutomationLog[]) => void;
      onError: (err: Error) => void;
    }
  ): () => void {
    const wsId = session.workspaceId;
    const unsubs: Unsubscribe[] = [];
    const messageUnsubs = new Map<string, Unsubscribe>();
    let latestMessagesByConv = new Map<string, Message[]>();
    let latestConvHeaders: Array<Omit<Conversation, 'messages'>> = [];

    const emitMergedConversations = () => {
      const merged: Conversation[] = latestConvHeaders
        .map((c) => ({
          ...c,
          messages: (latestMessagesByConv.get(c.id) ?? []).sort((a, b) =>
            a.timestamp.localeCompare(b.timestamp)
          ),
        }))
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
      handlers.onConversations(merged);
    };

    const wsRef = doc(db, 'workspaces', wsId);
    unsubs.push(
      onSnapshot(
        wsRef,
        (snap) => {
          if (snap.exists()) {
            handlers.onProfile(snap.data() as WorkspaceProfile);
          }
        },
        (error) => {
          try {
            handleFirestoreError(error, OperationType.GET, `workspaces/${wsId}`);
          } catch (e) {
            handlers.onError(e as Error);
          }
        }
      )
    );

    unsubs.push(
      onSnapshot(
        scopedQuery(wsId, 'conversations', session),
        (snapshot) => {
          const convs = snapshot.docs.map((d) => ({
            ...(d.data() as Omit<Conversation, 'id' | 'messages'>),
            id: d.id,
          }));
          latestConvHeaders = convs;

          const activeIds = new Set(convs.map((c) => c.id));
          for (const [cid, unsub] of messageUnsubs.entries()) {
            if (!activeIds.has(cid)) {
              unsub();
              messageUnsubs.delete(cid);
              latestMessagesByConv.delete(cid);
            }
          }

          for (const conv of convs) {
            if (!messageUnsubs.has(conv.id)) {
              const msgCol = collection(db, 'workspaces', wsId, 'conversations', conv.id, 'messages');
              const msgQuery = isAdminEmail(session.email)
                ? msgCol
                : query(msgCol, where('ownerUid', '==', session.uid));

              const msgUnsub = onSnapshot(
                msgQuery,
                (msgSnap) => {
                  const msgs = msgSnap.docs.map((m) => ({
                    ...(m.data() as Omit<Message, 'id'>),
                    id: m.id,
                  }));
                  latestMessagesByConv.set(conv.id, msgs);
                  emitMergedConversations();
                },
                (error) => {
                  try {
                    handleFirestoreError(
                      error,
                      OperationType.LIST,
                      `workspaces/${wsId}/conversations/${conv.id}/messages`
                    );
                  } catch (e) {
                    handlers.onError(e as Error);
                  }
                }
              );
              messageUnsubs.set(conv.id, msgUnsub);
            }
          }

          emitMergedConversations();
        },
        (error) => {
          try {
            handleFirestoreError(error, OperationType.LIST, `workspaces/${wsId}/conversations`);
          } catch (e) {
            handlers.onError(e as Error);
          }
        }
      )
    );

    unsubs.push(
      onSnapshot(
        scopedQuery(wsId, 'workflows', session),
        (snap) => {
          handlers.onWorkflows(
            snap.docs.map((d) => ({ ...(d.data() as Omit<Workflow, 'id'>), id: d.id }))
          );
        },
        (error) => {
          try {
            handleFirestoreError(error, OperationType.LIST, `workspaces/${wsId}/workflows`);
          } catch (e) {
            handlers.onError(e as Error);
          }
        }
      )
    );

    unsubs.push(
      onSnapshot(
        scopedQuery(wsId, 'leads', session),
        (snap) => {
          handlers.onLeads(
            snap.docs.map((d) => ({ ...(d.data() as Omit<Lead, 'id'>), id: d.id }))
          );
        },
        (error) => {
          try {
            handleFirestoreError(error, OperationType.LIST, `workspaces/${wsId}/leads`);
          } catch (e) {
            handlers.onError(e as Error);
          }
        }
      )
    );

    unsubs.push(
      onSnapshot(
        scopedQuery(wsId, 'bookings', session),
        (snap) => {
          handlers.onBookings(
            snap.docs.map((d) => ({ ...(d.data() as Omit<Booking, 'id'>), id: d.id }))
          );
        },
        (error) => {
          try {
            handleFirestoreError(error, OperationType.LIST, `workspaces/${wsId}/bookings`);
          } catch (e) {
            handlers.onError(e as Error);
          }
        }
      )
    );

    unsubs.push(
      onSnapshot(
        scopedQuery(wsId, 'knowledgeBase', session),
        (snap) => {
          handlers.onKnowledgeBase(
            snap.docs.map((d) => ({ ...(d.data() as Omit<KnowledgeBaseItem, 'id'>), id: d.id }))
          );
        },
        (error) => {
          try {
            handleFirestoreError(error, OperationType.LIST, `workspaces/${wsId}/knowledgeBase`);
          } catch (e) {
            handlers.onError(e as Error);
          }
        }
      )
    );

    unsubs.push(
      onSnapshot(
        scopedQuery(wsId, 'automationLogs', session),
        (snap) => {
          handlers.onAutomationLogs(
            snap.docs
              .map((d) => ({ ...(d.data() as Omit<AutomationLog, 'id'>), id: d.id }))
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          );
        },
        (error) => {
          try {
            handleFirestoreError(error, OperationType.LIST, `workspaces/${wsId}/automationLogs`);
          } catch (e) {
            handlers.onError(e as Error);
          }
        }
      )
    );

    return () => {
      for (const unsub of unsubs) unsub();
      for (const unsub of messageUnsubs.values()) unsub();
      messageUnsubs.clear();
    };
  },

  async updateProfile(session: OperatorSession, profile: WorkspaceProfile): Promise<void> {
    const path = `workspaces/${session.workspaceId}`;
    try {
      await updateDoc(
        doc(db, 'workspaces', session.workspaceId),
        omitUndefined({
          businessName: profile.businessName,
          brandTagline: profile.brandTagline,
          location: profile.location,
          timezone: profile.timezone,
          operatingHours: profile.operatingHours,
          defaultAiFallbackMessage: profile.defaultAiFallbackMessage,
          isDemoWorkspace: false,
          updatedAt: new Date().toISOString(),
        })
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async saveConversationMeta(
    session: OperatorSession,
    conversation: Conversation
  ): Promise<void> {
    const convId = sanitizeId(conversation.id);
    const path = `workspaces/${session.workspaceId}/conversations/${convId}`;
    const ref = doc(db, 'workspaces', session.workspaceId, 'conversations', convId);

    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(
          ref,
          omitUndefined({
            guestName: conversation.guestName,
            firstName: conversation.firstName,
            lastName: conversation.lastName,
            profilePicUrl: conversation.profilePicUrl,
            profileFetchedAt: conversation.profileFetchedAt,
            avatarInitials: conversation.avatarInitials,
            aiEnabled: conversation.aiEnabled,
            leadStatus: conversation.leadStatus,
            tags: conversation.tags.slice(0, 20),
            unreadCount: conversation.unreadCount,
            lastMessagePreview: conversation.lastMessagePreview.slice(0, 500),
            lastMessageAt: conversation.lastMessageAt,
            assignedOperator: conversation.assignedOperator,
            needsHumanHandoff: conversation.needsHumanHandoff,
          })
        );
      } else {
        await setDoc(
          ref,
          omitUndefined({
            ownerUid: session.uid,
            leadId: conversation.leadId,
            psid: conversation.psid,
            guestName: conversation.guestName,
            firstName: conversation.firstName,
            lastName: conversation.lastName,
            profilePicUrl: conversation.profilePicUrl,
            profileFetchedAt: conversation.profileFetchedAt,
            messengerHandle: conversation.messengerHandle,
            avatarInitials: conversation.avatarInitials,
            avatarTone: conversation.avatarTone,
            aiEnabled: conversation.aiEnabled,
            leadStatus: conversation.leadStatus,
            tags: conversation.tags.slice(0, 20),
            unreadCount: conversation.unreadCount,
            lastMessagePreview: conversation.lastMessagePreview.slice(0, 500),
            lastMessageAt: conversation.lastMessageAt,
            channel: conversation.channel,
            assignedOperator: conversation.assignedOperator,
            needsHumanHandoff: conversation.needsHumanHandoff,
          })
        );
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async appendMessage(session: OperatorSession, message: Message): Promise<void> {
    const convId = sanitizeId(message.conversationId);
    const msgId = sanitizeId(message.id);
    const path = `workspaces/${session.workspaceId}/conversations/${convId}/messages/${msgId}`;
    try {
      await setDoc(
        doc(db, 'workspaces', session.workspaceId, 'conversations', convId, 'messages', msgId),
        omitUndefined({
          ownerUid: session.uid,
          conversationId: convId,
          externalMid: message.externalMid,
          sender: message.sender,
          senderName: message.senderName,
          text: message.text.slice(0, 4000),
          timestamp: message.timestamp,
          isSimulated: message.isSimulated,
          matchedKbTitle: message.matchedKbTitle,
          matchedWorkflowName: message.matchedWorkflowName,
        })
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  async saveWorkflow(session: OperatorSession, workflow: Workflow): Promise<void> {
    const wfId = sanitizeId(workflow.id);
    const path = `workspaces/${session.workspaceId}/workflows/${wfId}`;
    const ref = doc(db, 'workspaces', session.workspaceId, 'workflows', wfId);
    try {
      const snap = await getDoc(ref);
      const payload = omitUndefined({
        name: workflow.name.slice(0, 140),
        description: workflow.description.slice(0, 500),
        status: workflow.status,
        triggerSummary: workflow.triggerSummary.slice(0, 300),
        runsSimulated: workflow.runsSimulated,
        handoffRatePct: workflow.handoffRatePct,
        updatedAt: workflow.updatedAt,
        nodes: workflow.nodes.slice(0, 50),
        edges: workflow.edges.slice(0, 100),
      });
      if (snap.exists()) {
        await updateDoc(ref, payload);
      } else {
        await setDoc(ref, { ...payload, ownerUid: session.uid });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async deleteWorkflow(session: OperatorSession, workflowId: string): Promise<void> {
    const wfId = sanitizeId(workflowId);
    const path = `workspaces/${session.workspaceId}/workflows/${wfId}`;
    try {
      await deleteDoc(doc(db, 'workspaces', session.workspaceId, 'workflows', wfId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async saveLead(session: OperatorSession, lead: Lead): Promise<void> {
    const leadId = sanitizeId(lead.id);
    const path = `workspaces/${session.workspaceId}/leads/${leadId}`;
    const ref = doc(db, 'workspaces', session.workspaceId, 'leads', leadId);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(
          ref,
          omitUndefined({
            name: lead.name.slice(0, 120),
            firstName: lead.firstName?.slice(0, 80),
            lastName: lead.lastName?.slice(0, 80),
            profilePicUrl: lead.profilePicUrl?.slice(0, 1000),
            profileFetchedAt: lead.profileFetchedAt?.slice(0, 64),
            messengerHandle: lead.messengerHandle.slice(0, 120),
            email: lead.email.slice(0, 254),
            phone: lead.phone.slice(0, 40),
            eventType: lead.eventType.slice(0, 120),
            eventDate: lead.eventDate.slice(0, 32),
            venue: lead.venue.slice(0, 200),
            estimatedValuePhp: lead.estimatedValuePhp,
            status: lead.status,
            tags: lead.tags.slice(0, 20),
            lastContactAt: lead.lastContactAt,
            notes: lead.notes.slice(0, 2000),
          })
        );
      } else {
        await setDoc(
          ref,
          omitUndefined({
            ownerUid: session.uid,
            psid: lead.psid,
            name: lead.name.slice(0, 120),
            firstName: lead.firstName?.slice(0, 80),
            lastName: lead.lastName?.slice(0, 80),
            profilePicUrl: lead.profilePicUrl?.slice(0, 1000),
            profileFetchedAt: lead.profileFetchedAt?.slice(0, 64),
            messengerHandle: lead.messengerHandle.slice(0, 120),
            email: lead.email.slice(0, 254),
            phone: lead.phone.slice(0, 40),
            eventType: lead.eventType.slice(0, 120),
            eventDate: lead.eventDate.slice(0, 32),
            venue: lead.venue.slice(0, 200),
            estimatedValuePhp: lead.estimatedValuePhp,
            status: lead.status,
            tags: lead.tags.slice(0, 20),
            source: lead.source,
            lastContactAt: lead.lastContactAt,
            notes: lead.notes.slice(0, 2000),
          })
        );
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async deleteLead(session: OperatorSession, leadId: string): Promise<void> {
    const id = sanitizeId(leadId);
    const path = `workspaces/${session.workspaceId}/leads/${id}`;
    try {
      await deleteDoc(doc(db, 'workspaces', session.workspaceId, 'leads', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async saveBooking(session: OperatorSession, booking: Booking): Promise<void> {
    const bkId = sanitizeId(booking.id);
    const path = `workspaces/${session.workspaceId}/bookings/${bkId}`;
    const ref = doc(db, 'workspaces', session.workspaceId, 'bookings', bkId);
    try {
      const snap = await getDoc(ref);
      const payload = omitUndefined({
        leadId: booking.leadId,
        clientName: booking.clientName.slice(0, 120),
        eventTitle: booking.eventTitle.slice(0, 160),
        packageName: booking.packageName.slice(0, 160),
        eventDate: booking.eventDate.slice(0, 32),
        eventTime: booking.eventTime.slice(0, 16),
        venue: booking.venue.slice(0, 200),
        totalPhp: booking.totalPhp,
        depositPaidPhp: booking.depositPaidPhp,
        status: booking.status,
        notes: booking.notes.slice(0, 2000),
      });
      if (snap.exists()) {
        await updateDoc(ref, payload);
      } else {
        await setDoc(ref, { ...payload, ownerUid: session.uid });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async deleteBooking(session: OperatorSession, bookingId: string): Promise<void> {
    const id = sanitizeId(bookingId);
    const path = `workspaces/${session.workspaceId}/bookings/${id}`;
    try {
      await deleteDoc(doc(db, 'workspaces', session.workspaceId, 'bookings', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async saveKnowledgeItem(session: OperatorSession, item: KnowledgeBaseItem): Promise<void> {
    const id = sanitizeId(item.id);
    const path = `workspaces/${session.workspaceId}/knowledgeBase/${id}`;
    const ref = doc(db, 'workspaces', session.workspaceId, 'knowledgeBase', id);
    try {
      const snap = await getDoc(ref);
      const payload = omitUndefined({
        category: item.category,
        title: item.title.slice(0, 160),
        summary: item.summary.slice(0, 400),
        details: item.details.slice(0, 3000),
        pricePhp: item.pricePhp,
        durationOrLeadTime: item.durationOrLeadTime,
        keywords: item.keywords.slice(0, 30),
        updatedAt: item.updatedAt,
        active: item.active,
      });
      if (snap.exists()) {
        await updateDoc(ref, payload);
      } else {
        await setDoc(ref, { ...payload, ownerUid: session.uid });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async deleteKnowledgeItem(session: OperatorSession, itemId: string): Promise<void> {
    const id = sanitizeId(itemId);
    const path = `workspaces/${session.workspaceId}/knowledgeBase/${id}`;
    try {
      await deleteDoc(doc(db, 'workspaces', session.workspaceId, 'knowledgeBase', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async logAutomationRun(session: OperatorSession, log: AutomationLog): Promise<void> {
    const id = sanitizeId(log.id);
    const path = `workspaces/${session.workspaceId}/automationLogs/${id}`;
    try {
      await setDoc(
        doc(db, 'workspaces', session.workspaceId, 'automationLogs', id),
        omitUndefined({
          ownerUid: session.uid,
          conversationId: log.conversationId,
          workflowId: log.workflowId,
          workflowName: log.workflowName,
          matchedKbTitle: log.matchedKbTitle,
          channel: log.channel,
          outcome: log.outcome,
          errorMessage: log.errorMessage?.slice(0, 400),
          createdAt: log.createdAt,
        })
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  async sendLiveMessengerReply(params: {
    workspaceId: string;
    conversationId: string;
    recipientPsid: string;
    text: string;
    senderName: string;
  }): Promise<Message> {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Firebase authentication required to send live Messenger replies.');
    }
    const idToken = await user.getIdToken();
    const res = await fetch('/api/messenger/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(params),
    });

    const data = (await res.json()) as {
      error?: string;
      message?: Message;
    };

    if (!res.ok || !data.message) {
      throw new Error(data.error || `Meta Send API failed (${res.status}).`);
    }
    return data.message;
  },

  async checkExistingWorkflowCount(session: OperatorSession): Promise<number> {
    const snap = await getDocs(scopedQuery(session.workspaceId, 'workflows', session));
    return snap.size;
  },
};
