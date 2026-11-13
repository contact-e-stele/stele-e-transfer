import { describe, expect, test } from 'bun:test';
import { decideRelistWithdraw, parseRelistOffers, type RelistOffer } from './relist-guard';

// Fix 208 (13.11.2026): stele-208 per Trading EndItem beendet (Listing 198671009468), danach "Listen" → "Cannot revise listing".
// Fixture = vermuteter Stand nach EndItem (vor dem Senden per GET /api/products/208/offer-status zu belegen). offerIds sind
// Test-Platzhalter, keine echten eBay-Werte.
const ENDED_208: RelistOffer[] = [
  { sku: 'stele-208-BLACK', offerId: 'OFFER-BLACK', status: 'PUBLISHED', listingId: '198671009468', listingStatus: 'ENDED' },
  { sku: 'stele-208-SILVER', offerId: 'OFFER-SILVER', status: 'PUBLISHED', listingId: '198671009468', listingStatus: 'ENDED' },
];

describe('decideRelistWithdraw (Fix 208)', () => {
  test('208 nach EndItem: beide Offers PUBLISHED am beendeten Angebot, App ohne aktives Angebot → withdraw beider Offers', () => {
    const d = decideRelistWithdraw({ offers: ENDED_208, activeListingId: null });
    expect(d.withdraw).toBe(true);
    expect(d.blocked).toBeNull();
    expect(d.offerIds).toEqual(['OFFER-BLACK', 'OFFER-SILVER']);
  });

  test('EBAY_ENDED zählt wie ENDED', () => {
    const d = decideRelistWithdraw({ offers: [{ ...ENDED_208[0], listingStatus: 'EBAY_ENDED' }], activeListingId: null });
    expect(d.withdraw).toBe(true);
  });

  test('aktives Angebot, das die App führt → nie withdraw', () => {
    const offers = ENDED_208.map(o => ({ ...o, listingStatus: 'ACTIVE' }));
    const d = decideRelistWithdraw({ offers, activeListingId: '198671009468' });
    expect(d.withdraw).toBe(false);
    expect(d.offerIds).toEqual([]);
    expect(d.blocked).toBeNull();
  });

  test('App führt ein aktives Angebot → auch beendete Offers nicht zurückziehen (nichts am laufenden Angebot anfassen)', () => {
    const d = decideRelistWithdraw({ offers: ENDED_208, activeListingId: '111111111111' });
    expect(d.withdraw).toBe(false);
  });

  test('laufendes Angebot (ACTIVE), App kennt es nicht als aktiv → kein withdraw, Sperre', () => {
    const offers = ENDED_208.map(o => ({ ...o, listingStatus: 'ACTIVE' }));
    const d = decideRelistWithdraw({ offers, activeListingId: null });
    expect(d.withdraw).toBe(false);
    expect(d.blocked).toContain('laufenden eBay-Angebot');
  });

  test('OUT_OF_STOCK läuft weiter → kein withdraw, Sperre', () => {
    const d = decideRelistWithdraw({ offers: [{ ...ENDED_208[0], listingStatus: 'OUT_OF_STOCK' }, ENDED_208[1]], activeListingId: null });
    expect(d.withdraw).toBe(false);
    expect(d.blocked).not.toBeNull();
  });

  test('UNPUBLISHED → kein withdraw', () => {
    const offers = ENDED_208.map(o => ({ ...o, status: 'UNPUBLISHED', listingId: null, listingStatus: null }));
    const d = decideRelistWithdraw({ offers, activeListingId: null });
    expect(d.withdraw).toBe(false);
    expect(d.blocked).toBeNull();
  });

  test('PUBLISHED ohne Angebotsstatus → unklar, kein withdraw (könnte laufen)', () => {
    const d = decideRelistWithdraw({ offers: [{ ...ENDED_208[0], listingStatus: null }], activeListingId: null });
    expect(d.withdraw).toBe(false);
    expect(d.blocked).toBeNull();
  });

  test('keine Offers → kein withdraw', () => {
    expect(decideRelistWithdraw({ offers: [], activeListingId: null }).withdraw).toBe(false);
  });
});

describe('parseRelistOffers', () => {
  test('liest offerId, status, listing.listingId/listingStatus, merchantLocationKey', () => {
    const rows = parseRelistOffers('stele-208-BLACK', { offers: [{ offerId: '1', status: 'PUBLISHED', merchantLocationKey: 'CN-Shenzhen', listing: { listingId: '198671009468', listingStatus: 'ENDED' } }] });
    expect(rows).toEqual([{ sku: 'stele-208-BLACK', offerId: '1', status: 'PUBLISHED', listingId: '198671009468', listingStatus: 'ENDED', merchantLocationKey: 'CN-Shenzhen' }]);
  });
  test('keine/kaputte Antwort → leer', () => {
    expect(parseRelistOffers('x', null)).toEqual([]);
    expect(parseRelistOffers('x', { errors: [] })).toEqual([]);
  });
});
