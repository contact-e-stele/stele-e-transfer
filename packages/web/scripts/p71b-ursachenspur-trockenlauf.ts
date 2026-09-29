// P71-B Teil 1, Auftrag 2 (Ursachenspur) + Auftrag 4 (Trockenlauf mit Zahlen) — NACHWEIS: reiner
// Lese-Trockenlauf. KEIN db.update()/insert(), KEIN eBay-Schreib-Call. buildProductDescriptionForEbay()
// wird nur aufgerufen, um den NEU aufgebauten Stand zu zählen — nichts davon wird hochgeladen oder
// gespeichert.
//
// Population: alle Produkte, die Auftrag 1 (p71b-bestandsabgleich.ts) als "aktiv" identifiziert hat
// (Liste C, 47 über getAllSellerListings) PLUS die 6 laut Cockpit gesperrten Angebote (die
// GetSellerList wegen des Grundsatzverstoßes NICHT als aktiv zurückgibt) = 53, wie im Cockpit.
//
// Lokaler Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/p71b-ursachenspur-trockenlauf.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { getAllSellerListings } from '../src/api/ebay';
import { buildProductDescriptionForEbay, type ProductDescriptionFields } from '../src/api/ebay-description-builder';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const OWN_EMAIL = 'contact@stele-e-transfer.com';
const KNOWN_LOCKED_IDS = new Set([
  '198601076435', '198601064695', '198657640355', '198655191464', '198646122180', '198646122171',
]);

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'p71b-ursachenspur-trockenlauf.md');

const ebayListings = await getAllSellerListings();
const activeIds = new Set(ebayListings.map(l => l.itemId));
for (const id of KNOWN_LOCKED_IDS) activeIds.add(id); // Cockpit zählt die 6 gesperrten mit

const rows = await db.select({
  id: schema.products.id,
  title: schema.products.title,
  generatedTitle: schema.products.generatedTitle,
  description: schema.products.description,
  generatedDescription: schema.products.generatedDescription,
  specs: schema.products.specs,
  variants: schema.products.variants,
  variantContents: schema.products.variantContents,
  variantPrices: schema.products.variantPrices,
  bullets: schema.products.bullets,
  images: schema.products.images,
  htmlDescription: schema.products.htmlDescription,
  ebayListingId: schema.products.ebayListingId,
  updatedAt: schema.products.updatedAt,
}).from(schema.products);

const active = rows.filter(p => !!p.ebayListingId && activeIds.has(p.ebayListingId as string));

function countOwnEmail(html: string): number {
  return (html.match(/contact@stele-e-transfer\.com/gi) ?? []).length;
}
function countForeignEmails(html: string): number {
  const all = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  return all.filter(e => e.toLowerCase() !== OWN_EMAIL).length;
}
function countAlicdnImg(html: string): number {
  return (html.match(/alicdn\.com/gi) ?? []).length;
}

interface Row {
  id: number;
  ebayListingId: string;
  gesperrt: boolean;
  ownBefore: number; foreignBefore: number; alicdnBefore: number;
  ownAfter: number; foreignAfter: number; alicdnAfter: number;
  refreshedSince21_09: boolean;
}

const results: Row[] = [];
const REFRESH_BASELINE = new Date('2026-09-21T00:00:00Z').getTime();

for (const p of active) {
  const before = p.htmlDescription ?? '';
  const fields: ProductDescriptionFields = {
    title: p.title,
    generatedTitle: p.generatedTitle,
    description: p.description,
    generatedDescription: p.generatedDescription,
    specs: p.specs,
    variants: p.variants,
    variantContents: p.variantContents,
    variantPrices: p.variantPrices,
    bullets: p.bullets,
    images: p.images,
  };
  const { html: after } = buildProductDescriptionForEbay(fields);

  const updatedAtMs = p.updatedAt ? new Date(p.updatedAt.replace(' ', 'T') + 'Z').getTime() : 0;

  results.push({
    id: p.id,
    ebayListingId: p.ebayListingId as string,
    gesperrt: KNOWN_LOCKED_IDS.has(p.ebayListingId as string),
    ownBefore: countOwnEmail(before), foreignBefore: countForeignEmails(before), alicdnBefore: countAlicdnImg(before),
    ownAfter: countOwnEmail(after), foreignAfter: countForeignEmails(after), alicdnAfter: countAlicdnImg(after),
    refreshedSince21_09: updatedAtMs >= REFRESH_BASELINE,
  });
}

const lines: string[] = [];
lines.push('# P71-B Teil 1, Auftrag 2 (Ursachenspur) + Auftrag 4 (Trockenlauf mit Zahlen)', '');
lines.push(`Lauf: ${new Date().toISOString()}`, '');
lines.push(`Population: ${results.length} aktive Angebote (${ebayListings.length} über getAllSellerListings + ${KNOWN_LOCKED_IDS.size} bekannt gesperrte)`, '');

