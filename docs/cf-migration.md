# Cloudflare backend migration

Replace Convex with a Cloudflare Worker + D1 + R2. Keep local shelf behavior unchanged. Fix known sync bugs while rewriting the client.

## Stack

| Concern | Choice |
|---------|--------|
| HTTP | Cloudflare Worker + Hono |
| SQL | D1 (SQLite) |
| Blobs | R2 |
| Email | Cloudflare Email Service (`send_email` binding) |
| Cron | Cron Triggers (session/OTP/webhook cleanup) |
| Config | `wrangler.jsonc`, secrets via `wrangler secret` |

Package root: `cloudflare/`.

## Client contract

Renderer talks to the Worker with `fetch`. Session token stays in the main process Keychain (`SecureSessionStore`). Same IPC surface for session get/set/clear.

Env:

- `VITE_LEDGE_API_URL` — Worker origin (replaces `VITE_CONVEX_URL`)
- Worker vars/secrets: `EMAIL_FROM`, `LEMON_SQUEEZY_API_KEY`, `LEMON_SQUEEZY_WEBHOOK_SECRET`
- Email: onboard a sender domain (`wrangler email sending enable <domain>`), then `send_email` → `EMAIL` binding sends OTP/invites. No Resend key.

## Design rules (must fix, not copy)

1. **Unknown remotes insert.** Pull must insert shelves the device has never seen into recents. Never no-op.
2. **Recents eviction never deletes cloud.** `deleteShelf` only on explicit user discard (IPC `removeSyncedShelf` or UI delete).
3. **Persist sync cursor.** Server `updatedAt` cursor per shelf stored in main-process state, not only React memory.
4. **Strip local paths.** `savedFilePath`, `file.originalPath`, `file.resolvedPath`, `bookmarkBase64` never leave the device. Cloud items store text/url/kind/title + optional `cloudStorageKey` for R2.
5. **Invite email bind.** `acceptInvitation` requires session email === invite email.
6. **Per-item mutations preferred.** Whole-shelf upsert remains for backfill; live sync uses item upsert/delete.
7. **Apply remotes serially** on the client (no `Promise.all` last-write-wins).

## D1 schema (summary)

Tables (see `cloudflare/migrations/0001_init.sql`):

- `users(id TEXT PK, email TEXT UNIQUE, created_at, updated_at)`
- `auth_otps(id, email, code_hash, expires_at, consumed_at, failed_attempts, created_at)`
- `auth_sessions(id, user_id, token_hash UNIQUE, expires_at, revoked_at, created_at, last_refreshed_at)`
- `devices(user_id, device_id, name, platform, last_seen_at, created_at)` PK `(user_id, device_id)`
- `shelves(user_id, shelf_id, name, color, origin, items_json, local_created_at, local_updated_at, item_count, image_storage_bytes, created_at, updated_at, deleted_at)` PK `(user_id, shelf_id)`
- `shelf_items(team_id, shelf_id, item_id, created_by, updated_by, kind, title, subtitle, preview_json, order_key, payload_json, version, server_updated_at, deleted_at)` PK `(team_id, shelf_id, item_id)`
- `preferences(user_id PK, values_json, updated_at)`
- `entitlements(user_id PK, plan, status, ls_customer_id, ls_subscription_id, ls_order_id, ls_license_key, renews_at, updated_at)`
- `image_assets(id PK, user_id, shelf_id, item_id, r2_key, bytes, mime_type, created_at)`
- `image_upload_events(id, user_id, bytes, status, r2_key, created_at, resolved_asset_id)`
- `teams(id PK, name, created_by, created_at, updated_at)`
- `team_members(team_id, user_id, role, joined_at)` PK `(team_id, user_id)`
- `team_invitations(id, team_id, email, invited_by, role, token_hash UNIQUE, status, expires_at, created_at, responded_at)`
- `processed_webhook_events(source, event_id, processed_at)` PK `(source, event_id)`
- `sync_events(id, user_id, device_id, type, message, created_at)`

Indexes: email lookups, session token_hash, expires_at cleanup, user+shelf_id, team+shelf, invitation token/email+status.

## REST API

All authenticated routes: `Authorization: Bearer <sessionToken>`.

### Auth
| Method | Path | Body / notes |
|--------|------|----------------|
| POST | `/auth/otp` | `{ email }` → send OTP |
| POST | `/auth/verify` | `{ email, code }` → `{ sessionToken, email, daysRemaining }` |
| GET | `/auth/me` | → `{ userId, email, daysRemaining }` |
| POST | `/auth/refresh` | rotate/extend session |
| POST | `/auth/signout` | revoke |

