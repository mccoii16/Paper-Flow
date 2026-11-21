export type NavPageId =
  | 'overview'
  | 'inbox'
  | 'automations'
  | 'builder'
  | 'contacts'
  | 'bookings'
  | 'analytics'
  | 'settings';

export type ThemeMode = 'light' | 'dark';

export type LeadStatus =
  | 'New Inquiry'
  | 'Qualified'
  | 'Proposal Sent'
  | 'Booked'
  | 'Needs Handoff'
  | 'Archived';

export type MessageSender = 'guest' | 'operator' | 'ai_sim' | 'ai_live' | 'system';
export type MessengerChannel = 'Messenger (Simulated)' | 'Messenger (Live)';

export interface Message {
  id: string;
  ownerUid?: string;
  conversationId: string;
  externalMid?: string;
  sender: MessageSender;
  senderName: string;
  text: string;
  timestamp: string;
  isSimulated?: boolean;
  matchedKbTitle?: string;
  matchedWorkflowName?: string;
}

export interface Conversation {
  id: string;
  ownerUid?: string;
  leadId: string;
  psid?: string;
  guestName: string;
  firstName?: string;
  lastName?: string;
  profilePicUrl?: string;
  profileFetchedAt?: string;
  messengerHandle: string;
  avatarInitials: string;
  avatarTone: 'pink' | 'navy' | 'slate' | 'rose';
  aiEnabled: boolean;
  leadStatus: LeadStatus;
  tags: string[];
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageAt: string;
  channel: MessengerChannel;
  assignedOperator?: string;
  needsHumanHandoff: boolean;
  messages: Message[];
}

export type WorkflowNodeType =
  | 'trigger'
  | 'condition'
  | 'send_reply'
  | 'collect_info'
  | 'update_lead'
  | 'human_handoff';

export interface WorkflowNodeConfig {
  triggerEvent?: 'message_received' | 'keyword_match' | 'postback_click' | 'story_reply';
  keywords?: string[];
  conditionField?: 'message_text' | 'lead_status' | 'tag';
  conditionOperator?: 'contains' | 'equals' | 'has_tag';
  conditionValue?: string;
  replyText?: string;
  useKnowledgeBase?: boolean;
  promptText?: string;
  targetField?: 'event_date' | 'venue' | 'guest_count' | 'email' | 'phone' | 'package_interest';
  newLeadStatus?: LeadStatus;
  addTags?: string[];
  handoffTeam?: string;
  handoffNote?: string;
  pauseAi?: boolean;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  title: string;
  x: number;
  y: number;
  config: WorkflowNodeConfig;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  branch?: 'default' | 'true' | 'false';
  label?: string;
}

export type WorkflowStatus = 'Active' | 'Paused' | 'Draft';

export interface Workflow {
  id: string;
  ownerUid?: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  triggerSummary: string;
  runsSimulated: number;
  handoffRatePct: number;
  updatedAt: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface Lead {
  id: string;
  ownerUid?: string;
  psid?: string;
  name: string;
  firstName?: string;
  lastName?: string;
  profilePicUrl?: string;
  profileFetchedAt?: string;
  messengerHandle: string;
  email: string;
  phone: string;
  eventType: string;
  eventDate: string;
  venue: string;
  estimatedValuePhp: number;
  status: LeadStatus;
  tags: string[];
  source: 'Messenger (Simulated)' | 'Messenger (Live)' | 'Instagram DM (Planned)' | 'Manual Entry';
  lastContactAt: string;
  notes: string;
}

export type BookingStatus = 'Pending Deposit' | 'Confirmed' | 'Completed' | 'Cancelled';

export interface Booking {
  id: string;
  ownerUid?: string;
  leadId?: string;
  clientName: string;
  eventTitle: string;
  packageName: string;
  eventDate: string;
  eventTime: string;
  venue: string;
  totalPhp: number;
  depositPaidPhp: number;
  status: BookingStatus;
  notes: string;
}

export type KnowledgeCategory = 'packages' | 'faqs' | 'services' | 'policies';

export interface KnowledgeBaseItem {
  id: string;
  ownerUid?: string;
  category: KnowledgeCategory;
  title: string;
  summary: string;
  details: string;
  pricePhp?: number;
  durationOrLeadTime?: string;
  keywords: string[];
  updatedAt: string;
  active: boolean;
}

export interface AutomationLog {
  id: string;
  ownerUid?: string;
  conversationId: string;
  workflowId?: string;
  workflowName?: string;
  matchedKbTitle?: string;
  channel: MessengerChannel;
  outcome:
    | 'replied'
    | 'handoff'
    | 'skipped_cooldown'
    | 'skipped_duplicate'
    | 'manual_only'
    | 'error';
  errorMessage?: string;
  createdAt: string;
}

export interface WorkspaceProfile {
  ownerUid?: string;
  businessName: string;
  brandTagline: string;
  location: string;
  timezone: string;
  currency: 'PHP';
  operatingHours: string;
  defaultAiFallbackMessage: string;
  isDemoWorkspace: boolean;
}

export interface OperatorSession {
  uid: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  role: 'Owner' | 'Coordinator' | 'Viewer';
  authProvider: 'firebase-google' | 'demo-local';
  workspaceId: string;
  signedInAt: string;
}

export interface BackendHealthStatus {
  status: 'ok';
  mode: 'production-ready' | 'demo';
  metaConnected: boolean;
  metaSendApiReady: boolean;
  metaWebhookSignatureReady: boolean;
  metaMissingEnvVars: string[];
  firebaseConfigured: boolean;
  firebaseProjectId: string | null;
  firestoreDatabaseId: string | null;
  serverTimestamp: string;
}

export interface WorkspaceSnapshot {
  profile: WorkspaceProfile;
  conversations: Conversation[];
  workflows: Workflow[];
  leads: Lead[];
  bookings: Booking[];
  knowledgeBase: KnowledgeBaseItem[];
  automationLogs?: AutomationLog[];
}
