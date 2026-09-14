// P2 — Aufgabe 1+6: voller Trockenlauf über ALLE Bestellungen mit AliExpress-Bestellnr. ohne
// Sendungsnummer, gegen die echte Produktions-DB und die echte AliExpress-API. Ruft
// syncTrackingNumbers({ dryRun: true }) auf — exakt dieselbe Funktion, die der (jetzt scharf
// geschaltete) Cron verwendet, nur ohne db.update()/eBay-Call (dryRun=true, s. tracking-sync.ts).
//
// SCHREIBT NICHTS — kein db.update(), kein eBay-Call. Reiner Lese-/Anzeige-Test.
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/preview-tracking-sync-all.ts

import { syncTrackingNumbers } from '../src/api/tracking-sync';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

console.log('Trockenlauf über ALLE Bestellungen mit AliExpress-Nr. ohne Sendungsnummer (dry-run, schreibt nichts)...\n');

const result = await syncTrackingNumbers({ dryRun: true });

const lines: string[] = [];
lines.push('# Trockenlauf: Sendungsnummer-Sync über alle offenen Bestellungen');
lines.push('');
lines.push('Erzeugt mit `bun --env-file=<repo>/.env scripts/preview-tracking-sync-all.ts` gegen die');
lines.push('echte Produktions-DB und die echte AliExpress-API (`aliexpress.trade.ds.order.get`).');
lines.push('**Reiner Lesezugriff — dryRun:true, es wurde NICHTS geschrieben, kein DB-Update, kein eBay-Call.**');
lines.push('');
lines.push(`Geprüft: ${result.checked} · Sendungsnummer gefunden: ${result.found} · würde geschrieben: ${result.found} (0 tatsächlich, da dry-run) · Fehler: ${result.errors}`);
lines.push('');
lines.push('| eBay-Bestellnr. | AliExpress-Bestellnr. | order_status | Sendungsnummer gefunden | Sendungsnummer | würde schreiben |');
lines.push('|---|---|---|---|---|---|');
for (const r of result.rows) {
  lines.push(`| ${r.ebayOrderId} | ${r.aliexpressOrderId} | ${r.orderStatus ?? (r.error ? `Fehler: ${r.error}` : '–')} | ${r.trackingFound ? 'JA' : 'nein'} | ${r.trackingNumber ?? '–'} | ${r.trackingFound ? 'JA' : 'nein'} |`);
}
lines.push('');
if (result.checked === 0) {
  lines.push('Keine Bestellung mit AliExpress-Bestellnr. ohne Sendungsnummer gefunden.');
}

console.log(lines.join('\n'));

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'tracking-sync-preview-alle-offenen.md');
writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(`\nDatei geschrieben: ${outPath}`);
console.log('Es wurde NICHTS geschrieben und KEIN eBay-Call ausgelöst (dryRun:true).');
