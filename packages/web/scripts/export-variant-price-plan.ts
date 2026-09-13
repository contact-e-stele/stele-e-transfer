// Preis-Fundament Teil 3 (2026-09-13) — Pflichtbestandteile #5/#6: Bericht über ALLE Produkte mit
// mehr als einer Variante. Pro Variante: SKU, Variante, EK, heutiger Preis, neuer Preis, Gewinn
// heute, Gewinn neu, Differenz — plus je Produkt die Summe der Preissenkungen. Zusätzlich (#6) die
// Verkäufe je Varianten-SKU, damit sichtbar wird, ob die günstigen Varianten überhaupt gekauft
// werden.
//
// NUR LESEND — es wird KEIN Preis geschrieben und KEINE eBay-Anzeige geändert. Sämtliche
// eBay-Zugriffe sind GET: getInventoryItemGroupSkus() (SKUs je Varianten-Gruppe), ein Offer-GET je
// SKU (aktueller Live-Preis) und getAllOrders() (Verkäufe). Das Nachziehen der Anzeigen gibt der
// Nutzer nach Sichtung dieses Berichts separat frei.
//
// Voraussetzung: muss dort laufen, wo die echten Produktions-Env-Vars gesetzt sind
// (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, eBay-OAuth) — z.B. über die Render-Shell des App-Diensts.
//
// Aufruf (aus packages/web/): bun run scripts/export-variant-price-plan.ts > varianten-preisplan.csv

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import {
  computeVariantSellPrices, profitAtSellPrice, isChinaShipping,
  DEFAULT_PRICING_CONFIG, type VariantPriceEntry,
} from '../src/shared/pricing';
import { MAX_PRICE_DECREASE_PERCENT } from '../src/shared/constants';
import { buildVariantSku } from '../src/api/price-monitor';
import { getAccessToken, getInventoryItemGroupSkus, getAllOrders } from '../src/api/ebay';

const EBAY_API_BASE = 'https://api.ebay.com';

// Liest den aktuellen Live-Preis einer Varianten-SKU. Rein lesend (GET), kein Schreibvorgang.
async function getLiveOfferPrice(sku: string, token: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${EBAY_API_BASE}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=EBAY_DE`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const data = await res.json() as { offers?: Array<{ pricingSummary?: { price?: { value?: string } } }> };
    const raw = data.offers?.[0]?.pricingSummary?.price?.value;
    const parsed = raw != null ? parseFloat(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseVariantPrices(json: string | null): VariantPriceEntry[] {
  try {
    const parsed = json ? JSON.parse(json) : [];
    if (!Array.isArray(parsed)) return [];
    return (parsed as VariantPriceEntry[]).filter(v => typeof v.price === 'number' && v.price > 0);
  } catch {
    return [];
  }
}

const csvSafe = (s: string) => `"${s.replace(/"/g, '""')}"`;

console.error('Lade Produkte…');
const allProducts = await db.select().from(schema.products);
const multiVariantProducts = allProducts
  .map(p => ({ product: p, variants: parseVariantPrices(p.variantPrices) }))
  .filter(x => x.variants.length > 1);
console.error(`${multiVariantProducts.length} Produkte mit mehr als einer Variante (von ${allProducts.length} insgesamt).`);

// eBay-Zugang + Verkäufe (nur lesend). Fällt einer der Aufrufe aus, läuft der Bericht trotzdem —
// die betroffenen Spalten werden dann als "n/v" ausgewiesen statt den Bericht zu blockieren.
let token: string | null = null;
try { token = await getAccessToken(); } catch (e) { console.error(`eBay-Token nicht verfügbar (${String(e)}) — Live-Preise und Verkäufe entfallen.`); }

const salesBySku = new Map<string, number>();
if (token) {
  try {
    const orders = await getAllOrders();
    for (const order of orders) {
      for (const li of order.lineItems) {
        if (!li.sku) continue;
        salesBySku.set(li.sku, (salesBySku.get(li.sku) ?? 0) + (li.quantity ?? 0));
      }
    }
    console.error(`Verkäufe aus ${orders.length} Bestellungen aggregiert (eBay liefert standardmäßig ~90 Tage).`);
  } catch (e) {
    console.error(`Bestellungen nicht abrufbar (${String(e)}) — Verkaufsspalte bleibt leer.`);
  }
}

const variantRows: string[] = [
  // SKU_Match: ob die aus attrs gebaute SKU einer ECHTEN eBay-SKU der Varianten-Gruppe entspricht.
  // "nein" ist die wahrscheinlichste Ursache dafür, dass ein Listing trotz Einzelpreis-Logik nur
  // EINEN Preis zeigt (price-monitor.ts:128/133: ohne Zeilen-Match bekommt die SKU den
  // Einheits-Fallback) — siehe Auftragspunkt 4.
  'SKU,Variante,Varianten_SKU,SKU_Match,EK,heutiger_Preis,Preisquelle,neuer_Preis,Gewinn_heute,Gewinn_neu,Differenz_Preis,Absenkung_Prozent,ueber_8_Prozent,Anker,Verkaeufe_90T',
];
const productRows: string[] = [
  'SKU,Anzahl_Varianten,Ankervariante,Ankerpreis,Ankergewinn,Zielgewinn,Zielgewinn_Quelle,Summe_Preissenkungen,groesste_Absenkung_Prozent,Live_Preisspanne_heute',
];

let productsOverCap = 0;

