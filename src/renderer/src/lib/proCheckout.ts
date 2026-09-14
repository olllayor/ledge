/**
 * Single source of truth for opening the Ledge Pro checkout.
 *
 * The checkout URL is configurable via `VITE_PRO_CHECKOUT_URL` (set it to the
 * real Lemon Squeezy checkout link at build time). When unset, the URL is
 * empty and the upgrade CTA must stay disabled — a localhost fallback in a
 * production build is worse than a dead button.
 *
 * When the signed-in email is known we append it as `checkout[email]` — the
 * query param Lemon Squeezy reads to pre-fill (and lock) the buyer email.
 * That makes the purchase land on the same email the user signed in with, so
 * the webhook handler auto-applies the Pro entitlement to their account
 * (it matches by email) with no manual license-key entry.
 */

export function isProCheckoutConfigured(): boolean {
  const raw = import.meta.env.VITE_PRO_CHECKOUT_URL;
  return typeof raw === 'string' && raw.length > 0;
}

export function proCheckoutUrl(email?: string): string {
  const base = import.meta.env.VITE_PRO_CHECKOUT_URL as string | undefined;
  if (!base) {
    const message =
      'VITE_PRO_CHECKOUT_URL is not set — Pro checkout is disabled in this build.';
    console.error(`[proCheckout] ${message}`);
    throw new Error(message);
  }
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
  if (!isProCheckoutConfigured()) {
    console.error('[proCheckout] cannot open checkout: VITE_PRO_CHECKOUT_URL is unset', {
      source: options.source ?? 'unknown',
    });
    return;
  }
  if (import.meta.env.DEV) {
    console.log('[analytics] pro_upgrade_clicked', { source: options.source ?? 'unknown' });
  }
  try {
    window.open(proCheckoutUrl(options.email), '_blank', 'noopener,noreferrer');
  } catch (error) {
    console.error('[proCheckout] failed to open checkout', error);
  }
}
