import { describe, it, expect, vi, afterEach } from 'vitest';
import { proCheckoutUrl, openProCheckout } from './proCheckout';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('proCheckoutUrl', () => {
  it('returns the default checkout URL when no email is given', () => {
    expect(proCheckoutUrl()).toBe('https://ledge.app/pro');
  });

  it('appends the email as the Lemon Squeezy checkout[email] param', () => {
    const url = new URL(proCheckoutUrl('me@example.com'));
    expect(url.searchParams.get('checkout[email]')).toBe('me@example.com');
  });

  it('honors VITE_PRO_CHECKOUT_URL override', () => {
    vi.stubEnv('VITE_PRO_CHECKOUT_URL', 'https://store.lemonsqueezy.com/checkout/buy/abc');
    const url = new URL(proCheckoutUrl('me@example.com'));
    expect(url.origin).toBe('https://store.lemonsqueezy.com');
    expect(url.pathname).toBe('/checkout/buy/abc');
    expect(url.searchParams.get('checkout[email]')).toBe('me@example.com');
  });

  it('falls back to the base URL when the configured URL is unparseable', () => {
    vi.stubEnv('VITE_PRO_CHECKOUT_URL', 'not a url');
    expect(proCheckoutUrl('me@example.com')).toBe('not a url');
  });
});

describe('openProCheckout', () => {
  it('opens the checkout URL in a new tab with the email prefilled', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open } as unknown as Window);
    openProCheckout({ email: 'me@example.com', source: 'test' });
    expect(open).toHaveBeenCalledTimes(1);
    const [url, target] = open.mock.calls[0]!;
    expect(url).toContain('checkout%5Bemail%5D=me%40example.com');
    expect(target).toBe('_blank');
  });
});
