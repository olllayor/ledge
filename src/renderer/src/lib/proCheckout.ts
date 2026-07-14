/**
 * Single source of truth for opening the Ledge Pro checkout.
 *
 * The checkout URL is configurable via `VITE_PRO_CHECKOUT_URL` (set it to the
 * real Lemon Squeezy checkout link at build time); it falls back to the
 * marketing page so the button is never dead.
 *
 * When the signed-in email is known we append it as `checkout[email]` — the
 * query param Lemon Squeezy reads to pre-fill (and lock) the buyer email.
 * That makes the purchase land on the same email the user signed in with, so
 * the `/lemonsqueezy/webhook` handler auto-applies the Pro entitlement to
 * their account (it matches by email) with no manual license-key entry. The
 * reactive `overview` query then flips the UI to Pro on its own.
 */
const DEFAULT_CHECKOUT_URL = 'https://ledge.app/pro';

export function proCheckoutUrl(email?: string): string {
  const base = (import.meta.env.VITE_PRO_CHECKOUT_URL as string | undefined) || DEFAULT_CHECKOUT_URL;
  if (!email) {
    return base;
  }
  try {
    const url = new URL(base);
    // Lemon Squeezy's documented pre-fill param. Harmless on a plain landing
    // page, so it is safe to always include when we know the email.
    url.searchParams.set('checkout[email]', email);
    return url.toString();
  } catch {
    return base;
  }
}

export function openProCheckout(options: { email?: string; source?: string } = {}): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (import.meta.env.DEV) {
    console.log('[analytics] pro_upgrade_clicked', { source: options.source ?? 'unknown' });
  }
  window.open(proCheckoutUrl(options.email), '_blank', 'noopener,noreferrer');
}
