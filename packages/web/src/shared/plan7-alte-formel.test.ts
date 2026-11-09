// PLAN 7 App an ALLE 09.11.2026 Punkt 9: Stellen mit "alter Formel" (ohne Standort-Faktor S aus #291) auf die zentrale Rechnung.
// Prüfmaßstab Kalkulator: Gewinn = VK × (1 − (0,15 + Anzeige) × 1,19 × S) − 0,357 − Kosten, S = 1,19 bei China (unbekannt = China), sonst 1.
// ALLE Ein-/Ausgabewerte hier sind TESTWERTE (keine Live-Daten): CN-Beispiel in der Struktur "China, Anzeige 5 %", DE-Beispiel
// "Germany, Anzeige 0 %". Erwartungswerte unabhängig mit bun nachgerechnet (Grundgesetz 3), Einfuhr = Test-Preload 3,57.
import { describe, expect, test } from 'bun:test';
import {
  profitAtSellPrice, computeOrderProfit, computeOrderProfitRaw, defaultEbayFeeRateGross, ebayPercentFeeRateGross,
  orderFeeChinaLocation, STANDORT_FORMEL_AB, computeAliCosts, DEFAULT_PRICING_CONFIG as C,
} from './pricing';
import { netFactor } from './ad-rate-switch';
import { computeOrderNettoErgebnis, orderFeeIsChina } from '../api/order-matching';

process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'file:/tmp/plan7-alte-formel-test.db';
const { aggregateVariantSales } = await import('../api/variant-sales');
const { buildVariantSku } = await import('../api/price-monitor');

// TESTWERTE
const CN = { vk: 19.95, ware: 7.69, ad: 5 };   // K = 7,69 + 1,99 + 3,57 = 13,25
const DE = { vk: 16.95, ware: 9.38, ad: 0 };   // K = 9,38 (EU: kein Versand, keine Einfuhr)
const NACH = '2026-11-09T10:00:00.000Z';       // Bestelltag ab Stichtag
const VOR = '2026-11-04T10:00:00.000Z';        // Bestelltag vor Stichtag

describe('Plan 7 Punkt 9 — Satz-Funktion (eine Stelle)', () => {
  test('Prozent-Anteil brutto: CN 5 % = 0,20 × 1,19 × 1,19 = 0,28322; DE 0 % = 0,1785', () => {
    expect(defaultEbayFeeRateGross(5, true)).toBeCloseTo(0.28322, 12);
    expect(defaultEbayFeeRateGross(0, false)).toBeCloseTo(0.1785, 12);
    expect(ebayPercentFeeRateGross({ ebayFeeRatePercent: 15, adRatePercent: 5, vatFactor: 1.19, isChinaOrigin: true, ebayLocationFactor: 1 })).toBeCloseTo(0.238, 12);
  });
  test('netFactor (Anzeige-Umschalter) läuft über dieselbe Funktion: CN 5 % 0,71678 · CN 0 % 0,787585 · DE 0,762 / 0,8215', () => {
    expect(netFactor(5, 1.19)).toBeCloseTo(0.71678, 12);
    expect(netFactor(0, 1.19)).toBeCloseTo(0.787585, 12);
    expect(netFactor(5)).toBeCloseTo(0.762, 12);
    expect(netFactor(0)).toBeCloseTo(0.8215, 12);
  });
});

