// P-27/P-28 PR 6 — Teil A Punkt 2: NUR-LESENDER Voll-Audit ALLER Varianten-Produkte gegen die
// echten eBay-SKUs. Ersetzt die 502-anfällige UI-Klick-Methode für reine Verifikationszwecke:
// keine PUT-Aufrufe an eBay, kein Rate-Limit-Warten pro SKU, nur GETs — dadurch für einen
// Voll-Katalog-Durchlauf in einem einzigen, kurzen Skript-Lauf machbar, ohne Render-HTTP-Timeout-
// Risiko (läuft direkt in der Shell, nicht über einen Browser-Request).
//
// Nutzt dieselbe Matching-Logik wie updateEbayVariantPricesIndividually() (price-monitor.ts):
// computeVariantPriceRows() + NON_VARIATION_ASPECTS-Filterung + slugify() — importiert die
// echten Quelldateien, keine Kopie der Logik.
//
// Voraussetzung: muss dort laufen, wo die echten Produktions-Env-Vars gesetzt sind
// (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REFRESH_TOKEN)
// — z.B. über die Render-Shell des App-Diensts.
//
// Aufruf (aus packages/web/): bun run scripts/audit-all-variant-skus.ts
// Optional: --json gibt zusätzlich die komplette Ergebnisliste als JSON aus (für Weiterverarbeitung).

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { computeVariantPriceRows } from '../src/api/price-monitor';
import { getAccessToken, getInventoryItemGroupSkus, slugify, NON_VARIATION_ASPECTS } from '../src/api/ebay';

interface ProductAuditResult {
  productId: number;
  title: string;
  ebayListingId: string | null;
  realSkuCount: number;
  variantRowCount: number;
  matchedCount: number;
  mismatches: Array<{ attrs: Record<string, string>; expectedSku: string }>;
}

const asJson = process.argv.includes('--json');

console.log('Lade alle live gelisteten Varianten-Produkte…\n');

const listedProducts = await db.select().from(schema.products).where(eq(schema.products.ebayStatus, 'listed'));

const variantProducts = listedProducts.filter(product => {
  let variantCount = 0;
  try { variantCount = product.variantPrices ? (JSON.parse(product.variantPrices) as unknown[]).length : 0; } catch { /* ignore */ }
  let variantGroupCount = 0;
  try { variantGroupCount = product.variants ? (JSON.parse(product.variants) as unknown[]).length : 0; } catch { /* ignore */ }
  return variantCount > 1 || variantGroupCount > 0;
});

console.log(`${variantProducts.length} Varianten-Produkte gefunden. Prüfe jedes gegen die echten eBay-SKUs…\n`);

const token = await getAccessToken();
const results: ProductAuditResult[] = [];

for (const product of variantProducts) {
  const rows = computeVariantPriceRows(product.variantPrices, product.shippingCost, product.shipsFrom, product.adRate);
  if (rows.length === 0) continue; // keine Varianten-Einkaufspreise — nichts zu matchen

  const groupSku = `stele-${product.id}-GROUP`;
  const realSkus = product.ebayListingId ? await getInventoryItemGroupSkus(groupSku, token) : [];

  const mismatches: ProductAuditResult['mismatches'] = [];
  let matchedCount = 0;
  for (const row of rows) {
    const filteredAttrs = Object.fromEntries(
      Object.entries(row.attrs ?? {}).filter(([k]) => !NON_VARIATION_ASPECTS.has(k))
    );
    const suffix = Object.values(filteredAttrs).map(slugify).filter(Boolean).join('-');
    const expectedSku = `stele-${product.id}-${suffix}`;
    if (realSkus.includes(expectedSku)) {
      matchedCount++;
    } else {
      mismatches.push({ attrs: row.attrs, expectedSku });
    }
  }

  const title = product.generatedTitle ?? product.title;
  results.push({
    productId: product.id, title, ebayListingId: product.ebayListingId,
    realSkuCount: realSkus.length, variantRowCount: rows.length, matchedCount, mismatches,
  });

  const status = mismatches.length === 0 ? '✅' : '❌';
  console.log(`${status} Produkt ${product.id} ("${title}"): ${matchedCount}/${rows.length} SKUs matchen`);
  for (const m of mismatches) {
    console.log(`     KEIN MATCH: attrs=${JSON.stringify(m.attrs)} → erwartet "${m.expectedSku}" (echte SKUs: ${realSkus.join(', ') || '(keine — Gruppe nicht gefunden)'})`);
  }
}

const totalProducts = results.length;
const productsWithMismatch = results.filter(r => r.mismatches.length > 0);
const totalRows = results.reduce((s, r) => s + r.variantRowCount, 0);
const totalMatched = results.reduce((s, r) => s + r.matchedCount, 0);

console.log('\n──────────────────────────────────────────────');
console.log(`Zusammenfassung: ${totalMatched}/${totalRows} SKUs matchen über ${totalProducts} Varianten-Produkte.`);
if (productsWithMismatch.length === 0) {
  console.log('✅ Alle geprüften Varianten-Produkte: 100% SKU-Match.');
} else {
  console.log(`❌ ${productsWithMismatch.length} Produkt(e) mit Mismatches: ${productsWithMismatch.map(r => r.productId).join(', ')}`);
}

if (asJson) {
  console.log('\n--- JSON ---');
  console.log(JSON.stringify(results, null, 2));
}
