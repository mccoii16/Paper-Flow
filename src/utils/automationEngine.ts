import type {
  Booking,
  Conversation,
  KnowledgeBaseItem,
  Lead,
  LeadStatus,
  Workflow,
  WorkflowNode,
} from '../types/paperflow';

export interface KnowledgeMatchResult {
  item: KnowledgeBaseItem;
  score: number;
}

export interface SimulatedReplyOutput {
  replyText: string;
  matchedKbItem: KnowledgeBaseItem | null;
  matchedWorkflow: Workflow | null;
  triggeredHandoff: boolean;
  suggestedStatus?: LeadStatus;
  suggestedTags: string[];
}

export interface WorkflowSimulationStep {
  nodeId: string;
  nodeType: WorkflowNode['type'];
  title: string;
  outcome: string;
  branchTaken?: 'true' | 'false' | 'default';
}

export interface WorkflowSimulationTrace {
  matchedTrigger: boolean;
  steps: WorkflowSimulationStep[];
  finalStatus?: LeadStatus;
  addedTags: string[];
  handoffTriggered: boolean;
  generatedReply?: string;
}

/**
 * Matches a simulated Messenger guest message against active Business Knowledge Base entries.
 */
export function matchKnowledgeBase(
  messageText: string,
  knowledgeBase: KnowledgeBaseItem[]
): KnowledgeMatchResult | null {
  const normalized = messageText.toLowerCase().trim();
  if (!normalized) return null;

  let best: KnowledgeMatchResult | null = null;

  for (const item of knowledgeBase) {
    if (!item.active) continue;
    let score = 0;

    for (const kw of item.keywords) {
      const cleanKw = kw.toLowerCase().trim();
      if (cleanKw && normalized.includes(cleanKw)) {
        score += cleanKw.length > 5 ? 3 : 2;
      }
    }

    const titleWords = item.title.toLowerCase().split(/\s+/);
    for (const word of titleWords) {
      if (word.length >= 4 && normalized.includes(word)) {
        score += 1;
      }
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { item, score };
    }
  }

  return best;
}

/**
 * Evaluates a single condition node against message text, lead status, and tags.
 */
export function evaluateConditionNode(
  node: WorkflowNode,
  context: {
    messageText: string;
    leadStatus: LeadStatus;
    tags: string[];
  }
): boolean {
  const { conditionField = 'message_text', conditionOperator = 'contains', conditionValue = '' } =
    node.config;
  const target = conditionValue.toLowerCase().trim();
  if (!target) return true;

  if (conditionField === 'message_text') {
    const msg = context.messageText.toLowerCase();
    return conditionOperator === 'equals' ? msg.trim() === target : msg.includes(target);
  }
  if (conditionField === 'lead_status') {
    return context.leadStatus.toLowerCase() === target;
  }
  if (conditionField === 'tag') {
    return context.tags.some((t) => t.toLowerCase() === target);
  }
  return false;
}

/**
 * Runs a deterministic dry-run traversal of a visual workflow graph for testing & inbox simulation.
 */
