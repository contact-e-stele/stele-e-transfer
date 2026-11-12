import { describe, expect, test } from 'bun:test';
import { planRepublish } from './republish-group';

// AUFTRAG 048, Live-Stand stele-208 am 12.11.2026 nach "Käuferpreis heben" Black: beide Offers CN-Shenzhen, Käufer = Angebotsdaten.
const base = { productId: 208, ebayStatus: 'listed', ebayListingId: '198671009468', isVariant: true, liveLocation: 'Wiesbaden, DE' };
const ok = [
  { sku: 'stele-208-BLACK', merchantLocationKey: 'CN-Shenzhen', offerPrice: 17.95, buyerPrice: 17.95 },
  { sku: 'stele-208-SILVER', merchantLocationKey: 'CN-Shenzhen', offerPrice: 17.45, buyerPrice: 17.45 },
];

describe('planRepublish (048)', () => {
  test('208: gleicher Lagerort, keine Preis-Abweichung → ok, Gruppe stele-208-GROUP', () => {
    const p = planRepublish({ ...base, offers: ok });
    expect(p.ok).toBe(true);
    expect(p.groupKey).toBe('stele-208-GROUP');
    expect(p.locationKey).toBe('CN-Shenzhen');
  });
  test('Stand vor dem Heben (Black Käufer 17,45 / Offer 17,95) → gesperrt, publish würde den Preis ändern', () => {
    const p = planRepublish({ ...base, offers: [{ ...ok[0], buyerPrice: 17.45 }, ok[1]] });
    expect(p.ok).toBe(false);
    expect(p.reason).toContain('stele-208-BLACK (17.45 / 17.95)');
  });
  test('verschiedene Lagerorte → gesperrt', () => {
    const p = planRepublish({ ...base, offers: [ok[0], { ...ok[1], merchantLocationKey: null }] });
    expect(p.ok).toBe(false);
    expect(p.reason).toContain('nicht denselben Lagerort');
  });
  test('Einzelartikel / nicht gelistet / keine Offers → gesperrt', () => {
    expect(planRepublish({ ...base, isVariant: false, offers: ok }).ok).toBe(false);
    expect(planRepublish({ ...base, ebayStatus: 'draft', offers: ok }).ok).toBe(false);
    expect(planRepublish({ ...base, offers: [] }).ok).toBe(false);
  });
});
