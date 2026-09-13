// Teil 3B (2026-09-13): Tests für die Verkaufs-Aggregation je Varianten-SKU. Diese Zahlen
// entscheiden darüber, ob Preise gesenkt werden — sie müssen belegbar stimmen, nicht plausibel
// aussehen. eBay ist aus der Sandbox nicht erreichbar, deshalb ist die Aggregation eine reine
// Funktion, die hier mit synthetischen (klar als solche gekennzeichneten) Bestellungen geprüft wird.
import { describe, expect, test } from 'bun:test';

process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'file:/tmp/variant-sales-test.db';
const { aggregateVariantSales } = await import('./variant-sales');
const { buildVariantSku } = await import('./price-monitor');

const NOW = Date.parse('2026-09-13T00:00:00Z');
const tageHer = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

// Produkt 110 nachgebaut mit den realen Varianten-Einkaufspreisen aus Teil 1.
const produkt110 = {
  id: 110, asin: 'ali_110', buyPrice: 7.69, shippingCost: 0, shipsFrom: 'China', adRate: 5,
  variants: [
    { skuId: 'v1', attrs: { Farbe: 'Rot' }, buyPrice: 7.69 },
    { skuId: 'v2', attrs: { Farbe: 'Blau' }, buyPrice: 4.99 },
    { skuId: 'v3', attrs: { Farbe: 'Gruen' }, buyPrice: 4.19 },
  ],
};
const skuRot = buildVariantSku(110, { Farbe: 'Rot' });
const skuBlau = buildVariantSku(110, { Farbe: 'Blau' });

function run(orders: Parameters<typeof aggregateVariantSales>[0]['orders'], manual = new Map<string, number | null>()) {
  return aggregateVariantSales({ orders, products: [produkt110], manualBuyPriceByOrderId: manual, now: NOW });
}

describe('aggregateVariantSales — Verkäufe je Varianten-SKU', () => {
  test('ordnet Positionen der richtigen Variante zu und zählt Mengen', () => {
    const r = run([
      { orderId: 'o1', orderDate: tageHer(10), lineItems: [{ sku: skuRot, title: 'Rot', quantity: 2, lineItemCost: 39.90 }] },
      { orderId: 'o2', orderDate: tageHer(20), lineItems: [{ sku: skuBlau, title: 'Blau', quantity: 1, lineItemCost: 19.95 }] },
    ]);
    expect(r.salesBySku.get('110::v1')!.unitsTotal).toBe(2);
    expect(r.salesBySku.get('110::v2')!.unitsTotal).toBe(1);
    expect(r.salesBySku.get('110::v1')!.revenueTotal).toBeCloseTo(39.90, 2);
    expect(r.lineItemsMatched).toBe(2);
    expect(r.unmatched).toEqual([]);
  });

  test('trennt die letzten 90 Tage vom Gesamtzeitraum', () => {
    const r = run([
      { orderId: 'neu', orderDate: tageHer(30), lineItems: [{ sku: skuRot, title: 'Rot', quantity: 1, lineItemCost: 19.95 }] },
      { orderId: 'alt', orderDate: tageHer(200), lineItems: [{ sku: skuRot, title: 'Rot', quantity: 3, lineItemCost: 59.85 }] },
    ]);
    const agg = r.salesBySku.get('110::v1')!;
    expect(agg.unitsTotal).toBe(4); // alles was vorliegt
    expect(agg.units90d).toBe(1);   // nur die letzten 90 Tage
  });

  test('Varianten ohne Bestellung tauchen gar nicht erst in der Aggregation auf (der Bericht ergänzt sie als "ohne Verkauf")', () => {
    const r = run([{ orderId: 'o1', orderDate: tageHer(5), lineItems: [{ sku: skuRot, title: 'Rot', quantity: 1, lineItemCost: 19.95 }] }]);
    expect(r.salesBySku.has('110::v1')).toBe(true);
    expect(r.salesBySku.has('110::v3')).toBe(false);
  });

  test('Gewinn je Verkauf wird nach der zentralen Gebührenformel gerechnet', () => {
    const r = run([{ orderId: 'o1', orderDate: tageHer(5), lineItems: [{ sku: skuRot, title: 'Rot', quantity: 1, lineItemCost: 19.95 }] }]);
    // EK 7,69 + Zoll 4,00 + Versand 0 = 11,69; Gebühr = 19,95 × 20% × 1,19 + 0,30 × 1,19 = 5,1051
    // Gewinn = 19,95 − 11,69 − 5,1051 = 3,1549
    expect(r.salesBySku.get('110::v1')!.profitPerSale[0]).toBeCloseTo(3.1549, 3);
  });

  // Regressionsschutz fuer einen Fehler, der beim ersten echten Lauf des Berichts auffiel: die
  // Aggregation nahm den PRODUKT-EK statt des EK der jeweiligen Variante. Bei stele-110 liegen die
  // Varianten-EKs zwischen 2,15 und 7,69 EUR — der Gewinn je Verkauf waere damit fuer fast jede
  // Variante falsch gewesen.
  test('nutzt den EK DER VARIANTE, nicht den Produkt-EK', () => {
    const r = run([
      { orderId: 'oRot', orderDate: tageHer(5), lineItems: [{ sku: skuRot, title: 'Rot', quantity: 1, lineItemCost: 19.95 }] },
      { orderId: 'oBlau', orderDate: tageHer(5), lineItems: [{ sku: skuBlau, title: 'Blau', quantity: 1, lineItemCost: 19.95 }] },
    ]);
    // Rot: EK 7,69 + 4,00 Zoll → 19,95 − 11,69 − 5,1051 = 3,1549
    expect(r.salesBySku.get('110::v1')!.profitPerSale[0]).toBeCloseTo(3.1549, 3);
    // Blau: EK 4,99 + 4,00 Zoll → 19,95 − 8,99 − 5,1051 = 5,8549 (mit Produkt-EK waeren es faelschlich 3,1549)
    expect(r.salesBySku.get('110::v2')!.profitPerSale[0]).toBeCloseTo(5.8549, 3);
  });

  test('P-49-Altbestand: fehlender Einkaufspreis ergibt "nicht berechenbar", NICHT 0', () => {
    const ohneEk = { ...produkt110, buyPrice: null, variants: produkt110.variants.map(v => ({ ...v, buyPrice: 0 })) };
    const r = aggregateVariantSales({
      orders: [{ orderId: 'o1', orderDate: tageHer(5), lineItems: [{ sku: skuRot, title: 'Rot', quantity: 2, lineItemCost: 39.90 }] }],
      products: [ohneEk], manualBuyPriceByOrderId: new Map(), now: NOW,
    });
    const agg = r.salesBySku.get('110::v1')!;
    expect(agg.notCalculable).toBe(2);
    expect(agg.profitPerSale).toEqual([]); // keine 0-Werte untergeschoben
    expect(agg.unitsTotal).toBe(2);        // der Verkauf selbst zählt trotzdem
  });

  test('manueller Einkaufspreis hat Vorrang — aber nur bei Bestellungen mit genau einer Position', () => {
    const einePos = run(
      [{ orderId: 'o1', orderDate: tageHer(5), lineItems: [{ sku: skuRot, title: 'Rot', quantity: 1, lineItemCost: 19.95 }] }],
      new Map([['o1', 5.00]]),
    );
    // EK 5,00 (manuell) + 4,00 Zoll = 9,00 → Gewinn = 19,95 − 9,00 − 5,1051 = 5,8449
    expect(einePos.salesBySku.get('110::v1')!.profitPerSale[0]).toBeCloseTo(5.8449, 3);

    // Mehrere Positionen: der manuelle Gesamt-EK ist keiner einzelnen Position zuzuordnen →
    // Rückfall auf den Produkt-EK statt einer willkürlichen Aufteilung.
    const mehrPos = run(
      [{ orderId: 'o2', orderDate: tageHer(5), lineItems: [
        { sku: skuRot, title: 'Rot', quantity: 1, lineItemCost: 19.95 },
        { sku: skuBlau, title: 'Blau', quantity: 1, lineItemCost: 19.95 },
      ] }],
      new Map([['o2', 5.00]]),
    );
    expect(mehrPos.salesBySku.get('110::v1')!.profitPerSale[0]).toBeCloseTo(3.1549, 3);
  });

  test('fehlender Positionsbetrag: Umsatz wird als unvollständig markiert, Gewinn nicht berechenbar', () => {
    const r = run([{ orderId: 'o1', orderDate: tageHer(5), lineItems: [{ sku: skuRot, title: 'Rot', quantity: 1, lineItemCost: null }] }]);
    const agg = r.salesBySku.get('110::v1')!;
    expect(agg.revenueKnown).toBe(false);
    expect(agg.notCalculable).toBe(1);
    expect(agg.unitsTotal).toBe(1);
  });
});

