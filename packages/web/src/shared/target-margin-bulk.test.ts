// A-016: Tests für die reinen Bausteine hinter Listings-Tab "Stufe für alle" und Filter "Neu eingestellt".
// Alle Zahlen frisch mit bun nachgerechnet (Formel v2, Anzeige 5 %). Fixtures: Produkt 95 (Ware 8,99 €, EU, VK 15,95 €) und
// 119 (100pcs Ware 3,15 € @ 11,95 €, 200pcs Ware 4,79 € @ 14,95 €, China) entsprechen den Werten aus dem A-014-Bericht;
// K-004 (08.10.2026): die Erwartungen zu Produkt 95 sind korrigiert — siehe Kommentar an der Fixture;
// die Produkte 1–3 sind ERFUNDENE Test-Fixtures für die Stufen-Grenzfälle, keine Live-Daten.
import { describe, expect, test } from 'bun:test';
import {
  productProfitRows, previewTierChange, parseBulkTargetMarginBody, isListedWithin, startTimeMillis, compareStartTimeDesc,
  BULK_TARGET_MARGIN_MAX, type ProfitProduct,
} from './target-margin-bulk';

const single = (id: number, sell: number | null, buy: number | null, china: boolean): ProfitProduct => ({
  id, variants: '[]', targetMarginEur: 2, shipsFrom: china ? 'China' : 'DE', adRate: 5, sellPrice: sell, buyPrice: buy, variantPrices: null,
});
// Produkt 95 ist in Produktion ein Varianten-Produkt mit EINER Variante (Varianten-Gruppen + 1 variantPrices-Eintrag, eBay-Gruppe
// stele-95-GROUP) — deshalb hier mit Gruppen: die Preisprüfung behandelt es als Varianten-Produkt (A-019).
const p95: ProfitProduct = {
  id: 95, variants: '[{"name":"Set","values":["6pcs set"]},{"name":"Stk.","values":["10ml x 6pcs"]}]', targetMarginEur: 2, shipsFrom: null, adRate: 5,
  sellPrice: 15.95, buyPrice: 8.99,
  variantPrices: JSON.stringify([{ skuId: '12000056840616727', attrs: { Color: '6pcs set', 'Net Contents': '10ml x 6pcs', 'Ships From': 'Germany' }, price: 8.99, stock: 17 }]),
}; // K-004: Gewinn 2,8069 — über jedem Boden. Vorher stand hier 0,8169, weil die Kosten 1,99 € AliExpress-Versand
   // enthielten, obwohl das Varianten-Attribut "Ships From" = Germany sagt (EU: kein Versand, keine Einfuhrabgaben).
   // products.shipsFrom ist bei 95 leer — die Herkunft kommt deshalb aus dem Varianten-Attribut (K-004 Lücke 2+3).
const pGrenze = single(1, 13.55, 3.15, true);               // Gewinn 1,2581 — über Boden B (1,20), unter Boden C (1,30)
const pYellow = single(2, 13.95, 3.15, true);               // Gewinn 1,5629
const pOhneVk = single(3, null, null, true);                // nicht berechenbar
const p119: ProfitProduct = {
  id: 119, variants: '[{"name":"Menge","values":["100PCS","200PCS"]}]', targetMarginEur: 2, shipsFrom: 'China', adRate: 5, sellPrice: 14.95, buyPrice: 3.15,
  variantPrices: JSON.stringify([{ skuId: 'a', attrs: { Menge: '100PCS' }, price: 3.15 }, { skuId: 'b', attrs: { Menge: '200PCS' }, price: 4.79 }]),
  variantSellPrices: JSON.stringify({ a: 11.95, b: 14.95 }),
};
const ALL = [p95, pGrenze, pYellow, p119, pOhneVk];

describe('productProfitRows', () => {
  // K-004 (08.10.2026) — KORRIGIERTE ERWARTUNG, 0,8169 € → 2,8069 €. Die alte Zahl war die Summe
   // zweier Fehler: leeres products.shipsFrom wurde wie EU gerechnet, der EU-Versand von 1,99 €
   // aber trotzdem angesetzt. Richtig ist: Herkunft laut Varianten-Attribut "Ships From" = Germany
   // → EU → K = 8,99 € (kein Versand, keine Einfuhrabgaben) → 15,95 × 0,762 − 0,357 − 8,99 = 2,8069.
   // Folge für den Betrieb: 95 liegt NICHT unter dem Boden und wird von der Preisprüfung nicht mehr
   // angehoben (s. api/variant-raise.test.ts, derselbe Fall).
  test('Produkt 95 (Varianten-Gruppen, nur 1 variantPrices-Eintrag): EU laut Varianten-Attribut → Gewinn 2,8069 €', () => {
    const r = productProfitRows(p95);
    expect(r.isVariant).toBe(true);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].profit).toBeCloseTo(2.8069, 4);
    // Regressions-Beweis (Grundgesetz Regel 5): mit der alten Rechnung (EU + 1,99 € Versand) käme
    // 0,8169 € heraus — die Fixture unterscheidet die beiden Verhalten also eindeutig.
    expect(r.rows[0].profit).not.toBeCloseTo(0.8169, 2);
  });

  test('Varianten-Produkt: je Variante mit ihrem VK aus variant_sell_prices (119: 0,0389 € und 0,6849 €)', () => {
    const r = productProfitRows(p119);
    expect(r.isVariant).toBe(true);
    expect(r.rows.map(x => x.label)).toEqual(['100PCS', '200PCS']);
    expect(r.rows[0].profit).toBeCloseTo(0.0389, 4);
    expect(r.rows[1].profit).toBeCloseTo(0.6849, 4);
  });

  test('ohne gespeicherten VK je Variante greift der Produkt-VK; ohne VK/EK keine Zeile (nichts geraten)', () => {
    const ohneMap = productProfitRows({ ...p119, variantSellPrices: null });
    expect(ohneMap.rows).toHaveLength(2);
    expect(ohneMap.rows[0].profit).toBeCloseTo(2.3249, 4); // 14,95 € Produkt-VK bei Ware 3,15 €: 14,95 × 0,762 − 0,357 − 9,067 (A-014-Bericht: "Gewinn heute 2,32")
    expect(productProfitRows(pOhneVk).rows).toEqual([]);
  });
});

