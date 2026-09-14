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
