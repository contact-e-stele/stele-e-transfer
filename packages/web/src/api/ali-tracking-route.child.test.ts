// A-038 (AH-02): Route-Test PATCH /api/order-notes/:id gegen eine LOKALE Datei-DB und die echte App. Die Sperre antwortet VOR jedem DB-Schreibzugriff
// und VOR jedem eBay-Aufruf; ein globaler fetch-Spion beweist, dass im Sperrfall kein Netzwerkaufruf passiert.
// Eigener Prozess (Muster A-030): ali-tracking-route.test.ts startet diese Datei mit A038_CHILD=1 und kontrollierter Umgebung.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const IS_CHILD = process.env.A038_CHILD === '1';
const dbFile = join(tmpdir(), 'a038-route-test.db').replaceAll('\\', '/');
if (IS_CHILD) {
  try { rmSync(dbFile, { force: true }); } catch { /* neu anlegen */ }
  process.env.TURSO_DATABASE_URL = 'file:' + dbFile;
  process.env.TURSO_AUTH_TOKEN = '';
  process.env.SESSION_SECRET = 'test-secret-a038';
  process.env.AUTH_USER1_NAME = 'a038-tester';
  process.env.AUTH_USER1_PASS = 'a038-pass';
  process.env.EBAY_REFRESH_TOKEN = 'test-refresh-token';
}

const ALI_ID = '3077135261597211';
const OTHER_ALI_ID = '3075188992327211';
const DHL = '00340434886283998797';

describe.skipIf(!IS_CHILD)('PATCH /order-notes — AliExpress-Bestellnummer nie als Sendungsnummer (eigener Prozess, lokale Datei-DB)', () => {
  let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
  let cookie = '';
  let fetchCalls = 0;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    if (!process.env.TURSO_DATABASE_URL!.startsWith('file:')) throw new Error('Dieser Test arbeitet nur gegen eine lokale Datei-DB, nie gegen Turso/Produktion');
    const { createClient } = await import('@libsql/client');
    const { getTableConfig } = await import('drizzle-orm/sqlite-core');
    const schema = await import('../db/schema');
    const cols = getTableConfig(schema.orderNotes).columns.map(c => `"${c.name}" ${c.getSQLType().toUpperCase()}${c.primary ? ' PRIMARY KEY' : ''}`);
    const client = createClient({ url: process.env.TURSO_DATABASE_URL! });
    await client.execute('DROP TABLE IF EXISTS order_notes');
    await client.execute(`CREATE TABLE order_notes (${cols.join(', ')}, UNIQUE(ebay_order_id))`.replace(/"id" INTEGER PRIMARY KEY/, '"id" INTEGER PRIMARY KEY AUTOINCREMENT'));
    await client.execute(`INSERT INTO order_notes (ebay_order_id, aliexpress_order_id) VALUES ('X-1', '${ALI_ID}'), ('X-2', '${OTHER_ALI_ID}')`);
    // Sonde (nur LESEN): zeigt der db-Singleton auf DIESE Datei?
    const { db: appDb } = await import('../db/index');
    const probe = await appDb.select({ a: schema.orderNotes.aliexpressOrderId }).from(schema.orderNotes).all().catch(() => []);
    if (probe.length !== 2) throw new Error('db-Singleton zeigt nicht auf die lokale Test-DB — Abbruch, nichts geschrieben');
    app = (await import('./index')).default as typeof app;
    const login = await app.request('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: process.env.AUTH_USER1_NAME, password: process.env.AUTH_USER1_PASS }),
    });
    expect(login.status).toBe(200);
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    globalThis.fetch = (async () => { fetchCalls++; throw new Error('Netzwerk nicht erreichbar (Test)'); }) as unknown as typeof fetch;
  });
  afterAll(() => { globalThis.fetch = realFetch; try { rmSync(dbFile, { force: true }); } catch { /* egal */ } });

  const patch = (id: string, body: unknown) => app.request(`/api/order-notes/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body),
  });
  const readNote = async (id: string) => {
    const { db } = await import('../db/index');
    const schema = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    return db.select().from(schema.orderNotes).where(eq(schema.orderNotes.ebayOrderId, id)).get();
  };

  test('eigene AliExpress-Bestellnummer als Sendungsnummer → 400 mit Klartext, nichts gespeichert, kein eBay-Aufruf', async () => {
    const before = fetchCalls;
    const res = await patch('X-1', { trackingNumber: ALI_ID, carrier: 'DHL' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('Sendungsnummer ist die AliExpress-Bestellnummer – nicht übernommen');
    expect((await readNote('X-1'))?.trackingNumber ?? null).toBeNull();
    expect(fetchCalls).toBe(before);
  });

  test('Bestellnummer einer ANDEREN Bestellung als Sendungsnummer → 400, nichts gespeichert', async () => {
    const res = await patch('X-1', { trackingNumber: OTHER_ALI_ID, carrier: 'DHL' });
    expect(res.status).toBe(400);
    expect((await readNote('X-1'))?.trackingNumber ?? null).toBeNull();
  });

  test('Nummer = in derselben Anfrage neu gesetzte aliexpressOrderId → 400', async () => {
    const res = await patch('X-2', { aliexpressOrderId: '3099999999999999', trackingNumber: '3099999999999999' });
    expect(res.status).toBe(400);
  });

  test('echte DHL-Nummer wird weiter gespeichert (eBay-Aufruf scheitert im Test → ebay.submitted=false, lokal gespeichert)', async () => {
    const res = await patch('X-1', { trackingNumber: DHL, carrier: 'DHL' });
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; ebay?: { submitted: boolean } };
    expect(data.ok).toBe(true);
    expect(data.ebay?.submitted).toBe(false);
    expect((await readNote('X-1'))?.trackingNumber).toBe(DHL);
  });
});
