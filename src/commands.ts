import type { OperationId } from "@pitchmentor/sdk";

/** `pitchmentor <group> <command>` → operation. The first command of a group is its default. */
export const COMMANDS: Record<string, Record<string, OperationId>> = {
  me: { get: "getMe" },
  calls: {
    list: "listCalls",
    get: "getCall",
    export: "exportCalls",
    summarize: "summarizeCall",
    archive: "archiveCall",
    unarchive: "unarchiveCall",
  },
  analytics: { overview: "getAnalyticsOverview", users: "getAnalyticsByMember" },
  leads: { list: "listLeads", get: "getLead", upsert: "upsertLead", batch: "batchUpsertLeads", update: "updateLead" },
  team: { get: "getTeamConfig", update: "updateTeamConfig" },
  members: { list: "listMembers", remove: "removeMember" },
  invites: { list: "listInvites", create: "createInvite", cancel: "cancelInvite" },
  coaching: { styles: "listCoachingStyles", "create-style": "createCoachingStyle", "update-style": "updateCoachingStyle" },
  billing: { subscription: "getBillingStatus", usage: "getUsage", "member-usage": "listMemberUsage" },
  referrals: { get: "getReferralStats" },
  webhooks: {
    list: "listWebhookEndpoints",
    get: "getWebhookEndpoint",
    create: "createWebhookEndpoint",
    update: "updateWebhookEndpoint",
    delete: "deleteWebhookEndpoint",
    "rotate-secret": "rotateWebhookSecret",
    test: "testWebhookEndpoint",
    deliveries: "listWebhookDeliveries",
    replay: "replayWebhookDelivery",
  },
  "api-keys": { list: "listApiKeys", create: "createApiKey", rotate: "rotateApiKey", revoke: "revokeApiKey" },
  openapi: { get: "getOpenApi" },
};
