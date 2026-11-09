// AUFSICHT 045 Teil A (09.11.2026, gestaffelte eBay-Fixgebühr 0,35/0,45 statt 0,30): Erwartungswerte in dieser Datei mit bun neu gerechnet.
// Zahlen in Testnamen/Kommentaren können noch den Stand mit 0,30 zeigen — maßgeblich sind die expect-Werte. Liste alt → neu: docs/fixgebuehr-testaenderungen.md
// K-009 (Kalkulator 15.10.2026): Anzeige 0 % wählbar; stele-220 ist seit 14.10. 21:12 bei eBay unbeworben, die App stand auf 5 %.
// Alle Erwartungswerte mit bun nachgerechnet (Grundgesetz 3).
import { describe, expect, test } from 'bun:test';
import { adRateOptions, adRateLabel, AD_RATE_OPTIONS } from './ad-rate-options';
import { computeOrderNettoErgebnis } from '../api/order-matching';
import { planVariantRaises } from '../api/variant-raise';

describe('K-009 Auswahl Anzeigensatz', () => {
  test('"0 % (aus)" ist die erste Option', () => {
    expect(AD_RATE_OPTIONS[0]).toBe(0);
    expect(adRateLabel(0)).toBe('0 % (aus)');
  });
  test('null wird als "—" gezeigt, nicht als 5 %', () => {
    expect(adRateLabel(null)).toBe('—');
    expect(adRateOptions(null)).toEqual([0, 2, 3, 5]);
  });
  test('gespeicherter Sonderwert bleibt sichtbar (4 % → eigene Option)', () => {
    expect(adRateOptions(4)).toEqual([0, 2, 3, 4, 5]);
    expect(adRateOptions(5)).toEqual([0, 2, 3, 5]);
    // Gesetz 72 (03.11.2026): 8 % / 10 % nicht mehr wählbar
    expect(adRateOptions(5)).not.toContain(8);
    expect(adRateOptions(5)).not.toContain(10);
  });
});

describe('K-009 Wirkung adRate 0 (stele-220)', () => {
  const order = (adRate: number) => computeOrderNettoErgebnis({
    orderTotal: 20.95, lineItems: [{ sku: 'stele-220-BLACK', quantity: 1 }], manualBuyPrice: 15.14,
    findProduct: () => ({ id: 220, buyPrice: 12.19, shipsFrom: 'China', adRate, variants: [] }),
    // PLAN 7 Punkt 9: reale Bestellung, gemeldet am 15.10.2026 → Bestelltag spätestens 15.10., vor STANDORT_FORMEL_AB (S = 1).
    orderDate: '2026-10-15',
  });
  // AUFSICHT 045 Teil A (09.11.2026): die echte eBay-Gebühr dieser Bestellung war 4,10 = 20,95 × 0,1785 + 0,357 (Fix 0,30, Beleg
  // pricing.ts). Mit der Staffel (Fix 0,45 × 1,19 = 0,5355) rechnet die App für diese ALTE Bestellung 4,28 — kein Stichtag (Auftrag Punkt 2).
  test('Bestellung 19-15281-36243 (BLACK 20,95, Einkauf 15,14): adRate 0 → Gebühr 4,28 (echt 4,10 mit Fix 0,30), Gewinn 1,53', () => {
    expect(order(0)).toMatchObject({ nettoGebuehren: 4.28, nettoErgebnis: 1.53 });
  });
  test('mit adRate 5 (bisheriger App-Stand) → Gebühr 5,52, Gewinn 0,29 (vorher 5,34 / 0,47 mit Fix 0,30)', () => {
    expect(order(5)).toMatchObject({ nettoGebuehren: 5.52, nettoErgebnis: 0.29 });
  });
  // Formel je Standort (08.11.2026): EINGABEN GEÄNDERT wie in k008-preis-halten.test.ts (GRAY-Ware 11,47 → 11,59, VK GRAY 19,95 → 20,95,
  // Blue 21,95 → 22,45, black 20,95 → 21,45) — sonst wären mit S 1,19 auch bei adRate 0 alle drei unter dem Boden. bun: adRate 0 GRAY 0,9829.
  const p220 = (adRate: number) => ({
    id: 220, variants: JSON.stringify([{ name: 'Color Name', values: ['GRAY', 'Blue', 'black'] }]), targetMarginEur: 1, shipsFrom: 'China', adRate,
    sellPrice: 20.95, buyPrice: 11.59,
    variantPrices: JSON.stringify([
      { skuId: 'g', attrs: { 'Color Name': 'GRAY' }, price: 11.59 },
      { skuId: 'b', attrs: { 'Color Name': 'Blue' }, price: 12.49 },
      { skuId: 'k', attrs: { 'Color Name': 'black' }, price: 11.59 },
    ]),
    variantSellPrices: JSON.stringify({ g: 20.95, b: 22.45, k: 21.45 }), ebayStatus: 'listed', ebayListingId: '198712713157',
  });
  test('Preisprüfung adRate 0: nur GRAY (0,9829 < 1,00) würde angehoben — BLACK/BLUE nicht (K-008 regelt GRAY)', () => {
    expect(planVariantRaises(p220(0)).map(r => [r.skuId, r.newSell])).toEqual([['g', 21.45]]);
  });
  test('Preisprüfung adRate 5 (Fehlstand): alle drei würden angehoben', () => {
    expect(planVariantRaises(p220(5)).map(r => [r.skuId, r.newSell])).toEqual([['g', 23.45], ['b', 24.95], ['k', 23.45]]);
  });
});

describe('K-009 Rest: Sammel-Auswahl', () => {
  test('Sammel-Auswahl nutzt dieselben Optionen inkl. 0 (aus)', async () => {
    const src = await Bun.file(new URL('../web/pages/listings.tsx', import.meta.url)).text();
    expect(src).toContain('AD_RATE_OPTIONS.map(r => <option');
    expect(src).not.toContain('[2, 3, 5, 8, 10].map');
  });
  test('K-017: alter Weg bulk/adrate ist abgeschaltet (410) — kein „nur App“, kein setAdRate', async () => {
    const src = await Bun.file(new URL('../api/index.ts', import.meta.url)).text();
    const i = src.indexOf("'/ebay/listings/bulk/adrate'");
    const block = src.slice(i, src.indexOf('}, 410))', i) + 8);
    expect(block).toContain('/api/ebay/listings/ad-switch');
    expect(block).not.toContain('appOnly');
    expect(block).not.toContain('setAdRate');
  });
});
