import { Hono } from 'hono';
import type { Context, Next } from 'hono';

// Unterstützt 2 User: AUTH_USER1_NAME/PASS und AUTH_USER2_NAME/PASS
const USERS = [
  { name: process.env.AUTH_USER1_NAME || '', pass: process.env.AUTH_USER1_PASS || '' },
  { name: process.env.AUTH_USER2_NAME || '', pass: process.env.AUTH_USER2_PASS || '' },
].filter(u => u.name && u.pass);

export const authRouter = new Hono()
  .post('/login', async (c) => {
    try {
      const body = await c.req.json() as { username?: string; password?: string };
      const match = USERS.find(u => u.name === body.username && u.pass === body.password);
      if (match) {
        return c.json({ ok: true, username: match.name }, 200);
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
