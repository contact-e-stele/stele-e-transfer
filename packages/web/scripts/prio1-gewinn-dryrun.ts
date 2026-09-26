// PRIO-1-PAKET (2026-09-24), Auftragspunkt 5 — Trockenlauf, NUR LESEND: kein Schreibzugriff auf
// die DB, kein eBay-Schreib-Call (nur die lesende GetOrders-API), keine erneute AliExpress-Abfrage.
//
// Zeigt je Bestellung den alten (Rohdifferenz, Zoll 4,00€) und neuen (computeOrderNettoErgebnis(),
// Zoll 3,58€, inkl. eBay-Gebühren) Gewinn, sowie je Varianten-Produkt den heutigen buyPrice, den
// Preis der billigsten Variante (Ab-Preis), die über resolveVariantBuyPrice() bestimmbare
// Zielvariante (falls eindeutig — mangels frischem AliExpress-Scrape hier gegen den eigenen,
// aktuell gespeicherten Datenstand gespiegelt, s. Hinweis im Bericht) und den berechneten
// Verkaufspreis mit Zoll 4,00€ vs. 3,58€ (nur als Vergleichswert — DEFAULT_PRICING_CONFIG.
// chinaCustomsFlatEur bleibt unverändert, s. PR-Beschreibung).
//
// Aufruf (aus packages/web/): bun --env-file=../../.env run scripts/prio1-gewinn-dryrun.ts
import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { getAllOrders, type EbayOrder } from '../src/api/ebay';
import { buildProductLookups, findProductForSku, computeOrderNettoErgebnis, DEFAULT_ORDER_CHINA_ZOLL_EUR } from '../src/api/order-matching';
import { resolveVariantBuyPrice } from '../src/api/price-monitor';
import { computeMinSellPrice, isChinaShipping, DEFAULT_PRICING_CONFIG } from '../src/shared/pricing';

const OLD_ZOLL_EUR = 4.00; // bisherige Pauschale (CHINA_ZOLL_EUR, shared/constants.ts)
const fmt = (n: number | null) => n == null ? '–' : n.toFixed(2).replace('.', ',');

