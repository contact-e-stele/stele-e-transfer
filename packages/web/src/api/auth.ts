import { Hono } from 'hono';
import type { Context, Next } from 'hono';

const APP_USER = process.env.APP_USERNAME || 'admin';
const APP_PASS = process.env.APP_PASSWORD || 'stele2024';

export const authRouter = new Hono()
  .post('/login', async (c) => {
    try {
      const body = await c.req.json() as { username?: string; password?: string };
      if (body.username === APP_USER && body.password === APP_PASS) {
        return c.json({ ok: true, username: body.username }, 200);
      }
      return c.json({ ok: false, error: 'Falscher Benutzername oder Passwort' }, 401);
    } catch {
      return c.json({ ok: false, error: 'Ungültige Anfrage' }, 400);
    }
  });

// No-op middleware — app is self-hosted, login handled on frontend
export async function authMiddleware(_c: Context, next: Next) {
  await next();
}
