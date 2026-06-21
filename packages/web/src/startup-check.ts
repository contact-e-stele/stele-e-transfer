// ─── Startup Health Check ────────────────────────────────────────────────────
// Läuft einmal beim App-Start und prüft alle kritischen Features.
// Ergebnis erscheint in den Render-Logs.

import { db } from './db/index';
import { sql } from 'drizzle-orm';

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

async function checkDB(): Promise<CheckResult> {
  try {
    // DB erreichbar?
    await db.run(sql`SELECT 1`);
    // Auto-Migration: ad_rate Spalte
    try {
      await db.run(sql`ALTER TABLE products ADD COLUMN ad_rate REAL DEFAULT 5`);
      console.log('[Migration] ad_rate Spalte hinzugefügt');
    } catch { /* existiert bereits */ }
    // specs Spalte vorhanden?
    const cols = await db.run(sql`PRAGMA table_info(products)`);
    const rows = (cols as { rows?: Array<[number, string, string]> }).rows ?? [];
    const hasSpecs = rows.some((r) => r[1] === 'specs');
    return { name: 'DB', ok: true, detail: hasSpecs ? 'specs ✓' : 'specs FEHLT — Migration nötig!' };
  } catch (e) {
    return { name: 'DB', ok: false, detail: String(e).slice(0, 80) };
  }
}

function checkEnv(key: string, label: string): CheckResult {
  const val = process.env[key];
  return {
    name: label,
    ok: !!val && val.length > 5,
    detail: val ? `${val.slice(0, 6)}…` : 'FEHLT',
  };
}

export async function runStartupCheck(): Promise<void> {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║     STELE APP — STARTUP CHECK        ║');
  console.log('╚══════════════════════════════════════╝');

  const checks: CheckResult[] = [
    await checkDB(),
    checkEnv('TURSO_DATABASE_URL',        'Turso URL'),
    checkEnv('TURSO_AUTH_TOKEN',          'Turso Token'),
    checkEnv('EBAY_APP_ID',               'eBay App ID'),
    checkEnv('EBAY_CLIENT_SECRET',        'eBay Secret'),
    checkEnv('SCRAPINGANT_API_KEY',       'ScrapingAnt'),
    checkEnv('SCRAPERAPI_KEY',            'ScraperAPI'),
    checkEnv('ZENROWS_API_KEY',           'ZenRows'),
    checkEnv('RESEND_API_KEY',            'Resend'),
  ];

  let allOk = true;
  for (const c of checks) {
    const icon = c.ok ? '✅' : '❌';
    const line = `${icon}  ${c.name.padEnd(18)} ${c.detail ?? ''}`;
    console.log(line);
    if (!c.ok) allOk = false;
  }

  if (allOk) {
    console.log('\n🟢  Alle Checks OK — App bereit\n');
  } else {
    console.log('\n🔴  Einige Checks FEHLGESCHLAGEN — bitte Render Env-Vars prüfen!\n');
  }
}
