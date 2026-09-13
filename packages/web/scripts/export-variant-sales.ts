// Preis-Fundament Teil 3B (2026-09-13) — Verkaufszahlen JE VARIANTEN-SKU.
//
// WARUM: der Varianten-Preisplan aus Teil 3 würde bei günstigen Varianten die Preise senken. Ob
// sich das lohnt, hängt allein daran, WELCHE Varianten sich tatsächlich verkaufen. Dieses Skript
// liefert genau diese Zahl.
//
// DATENQUELLE — wichtig: die Bestellpositionen (und damit die verkaufte SKU) liegen NICHT in der
// Datenbank. Die einzigen fünf Tabellen sind products, price_history, app_settings,
// trusted_suppliers und order_notes; order_notes speichert pro Bestellung nur Zusatzinfos
// (Tracking, Rechnung, manueller EK) und KEINE Positionen. Die Verkäufe je SKU sind deshalb
// ausschließlich über die eBay Sell Fulfillment API zu bekommen — getAllOrders() → lineItems[].sku.
// Dieser API-Aufruf ist also zwingend nötig, er ist rein lesend (GET /sell/fulfillment/v1/order).
//
// ZEITRAUM: "gesamt" = alles, was die API liefert. eBay gibt ohne expliziten Filter standardmäßig
// die letzten ~90 Tage zurück (siehe P-101-Kommentar in src/api/ebay.ts) — "gesamt" und "90 Tage"
// können deshalb identisch sein. Die 90-Tage-Spalte wird trotzdem eigenständig aus dem
// Bestelldatum berechnet, damit sie auch dann stimmt, wenn die API später mehr liefert.
//
// NUR LESEND: kein Preis wird geschrieben, keine eBay-Anzeige geändert, keine ändernde eBay-API
// aufgerufen.
//
// Aufruf (aus packages/web/): bun run scripts/export-variant-sales.ts > varianten-verkaeufe.csv

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import {
  computeVariantSellPrices, isChinaShipping,
  DEFAULT_PRICING_CONFIG, type VariantPriceEntry,
} from '../src/shared/pricing';
import { buildVariantSku } from '../src/api/price-monitor';
import { UNMATCHED_REASON_TEXT, type UnmatchedReason } from '../src/api/order-matching';
import { aggregateVariantSales, emptyVariantSalesAgg } from '../src/api/variant-sales';
import { getAllOrders } from '../src/api/ebay';

const csvSafe = (s: string) => `"${s.replace(/"/g, '""')}"`;
const eur = (n: number) => n.toFixed(2);

function parseVariantPrices(json: string | null): VariantPriceEntry[] {
  try {
    const parsed = json ? JSON.parse(json) : [];
    if (!Array.isArray(parsed)) return [];
    return (parsed as VariantPriceEntry[]).filter(v => typeof v.price === 'number' && v.price > 0);
  } catch {
    return [];
  }
}

console.error('Lade Produkte und Bestellnotizen…');
const allProducts = await db.select().from(schema.products);
const allNotes = await db.select().from(schema.orderNotes);

const multiVariant = allProducts
  .map(p => ({ product: p, variants: parseVariantPrices(p.variantPrices) }))
  .filter(x => x.variants.length > 1);
console.error(`${multiVariant.length} Produkte mit mehr als einer Variante.`);

console.error('Rufe eBay-Bestellungen ab (getAllOrders, nur lesend) — die SKU je Position gibt es nur dort…');
let orders: Awaited<ReturnType<typeof getAllOrders>>;
try {
  orders = await getAllOrders();
} catch (e) {
  console.error(`\nABBRUCH: die eBay-Bestellungen sind nicht abrufbar (${String(e)}).`);
  console.error('Ohne sie gibt es keine Verkaufszahlen je SKU — die Bestellpositionen liegen NICHT in der DB.');
  console.error('Bitte dort ausfuehren, wo die eBay-Zugangsdaten gesetzt sind (Render-Shell).');
  process.exit(1);
}
console.error(`${orders.length} Bestellungen erhalten.`);

// ─── Verkäufe je Varianten-SKU aggregieren (reine, getestete Funktion) ────────────────────────
const { salesBySku, lineItemsTotal, lineItemsMatched, unmatched } = aggregateVariantSales({
  orders: orders.map(o => ({
    orderId: o.orderId,
    orderDate: o.orderDate,
    lineItems: o.lineItems.map(li => ({ sku: li.sku, title: li.title, quantity: li.quantity, lineItemCost: li.lineItemCost })),
  })),
  products: multiVariant.map(({ product, variants }) => ({
    id: product.id, asin: product.asin, buyPrice: product.buyPrice, shippingCost: product.shippingCost,
    shipsFrom: product.shipsFrom, adRate: product.adRate,
    variants: variants.map(v => ({ skuId: v.skuId, attrs: v.attrs, buyPrice: v.price })),
  })),
  manualBuyPriceByOrderId: new Map(allNotes.map(n => [n.ebayOrderId, n.manualBuyPrice])),
});
const emptyAgg = emptyVariantSalesAgg;

// ─── Bericht ──────────────────────────────────────────────────────────────────────────────────
const variantRows: string[] = [
  'SKU,Variantenname,Varianten_SKU,Einkaufspreis,heutiger_Preis,Zielpreis_Teil3,Verkaeufe_gesamt,Verkaeufe_90T,Umsatz_gesamt,Gewinn_je_Verkauf,ohne_Verkauf,Auswirkung_bei_Umsetzung,Anker',
];
const productRows: string[] = [
  'SKU,Anzahl_Varianten,Verkaeufe_gesamt,Verkaeufe_90T,Gesamtauswirkung_EUR,Ankeranteil_Verkaeufe_Prozent,Varianten_ohne_Verkauf',
];