lines.push('## Auftrag 2 — Ursachenspur (VORHER, gespeicherter Stand)', '');
lines.push('| Produkt | eBay-ItemID | gesperrt? | eigene Adresse | fremde Mails | alicdn-Treffer |');
lines.push('|---|---|---|---|---|---|');
for (const r of results) {
  lines.push(`| ${r.id} | ${r.ebayListingId} | ${r.gesperrt ? 'JA' : 'nein'} | ${r.ownBefore} | ${r.foreignBefore} | ${r.alicdnBefore} |`);
}

const gesperrt = results.filter(r => r.gesperrt);
const nichtGesperrt = results.filter(r => !r.gesperrt);
const sum = (arr: Row[], key: keyof Row) => arr.reduce((s, r) => s + (r[key] as number), 0);
const avg = (arr: Row[], key: keyof Row) => arr.length ? (sum(arr, key) / arr.length).toFixed(2) : 'n/a';

lines.push('', '### Vergleich gesperrt vs. übrige (VORHER)', '');
lines.push(`- Gesperrt (n=${gesperrt.length}): Ø eigene Adresse ${avg(gesperrt, 'ownBefore')}, Ø fremde Mails ${avg(gesperrt, 'foreignBefore')}, Ø alicdn ${avg(gesperrt, 'alicdnBefore')}`);
lines.push(`- Übrige (n=${nichtGesperrt.length}): Ø eigene Adresse ${avg(nichtGesperrt, 'ownBefore')}, Ø fremde Mails ${avg(nichtGesperrt, 'foreignBefore')}, Ø alicdn ${avg(nichtGesperrt, 'alicdnBefore')}`);
const zeroForeignBeforeCount = results.filter(r => r.foreignBefore === 0 && r.ownBefore === 0 && r.alicdnBefore === 0).length;
lines.push(`- Angebote mit VORHER bereits 0/0/0 (eigene Adresse/fremde Mails/alicdn): ${zeroForeignBeforeCount} von ${results.length}`);

lines.push('', '### Seit 21.09. per reviseListingContent/description-refresh nachgezogen (updatedAt >= 21.09.)?', '');
const refreshedCount = results.filter(r => r.refreshedSince21_09).length;
lines.push(`- Produkte mit updatedAt seit 21.09.2026: ${refreshedCount} von ${results.length}`);
if (refreshedCount > 0) {
  lines.push(`- IDs: ${results.filter(r => r.refreshedSince21_09).map(r => r.id).join(', ')}`);
}
lines.push('', '**Hinweis:** `updatedAt` wird von JEDEM Produkt-Update gesetzt (Preis, Menge, GPSR-Felder, ...), nicht ausschließlich vom Beschreibungs-Nachzieh-Weg — ein Treffer hier ist daher nur ein Hinweis, kein Beweis für einen tatsächlichen Beschreibungs-Refresh. Ein eindeutiger Log-Beweis (Render-Logs) ist aus dieser Sandbox technisch nicht möglich: kein RENDER_API_KEY/Dashboard-Zugriff hinterlegt (`.env` enthält nur EBAY_CLIENT_ID/SECRET und TURSO_*).', '');

lines.push('', '## Auftrag 4 — Trockenlauf: NEU aufgebauter Stand (NICHTS hochgeladen)', '');
lines.push('| Produkt | eBay-ItemID | gesperrt? | eigene Adresse | fremde Mails | alicdn-Treffer |');
lines.push('|---|---|---|---|---|---|');
for (const r of results) {
  lines.push(`| ${r.id} | ${r.ebayListingId} | ${r.gesperrt ? 'JA' : 'nein'} | ${r.ownAfter} | ${r.foreignAfter} | ${r.alicdnAfter} |`);
}

lines.push('', '### Summen NACHHER (erwartet: überall 0)', '');
lines.push(`- Summe eigene Adresse: ${sum(results, 'ownAfter')}`);
lines.push(`- Summe fremde Mails: ${sum(results, 'foreignAfter')}`);
lines.push(`- Summe alicdn-Treffer: ${sum(results, 'alicdnAfter')}`);
const nichtNullAfter = results.filter(r => r.ownAfter + r.foreignAfter + r.alicdnAfter > 0);
lines.push(`- Angebote mit mindestens einem Treffer NACHHER: ${nichtNullAfter.length}${nichtNullAfter.length ? ` — IDs: ${nichtNullAfter.map(r => r.id).join(', ')}` : ''}`);

lines.push('', '### Summen VORHER (zum Vergleich)', '');
lines.push(`- Summe eigene Adresse: ${sum(results, 'ownBefore')}`);
lines.push(`- Summe fremde Mails: ${sum(results, 'foreignBefore')}`);
lines.push(`- Summe alicdn-Treffer: ${sum(results, 'alicdnBefore')}`);

writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(lines.join('\n'));
console.log(`\nVollständige Ausgabe: ${outPath}`);
