/**
 * Billing: entitlement read, Lemon Squeezy refresh, and signed webhooks.
 *
 * Mirrors Convex `billing.ts` + `http.ts`. Self-contained: only depends on
 * `env.ts` types so concurrent middleware/db refactors cannot break it.
 *
 * Fail-closed rules that must not regress:
 * - license/order activation requires a matching purchaser email
 * - Pro upgrades require a configured variant allowlist
 * - unknown webhook events never touch entitlements
 * - `subscription_payment_failed` maps to cancelled (free)
 * - webhook claim + apply run in one D1 batch so a failure after claim
 *   does not consume the event
 */
import { Hono } from 'hono';
import type { Env, AuthUser } from './env';

export type EntitlementPlan = 'free' | 'pro';
export type EntitlementStatus = 'active' | 'inactive' | 'pastDue' | 'cancelled';

type BillingEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};

/** Events that grant Pro. Everything else is acknowledged and ignored. */
const PRO_GRANTING_EVENTS = new Set([
  'subscription_created',
  'subscription_payment_success',
  'subscription_payment_recovered',
]);

/** Events that may revoke Pro. */
const PRO_REVOKING_EVENTS = new Set([
  'subscription_updated',
  'subscription_cancelled',
  'subscription_expired',
  'subscription_payment_failed',
]);

const WEBHOOK_SOURCE = 'lemon';
const MAX_WEBHOOK_BYTES = 256 * 1024;

/** Status codes this module returns via `c.json`. */
type ErrorStatus = 400 | 401 | 413 | 500 | 502;

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: ErrorStatus,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function nowMs(): number {
  return Date.now();
}