describe('previewTierChange — "N Listings → Stufe X. Davon rot nach Wechsel: M"', () => {
  // K-004: in allen vier Stufen ist Produkt 95 nicht mehr rot (echter Gewinn 2,8069 € statt
  // gerechneter 0,8169 €, s.o.). Die Zahlen der übrigen Fixtures (119: 0,0389/0,6849 · Grenzfall
  // 1,2581 · gelb 1,5629, alle China) sind unverändert — frisch mit bun nachgerechnet.
  test('Stufe A (1,00/1,00): rot ist nur 119 (Variante); 95 (2,8069) und der Grenzfall (1,2581) nicht', () => {
    const p = previewTierChange(ALL, 1.0);
    expect(p).toEqual({ total: 5, red: 1, redSingle: 0, redVariant: 1, yellow: 0, unknown: 1, redIds: [119] });
  });

  test('Stufe B (1,50/1,20): Grenzfall (1,2581 ≥ 1,20) ist gelb statt rot', () => {
    const p = previewTierChange(ALL, 1.5);
    expect(p.red).toBe(1);
    expect(p.yellow).toBe(1);
  });

  test('Stufe C (2,00/1,30): Grenzfall-Produkt (1,2581 < 1,30) wird rot — der Stufenwechsel verändert die Zahl M', () => {
    const p = previewTierChange(ALL, 2.0);
    expect(p).toEqual({ total: 5, red: 2, redSingle: 1, redVariant: 1, yellow: 1, unknown: 1, redIds: [1, 119] });
  });

  test('Stufe D (3,00/1,50): wie C (rot 2), 13,95-Produkt (1,5629) und 95 (2,8069) sind gelb', () => {
    const p = previewTierChange(ALL, 3.0);
    expect(p.red).toBe(2);
    expect(p.yellow).toBe(2);
  });

  test('Einzelartikel und Varianten-Produkte werden getrennt gezählt (nur Einzelartikel hebt die Automatik an)', () => {
    const p = previewTierChange([pGrenze, p119], 2.0);
    expect(p.redSingle).toBe(1);
    expect(p.redVariant).toBe(1);
  });

  test('leere Auswahl ergibt lauter Nullen', () => {
    expect(previewTierChange([], 2.0)).toEqual({ total: 0, red: 0, redSingle: 0, redVariant: 0, yellow: 0, unknown: 0, redIds: [] });
  });
});

