// A-038: startet ali-tracking-route.child.test.ts in einem EIGENEN bun-Prozess mit kontrollierter Umgebung (Muster A-030: Auth-Modul und db-Client lesen
// die Umgebung einmal pro Prozess; im Gesamtlauf bzw. mit geladener .env samt Produktions-URL würden sie kollidieren).
import { describe, expect, test } from 'bun:test';
import { resolve } from 'path';

describe('PATCH /order-notes AliExpress-Bestellnummer-Sperre (A-038) im eigenen Prozess', () => {
  test('ali-tracking-route.child.test.ts: alle Tests grün', () => {
    const pkgDir = resolve(import.meta.dir, '..', '..');
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
    for (const k of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'SESSION_SECRET', 'AUTH_USER1_NAME', 'AUTH_USER1_PASS', 'AUTH_USER2_NAME', 'AUTH_USER2_PASS', 'EBAY_REFRESH_TOKEN']) env[k] = '';
    env.A038_CHILD = '1';
    const r = Bun.spawnSync([process.execPath, 'test', 'src/api/ali-tracking-route.child.test.ts'], { cwd: pkgDir, env, stdout: 'pipe', stderr: 'pipe' });
    const out = r.stdout.toString() + r.stderr.toString();
    if (r.exitCode !== 0) console.log(out.slice(-3000));
    expect(out).toMatch(/\b(\d+) pass/);
    expect(out).toMatch(/\b0 fail/);
    expect(r.exitCode).toBe(0);
  }, 60_000);
});
