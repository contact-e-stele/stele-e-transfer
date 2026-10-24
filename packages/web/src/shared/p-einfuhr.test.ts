import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ALI_EINFUHR_EUR, ALI_EINFUHR_ALT_EUR, aliEinfuhrEur, setAliEinfuhrEur } from './constants';
import { computeAliCosts } from './pricing';
import { checkoutWareFromInvoiceTotal, deriveCheckoutFactors, einfuhrForOrderDate } from './checkout-factor';
import { planVariantRaises } from '../api/variant-raise';

// P-EINFUHR (Inhaber 24.10.2026, PRIO 1). Betriebswert 5,95 = Zoll 3,57 + EU-Bearbeitungsgebühr 2,38.
// Belege: 06-15341-26458 (stele-127 Multicolour 100pcs: Ware 3,49 + Versand 1,99 + Einfuhr 5,95 = Kasse 11,43), 18-15318-09330.
// Der Test-Preload setzt für die alten Beleg-Beispiele 3,57; hier wird ausdrücklich der Betriebswert geprüft.
beforeEach(() => setAliEinfuhrEur(ALI_EINFUHR_EUR));
afterEach(() => setAliEinfuhrEur(ALI_EINFUHR_ALT_EUR));

describe('P-EINFUHR: Einfuhr 5,95 im Betrieb', () => {
  test('Standardwert ist 5,95, alter Beleg-Wert 3,57', () => {
    expect(ALI_EINFUHR_EUR).toBe(5.95);
    expect(aliEinfuhrEur()).toBe(5.95);
  });

  test('Kasse 06-15341-26458 nachgebildet: 3,49 + 1,99 + 5,95 = 11,43', () => {
    expect(computeAliCosts(3.49, true).totalCost).toBeCloseTo(11.43, 10);
    expect(computeAliCosts(3.49, false).totalCost).toBeCloseTo(3.49, 10); // EU-Lager: keine Einfuhr, kein Versand
  });

  test('unplausibler Wert wird abgelehnt', () => {
    expect(() => setAliEinfuhrEur(-1)).toThrow();
    expect(() => setAliEinfuhrEur(Number.NaN)).toThrow();
  });
});

describe('P-EINFUHR: Kassen-Faktor nach Bestelltag', () => {
  test('bis 20.10. 3,57 · ab 23.10. 5,95 · 21.–22.10. unbelegt', () => {
    expect(einfuhrForOrderDate('2026-10-20T23:00:00Z')).toBe(3.57);
    expect(einfuhrForOrderDate('2026-10-21T08:00:00Z')).toBeNull();
    expect(einfuhrForOrderDate('2026-10-22T08:00:00Z')).toBeNull();
    expect(einfuhrForOrderDate('2026-10-24T08:00:00Z')).toBe(5.95);
  });

  test('Rechnung 11,43 (24.10.) ergibt Ware 3,49, mit dem alten Wert wären es falsch 5,87', () => {
    expect(checkoutWareFromInvoiceTotal(11.43, true, 3.49, 5.95)).toBe(3.49);
    expect(checkoutWareFromInvoiceTotal(11.43, true, 3.49, 3.57)).toBe(5.87);
  });

  test('Bestellung am 21.10. wird übersprungen statt geraten', () => {
    const r = deriveCheckoutFactors(
      [{ orderId: 'X', orderDate: '2026-10-21T10:00:00Z', lineItems: [{ sku: 's', quantity: 1 }], manualBuyPrice: 11.43 }],
      () => ({ productId: 127, apiWare: 3.49, isChinaOrigin: true }),
    );
    expect(r.factors).toHaveLength(0);
    expect(r.skipped[0].reason).toContain('unbelegt');
  });
});

// stele-127 live (App + eBay gelesen 24.10.2026): VK 13,95 / 12,95 / 20,95 / 20,95, Anzeige 5 %, Stufe A (Boden 1,00), Faktor 1.
const p127 = {
  id: 127, title: 'Haarnetze', sellPrice: 24.95, buyPrice: 2.59, adRate: 5, shipsFrom: 'China', targetMarginEur: 1,
  aliCheckoutFactor: 1, aliCheckoutFactorAt: '2026-10-01T00:00:00Z', ebayStatus: 'listed', ebayListingId: '198601075438',
  variants: JSON.stringify([{ name: 'Varianten ', values: ['Multicolour 100pcs', 'Multicolour 50pcs', 'White 500pcs', 'Multicolour 500pcs'] }]),
  variantPrices: JSON.stringify([
    { skuId: '12000058063615237', attrs: { Color: 'Multicolour 100pcs' }, price: 3.49, stock: 14 },
    { skuId: '12000058063615236', attrs: { Color: 'Multicolour 50pcs' }, price: 2.59, stock: 5 },
    { skuId: '12000058063615239', attrs: { Color: 'White 500pcs' }, price: 10.79, stock: 3 },
    { skuId: '12000058063615238', attrs: { Color: 'Multicolour 500pcs' }, price: 11.19, stock: 8 },
  ]),
  variantSellPrices: JSON.stringify({ '12000058063615237': 13.95, '12000058063615236': 12.95, '12000058063615239': 20.95, '12000058063615238': 20.95 }),
};

describe('P-EINFUHR: Varianten-Anhebung stele-127 (raise-only)', () => {
  test('mit 5,95 werden alle 4 Varianten angehoben (alle im Verlust)', () => {
    const r = planVariantRaises(p127 as never).map(x => [x.label, x.oldSell, x.newSell]);
    expect(r).toEqual([
      ['Multicolour 100pcs', 13.95, 16.95],
      ['Multicolour 50pcs', 12.95, 15.95],
      ['White 500pcs', 20.95, 23.95],
      ['Multicolour 500pcs', 20.95, 24.45],
    ]);
  });
  test('Gewinn nach Anhebung je Variante ≥ 1,00 (Boden Stufe A)', () => {
    for (const x of planVariantRaises(p127 as never)) expect(x.newProfit).toBeGreaterThanOrEqual(1.00);
    expect(planVariantRaises(p127 as never)[0].oldProfit).toBeCloseTo(-1.1571, 4); // Befund Nachrichten: −1,17 (gerundet anders)
  });
  test('mit dem alten Wert 3,57 hätte die App nur eine Variante angehoben (darum griff nichts)', () => {
    setAliEinfuhrEur(ALI_EINFUHR_ALT_EUR);
    expect(planVariantRaises(p127 as never).map(x => x.label)).toEqual(['Multicolour 500pcs']);
  });
});
