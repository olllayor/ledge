# Cloudflare backend setup

Cloud sync is optional. The Electron app works fully offline without a Worker.
This guide covers standing up the backend (`cloudflare/`) and wiring the desktop app to it.

For the API contract and design rules, see [`cf-migration.md`](./cf-migration.md).

## Prerequisites

- A Cloudflare account (Workers Free plan is enough to start)
- Node 22+ and pnpm 10+
- `wrangler` installed via the workspace (`cloudflare/package.json` already depends on it)

```bash
corepack enable
pnpm install
```

## 1. Cloudflare resources

Create the three bindings the Worker expects. Names must match `cloudflare/wrangler.jsonc`.

| Binding | Resource | Purpose |
|---------|----------|---------|
| `DB` | D1 database `ledge-db` | users, sessions, shelves, teams, billing |
| `ASSETS` | R2 bucket `ledge-assets` | Pro image blobs |
| `EMAIL` | Email Routing / Email Service `send_email` | OTP + team invites |

```bash
cd cloudflare

# D1
pnpm exec wrangler d1 create ledge-db
# Copy the returned database_id into wrangler.jsonc → d1_databases[0].database_id

# R2
pnpm exec wrangler r2 bucket create ledge-assets
```

Email uses Cloudflare Email Service (not Resend). Onboard a sender domain, enable sending, then the `send_email` binding in `wrangler.jsonc` is enough — no API key:

```text
"send_email": [{ "name": "EMAIL" }]
```

Until the domain is ready, OTP requests fail with a clear `E_SENDER_*` error and the Worker rolls back the rate-limit slot.

### Account id

`wrangler.jsonc` pins `account_id`. Replace it with yours (or remove the field and let wrangler use the default account after `wrangler login`).

## 2. Secrets and vars

Set in `wrangler.jsonc` vars (non-secret) or via `wrangler secret` (secret):

| Name | Where | Required for |
|------|-------|--------------|
| `EMAIL_FROM` | var | From-address on OTP/invite mail |
| `RESEND_API_KEY` | secret | **Preferred** send path (Resend free tier). Without it, falls back to Cloudflare Email binding, then console log. |
| `LEMON_SQUEEZY_API_KEY` | secret | Manual `/billing/refresh` against Lemon Squeezy |
| `LEMON_SQUEEZY_WEBHOOK_SECRET` | secret | HMAC verification of `/webhooks/lemon` |
| `LEMON_SQUEEZY_PRO_VARIANT_IDS` | var/secret | Comma-separated variant ids that grant Pro (empty = fail-closed upgrades) |

### Email: Resend (recommended, free)

Cloudflare Email Sending needs dashboard domain onboarding. Resend is simpler and free (3,000 emails/month).

1. Sign up at [resend.com](https://resend.com) (free).
2. **Test mode (no domain):** create an API key, keep `EMAIL_FROM` as `Ledge <onboarding@resend.dev>`. Resend only delivers to **your account email** — enough to sign in locally.
3. **Production:** add and verify `ollayor.uz` in Resend, then set `EMAIL_FROM` to e.g. `Ledge <noreply@ollayor.uz>`.

```bash
cd cloudflare
pnpm exec wrangler secret put RESEND_API_KEY
```

Send priority in `emails.ts`: Resend (if key set) → Cloudflare `EMAIL` binding → wrangler console log.

## 3. Local development

```bash
cd cloudflare
pnpm db:migrate:local
pnpm dev
# Worker listens on http://127.0.0.1:8787
```

Then start Electron against it:

```bash
# from repo root
VITE_LEDGE_API_URL="http://127.0.0.1:8787" pnpm dev
```

Notes:

- Local wrangler uses a local D1/R2. Remote data is not visible until you migrate + deploy.
- Without the `EMAIL` binding in local mode, OTP mail is logged to the Worker console instead of sent — useful for end-to-end auth testing.
- `VITE_LEDGE_API_URL` is read at **build/dev-server start**. Restart `pnpm dev` after changing it. The origin is also injected into the renderer CSP (`electron.vite.config.ts`).

### Smoke-check the API

```bash
curl -s http://127.0.0.1:8787/health
# {"ok":true}

curl -s -X POST http://127.0.0.1:8787/auth/otp \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com"}'
```

## 4. Deploy

```bash
cd cloudflare
pnpm db:migrate:remote
pnpm deploy
# note the workers.dev (or custom) origin
```

Wire the desktop app:

```bash
VITE_LEDGE_API_URL="https://ledge-api.<your-subdomain>.workers.dev" pnpm dev
# or bake it into a release build:
VITE_LEDGE_API_URL="https://…" pnpm dist
```

### Lemon Squeezy webhook

Point the store webhook at:

```text
https://ledge-api.<your-subdomain>.workers.dev/webhooks/lemon
```

Use the same secret you stored in `LEMON_SQUEEZY_WEBHOOK_SECRET`. The Worker:

1. Verifies `X-Signature` (HMAC-SHA256 of the raw body)
2. Classifies only known subscription lifecycle events
3. Gates upgrades on the Pro variant allowlist
4. Dedupes via `processed_webhook_events` in a single D1 batch with the entitlement write

### Cron

`wrangler.jsonc` schedules `*/15 * * * *` to expire sessions/OTPs, prune old webhook rows and upload events, and delete orphan R2 objects older than 24h.

## 5. Verification

```bash
# worker
pnpm --filter ledge-cloudflare typecheck
pnpm --filter ledge-cloudflare test

# app + worker types
pnpm lint
pnpm test
```

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Preferences show "Cloud Sync is not configured" | `VITE_LEDGE_API_URL` unset (or app built without it). Restart `pnpm dev` after setting it. |
| Status Error / Send Code fails with network | Renderer → Worker is cross-origin. Worker must send CORS headers (built into `createApp`). Restart wrangler if the Worker predates that. |
| OTP returns 502 with "Email sending is not ready" | Sender domain not verified / `EMAIL_FROM` domain mismatch. |
| OTP works locally but not in prod | Local path logs to console; prod needs a real `send_email` setup. |
| "Device sync limit reached" | Free plan is 1 device, Pro is 3. |
| "Cloud shelf limit reached" | Free plan is 100 shelves, Pro is 500. |
| Webhook 401 "Invalid signature" | Secret mismatch, or the body was re-serialized before verify (must be raw). |
| Teams UI empty pending invites | Fixed client/server key drift (`invitations`); pull latest main. |
| Team code items empty after sync | Fixed `codeText` vs `text` wire mismatch; pull latest main. |
| Items still mutatable after deleting a shelf | Fixed `personalShelfExists` to ignore tombstones. |

## Security notes

- Local filesystem paths, bookmarks, and `savedFilePath` are stripped before persist. Cloud items are metadata + text/url only (plus optional R2 key).
- Session tokens live in the macOS Keychain via the main process (`SecureSessionStore`), never renderer localStorage.
- Team invites are email-bound: accept/reject require the session email to match the invitation.
- Webhook events never grant Pro without a matching Lemon variant id when the allowlist is configured.
