// K-005 (Kalkulator, 11.10.2026): Pflicht-Tests + Bausteine. Alle Erwartungswerte mit bun nachgerechnet (Grundgesetz 3).
import { describe, expect, test } from 'bun:test';
import { planTierReprice } from './tier-reprice';
import { buildSenkKandidaten } from './senk-kandidaten';
import { parseMarketingCampaigns, parseCampaignAds, promotionByListing, compareAdRates } from './promoted-status';
import { skuPriceDiagnostic, deriveProductShipsFrom } from './ali-sku-price';
import { computeOrderNettoErgebnis } from '../api/order-matching';

// stele-97 (PHATOIL Öl-Set), Kassenpreise laut Kalkulator; alle Varianten "Ships From: Poland"; Produkt-Versandland wie live 'China'.
const vp97 = JSON.stringify([
  { skuId: 'j', attrs: { Color: 'Jasmine', 'Ships From': 'Poland' }, price: 12.59 },
  { skuId: 'v', attrs: { Color: 'Vanilla', 'Ships From': 'Poland' }, price: 10.59 },
]);
const groups97 = [{ name: 'Color', values: ['Jasmine', 'Vanilla'] }, { name: 'Ships From', values: ['Poland'] }];
const p97 = {
  id: 97, variants: JSON.stringify(groups97), buyPrice: 10.59, sellPrice: 19.95, shipsFrom: 'China', adRate: 0,
  variantPrices: vp97, variantSellPrices: JSON.stringify({ j: 19.95, v: 16.95 }), targetMarginEur: 1.5, ebayListingId: '1234',
};

describe('K-005 Pflicht-Tests', () => {
  test('stele-97 Jasmine, Ware 12,59, EU (Ships From Poland), unbeworben, Stufe B → 17,95 / Gewinn 1,80', () => {
    const row = planTierReprice(p97, 1.5).rows.find(r => r.skuId === 'j')!;
    expect(row.newSell).toBe(17.95);
    expect(row.newProfit).toBeCloseTo(1.80, 2); // 1,798925
  });
  test('Bestellung 20-15262-74118 (VK 19,95, Einkauf manuell 12,59), unbeworben → 3,44 (Auftrag 3,50 ± 0,10)', () => {
    const r = computeOrderNettoErgebnis({
      orderTotal: 19.95, lineItems: [{ sku: 'stele-97-JASMINE', quantity: 1 }], manualBuyPrice: 12.59,
      findProduct: () => ({ id: 97, buyPrice: 10.59, shipsFrom: 'China', adRate: 0, variants: [] }),
    });
    expect(r.nettoErgebnis).toBe(3.44);
    expect(Math.abs((r.nettoErgebnis as number) - 3.50)).toBeLessThanOrEqual(0.10);
  });
  test('dieselbe Bestellung mit gespeichertem adRate 5 → 2,25 (heutiger Live-Wert, beweist: der Satz macht den Unterschied)', () => {
    const r = computeOrderNettoErgebnis({
      orderTotal: 19.95, lineItems: [{ sku: 'stele-97-JASMINE', quantity: 1 }], manualBuyPrice: 12.59,
      findProduct: () => ({ id: 97, buyPrice: 10.59, shipsFrom: 'China', adRate: 5, variants: [] }),
    });
    expect(r.nettoErgebnis).toBe(2.25);
  });
});

describe('K-005 Punkt 1: Rohpreisfelder sichtbar, Preiswahl unverändert; Produkt-Versandland aus Varianten', () => {
  test('offer_sale_price hat Vorrang (wie bisher), Rohfelder werden mitgeliefert', () => {
    const d = skuPriceDiagnostic('j', { offer_sale_price: '12.59', sku_price: '13.79', currency_code: 'EUR' });
    expect(d).toEqual({ skuId: 'j', used: 12.59, usedField: 'offer_sale_price', offerSalePrice: 12.59, offerBulkSalePrice: null, skuPrice: 13.79, currency: 'EUR' });
  });
  test('ohne Angebotspreis → sku_price', () => {
    expect(skuPriceDiagnostic('x', { sku_price: '13.79' }).usedField).toBe('sku_price');
  });
  test('stele-97: alle Varianten Poland, keine logistics_info → Poland (bisher China)', () => {
    expect(deriveProductShipsFrom(undefined, JSON.parse(vp97))).toBe('Poland');
  });
  test('logistics_info hat Vorrang; gemischte/fehlende Herkunft → China wie bisher', () => {
    expect(deriveProductShipsFrom('Spain', JSON.parse(vp97))).toBe('Spain');
    expect(deriveProductShipsFrom(null, [{ attrs: { 'Ships From': 'Poland' } }, { attrs: { 'Ships From': 'China' } }])).toBe('China');
    expect(deriveProductShipsFrom(null, [{ attrs: { Color: 'Red' } }])).toBe('China');
    expect(deriveProductShipsFrom(null, [])).toBe('China');
  });
});

