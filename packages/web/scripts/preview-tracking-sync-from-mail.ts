// P2 Teil 2 — Aufgabe 5+6: Trockenlauf gegen die ECHTE Produktions-DB (reale Ziel-Bestellungen
// über loadTargetsFromDb() innerhalb syncTrackingNumbers()).
//
// WICHTIGE EINSCHRÄNKUNG, ausdrücklich benannt statt verschwiegen (Grundgesetz Regel 1):
// ein echter Gmail-API-Aufruf ist aus dieser Sandbox NICHT möglich — es fehlen
// GOOGLE_GMAIL_CLIENT_ID/GOOGLE_GMAIL_CLIENT_SECRET in .env (anders als TURSO_DATABASE_URL/
// TURSO_AUTH_TOKEN, die vorhanden sind). Echter Fehlversuch, zum Beleg:
//
//   [Gmail] Token-Refresh fehlgeschlagen: 400 {"error":"invalid_request","error_description":
//   "Could not determine client ID from request."}
//   error: Gmail nicht verbunden
//
// Dieses Skript testet deshalb NICHT den Gmail-Abruf selbst (siehe stattdessen
// scripts/inspect-package-status-emails.ts, das den echten Aufruf macht, sobald
// Gmail-Zugangsdaten verfügbar sind), sondern die END-TO-END-PIPELINE ab dem Punkt, an dem die
// Mail-Auswertung bereits vorliegt: reale Ziel-Bestellungen aus der echten DB (loadTargetsFromDb,
// keine erfundenen Daten) + die vom Nutzer selbst manuell auf der Sendungsverfolgungs-Seite
// verifizierten Werte als "matches" (KEINE erfundenen Zahlen — wörtlich aus dem Auftrag
// übernommen). dryRun:true — es wird NICHTS geschrieben.
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/preview-tracking-sync-from-mail.ts

import { syncTrackingNumbers } from '../src/api/tracking-sync';
import type { PackageStatusEmailMatch } from '../src/api/gmail';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// Vom Nutzer manuell verifizierte Werte (Auftrag P2 Teil 2, Aufgabe 5+6) — NICHT live per Gmail
// abgerufen (s. Einschränkung oben), sondern die vom Nutzer selbst gemeldeten realen Werte, um die
// Zuordnungs-/Schreib-Pipeline gegen die echte Ziel-Liste zu prüfen.
const knownRealMatches: PackageStatusEmailMatch[] = [
  { trackingNumber: '00340434886283998797', aliexpressOrderId: '3075188992327211', emailDate: '2026-08-05T00:00:00.000Z' },
];

console.log('Trockenlauf gegen die echte Produktions-DB (reale Ziel-Bestellungen), mit vom Nutzer');
console.log('manuell verifizierten Mail-Werten statt eines echten Gmail-Aufrufs (s. Datei-Kommentar).\n');

const result = await syncTrackingNumbers({ matches: knownRealMatches, dryRun: true });

const lines: string[] = [];
lines.push('# Trockenlauf: Sendungsnummer-Sync aus AliExpress-Mails (P2 Teil 2)');
lines.push('');
lines.push('**WICHTIG:** kein echter Gmail-API-Aufruf möglich in dieser Sandbox (fehlende');
lines.push('GOOGLE_GMAIL_CLIENT_ID/_SECRET in .env). Echter Fehlversuch:');
lines.push('```');
lines.push('[Gmail] Token-Refresh fehlgeschlagen: 400 {"error":"invalid_request","error_description":');
lines.push('"Could not determine client ID from request."}');
lines.push('error: Gmail nicht verbunden');
lines.push('```');
lines.push('scripts/inspect-package-status-emails.ts steht bereit für den echten Lauf, sobald');
lines.push('Gmail-Zugangsdaten verfügbar sind.');
lines.push('');
lines.push('Dieser Lauf testet stattdessen die Pipeline ab der Mail-Auswertung: reale Ziel-Bestellungen');
lines.push('aus der echten Produktions-DB + die vom Nutzer selbst manuell verifizierten Werte als');
lines.push('Mail-Ergebnis-Override. **dryRun:true — nichts geschrieben.**');
lines.push('');
lines.push(`Geprüft: ${result.checked} · gefunden: ${result.found} · würde geschrieben: ${result.found} · Fehler: ${result.errors}`);
lines.push('');
lines.push('| eBay-Bestellnr. | AliExpress-Bestellnr. | Sendungsnummer gefunden | Sendungsnummer |');
lines.push('|---|---|---|---|');
for (const r of result.rows) {
  lines.push(`| ${r.ebayOrderId} | ${r.aliexpressOrderId} | ${r.trackingFound ? 'JA' : 'nein'} | ${r.trackingNumber ?? '–'} |`);
}
lines.push('');

const check3075 = result.rows.find(r => r.aliexpressOrderId === '3075188992327211');
lines.push('## Abgleich gegen Aufgabe 6 (M. Lazarevic, 3075188992327211, zugestellt 05.08.2026)');
lines.push('');
if (check3075?.trackingNumber === '00340434886283998797') {
  lines.push('✅ Pipeline liefert exakt den erwarteten Wert `00340434886283998797`.');
} else {
  lines.push(`ABWEICHUNG — Pipeline liefert: ${JSON.stringify(check3075)}`);
}
lines.push('');
lines.push('## Hinweis zu Aufgabe 5 (Yuecel Karakoca, 3076306514497211)');
lines.push('');
lines.push('Diese Bestellung ist zum Zeitpunkt dieses Laufs **kein Ziel mehr** — `order_notes.tracking_number`');
lines.push('ist bereits auf `00340434886289512140` gesetzt (per echter, read-only DB-Abfrage bestätigt,');
lines.push('`shippedAt` 2026-09-14T14:52:39.016Z) — vermutlich manuell nachgetragen, nachdem PR #102 den');
lines.push('AP-Wert als falsch entlarvt hat. Der Wert stimmt exakt mit dem im Auftrag erwarteten überein —');
lines.push('unabhängige Bestätigung, dass `00340434886289512140` korrekt ist, nur eben nicht mehr über');
lines.push('diese Pipeline nachvollziehbar (die überschreibt eine bereits vorhandene Nummer bewusst nicht,');
lines.push('s. Doppelschreib-Schutz).');

console.log(lines.join('\n'));

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'tracking-sync-from-mail-preview.md');
writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(`\nDatei geschrieben: ${outPath}`);
console.log('dryRun:true — es wurde NICHTS geschrieben.');
