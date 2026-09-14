// P2 Teil 2 — Aufgabe 5+6: voller Trockenlauf gegen das echte Gmail-Postfach. Zeigt für jede
// gefundene "Package <Nummer>"-Mail: Betreff, geparste Zusteller-Nummer, geparste AliExpress-
// Bestellnr. (aus o_ids=), Mail-Datum. NUR LESEND — kein Gmail modify/trash-Aufruf, keine Mail
// wird als gelesen markiert (Gmail markiert beim reinen GET über die API nicht automatisch).
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/inspect-package-status-emails.ts

import { searchRecentPackageStatusEmails } from '../src/api/gmail';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

console.log('Suche Package-Status-Mails im echten Gmail-Postfach (90 Tage, nur lesend)...\n');

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });

let matches: Awaited<ReturnType<typeof searchRecentPackageStatusEmails>>;
try {
  matches = await searchRecentPackageStatusEmails(90);
} catch (e) {
  // Wörtlicher Grund statt "geht nicht" (Grundgesetz Regel 1) — z.B. fehlende
  // GOOGLE_GMAIL_CLIENT_ID/_SECRET in dieser Umgebung.
  const msg = `Gmail-Abruf fehlgeschlagen: ${String(e)}`;
  console.error(msg);
  const outPath = resolve(outDir, 'package-status-emails-preview.md');
  writeFileSync(outPath, `# Trockenlauf: Package-Status-Mails\n\nFehlgeschlagen — kein Ergebnis.\n\n\`${msg}\`\n`, 'utf-8');
  console.log(`\nDatei geschrieben: ${outPath}`);
  process.exit(1);
}

const lines: string[] = [];
lines.push('# Trockenlauf: Package-Status-Mails (Zusteller-Nummer + AliExpress-Bestellnr.)');
lines.push('');
lines.push('Erzeugt mit `bun --env-file=<repo>/.env scripts/inspect-package-status-emails.ts` gegen');
lines.push('das echte Gmail-Postfach. **Reiner Lesezugriff — keine Mail verändert/als gelesen markiert.**');
lines.push('');
lines.push(`${matches.length} Treffer im 90-Tage-Fenster.`);
lines.push('');
lines.push('| Zusteller-Nummer | AliExpress-Bestellnr. | Mail-Datum |');
lines.push('|---|---|---|');
for (const m of matches) {
  lines.push(`| ${m.trackingNumber} | ${m.aliexpressOrderId} | ${m.emailDate} |`);
}
lines.push('');

const expected: Array<{ aliId: string; expectedTracking: string; note: string }> = [
  { aliId: '3076306514497211', expectedTracking: '00340434886289512140', note: 'Yuecel Karakoca — Auftrag Aufgabe 5' },
  { aliId: '3075188992327211', expectedTracking: '00340434886283998797', note: 'M. Lazarevic, zugestellt 05.08.2026 — Auftrag Aufgabe 6' },
];
lines.push('## Abgleich gegen die im Auftrag genannten erwarteten Werte');
lines.push('');
for (const e of expected) {
  const found = matches.find(m => m.aliexpressOrderId === e.aliId);
  if (!found) {
    lines.push(`- **${e.aliId}** (${e.note}): KEINE Mail gefunden — erwartet ${e.expectedTracking}. ABWEICHUNG.`);
  } else if (found.trackingNumber === e.expectedTracking) {
    lines.push(`- **${e.aliId}** (${e.note}): ✅ gefunden, Nummer stimmt exakt: ${found.trackingNumber}`);
  } else {
    lines.push(`- **${e.aliId}** (${e.note}): Mail gefunden, aber Nummer weicht ab — gefunden ${found.trackingNumber}, erwartet ${e.expectedTracking}. ABWEICHUNG.`);
  }
}

console.log(lines.join('\n'));

const outPath = resolve(outDir, 'package-status-emails-preview.md');
writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(`\nDatei geschrieben: ${outPath}`);
console.log('Reiner Lesezugriff — keine Mail veraendert.');