export function simulateWorkflowRun(
  workflow: Workflow,
  input: {
    guestName: string;
    messageText: string;
    leadStatus: LeadStatus;
    tags: string[];
  }
): WorkflowSimulationTrace {
  const triggerNode = workflow.nodes.find((n) => n.type === 'trigger');
  if (!triggerNode) {
    return {
      matchedTrigger: false,
      steps: [],
      addedTags: [],
      handoffTriggered: false,
    };
  }

  const keywords = triggerNode.config.keywords ?? [];
  const msgLower = input.messageText.toLowerCase();
  const matchedTrigger =
    triggerNode.config.triggerEvent !== 'keyword_match' ||
    keywords.length === 0 ||
    keywords.some((kw) => msgLower.includes(kw.toLowerCase()));

  if (!matchedTrigger) {
    return {
      matchedTrigger: false,
      steps: [
        {
          nodeId: triggerNode.id,
          nodeType: triggerNode.type,
          title: triggerNode.title,
          outcome: `Skipped — message did not match keywords (${keywords.join(', ')})`,
        },
      ],
      addedTags: [],
      handoffTriggered: false,
    };
  }

  const steps: WorkflowSimulationStep[] = [];
  const addedTags: string[] = [];
  let finalStatus: LeadStatus | undefined;
  let handoffTriggered = false;
  let generatedReply: string | undefined;

  const firstName = input.guestName.split(' ')[0] || 'there';
  const visited = new Set<string>();
  let current: WorkflowNode | undefined = triggerNode;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    let nextBranch: 'default' | 'true' | 'false' = 'default';

    switch (current.type) {
      case 'trigger':
        steps.push({
          nodeId: current.id,
          nodeType: current.type,
          title: current.title,
          outcome: 'Trigger matched simulated guest message',
        });
        break;
      case 'condition': {
        const result = evaluateConditionNode(current, {
          messageText: input.messageText,
          leadStatus: finalStatus ?? input.leadStatus,
          tags: [...input.tags, ...addedTags],
        });
        nextBranch = result ? 'true' : 'false';
        steps.push({
          nodeId: current.id,
          nodeType: current.type,
          title: current.title,
          outcome: `Evaluated to ${result ? 'TRUE' : 'FALSE'}`,
          branchTaken: nextBranch,
        });
        break;
      }
      case 'send_reply': {
        const template = current.config.replyText || 'Thanks for messaging Paper Dreams Cebu!';
        const resolved = template.replace(/\{\{first_name\}\}/gi, firstName);
        generatedReply = resolved;
        steps.push({
          nodeId: current.id,
          nodeType: current.type,
          title: current.title,
          outcome: `Prepared reply: "${resolved.slice(0, 72)}${resolved.length > 72 ? '...' : ''}"`,
        });
        break;
      }
      case 'collect_info': {
        const prompt = current.config.promptText || 'Could you share your event date and venue?';
        generatedReply = generatedReply ? `${generatedReply}\n\n${prompt}` : prompt;
        steps.push({
          nodeId: current.id,
          nodeType: current.type,
          title: current.title,
          outcome: `Requested field: ${current.config.targetField ?? 'event_date'}`,
        });
        break;
      }
      case 'update_lead': {
        if (current.config.newLeadStatus) {
          finalStatus = current.config.newLeadStatus;
        }
        if (current.config.addTags?.length) {
          for (const tag of current.config.addTags) {
            if (!addedTags.includes(tag)) addedTags.push(tag);
          }
        }
        steps.push({
          nodeId: current.id,
          nodeType: current.type,
          title: current.title,
          outcome: `Updated lead${finalStatus ? ` → ${finalStatus}` : ''}${addedTags.length ? ` (+${addedTags.join(', ')})` : ''}`,
        });
        break;
      }
      case 'human_handoff': {
        handoffTriggered = true;
        finalStatus = 'Needs Handoff';
        steps.push({
          nodeId: current.id,
          nodeType: current.type,
          title: current.title,
          outcome: `Escalated to ${current.config.handoffTeam ?? 'Studio Coordinator'}`,
        });
        break;
      }
    }

    const outgoingEdge =
      workflow.edges.find((e) => e.source === current?.id && e.branch === nextBranch) ??
      workflow.edges.find((e) => e.source === current?.id);

    current = outgoingEdge
      ? workflow.nodes.find((n) => n.id === outgoingEdge.target)
      : undefined;
  }

  return {
    matchedTrigger: true,
    steps,
    finalStatus,
    addedTags,
    handoffTriggered,
    generatedReply,
  };
}

/**
 * Generates a simulated AI / workflow auto-reply for an incoming simulated Messenger message.
 */
