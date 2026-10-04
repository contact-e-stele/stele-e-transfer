// A-014 Punkt 6: Tests für den Preisvergleich-Bericht (reine Funktionen). Die Zahlen sind frisch mit bun nachgerechnet.
//
// Fixture stele-119: Wares 3,15 € (100pcs) und 4,79 € (200pcs), heutige VK 11,95 € / 14,95 €, China, Anzeige 5 %, shippingCost 0 —
// Werte aus der Kalkulator-Übergabe (P1b-Nachprüfung, 04.10.2026). Unabhängige Gegenprobe aus diesem Dokument: "Nach Formel v2:
// 100pcs 13,95, 200pcs 15,95" und "App glaubt 1,36–1,60 bzw. ≈2,24" (= Formel v1) — beides wird hier bestätigt.
// Die Produkte 200–202 sind ERFUNDENE Test-Fixtures (nur für die Randfälle), keine Live-Daten.
import { describe, expect, test } from 'bun:test';
import { buildPriceReportRows, renderPriceReportMarkdown, profitOldFormulaV1, tierLabelFor, type ReportProduct } from './price-report-v2';

const stele119: ReportProduct = {
  id: 119, variants: '[{"name":"Menge","values":["100PCS","200PCS"]}]', title: 'Backpapier', ebayStatus: 'listed', buyPrice: 3.15, sellPrice: 14.95,
  variantPrices: JSON.stringify([{ skuId: 'a', attrs: { Menge: '100PCS' }, price: 3.15 }, { skuId: 'b', attrs: { Menge: '200PCS' }, price: 4.79 }]),
  variantSellPrices: JSON.stringify({ a: 11.95, b: 14.95 }),
  shippingCost: 0, shipsFrom: 'China', adRate: 5, targetMarginEur: 2,
};
const einzelAlt450: ReportProduct = {
  id: 200, variants: '[]', title: 'Einzel', ebayStatus: 'listed', buyPrice: 12, sellPrice: 21.95, variantPrices: null, variantSellPrices: null,
  shippingCost: 1.99, shipsFrom: 'China', adRate: 5, targetMarginEur: 4.5,
};
const ohneEk: ReportProduct = { ...einzelAlt450, id: 201, title: 'ohne EK', buyPrice: null, targetMarginEur: null };
const nichtGelistet: ReportProduct = { ...einzelAlt450, id: 202, title: 'nicht gelistet', ebayStatus: 'none' };

describe('buildPriceReportRows — stele-119 gegen die Zahlen der Kalkulator-Übergabe', () => {
  const { rows } = buildPriceReportRows([stele119]);

  test('neuer VK nach Formel v2: 100pcs 13,95 €, 200pcs 15,95 € (wie in der Übergabe)', () => {
    expect(rows.map(r => [r.variantLabel, r.newSell])).toEqual([['100PCS', 13.95], ['200PCS', 15.95]]);
    expect(rows.map(r => r.deltaSell)).toEqual([2, 1]);
  });

  test('Gewinn alt (v1) = was die App bisher zeigte: 1,5989 € (Übergabe: "bis 1,60") und 2,2449 € (Übergabe: "≈ 2,24")', () => {
    expect(rows[0].oldProfitV1).toBeCloseTo(1.5989, 4);
    expect(rows[1].oldProfitV1).toBeCloseTo(2.2449, 4);
  });

  test('Gewinn heute (v2): 0,0389 € und 0,6849 € — beide unter dem Boden 1,30 € → rot; neu 1,5629 € und 1,4469 €', () => {
    expect(rows[0].profitNowV2).toBeCloseTo(0.0389, 4);
    expect(rows[1].profitNowV2).toBeCloseTo(0.6849, 4);
    expect(rows.map(r => r.level)).toEqual(['red', 'red']);
    expect(rows[0].newProfitV2).toBeCloseTo(1.5629, 4);
    expect(rows[1].newProfitV2).toBeCloseTo(1.4469, 4);
    expect(rows.every(r => r.newProfitV2 >= r.floorEur)).toBe(true);
  });
});

describe('buildPriceReportRows — Randfälle', () => {
  const { rows, skipped } = buildPriceReportRows([einzelAlt450, ohneEk, nichtGelistet]);

  test('nur gelistete Produkte; ohne Einkaufspreis → "nicht berechenbar", keine geratene Zeile', () => {
    expect(rows.map(r => r.productId)).toEqual([200]);
    expect(skipped).toEqual([{ productId: 201, reason: 'kein Einkaufspreis' }]);
  });

  test('Bestandsprodukt mit Zielgewinn 4,50: Boden 2,00 €, Stufe "4,50 (alt)", Formelpreis 25,95 €, nicht umgestellt', () => {
    expect(rows[0].tierLabel).toBe('4,50 (alt)');
    expect(rows[0].floorEur).toBe(2);
    expect(rows[0].newSell).toBe(25.95);
    expect(rows[0].newProfitV2).toBeCloseTo(3.8469, 4);
    expect(rows[0].targetEur).toBe(4.5); // der gespeicherte Zielgewinn bleibt, der Bericht stellt nichts um
  });

  test('Gewinn alt (v1) berücksichtigt shippingCost 1,99 € + Zoll 4,00 €: Ware 12 bei VK 21,95 → −1,6211 €', () => {
    expect(rows[0].oldProfitV1).toBeCloseTo(-1.6211, 4);
    expect(profitOldFormulaV1(21.95, 12, 1.99, true, 5)).toBeCloseTo(-1.6211, 4);
  });

  test('tierLabelFor: A–D, 4,50 (alt), sonst "andere"', () => {
    expect(['1', '1.5', '2', '3', '4.5', '5'].map(t => tierLabelFor(Number(t)))).toEqual(['A', 'B', 'C', 'D', '4,50 (alt)', 'andere']);
  });
});

describe('renderPriceReportMarkdown', () => {
  const { rows, skipped } = buildPriceReportRows([stele119, einzelAlt450, ohneEk]);
  const md = renderPriceReportMarkdown(rows, skipped, '2026-10-04T00:00:00Z');

  test('enthält Kopf, Tabellenzeilen mit alt/neu, Zusammenfassung, 4,50-Liste und nicht berechenbare Produkte', () => {
    expect(md).toContain('keine Preisänderung');
    expect(md).toContain('| 119 Backpapier | 100PCS | 3,15 | ja | C (2,00/1,30) | 11,95 | 13,95 | +2,00 | 1,60 | 0,04 | 1,56 | ROT (unter Boden) |');
    expect(md).toContain('Zeilen: 3 (Produkte/Varianten); davon mit heutigem VK: 3.');
    expect(md).toContain('Anzeige beim heutigen VK: 3 rot (Gewinn unter Boden), 0 gelb (unter Ziel, über Boden), 0 ok.');
    expect(md).toContain('- 200 Einzel');
    expect(md).toContain('- 201: kein Einkaufspreis');
  });
});