describe('Plan 7 Punkt 9 — Rechenbeispiele CN / DE (Kalkulator-Formel)', () => {
  test('CN 5 %: VK 19,95, K 13,25 → Gewinn 0,692761 (alte Formel ohne S: 1,5949)', () => {
    expect(computeAliCosts(CN.ware, true).totalCost).toBeCloseTo(13.25, 12);
    const p = profitAtSellPrice({ sellPrice: CN.vk, buyPrice: CN.ware, isChinaOrigin: true, ebayFeeRatePercent: C.ebayFeeRatePercent, ebayFixedFeeEur: C.ebayFixedFeeEur, vatFactor: C.vatFactor, adRatePercent: CN.ad });
    expect(p).toBeCloseTo(0.692761, 9);
    // Bestellungs-Gewinn (vorgerechnete Kosten) liefert für dieselben Eingaben denselben Wert
    expect(computeOrderProfitRaw(CN.vk, 13.25, CN.ad, true).profit).toBeCloseTo(p, 9);
    expect(computeOrderProfitRaw(CN.vk, 13.25, CN.ad, true).feesDeducted).toBeCloseTo(6.007239, 9);
  });
  test('DE 0 %: VK 16,95, K 9,38 → Gewinn 4,187425, Gebühr 3,382575 (S = 1, unverändert)', () => {
    const p = profitAtSellPrice({ sellPrice: DE.vk, buyPrice: DE.ware, isChinaOrigin: false, ebayFeeRatePercent: C.ebayFeeRatePercent, ebayFixedFeeEur: C.ebayFixedFeeEur, vatFactor: C.vatFactor, adRatePercent: DE.ad });
    expect(p).toBeCloseTo(4.187425, 9);
    expect(computeOrderProfit(DE.vk, DE.ware, DE.ad, false)).toEqual({ profit: 4.19, feesDeducted: 3.38 });
  });
});

describe('Plan 7 Punkt 9 — Bestellungen-Tab (computeOrderNettoErgebnis)', () => {
  const cnProduct = { id: 1, buyPrice: CN.ware, shipsFrom: 'China', adRate: CN.ad, variants: [] };
  const deProduct = { id: 2, buyPrice: DE.ware, shipsFrom: 'Germany', adRate: DE.ad, variants: [] };
  const run = (p: typeof cnProduct, vk: number, orderDate?: string) => computeOrderNettoErgebnis({
    orderTotal: vk, lineItems: [{ sku: `stele-${p.id}`, quantity: 1 }], manualBuyPrice: null, findProduct: () => p, orderDate,
  });
  test('CN ab Stichtag: Einkauf 13,25, Gebühren 6,01, Gewinn 0,69', () => {
    expect(run(cnProduct, CN.vk, NACH)).toMatchObject({ nettoErgebnis: 0.69, nettoGebuehren: 6.01, nettoQuelle: 'automatisch' });
    expect(run(cnProduct, CN.vk, NACH).nettoEinkauf).toBeCloseTo(13.25, 9);
  });
  test('CN ohne Bestelldatum → sichere Seite (S nach Herkunft): 0,69', () => {
    expect(run(cnProduct, CN.vk).nettoErgebnis).toBe(0.69);
  });
  test('CN vor Stichtag (Standort damals Wiesbaden) → S = 1: Gebühren 5,11, Gewinn 1,59', () => {
    expect(run(cnProduct, CN.vk, VOR)).toMatchObject({ nettoErgebnis: 1.59, nettoGebuehren: 5.11 });
  });
  test('DE ab Stichtag: unverändert Gewinn 4,19, Gebühren 3,38', () => {
    expect(run(deProduct, DE.vk, NACH)).toMatchObject({ nettoErgebnis: 4.19, nettoGebuehren: 3.38 });
  });
  test('manueller Einkauf, CN ab Stichtag: VK 19,95, Einkauf 13,25 → 0,69 (S greift auch im manuellen Zweig)', () => {
    const r = computeOrderNettoErgebnis({ orderTotal: CN.vk, lineItems: [{ sku: 'stele-1', quantity: 1 }], manualBuyPrice: 13.25, findProduct: () => cnProduct, orderDate: NACH });
    expect(r).toMatchObject({ nettoErgebnis: 0.69, nettoQuelle: 'manuell' });
  });
  test('gemischte Bestellung (eine CN-, eine DE-Position) → S 1,19 (Gewinn nie zu hoch)', () => {
    const find = (sku: string | null) => (sku === 'stele-1' ? cnProduct : deProduct);
    const li = [{ sku: 'stele-1', quantity: 1 }, { sku: 'stele-2', quantity: 1 }];
    expect(orderFeeIsChina(li, find, NACH)).toBe(true);
    expect(orderFeeIsChina([{ sku: 'stele-2', quantity: 1 }], find, NACH)).toBe(false);
    expect(orderFeeIsChina(li, find, VOR)).toBe(false);
  });
  test('Variante "Ships From: Poland" eines China-Produkts → S = 1 (Herkunft je Variante wie in der Preisformel)', () => {
    const p = { id: 3, buyPrice: 5, shipsFrom: 'China', adRate: 0, variants: [{ skuId: 'a', attrs: { Farbe: 'Rot', 'Ships From': 'Poland' }, price: 5 }] };
    expect(orderFeeIsChina([{ sku: 'stele-3-ROT', quantity: 1 }], () => p, NACH)).toBe(false);
  });
});