export function buildSimulatedAutoReply(params: {
  conversation: Conversation;
  incomingText: string;
  workflows: Workflow[];
  knowledgeBase: KnowledgeBaseItem[];
  fallbackMessage: string;
}): SimulatedReplyOutput {
  const { conversation, incomingText, workflows, knowledgeBase, fallbackMessage } = params;
  const activeWorkflows = workflows.filter((w) => w.status === 'Active');

  for (const wf of activeWorkflows) {
    const trace = simulateWorkflowRun(wf, {
      guestName: conversation.guestName,
      messageText: incomingText,
      leadStatus: conversation.leadStatus,
      tags: conversation.tags,
    });
    if (trace.matchedTrigger) {
      const kbMatch = matchKnowledgeBase(incomingText, knowledgeBase);
      let replyText = trace.generatedReply || fallbackMessage;

      if (kbMatch && !replyText.includes(kbMatch.item.title)) {
        const pricePart = kbMatch.item.pricePhp
          ? ` (₱${kbMatch.item.pricePhp.toLocaleString('en-PH')})`
          : '';
        replyText = `${replyText}\n\n[KB: ${kbMatch.item.title}${pricePart}] ${kbMatch.item.summary}`;
      }

      return {
        replyText,
        matchedKbItem: kbMatch?.item ?? null,
        matchedWorkflow: wf,
        triggeredHandoff: trace.handoffTriggered,
        suggestedStatus: trace.finalStatus,
        suggestedTags: trace.addedTags,
      };
    }
  }

  const kbMatch = matchKnowledgeBase(incomingText, knowledgeBase);
  if (kbMatch) {
    const priceLabel = kbMatch.item.pricePhp
      ? ` Rate: ₱${kbMatch.item.pricePhp.toLocaleString('en-PH')}.`
      : '';
    return {
      replyText: `Hi ${conversation.guestName.split(' ')[0]}! Here are our details for ${kbMatch.item.title}:${priceLabel} ${kbMatch.item.summary} ${kbMatch.item.details}`,
      matchedKbItem: kbMatch.item,
      matchedWorkflow: null,
      triggeredHandoff: false,
      suggestedTags: [],
    };
  }

  return {
    replyText: fallbackMessage,
    matchedKbItem: null,
    matchedWorkflow: null,
    triggeredHandoff: false,
    suggestedTags: [],
  };
}

/**
 * Computes live dashboard KPIs directly from workspace entities.
 */
export function computeDashboardMetrics(data: {
  conversations: Conversation[];
  workflows: Workflow[];
  leads: Lead[];
  bookings: Booking[];
}) {
  const activeConversations = data.conversations.length;
  const aiActiveConversations = data.conversations.filter((c) => c.aiEnabled).length;
  const handoffQueue = data.conversations.filter((c) => c.needsHumanHandoff).length;
  const automatedRepliesCount = data.conversations.reduce(
    (sum, conv) => sum + conv.messages.filter((m) => m.sender === 'ai_sim').length,
    0
  );
  const qualifiedLeadsCount = data.leads.filter((l) =>
    ['Qualified', 'Proposal Sent', 'Booked'].includes(l.status)
  ).length;
  const confirmedBookings = data.bookings.filter((b) => b.status === 'Confirmed' || b.status === 'Completed');
  const confirmedRevenuePhp = confirmedBookings.reduce((sum, b) => sum + b.totalPhp, 0);
  const activeWorkflowsCount = data.workflows.filter((w) => w.status === 'Active').length;

  return {
    activeConversations,
    aiActiveConversations,
    handoffQueue,
    automatedRepliesCount,
    qualifiedLeadsCount,
    confirmedBookingsCount: confirmedBookings.length,
    confirmedRevenuePhp,
    activeWorkflowsCount,
  };
}

/**
 * Formats rows into an RFC-4180 compliant CSV string for export.
 */
export function formatCsvReport(headers: string[], rows: Array<Array<string | number>>): string {
  const escapeCell = (val: string | number) => {
    const str = String(val ?? '');
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  return [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join(
    '\n'
  );
}
