# Convex Backend Skill

## Overview
Ledge uses Convex for optional cloud sync, authentication, and billing. The backend is defined in `convex/`.

## Key Files
- `convex/schema.ts` — Database schema (users, shelves, preferences, entitlements, imageAssets, syncEvents)
- `convex/auth.ts` — Email OTP authentication
- `convex/sync.ts` — Shelf sync logic
- `convex/billing.ts` — LemonSqueezy integration
- `convex/crons.ts` — Scheduled tasks
- `convex/http.ts` — HTTP actions (webhooks)

## Schema Tables
- `users` — Email-based users
- `authOtps` — Email OTP codes (hashed, with expiry)
- `authSessions` — Session tokens (hashed, with expiry)
- `devices` — Registered devices per user
- `shelves` — Synced shelf records (per user, per device)
- `preferences` — User preference overrides
- `entitlements` — Plan status (free/pro) via LemonSqueezy
- `imageAssets` — Uploaded images in Convex storage
- `syncEvents` — Audit log for sync operations

## Conventions
- **Always read `convex/_generated/ai/guidelines.md`** before writing Convex code
- Use `v.object()` for validators, not raw TypeScript types
- Index lookups must match defined indexes exactly
- Storage IDs are `v.id("_storage")` — not arbitrary strings
- Timestamps are `v.number()` (Unix ms), not strings
- Shelf items use discriminated union on `kind` field

## Auth Flow
1. User enters email → `auth.ts` sends OTP via Resend
2. OTP verified → session token created
3. Token sent with every Convex call via `ConvexProvider`

## Sync Flow
1. Local shelf changes → `sync.ts` upserts to `shelves` table
2. Remote changes pulled via `getSyncState` query
3. Conflict resolution: latest `updatedAt` wins
4. Image assets uploaded separately to Convex storage

## Billing
- LemonSqueezy webhooks → `convex/http.ts`
- Entitlements checked before pro features
- `entitlements` table tracks plan, status, subscription IDs

## Common Patterns
```typescript
// Query with index
const shelf = await ctx.db
  .query("shelves")
  .withIndex("by_user_and_shelf", (q) => q.eq("userId", userId).eq("shelfId", shelfId))
  .unique();

// Mutation with validation
export const updateShelf = mutation({
  args: { shelfId: v.string(), name: v.string() },
  handler: async (ctx, args) => { /* ... */ }
});
```

## Pitfalls
- **Never skip schema validation** — all inputs must go through Zod/Vu validators
- **Index names must match** — typos silently return empty results
- **Storage cleanup** — deleting shelves should also delete associated imageAssets
- **Rate limiting** — OTP endpoints need rate limiting (check http.ts)
- **Webhook verification** — always verify LemonSqueezy signature
