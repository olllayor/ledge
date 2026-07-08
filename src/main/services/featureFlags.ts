/**
 * Feature flags for gradual rollout.
 *
 * Set via environment variables:
 *   LEDGE_NOTCH_DROPOUT=1 pnpm dev
 *
 * When true: NotchHoverMonitor + NotchDropoutWindow are active.
 * When false: existing PeekWindow continues as-is.
 */
export const FEATURE_FLAGS = {
  useNotchDropout: process.env.LEDGE_NOTCH_DROPOUT === '1',
} as const;
