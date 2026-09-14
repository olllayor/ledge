/// <reference types="vite/client" />

import type { LedgeAPI } from '@shared/ipc';

interface ImportMetaEnv {
  /** Cloudflare Worker origin. Unset = cloud features not configured. */
  readonly VITE_LEDGE_API_URL?: string;
  /** Lemon Squeezy checkout link. Unset = Pro upgrade CTA disabled. */
  readonly VITE_PRO_CHECKOUT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    ledge: LedgeAPI;
  }
}

export {};
