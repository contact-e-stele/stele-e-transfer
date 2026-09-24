// PRIO-1-PAKET (2026-09-24): Tests für computeOrderNettoErgebnis() (Punkte "A9"/"ERGEBNIS"/"ZOLL")
// und die Zoll-Einstellung (Punkt "ZOLL").
import { describe, expect, test } from 'bun:test';
import { computeOrderNettoErgebnis, parseOrderChinaZollEur, DEFAULT_ORDER_CHINA_ZOLL_EUR } from './order-matching';

describe('parseOrderChinaZollEur — Punkt "ZOLL": Zollpauschale als Einstellung, Standard 3,58', () => {
  // Auftragspunkt 7 (Testfall): "fehlende Einstellung ergibt Zoll 3.58".
  test('fehlende/leere Einstellung ergibt den Standard 3,58', () => {
    expect(parseOrderChinaZollEur(null)).toBe(3.58);
    expect(parseOrderChinaZollEur(undefined)).toBe(3.58);
    expect(parseOrderChinaZollEur('')).toBe(3.58);
    expect(parseOrderChinaZollEur('   ')).toBe(3.58);
    expect(DEFAULT_ORDER_CHINA_ZOLL_EUR).toBe(3.58);
  });

  test('gültiger gespeicherter Wert wird übernommen, auch 0 (Minimum)', () => {
    expect(parseOrderChinaZollEur('3.57')).toBe(3.57);
    expect(parseOrderChinaZollEur('0')).toBe(0);
  });

  test('ungültiger/negativer Wert fällt auf den Standard zurück', () => {
    expect(parseOrderChinaZollEur('abc')).toBe(3.58);
    expect(parseOrderChinaZollEur('-1')).toBe(3.58);
  });
});

describe('computeOrderNettoErgebnis — Punkte "A9"/"ERGEBNIS": eine Rechenstelle für beide Zweige', () => {
  test('manueller Zweig: nutzt computeOrderProfit() (inkl. eBay-Gebühren), nicht die Rohdifferenz', () => {
    const result = computeOrderNettoErgebnis({
      orderTotal: 17.95,
      lineItems: [{ sku: 'x', quantity: 1 }],
      manualBuyPrice: 11.56,
      findProduct: () => null, // manueller Zweig braucht findProduct nicht
      zollEur: 3.58,
    });
    expect(result.nettoQuelle).toBe('manuell');
    expect(result.nettoEinkauf).toBe(11.56);
    expect(Math.abs((result.nettoErgebnis ?? 0) - 1.76)).toBeLessThanOrEqual(0.01);
    expect(result.nettoGebuehren).not.toBeNull();
  });

  test('automatischer Zweig: Zoll wird nur bei China-Versand addiert, aus der übergebenen Einstellung', () => {
    const result = computeOrderNettoErgebnis({
      orderTotal: 20,
      lineItems: [{ sku: 'a', quantity: 1 }],
      manualBuyPrice: null,
      findProduct: () => ({ buyPrice: 5, shipsFrom: 'China' }),
      zollEur: 3.58,
    });
    expect(result.nettoQuelle).toBe('automatisch');
    expect(result.nettoEinkauf).toBe(5 + 3.58); // Einkauf + Zoll, keine Zoll-Verdopplung
  });

  test('kein Zoll bei nicht-China-Versand', () => {
    const result = computeOrderNettoErgebnis({
      orderTotal: 20,
      lineItems: [{ sku: 'a', quantity: 1 }],
      manualBuyPrice: null,
      findProduct: () => ({ buyPrice: 5, shipsFrom: 'DE' }),
      zollEur: 3.58,
    });
    expect(result.nettoEinkauf).toBe(5);
  });

  test('unbekannter Einkauf (kein Produkt-Match) ergibt null statt einer geratenen Zahl', () => {
    const result = computeOrderNettoErgebnis({
      orderTotal: 20,
      lineItems: [{ sku: 'unbekannt', quantity: 1 }],
      manualBuyPrice: null,
      findProduct: () => null,
      zollEur: 3.58,
    });
    expect(result.nettoEinkauf).toBeNull();
    expect(result.nettoErgebnis).toBeNull();
    expect(result.nettoQuelle).toBeNull();
  });
});

