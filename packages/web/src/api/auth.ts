import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { setSignedCookie, getSignedCookie, deleteCookie } from 'hono/cookie';

// Unterstützt 2 User: AUTH_USER1_NAME/PASS und AUTH_USER2_NAME/PASS
const USERS = [
  { name: process.env.AUTH_USER1_NAME || '', pass: process.env.AUTH_USER1_PASS || '' },
  { name: process.env.AUTH_USER2_NAME || '', pass: process.env.AUTH_USER2_PASS || '' },
].filter(u => u.name && u.pass);

const SESSION_COOKIE = 'stele_session';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 Tage

if (!SESSION_SECRET) {
  console.error('[auth] SESSION_SECRET ist nicht gesetzt — Login/Session-Prüfung ist deaktiviert und alle API-Aufrufe werden mit 500 abgelehnt, bis die Variable in Render gesetzt ist.');
}

// Render setzt automatisch RENDER=true — nur dort läuft die App über HTTPS, lokal (http://localhost) nicht.
const COOKIE_OPTS = {
  httpOnly: true,
  secure: !!process.env.RENDER,
  sameSite: 'Lax' as const,
  path: '/',
  maxAge: SESSION_MAX_AGE,
};

async function readSession(c: Context): Promise<string | null> {
  if (!SESSION_SECRET) return null;
  const username = await getSignedCookie(c, SESSION_SECRET, SESSION_COOKIE);
  if (!username || typeof username !== 'string') return null;
  if (!USERS.some(u => u.name === username)) return null; // User seit Ausstellung des Cookies entfernt/geändert
  return username;
}

export const authRouter = new Hono()
  .post('/login', async (c) => {
    if (!SESSION_SECRET) {
      return c.json({ ok: false, error: 'Server-Konfigurationsfehler: SESSION_SECRET fehlt' }, 500);
    }
    try {
      const body = await c.req.json() as { username?: string; password?: string };
      const match = USERS.find(u => u.name === body.username && u.pass === body.password);
      if (!match) {
        return c.json({ ok: false, error: 'Falscher Benutzername oder Passwort' }, 401);
      }
      await setSignedCookie(c, SESSION_COOKIE, match.name, SESSION_SECRET, COOKIE_OPTS);
      return c.json({ ok: true, username: match.name }, 200);
    } catch {
      return c.json({ ok: false, error: 'Ungültige Anfrage' }, 400);
    }
  })
  .get('/me', async (c) => {
    const username = await readSession(c);
    return c.json(username ? { loggedIn: true, username } : { loggedIn: false });
  })
  .post('/logout', async (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

// Prüft das signierte Session-Cookie bei JEDEM API-Aufruf — kein Cookie/ungültig = 401.
export async function authMiddleware(c: Context, next: Next) {
  if (!SESSION_SECRET) {
    return c.json({ ok: false, error: 'Server-Konfigurationsfehler: SESSION_SECRET fehlt' }, 500);
  }
  const username = await readSession(c);
  if (!username) {
    return c.json({ ok: false, error: 'Nicht angemeldet' }, 401);
  }
  await next();
}
