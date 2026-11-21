# PaperFlow Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Default Deny**: All unmatched paths under `/databases/{database}/documents` are denied (`allow read, write: if false`).
2. **Verified Identity**: Every client read or write requires `request.auth != null` and `request.auth.token.email_verified == true`.
3. **Workspace Ownership & RBAC**: Access to `/workspaces/{workspaceId}` and its subcollections is strictly restricted to:
   - The workspace owner (`ownerUid == request.auth.uid`), OR
   - Verified workspace members in `/workspaces/{workspaceId}/members/{request.auth.uid}`, OR
   - The bootstrapped studio admin (`request.auth.token.email == 'Martiligando@gmail.com' && request.auth.token.email_verified == true`).
4. **No Client Access to Webhook Deduplication**: `/workspaces/{workspaceId}/webhookDedup/{eventId}` is server-only (Admin SDK); client SDK reads and writes are denied.
5. **PII Isolation**: Client contact records (`leads` containing `email` and `phone`) and `conversations` are readable/listable ONLY when `isBootstrappedAdmin() || resource.data.ownerUid == request.auth.uid`. Blanket `isSignedIn()` reads are forbidden.
6. **Immutability & Strict Keys**: `ownerUid` cannot be reassigned on update; every entity enforces `keys().hasAll(...)`, `keys().hasOnly(...)`, `.size()` string/list bounds, and valid ID regex `^[a-zA-Z0-9_\-]+$`.
7. **Terminal State Protection**: Completed or Cancelled bookings cannot be silently reverted by non-admin members.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read**: `GET /workspaces/paper-dreams-cebu/leads/lead-1` with `auth = null`.
2. **Unverified Email Spoof**: `GET /workspaces/paper-dreams-cebu/leads/lead-1` with `email = 'Martiligando@gmail.com'`, `email_verified = false`.
3. **Cross-Tenant List Scraping**: `LIST /workspaces/paper-dreams-cebu/leads` by authenticated user `attacker-uid` without `ownerUid == 'attacker-uid'`.
4. **ID Poisoning**: `CREATE /workspaces/ws-1/leads/invalid$id..slash` with non-alphanumeric ID or >128 chars.
5. **Shadow / Ghost Field Injection**: `CREATE /workspaces/ws-1/leads/lead-99` adding unexpected `isAdmin: true`.
6. **Identity Spoofing on Create**: `CREATE /workspaces/ws-1/leads/lead-99` with `ownerUid: 'victim-uid'` while signed in as `'attacker-uid'`.
7. **Owner Reassignment on Update**: `UPDATE /workspaces/ws-1/leads/lead-1` changing `ownerUid` to `'attacker-uid'`.
8. **Self-Assigned Role Escalation**: `CREATE /workspaces/ws-1/members/attacker-uid` setting `role: 'Owner'` as non-owner.
9. **Array Bombing**: `CREATE /workspaces/ws-1/conversations/conv-9` with `tags` array containing >20 items.
10. **String Resource Exhaustion**: `CREATE /workspaces/ws-1/knowledgeBase/kb-9` with `details` > 5000 chars.
11. **Client Tampering with Webhook Dedup**: `CREATE /workspaces/paper-dreams-cebu/webhookDedup/mid-1` from client SDK.
12. **Terminal Booking Reversion**: `UPDATE /workspaces/ws-1/bookings/bk-done` changing `status` from `'Completed'` back to `'Pending Deposit'` by non-admin.