function newId(): string {
  return crypto.randomUUID();
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export function proVariantIds(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * Variant gate. Empty allowlist fails closed for upgrades but still
 * processes downgrades so lapsed subscriptions do not keep Pro forever.
 */
export function passesVariantGate(
  variantId: string | undefined,
  allowedVariants: string[],
  mode: 'upgrade' | 'downgrade',
): boolean {
  if (allowedVariants.length === 0) {
    return mode === 'downgrade';
  }
  return variantId !== undefined && allowedVariants.includes(variantId);
}

export function extractVariantId(payload: {
  data?: { attributes?: Record<string, unknown> };
}): string | undefined {
  const attrs = payload.data?.attributes ?? {};
  const candidates = [
    attrs.variant_id,
    (attrs.first_order_item as Record<string, unknown> | undefined)?.variant_id,
    (attrs.first_subscription_item as Record<string, unknown> | undefined)?.variant_id,
  ];
  for (const candidate of candidates) {
    if (candidate != null) {
      return String(candidate);
    }
  }
  return undefined;
}

export type WebhookClassification =
  | { ignore: string }
  | { isActive: boolean; isCancelled: boolean };

/**
 * Map a Lemon Squeezy subscription event to plan/status flags.
 * Only known lifecycle events touch entitlements;
 * transient `subscription_updated` statuses (past_due, paused, …) are ignored.
 */
export function classifySubscriptionEvent(
  eventName: string,
  status: string,
): WebhookClassification {
  if (PRO_GRANTING_EVENTS.has(eventName)) {
    return { isActive: true, isCancelled: false };
  }
  if (!PRO_REVOKING_EVENTS.has(eventName)) {
    return { ignore: eventName };
  }

  switch (eventName) {
    case 'subscription_cancelled':
    case 'subscription_expired':
    case 'subscription_payment_failed':
      return { isActive: false, isCancelled: true };
    case 'subscription_updated':
      if (status === 'cancelled' || status === 'expired') {
        return { isActive: false, isCancelled: true };
      }
      if (status === 'active') {
        return { isActive: true, isCancelled: false };
      }
      return { ignore: `subscription_updated:${status}` };
    default:
      return { ignore: eventName };
  }
}

/** HMAC-SHA256 hex digest via Web Crypto. Matches Convex http.ts. */
export async function hmacSha256(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

export function buildWebhookEventId(
  subscriptionId: string,
  eventName: string,
  createdAtRaw: string,
  email: string,
): string {
  // Dedupe on subscription id + event name + created_at so a
  // cancel-then-resubscribe cycle is not collapsed into one key, while
  // Lemon retries of the same delivery share an identical key.
  const createdAtMs = Date.parse(createdAtRaw);
  const createdAtKey = Number.isFinite(createdAtMs) ? String(createdAtMs) : createdAtRaw;
  return subscriptionId
    ? `ls:${subscriptionId}:${eventName}:${createdAtKey}`
    : `ls:${email}:${eventName}:${createdAtKey}`;
}

function isUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(message);
}

function asOptionalBodyString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError('licenseKey and orderId must be strings when provided.', 400);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ---------------------------------------------------------------------------
// Auth (local; mirrors middleware.requireAuth without importing it)
// ---------------------------------------------------------------------------

async function loadSessionUser(env: Env, token: string): Promise<AuthUser | null> {
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.user_id, u.email, s.expires_at
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?1
        AND s.revoked_at IS NULL
        AND s.expires_at > ?2
      LIMIT 1`,
  )
    .bind(tokenHash, nowMs())
    .first<{ user_id: string; email: string; expires_at: number }>();

  if (!row) return null;
  return { id: row.user_id, email: row.email, sessionExpiresAt: row.expires_at };
}

/** Bearer session auth. Sets `user` or returns 401. */
async function requireBillingAuth(
  c: import('hono').Context<BillingEnv>,
): Promise<AuthUser | Response> {
  const header = c.req.header('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token) {
    return c.json({ error: 'Authentication required.' }, 401);
  }
  const authUser = await loadSessionUser(c.env, token);
  if (!authUser) {
    return c.json({ error: 'Authentication required.' }, 401);
  }
  return authUser;
}

// ---------------------------------------------------------------------------
// Lemon Squeezy API
// ---------------------------------------------------------------------------

export interface LemonEntitlementResult {
  active: boolean;
  customerId?: string;
  subscriptionId?: string;
  renewsAt?: number;
  userEmail?: string;
}

/**
 * Validate a license key or fetch an order and decide whether it grants Pro.
 * Same gating as Convex billing.ts: active + allowlisted variant.
 */
export async function fetchLemonSqueezyEntitlement(
  apiKey: string,
  allowedVariants: string[],
  licenseKey?: string,
  orderId?: string,
): Promise<LemonEntitlementResult> {
  if (!licenseKey && !orderId) {
    throw new HttpError('Provide a Lemon Squeezy license key or order ID.', 400);
  }

  if (licenseKey) {
    const response = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ license_key: licenseKey }),
    });
    const json = (await response.json()) as {
      valid?: unknown;
      license_key?: { status?: unknown; user_email?: unknown };
      meta?: { customer_id?: unknown; subscription_id?: unknown; variant_id?: unknown };
    };

    const keyStatus = typeof json.license_key?.status === 'string' ? json.license_key.status : '';
    const variantId = json.meta?.variant_id != null ? String(json.meta.variant_id) : undefined;
    const active =
      Boolean(json.valid) &&
      keyStatus === 'active' &&
      allowedVariants.length > 0 &&
      variantId !== undefined &&
      allowedVariants.includes(variantId);

    return {
      active,
      customerId: json.meta?.customer_id != null ? String(json.meta.customer_id) : undefined,
      subscriptionId:
        json.meta?.subscription_id != null ? String(json.meta.subscription_id) : undefined,
      userEmail:
        json.license_key?.user_email != null ? String(json.license_key.user_email) : undefined,
    };
  }

  // Order ids are interpolated into the API path — digits only.
  if (!/^\d+$/.test(orderId ?? '')) {
    throw new HttpError('Provide a valid Lemon Squeezy order ID.', 400);
  }

  const response = await fetch(`https://api.lemonsqueezy.com/v1/orders/${orderId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/vnd.api+json',
    },
  });
  if (!response.ok) {
    throw new HttpError('Lemon Squeezy order lookup failed.', 502);
  }
  const json = (await response.json()) as {
    data?: {
      attributes?: {
        status?: unknown;
        customer_id?: unknown;
        user_email?: unknown;
        first_order_item?: { variant_id?: unknown };
      };
    };
  };

  const attrs = json.data?.attributes ?? {};
  const status = typeof attrs.status === 'string' ? attrs.status : '';
  const variantId =
    attrs.first_order_item?.variant_id != null
      ? String(attrs.first_order_item.variant_id)
      : undefined;

  if (allowedVariants.length === 0) {
    throw new HttpError(
      'Order-based activation is not configured. Set LEMON_SQUEEZY_PRO_VARIANT_IDS or activate with a license key.',
      400,
    );
  }

  const active = status === 'paid' && variantId !== undefined && allowedVariants.includes(variantId);

  return {
    active,
    customerId: attrs.customer_id != null ? String(attrs.customer_id) : undefined,
    userEmail: attrs.user_email != null ? String(attrs.user_email) : undefined,
  };
}

