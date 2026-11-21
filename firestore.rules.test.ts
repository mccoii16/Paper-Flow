import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  DEFAULT_STUDIO_WORKSPACE_ID,
  FIRESTORE_COLLECTIONS,
  resolveWorkspaceIdForUser,
} from './src/services/firebaseBlueprint';

const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');
const rulesText = fs.readFileSync(RULES_PATH, 'utf8');

test('firestore.rules enforces global default deny, email_verified auth, and lowercase admin email check', () => {
  assert.match(rulesText, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
  assert.match(rulesText, /function isVerifiedUser\(\) \{\s*return isSignedIn\(\) && request\.auth\.token\.email_verified == true;\s*\}/);
  assert.match(rulesText, /request\.auth\.token\.email\.lower\(\) == 'martiligando@gmail\.com'/);
  assert.match(rulesText, /resource == null && workspaceId == 'ws-' \+ request\.auth\.uid/);
});

test('firestore.rules locks webhookDedup strictly to server-side Admin SDK', () => {
  assert.match(rulesText, /match \/webhookDedup\/\{eventId\} \{\s*allow read, write: if false;\s*\}/);
});

test('firestore.rules makes messages and automationLogs append-only (no client update)', () => {
  assert.match(rulesText, /match \/messages\/\{messageId\}[\s\S]*?allow update: if false;/);
  assert.match(rulesText, /match \/automationLogs\/\{logId\}[\s\S]*?allow update: if false;/);
});

test('firestore.rules enforces strict field whitelists and ownership immutability across collections', () => {
  const requiredValidators = [
    'isValidWorkspaceProfile',
    'isValidWorkspaceMember',
    'isValidConversation',
    'isValidMessage',
    'isValidWorkflow',
    'isValidLead',
    'isValidBooking',
    'isValidKnowledgeItem',
    'isValidAutomationLog',
  ];
  for (const fn of requiredValidators) {
    assert.ok(rulesText.includes(`function ${fn}(data)`), `Missing validator ${fn}`);
  }
  assert.match(rulesText, /incoming\(\)\.ownerUid == existing\(\)\.ownerUid/);
  assert.match(rulesText, /function isValidId\(id\)/);
});

test('resolveWorkspaceIdForUser routes bootstrapped admin to Paper Dreams Cebu workspace and isolates other UIDs', () => {
  assert.equal(
    resolveWorkspaceIdForUser(BOOTSTRAPPED_ADMIN_EMAIL, 'uid-admin-1'),
    DEFAULT_STUDIO_WORKSPACE_ID
  );
  assert.equal(
    resolveWorkspaceIdForUser('martiligando@gmail.com', 'uid-admin-1'),
    DEFAULT_STUDIO_WORKSPACE_ID
  );
  assert.equal(
    resolveWorkspaceIdForUser('other@example.com', 'abc_123'),
    'ws-abc_123'
  );
  assert.ok(FIRESTORE_COLLECTIONS.webhookDedup.endsWith('/webhookDedup'));
});
