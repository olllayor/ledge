import type { Env } from './env';

interface TeamInvitePayload {
  teamName: string;
  inviterEmail: string;
}

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

interface CfEmailError {
  code?: string;
  message?: string;
}

function mapCloudflareEmailError(error: unknown): EmailDeliveryError {
  const err = error as CfEmailError;
  const code = err?.code ?? '';
  const message = err?.message ?? 'unknown error';
  switch (code) {
    case 'E_SENDER_NOT_VERIFIED':
    case 'E_SENDER_DOMAIN_NOT_AVAILABLE':
      return new EmailDeliveryError(
        'Email sending is not ready for this domain yet. Check Cloudflare Email Service setup.',
      );
    case 'E_RECIPIENT_NOT_ALLOWED':
      return new EmailDeliveryError(
        'This address is not on the allowed destination list yet.',
      );
    case 'E_RATE_LIMIT_EXCEEDED':
    case 'E_DAILY_LIMIT_EXCEEDED':
      return new EmailDeliveryError(
        'Email rate limit reached. Please try again later.',
      );
    default:
      return new EmailDeliveryError(
        `Email delivery failed: ${message}. Please try again.`,
      );
  }
}

function logDevEmail(to: string, subject: string, text: string): void {
  console.warn(`[ledge email] no send provider; logging email for ${to} (dev only)`);
  console.log(`Ledge email to ${to}: ${subject}\n${text}`);
}

/**
 * Resend HTTP API. Free tier is enough for OTP/invites once the API key
 * is set. Without a verified domain, Resend test mode only delivers to
 * the account owner's email from `onboarding@resend.dev`.
 */
async function sendViaResend(
  env: Env,
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return;

  const from = env.EMAIL_FROM ?? 'Ledge <onboarding@resend.dev>';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
    }),
  });

  if (response.ok) return;

  const bodyText = await response.text().catch(() => '');
  let message = bodyText;
  try {
    const parsed = JSON.parse(bodyText) as { message?: string };
    if (parsed.message) message = parsed.message;
  } catch {
    // keep raw body
  }

  if (response.status === 401 || response.status === 403) {
    throw new EmailDeliveryError(
      'Resend rejected the API key. Check RESEND_API_KEY.',
    );
  }
  if (response.status === 422) {
    throw new EmailDeliveryError(
      `Resend validation failed: ${message}. Verify the from domain or use test mode (onboarding@resend.dev → your Resend account email only).`,
    );
  }
  if (response.status === 429) {
    throw new EmailDeliveryError('Email rate limit reached. Please try again later.');
  }
  throw new EmailDeliveryError(
    `Email delivery failed: ${message || `HTTP ${response.status}`}. Please try again.`,
  );
}

/**
 * Cloudflare Email Service binding. Optional; used when RESEND_API_KEY is
 * not set and the binding is present.
 */
async function sendViaCloudflare(
  env: Env,
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  const binding = env.EMAIL;
  if (!binding) return;

  const from = env.EMAIL_FROM ?? 'Ledge <noreply@ollayor.uz>';
  try {
    await binding.send({
      to,
      from,
      subject,
      text,
    });
  } catch (error) {
    throw mapCloudflareEmailError(error);
  }
}

/**
 * Send order: Resend (if key set) → Cloudflare binding → console log.
 * Console fallback keeps OTP flows debuggable in local vitest / wrangler
 * without any provider configured.
 */
async function deliver(env: Env, to: string, subject: string, text: string): Promise<void> {
  if (env.RESEND_API_KEY) {
    await sendViaResend(env, to, subject, text);
    return;
  }
  if (env.EMAIL) {
    await sendViaCloudflare(env, to, subject, text);
    return;
  }
  logDevEmail(to, subject, text);
}

/** OTP sign-in code email. */
export async function sendOtpEmail(
  env: Env,
  email: string,
  code: string,
): Promise<void> {
  await deliver(
    env,
    email,
    'Your Ledge sign-in code',
    `Your Ledge sign-in code is ${code}. It expires in 10 minutes.`,
  );
}

/** Team invitation email. */
export async function sendTeamInviteEmail(
  env: Env,
  to: string,
  invite: TeamInvitePayload,
): Promise<void> {
  const text = [
    `${invite.inviterEmail} has invited you to join the team "${invite.teamName}" on Ledge.`,
    '',
    'To accept: open Ledge on your Mac, sign in with this email address',
    '(Settings → Cloud Sync), and the invitation will appear at the top',
    'of your shelf. The invitation expires in 7 days.',
    '',
    'If you were not expecting this invite, you can ignore this email.',
  ].join('\n');

  await deliver(
    env,
    to,
    `${invite.inviterEmail} invited you to "${invite.teamName}" on Ledge`,
    text,
  );
}
