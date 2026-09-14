// P2 FINALE — Aufgabe 2: letzter Trockenlauf gegen die echte Produktions-DB vor dem
// Scharfschalten. Zeigt, welche Bestellungen JETZT (Stand dieses Laufs) eine Sendungsnummer
// bekommen würden. dryRun:true — es wird NICHTS geschrieben.
//
// Reine DB-Zielliste (loadTargetsFromDb() via syncTrackingNumbers() ohne orders-Override) — die
// tatsächliche Mail-Zuordnung läuft, wo möglich, über den echten Gmail-Aufruf
// (searchRecentPackageStatusEmails()); ist das in dieser Umgebung nicht möglich (fehlende
// Gmail-Zugangsdaten), wird das hier sichtbar gemacht statt verschwiegen.
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/preview-tracking-sync-final.ts

import { syncTrackingNumbers } from '../src/api/tracking-sync';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

console.log('Letzter Trockenlauf vor dem Scharfschalten — echte Produktions-DB, dryRun:true.\n');

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });

// Reine DB-Zielliste ZUERST und UNABHÄNGIG vom Gmail-Aufruf abfragen — syncTrackingNumbers()
// fängt einen fehlschlagenden Gmail-Aufruf intern ab und liefert dann bewusst ein LEERES
// Ergebnis zurück (checked:0), obwohl echte Ziel-Bestellungen existieren können (sicheres
// Abbruchverhalten für den Cron, aber irreführend für einen Bericht, der zeigen soll, WER
// aktuell Ziel ist). Deshalb hier separat nachgefragt, um das nicht zu verschweigen.
const { db } = await import('../src/db/index');
const schema = await import('../src/db/schema');
const { and, isNotNull, or, isNull, eq } = await import('drizzle-orm');
const dbTargets = await db.select({
  ebayOrderId: schema.orderNotes.ebayOrderId,
  aliexpressOrderId: schema.orderNotes.aliexpressOrderId,
  trackingNumber: schema.orderNotes.trackingNumber,
}).from(schema.orderNotes).where(and(
  isNotNull(schema.orderNotes.aliexpressOrderId),
  or(isNull(schema.orderNotes.trackingNumber), eq(schema.orderNotes.trackingNumber, ''))
));

let gmailError: string | null = null;
let result: Awaited<ReturnType<typeof syncTrackingNumbers>>;
try {
  result = await syncTrackingNumbers({ dryRun: true });
  if (result.checked === 0 && dbTargets.length > 0) {
    // syncTrackingNumbers() ist intern auf den Gmail-Fehlerpfad gelaufen (leeres Ergebnis trotz
    // echter Ziele) — das unten geloggte "[Gmail] Token-Refresh fehlgeschlagen"/"Gmail-Suche
    // fehlgeschlagen" in der Konsolen-Ausgabe ist der eigentliche Grund.
    gmailError = 'Gmail-Aufruf in dieser Sandbox fehlgeschlagen (s. Konsolen-Ausgabe oben: "[Gmail] Token-Refresh fehlgeschlagen: 400 ... Could not determine client ID from request")';
  }
} catch (e) {
  gmailError = String(e);
}

if (gmailError) {
  console.log('\nEchte DB-Zielliste (unabhängig vom Gmail-Fehler abgefragt) — wer aktuell Ziel ist:');
  result = {
    checked: dbTargets.length, found: 0, written: 0, errors: 0,
    rows: dbTargets.map(t => ({ ebayOrderId: t.ebayOrderId, aliexpressOrderId: t.aliexpressOrderId!, trackingFound: false, trackingNumber: null, written: false, error: 'Gmail-Aufruf in dieser Umgebung nicht möglich' })),
  };
}

const lines: string[] = [];
lines.push('# P2 FINALE — letzter Trockenlauf vor dem Scharfschalten');
lines.push('');
lines.push('Erzeugt mit `bun --env-file=<repo>/.env scripts/preview-tracking-sync-final.ts` gegen die');
lines.push('echte Produktions-DB. **dryRun:true — es wurde NICHTS geschrieben, keine Mail verändert.**');
lines.push('');
if (gmailError) {
  lines.push(`**Echter Gmail-Aufruf in dieser Sandbox fehlgeschlagen:** \`${gmailError}\``);
  lines.push('');
  lines.push('Grund: fehlende `GOOGLE_GMAIL_CLIENT_ID`/`GOOGLE_GMAIL_CLIENT_SECRET` in `.env` dieser');
  lines.push('Umgebung (bereits in PR #103/#104 dokumentiert). Tabelle unten zeigt deshalb nur die');
  lines.push('reine DB-Zielliste (wer hat eine AliExpress-Nr. ohne Sendungsnummer), OHNE Mail-Abgleich.');
} else {
  lines.push(`Geprüft: ${result.checked} · Sendungsnummer gefunden: ${result.found} · würde geschrieben: ${result.found} (0 tatsächlich, dry-run) · Fehler: ${result.errors}`);
}
lines.push('');
lines.push('| eBay-Bestellnr. | AliExpress-Bestellnr. | Sendungsnummer gefunden | Sendungsnummer |');
lines.push('|---|---|---|---|');
for (const r of result.rows) {
  lines.push(`| ${r.ebayOrderId} | ${r.aliexpressOrderId} | ${r.trackingFound ? 'JA' : 'nein'} | ${r.trackingNumber ?? '–'} |`);
}
if (result.rows.length === 0) {
  lines.push('| _(keine offenen Ziel-Bestellungen)_ | | | |');
}

console.log(lines.join('\n'));

const outPath = resolve(outDir, 'tracking-sync-final-preview.md');
writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(`\nDatei geschrieben: ${outPath}`);
console.log('dryRun:true — es wurde NICHTS geschrieben, keine Mail veraendert.');
