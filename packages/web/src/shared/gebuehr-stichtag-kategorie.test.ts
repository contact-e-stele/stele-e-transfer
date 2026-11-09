// Bündel A+B zu PR #304 (09.11.2026): Stichtag der eBay-Gebührenumstellung + Provision je eBay-Kategorie.
// Alle Erwartungswerte mit bun nachgerechnet (Grundgesetz 3), nicht aus dem Auftrag übernommen.
import { describe, expect, test } from 'bun:test';
import {
  EBAY_CATEGORY_FEE_RATES, EBAY_FEE_RATE_UNKNOWN_PERCENT, EBAY_FIXED_FEE_SCHEDULE, EBAY_FIXED_FEE_SCHEDULE_ALT, GEBUEHR_NEU_AB,
  ebayFeeRatePercentFor, ebayFeeRatePercentForCategories, orderUsesNewFeeRule, orderFeeRule, computeOrderProfitRaw, computeOrderProfit,
  computeMinSellPrice, defaultEbayFeeRateGross,
} from './pricing';
import { planTierReprice } from './tier-reprice';
import { productProfitRows } from './target-margin-bulk';
import { computeOrderNettoErgebnis } from '../api/order-matching';

const r2 = (n: number) => Math.round(n * 100) / 100;

describe('Kategorie-Tabelle (eine Stelle)', () => {
  test('genau die 30 Kategorien des Auftrags mit ihrem Satz', () => {
    const erwartet: Record<string, number> = {};
    for (const id of ['58730', '36026', '20651', '43504', '102379', '166725', '20638', '11703', '177013', '181076', '11794', '34002', '10900', '116392', '46305', '100411', '177794', '65509']) erwartet[id] = 14;
    for (const id of ['105559', '22683', '15738']) erwartet[id] = 12;
    erwartet['45687'] = 13;
    for (const id of ['166724', '13362', '47921', '101406', '164800', '100299', '300', '20749']) erwartet[id] = 15;
    expect({ ...EBAY_CATEGORY_FEE_RATES }).toEqual(erwartet);
    expect(Object.keys(EBAY_CATEGORY_FEE_RATES).length).toBe(30);
  });
  test('ebayFeeRatePercentFor: 14 / 12 / 13 / 15 (unklar) — auch als Zahl und mit Leerzeichen', () => {
    expect(ebayFeeRatePercentFor('10900')).toBe(14);
    expect(ebayFeeRatePercentFor(10900)).toBe(14);
    expect(ebayFeeRatePercentFor(' 10900 ')).toBe(14);
    expect(ebayFeeRatePercentFor('105559')).toBe(12);
    expect(ebayFeeRatePercentFor('45687')).toBe(13);
    expect(ebayFeeRatePercentFor('300')).toBe(15);
  });
  test('unbekannte oder fehlende Kategorie → 15 % (sichere Seite; Kalkulator nannte 14 % — offene Rückfrage)', () => {
    expect(EBAY_FEE_RATE_UNKNOWN_PERCENT).toBe(15);
    for (const c of [null, undefined, '', '   ', '79720', '99999', 'abc']) expect(ebayFeeRatePercentFor(c)).toBe(15);
    // kein Prototyp-Treffer ('constructor' ist kein Kategorie-Eintrag)
    expect(ebayFeeRatePercentFor('constructor')).toBe(15);
  });
  test('mehrere Produkte in einer Bestellung → höchster Satz; leer → 15 %', () => {
    expect(ebayFeeRatePercentForCategories(['10900', '105559'])).toBe(14);
    expect(ebayFeeRatePercentForCategories(['10900', null])).toBe(15);
    expect(ebayFeeRatePercentForCategories(['105559', '22683'])).toBe(12);
    expect(ebayFeeRatePercentForCategories([])).toBe(15);
  });
  test('defaultEbayFeeRateGross nimmt den Kategorie-Satz: 14 % ohne Anzeige, EU = 0,14 × 1,19 = 0,1666', () => {
    expect(defaultEbayFeeRateGross(0, false, '10900')).toBeCloseTo(0.1666, 12);
    expect(defaultEbayFeeRateGross(0, false, null)).toBeCloseTo(0.1785, 12);
  });
});

