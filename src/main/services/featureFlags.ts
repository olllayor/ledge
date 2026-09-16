/**
 * Feature flags for gradual rollout.
 *
 * Set via environment variables:
 *   LEDGE_NOTCH_DROPOUT=1 pnpm dev
 *
 * When true: NotchHoverMonitor + NotchDropoutWindow are active.
 * When false: existing PeekWindow continues as-is.
 *
 * NOTE: flag is read at runtime (process.env) so the notch bundle is
 * still included when false. This is intentional for gradual rollout —
 * no extra polling or IPC runs when false (guarded in index.ts:213).
 * After rollout, delete the flag and the PeekWindow fallback to drop
 * dead code. For build-time tree-shaking, replace with
 * `import.meta.env` + vite `define`.
 */
export const FEATURE_FLAGS = {
  useNotchDropout: process.env.LEDGE_NOTCH_DROPOUT === '1',
} as const;