// Auftragspunkt 7 (Testfall): "die heutigen 15 Bestellungen ergeben in Summe 52,54 statt 111,32".
//
// Grundgesetz Regel 3 (keine Zahl raten): live gegen die echte Produktions-DB + eBay GetOrders
// nachgerechnet am 2026-09-24T17:06 (scripts/prio1-gewinn-dryrun.ts) ergab zu diesem Zeitpunkt ALT
// 105,81 € / NEU 51,23 € — abweichend von den im Auftrag genannten 111,32 €/52,54 €. Die Zahlen im
// Auftrag stammen aus einer früheren Live-Messung (ebenfalls 24.09.2026); price-monitor.ts läuft
// alle 8h automatisch und aktualisiert buyPrice — zwischen den beiden Messungen liegt mindestens
// ein weiterer Cron-Lauf, das erklärt die Differenz (s. PR-Beschreibung, Abschnitt "Abweichung").
// Diese Fixture ist der ECHTE, zum Zeitpunkt des Trockenlaufs eingefrorene Datenstand (17 reale
// Bestellungen, Order-IDs/Beträge/SKUs/buyPrice/shipsFrom 1:1 aus der Live-DB) — keine erfundenen
// Werte (Grundgesetz Regel 4).
describe('computeOrderNettoErgebnis — Regressionsbeweis mit echten Live-Bestelldaten (2026-09-24)', () => {
  const buyPriceBySku: Record<string, { buyPrice: number | null; shipsFrom: string | null }> = {
    'stele-123-50PCS-13-38CM': { buyPrice: 2.05, shipsFrom: 'China' },
    'stele-119-100PCS': { buyPrice: 3.25, shipsFrom: 'China' },
    'stele-119-200PCS': { buyPrice: 3.25, shipsFrom: 'China' },
    'stele-98-WHITE-1PCS': { buyPrice: null, shipsFrom: null },
    'stele-127-MULTICOLOUR-100PCS': { buyPrice: 2.49, shipsFrom: 'China' },
    'stele-127-MULTICOLOUR-500PCS': { buyPrice: 2.49, shipsFrom: 'China' },
    'stele-93-ESSENTIAL-OILS-SET-5ML-X-15PCS': { buyPrice: null, shipsFrom: null },
    'stele-71-2PCS-33X40CM': { buyPrice: 1, shipsFrom: 'China' },
    'stele-71-6PCS-50X40CM': { buyPrice: 1, shipsFrom: 'China' },
  };
  const findProduct = (sku: string | null) => sku != null ? (buyPriceBySku[sku] ?? null) : null;

  const orders: Array<{ orderId: string; total: number; manualBuyPrice: number | null; sku: string }> = [
    { orderId: '09-15210-97703', total: 17.95, manualBuyPrice: 11.56, sku: 'stele-123-50PCS-13-38CM' },
    { orderId: '26-15134-85187', total: 13.95, manualBuyPrice: 7.96, sku: 'stele-119-100PCS' },
    { orderId: '20-15127-76586', total: 14.95, manualBuyPrice: null, sku: 'stele-119-200PCS' },
    { orderId: '02-15151-11415', total: 4.99, manualBuyPrice: null, sku: 'stele-98-WHITE-1PCS' },
    { orderId: '10-15108-86230', total: 14.95, manualBuyPrice: null, sku: 'stele-127-MULTICOLOUR-100PCS' },
    { orderId: '02-15114-51502', total: 14.95, manualBuyPrice: null, sku: 'stele-127-MULTICOLOUR-100PCS' },
    { orderId: '24-15076-13627', total: 8.95, manualBuyPrice: 13.86, sku: 'stele-127-MULTICOLOUR-500PCS' },
    { orderId: '13-15069-00183', total: 12.95, manualBuyPrice: null, sku: 'stele-93-ESSENTIAL-OILS-SET-5ML-X-15PCS' },
    { orderId: '05-15078-66637', total: 14.49, manualBuyPrice: null, sku: 'stele-119-100PCS' },
    { orderId: '26-15037-39927', total: 14.49, manualBuyPrice: null, sku: 'stele-119-100PCS' },
    { orderId: '07-15070-97464', total: 14.95, manualBuyPrice: 2.45, sku: 'stele-127-MULTICOLOUR-100PCS' },
    { orderId: '25-15027-66809', total: 14.49, manualBuyPrice: null, sku: 'stele-119-100PCS' },
    { orderId: '10-15051-70754', total: 15.44, manualBuyPrice: null, sku: 'stele-119-200PCS' },
    { orderId: '09-15052-35592', total: 15.44, manualBuyPrice: null, sku: 'stele-119-200PCS' },
    { orderId: '12-15018-06429', total: 15.44, manualBuyPrice: null, sku: 'stele-119-200PCS' },
    { orderId: '27-14918-13809', total: 12.95, manualBuyPrice: null, sku: 'stele-71-2PCS-33X40CM' },
    { orderId: '15-14878-63954', total: 20.94, manualBuyPrice: 13.96, sku: 'stele-71-6PCS-50X40CM' },
  ];

  test('17 reale Bestellungen, 15 mit bekanntem Einkauf: Summe 51,23 € (neu, inkl. eBay-Geb.) statt 105,81 € (alt, Rohdifferenz)', () => {
    const results = orders.map(o => computeOrderNettoErgebnis({
      orderTotal: o.total,
      lineItems: [{ sku: o.sku, quantity: 1 }],
      manualBuyPrice: o.manualBuyPrice,
      findProduct,
      zollEur: 3.58,
    }));

    const bekannt = results.filter(r => r.nettoErgebnis != null);
    expect(bekannt.length).toBe(15);

    const neuSumme = Math.round(bekannt.reduce((a, r) => a + (r.nettoErgebnis ?? 0), 0) * 100) / 100;
    expect(neuSumme).toBe(51.23);

    // ALT (vor diesem PR): Rohdifferenz ohne eBay-Gebühren, Zoll 4,00€ — zum Vergleich, exakt die
    // bisherige index.ts-Formel, hier separat nachgerechnet (nicht Teil der neuen Funktion).
    const altSumme = Math.round(orders.reduce((a, o) => {
      if (o.manualBuyPrice != null) return a + (o.total - o.manualBuyPrice);
      const p = findProduct(o.sku);
      if (!p || p.buyPrice === null) return a;
      const zoll = p.shipsFrom === 'China' ? 4.00 : 0;
      return a + (o.total - (p.buyPrice + zoll));
    }, 0) * 100) / 100;
    expect(altSumme).toBe(105.81);

    // Der neue Gewinn liegt (durch die eBay-Gebühren) deutlich unter der alten Rohdifferenz.
    expect(neuSumme).toBeLessThan(altSumme);
  });
});