### Sync / personal
| Method | Path | Notes |
|--------|------|-------|
| GET | `/sync/overview` | plan, deviceCount/limit, shelfCount/limit, storageBytes/limit |
| GET | `/sync/shelves?since=` | list shelves (+ tombstones); `since` server ms cursor |
| POST | `/sync/devices` | `{ deviceId, name, platform }` |
| POST | `/sync/shelves` | upsert whole shelf (backfill); items JSON sanitized |
| DELETE | `/sync/shelves/:shelfId` | tombstone (explicit only) |
| PUT | `/sync/preferences` | Pro only |
| POST | `/sync/shelves/:shelfId/items` | upsert one item |
| DELETE | `/sync/shelves/:shelfId/items/:itemId` | soft-delete item |
| GET | `/sync/shelves/:shelfId/items` | item list |

### Assets (R2)
| Method | Path | Notes |
|--------|------|-------|
| POST | `/assets/sign` | `{ shelfId, itemId, bytes, mimeType }` → `{ uploadUrl, r2Key }` (PUT presigned or multipart via Worker) |
| POST | `/assets/complete` | `{ r2Key, shelfId, itemId, bytes, mimeType }` |
| POST | `/assets/abandon` | `{ r2Key }` |
| GET | `/assets/:key` | authenticated download |

For simplicity, first wave: `POST /assets` streams body to R2 in the Worker (no presigned) with 25MB cap, then records the asset.

### Billing
| Method | Path | Notes |
|--------|------|-------|
| GET | `/billing/entitlement` | plan + status |
| POST | `/billing/refresh` | `{ licenseKey?, orderId? }` vs Lemon Squeezy |
| POST | `/webhooks/lemon` | HMAC signature, dedupe `processed_webhook_events` |

### Teams
| Method | Path | Notes |
|--------|------|-------|
| GET | `/teams` | my teams |
| POST | `/teams` | `{ name }` |
| GET | `/teams/:teamId` | detail + members |
| PATCH | `/teams/:teamId` | rename |
| DELETE | `/teams/:teamId` | delete team + members + invites + team shelf_items |
| POST | `/teams/:teamId/members/:userId` | change role |
| DELETE | `/teams/:teamId/members/:userId` | remove member |
| POST | `/teams/:teamId/invites` | `{ email, role }` |
| GET | `/invites/pending` | for session email; **no raw token** in list (id + team + role + email only) |
| POST | `/invites/:inviteId/accept` | email must match |
| POST | `/invites/:inviteId/reject` | |
| DELETE | `/teams/:teamId/invites/:inviteId` | revoke (admin) |
| GET | `/teams/:teamId/shelf/items` | shared shelf |
| POST | `/teams/:teamId/shelf/items` | upsert |
| DELETE | `/teams/:teamId/shelf/items/:itemId` | |

### Cron (wrangler `crons = ["*/15 * * * *"]`)
- Expire sessions, consume/cleanup OTPs, old webhook events, abandoned uploads, orphan R2 objects.

## Client rewrite

Replace:

- `convex/react` `ConvexProvider` → `LedgerApiProvider` (base URL + session from main)
- `SyncProvider` → slim: session adopt, overview, shelves pull with `since`, debounced push, **no delete-on-evict**
- `TeamsProvider` / `TeamShelfSyncProvider` → fetch + interval/focus refresh

Keep: Keychain session IPC, local `StateStore`, shelf/clipboard/native untouched.

Feature: if `VITE_LEDGE_API_URL` is unset, cloud UI shows "not configured" (same as today).

## Package layout

```
cloudflare/
  package.json          # private, wrangler, hono, typescript
  wrangler.jsonc
  migrations/0001_init.sql
  src/
    index.ts            # Hono app
    env.ts
    auth.ts
    middleware.ts       # bearer auth
    db.ts               # D1 helpers
    sync.ts
    assets.ts
    billing.ts
    teams.ts
    emails.ts
    cron.ts
  test/
    *.test.ts           # vitest + @cloudflare/vitest-pool-workers if available; else unit-test pure logic
```

## Out of scope for first merge

- Durable Objects live push (poll on focus + 30s interval + after mutations)
- Migrating historical Convex rows (users re-login; shelves re-push from clients)

## Landing notes

`convex/` was removed when this migration landed on `dev`. The Worker is the only backend. Historical audit docs that still mention Convex describe the pre-migration design.

## Verification

```bash
cd cloudflare && pnpm install && pnpm test && pnpm exec tsc --noEmit
# root
pnpm lint && pnpm test && pnpm build
```