describe('Stichtag GEBUEHR_NEU_AB = 2026-10-15T08:00:00Z', () => {
  test('Konstante', () => expect(GEBUEHR_NEU_AB).toBe('2026-10-15T08:00:00Z'));
  test('Grenze: 07:59:59Z alt, 08:00:00Z neu (auch Millisekunden)', () => {
    expect(orderUsesNewFeeRule('2026-10-15T07:59:59Z')).toBe(false);
    expect(orderUsesNewFeeRule('2026-10-15T07:59:59.999Z')).toBe(false);
    expect(orderUsesNewFeeRule('2026-10-15T08:00:00Z')).toBe(true);
    expect(orderUsesNewFeeRule('2026-10-15T08:00:00.000Z')).toBe(true);
  });
  test('Zeitzonen: +02:00 wird umgerechnet; ohne Zone = UTC (nie Server-Zeitzone)', () => {
    expect(orderUsesNewFeeRule('2026-10-15T09:59:59+02:00')).toBe(false);
    expect(orderUsesNewFeeRule('2026-10-15T10:00:00+02:00')).toBe(true);
    expect(orderUsesNewFeeRule('2026-10-15T07:59:59')).toBe(false);
    expect(orderUsesNewFeeRule('2026-10-15T08:00:00')).toBe(true);
  });
  test('nur Datum: vor dem 15.10. alt, ab 15.10. (auch der mehrdeutige 15.10. selbst) neu', () => {
    expect(orderUsesNewFeeRule('2026-10-14')).toBe(false);
    expect(orderUsesNewFeeRule('2026-10-15')).toBe(true);
    expect(orderUsesNewFeeRule('2026-10-16')).toBe(true);
  });
  test('fehlend/unlesbar → neue Regel', () => {
    for (const d of [null, undefined, '', 'gestern', '2026-13-45T99:00:00Z']) expect(orderUsesNewFeeRule(d)).toBe(true);
  });
  test('orderFeeRule: alt = 15 % + 0,30 (auch bei 14-%-Kategorie), neu = Satz je Kategorie + 0,35/0,45', () => {
    expect(orderFeeRule('2026-10-15T07:59:59Z', '10900')).toEqual({ neu: false, ratePercent: 15, schedule: EBAY_FIXED_FEE_SCHEDULE_ALT });
    expect(orderFeeRule('2026-10-15T08:00:00Z', '10900')).toEqual({ neu: true, ratePercent: 14, schedule: EBAY_FIXED_FEE_SCHEDULE });
    expect(orderFeeRule('2026-10-15T08:00:00Z', null)).toEqual({ neu: true, ratePercent: 15, schedule: EBAY_FIXED_FEE_SCHEDULE });
  });
  test('Gebühr 20,95 € an der Grenze (Kategorie 10900): 07:59:59Z 4,096575 · 08:00:00Z 4,02577 · neu ohne Kategorie 4,275075', () => {
    const fee = (d: string, c: string | null) => computeOrderProfitRaw(20.95, 0, 0, false, { orderDate: d, ebayCategory: c }).feesDeducted;
    expect(fee('2026-10-15T07:59:59Z', '10900')).toBeCloseTo(4.096575, 9); // (0,15 × 20,95 + 0,30) × 1,19
    expect(fee('2026-10-15T08:00:00Z', '10900')).toBeCloseTo(4.02577, 9);  // (0,14 × 20,95 + 0,45) × 1,19
    expect(fee('2026-10-15T08:00:00Z', null)).toBeCloseTo(4.275075, 9);    // (0,15 × 20,95 + 0,45) × 1,19
    expect(fee('2026-10-15T08:00:00Z', '105559')).toBeCloseTo(3.52716, 9); // (0,12 × 20,95 + 0,45) × 1,19
  });
  test('ohne Zeitpunkt (Weglassen des 5. Arguments) = neue Regel, 15 %', () => {
    expect(computeOrderProfitRaw(20.95, 0, 0, false).feesDeducted).toBeCloseTo(4.275075, 9);
  });
});

