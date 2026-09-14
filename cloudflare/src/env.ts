export type Plan = 'free' | 'pro';

export interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  /** Cloudflare Email Service binding (`send_email`). */
  EMAIL?: {
    send(message: {
      to: string;
      from: string;
      subject: string;
      text?: string;
      html?: string;
    }): Promise<{ messageId: string }>;
  };
  EMAIL_FROM?: string;
  /** Resend API key. Preferred send path when set (free tier works). */
  RESEND_API_KEY?: string;
  LEMON_SQUEEZY_API_KEY?: string;
  LEMON_SQUEEZY_WEBHOOK_SECRET?: string;
  /** Comma-separated Lemon Squeezy variant ids that grant Pro. */
  LEMON_SQUEEZY_PRO_VARIANT_IDS?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  sessionExpiresAt: number;
}

export const FREE_SYNC_SHELF_LIMIT = 100;
export const FREE_SYNC_DEVICE_LIMIT = 1;
export const PRO_SYNC_SHELF_LIMIT = 500;
export const PRO_SYNC_DEVICE_LIMIT = 3;
export const PRO_IMAGE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Hard cap from session createdAt, even with refreshes. Matches Convex. */
export const SESSION_MAX_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const MAX_ACTIVE_OTPS_PER_EMAIL = 3;
export const MAX_OTP_FAILED_ATTEMPTS = 5;
export const MIN_SESSION_REFRESH_GAP_MS = 60 * 60 * 1000;
export const PRO_REQUIRED_FOR_PREFERENCES_MESSAGE =
  'Preferences sync is a Pro feature. Upgrade in Settings → Ledge Pro.';
export const PRO_REQUIRED_FOR_IMAGES_MESSAGE = 'Image cloud storage requires Pro.';
/** Rolling-hour cap on bytes authorized but not yet recorded. */
export const MAX_INFLIGHT_UPLOAD_BYTES_PER_HOUR = 1500 * 1024 * 1024;
export const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
export const LIST_SHELVES_LIMIT = 500;
export const LIST_ITEMS_LIMIT = 500;
