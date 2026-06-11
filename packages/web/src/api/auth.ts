// Minimal auth stub — no real auth needed for this private app
import { Hono } from 'hono';
import type { Context, Next } from 'hono';

export const authRouter = new Hono();

// No-op middleware — app is self-hosted, no auth required
export async function authMiddleware(_c: Context, next: Next) {
  await next();
}
