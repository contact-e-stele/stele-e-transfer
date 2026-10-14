// K-005c: Kassen-Faktor (Kasse ÷ App-Preis) — Gültigkeit, Anwendung, Ableitung, Einbau in die EINE Formel und in den Bestellungs-Gewinn.
// Alle Erwartungswerte mit bun nachgerechnet (Grundgesetz 3), nicht geschätzt.
import { describe, expect, test } from 'bun:test';
import { activeCheckoutFactor, applyCheckoutFactor, checkoutWareFromInvoiceTotal, deriveCheckoutFactors, type FactorMatch, type FactorOrder } from './checkout-factor';
import { computeMinSellPrice, profitAtSellPrice, evaluatePriceAlarm, type PricingInput } from './pricing';
import { computeOrderNettoErgebnis } from '../api/order-matching';
import { planCheckoutFactorSync, type FactorSyncProduct } from '../api/checkout-factor-sync';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-14T12:00:00Z');
const isoDaysAgo = (d: number, now = NOW) => new Date(now.getTime() - d * DAY).toISOString();

describe('activeCheckoutFactor', () => {
  test('0,9508 von heute → 0,9508', () => expect(activeCheckoutFactor(0.9508, isoDaysAgo(0), NOW)).toBe(0.9508));
  test('15 Tage alt → null', () => expect(activeCheckoutFactor(0.9508, isoDaysAgo(15), NOW)).toBeNull());
  test('1,05 → null (nie über 1,00)', () => expect(activeCheckoutFactor(1.05, isoDaysAgo(0), NOW)).toBeNull());
  test('null → null', () => expect(activeCheckoutFactor(null, isoDaysAgo(0), NOW)).toBeNull());
});

describe('applyCheckoutFactor', () => {
  test('12,19 × 0,9508 = 11,59 (bun: 11,590252 → 11,59)', () => expect(applyCheckoutFactor(12.19, 0.9508)).toBe(11.59));
  test('Faktor null → unverändert', () => expect(applyCheckoutFactor(12.19, null)).toBe(12.19));
});

describe('checkoutWareFromInvoiceTotal', () => {
  test('EU 12,59 → 12,59', () => expect(checkoutWareFromInvoiceTotal(12.59, false)).toBe(12.59));
  test('China 15,04 → 11,47 (≥ 10 €, nur Einfuhr 3,57 ab)', () => expect(checkoutWareFromInvoiceTotal(15.04, true)).toBe(11.47));
  test('China 8,71 → 3,15 (Versand 1,99 + Einfuhr 3,57 ab)', () => expect(checkoutWareFromInvoiceTotal(8.71, true)).toBe(3.15));
  test('doppeldeutig 15,04: App-Preis 12,19 → 11,47; App-Preis 9,79 → 9,48 (näher am App-Preis)', () => {
    expect(checkoutWareFromInvoiceTotal(15.04, true, 12.19)).toBe(11.47);
    expect(checkoutWareFromInvoiceTotal(15.04, true, 9.79)).toBe(9.48);
  });
});