for (const { product, variants } of multiVariantProducts) {
  const adRate = product.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
  const versand = product.shippingCost ?? 0;
  const isChina = isChinaShipping(product.shipsFrom);
  const costContext = {
    supplierShipping: versand,
    isChinaOrigin: isChina,
    customsFlat: DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur,
    ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent,
    ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
    vatFactor: DEFAULT_PRICING_CONFIG.vatFactor,
    adRatePercent: adRate,
  };

  // Echte eBay-SKUs + deren aktuelle Live-Preise (nur lesend).
  const liveSkus = token ? await getInventoryItemGroupSkus(`stele-${product.id}-GROUP`, token).catch(() => [] as string[]) : [];
  const livePriceBySku = new Map<string, number>();
  if (token) {
    for (const sku of liveSkus) {
      const price = await getLiveOfferPrice(sku, token);
      if (price != null) livePriceBySku.set(sku, price);
      await new Promise(r => setTimeout(r, 120)); // eBay-Rate-Limit schonen
    }
  }

  // Ankerpreis = heutiger sellPrice des Produkts (wörtliche Vorgabe: "behält exakt den heutigen
  // sellPrice"). Fehlt er, ersatzweise der höchste Live-Preis — dann als Quelle gekennzeichnet.
  const liveMax = livePriceBySku.size > 0 ? Math.max(...livePriceBySku.values()) : null;
  const anchorSellPrice = product.sellPrice ?? liveMax;
  if (anchorSellPrice == null) {
    console.error(`stele-${product.id}: weder sellPrice noch Live-Preis bekannt — übersprungen.`);
    continue;
  }

  const plan = computeVariantSellPrices({
    ...costContext,
    variants: variants.map(v => ({ skuId: v.skuId, buyPrice: v.price, attrs: v.attrs })),
    anchorSellPrice,
    targetMarginEur: product.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur,
  });

  let sumDecrease = 0;
  let maxDecreasePercent = 0;

  for (const row of plan.rows) {
    const ebaySku = buildVariantSku(product.id, row.attrs);
    const livePrice = livePriceBySku.get(ebaySku) ?? null;
    // "Heutiger Preis" je Variante: der echte Live-Preis dieser SKU, sonst der gespeicherte
    // Einheitspreis des Produkts (genau der Zustand, den Teil 3 beheben soll).
    const todayPrice = livePrice ?? product.sellPrice ?? anchorSellPrice;
    const priceSource = livePrice != null ? 'eBay-live' : (product.sellPrice != null ? 'DB-sellPrice' : 'Ankerpreis');

    const profitToday = profitAtSellPrice({ ...costContext, sellPrice: todayPrice, buyPrice: row.buyPrice });
    const diff = row.sellPrice - todayPrice;
    const decreasePercent = todayPrice > 0 && diff < 0 ? (-diff / todayPrice) * 100 : 0;
    if (diff < 0) sumDecrease += -diff;
    maxDecreasePercent = Math.max(maxDecreasePercent, decreasePercent);

    const variantLabel = Object.values(row.attrs ?? {}).join(' / ') || row.skuId;
    const skuMatch = liveSkus.length === 0 ? 'n/v' : (liveSkus.includes(ebaySku) ? 'ja' : 'nein');
    variantRows.push([
      `stele-${product.id}`,
      csvSafe(variantLabel),
      ebaySku,
      skuMatch,
      row.buyPrice.toFixed(2),
      todayPrice.toFixed(2),
      priceSource,
      row.sellPrice.toFixed(2),
      profitToday.toFixed(2),
      row.profit.toFixed(2),
      (diff >= 0 ? '+' : '') + diff.toFixed(2),
      decreasePercent.toFixed(2),
      decreasePercent > MAX_PRICE_DECREASE_PERCENT ? 'ja' : 'nein',
      row.isAnchor ? 'ja' : 'nein',
      token ? String(salesBySku.get(ebaySku) ?? 0) : 'n/v',
    ].join(','));
  }

  if (maxDecreasePercent > MAX_PRICE_DECREASE_PERCENT) productsOverCap++;

  const liveSpan = livePriceBySku.size > 0
    ? `${Math.min(...livePriceBySku.values()).toFixed(2)}-${Math.max(...livePriceBySku.values()).toFixed(2)}`
    : 'n/v';

  productRows.push([
    `stele-${product.id}`,
    String(plan.rows.length),
    plan.anchorSkuId,
    plan.anchorSellPrice.toFixed(2),
    plan.anchorProfit.toFixed(2),
    plan.targetProfit.toFixed(2),
    plan.targetProfitSource,
    sumDecrease.toFixed(2),
    maxDecreasePercent.toFixed(2),
    liveSpan,
  ].join(','));
}

console.log('### Varianten ###');
console.log(variantRows.join('\n'));
console.log('\n### Produkt-Zusammenfassung ###');
console.log(productRows.join('\n'));

console.error(`\nFertig — ${productRows.length - 1} Produkte, ${variantRows.length - 1} Varianten.`);
console.error(
  productsOverCap > 0
    ? `HINWEIS: bei ${productsOverCap} Produkt(en) liegt mindestens eine Varianten-Absenkung über der ${MAX_PRICE_DECREASE_PERCENT}%-Senkungsbremse aus Teil 2D. Das ist kein Fehler dieses Berichts — er zeigt den ZIELZUSTAND. Beim späteren Nachziehen muss entschieden werden, ob die Bremse dafür gilt (dann mehrere Läufe) oder ob die Umstellung als einmalige, bewusst freigegebene Korrektur davon ausgenommen wird.`
    : `Keine Varianten-Absenkung überschreitet die ${MAX_PRICE_DECREASE_PERCENT}%-Senkungsbremse aus Teil 2D.`
);
console.error('Es wurde NICHTS geschrieben — weder in die DB noch an eBay.');
