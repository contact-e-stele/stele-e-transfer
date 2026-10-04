// A-014 Punkt 6 — Preisformel v2: Vergleich alter VK → neuer VK je gelistetem Produkt/Variante. NUR LESEND:
// ein einziges SELECT auf products; es wird nichts geschrieben (weder DB noch eBay), keine Preisänderung.
// Die Rechenlogik liegt in src/shared/price-report-v2.ts (reine Funktionen, getestet) — dieses Skript liest und formatiert nur.
//
// Aufruf (aus packages/web/): bun --env-file=../../.env scripts/export-price-formula-v2.ts
// Ausgabe: scripts/output/price-formula-v2.md (und dieselbe Tabelle auf stdout)
import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { buildPriceReportRows, renderPriceReportMarkdown, type ReportProduct } from '../src/shared/price-report-v2';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const p = schema.products;
const dbRows = await db.select({
  id: p.id, title: p.generatedTitle, ebayStatus: p.ebayStatus, buyPrice: p.buyPrice, sellPrice: p.sellPrice,
  variantPrices: p.variantPrices, variantSellPrices: p.variantSellPrices, shippingCost: p.shippingCost,
  shipsFrom: p.shipsFrom, adRate: p.adRate, targetMarginEur: p.targetMarginEur,
}).from(p).orderBy(p.id);

const products: ReportProduct[] = dbRows.map(r => ({ ...r, title: r.title ?? '' }));
const { rows, skipped } = buildPriceReportRows(products);
const md = renderPriceReportMarkdown(rows, skipped, new Date().toISOString());

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'price-formula-v2.md'), md);
console.log(md);