describe('Plan 7 Punkt 9 — Stichtag', () => {
  test(`Stichtag ${STANDORT_FORMEL_AB}: davor S = 1, ab dann nach Herkunft; ohne/ungültiges Datum nach Herkunft`, () => {
    expect(STANDORT_FORMEL_AB).toBe('2026-11-07');
    expect(orderFeeChinaLocation(true, '2026-11-06T23:59:59Z')).toBe(false);
    expect(orderFeeChinaLocation(true, '2026-11-07T00:00:00Z')).toBe(true);
    // Beleg Kalkulator: Bestellung 01-15409-64180 (stele-225 SCHWARZ, 05.11. 19:40, China-Ware, Angebot in Wiesbaden) → S = 1
    expect(orderFeeChinaLocation(true, '2026-11-05T18:40:00Z')).toBe(false);
    expect(orderFeeChinaLocation(true, '')).toBe(true);
    expect(orderFeeChinaLocation(true, undefined)).toBe(true);
    expect(orderFeeChinaLocation(true, 'kaputt')).toBe(true);
    expect(orderFeeChinaLocation(false, '2026-11-09')).toBe(false);
  });
});

describe('Plan 7 Punkt 9 — Varianten-Verkaufszahlen (variant-sales.ts) rechnen wie der Bestellungen-Tab', () => {
  const produkt = {
    id: 110, asin: 'ali_110', buyPrice: CN.ware, shippingCost: 0, shipsFrom: 'China', adRate: CN.ad,
    variants: [{ skuId: 'v1', attrs: { Farbe: 'Rot' }, buyPrice: CN.ware }, { skuId: 'v2', attrs: { Farbe: 'Blau' }, buyPrice: 4.99 }],
  };
  const sku = buildVariantSku(110, { Farbe: 'Rot' });
  const profitAt = (orderDate: string) => aggregateVariantSales({
    orders: [{ orderId: 'o1', orderDate, lineItems: [{ sku, title: 'Rot', quantity: 1, lineItemCost: CN.vk }] }],
    products: [produkt], manualBuyPriceByOrderId: new Map(), now: Date.parse('2026-11-09T12:00:00Z'),
  }).salesBySku.get('110::v1')!.profitPerSale[0];
  test('CN ab Stichtag 0,692761 · vor Stichtag 1,5949', () => {
    expect(profitAt(NACH)).toBeCloseTo(0.692761, 9);
    expect(profitAt(VOR)).toBeCloseTo(1.5949, 9);
  });
});

describe('Plan 7 Punkt 9 — keine eigene Gebühren-Kopie mehr (Grundgesetz 8)', () => {
  test('lieferanten.tsx / index.tsx / api/index.ts / variant-sales.ts / order-matching.ts: kein "(15 + Anzeige)/100 × MwSt" ohne S', async () => {
    const pattern = /\/\s*100\)?\s*\*\s*DEFAULT_PRICING_CONFIG\.vatFactor/;
    for (const f of ['../web/pages/lieferanten.tsx', '../web/pages/index.tsx', '../api/index.ts', '../api/variant-sales.ts', '../api/order-matching.ts']) {
      const src = await Bun.file(new URL(f, import.meta.url)).text();
      expect({ f, hit: pattern.test(src) }).toEqual({ f, hit: false });
    }
    const idx = await Bun.file(new URL('../web/pages/index.tsx', import.meta.url)).text();
    expect(idx).toContain('isChinaOrigin: ausChina,');
  });
});
