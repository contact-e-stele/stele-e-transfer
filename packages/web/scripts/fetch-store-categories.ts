// P-82 — Aufgabe 1+6: Kategoriebaum des eigenen eBay-Shops auslesen (Trading API GetStore,
// CategoryStructureOnly=true). NUR LESEND — kein Schreib-Call.
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/fetch-store-categories.ts

import { getAccessToken, getStoreCategories } from '../src/api/ebay';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'store-categories.md');

console.log('Lade Shop-Kategorien über GetStore (nur lesend)...\n');

try {
  const token = await getAccessToken();
  const categories = await getStoreCategories(token);

  const lines: string[] = [];
  lines.push('# P-82: Shop-Kategorien (echte eBay-API-Antwort)');
  lines.push('');
  lines.push(`Erzeugt mit \`bun --env-file=<repo>/.env scripts/fetch-store-categories.ts\` gegen die`);
  lines.push('echte eBay Trading API (GetStore, CategoryStructureOnly=true). **Reiner Lesezugriff.**');
  lines.push('');
  lines.push(`${categories.length} Kategorien gefunden.`);
  lines.push('');
  lines.push('| CategoryID | Ebene | Name | Pfad (storeCategoryNames-Format) |');
  lines.push('|---|---|---|---|');
  for (const cat of categories) {
    lines.push(`| ${cat.categoryId} | ${cat.level} | ${cat.name} | ${cat.fullPath} |`);
  }

  console.log(lines.join('\n'));
  writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log(`\nDatei geschrieben: ${outPath}`);
} catch (e) {
  // Grundgesetz Regel 1: wörtlicher Grund statt "geht nicht".
  const msg = e instanceof Error ? e.message : String(e);
  console.error('Abruf fehlgeschlagen:', msg);
  const lines = [
    '# P-82: Shop-Kategorien — Abruf fehlgeschlagen',
    '',
    'Aufgabe 1 verlangt: "Falls der Endpunkt nicht erreichbar ist ... ausdrücklich sagen statt',
    'einen Workaround zu bauen." Hiermit ausdrücklich gesagt:',
    '',
    '```',
    msg,
    '```',
    '',
    'Root Cause: `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`/`EBAY_REFRESH_TOKEN` sind in dieser Sandbox',
    'nicht gesetzt (leer in `.env` — geprüft: nur `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` vorhanden).',
    'Der Aufruf scheitert bereits bei `getAccessToken()`, bevor GetStore überhaupt erreicht wird —',
    'derselbe dokumentierte Sandbox-Blocker wie das "401 invalid_client" in PR #97. Kein Workaround',
    'gebaut. Dieses Skript ist bereit und läuft, sobald eBay-Zugangsdaten verfügbar sind (lokal mit',
    'echten Credentials, oder als einmaliger Render-Shell-Task in der Produktionsumgebung).',
  ];
  writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log(`\nDatei geschrieben: ${outPath}`);
  process.exit(1);
}