// ---------------------------------------------------------------------------
// D1 entitlement helpers
// ---------------------------------------------------------------------------

interface EntitlementPatch {
  userId: string;
  plan: EntitlementPlan;
  status: EntitlementStatus;
  lsCustomerId?: string;
  lsSubscriptionId?: string;
  lsOrderId?: string;
  lsLicenseKey?: string;
  renewsAt?: number;
}

/**
 * Upsert the user's entitlement row, preserving stored Lemon Squeezy
 * identifiers the caller omitted (webhooks carry only a subset).
 */
export function entitlementUpsertStatement(
  db: D1Database,
  patch: EntitlementPatch,
): D1PreparedStatement {
  const now = nowMs();
  return db
    .prepare(
      `INSERT INTO entitlements (
         user_id, plan, status, ls_customer_id, ls_subscription_id,
         ls_order_id, ls_license_key, renews_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(user_id) DO UPDATE SET
         plan = excluded.plan,
         status = excluded.status,
         ls_customer_id = COALESCE(excluded.ls_customer_id, entitlements.ls_customer_id),
         ls_subscription_id = COALESCE(excluded.ls_subscription_id, entitlements.ls_subscription_id),
         ls_order_id = COALESCE(excluded.ls_order_id, entitlements.ls_order_id),
         ls_license_key = COALESCE(excluded.ls_license_key, entitlements.ls_license_key),
         renews_at = COALESCE(excluded.renews_at, entitlements.renews_at),
         updated_at = excluded.updated_at`,
    )
    .bind(
      patch.userId,
      patch.plan,
      patch.status,
      patch.lsCustomerId ?? null,
      patch.lsSubscriptionId ?? null,
      patch.lsOrderId ?? null,
      patch.lsLicenseKey ?? null,
      patch.renewsAt ?? null,
      now,
    );
}

