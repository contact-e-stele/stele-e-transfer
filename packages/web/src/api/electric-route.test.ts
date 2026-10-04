// A-030 (Test-Isolation zu A-029): Die Elektro-Route-Tests (electric-route.child.test.ts) brauchen eine eigene lokale Datei-DB und eigene Test-Zugangsdaten.
// Auth-Modul und db-Client lesen die Umgebung einmal pro Prozess; im Gesamtlauf (oder vom Repo-Root mit geladener .env samt Produktions-URL) kollidierte das
// mit target-margin-route.test.ts bzw. dem Produktions-Schutz ("nie gegen Turso"). Lösung: die Datei läuft hier in einem EIGENEN bun-Prozess mit kontrollierter
// Umgebung — unabhängig von Reihenfolge und .env. Die Ausgabe des Kindprozesses (inkl. Textauszüge der Fehlermeldungen) wird mit ausgegeben.
import { describe, expect, test } from 'bun:test';
import { resolve } from 'path';

describe('Elektro-Routen (A-029) im eigenen Prozess', () => {
  test('electric-route.child.test.ts: alle Tests grün (Migration, Einstellungen, Elektro-Sperre, Live-Schutz, 0 Netzwerkaufrufe)', () => {
    const pkgDir = resolve(import.meta.dir, '..', '..');
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
    // Kontrollierte Umgebung: nichts aus der aufrufenden Shell/.env (Produktions-URL, echte Zugangsdaten) darf durchschlagen.
    for (const k of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'SESSION_SECRET', 'AUTH_USER1_NAME', 'AUTH_USER1_PASS', 'AUTH_USER2_NAME', 'AUTH_USER2_PASS', 'EBAY_REFRESH_TOKEN']) env[k] = '';
    env.A030_CHILD = '1';
    const r = Bun.spawnSync([process.execPath, 'test', 'src/api/electric-route.child.test.ts'], { cwd: pkgDir, env, stdout: 'pipe', stderr: 'pipe' });
    const out = r.stdout.toString() + r.stderr.toString();
    for (const line of out.split('\n')) if (line.startsWith('Textauszug')) console.log(line);
    expect(out).toMatch(/\b(\d+) pass/);
    expect(out).not.toMatch(/\b[1-9]\d* fail/);
    expect(out).toMatch(/\b0 fail/);
    expect(r.exitCode).toBe(0);
  }, 60_000);
});
