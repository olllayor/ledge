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

## Operational Notes

### Convex cleanup crons

The auth-session and OTP cleanup mutations were rewritten in the
`14807ce` security pass to walk `by_expiresAt` and `by_revokedAt` /
`by_consumedAt` indexes instead of the previous `.order("asc").take(100)`
that returned the 100 oldest **created** rows. The new path is bounded
to expired/revoked candidates, which is what we want — but the **first
run** on a deployment that has accumulated a large backlog of expired
sessions/OTPs can spike both read and delete throughput as the cleanup
loop drains the queue. If the prod deployment predates the new indexes,
coordinate the first deploy with whoever owns the Convex dashboard so
they can spot the spike and the loop's `runAfter(0, …)` rescheduling
behaving as expected.
