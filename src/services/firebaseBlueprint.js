/**
 * Firebase Blueprint collection paths synchronized with `firebase-blueprint.json`
 * and `firestore.rules`.
 */
export const DEFAULT_STUDIO_WORKSPACE_ID = 'paper-dreams-cebu';
export const BOOTSTRAPPED_ADMIN_EMAIL = 'Martiligando@gmail.com';
export const FIRESTORE_COLLECTIONS = {
    workspaces: 'workspaces',
    workspaceMembers: 'workspaces/{workspaceId}/members',
    conversations: 'workspaces/{workspaceId}/conversations',
    messages: 'workspaces/{workspaceId}/conversations/{conversationId}/messages',
    workflows: 'workspaces/{workspaceId}/workflows',
    leads: 'workspaces/{workspaceId}/leads',
    bookings: 'workspaces/{workspaceId}/bookings',
    knowledgeBase: 'workspaces/{workspaceId}/knowledgeBase',
    automationLogs: 'workspaces/{workspaceId}/automationLogs',
    webhookDedup: 'workspaces/{workspaceId}/webhookDedup',
};
export function resolveWorkspaceIdForUser(email, uid) {
    if (email && email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
        return DEFAULT_STUDIO_WORKSPACE_ID;
    }
    const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'studio';
    return `ws-${safeUid}`;
}