// Die 10 echten Belege (Kalkulator): Gesamtbetrag G → echte Gebühr brutto. Ohne Anzeige, S = 1.
// Formel alt = (0,15 × G + 0,30) × 1,19; neu = (0,14 × G + 0,45) × 1,19. Ab 01-15317 neu mit 14 %. Die Kategorie der einzelnen Bestellung
// steht nicht im Beleg — TESTWERT: 10900 (eine 14-%-Kategorie der Tabelle), um den Satz 14 % über die Tabelle zu ziehen.
// Datumsangaben ohne Uhrzeit sind als reines Datum übergeben (alle nach dem 15.10. → eindeutig neu).
const BELEGE: Array<{ nr: string; at: string; g: number; echt: number; alt: boolean; formel: number }> = [
  { nr: '19-15281-36243', at: '2026-10-15T05:43:00Z', g: 20.95, echt: 4.10, alt: true, formel: 4.096575 },
  { nr: '01-15317-84805', at: '2026-10-15T10:58:00Z', g: 43.90, echt: 7.86, alt: false, formel: 7.849240 },
  { nr: '19-15283-48578', at: '2026-10-15T17:52:00Z', g: 20.95, echt: 4.03, alt: false, formel: 4.025770 },
  { nr: '16-15291-74768', at: '2026-10-16T09:41:00Z', g: 19.95, echt: 3.86, alt: false, formel: 3.859170 },
  { nr: '03-15326-13837', at: '2026-10-18', g: 23.95, echt: 4.53, alt: false, formel: 4.525570 },
  { nr: '12-15317-45527', at: '2026-10-20', g: 23.95, echt: 4.53, alt: false, formel: 4.525570 },
  { nr: '20-15341-21173', at: '2026-10-29', g: 18.95, echt: 3.69, alt: false, formel: 3.692570 },
  { nr: '16-15351-54733', at: '2026-10-30', g: 47.42, echt: 8.44, alt: false, formel: 8.435672 },
  { nr: '01-15409-64180', at: '2026-11-05', g: 24.95, echt: 4.69, alt: false, formel: 4.692170 },
  { nr: '25-15377-28447', at: '2026-11-09', g: 29.10, echt: 5.38, alt: false, formel: 5.383560 },
];

describe('10 echte Belege: App-Gebühr = Formel und auf den Cent ±0,01 am echten Wert', () => {
  for (const b of BELEGE) {
    test(`${b.nr} (${b.at}) G ${b.g} → echt ${b.echt} (${b.alt ? 'alt' : 'neu'})`, () => {
      expect(orderUsesNewFeeRule(b.at)).toBe(!b.alt);
      const unabhaengig = b.alt ? (0.15 * b.g + 0.30) * 1.19 : (0.14 * b.g + 0.45) * 1.19;
      expect(unabhaengig).toBeCloseTo(b.formel, 6);
      const app = computeOrderProfitRaw(b.g, 0, 0, false, { orderDate: b.at, ebayCategory: '10900' }).feesDeducted;
      expect(app).toBeCloseTo(b.formel, 6);
      // ±0,01 auf Cent-Basis (eBay weist Cent aus). 01-15317-84805: 7,84924 → 7,85, echt 7,86 = genau 0,01 (ungerundet 0,0108).
      expect(Math.abs(r2(app) - b.echt)).toBeLessThanOrEqual(0.01 + 1e-9);
      // gerundete App-Gebühr (computeOrderProfit, wie im Bestellungen-Tab)
      expect(computeOrderProfit(b.g, 0, 0, false, { orderDate: b.at, ebayCategory: '10900' }).feesDeducted).toBe(r2(b.formel));
    });
  }
  // Gegenprobe (Grundgesetz 5: unterscheidet die Fixture?): mit der jeweils ANDEREN Regel läge JEDER Beleg ≥ 0,05 daneben (bun: 0,07 /
  // 0,33 / 0,07 / 0,06 / 0,10 / 0,10 / 0,05 / 0,38 / 0,12 / 0,17).
  test('Gegenprobe: mit der jeweils anderen Regel liegen alle 10 Belege mehr als 0,01 daneben', () => {
    const daneben = BELEGE.filter(b => {
      const anders = b.alt ? (0.14 * b.g + 0.45) * 1.19 : (0.15 * b.g + 0.30) * 1.19;
      return Math.abs(r2(anders) - b.echt) > 0.01 + 1e-9;
    });
    expect(daneben.length).toBe(10);
  });
});

