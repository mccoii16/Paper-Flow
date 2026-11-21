import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSimulatedAutoReply,
  computeDashboardMetrics,
  formatCsvReport,
  matchKnowledgeBase,
  simulateWorkflowRun,
} from './automationEngine.js';
import {
  DEMO_BOOKINGS,
  DEMO_CONVERSATIONS,
  DEMO_KNOWLEDGE_BASE,
  DEMO_LEADS,
  DEMO_WORKFLOWS,
} from '../data/demoSeed.js';

test('matchKnowledgeBase matches Luxe Mirror Booth pricing inquiry', () => {
  const match = matchKnowledgeBase(
    'Hi, how much is your luxe mirror photobooth package?',
    DEMO_KNOWLEDGE_BASE
  );
  assert.ok(match);
  assert.equal(match.item.id, 'kb-pkg-1');
  assert.equal(match.item.pricePhp, 18500);
});

test('simulateWorkflowRun follows true branch for wedding message and updates lead', () => {
  const wf = DEMO_WORKFLOWS[0];
  const trace = simulateWorkflowRun(wf, {
    guestName: 'Ysabel Villanueva',
    messageText: 'Asking about wedding package rates please',
    leadStatus: 'New Inquiry',
    tags: [],
  });
  assert.equal(trace.matchedTrigger, true);
  assert.equal(trace.finalStatus, 'Qualified');
  assert.ok(trace.addedTags.includes('Package Inquiry'));
  assert.ok(trace.generatedReply?.includes('Ysabel'));
  assert.ok(trace.steps.some((s) => s.branchTaken === 'true'));
});

test('simulateWorkflowRun escalates corporate rush inquiries to human handoff', () => {
  const wf = DEMO_WORKFLOWS[1];
  const trace = simulateWorkflowRun(wf, {
    guestName: 'Camille Ortega',
    messageText: 'We need a rush corporate quote with BIR invoice',
    leadStatus: 'New Inquiry',
    tags: [],
  });
  assert.equal(trace.matchedTrigger, true);
  assert.equal(trace.handoffTriggered, true);
  assert.equal(trace.finalStatus, 'Needs Handoff');
});

test('buildSimulatedAutoReply uses KB fallback when no workflow keyword matches', () => {
  const conv = DEMO_CONVERSATIONS[0];
  const output = buildSimulatedAutoReply({
    conversation: conv,
    incomingText: 'What is your GCash deposit policy?',
    workflows: DEMO_WORKFLOWS,
    knowledgeBase: DEMO_KNOWLEDGE_BASE,
    fallbackMessage: 'Default fallback',
  });
  assert.equal(output.matchedKbItem?.id, 'kb-pol-1');
  assert.ok(output.replyText.includes('30% reservation deposit'));
});

test('computeDashboardMetrics calculates accurate counts and revenue', () => {
  const metrics = computeDashboardMetrics({
    conversations: DEMO_CONVERSATIONS,
    workflows: DEMO_WORKFLOWS,
    leads: DEMO_LEADS,
    bookings: DEMO_BOOKINGS,
  });
  assert.equal(metrics.activeConversations, 4);
  assert.equal(metrics.activeWorkflowsCount, 2);
  assert.equal(metrics.confirmedBookingsCount, 3);
  assert.equal(metrics.confirmedRevenuePhp, 18500 + 22300 + 24000);
});

test('formatCsvReport escapes commas and quotes properly', () => {
  const csv = formatCsvReport(['Name', 'Venue'], [['Villanueva, Ysabel', 'Shangri-La "Mactan"']]);
  assert.equal(csv, 'Name,Venue\n"Villanueva, Ysabel","Shangri-La ""Mactan"""');
});
