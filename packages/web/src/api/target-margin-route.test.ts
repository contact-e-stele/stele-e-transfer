// A-016: Route-Test für PATCH /api/products/target-margin. Ohne DB: bei ungültigem Body antwortet der Endpunkt VOR jedem
// DB-Zugriff mit 400. Das beweist zugleich die Routen-Reihenfolge — stünde '/products/:id' davor, käme "Ungültige ID" statt
// der Stufen-Meldung. Die App liest SESSION_SECRET/AUTH_USER* beim Import; deshalb Umgebung setzen, DANN dynamisch importieren,
// und über den echten Login-Endpunkt ein Session-Cookie holen (Test-Zugangsdaten, nichts Echtes).
import { beforeAll, describe, expect, test } from 'bun:test';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-a016';
process.env.AUTH_USER1_NAME = process.env.AUTH_USER1_NAME || 'a016-tester';
process.env.AUTH_USER1_PASS = process.env.AUTH_USER1_PASS || 'a016-pass';

let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let cookie = '';

beforeAll(async () => {
  app = (await import('./index')).default as typeof app;
  const login = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.AUTH_USER1_NAME, password: process.env.AUTH_USER1_PASS }),
  });
  expect(login.status).toBe(200);
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  expect(cookie).toContain('stele_session=');
});

const patch = (body: unknown, withCookie = true) => app.request('/api/products/target-margin', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', ...(withCookie ? { Cookie: cookie } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('PATCH /api/products/target-margin (Sammel-Stufenwechsel)', () => {
  test('ungültige Stufe 4,50 wird mit 400 und Stufen-Meldung abgelehnt (nicht von der :id-Route abgefangen)', async () => {
    const res = await patch({ productIds: [1], targetMarginEur: 4.5, confirm: true });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('Margen-Stufe');
    expect(data.error).not.toContain('Ungültige ID');
  });

  test('ohne confirm:true wird abgelehnt', async () => {
    const res = await patch({ productIds: [1], targetMarginEur: 2 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('confirm');
  });

  test('zu viele IDs und kaputtes JSON werden abgelehnt', async () => {
    const many = Array.from({ length: 201 }, (_, i) => i + 1);
    expect((await patch({ productIds: many, targetMarginEur: 2, confirm: true })).status).toBe(400);
    expect((await patch('{kaputt')).status).toBe(400);
  });

  test('ohne Session-Cookie: 401 (der Endpunkt steht hinter der Auth-Middleware)', async () => {
    expect((await patch({ productIds: [1], targetMarginEur: 2, confirm: true }, false)).status).toBe(401);
  });
});

// A-017: POST /api/products/tier-reprice — Validierung vor jedem DB-/eBay-Zugriff und Auth.
const postReprice = (body: unknown, withCookie = true) => app.request('/api/products/tier-reprice', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(withCookie ? { Cookie: cookie } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('POST /api/products/tier-reprice (Stufenwechsel → neue Preise)', () => {
  const ok = { productIds: [1], targetMarginEur: 2, mode: 'preview' };

  test('ohne Session-Cookie: 401', async () => {
    expect((await postReprice(ok, false)).status).toBe(401);
  });

  test('ungültige Stufe 4,50, ungültiger mode, kaputtes JSON → 400', async () => {
    const a = await postReprice({ ...ok, targetMarginEur: 4.5 });
    expect(a.status).toBe(400);
    expect(((await a.json()) as { error: string }).error).toContain('Margen-Stufe');
    expect((await postReprice({ ...ok, mode: 'senden' })).status).toBe(400);
    expect((await postReprice('{kaputt')).status).toBe(400);
  });

  test('apply ohne confirm:true wird abgelehnt (400) — Preise werden nie ohne Bestätigung gespeichert/gesendet', async () => {
    const r = await postReprice({ ...ok, mode: 'apply' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain('confirm');
  });

  test('mehr als 10 Produkte je Aufruf werden abgelehnt (400)', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => i + 1);
    const r = await postReprice({ ...ok, productIds: ids });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain('10');
  });
});
