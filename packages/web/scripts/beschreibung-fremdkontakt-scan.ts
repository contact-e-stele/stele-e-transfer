// Paket 4, Punkt 1 — NACHWEIS: reiner Lese-Trockenlauf, KEIN db.update()/insert(), KEIN eBay-Call.
// Je gelistetem Produkt: welche fremden Kontakte (E-Mail-Adressen) HEUTE in der gespeicherten
// htmlDescription stehen, ob neutralizeGpsrTab() (dieselbe Funktion wie Einzel- und Stapel-Route,
// Regel 8) sie entfernt, und was danach übrig bliebe (= würde die Stapel-Route auf 422 laufen und
// das Produkt überspringen). Ausgabe als Markdown in scripts/output/ (gitignored) — nicht
// committen, Ergebnis kommt in die PR-Beschreibung.
//
// Lokaler Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/beschreibung-fremdkontakt-scan.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { neutralizeGpsrTab, findForeignEmails } from '../src/shared/gpsr-description';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'beschreibung-fremdkontakt-scan.md');

const rows = await db.select({
  id: schema.products.id,
  ebayListingId: schema.products.ebayListingId,
  ebayStatus: schema.products.ebayStatus,
  htmlDescription: schema.products.htmlDescription,
}).from(schema.products);

const listed = rows.filter(p => !!p.ebayListingId && p.ebayStatus === 'listed');
const nonListedWithForeign = rows.filter(p => !(!!p.ebayListingId && p.ebayStatus === 'listed') && findForeignEmails(p.htmlDescription ?? '').length > 0);

const lines: string[] = [];
lines.push('# Paket 4 — Beschreibung-Fremdkontakt-Scan (Produktions-DB, nur lesend)', '');
lines.push(`Lauf: ${new Date().toISOString()}`, '');
lines.push('| Produkt | eBay-ItemID | Fremd-Kontakte heute | nach neutralizeGpsrTab() | würde die Stapel-Route blockieren (422)? |');
lines.push('|---|---|---|---|---|');

let nWithForeign = 0, nCleanedFully = 0, nStillBlocked = 0;
const stillBlockedIds: number[] = [];
for (const p of listed) {
  const html = p.htmlDescription ?? '';
  const before = findForeignEmails(html);
  const after = findForeignEmails(neutralizeGpsrTab(html));
  if (before.length === 0) continue;
  nWithForeign++;
  if (after.length === 0) nCleanedFully++; else { nStillBlocked++; stillBlockedIds.push(p.id); }
  lines.push(`| ${p.id} | ${p.ebayListingId} | ${before.length} (${before.join(', ')}) | ${after.length}${after.length ? ` (${after.join(', ')})` : ' – vollständig entfernt'} | ${after.length > 0 ? 'ja' : 'nein'} |`);
}

lines.push('', '## Summe', '');
lines.push(`- Gelistete Produkte insgesamt: ${listed.length}`);
lines.push(`- Davon mit fremdem Kontakt in htmlDescription: ${nWithForeign}`);
lines.push(`- neutralizeGpsrTab() entfernt alle fremden Kontakte vollständig: ${nCleanedFully} — diese könnten die Stapel-Route (confirm:true) sauber durchlaufen.`);
lines.push(`- Bleibt danach mindestens ein fremder Kontakt stehen (Stapel-Route würde auf 422 laufen, Produkt wird übersprungen): ${nStillBlocked}${stillBlockedIds.length ? ` — Produkte ${stillBlockedIds.join(', ')}` : ''}`);
if (nonListedWithForeign.length > 0) {
  lines.push('', `## Nicht gelistete Produkte mit fremdem Kontakt (nicht Teil des Nachziehens, nur zur Vollständigkeit): ${nonListedWithForeign.length}`, '');
  lines.push(`- Produkte: ${nonListedWithForeign.map(p => p.id).join(', ')}`);
}
lines.push('', `- ${Math.ceil(nWithForeign / 10)} Aufrufe der Stapel-Route (Obergrenze 10) nötig, um alle ${nWithForeign} betroffenen gelisteten Produkte einmal durchzugehen.`);

writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(lines.join('\n'));
console.log(`\nVollständige Ausgabe: ${outPath}`);
