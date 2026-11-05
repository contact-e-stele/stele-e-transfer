// K-017 (Kalkulator 05.11.2026): Anzeige App ↔ eBay. Punkt 3 Zurücklesen, Punkt 4 Bestellungs-Gewinn nach eBay-Kennzeichen,
// Punkt 5 täglicher Abgleich (Bericht/Kachel), Punkt 6 Karten-Gewinn aus derselben Quelle wie „Erwartet“.
import { describe, test, expect } from 'bun:test';
import { computeOrderNettoErgebnis, orderAdFee } from './order-matching';
import { verifyAdsAfterSend } from '../shared/campaign-ads';
import { summarizeAdRateCheck, adRateTile, parseAdRateCheck, failedAdRateCheck } from '../shared/ad-rate-check';
import { cardMarginDisplay, marginDisplay } from '../shared/margin-display';
import { productProfitRows } from '../shared/target-margin-bulk';
import type { ListingPromotion } from '../shared/promoted-status';

// stele-127, Bestellung 20-15352-04858 (01.11.2026): 16,95 €, „Verkauft über Anzeigen“, heute adRate 0 (seit 03.11. ~08:45 nicht beworben).
// Einkauf 9,38 = der Wert, mit dem die App ohne Anzeige 4,19 € zeigt (16,95 × (1 − 0,15 × 1,19) − 0,30 × 1,19 − 9,38 = 4,19).
const p127 = { id: 127, buyPrice: 9.38, shipsFrom: 'Germany', adRate: 0, variants: [] };
const order127 = (soldViaAd: boolean | undefined, adRate = 0) => computeOrderNettoErgebnis({
  orderTotal: 16.95, manualBuyPrice: 9.38,
  lineItems: [{ sku: 'stele-127', quantity: 1, soldViaAd, lineItemCost: 16.95 }],
  findProduct: () => ({ ...p127, adRate }),
});

describe('K-017 Punkt 4: Anzeigengebühr nach eBay-Kennzeichen', () => {
  test('127 über Anzeige verkauft, heute adRate 0 → Gebühr 1,01 abgezogen, Gewinn 3,18 statt 4,19', () => {
    expect(order127(true)).toMatchObject({ nettoErgebnis: 3.18, nettoGebuehren: 4.39, nettoAnzeige: 1.01 });
  });
  test('nicht über Anzeige verkauft → keine Anzeigengebühr, auch wenn das Produkt heute 5 % hat', () => {
    expect(order127(false, 5)).toMatchObject({ nettoErgebnis: 4.19, nettoGebuehren: 3.38, nettoAnzeige: 0 });
  });
  test('über Anzeige mit heutigem Satz 3 % → dieser Satz (nicht 5 %)', () => {
    // 16,95 × (1 − 0,18 × 1,19) − 0,357 − 9,38
    expect(order127(true, 3)).toMatchObject({ nettoErgebnis: 3.58, nettoAnzeige: 0.61 });
  });
  test('ohne Kennzeichen (alte Aufrufer) → wie bisher heutiger adRate', () => {
    expect(order127(undefined, 5)).toMatchObject({ nettoErgebnis: 3.18, nettoAnzeige: null });
    expect(order127(undefined, 0)).toMatchObject({ nettoErgebnis: 4.19, nettoAnzeige: null });
  });
  test('gemischt: nur Position 1 (10,00 €) über Anzeige → 10,00 × 5 % × 1,19 = 0,595', () => {
    const r = orderAdFee(16.95, [
      { sku: 'a', quantity: 1, soldViaAd: true, lineItemCost: 10 },
      { sku: 'b', quantity: 1, soldViaAd: false, lineItemCost: 6.95 },
    ], () => ({ buyPrice: 1, shipsFrom: null, adRate: 5 }));
    expect(r?.rate).toBeNull();
    expect(r?.adFee).toBeCloseTo(0.595, 9);
  });
  test('Mapping: eBay properties.soldViaAdCampaign wird durchgereicht, fehlt → false', async () => {
    const src = await Bun.file(new URL('./ebay.ts', import.meta.url)).text();
    expect(src).toContain('soldViaAdCampaign: li.properties?.soldViaAdCampaign === true');
    const idx = await Bun.file(new URL('./index.ts', import.meta.url)).text();
    expect(idx).toContain('soldViaAd: li.soldViaAdCampaign');
  });
});