describe('deriveCheckoutFactors', () => {
  const matches: Record<string, FactorMatch> = {
    'stele-97-JASMINE': { productId: 97, apiWare: 13.79, isChinaOrigin: false },
    'stele-220-SCHWARZ': { productId: 220, apiWare: 12.19, isChinaOrigin: true },
    'stele-5': { productId: 5, apiWare: 10.0, isChinaOrigin: false },
  };
  const match = (sku: string | null) => (sku ? matches[sku] ?? null : null);
  const order = (orderId: string, orderDate: string, sku: string, total: number, lines = 1): FactorOrder => ({
    orderId, orderDate, manualBuyPrice: total, lineItems: Array.from({ length: lines }, () => ({ sku, quantity: 1 })),
  });

  test('stele-97 Jasmine: Insgesamt 12,59 (EU), App 13,79 → Faktor 0,913 (bun: 0,91298…), Ware damit 12,59', () => {
    const { factors } = deriveCheckoutFactors([order('A', '2026-10-10T10:00:00Z', 'stele-97-JASMINE', 12.59)], match);
    expect(factors).toHaveLength(1);
    expect(factors[0].factor).toBe(0.913);
    expect(factors[0].checkoutWare).toBe(12.59);
    expect(applyCheckoutFactor(13.79, factors[0].factor)).toBe(12.59); // bun: 13,79 × 0,913 = 12,59027
  });

  test('stele-220 schwarz: Insgesamt 15,04 (China), App 12,19 → Ware 11,47, Faktor 0,9409 (bun: 0,940935…)', () => {
    const { factors } = deriveCheckoutFactors([order('B', '2026-10-12T10:00:00Z', 'stele-220-SCHWARZ', 15.04)], match);
    expect(factors[0].checkoutWare).toBe(11.47);
    expect(factors[0].factor).toBe(0.9409);
  });

  test('zwei Positionen → übersprungen', () => {
    const { factors, skipped } = deriveCheckoutFactors([order('C', '2026-10-12T10:00:00Z', 'stele-97-JASMINE', 25.18, 2)], match);
    expect(factors).toHaveLength(0);
    expect(skipped).toEqual([{ orderId: 'C', reason: 'mehrere Positionen oder Menge > 1' }]);
  });

  test('Kasse teurer als App (Faktor > 1) → 1,00', () => {
    const { factors } = deriveCheckoutFactors([order('D', '2026-10-12T10:00:00Z', 'stele-5', 10.5)], match);
    expect(factors[0].factor).toBe(1);
  });

  test('neuere Bestellung gewinnt (unabhängig von der Reihenfolge)', () => {
    const { factors } = deriveCheckoutFactors([
      order('NEU', '2026-10-12T10:00:00Z', 'stele-97-JASMINE', 12.59),
      order('ALT', '2026-10-01T10:00:00Z', 'stele-97-JASMINE', 13.0),
    ], match);
    expect(factors).toHaveLength(1);
    expect(factors[0].orderId).toBe('NEU');
    expect(factors[0].factor).toBe(0.913);
  });
});

describe('Prüfwerte des Inhabers (stele-220, Faktor 0,9508 = 11,59 ÷ 12,19)', () => {
  // EIN Faktor je Produkt, nicht je Variante: schwarz trifft die Kasse exakt (11,59), grau/blau landen bei 11,40/12,54
  // statt der vom Inhaber genannten Kassenpreise 11,39/12,49 (Abweichung 0,01 € bzw. 0,05 €). Festgehalten sind die ECHTEN Ergebnisse.
  test('schwarz 12,19 → 11,59', () => expect(applyCheckoutFactor(12.19, 0.9508)).toBe(11.59));
  test('grau 11,99 → 11,40 (nicht 11,39; bun: 11,400092)', () => expect(applyCheckoutFactor(11.99, 0.9508)).toBe(11.4));
  test('blau 13,19 → 12,54 (nicht 12,49; bun: 12,541052)', () => expect(applyCheckoutFactor(13.19, 0.9508)).toBe(12.54));
});

