import { Hono } from 'hono';
import { authRoutes } from './auth';
import { billingRoutes } from './billing';
import type { AppEnv } from './middleware';
import type { Env } from './env';
import { syncRoutes } from './sync';
import { assetsRoutes } from './assets';
import { teamsRoutes } from './teams';
import { runScheduledCleanup } from './cron';

/**
 * Compose the Worker app from feature route modules.
 */
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Desktop renderer fetches are cross-origin (dev: localhost:5173 →
  // 127.0.0.1:8787; packaged: file:// / custom protocol → workers.dev).
  // Auth is Bearer tokens, not cookies, so reflecting Origin is safe.
  // Must handle OPTIONS before any route middleware can 401 a preflight.
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      c.header(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, X-Shelf-Id, X-Item-Id',
      );
      c.header('Access-Control-Max-Age', '86400');
    }
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));

  app.route('/auth', authRoutes);
  app.route('/', syncRoutes);
  app.route('/', assetsRoutes);
  // billingRoutes owns /billing/* and /webhooks/lemon
  app.route('/', billingRoutes);
  // teamsRoutes owns /teams/* and /invites/*
  app.route('/', teamsRoutes);

  return app;
}

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return Promise.resolve(app.fetch(request, env, ctx));
  },
  scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(runScheduledCleanup(env));
  },
};