let grandImpact = 0;

for (const { product, variants } of multiVariant) {
  const adRate = product.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
  const costContext = {
    supplierShipping: product.shippingCost ?? 0,
    isChinaOrigin: isChinaShipping(product.shipsFrom),
    customsFlat: DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur,
    ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent,
    ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
    vatFactor: DEFAULT_PRICING_CONFIG.vatFactor,
    adRatePercent: adRate,
  };
  const todayPrice = product.sellPrice;
  if (todayPrice == null) { console.error(`stele-${product.id}: kein sellPrice — übersprungen.`); continue; }

  const plan = computeVariantSellPrices({
    ...costContext,
    variants: variants.map(v => ({ skuId: v.skuId, buyPrice: v.price, attrs: v.attrs })),
    anchorSellPrice: todayPrice,
    targetMarginEur: product.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur,
  });

  let productUnitsTotal = 0, productUnits90d = 0, productImpact = 0, zeroSaleVariants = 0, anchorUnits = 0;

  for (const row of plan.rows) {
    const agg = salesBySku.get(`${product.id}::${row.skuId}`) ?? emptyAgg();
    const label = Object.values(row.attrs ?? {}).join(' / ') || row.skuId;
    // Auswirkung = (Zielpreis − heutiger Preis) × Verkäufe der letzten 90 Tage
    const impact = (row.sellPrice - todayPrice) * agg.units90d;

    productUnitsTotal += agg.unitsTotal;
    productUnits90d += agg.units90d;
    productImpact += impact;
    if (agg.unitsTotal === 0) zeroSaleVariants++;
    if (row.isAnchor) anchorUnits += agg.unitsTotal;

    // Gewinn je Verkauf: Durchschnitt über die berechenbaren Verkäufe. Gibt es keinen einzigen
    // berechenbaren (P-49-Altbestand ohne EK), steht hier ausdrücklich "nicht berechenbar" — nie 0.
    const profitCell = agg.profitPerSale.length > 0
      ? eur(agg.profitPerSale.reduce((a, b) => a + b, 0) / agg.profitPerSale.length) + (agg.notCalculable > 0 ? ` (${agg.notCalculable} nicht berechenbar)` : '')
      : (agg.unitsTotal > 0 ? 'nicht berechenbar' : '');

    variantRows.push([
      `stele-${product.id}`,
      csvSafe(label),
      buildVariantSku(product.id, row.attrs),
      eur(row.buyPrice),
      eur(todayPrice),
      eur(row.sellPrice),
      String(agg.unitsTotal),
      String(agg.units90d),
      agg.unitsTotal === 0 ? '' : (agg.revenueKnown ? eur(agg.revenueTotal) : `${eur(agg.revenueTotal)} (unvollständig)`),
      csvSafe(profitCell),
      agg.unitsTotal === 0 ? 'OHNE VERKAUF' : '',
      (impact >= 0 ? '+' : '') + eur(impact),
      row.isAnchor ? 'ja' : 'nein',
    ].join(','));
  }

  grandImpact += productImpact;
  const anchorShare = productUnitsTotal > 0 ? (anchorUnits / productUnitsTotal) * 100 : 0;

  productRows.push([
    `stele-${product.id}`,
    String(plan.rows.length),
    String(productUnitsTotal),
    String(productUnits90d),
    (productImpact >= 0 ? '+' : '') + eur(productImpact),
    productUnitsTotal > 0 ? anchorShare.toFixed(1) : 'keine Verkäufe',
    String(zeroSaleVariants),
  ].join(','));
}

console.log('### Varianten ###');
console.log(variantRows.join('\n'));
console.log('\n### Produkt-Zusammenfassung ###');
console.log(productRows.join('\n'));
console.log(`\n### Gesamtauswirkung über alle Produkte (90 Tage): ${grandImpact >= 0 ? '+' : ''}${eur(grandImpact)} EUR ###`);

// ─── Abgleich (#5): keine Position darf stillschweigend verschwinden ──────────────────────────
const unmatchedByReason = new Map<UnmatchedReason, number>();
for (const u of unmatched) unmatchedByReason.set(u.reason, (unmatchedByReason.get(u.reason) ?? 0) + 1);

console.log('\n### Abgleich Bestellpositionen ###');
console.log('Kennzahl,Wert');
console.log(`Bestellungen von eBay,${orders.length}`);
console.log(`Bestellpositionen gesamt,${lineItemsTotal}`);
console.log(`davon einer Varianten-SKU zugeordnet,${lineItemsMatched}`);
console.log(`davon NICHT zugeordnet,${unmatched.length}`);
for (const [reason, count] of unmatchedByReason) {
  console.log(`  Grund: ${UNMATCHED_REASON_TEXT[reason]},${count}`);
}
const reconciles = lineItemsMatched + unmatched.length === lineItemsTotal;
console.log(`Abgleich geht auf,${reconciles ? 'ja' : 'NEIN — BITTE PRUEFEN'}`);

if (unmatched.length > 0) {
  console.log('\n### Nicht zugeordnete Positionen (vollständig, nichts verworfen) ###');
  console.log('Bestellung,SKU,Titel,Menge,Grund');
  for (const u of unmatched) {
    console.log([u.orderId, u.sku ?? '(keine)', csvSafe(u.title), String(u.quantity), csvSafe(UNMATCHED_REASON_TEXT[u.reason])].join(','));
  }
}

console.error(`\nFertig. ${lineItemsMatched} von ${lineItemsTotal} Positionen zugeordnet, ${unmatched.length} nicht (mit Grund ausgewiesen).`);
console.error('Es wurde NICHTS geschrieben — weder in die DB noch an eBay.');
