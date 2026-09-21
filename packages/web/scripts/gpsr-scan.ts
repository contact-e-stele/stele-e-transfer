// Paket 3 (A3/F3) — NACHWEIS: reiner Lese-Trockenlauf, KEIN db.update()/insert(), KEIN eBay-Call.
// Je Produkt: (a) welche fremden E-Mail-Adressen (alles außer contact@stele-e-transfer.com) in
// htmlDescription stehen — VOR und NACH neutralizeGpsrTab() —, (b) welche Einzelfelder gespeichert sind,
// (c) was der Parser aus gpsrRaw herausholen würde und ob resolveGpsrForListing() die Pflichtangaben
// vollständig hätte (sonst: was fehlt). Nutzt dieselben Funktionen wie Import und Listing (Regel 8).
// Ausgabe als Markdown in scripts/output/ — nicht committen (Ergebnis kommt in die PR-Beschreibung).
//
// Lokaler Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/gpsr-scan.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { parseGpsrRaw, resolveGpsrForListing } from '../src/shared/gpsr-parser';
import { neutralizeGpsrTab, findForeignEmails } from '../src/shared/gpsr-description';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'gpsr-scan.md');

const products = await db.select().from(schema.products);
const lines: string[] = [];
lines.push('# Paket 3 — GPSR-Scan (Produktions-DB, nur lesend)', '');
lines.push('| Produkt | gelistet | Fremd-Mails vorher | nach Tab-Bereinigung | Einzelfelder gespeichert | Parser: EU-Block | Pflichtangaben | Hersteller erkannt | fehlt |');
lines.push('|---|---|---|---|---|---|---|---|---|');

const reasons: Record<string, number> = {};
let nWithForeign = 0, nStillForeign = 0, nListedWithForeign = 0, nListed = 0, nComplete = 0, nMissing = 0, nEuBlock = 0, nManuf = 0, nStored = 0;
for (const p of products) {
  const html = p.htmlDescription ?? '';
  const before = findForeignEmails(html);
  const after = findForeignEmails(neutralizeGpsrTab(html));
  const stored = [p.gpsrName, p.gpsrAddress, p.gpsrCity, p.gpsrEmail].filter(v => v && v.trim()).length;
  const parsed = parseGpsrRaw(p.gpsrRaw);
  const resolved = resolveGpsrForListing(p);
  const listed = !!p.ebayListingId && p.ebayStatus === 'listed';
  nListed += listed ? 1 : 0;
  if (before.length > 0) { nWithForeign++; if (listed) nListedWithForeign++; }
  if (after.length > 0) nStillForeign++;
  if (parsed.euBlockFound) nEuBlock++;
  if (parsed.manufacturer?.name) nManuf++;
  if (stored === 4) nStored++;
  if (resolved.eu) nComplete++; else { nMissing++; for (const m of resolved.missing) reasons[m] = (reasons[m] ?? 0) + 1; }
  lines.push(`| ${p.id} | ${listed ? 'ja' : 'nein'} | ${before.length} (${before.join(', ') || '–'}) | ${after.length}${after.length ? ` (${after.join(', ')})` : ''} | ${stored} von 4 | ${parsed.euBlockFound ? 'ja' : 'nein'} | ${resolved.eu ? 'vollständig' : 'unvollständig'} | ${parsed.manufacturer?.name ? 'ja' : 'nein'} | ${resolved.missing.join('; ') || '–'} |`);
}
lines.push('', '## Summe', '');
lines.push(`- Produkte: ${products.length}, davon gelistet: ${nListed}`);
lines.push(`- Mit fremder E-Mail in htmlDescription: ${nWithForeign} (davon gelistet: ${nListedWithForeign})`);
lines.push(`- Nach Bereinigung des GPSR-Tabs noch mit fremder E-Mail: ${nStillForeign}`);
lines.push(`- Einzelfelder (Name/Adresse/PLZ-Stadt/E-Mail) alle 4 gespeichert: ${nStored}`);
lines.push(`- Parser findet EU-Block: ${nEuBlock}; Hersteller erkannt: ${nManuf}`);
lines.push(`- Pflichtangaben fürs Listing vollständig (gespeichert + geparst): ${nComplete}; unvollständig (würde blockieren): ${nMissing}`);

lines.push('', '### Gründe (ein Produkt kann mehrere haben)', '');
for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) lines.push(`- ${r}: ${n}`);

writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(lines.slice(-8).join('\n'));
console.log(`\nVollständige Ausgabe: ${outPath}`);
