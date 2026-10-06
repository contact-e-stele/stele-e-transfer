// A-045: startet product-data-route.child.test.ts in einem EIGENEN bun-Prozess mit kontrollierter Umgebung (Muster A-030).
import { describe, expect, test } from 'bun:test';
import { resolve } from 'path';

describe('Produktdaten Beschreibung v2 (A-045) im eigenen Prozess', () => {
  test('product-data-route.child.test.ts: alle Tests grün (Migration additiv, PATCH 400/200)', () => {
    const pkgDir = resolve(import.meta.dir, '..', '..');
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
    for (const k of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'SESSION_SECRET', 'AUTH_USER1_NAME', 'AUTH_USER1_PASS', 'AUTH_USER2_NAME', 'AUTH_USER2_PASS', 'EBAY_REFRESH_TOKEN']) env[k] = '';
    env.A045_CHILD = '1';
    const r = Bun.spawnSync([process.execPath, 'test', 'src/api/product-data-route.child.test.ts'], { cwd: pkgDir, env, stdout: 'pipe', stderr: 'pipe' });
    const out = r.stdout.toString() + r.stderr.toString();
    if (r.exitCode !== 0) console.log(out.slice(-3000));
    expect(out).toMatch(/\b3 pass/);
    expect(out).toMatch(/\b0 fail/);
    expect(r.exitCode).toBe(0);
  }, 60_000);
});
