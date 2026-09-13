// "Sendungsnummer automatisch von AliExpress übernehmen" — Aufgabe 6: Abruf für die EINE offene
// Bestellung aus dem Auftrag (Yuecel Karakoca, eBay 20-15127-76586, AliExpress 3076306514497211),
// OHNE etwas zu schreiben. Ruft direkt getAliOrderTracking() auf — dieselbe Funktion, die
// syncTrackingNumbers() im echten (noch deaktivierten) Cron verwendet — und gibt das Ergebnis aus.
//
// SCHREIBT NICHTS — kein db.update(), kein eBay-Call. Reiner Lese-/Anzeige-Test.
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/preview-tracking-sync.ts [aliOrderId]
// Ohne Argument: 3076306514497211 (der im Auftrag genannte Fall).

import { ensureFreshAliToken, getAliAccessToken, getAliOrderTracking } from '../src/api/aliexpress-api';
import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const aliOrderId = process.argv[2] ?? '3076306514497211';

console.log(`Prüfe AliExpress-Bestellung ${aliOrderId} (dry-run, schreibt nichts)...\n`);

await ensureFreshAliToken();
const accessToken = await getAliAccessToken();
if (!accessToken) {
  console.error('Kein AliExpress-Access-Token verfügbar (P-2) — Abbruch.');
  process.exit(1);
}

// Zugehörige eBay-Bestellung aus order_notes suchen, falls vorhanden (nur zur Anzeige).
const note = await db.select().from(schema.orderNotes).where(eq(schema.orderNotes.aliexpressOrderId, aliOrderId)).get();

const info = await getAliOrderTracking(aliOrderId, accessToken);

const lines: string[] = [];
lines.push(`# Vorschau: AliExpress-Sendungsstatus für Bestellung ${aliOrderId}`);
lines.push('');
lines.push(`Erzeugt mit \`bun --env-file=<repo>/.env scripts/preview-tracking-sync.ts ${aliOrderId}\` gegen die echte AliExpress-API.`);
lines.push('**Reiner Lesezugriff — es wurde NICHTS geschrieben, kein DB-Update, kein eBay-Call.**');
lines.push('');
lines.push(`- Zugehörige eBay-Bestellung (aus order_notes, falls vorhanden): ${note?.ebayOrderId ?? '_nicht in order_notes gefunden_'}`);
lines.push(`- Bisher gespeicherte Sendungsnummer in der DB: ${note?.trackingNumber ?? '_(keine)_'}`);
lines.push('');

if (!info) {
  lines.push('## Ergebnis: Abruf fehlgeschlagen');
  lines.push('');
  lines.push('`getAliOrderTracking()` lieferte `null` — Details siehe Server-Log-Ausgabe oben (stderr/stdout dieses Laufs).');
} else {
  lines.push('## Ergebnis');
  lines.push('');
  lines.push(`| Feld | Wert |`);
  lines.push(`|---|---|`);
  lines.push(`| order_status | ${info.orderStatus} |`);
  lines.push(`| logistics_status | ${info.logisticsStatus ?? '–'} |`);
  lines.push(`| Sendungsnummer gefunden | ${info.trackingNumber ? 'JA' : 'nein'} |`);
  lines.push(`| Sendungsnummer | ${info.trackingNumber ?? '–'} |`);
  lines.push(`| Logistik-Dienst (AliExpress-intern, kein eBay-Carrier-Code) | ${info.logisticsService ?? '–'} |`);
  lines.push('');
  if (info.trackingNumber) {
    lines.push(`**Würde der Cron laufen, würde er \`${info.trackingNumber}\` in \`order_notes.tracking_number\` für eBay-Bestellung ${note?.ebayOrderId ?? '(unbekannt — keine order_notes-Zeile gefunden)'} eintragen — NUR die Sendungsnummer, kein Carrier, kein eBay-Fulfillment-Call.**`);
  } else {
    lines.push('Noch keine Sendungsnummer bei AliExpress hinterlegt — der Cron würde bei diesem Lauf nichts eintragen.');
  }
}

console.log(lines.join('\n'));

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, `tracking-sync-preview-${aliOrderId}.md`);
writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(`\nDatei geschrieben: ${outPath}`);
console.log('Es wurde NICHTS geschrieben und KEIN eBay-Call ausgelöst.');
