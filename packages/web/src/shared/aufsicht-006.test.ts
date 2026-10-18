import { describe, expect, test } from 'bun:test';
import { ratingGate, parseMinRating, DEFAULT_MIN_RATING } from './rating-gate';
import { preselectVariants } from './variant-preselect';
import { pruneRemovedVariantEntries, parseMaxVariantCombinations, maxVariantsError } from './variant-cleanup';
import { computeMinSellPrice, profitAtSellPrice, DEFAULT_PRICING_CONFIG } from './pricing';

// Echte Daten stele-213 (App-DB, 18.10.2026, nicht gelistet): 11 Farben, 12 Einträge (White doppelt), China, Anzeige 5 %, Stufe 2,00 €.
const g213 = [{ name: 'Varianten', values: ['Blue', 'Purple', 'Red', 'Gray', 'White', 'Light blue', 'Black', 'Yellow', 'Brown', 'Deep blue', 'Pink'] }];
const e = (skuId: string, c: string, price: number, stock: number) => ({ skuId, attrs: { Color: c }, price, stock });
const vp213 = [
  e('12000043169280438', 'Blue', 1.49, 43), e('12000043169280442', 'Purple', 1.29, 50), e('12000043169280441', 'Red', 1.55, 73),
  e('12000043169280440', 'Gray', 1.39, 20), e('12000060779492755', 'White', 1.45, 23), e('12000043169280454', 'Light blue', 1.49, 17),
  e('12000043169280452', 'Black', 1.35, 77), e('12000043169280448', 'Yellow', 1.59, 62), e('12000043169280459', 'Brown', 1.59, 59),
  e('12000043169280458', 'Deep blue', 1.59, 52), e('12000043169280457', 'Pink', 1.59, 23), e('12000060829289109', 'White', 1.49, 14),
];
const cfg = { ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur, vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: 5 };
const profitAtSuggested = (x: { price?: number }) => {
  const sell = computeMinSellPrice({ ...cfg, buyPrice: x.price!, isChinaOrigin: true, targetMarginEur: 2, safetyBufferEur: 0, rounding: 'floor95' }).minSellPrice;
  return profitAtSellPrice({ ...cfg, sellPrice: sell, buyPrice: x.price!, isChinaOrigin: true });
};

describe('OFFEN 006 R1 Sterne-Sperre', () => {
  test('Standard 4,2; ab 4,2 ok, darunter gesperrt', () => {
    expect(DEFAULT_MIN_RATING).toBe(4.2);
    expect(ratingGate(4.2, 120).ok).toBe(true);
    expect(ratingGate(4.8, 3000).ok).toBe(true);
    const r = ratingGate(4.1, 500);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('Nur 4,1 Sterne');
  });
  test('Bewertung fehlt (HTML-Notweg) → gesperrt "Sterne nicht lesbar"; 0 Bewertungen → gesperrt', () => {
    expect(ratingGate(null, null).reason).toContain('Sterne nicht lesbar');
    expect(ratingGate(undefined, 50).reason).toContain('Sterne nicht lesbar');
    expect(ratingGate(0, 0).reason).toContain('Keine Bewertungen');
  });
  test('Grenze einstellbar', () => {
    expect(ratingGate(4.3, 10, 4.5).ok).toBe(false);
    expect(parseMinRating('4.5')).toBe(4.5);
    expect(parseMinRating('abc')).toBe(4.2);
    expect(parseMinRating('7')).toBe(4.2);
  });
});

describe('OFFEN 006 R2 höchstens 5 Varianten, Vorauswahl', () => {
  test('stele-213: 11 Farben → 5 gewählt, alle mit Lager ≥ 5 und Gewinn ≥ 1 €, bester Gewinn zuerst', () => {
    const r = preselectVariants(g213, vp213, 5, profitAtSuggested);
    expect(r.applied).toBe(true);
    expect(r.kept.length).toBe(5);
    expect(r.removed.length).toBe(6);
    expect(r.groups[0].values).toEqual(r.kept);
    const byValue = new Map(r.rows.map(x => [x.value, x]));
    for (const v of r.kept) { expect(byValue.get(v)!.stock!).toBeGreaterThanOrEqual(5); expect(byValue.get(v)!.profit!).toBeGreaterThanOrEqual(1); }
    const minKept = Math.min(...r.kept.map(v => byValue.get(v)!.profit!));
    const maxRemoved = Math.max(...r.removed.filter(v => byValue.get(v)!.eligible).map(v => byValue.get(v)!.profit!));
    expect(minKept).toBeGreaterThanOrEqual(maxRemoved);
    expect(maxVariantsError(r.groups)).toBeNull();
  });
  test('Lager < 5 oder unbekannt → nicht wählbar (Yellow/Brown wären sonst unter den besten 5)', () => {
    const base = preselectVariants(g213, vp213, 5, profitAtSuggested);
    expect(base.kept).toContain('Yellow');
    expect(base.kept).toContain('Brown');
    const vp = vp213.map(x => (x.attrs.Color === 'Yellow' ? { ...x, stock: 4 } : x.attrs.Color === 'Brown' ? { ...x, stock: undefined as unknown as number } : x));
    const r = preselectVariants(g213, vp, 5, profitAtSuggested);
    expect(r.kept).not.toContain('Yellow');
    expect(r.kept).not.toContain('Brown');
    expect(r.kept.length).toBe(5);
  });
  test('höchstens 5 oder weniger Varianten → keine Automatik', () => {
    const small = [{ name: 'Varianten', values: g213[0].values.slice(0, 5) }];
    expect(preselectVariants(small, vp213, 5, profitAtSuggested).applied).toBe(false);
  });
  test('mehrere Gruppen → keine Automatik, Hinweis', () => {
    const r = preselectVariants([g213[0], { name: 'Größe', values: ['S', 'M'] }], vp213, 5, profitAtSuggested);
    expect(r.applied).toBe(false);
    expect(r.reason).toContain('Mehrere Varianten-Gruppen');
  });
  test('keine Variante erfüllt die Regel → nichts gelöscht', () => {
    const r = preselectVariants(g213, vp213, 5, () => 0.5);
    expect(r.applied).toBe(false);
    expect(r.groups).toBe(g213);
  });
  test('Obergrenze einstellbar', () => {
    expect(parseMaxVariantCombinations('7')).toBe(7);
    expect(parseMaxVariantCombinations(null)).toBe(5);
    expect(parseMaxVariantCombinations('0')).toBe(5);
    expect(maxVariantsError(g213, 11)).toBeNull();
  });
});

describe('OFFEN 006 Teil 1 Fix B: entfernte Werte verschwinden aus der Rechnung', () => {
  test('9 Einträge, 2 Werte entfernt → 7 bleiben (Daten: die ersten 9 Farben von stele-213)', () => {
    const old9 = [{ name: 'Varianten', values: g213[0].values.slice(0, 9) }];
    const entries9 = vp213.filter(x => old9[0].values.includes(x.attrs.Color) && x.skuId !== '12000060829289109');
    expect(entries9.length).toBe(9);
    const new7 = [{ name: 'Varianten', values: old9[0].values.filter(v => v !== 'Gray' && v !== 'Brown') }];
    const r = pruneRemovedVariantEntries(old9, new7, entries9);
    expect(r.kept.length).toBe(7);
    expect(r.removed.map(x => x.attrs.Color).sort()).toEqual(['Brown', 'Gray']);
  });
});
