// P-27/P-28 PR #82 — Punkt 4 des Auftrags: Live-SKU-Verifikation gegen die echten eBay-SKUs
// für Produkte 71, 77, 92, 95 (per Default; über CLI-Argumente anpassbar).
//
// NUR LESEND — ruft ausschließlich getAccessToken() + getInventoryItemGroupSkus() auf, schreibt
// NICHTS an eBay (kein updateOfferPriceBySku-Aufruf). Nutzt exakt dieselbe SKU-Aufbaulogik wie
// der Fix in updateEbayVariantPricesIndividually() (price-monitor.ts) — importiert die echten
// Quelldateien, keine Kopie der Logik.
//
// Voraussetzung: muss dort laufen, wo die echten Produktions-Env-Vars gesetzt sind
// (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REFRESH_TOKEN)
// — z.B. über die Render-Shell des App-Diensts, oder lokal mit einer .env, die auf dieselbe
// Produktions-DB/denselben eBay-Account zeigt.
//
// Aufruf (aus packages/web/): bun run scripts/verify-ships-from-fix.ts [productId1 productId2 ...]
// Ohne Argumente: prüft 71, 77, 92, 95 (die im Live-Fund bestätigt betroffenen Produkte).

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { computeVariantPriceRows } from '../src/api/price-monitor';
import { getAccessToken, getInventoryItemGroupSkus, slugify, NON_VARIATION_ASPECTS } from '../src/api/ebay';

const productIds = process.argv.slice(2).map(Number).filter(n => !isNaN(n));
const targets = productIds.length > 0 ? productIds : [71, 77, 92, 95];

console.log(`Prüfe Produkte: ${targets.join(', ')}\n`);

const token = await getAccessToken();
let allOk = true;

for (const id of targets) {
  const [product] = await db.select().from(schema.products).where(eq(schema.products.id, id));
  if (!product) {
    console.log(`Produkt ${id}: NICHT GEFUNDEN in der DB\n`);
    allOk = false;
    continue;
  }

  const rows = computeVariantPriceRows(product.variantPrices, product.shippingCost, product.shipsFrom, product.adRate);
  if (rows.length === 0) {
    console.log(`Produkt ${id} ("${product.generatedTitle ?? product.title}"): keine Varianten-Einkaufspreise gespeichert — übersprungen\n`);
    continue;
  }

  const groupSku = `stele-${id}-GROUP`;
  const realSkus = await getInventoryItemGroupSkus(groupSku, token);

  console.log(`Produkt ${id} ("${product.generatedTitle ?? product.title}"):`);
  console.log(`  Echte eBay-SKUs (${realSkus.length}): ${realSkus.join(', ') || '(keine gefunden — Gruppe existiert nicht/nicht gelistet?)'}`);

  let matchCount = 0;
  for (const row of rows) {
    const filteredAttrs = Object.fromEntries(
      Object.entries(row.attrs ?? {}).filter(([k]) => !NON_VARIATION_ASPECTS.has(k))
    );
    const suffix = Object.values(filteredAttrs).map(slugify).filter(Boolean).join('-');
    const candidateSku = `stele-${id}-${suffix}`;
    const matched = realSkus.includes(candidateSku);
    if (matched) matchCount++;
    console.log(`  ${matched ? '✅' : '❌'} attrs=${JSON.stringify(row.attrs)} → erwartet "${candidateSku}"${matched ? '' : ' (KEIN MATCH)'}`);
  }

  const pct = rows.length > 0 ? Math.round((matchCount / rows.length) * 100) : 0;
  console.log(`  → ${matchCount}/${rows.length} SKUs matchen (${pct}%)\n`);
  if (matchCount < rows.length) allOk = false;
}

console.log(allOk ? '✅ Alle geprüften Produkte: 100% SKU-Match.' : '❌ Mindestens ein Produkt hat weiterhin Mismatches — siehe oben.');