describe('K-005 Punkt 2: Bewerbung je Angebot (Sell Marketing API, nur lesen)', () => {
  const campaigns = parseMarketingCampaigns({ campaigns: [
    { campaignId: 'c1', campaignName: 'Standard', campaignStatus: 'RUNNING', fundingStrategy: { fundingModel: 'COST_PER_SALE', bidPercentage: '4.0' } },
    { campaignId: 'c2', campaignName: 'Pausiert', campaignStatus: 'PAUSED', fundingStrategy: { fundingModel: 'COST_PER_SALE', bidPercentage: '9.0' } },
    { campaignId: 'c3', campaignName: 'Advanced', campaignStatus: 'RUNNING', fundingStrategy: { fundingModel: 'COST_PER_CLICK' } },
    { campaignId: 'c4', campaignName: 'Zweite', campaignStatus: 'RUNNING', fundingStrategy: { fundingModel: 'COST_PER_SALE' } },
  ] });
  const ads = {
    c1: parseCampaignAds({ ads: [
      { listingId: '111', bidPercentage: '5.0', adStatus: 'ACTIVE' },
      { listingId: '222', adStatus: 'ACTIVE' },                 // ohne eigenen Satz → Kampagnen-Satz 4
      { listingId: '333', bidPercentage: '6.0', adStatus: 'ARCHIVED' },
    ] }).ads,
    c2: parseCampaignAds({ ads: [{ listingId: '444', bidPercentage: '9.0', adStatus: 'ACTIVE' }] }).ads,
    c3: parseCampaignAds({ ads: [{ listingId: '555' }] }).ads,
    c4: parseCampaignAds({ ads: [{ listingId: '111', bidPercentage: '7.5' }] }).ads,
  };
  const promo = promotionByListing(campaigns, ads);

  test('laufende CPS-Kampagne: Satz der Anzeige, sonst Kampagnen-Satz; mehrere → höchster', () => {
    expect(promo.get('111')).toEqual({ kind: 'CPS', ratePercent: 7.5, campaignIds: ['c1', 'c4'] });
    expect(promo.get('222')).toEqual({ kind: 'CPS', ratePercent: 4, campaignIds: ['c1'] });
  });
  test('archivierte Anzeige / pausierte Kampagne zählt nicht; CPC wird nicht in % umgerechnet', () => {
    expect(promo.get('333')).toBeUndefined();
    expect(promo.get('444')).toBeUndefined();
    expect(promo.get('555')).toEqual({ kind: 'CPC', campaignIds: ['c3'] });
  });
  test('next-Link wird gelesen', () => {
    expect(parseCampaignAds({ ads: [], next: '/sell/marketing/v1/ad_campaign/c1/ad?offset=500' }).next).toContain('offset=500');
  });
  test('Abgleich: nicht beworben → 0 (stele-97), gleicher Satz → keine Abweichung, null zählt wie 5, CPC nie abweichend', () => {
    const rows = compareAdRates([
      { id: 97, ebayListingId: '999', adRate: 5 },
      { id: 1, ebayListingId: '111', adRate: 7.5 },
      { id: 2, ebayListingId: '222', adRate: null },
      { id: 3, ebayListingId: '555', adRate: 5 },
      { id: 4, ebayListingId: null, adRate: 5 },
    ], promo);
    expect(rows.map(r => [r.productId, r.ebayKind, r.ebayAdRate, r.differs])).toEqual([
      [97, 'NONE', 0, true], [1, 'CPS', 7.5, false], [2, 'CPS', 4, true], [3, 'CPC', null, false],
    ]);
  });
});

describe('K-005 Punkt 3: Senk-Kandidaten (Erwartet > Ziel + 1,00)', () => {
  test('stele-97 unbeworben: Jasmine 19,95 (Erwartet 3,44) → Vorschlag 17,95 / 1,80, erster Schritt mit 8-%-Bremse 18,95', () => {
    const k = buildSenkKandidaten([{ ...p97, groups: groups97 }]);
    expect(k.map(r => [r.skuId, r.currentSell, r.expectedEur, r.overTargetEur, r.suggestedSell, r.suggestedProfit, r.firstStepSell, r.firstStepCapped])).toEqual([
      ['j', 19.95, 3.44, 1.94, 17.95, 1.8, 18.95, true],
      ['v', 16.95, 2.98, 1.48, 14.95, 1.33, 15.95, true],
    ]);
  });
  test('mit adRate 5 liegt Jasmine (Erwartet 2,25) nicht über Ziel + 1,00 → kein Kandidat', () => {
    expect(buildSenkKandidaten([{ ...p97, adRate: 5 }])).toEqual([]);
  });
  test('ohne heutigen VK kein Kandidat (nichts geraten)', () => {
    expect(buildSenkKandidaten([{ ...p97, sellPrice: null, variantSellPrices: null }])).toEqual([]);
  });
});