async function readEntitlement(
  env: Env,
  userId: string,
): Promise<{
  plan: EntitlementPlan;
  status: EntitlementStatus;
  lemonSqueezyCustomerId?: string;
  lemonSqueezySubscriptionId?: string;
  lemonSqueezyOrderId?: string;
  lemonSqueezyLicenseKey?: string;
  renewsAt?: number;
  updatedAt: number;
}> {
  const row = await env.DB.prepare(
    `SELECT plan, status, ls_customer_id, ls_subscription_id, ls_order_id,
            ls_license_key, renews_at, updated_at
       FROM entitlements
      WHERE user_id = ?1
      LIMIT 1`,
  )
    .bind(userId)
    .first<{
      plan: string;
      status: string;
      ls_customer_id: string | null;
      ls_subscription_id: string | null;
      ls_order_id: string | null;
      ls_license_key: string | null;
      renews_at: number | null;
      updated_at: number;
    }>();

  if (!row) {
    return { plan: 'free', status: 'active', updatedAt: nowMs() };
  }

  return {
    plan: row.plan === 'pro' ? 'pro' : 'free',
    status:
      row.status === 'active' || row.status === 'inactive' || row.status === 'pastDue'
        ? row.status
        : 'cancelled',
    lemonSqueezyCustomerId: row.ls_customer_id ?? undefined,
    lemonSqueezySubscriptionId: row.ls_subscription_id ?? undefined,
    lemonSqueezyOrderId: row.ls_order_id ?? undefined,
    lemonSqueezyLicenseKey: row.ls_license_key ?? undefined,
    renewsAt: row.renews_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

/**
 * Claim the webhook event and apply the entitlement in ONE D1 batch.
 * Mirrors Convex `processWebhookEvent`: a throw rolls back the claim so
 * Lemon Squeezy's retry can reprocess cleanly.
 */
async function claimAndApplyWebhookEvent(
  env: Env,
  args: {
    eventId: string;
    email: string;
    plan: EntitlementPlan;
    status: EntitlementStatus;
    lsCustomerId?: string;
    lsSubscriptionId?: string;
    lsOrderId?: string;
    lsLicenseKey?: string;
    renewsAt?: number;
  },
): Promise<'applied' | 'deduped'> {
  const now = nowMs();
  const userId = newId();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO processed_webhook_events (source, event_id, processed_at)
         VALUES (?1, ?2, ?3)`,
      ).bind(WEBHOOK_SOURCE, args.eventId, now),
      env.DB.prepare(
        `INSERT INTO users (id, email, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(email) DO UPDATE SET updated_at = excluded.updated_at`,
      ).bind(userId, args.email, now),
      env.DB.prepare(
        `INSERT INTO entitlements (
           user_id, plan, status, ls_customer_id, ls_subscription_id,
           ls_order_id, ls_license_key, renews_at, updated_at
         )
         SELECT id, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
           FROM users WHERE email = ?1 LIMIT 1
         ON CONFLICT(user_id) DO UPDATE SET
           plan = excluded.plan,
           status = excluded.status,
           ls_customer_id = COALESCE(excluded.ls_customer_id, entitlements.ls_customer_id),
           ls_subscription_id = COALESCE(excluded.ls_subscription_id, entitlements.ls_subscription_id),
           ls_order_id = COALESCE(excluded.ls_order_id, entitlements.ls_order_id),
           ls_license_key = COALESCE(excluded.ls_license_key, entitlements.ls_license_key),
           renews_at = COALESCE(excluded.renews_at, entitlements.renews_at),
           updated_at = excluded.updated_at`,
      ).bind(
        args.email,
        args.plan,
        args.status,
        args.lsCustomerId ?? null,
        args.lsSubscriptionId ?? null,
        args.lsOrderId ?? null,
        args.lsLicenseKey ?? null,
        args.renewsAt ?? null,
        now,
      ),
    ]);
    return 'applied';
  } catch (err) {
    if (isUniqueViolation(err)) {
      return 'deduped';
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const billingRoutes = new Hono<BillingEnv>();

/** GET /billing/entitlement — session user's plan + status. */
billingRoutes.get('/billing/entitlement', async (c) => {
  const authUser = await requireBillingAuth(c);
  if (authUser instanceof Response) return authUser;

  const entitlement = await readEntitlement(c.env, authUser.id);
  return c.json(entitlement);
});

/** POST /billing/refresh — re-validate a license key or order against Lemon Squeezy. */
billingRoutes.post('/billing/refresh', async (c) => {
  const authUser = await requireBillingAuth(c);
  if (authUser instanceof Response) return authUser;

  const apiKey = c.env.LEMON_SQUEEZY_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'Lemon Squeezy API key is not configured.' }, 500);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Malformed JSON body.' }, 400);
  }
  if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
    return c.json({ error: 'Request body must be an object.' }, 400);
  }

  let licenseKey: string | undefined;
  let orderId: string | undefined;
  try {
    const body = rawBody as Record<string, unknown>;
    licenseKey = asOptionalBodyString(body.licenseKey);
    orderId = asOptionalBodyString(body.orderId);
  } catch (err) {
    const message = err instanceof HttpError ? err.message : 'Invalid request body.';
    return c.json({ error: message }, 400);
  }

  const allowedVariants = proVariantIds(c.env.LEMON_SQUEEZY_PRO_VARIANT_IDS);

  let result: LemonEntitlementResult;
  try {
    result = await fetchLemonSqueezyEntitlement(apiKey, allowedVariants, licenseKey, orderId);
  } catch (err) {
    if (err instanceof HttpError) {
      return c.json({ error: err.message }, err.status);
    }
    return c.json({ error: 'Lemon Squeezy lookup failed.' }, 502);
  }

  // Fail closed: without a purchaser email on both sides we cannot prove
  // ownership, so activation is refused rather than skipped.
  if (!result.userEmail || !authUser.email) {
    return c.json(
      {
        error:
          'Lemon Squeezy did not return an email for this purchase, so ownership cannot be verified.',
      },
      400,
    );
  }
  if (result.userEmail.toLowerCase() !== authUser.email.toLowerCase()) {
    return c.json(
      {
        error:
          'This license key is registered to a different account. Sign in with the matching email to use it.',
      },
      400,
    );
  }

  await entitlementUpsertStatement(c.env.DB, {
    userId: authUser.id,
    plan: result.active ? 'pro' : 'free',
    status: result.active ? 'active' : 'inactive',
    lsCustomerId: result.customerId,
    lsSubscriptionId: result.subscriptionId,
    lsOrderId: orderId,
    lsLicenseKey: licenseKey,
    renewsAt: result.renewsAt,
  }).run();

  return c.json(result);
});

/**
 * POST /webhooks/lemon — signed Lemon Squeezy webhook.
 * Verifies X-Signature HMAC, dedupes via processed_webhook_events,
 * maps subscription lifecycle to plan/status.
 */
billingRoutes.post('/webhooks/lemon', async (c) => {
  const secret = c.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: 'Webhook secret is not configured.' }, 500);
  }

  const contentLength = Number.parseInt(c.req.header('content-length') ?? '0', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return c.json({ error: 'Payload too large.' }, 413);
  }
  const raw = await c.req.text();
  if (raw.length > MAX_WEBHOOK_BYTES) {
    return c.json({ error: 'Payload too large.' }, 413);
  }

  const signature = c.req.header('x-signature') ?? '';
  const expected = await hmacSha256(secret, raw);
  if (!constantTimeEqual(signature, expected)) {
    return c.json({ error: 'Invalid signature.' }, 401);
  }

  let payload: {
    meta?: { event_name?: unknown };
    data?: { id?: unknown; attributes?: Record<string, unknown> };
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return c.json({ error: 'Malformed JSON body.' }, 400);
  }

  const eventName = String(payload.meta?.event_name ?? '');
  const attributes = payload.data?.attributes ?? {};
  const email = String(attributes.user_email ?? attributes.customer_email ?? '')
    .trim()
    .toLowerCase();
  if (!email) {
    return c.json({ ok: true, ignored: 'missing_email' });
  }

  const classification = classifySubscriptionEvent(
    eventName,
    typeof attributes.status === 'string' ? attributes.status : '',
  );
  if ('ignore' in classification) {
    return c.json({ ok: true, ignored: classification.ignore });
  }

  const variantId = extractVariantId(payload);
  const allowedVariants = proVariantIds(c.env.LEMON_SQUEEZY_PRO_VARIANT_IDS);
  const mode = classification.isActive && !classification.isCancelled ? 'upgrade' : 'downgrade';
  if (!passesVariantGate(variantId, allowedVariants, mode)) {
    return c.json({ ok: true, ignored: `${eventName}:variant_not_pro` });
  }

  const subscriptionId = payload.data?.id != null ? String(payload.data.id) : '';
  const createdAtRaw = String(attributes.created_at ?? '');
  const eventId = buildWebhookEventId(subscriptionId, eventName, createdAtRaw, email);

  const isActive = classification.isActive;
  const isCancelled = classification.isCancelled;

  let outcome: 'applied' | 'deduped';
  try {
    outcome = await claimAndApplyWebhookEvent(c.env, {
      eventId,
      email,
      plan: isActive && !isCancelled ? 'pro' : 'free',
      status: isActive && !isCancelled ? 'active' : isCancelled ? 'cancelled' : 'inactive',
      lsCustomerId: attributes.customer_id != null ? String(attributes.customer_id) : undefined,
      lsSubscriptionId: subscriptionId || undefined,
      lsOrderId: attributes.order_id != null ? String(attributes.order_id) : undefined,
      lsLicenseKey: attributes.key != null ? String(attributes.key) : undefined,
      renewsAt: attributes.renews_at
        ? Date.parse(String(attributes.renews_at)) || undefined
        : undefined,
    });
  } catch {
    // Let Lemon Squeezy retry; do not acknowledge a failed apply.
    return c.json({ error: 'Failed to process webhook event.' }, 500);
  }

  if (outcome === 'deduped') {
    return c.json({ ok: true, deduped: true });
  }
  return c.json({ ok: true });
});