describe('aggregateVariantSales — Abgleich: keine Position verschwindet stillschweigend (#5)', () => {
  test('jede nicht zuordenbare Position wird mit Grund ausgewiesen, und die Summe geht auf', () => {
    const r = run([
      { orderId: 'o1', orderDate: tageHer(5), lineItems: [
        { sku: skuRot, title: 'Rot', quantity: 1, lineItemCost: 19.95 },          // zugeordnet
        { sku: null, title: 'Ohne SKU', quantity: 1, lineItemCost: 9.95 },        // keine_sku_an_position
        { sku: 'stele-999-ROT', title: 'Fremd', quantity: 1, lineItemCost: 9.95 },// produkt_nicht_gefunden
        { sku: 'stele-110-PINK', title: 'Pink', quantity: 1, lineItemCost: 9.95 },// variante_nicht_zuordenbar
      ] },
    ]);
    expect(r.lineItemsTotal).toBe(4);
    expect(r.lineItemsMatched).toBe(1);
    expect(r.unmatched.map(u => u.reason).sort()).toEqual(
      ['keine_sku_an_position', 'produkt_nicht_gefunden', 'variante_nicht_zuordenbar']
    );
    // Der Abgleich, den der Bericht ausweist: zugeordnet + nicht zugeordnet == gesamt
    expect(r.lineItemsMatched + r.unmatched.length).toBe(r.lineItemsTotal);
  });

  test('Produkt ohne Varianten wird als eigener Grund ausgewiesen, nicht als "nicht gefunden"', () => {
    const einzelprodukt = { ...produkt110, id: 200, variants: [{ skuId: 'v1', attrs: { Farbe: 'Rot' }, buyPrice: 7.69 }] };
    const r = aggregateVariantSales({
      orders: [{ orderId: 'o1', orderDate: tageHer(5), lineItems: [{ sku: 'stele-200-ROT', title: 'Einzel', quantity: 1, lineItemCost: 19.95 }] }],
      products: [einzelprodukt], manualBuyPriceByOrderId: new Map(), now: NOW,
    });
    expect(r.unmatched[0].reason).toBe('produkt_ohne_varianten');
    expect(r.lineItemsMatched).toBe(0);
  });
});
