# Ledge Cloud V2 Notes

V1 intentionally ships personal cloud sync only. Do not add unused Convex tables for these concepts until their product surface is ready.

## Teams

- Team workspaces with owner/admin/member roles.
- Shared shelves with per-team quotas and audit events.
- Team billing should map Lemon Squeezy customer/subscription state to one team, not to individual shelf records.

## Automations

- Folder monitoring rules.
- Scheduled shelf cleanup and recurring snapshots.
- Convex scheduled functions or crons for durable background work.

## AI Agent Workflows

- Add `@convex-dev/agent` only when there is a real assistant feature, such as organizing a shelf, summarizing synced text/image assets, or running automation tool calls.