describe('Formel: checkoutFactor in computeMinSellPrice/profitAtSellPrice = Ware × Faktor', () => {
  const base = (buyPrice: number, isChinaOrigin: boolean, adRatePercent: number, targetMarginEur: number): PricingInput => ({
    buyPrice, isChinaOrigin, ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19, adRatePercent, targetMarginEur,
    safetyBufferEur: 0, rounding: 'floor95',
  });
  // [App-Ware, China, Anzeige %, Ziel, Faktor, Ware×Faktor, VK ohne Faktor, VK mit Faktor, Gewinn bei 19,95 ohne/mit] — alles bun.
  const cases: Array<[number, boolean, number, number, number, number, number, number, number, number]> = [
    [12.19, true, 5, 1.00, 0.9508, 11.59, 22.95, 21.95, -0.9151, -0.3151],
    [13.79, false, 5, 2.00, 0.913, 12.59, 20.95, 19.45, 1.0549, 2.2549],
    [9.50, true, 0, 1.50, 0.8, 7.60, 20.45, 17.95, 0.971925, 2.871925],
  ];
  for (const [ware, china, ad, target, f, wareF, vkOhne, vkMit, gOhne, gMit] of cases) {
    test(`Ware ${ware} × ${f}: VK ${vkOhne} → ${vkMit}`, () => {
      const mit = computeMinSellPrice({ ...base(ware, china, ad, target), checkoutFactor: f });
      const gleich = computeMinSellPrice(base(wareF, china, ad, target));
      expect(mit).toEqual(gleich);
      expect(computeMinSellPrice(base(ware, china, ad, target)).minSellPrice).toBe(vkOhne);
      expect(mit.minSellPrice).toBe(vkMit);
      const pIn = { sellPrice: 19.95, isChinaOrigin: china, ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19, adRatePercent: ad };
      const pMit = profitAtSellPrice({ ...pIn, buyPrice: ware, checkoutFactor: f });
      expect(pMit).toBe(profitAtSellPrice({ ...pIn, buyPrice: wareF }));
      expect(profitAtSellPrice({ ...pIn, buyPrice: ware })).toBeCloseTo(gOhne, 6);
      expect(pMit).toBeCloseTo(gMit, 6);
    });
  }
  test('ohne Faktor (null/weggelassen) identisch', () => {
    expect(computeMinSellPrice({ ...base(12.19, true, 5, 1), checkoutFactor: null })).toEqual(computeMinSellPrice(base(12.19, true, 5, 1)));
  });
  test('evaluatePriceAlarm reicht den Faktor durch (19,95 €, Ziel 1,00: −0,92 → Alarm; mit 0,9508: bun −0,3151 → Alarm; mit 0,6: Ware 7,31 → Gewinn bun 1,9749 → kein Alarm)', () => {
    const a = { currentSellPrice: 19.95, variants: [{ buyPrice: 12.19 }], isChinaOrigin: true, ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19, adRatePercent: 5, targetMarginEur: 1.00 };
    expect(evaluatePriceAlarm(a).isAlarm).toBe(true);
    expect(evaluatePriceAlarm({ ...a, checkoutFactor: 0.9508 }).worstProfit).toBeCloseTo(-0.3151, 6);
    const r = evaluatePriceAlarm({ ...a, checkoutFactor: 0.6 });
    expect(r.worstProfit).toBeCloseTo(1.9749, 6);
    expect(r.isAlarm).toBe(false);
  });
});

describe('order-matching: automatischer Zweig nutzt den Faktor', () => {
  // stele-220 Einzelartikel, App-Ware 12,19, China, Anzeige 5 %, Bestellung 24,95 €.
  // ohne Faktor: K = 12,19 + 3,57 = 15,76 → Gewinn 2,89; mit 0,9508 (heute): Ware 11,59, K = 15,16 → Gewinn 3,49 (bun: 3,4949).
  const product = (factor: number | null, at: string | null) => ({
    id: 220, buyPrice: 12.19, shipsFrom: 'China', adRate: 5, aliCheckoutFactor: factor, aliCheckoutFactorAt: at,
  });
  const run = (p: ReturnType<typeof product>) => computeOrderNettoErgebnis({
    orderTotal: 24.95, lineItems: [{ sku: 'stele-220', quantity: 1 }], manualBuyPrice: null, findProduct: () => p,
  });
  test('ohne Faktor: Einkauf 15,76, Gewinn 2,89', () => {
    const r = run(product(null, null));
    expect(r.nettoEinkauf).toBeCloseTo(15.76, 9);
    expect(r.nettoErgebnis).toBe(2.89);
  });
  test('mit Faktor 0,9508 von heute: Einkauf 15,16, Gewinn 3,49', () => {
    const r = run(product(0.9508, new Date().toISOString()));
    expect(r.nettoEinkauf).toBeCloseTo(15.16, 9);
    expect(r.nettoErgebnis).toBe(3.49);
    expect(r.nettoQuelle).toBe('automatisch');
  });
  test('Faktor älter als 14 Tage → wie ohne Faktor', () => {
    expect(run(product(0.9508, new Date(Date.now() - 15 * DAY).toISOString())).nettoErgebnis).toBe(2.89);
  });
});

