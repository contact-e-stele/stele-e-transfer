// P-81 Stufe 1 — Aufgabe 7: Bericht über alle aktiven Produkte (ebayStatus='listed'): SKU,
// hinterlegter adRate, und ob das Angebot bei eBay AKTUELL beworben ist. Zeigt vor dem
// Scharfschalten (spätere Stufe, NICHT Teil dieses PRs), wo eine Automatik etwas ändern würde.
// NUR LESEND — kein Schreibvorgang, kein eBay-Call, der etwas ändert.
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/report-adrate-vs-live-status.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

console.log('Lade aktive Produkte aus der echten Produktions-DB (nur lesend)...\n');

const active = await db.select({
  id: schema.products.id,
  adRate: schema.products.adRate,
  ebayListingId: schema.products.ebayListingId,
  ebayStatus: schema.products.ebayStatus,
}).from(schema.products).where(eq(schema.products.ebayStatus, 'listed'));

const lines: string[] = [];
lines.push('# P-81 Stufe 1: adRate vs. Live-Werbestatus — alle aktiven Produkte');
lines.push('');
lines.push('Erzeugt mit `bun --env-file=<repo>/.env scripts/report-adrate-vs-live-status.ts` gegen die');
lines.push('echte Produktions-DB. **Reiner Lesezugriff — nichts geschrieben.**');
lines.push('');
lines.push(`${active.length} aktive Produkte (ebayStatus="listed").`);
lines.push('');
lines.push('**Einschränkung, ausdrücklich benannt:** die Spalte "aktuell beworben?" verlangt einen');
lines.push('echten Abruf über die Sell Marketing API (z.B. getAdsByInventoryReference) — aus dieser');
lines.push('Sandbox nicht möglich (kein eBay-Zugriff, s. `scripts/check-marketing-campaigns.ts`).');
lines.push('Diese Spalte bleibt deshalb leer statt erfunden (Grundgesetz Regel 4) — kein "vermutlich');
lines.push('ja/nein".');
lines.push('');
lines.push('| SKU | adRate (DB, %) | ebayListingId | aktuell beworben? (eBay live) |');
lines.push('|---|---|---|---|');
for (const p of active) {
  lines.push(`| stele-${p.id} | ${p.adRate ?? '_(NULL)_'} | ${p.ebayListingId ?? '–'} | _(nicht abrufbar — s. Einschränkung oben)_ |`);
}

const nonNullRates = active.map(p => p.adRate).filter((r): r is number => r != null);
const distinctRates = [...new Set(nonNullRates)].sort((a, b) => a - b);
lines.push('');
lines.push(`Vorkommende adRate-Werte in der DB: ${distinctRates.length > 0 ? distinctRates.join(', ') : '(keine)'}`);
lines.push(`Produkte mit adRate=0 ("keine Anzeige" laut neuer Semantik): ${active.filter(p => p.adRate === 0).length}`);
lines.push(`Produkte mit adRate=NULL (nie explizit gesetzt): ${active.filter(p => p.adRate == null).length}`);

console.log(lines.join('\n'));

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'adrate-vs-live-status.md');
writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(`\nDatei geschrieben: ${outPath}`);
console.log('Reiner Lesezugriff — nichts geschrieben, kein eBay-Call, der etwas ändert.');