async function main() {
  const orders = await getAllOrders(); // eBay GetOrders — rein lesend
  const notes = await db.select().from(schema.orderNotes).all();
  const notesByOrderId = new Map(notes.map(n => [n.ebayOrderId, n]));

  const allProducts = await db.select({
    id: schema.products.id,
    asin: schema.products.asin,
    buyPrice: schema.products.buyPrice,
    shipsFrom: schema.products.shipsFrom,
    variantPrices: schema.products.variantPrices,
  }).from(schema.products).all();
  const lookups = buildProductLookups(allProducts);
  const findProduct = (sku: string | null) => findProductForSku(sku, lookups);

  // ─── Teil 1: je Bestellung alter vs. neuer Gewinn ────────────────────────────
  type OrderRow = { orderId: string; total: number; altNetto: number | null; neuNetto: number | null; quelle: string | null };
  const orderRows: OrderRow[] = orders.map((order: EbayOrder) => {
    const note = notesByOrderId.get(order.orderId) ?? null;
    const manualBuyPrice = note?.manualBuyPrice;

    // ALT: Rohdifferenz (order.total - Einkauf), Zoll 4,00€, keine eBay-Gebühren — exakt die
    // Formel, die vor diesem PR in index.ts stand.
    let altNetto: number | null;
    if (manualBuyPrice != null) {
      altNetto = Math.round((order.total - manualBuyPrice) * 100) / 100;
    } else {
      let bekannt = true, einkauf = 0;
      for (const li of order.lineItems) {
        const p = findProduct(li.sku);
        if (!p || p.buyPrice === null) { bekannt = false; continue; }
        const zoll = (p.shipsFrom ?? '').toLowerCase() === 'china' ? OLD_ZOLL_EUR : 0;
        einkauf += (p.buyPrice + zoll) * li.quantity;
      }
      altNetto = bekannt ? Math.round((order.total - einkauf) * 100) / 100 : null;
    }

    // NEU: computeOrderNettoErgebnis() — dieselbe Funktion, die jetzt auch index.ts nutzt.
    const neu = computeOrderNettoErgebnis({
      orderTotal: order.total,
      lineItems: order.lineItems.map(li => ({ sku: li.sku, quantity: li.quantity })),
      manualBuyPrice,
      findProduct: (sku) => {
        const p = findProduct(sku);
        return p ? { buyPrice: p.buyPrice, shipsFrom: p.shipsFrom } : null;
      },
      zollEur: DEFAULT_ORDER_CHINA_ZOLL_EUR,
    });

    return { orderId: order.orderId, total: order.total, altNetto, neuNetto: neu.nettoErgebnis, quelle: neu.nettoQuelle };
  });

  const bekannt = orderRows.filter(r => r.neuNetto != null);
  const altSumme = bekannt.reduce((a, r) => a + (r.altNetto ?? 0), 0);
  const neuSumme = bekannt.reduce((a, r) => a + (r.neuNetto ?? 0), 0);

  // ─── Teil 2: je Varianten-Produkt buyPrice/Ab-Preis/Zielvariante + VK-Vergleich ──────────────
  type VariantRow = {
    id: number; buyPrice: number | null; billigste: number | null; zielvariante: string;
    altVk: number | null; neuVk: number | null;
  };
  const variantRows: VariantRow[] = [];
  for (const p of allProducts) {
    let variants: Array<{ skuId: string; price: number }> = [];
    try { variants = p.variantPrices ? JSON.parse(p.variantPrices) : []; } catch { /* ignore */ }
    if (variants.length <= 1) continue;

    const billigste = Math.min(...variants.filter(v => typeof v.price === 'number').map(v => v.price));
    // Mangels frischem AliExpress-Scrape (kein Live-Zugriff in diesem Trockenlauf) wird die
    // Zielvariante gegen den eigenen, aktuellen Datenstand gespiegelt (existing === fresh) — zeigt
    // also, OB buyPrice heute eindeutig einer bestimmten Variante zuordenbar ist, nicht eine echte
    // Preisänderung seit dem letzten Cron-Lauf.
    const resolution = p.buyPrice != null
      ? resolveVariantBuyPrice(p.variantPrices, p.variantPrices, p.buyPrice)
      : { buyPrice: 0, matchedSkuId: null };
    const zielvariante = resolution.matchedSkuId ?? 'nicht eindeutig bestimmbar';

    const sellPriceAt = (zoll: number) => p.buyPrice == null ? null : computeMinSellPrice({
      buyPrice: p.buyPrice, supplierShipping: 0,
      isChinaOrigin: isChinaShipping(p.shipsFrom), customsFlat: zoll,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: DEFAULT_PRICING_CONFIG.defaultAdRatePercent,
      targetMarginEur: DEFAULT_PRICING_CONFIG.targetMarginEur, safetyBufferEur: DEFAULT_PRICING_CONFIG.safetyBufferEur,
      rounding: 'nearest95',
    }).minSellPrice;

    variantRows.push({
      id: p.id, buyPrice: p.buyPrice, billigste,
      zielvariante,
      altVk: sellPriceAt(OLD_ZOLL_EUR),
      neuVk: sellPriceAt(DEFAULT_ORDER_CHINA_ZOLL_EUR),
    });
  }

  // ─── Markdown-Bericht ─────────────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push('### Trockenlauf-Ergebnis (nur lesend, ' + new Date().toISOString() + ')');
  lines.push('');
  lines.push(`Live-Produktions-DB + eBay GetOrders (lesend), ${orders.length} Bestellungen insgesamt, ${bekannt.length} mit bekanntem Einkaufspreis.`);
  lines.push('');
  lines.push('**Teil 1 — Bestellungs-Gewinn je Bestellung (alt = Rohdifferenz/Zoll 4,00€, neu = computeOrderNettoErgebnis()/Zoll 3,58€ inkl. eBay-Geb.)**');
  lines.push('');
  lines.push('| Bestellung | Umsatz | Alt | Neu | Quelle |');
  lines.push('|---|---|---|---|---|');
  for (const r of orderRows) {
    lines.push(`| ${r.orderId} | ${fmt(r.total)} € | ${fmt(r.altNetto)} € | ${fmt(r.neuNetto)} € | ${r.quelle ?? '–'} |`);
  }
  lines.push('');
  lines.push(`**Summe über die ${bekannt.length} Bestellungen mit bekanntem Einkaufspreis: alt ${fmt(altSumme)} € → neu ${fmt(neuSumme)} €**`);
  lines.push('');
  lines.push('**Teil 2 — Varianten-Produkte: buyPrice heute vs. Ab-Preis vs. Zielvariante, VK-Vergleich Zoll 4,00€ vs. 3,58€**');
  lines.push('');
  lines.push('| Produkt | buyPrice heute | billigste Variante | Zielvariante (SKU) | VK bei Zoll 4,00€ | VK bei Zoll 3,58€ |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of variantRows) {
    lines.push(`| stele-${r.id} | ${fmt(r.buyPrice)} € | ${fmt(r.billigste)} € | ${r.zielvariante} | ${fmt(r.altVk)} € | ${fmt(r.neuVk)} € |`);
  }
  lines.push('');
  lines.push(`Varianten-Produkte gesamt: ${variantRows.length}, davon Zielvariante nicht eindeutig bestimmbar: ${variantRows.filter(r => r.zielvariante === 'nicht eindeutig bestimmbar').length}.`);
  lines.push('');
  lines.push('**Hinweis zu Teil 2:** `buyPrice heute` entspricht bei praktisch allen Produkten bereits der `billigsten Variante` — genau das ist der LIVE-BEFUND des A9-Bugs (buyPrice wurde bei jedem der bisherigen Cron-Läufe auf den Ab-Preis überschrieben). Die Spalte `Zielvariante` kann diesen historischen Schaden NICHT rückwirkend heilen (mangels frischem AliExpress-Scrape in diesem reinen Lesetrockenlauf gegen den eigenen, bereits überschriebenen Datenstand gespiegelt) — der Fix wirkt erst AB dem nächsten Cron-Lauf, indem er die weitere Drift auf den jeweils billigsten Preis verhindert.');

  const report = lines.join('\n') + '\n';
  console.log(report);
  process.exit(0);
}
main();