describe('Faktor-Abgleich (planCheckoutFactorSync): nur schreiben, wenn die Bestellung neuer ist', () => {
  const prod = (at: string | null): FactorSyncProduct => ({
    id: 220, asin: null, buyPrice: 12.19, shipsFrom: 'China', adRate: 5, variantPrices: null, variants: null, aliCheckoutFactorAt: at,
  });
  const orders = [{ orderId: '15-15284-69835', orderDate: '2026-10-12T10:00:00.000Z', lineItems: [{ sku: 'stele-220', quantity: 1 }] }];
  const notes = [{ ebayOrderId: '15-15284-69835', manualBuyPrice: 15.04 }, { ebayOrderId: 'UNBEKANNT', manualBuyPrice: 9.99 }];
  test('kein gespeicherter Stand → schreiben (Faktor 0,9409, Datum = Bestelldatum, Bestellnummer)', () => {
    const r = planCheckoutFactorSync(notes, orders, [prod(null)]);
    expect(r.writes).toEqual([expect.objectContaining({ productId: 220, factor: 0.9409, at: '2026-10-12T10:00:00.000Z', orderId: '15-15284-69835' })]);
    expect(r.übersprungen.map(s => s.orderId)).toEqual(['UNBEKANNT']);
  });
  test('gespeicherter Stand aus ANDERER, gleich alter oder neuerer Bestellung → nicht schreiben', () => {
    expect(planCheckoutFactorSync(notes, orders, [prod('2026-10-12T10:00:00.000Z')]).writes).toHaveLength(0);
    expect(planCheckoutFactorSync(notes, orders, [prod('2026-10-13T10:00:00.000Z')]).writes).toHaveLength(0);
  });
  // Gegenprüfung B1 (14.10.2026): Tippfehler 13,04 statt 15,04 bei DERSELBEN Bestellung — Korrektur muss den Faktor neu schreiben.
  // 13,04 − 3,57 = 9,47 < 10 → − 1,99 = 7,48; 7,48 ÷ 12,19 = 0,6136 (mit bun nachgerechnet).
  const same = (factor: number | null, at: string | null): FactorSyncProduct => ({ ...prod(at), aliCheckoutFactor: factor, aliCheckoutFactorOrder: '15-15284-69835' });
  test('B1: gleiche Bestellung, Betrag korrigiert (gespeichert 0,6136) → neu schreiben 0,9409', () => {
    const r = planCheckoutFactorSync(notes, orders, [same(0.6136, '2026-10-12T10:00:00.000Z')]);
    expect(r.writes).toEqual([expect.objectContaining({ productId: 220, factor: 0.9409 })]);
    expect(r.clears).toEqual([]);
  });
  test('B1: gleiche Bestellung, gleicher Faktor → nichts schreiben', () => {
    const r = planCheckoutFactorSync(notes, orders, [same(0.9409, '2026-10-12T10:00:00.000Z')]);
    expect(r.writes).toEqual([]);
    expect(r.clears).toEqual([]);
  });
  test('B1: Rechnungsbetrag der Quell-Bestellung gelöscht → Faktor auf null', () => {
    const r = planCheckoutFactorSync([{ ebayOrderId: '15-15284-69835', manualBuyPrice: null }], orders, [same(0.6136, '2026-10-12T10:00:00.000Z')]);
    expect(r.writes).toEqual([]);
    expect(r.clears).toEqual([220]);
  });
  test('B1: Betrag jetzt unplausibel (5,00 → Faktor < 0,5) → Faktor auf null', () => {
    const r = planCheckoutFactorSync([{ ebayOrderId: '15-15284-69835', manualBuyPrice: 5 }], orders, [same(0.9409, '2026-10-12T10:00:00.000Z')]);
    expect(r.clears).toEqual([220]);
  });
  test('Quell-Bestellung nur nicht mehr von eBay geliefert (> 90 Tage) → Stand bleibt', () => {
    const r = planCheckoutFactorSync(notes, [], [same(0.9409, '2026-07-01T10:00:00.000Z')]);
    expect(r.writes).toEqual([]);
    expect(r.clears).toEqual([]);
  });
  test('älterer gespeicherter Stand → schreiben', () => {
    expect(planCheckoutFactorSync(notes, orders, [prod('2026-10-01T10:00:00.000Z')]).writes).toHaveLength(1);
  });
});