describe('K-017 Punkt 3: nach dem Senden bei eBay zurücklesen', () => {
  const ok = [{ listingId: '1', ok: true, alreadyExists: false, error: null }, { listingId: '2', ok: true, alreadyExists: false, error: null }];
  test('ok nur, wenn eBay danach genau diesen Satz zeigt', () => {
    const promo = new Map<string, ListingPromotion>([['1', { kind: 'CPS', ratePercent: 5, campaignIds: ['c'] }], ['2', { kind: 'CPS', ratePercent: 3, campaignIds: ['c'] }]]);
    const r = verifyAdsAfterSend(ok, promo, 5);
    expect(r[0].ok).toBe(true);
    expect(r[1]).toMatchObject({ ok: false, error: 'eBay-Rücklesen: 3 % statt 5 %' });
  });
  test('nicht beworben nach dem Senden → Fehler', () => {
    expect(verifyAdsAfterSend([ok[0]], new Map(), 2)[0]).toMatchObject({ ok: false, error: 'eBay-Rücklesen: nicht beworben statt 2 %' });
  });
  test('alter Weg bulk/adrate ist abgeschaltet (410)', async () => {
    const src = await Bun.file(new URL('./index.ts', import.meta.url)).text();
    const i = src.indexOf("'/ebay/listings/bulk/adrate'");
    expect(src.slice(i, i + 400)).toContain('410');
  });
});

describe('K-017 Punkt 5: täglicher Abgleich', () => {
  const rows = [
    { productId: 1, ebayListingId: 'a', storedAdRate: 5, ebayKind: 'CPS' as const, ebayAdRate: 5, differs: false },
    { productId: 2, ebayListingId: 'b', storedAdRate: 0, ebayKind: 'CPS' as const, ebayAdRate: 5, differs: true },
  ];
  test('Bericht nennt nur Abweichungen, Kachel warnt', () => {
    const r = summarizeAdRateCheck(rows, '2026-11-05T21:00:00.000Z');
    expect(r).toMatchObject({ ok: true, geprueft: 2, abweichend: [{ productId: 2, app: 0, ebay: 5 }] });
    const t = adRateTile(parseAdRateCheck(JSON.stringify(r)), Date.parse('2026-11-05T22:00:00Z'));
    expect(t).toMatchObject({ value: '1', level: 'warn' });
    expect(t.title).toContain('stele-2: App 0 % · eBay 5 %');
  });
  test('0 Abweichungen → grün; älter als 36 h → grau (veraltet); Lesefehler → Warnung', () => {
    const r = summarizeAdRateCheck([rows[0]], '2026-11-05T21:00:00.000Z');
    expect(adRateTile(r, Date.parse('2026-11-06T08:00:00Z')).level).toBe('ok');
    expect(adRateTile(r, Date.parse('2026-11-07T21:00:00Z')).level).toBe('unknown');
    expect(adRateTile(failedAdRateCheck('502', '2026-11-05T21:00:00.000Z')).level).toBe('warn');
    expect(adRateTile(null).value).toBe('–');
  });
});

describe('K-017 Punkt 6: Karten-Gewinn = Erwartet', () => {
  // Varianten-Produkt wie stele-225: Produkt-EK alt 12,69 (billigster/alter Wert), gelistete Variante EK 11,50, VK 19,95, 0 % Anzeige.
  const p = {
    id: 225, adRate: 0, shipsFrom: 'China', sellPrice: 19.95, buyPrice: 12.69, targetMarginEur: 2,
    variants: JSON.stringify([{ name: 'Farbe', values: ['Rot'] }]),
    variantPrices: JSON.stringify([{ skuId: 's1', attrs: { Farbe: 'Rot' }, price: 11.5 }]),
    variantSellPrices: JSON.stringify({ s1: 19.95 }),
  };
  test('Karte zeigt die schlechteste gelistete Zeile wie „Erwartet“, nicht Produkt-EK × eBay-Preis', () => {
    const worst = Math.min(...productProfitRows(p).rows.map(r => r.profit));
    const card = cardMarginDisplay(p)!;
    expect(card.profitEur).toBe(worst);
    const old = marginDisplay({ sellPrice: 19.95, buyPrice: 12.69, shipsFrom: 'China', adRatePercent: 0 })!;
    expect(Math.abs(old.profitEur - card.profitEur)).toBeGreaterThan(0.5); // Fixture unterscheidet alt/neu
  });
  test('ohne zählende Zeile → keine Anzeige', () => {
    expect(cardMarginDisplay({ ...p, variantSellPrices: null, variantPrices: '[]' })).toBeNull();
  });
});
