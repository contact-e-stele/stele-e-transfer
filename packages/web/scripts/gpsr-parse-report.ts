// GPSR Schritt 1 — Bericht: gpsr_raw → strukturierte Felder (NUR LESEND).
//
// Liest alle Produkte, wendet parseGpsrRaw() (src/shared/gpsr-parser.ts) an und schreibt einen
// Bericht als Markdown-Tabelle: SKU, gpsr_raw im Original, die 5 erkannten Werte, "sicher
// erkannt ja/nein" und die Begründung bei allem, was nicht (vollständig) erkannt wurde.
//
// SCHREIBT NICHTS in die DB. gpsr_raw bleibt unverändert — reine Analyse, damit der Nutzer vor
// dem Schreiben sieht, was der Parser erkannt hat. Das separate Schreib-Skript (gpsr-apply.ts)
// ist hinter einem Schalter deaktiviert und wird in diesem PR nicht ausgeführt.
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/gpsr-parse-report.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { parseGpsrRaw } from '../src/shared/gpsr-parser';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const products = await db.select({
  id: schema.products.id,
  asin: schema.products.asin,
  gpsrRaw: schema.products.gpsrRaw,
  gpsrName: schema.products.gpsrName,
  gpsrAddress: schema.products.gpsrAddress,
  gpsrCity: schema.products.gpsrCity,
  gpsrEmail: schema.products.gpsrEmail,
  gpsrPhone: schema.products.gpsrPhone,
}).from(schema.products).orderBy(schema.products.id);

interface ReportRow {
  sku: string;
  id: number;
  gpsrRaw: string | null;
  parsed: ReturnType<typeof parseGpsrRaw>;
  alreadyStructured: boolean;
}

const rows: ReportRow[] = products.map(p => ({
  sku: `stele-${p.id}`,
  id: p.id,
  gpsrRaw: p.gpsrRaw,
  parsed: parseGpsrRaw(p.gpsrRaw),
  alreadyStructured: !!(p.gpsrName && p.gpsrAddress && p.gpsrEmail),
}));

// ── Kennzahlen (frisch gezählt, nicht behauptet) ─────────────────────────────────────────────
const vollstaendig = rows.filter(r => r.parsed.confidence === 'vollstaendig');
const teilweise = rows.filter(r => r.parsed.confidence === 'teilweise');
const nichtErkannt = rows.filter(r => r.parsed.confidence === 'nicht_erkannt');
const leererRohtext = rows.filter(r => !r.gpsrRaw || !r.gpsrRaw.trim());

console.log(`Produkte gesamt: ${rows.length}`);
console.log(`  gpsr_raw leer (Sonderfall, manueller Nachtrag nötig): ${leererRohtext.length} — ${leererRohtext.map(r => r.sku).join(', ') || '–'}`);
console.log(`  vollständig erkannt (alle 5 Felder): ${vollstaendig.length}`);
console.log(`  teilweise erkannt: ${teilweise.length}`);
console.log(`  gar nicht erkannt: ${nichtErkannt.length - leererRohtext.length} (zusätzlich zu den ${leererRohtext.length} mit leerem gpsr_raw)`);
console.log(`  bereits strukturiert in der DB (name+address+email gefüllt): ${rows.filter(r => r.alreadyStructured).length}`);

// ── Markdown-Bericht schreiben ────────────────────────────────────────────────────────────────
function esc(s: string | null): string {
  if (s === null) return '_nicht erkannt_';
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
function escRaw(s: string | null): string {
  if (!s) return '_(leer)_';
  return '<pre>' + s.replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>';
}

const lines: string[] = [];
lines.push('# GPSR Schritt 1 — Parse-Bericht (gpsr_raw → strukturierte Felder)');
lines.push('');
lines.push(`Erzeugt mit \`bun --env-file=<repo>/.env scripts/gpsr-parse-report.ts\` gegen die echte Produktions-DB.`);
lines.push('**Reine Analyse — es wurde NICHTS in die DB geschrieben, gpsr_raw ist unverändert.**');
lines.push('');
lines.push('## Zahlen');
lines.push('');
lines.push(`- Produkte gesamt: **${rows.length}**`);
lines.push(`- gpsr_raw leer (Sonderfall): **${leererRohtext.length}** — ${leererRohtext.map(r => r.sku).join(', ') || '–'}`);
lines.push(`- vollständig erkannt (alle 5 Felder — Name, Straße, PLZ+Stadt, E-Mail, Telefon): **${vollstaendig.length}**`);
lines.push(`- teilweise erkannt (mindestens Name oder E-Mail, aber nicht alle 5 Felder): **${teilweise.length}**`);
lines.push(`- gar nicht erkannt (inkl. der ${leererRohtext.length} mit leerem gpsr_raw): **${nichtErkannt.length}**`);
lines.push('');
lines.push('## Sonderfall: gpsr_raw komplett leer');
lines.push('');
if (leererRohtext.length > 0) {
  for (const r of leererRohtext) {
    lines.push(`- **${r.sku}** (id ${r.id}) — gpsr_raw ist leer. Kann nicht automatisch befüllt werden, muss manuell nachgetragen werden.`);
  }
} else {
  lines.push('_keine_');
}
lines.push('');
lines.push('## Vollständige Tabelle');
lines.push('');
lines.push('| SKU | gpsr_raw (Original) | Name | Straße+Nr. | PLZ+Stadt | E-Mail | Telefon | Sicher erkannt | Hinweise |');
lines.push('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const p = r.parsed;
  const sicher = p.confidence === 'vollstaendig' ? 'ja' : (p.confidence === 'teilweise' ? 'teilweise' : 'nein');
  lines.push(`| ${r.sku} | ${escRaw(r.gpsrRaw)} | ${esc(p.name)} | ${esc(p.address)} | ${esc(p.city)} | ${esc(p.email)} | ${esc(p.phone)} | ${sicher} | ${p.notes.map(esc).join('<br>') || '–'} |`);
}
lines.push('');

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'gpsr-parse-report.md');
writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(`\nBericht geschrieben: ${outPath}`);
console.log('Es wurde NICHTS in die DB geschrieben.');