describe('Kategorie-Satz kommt in den Rechenwegen an', () => {
  test('Mindest-VK (computeMinSellPrice) EU, Ware 9,38, Anzeige 0, Ziel 2,00: 15 % → 14,45 · 14 % (10900) → 13,95', () => {
    const vk = (cat: string | null) => computeMinSellPrice({
      buyPrice: 9.38, isChinaOrigin: false, ebayFeeRatePercent: ebayFeeRatePercentFor(cat), vatFactor: 1.19, adRatePercent: 0,
      targetMarginEur: 2, safetyBufferEur: 0, rounding: 'floor95',
    });
    expect(vk(null).rawMinSellPrice).toBeCloseTo(14.5046, 4);   // (9,38 + 2 + 0,5355) / (1 − 0,15 × 1,19)
    expect(vk('10900').rawMinSellPrice).toBeCloseTo(14.2975, 4); // (9,38 + 2 + 0,5355) / (1 − 0,14 × 1,19)
    expect(vk(null).minSellPrice).toBe(14.45);
    expect(vk('10900').minSellPrice).toBe(13.95);
  });
  const einzel = (cat: string | null) => ({
    id: 900, variants: '[]', buyPrice: 9.38, sellPrice: 14.45, shipsFrom: 'Germany', adRate: 0, variantPrices: null, targetMarginEur: 2, ebayCategory: cat,
  });
  test('Stufenwechsel/Käuferpreis heben/Preislauf (planTierReprice → repriceFeesFor): 14,45 ohne Kategorie, 13,95 mit 10900', () => {
    expect(planTierReprice(einzel(null), 2).rows[0].newSell).toBe(14.45);
    expect(planTierReprice(einzel('10900'), 2).rows[0].newSell).toBe(13.95);
  });
  test('Erwartet/Anzeige (productProfitRows) bei VK 14,45: 15 % 1,955175 · 14 % 2,127130', () => {
    expect(productProfitRows(einzel(null)).rows[0].profit).toBeCloseTo(1.955175, 6);   // 14,45 × 0,8215 − 0,5355 − 9,38
    expect(productProfitRows(einzel('10900')).rows[0].profit).toBeCloseTo(2.12713, 6); // 14,45 × 0,8334 − 0,5355 − 9,38
  });
  test('Bestellungs-Gewinn (computeOrderNettoErgebnis): Kategorie des Produkts, gemischt = höchster Satz, vor Stichtag 15 %', () => {
    const prod: Record<string, { id: number; buyPrice: number; shipsFrom: string; adRate: number; variants: never[]; ebayCategory: string | null }> = {
      a: { id: 901, buyPrice: 5, shipsFrom: 'Germany', adRate: 0, variants: [], ebayCategory: '10900' },
      b: { id: 902, buyPrice: 5, shipsFrom: 'Germany', adRate: 0, variants: [], ebayCategory: '105559' },
    };
    const run = (skus: string[], orderDate: string) => computeOrderNettoErgebnis({
      orderTotal: 30, manualBuyPrice: 10, orderDate,
      lineItems: skus.map(s => ({ sku: s, quantity: 1 })),
      findProduct: (sku) => (sku ? prod[sku] ?? null : null),
    });
    // neu, nur 12-%-Produkt: 30 − (0,12 × 30 + 0,45) × 1,19 − 10 = 15,1805 → 15,18
    expect(run(['b'], '2026-11-01T10:00:00Z').nettoErgebnis).toBe(15.18);
    // neu, gemischt 14 % + 12 % → 14 %: 30 − (0,14 × 30 + 0,45) × 1,19 − 10 = 14,4665 → 14,47
    expect(run(['a', 'b'], '2026-11-01T10:00:00Z').nettoErgebnis).toBe(14.47);
    // neu, Position ohne Produkt → 15 %: 30 − (0,15 × 30 + 0,45) × 1,19 − 10 = 14,1095 → 14,11
    expect(run(['a', 'x'], '2026-11-01T10:00:00Z').nettoErgebnis).toBe(14.11);
    // alt (vor Stichtag), 12-%-Produkt → trotzdem 15 % + 0,30: 30 − (0,15 × 30 + 0,30) × 1,19 − 10 = 14,288 → 14,29
    expect(run(['b'], '2026-10-15T07:59:59Z').nettoErgebnis).toBe(14.29);
  });
});
