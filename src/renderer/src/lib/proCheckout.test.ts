import { describe, it, expect, vi, afterEach } from 'vitest';
import { proCheckoutUrl, openProCheckout, isProCheckoutConfigured } from './proCheckout';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('proCheckoutUrl', () => {
  it('throws when VITE_PRO_CHECKOUT_URL is unset', () => {
    expect(() => proCheckoutUrl()).toThrow(/VITE_PRO_CHECKOUT_URL/);
  });

  it('returns the configured URL when no email is given', () => {
    vi.stubEnv('VITE_PRO_CHECKOUT_URL', 'https://store.lemonsqueezy.com/checkout/buy/abc');
    expect(proCheckoutUrl()).toBe('https://store.lemonsqueezy.com/checkout/buy/abc');
  });

  it('appends the email as the Lemon Squeezy checkout[email] param', () => {
    vi.stubEnv('VITE_PRO_CHECKOUT_URL', 'https://store.lemonsqueezy.com/checkout/buy/abc');
    const url = new URL(proCheckoutUrl('me@example.com'));
    expect(url.searchParams.get('checkout[email]')).toBe('me@example.com');
  });

  it('falls back to the base URL when the configured URL is unparseable', () => {
    vi.stubEnv('VITE_PRO_CHECKOUT_URL', 'not a url');
    expect(proCheckoutUrl('me@example.com')).toBe('not a url');
  });
});

describe('isProCheckoutConfigured', () => {
  it('is false when unset', () => {
    expect(isProCheckoutConfigured()).toBe(false);
  });

  it('is true when set', () => {
    vi.stubEnv('VITE_PRO_CHECKOUT_URL', 'https://store.lemonsqueezy.com/checkout/buy/abc');
    expect(isProCheckoutConfigured()).toBe(true);
  });
});

describe('openProCheckout', () => {
  it('does not open a window when the URL is unset', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open } as unknown as Window);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    openProCheckout({ email: 'me@example.com', source: 'test' });
    expect(open).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('opens the checkout URL in a new tab with the email prefilled', () => {
    vi.stubEnv('VITE_PRO_CHECKOUT_URL', 'https://store.lemonsqueezy.com/checkout/buy/abc');
    const open = vi.fn();
    vi.stubGlobal('window', { open } as unknown as Window);
    openProCheckout({ email: 'me@example.com', source: 'test' });
    expect(open).toHaveBeenCalledTimes(1);
    const [url, target] = open.mock.calls[0]!;
    expect(url).toContain('checkout%5Bemail%5D=me%40example.com');
    expect(target).toBe('_blank');
  });
});