describe('parseBulkTargetMarginBody — Validierung des Sammel-Endpunkts (Regressionsschutz: ungültige Stufe wird abgelehnt)', () => {
  const ok = { productIds: [1, 2, 3], targetMarginEur: 2.0, confirm: true };

  test('gültiger Body: Stufe C, drei IDs', () => {
    expect(parseBulkTargetMarginBody(ok)).toEqual({ ok: true, productIds: [1, 2, 3], targetMarginEur: 2.0 });
  });

  test.each([1.0, 1.5, 2.0, 3.0])('alle Stufen A–D werden akzeptiert (%f)', (t) => {
    expect(parseBulkTargetMarginBody({ ...ok, targetMarginEur: t }).ok).toBe(true);
  });

  test.each([[4.5], [2.5], [0], [-1], [5], [1.01]])('ungültige Stufe %f wird abgelehnt (4,50 ist NICHT wählbar)', (t) => {
    const r = parseBulkTargetMarginBody({ ...ok, targetMarginEur: t });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Margen-Stufe');
  });

  test('es wird der kanonische Stufenwert gespeichert, nicht der Rohwert (2.004 → 2.0)', () => {
    expect(parseBulkTargetMarginBody({ ...ok, targetMarginEur: 2.004 })).toEqual({ ok: true, productIds: [1, 2, 3], targetMarginEur: 2.0 });
  });

  test('Stufe als Text oder fehlend wird abgelehnt', () => {
    expect(parseBulkTargetMarginBody({ ...ok, targetMarginEur: '2' }).ok).toBe(false);
    expect(parseBulkTargetMarginBody({ productIds: [1], confirm: true }).ok).toBe(false);
  });

  test('ohne confirm:true (fehlend, false, "true") wird abgelehnt', () => {
    expect(parseBulkTargetMarginBody({ productIds: [1], targetMarginEur: 2 }).ok).toBe(false);
    expect(parseBulkTargetMarginBody({ ...ok, confirm: false }).ok).toBe(false);
    expect(parseBulkTargetMarginBody({ ...ok, confirm: 'true' }).ok).toBe(false);
  });

  test('IDs: leer, kein Array, Kommazahl, Null, negativ, Text werden abgelehnt', () => {
    for (const ids of [[], 'x', [1.5], [0], [-3], ['1'], [1, null]]) {
      expect(parseBulkTargetMarginBody({ ...ok, productIds: ids }).ok).toBe(false);
    }
  });

  test(`Obergrenze: ${BULK_TARGET_MARGIN_MAX} IDs gehen, ${BULK_TARGET_MARGIN_MAX + 1} nicht`, () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
    expect(parseBulkTargetMarginBody({ ...ok, productIds: mk(BULK_TARGET_MARGIN_MAX) }).ok).toBe(true);
    const r = parseBulkTargetMarginBody({ ...ok, productIds: mk(BULK_TARGET_MARGIN_MAX + 1) });
    expect(r.ok).toBe(false);
  });

  test('doppelte IDs werden zusammengefasst; Body fehlt/kein Objekt wird abgelehnt', () => {
    expect(parseBulkTargetMarginBody({ ...ok, productIds: [5, 5, 6] })).toEqual({ ok: true, productIds: [5, 6], targetMarginEur: 2.0 });
    expect(parseBulkTargetMarginBody(null).ok).toBe(false);
    expect(parseBulkTargetMarginBody('x').ok).toBe(false);
  });
});

describe('isListedWithin / startTimeMillis — Filter "Neu eingestellt" (eBay-StartTime)', () => {
  const now = new Date(2026, 9, 4, 12, 0, 0); // 04.10.2026 12:00 lokale Zeit
  const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min, 0).toISOString();

  test('heute: gleicher Kalendertag zählt, gestern 23:59 nicht, morgen nicht', () => {
    expect(isListedWithin(at(2026, 10, 4, 0, 1), 0, now)).toBe(true);
    expect(isListedWithin(at(2026, 10, 4, 11, 59), 0, now)).toBe(true);
    expect(isListedWithin(at(2026, 10, 3, 23, 59), 0, now)).toBe(false);
    expect(isListedWithin(at(2026, 10, 5, 8, 0), 0, now)).toBe(false);
  });

  test('letzte 7 Tage: genau 7 × 24 h zählt, eine Minute länger nicht', () => {
    expect(isListedWithin(at(2026, 9, 27, 12, 0), 7, now)).toBe(true);
    expect(isListedWithin(at(2026, 9, 27, 11, 59), 7, now)).toBe(false);
    expect(isListedWithin(at(2026, 10, 1, 8, 0), 7, now)).toBe(true);
  });

  test('leeres/ungültiges Datum und Zukunft zählen nicht (nichts geraten)', () => {
    expect(isListedWithin('', 7, now)).toBe(false);
    expect(isListedWithin(null, 7, now)).toBe(false);
    expect(isListedWithin('kein Datum', 7, now)).toBe(false);
    expect(isListedWithin(at(2026, 10, 9, 12, 0), 7, now)).toBe(false);
  });

  test('startTimeMillis: gültig → Millisekunden, ungültig/leer → -Infinity (sortiert ans Ende)', () => {
    expect(startTimeMillis('2026-10-04T10:00:00.000Z')).toBe(Date.parse('2026-10-04T10:00:00.000Z'));
    expect(startTimeMillis('')).toBe(-Infinity);
    expect(startTimeMillis('murks')).toBe(-Infinity);
    const sorted = ['', '2026-10-01T00:00:00Z', '2026-10-04T00:00:00Z'].sort((a, b) => startTimeMillis(b) - startTimeMillis(a));
    expect(sorted).toEqual(['2026-10-04T00:00:00Z', '2026-10-01T00:00:00Z', '']);
  });
});

describe('compareStartTimeDesc', () => {
  test('neueste zuerst; fehlende/ungültige ans Ende; zwei fehlende sind gleich (0, kein NaN)', () => {
    expect(compareStartTimeDesc('2026-10-04T00:00:00Z', '2026-10-01T00:00:00Z')).toBeLessThan(0);
    expect(compareStartTimeDesc('2026-10-01T00:00:00Z', '2026-10-04T00:00:00Z')).toBeGreaterThan(0);
    expect(compareStartTimeDesc('', '2026-10-04T00:00:00Z')).toBeGreaterThan(0);
    expect(compareStartTimeDesc('', undefined)).toBe(0);
    expect(compareStartTimeDesc('murks', null)).toBe(0);
  });
});
