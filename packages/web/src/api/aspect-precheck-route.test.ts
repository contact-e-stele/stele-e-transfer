// Pflichtmerkmal-Knopf: startet aspect-precheck-route.child.test.ts in einem EIGENEN bun-Prozess mit kontrollierter Umgebung (Muster A-030, s. electric-route.test.ts).
import { describe, expect, test } from 'bun:test';
import { resolve } from 'path';

describe('Pflichtmerkmale prüfen im eigenen Prozess', () => {
  test('aspect-precheck-route.child.test.ts: alle Tests grün (nur lesen)', () => {
    const pkgDir = resolve(import.meta.dir, '..', '..');
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
    // Kontrollierte Umgebung: nichts aus der aufrufenden Shell/.env (Produktions-URL, echte Zugangsdaten) darf durchschlagen.
    for (const k of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'SESSION_SECRET', 'AUTH_USER1_NAME', 'AUTH_USER1_PASS', 'AUTH_USER2_NAME', 'AUTH_USER2_PASS', 'EBAY_REFRESH_TOKEN']) env[k] = '';
    env.A030_CHILD = '1';
    const r = Bun.spawnSync([process.execPath, 'test', 'src/api/aspect-precheck-route.child.test.ts'], { cwd: pkgDir, env, stdout: 'pipe', stderr: 'pipe' });
    const out = r.stdout.toString() + r.stderr.toString();
    for (const line of out.split('\n')) if (line.startsWith('Textauszug')) console.log(line);
    expect(out).toMatch(/\b(\d+) pass/);
    expect(out).not.toMatch(/\b[1-9]\d* fail/);
    expect(out).toMatch(/\b0 fail/);
    expect(r.exitCode).toBe(0);
  }, 60_000);
});
