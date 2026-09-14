import { describe, expect, it } from 'vitest';
import {
  buildWebhookEventId,
  classifySubscriptionEvent,
  constantTimeEqual,
  extractVariantId,
  hmacSha256,
  passesVariantGate,
  proVariantIds,
} from '../src/billing';

describe('proVariantIds', () => {
  it('splits, trims, and drops empties', () => {
    expect(proVariantIds(' 111 , 222 ,,333 ')).toEqual(['111', '222', '333']);
  });

  it('returns empty for undefined or blank', () => {
    expect(proVariantIds(undefined)).toEqual([]);
    expect(proVariantIds('')).toEqual([]);
    expect(proVariantIds(' , , ')).toEqual([]);
  });
});

describe('passesVariantGate', () => {
  it('fails closed for upgrades when allowlist is empty', () => {
    expect(passesVariantGate('111', [], 'upgrade')).toBe(false);
  });

  it('allows downgrades when allowlist is empty', () => {
    expect(passesVariantGate(undefined, [], 'downgrade')).toBe(true);
  });

  it('requires a matching allowlisted variant for upgrades', () => {
    expect(passesVariantGate('111', ['111', '222'], 'upgrade')).toBe(true);
    expect(passesVariantGate('999', ['111', '222'], 'upgrade')).toBe(false);
    expect(passesVariantGate(undefined, ['111'], 'upgrade')).toBe(false);
  });
});

describe('extractVariantId', () => {
  it('reads variant_id, first_order_item, then first_subscription_item', () => {
    expect(extractVariantId({ data: { attributes: { variant_id: 111 } } })).toBe('111');
    expect(
      extractVariantId({ data: { attributes: { first_order_item: { variant_id: 222 } } } }),
    ).toBe('222');
    expect(
      extractVariantId({ data: { attributes: { first_subscription_item: { variant_id: 333 } } } }),
    ).toBe('333');
  });

  it('returns undefined when absent', () => {
    expect(extractVariantId({})).toBeUndefined();
    expect(extractVariantId({ data: { attributes: {} } })).toBeUndefined();
  });
});

describe('classifySubscriptionEvent', () => {
  it('grants on known pro-granting events', () => {
    for (const name of [
      'subscription_created',
      'subscription_payment_success',
      'subscription_payment_recovered',
    ]) {
      expect(classifySubscriptionEvent(name, 'active')).toEqual({
        isActive: true,
        isCancelled: false,
      });
    }
  });

  it('maps subscription_payment_failed to cancelled', () => {
    expect(classifySubscriptionEvent('subscription_payment_failed', 'failed')).toEqual({
      isActive: false,
      isCancelled: true,
    });
  });

  it('maps cancelled and expired to cancelled', () => {
    expect(classifySubscriptionEvent('subscription_cancelled', 'cancelled')).toEqual({
      isActive: false,
      isCancelled: true,
    });
    expect(classifySubscriptionEvent('subscription_expired', 'expired')).toEqual({
      isActive: false,
      isCancelled: true,
    });
  });

  it('ignores unknown events instead of downgrading', () => {
    expect(classifySubscriptionEvent('order_refunded', 'refunded')).toEqual({
      ignore: 'order_refunded',
    });
    expect(classifySubscriptionEvent('license_key_created', 'active')).toEqual({
      ignore: 'license_key_created',
    });
  });

  it('ignores transient subscription_updated statuses', () => {
    expect(classifySubscriptionEvent('subscription_updated', 'past_due')).toEqual({
      ignore: 'subscription_updated:past_due',
    });
    expect(classifySubscriptionEvent('subscription_updated', 'paused')).toEqual({
      ignore: 'subscription_updated:paused',
    });
  });

  it('handles terminal subscription_updated statuses', () => {
    expect(classifySubscriptionEvent('subscription_updated', 'cancelled')).toEqual({
      isActive: false,
      isCancelled: true,
    });
    expect(classifySubscriptionEvent('subscription_updated', 'expired')).toEqual({
      isActive: false,
      isCancelled: true,
    });
    expect(classifySubscriptionEvent('subscription_updated', 'active')).toEqual({
      isActive: true,
      isCancelled: false,
    });
  });
});

describe('hmacSha256 / constantTimeEqual', () => {
  it('produces a stable hex digest matching Web Crypto HMAC-SHA256', async () => {
    // RFC 4231 test case 2 (key "Jefe", data "what do ya want for nothing?")
    const digest = await hmacSha256('Jefe', 'what do ya want for nothing?');
    expect(digest).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  it('compares equal digests and rejects mismatches', async () => {
    const a = await hmacSha256('secret', 'payload');
    const b = await hmacSha256('secret', 'payload');
    const c = await hmacSha256('secret', 'other');
    expect(constantTimeEqual(a, b)).toBe(true);
    expect(constantTimeEqual(a, c)).toBe(false);
    expect(constantTimeEqual(a, a.slice(0, -1))).toBe(false);
  });
});

describe('buildWebhookEventId', () => {
  it('keys by subscription id + event + parsed created_at', () => {
    const id = buildWebhookEventId(
      'sub-1',
      'subscription_created',
      '2027-01-01T00:00:00.000Z',
      'a@b.com',
    );
    const expectedMs = String(Date.parse('2027-01-01T00:00:00.000Z'));
    expect(id).toBe(`ls:sub-1:subscription_created:${expectedMs}`);
  });

  it('falls back to email when subscription id is empty', () => {
    const id = buildWebhookEventId('', 'subscription_created', 'not-a-date', 'a@b.com');
    expect(id).toBe('ls:a@b.com:subscription_created:not-a-date');
  });

  it('keeps distinct created_at keys distinct (cancel-then-resubscribe)', () => {
    const first = buildWebhookEventId('sub-1', 'subscription_created', '2027-01-01T00:00:00Z', 'a@b.com');
    const second = buildWebhookEventId('sub-1', 'subscription_created', '2027-06-01T00:00:00Z', 'a@b.com');
    expect(first).not.toBe(second);
  });
});
