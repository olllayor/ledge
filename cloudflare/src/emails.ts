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

function mapEmailError(error: unknown): EmailDeliveryError {
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

/**
 * Transactional send via Cloudflare Email Service (`send_email` binding).
 * No API key. Falls back to console logging when the binding is missing
 * (local vitest / misconfigured deploy) so OTP flows stay debuggable.
 */
async function sendViaCloudflare(
  env: Env,
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  const binding = env.EMAIL;
  if (!binding) {
    console.warn(
      `[ledge email] EMAIL binding not configured; logging email for ${to} (dev only)`,
    );
    console.log(`Ledge email to ${to}: ${subject}\n${text}`);
    return;
  }

  const from = env.EMAIL_FROM ?? 'Ledge <noreply@ledge.app>';
  try {
    await binding.send({
      to,
      from,
      subject,
      text,
    });
  } catch (error) {
    throw mapEmailError(error);
  }
}

/** OTP sign-in code email. */
export async function sendOtpEmail(
  env: Env,
  email: string,
  code: string,
): Promise<void> {
  await sendViaCloudflare(
    env,
    email,
    'Your Ledge sign-in code',
    `Your Ledge sign-in code is ${code}. It expires in 10 minutes.`,
  );
}

/**
 * Team invitation email via Cloudflare Email Service.
 * Without the EMAIL binding the invite is logged (local dev) rather than failing.
 */
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

  await sendViaCloudflare(
    env,
    to,
    `${invite.inviterEmail} invited you to "${invite.teamName}" on Ledge`,
    text,
  );
}
