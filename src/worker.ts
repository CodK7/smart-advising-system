import { app, type Env } from '../server.js';

/**
 * Cloudflare Workers fetch handler.
 *
 * The Worker fetches the Hono app. Hono automatically reads the Worker's
 * environment bindings (Hyperdrive, secrets, etc.) via `c.env` and routes
 * API requests to the application logic in `server.ts`.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const { scheduled } = await import('../server.js');
    return scheduled(event, env, ctx);
  },
} satisfies ExportedHandler<Env>;
