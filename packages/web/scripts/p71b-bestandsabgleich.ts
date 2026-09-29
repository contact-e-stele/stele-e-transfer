// P71-B Teil 1, Auftrag 1 — NACHWEIS: reiner Lese-Trockenlauf, KEIN db.update()/insert(), KEIN
// eBay-Schreib-Call. Gleicht ALLE aktiven eBay-Artikelnummern (getAllSellerListings) gegen
// products.ebayListingId ab und gibt drei Listen aus:
//   A) aktiv bei eBay, aber kein App-Datensatz mit dieser ebayListingId
//   B) App-Datensatz mit ebayListingId, aber nicht in der aktiven eBay-Liste
//   C) in beiden vorhanden
//
// Lokaler Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/p71b-bestandsabgleich.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { getAllSellerListings } from '../src/api/ebay';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'p71b-bestandsabgleich.md');

const ebayListings = await getAllSellerListings();
const ebayIds = new Set(ebayListings.map(l => l.itemId));

const dbProducts = await db.select({
  id: schema.products.id,
  title: schema.products.title,
  ebayListingId: schema.products.ebayListingId,
  ebayStatus: schema.products.ebayStatus,
}).from(schema.products);

const dbWithListingId = dbProducts.filter(p => !!p.ebayListingId);
const dbIds = new Map(dbWithListingId.map(p => [p.ebayListingId as string, p]));

// A) aktiv bei eBay, kein App-Datensatz mit dieser ebayListingId
const listA = ebayListings.filter(l => !dbIds.has(l.itemId));
// B) App-Datensatz mit ebayListingId, aber NICHT in der aktiven eBay-Liste
const listB = dbWithListingId.filter(p => !ebayIds.has(p.ebayListingId as string));
// C) in beiden vorhanden
const listC = dbWithListingId.filter(p => ebayIds.has(p.ebayListingId as string));

const lines: string[] = [];
lines.push('# P71-B Teil 1, Auftrag 1 — Bestandsabgleich (Produktions-DB + Live-eBay, nur lesend)', '');
lines.push(`Lauf: ${new Date().toISOString()}`, '');
lines.push('## Zahlen', '');
lines.push(`- Aktiv bei eBay (getAllSellerListings): ${ebayListings.length}`);
lines.push(`- App-Produkte mit gesetzter ebayListingId: ${dbWithListingId.length}`);
lines.push(`- Liste A (aktiv bei eBay, KEIN App-Datensatz): ${listA.length}`);
lines.push(`- Liste B (App-Datensatz vorhanden, NICHT aktiv bei eBay): ${listB.length}`);
lines.push(`- Liste C (in beiden vorhanden): ${listC.length}`);

lines.push('', '## Liste A — aktiv bei eBay, kein App-Datensatz', '');
if (listA.length === 0) {
  lines.push('_(leer)_');
} else {
  lines.push('| eBay-ItemID | Titel | SKU |', '|---|---|---|');
  for (const l of listA) lines.push(`| ${l.itemId} | ${l.title} | ${l.sku ?? ''} |`);
}

lines.push('', '## Liste B — App-Datensatz mit ebayListingId, nicht aktiv bei eBay', '');
if (listB.length === 0) {
  lines.push('_(leer)_');
} else {
  lines.push('| Produkt-ID | Titel | ebayListingId | ebayStatus |', '|---|---|---|---|');
  for (const p of listB) lines.push(`| ${p.id} | ${p.title} | ${p.ebayListingId} | ${p.ebayStatus} |`);
}

lines.push('', '## Liste C — in beiden vorhanden', '');
lines.push(`${listC.length} Produkte (IDs: ${listC.map(p => p.id).join(', ')})`);

writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(lines.join('\n'));
console.log(`\nVollständige Ausgabe: ${outPath}`);
