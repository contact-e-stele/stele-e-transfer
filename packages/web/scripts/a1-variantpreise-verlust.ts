// A1 — NACHWEIS: reiner Lese-Trockenlauf, KEIN db.update()/insert(), KEIN eBay-Call.
// Je Produkt mit Varianten: Anzahl Varianten, davon mit ebayPrice / imageUrl / displayValues,
// dazu lastPriceCheck. Zeigt, welche Produkte durch das Überschreiben in der Preisprüfung
// (price-monitor.ts, vor A1) bereits Daten verloren haben.
// Ausgabe als Markdown in scripts/output/ — nicht committen (Ergebnis kommt in die PR-Beschreibung).
//
// Lokaler Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/a1-variantpreise-verlust.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'a1-variantpreise-verlust.md');

const products = await db.select().from(schema.products);
const lines: string[] = [];
lines.push('# A1 — Varianten-Daten je Produkt (Produktions-DB, nur lesend)', '');
lines.push('| Produkt | Varianten | mit ebayPrice | mit imageUrl | mit displayValues | lastPriceCheck |');
lines.push('|---|---|---|---|---|---|');

let shown = 0;
for (const p of products) {
  let vp: Array<Record<string, unknown>> = [];
  try { const parsed = p.variantPrices ? JSON.parse(p.variantPrices) : []; vp = Array.isArray(parsed) ? parsed : []; } catch { continue; }
  if (vp.length === 0) continue;
  const n = vp.length;
  const withEbay = vp.filter(v => typeof v.ebayPrice === 'number').length;
  const withImg = vp.filter(v => typeof v.imageUrl === 'string' && v.imageUrl).length;
  const withDv = vp.filter(v => v.displayValues && typeof v.displayValues === 'object' && Object.keys(v.displayValues as object).length > 0).length;
  lines.push(`| ${p.id} | ${n} | ${withEbay} von ${n} | ${withImg} von ${n} | ${withDv} von ${n} | ${p.lastPriceCheck ?? '–'} |`);
  shown++;
}
lines.push('', `${shown} Produkte mit variantPrices von ${products.length} gesamt.`);

writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(lines.join('\n'));
