// Design-Sprint S2: startet pflicht-daten-route.child.test.ts in einem EIGENEN bun-Prozess mit kontrollierter Umgebung (Muster A-030/A-045).
import { describe, expect, test } from 'bun:test';
import { resolve } from 'path';

describe('Pflicht-Daten (Design-Sprint S2) im eigenen Prozess', () => {
  test('pflicht-daten-route.child.test.ts: alle Tests grün (Migration additiv, Vorschau nur lesen, PATCH 400/200)', () => {
    const pkgDir = resolve(import.meta.dir, '..', '..');
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
    for (const k of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'SESSION_SECRET', 'AUTH_USER1_NAME', 'AUTH_USER1_PASS', 'AUTH_USER2_NAME', 'AUTH_USER2_PASS', 'EBAY_REFRESH_TOKEN']) env[k] = '';
    env.S2_CHILD = '1';
    const r = Bun.spawnSync([process.execPath, 'test', 'src/api/pflicht-daten-route.child.test.ts'], { cwd: pkgDir, env, stdout: 'pipe', stderr: 'pipe' });
    const out = r.stdout.toString() + r.stderr.toString();
    if (r.exitCode !== 0) console.log(out.slice(-3000));
    expect(out).toMatch(/\b4 pass/);
    expect(out).toMatch(/\b0 fail/);
    expect(r.exitCode).toBe(0);
  }, 60_000);
});
