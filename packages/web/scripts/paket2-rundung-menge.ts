// Paket 2 (A2/A4/F2) — NACHWEIS: reiner Lese-Trockenlauf, KEIN db.update()/insert(), KEIN eBay-Call.
// Je Varianten-Produkt und Variante: alter Preis (roundToNearest95, bisher) vs. neuer Preis
// (nearest95-min), alter/neuer Gewinn, echter Bestand, bisherige Menge (Deckel 3) und Menge mit der
// neuen Obergrenze (Einstellung max_variant_quantity, Standard 10).
// Rechnet mit denselben Eingaben wie computeVariantPriceRows() (price-monitor.ts): Produkt-Versand,
// Herkunft, adRate, targetMarginEur (Fallback global) — Zielgewinn ist hier der gespeicherte des Produkts.
// Ausgabe als Markdown in scripts/output/ — nicht committen (Ergebnis kommt in die PR-Beschreibung).
//
// Lokaler Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/paket2-rundung-menge.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { computeMinSellPrice, profitAtSellPrice, isChinaShipping, DEFAULT_PRICING_CONFIG as C } from '../src/shared/pricing';
import { resolveVariantQuantity, getMaxVariantQuantity } from '../src/api/ebay';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'paket2-rundung-menge.md');

const maxQty = await getMaxVariantQuantity();
const products = await db.select().from(schema.products);
const f2 = (n: number) => n.toFixed(2).replace('.', ',');

const lines: string[] = [];
lines.push('# Paket 2 — Trockenlauf Rundung + Menge (Produktions-DB, nur lesend)', '');
lines.push(`Obergrenze neu: ${maxQty} (Einstellung max_variant_quantity bzw. Standard). Bisher: 3.`, '');

let nVariants = 0, nOldBelow = 0, nNewBelow = 0, nChanged = 0, nQtyChanged = 0;
for (const p of products) {
  let vp: Array<{ skuId: string; attrs?: Record<string, string>; price: number; stock?: number }> = [];
  try { const parsed = p.variantPrices ? JSON.parse(p.variantPrices) : []; vp = Array.isArray(parsed) ? parsed : []; } catch { continue; }
  vp = vp.filter(v => typeof v.price === 'number' && v.price > 0);
  if (vp.length === 0) continue;
  const margin = p.targetMarginEur ?? C.targetMarginEur;
  const isChina = isChinaShipping(p.shipsFrom);
  const base = {
    supplierShipping: p.shippingCost ?? 0, isChinaOrigin: isChina, customsFlat: C.chinaCustomsFlatEur,
    ebayFeeRatePercent: C.ebayFeeRatePercent, ebayFixedFeeEur: C.ebayFixedFeeEur, vatFactor: C.vatFactor,
    adRatePercent: p.adRate ?? C.defaultAdRatePercent, targetMarginEur: margin, safetyBufferEur: 0,
  };
  lines.push(`## Produkt ${p.id} (Zielgewinn ${f2(margin)} €)`, '');
  lines.push('| Variante | EK | VK alt | VK neu | Gewinn alt | Gewinn neu | Bestand | Menge alt | Menge neu |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const v of vp) {
    const oldP = computeMinSellPrice({ ...base, buyPrice: v.price, rounding: 'nearest95' }).minSellPrice;
    const newP = computeMinSellPrice({ ...base, buyPrice: v.price, rounding: 'nearest95-min' }).minSellPrice;
    const profit = (sell: number) => profitAtSellPrice({ ...base, buyPrice: v.price, sellPrice: sell });
    const gOld = profit(oldP), gNew = profit(newP);
    const qOld = resolveVariantQuantity(v.stock, 0, 3), qNew = resolveVariantQuantity(v.stock, 0, maxQty);
    nVariants++;
    if (gOld < margin - 1e-9) nOldBelow++;
    if (gNew < margin - 1e-9) nNewBelow++;
    if (oldP !== newP) nChanged++;
    if (qOld !== qNew) nQtyChanged++;
    const name = Object.values(v.attrs ?? {}).join(' / ') || v.skuId;
    lines.push(`| ${name} | ${f2(v.price)} | ${f2(oldP)} | ${f2(newP)} | ${f2(gOld)} | ${f2(gNew)} | ${v.stock ?? '–'} | ${qOld} | ${qNew} |`);
  }
  lines.push('');
}
lines.push('## Summe', '');
lines.push(`- Varianten gesamt: ${nVariants}`);
lines.push(`- Gewinn alt unter Zielgewinn: ${nOldBelow}`);
lines.push(`- Gewinn neu unter Zielgewinn: ${nNewBelow}`);
lines.push(`- Preis ändert sich: ${nChanged}`);
lines.push(`- Menge ändert sich: ${nQtyChanged}`);

writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(lines.slice(-8).join('\n'));
console.log(`\nVollständige Ausgabe: ${outPath}`);
