// OFFEN 030 Teil 2: Lagerort / Versandrichtlinie / Lieferschätzung / Ampel / Bestandsliste je Herkunft.
import { describe, expect, test } from 'bun:test';
import { listingOrigin } from './listing-origin';
import {
  businessDaysAfter, compareDeliveryEstimate, countryIso, inventoryRow, locationKey, NO_ORIGIN_ERROR, originAmpel,
  parseBrowseDeliveryEstimate, parseDayRange, parseFulfillmentPolicies, parseOriginLocations, resolveFulfillmentPolicy, resolveLocation,
  type FulfillmentPolicyInfo,
} from './origin-shipping';

const CN = listingOrigin('China', []);
const PL = listingOrigin(null, [{ 'Ships From': 'Poland' }]);
const DE = listingOrigin('Germany', []);
const UNKNOWN = listingOrigin(null, []);
const MIXED = listingOrigin('China', [{ 'Ships From': 'China' }, { 'Ships From': 'Spain' }]);

// Echte Kontodaten 04.11.2026 (GET /api/ebay/policies, Auszug) + die 2 geplanten Richtlinien
const LIVE_POLICIES: FulfillmentPolicyInfo[] = [
  { id: '276306574014', name: 'Versand', handlingDays: 10, services: ['DE_Paket'], freeShipping: true },
  { id: '294010673014', name: 'Stele 5d Handling', handlingDays: 5, services: ['DE_DHLPaket'], freeShipping: true },
];
const WITH_ORIGIN_POLICIES: FulfillmentPolicyInfo[] = [
  ...LIVE_POLICIES,
  { id: 'FP-CN', name: 'Versand aus China', handlingDays: 2, services: ['DE_StandardversandAusDemAusland'], freeShipping: true },
  { id: 'FP-EU', name: 'Versand aus EU-Lager', handlingDays: 1, services: ['DE_TrackedDeliveryFromAbroad'], freeShipping: true },
];

describe('Lagerort je Herkunft', () => {
  test('China ohne Eintrag → CN-Shenzhen, als geschätzt markiert — nie "default"/Wiesbaden', () => {
    const r = resolveLocation(CN, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.key).toBe('CN-Shenzhen');
    expect(r.value.country).toBe('CN');
    expect(r.value.stateOrProvince).toBe('Guangdong');
    expect(r.value.estimated).toBe(true);
    expect(r.value.key).not.toBe('default');
  });
  test('China mit eingetragenem Ort → dieser Ort, nicht geschätzt', () => {
    const r = resolveLocation(CN, { CN: { city: 'Yiwu', stateOrProvince: 'Zhejiang' } });
    expect(r.ok && r.value.key).toBe('CN-Yiwu');
    expect(r.ok && r.value.estimated).toBe(false);
  });
  test('EU-Land ohne eingetragenen Ort → Sperre, kein geratener Ort', () => {
    const r = resolveLocation(PL, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Kein Lagerort für Herkunft PL');
  });
  test('EU-Land mit Ort + PLZ → PL-<Ort>', () => {
    const r = resolveLocation(PL, { PL: { city: 'Łódź', postalCode: '90-001' } });
    expect(r.ok && r.value.key).toBe('PL-Lodz');
    expect(r.ok && r.value.postalCode).toBe('90-001');
  });
  test('Deutschland braucht einen eingetragenen Ort (Lieferanten-Lager ≠ Wiesbaden)', () => {
    expect(resolveLocation(DE, {}).ok).toBe(false);
    const r = resolveLocation(DE, { DE: { city: 'Wiesbaden', postalCode: '65205' } });
    expect(r.ok && r.value.key).toBe('DE-Wiesbaden');
  });
  test('ohne Herkunft → Sperre mit Klartext', () => {
    const r = resolveLocation(UNKNOWN, {});
    expect(r).toEqual({ ok: false, error: NO_ORIGIN_ERROR });
  });
  test('gemischte Herkunft → Sperre (Gesetzbuch Nr 114)', () => {
    const r = resolveLocation(MIXED, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unterschiedlicher Herkunft');
  });
  test('Land außerhalb China/EU → Sperre', () => {
    expect(resolveLocation(listingOrigin('United States', []), {}).ok).toBe(false);
  });
  test('locationKey: nur erlaubte Zeichen, max 36', () => {
    expect(locationKey('DE', 'Frankfurt am Main')).toBe('DE-FrankfurtamMain');
    expect(locationKey('DE', 'Köln')).toBe('DE-Koeln');
    expect(locationKey('CN', 'x'.repeat(50)).length).toBe(36);
  });
  test('countryIso', () => {
    expect(countryIso('China Mainland')).toBe('CN');
    expect(countryIso('Czech Republic')).toBe('CZ');
    expect(countryIso('Mars')).toBeNull();
  });
  test('parseOriginLocations verwirft Unsinn', () => {
    expect(parseOriginLocations('{"pl":{"city":"Lodz","postalCode":"90-001"},"XYZ":{"city":"a"},"ES":{"city":""}}')).toEqual({ PL: { city: 'Lodz', postalCode: '90-001' } });
    expect(parseOriginLocations('kaputt')).toEqual({});
  });
});

describe('Versandrichtlinie je Herkunft (nur gelesen)', () => {
  test('heutiges Konto: Richtlinie "Versand aus China" fehlt → Sperre, nichts wird angelegt', () => {
    const r = resolveFulfillmentPolicy(CN, LIVE_POLICIES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('"Versand aus China" fehlt');
  });
  test('mit angelegten Richtlinien: China → FP-CN, EU und DE → FP-EU', () => {
    expect(resolveFulfillmentPolicy(CN, WITH_ORIGIN_POLICIES)).toMatchObject({ ok: true, value: { id: 'FP-CN' } });
    expect(resolveFulfillmentPolicy(PL, WITH_ORIGIN_POLICIES)).toMatchObject({ ok: true, value: { id: 'FP-EU' } });
    expect(resolveFulfillmentPolicy(DE, WITH_ORIGIN_POLICIES)).toMatchObject({ ok: true, value: { id: 'FP-EU' } });
  });
  test('doppelter Name → nicht eindeutig → Sperre', () => {
    const dup = [...WITH_ORIGIN_POLICIES, { id: 'FP-CN2', name: 'versand aus china', handlingDays: 3, services: [], freeShipping: true }];
    expect(resolveFulfillmentPolicy(CN, dup).ok).toBe(false);
  });
  test('parseFulfillmentPolicies (Form der eBay-Antwort)', () => {
    const parsed = parseFulfillmentPolicies({ fulfillmentPolicies: [
      { fulfillmentPolicyId: '276306574014', name: 'Versand', handlingTime: { value: 10, unit: 'DAY' }, shippingOptions: [{ optionType: 'DOMESTIC', shippingServices: [{ shippingServiceCode: 'DE_Paket', shippingCost: { value: '0.0', currency: 'EUR' }, freeShipping: true }] }] },
      { name: 'ohne id' },
    ] });
    expect(parsed).toEqual([{ id: '276306574014', name: 'Versand', handlingDays: 10, services: ['DE_Paket'], freeShipping: true }]);
  });
});

describe('Lieferschätzung zurücklesen und vergleichen', () => {
  test('Werktage: Live-Beleg stele-120 am 04.11.2026 → 13.11.–19.11. = 7–11 Werktage', () => {
    expect(businessDaysAfter('2026-11-04T21:00:00Z', '2026-11-13T08:00:00Z')).toBe(7);
    expect(businessDaysAfter('2026-11-04T21:00:00Z', '2026-11-19T08:00:00Z')).toBe(11);
  });
  test('innerhalb der Fußzeile (7–12) → grün', () => {
    const r = compareDeliveryEstimate('7–12 Werktage', { minDate: '2026-11-13T08:00:00.000Z', maxDate: '2026-11-19T08:00:00.000Z' }, '2026-11-04T21:00:00Z');
    expect(r.color).toBe('green');
    expect(r.ebay).toEqual({ min: 7, max: 11 });
  });
  test('eBay länger als die Fußzeile → rot mit beiden Werten', () => {
    const r = compareDeliveryEstimate('7–12 Werktage', { minDate: '2026-11-13T08:00:00.000Z', maxDate: '2026-11-24T08:00:00.000Z' }, '2026-11-04T21:00:00Z');
    expect(r.color).toBe('red');
    expect(r.text).toContain('Fußzeile 7–12');
    expect(r.text).toContain('eBay 7–14');
  });
  test('eBay kürzer als die Fußzeile → auch rot (Bereich passt nicht)', () => {
    expect(compareDeliveryEstimate('7–12 Werktage', { minDate: '2026-11-09T08:00:00Z', maxDate: '2026-11-12T08:00:00Z' }, '2026-11-04T21:00:00Z').color).toBe('red');
  });
  test('keine Schätzung → grau; Fußzeile ohne Zahl → rot', () => {
    expect(compareDeliveryEstimate('7–12 Werktage', null, '2026-11-04T21:00:00Z').color).toBe('grey');
    expect(compareDeliveryEstimate(null, { minDate: '2026-11-13T08:00:00Z', maxDate: '2026-11-19T08:00:00Z' }, '2026-11-04T21:00:00Z').color).toBe('red');
  });
  test('parseDayRange', () => {
    expect(parseDayRange('7–12 Werktage')).toEqual({ min: 7, max: 12 });
    expect(parseDayRange('3 bis 5 Werktage')).toEqual({ min: 3, max: 5 });
    expect(parseDayRange('Lieferzeit gemäß eBay')).toBeNull();
  });
  test('parseBrowseDeliveryEstimate (Form der Browse-Antwort)', () => {
    expect(parseBrowseDeliveryEstimate({ shippingOptions: [{ shippingCostType: 'FIXED' }, { minEstimatedDeliveryDate: '2026-11-13T08:00:00.000Z', maxEstimatedDeliveryDate: '2026-11-19T08:00:00.000Z' }] }))
      .toEqual({ minDate: '2026-11-13T08:00:00.000Z', maxDate: '2026-11-19T08:00:00.000Z' });
    expect(parseBrowseDeliveryEstimate({})).toBeNull();
  });
});

describe('Ampel Standort', () => {
  test('heute (Richtlinie fehlt) → rot und sperrt', () => {
    const a = originAmpel({ origin: CN, locations: {}, policies: LIVE_POLICIES });
    expect(a.standort).toBe('red');
    expect(a.blockError).toContain('Versand aus China');
  });
  test('Richtlinien nicht lesbar → rot und sperrt', () => {
    expect(originAmpel({ origin: CN, locations: {}, policies: null }).blockError).toContain('nicht lesbar');
  });
  test('alles passend → grün, Lieferzeit aus Herkunft', () => {
    const a = originAmpel({ origin: CN, locations: {}, policies: WITH_ORIGIN_POLICIES });
    expect(a.standort).toBe('green');
    expect(a.location?.key).toBe('CN-Shenzhen');
    expect(a.policy?.id).toBe('FP-CN');
    expect(a.deliveryTime).toBe('7–12 Werktage');
    expect(a.blockError).toBeNull();
  });
  test('gelistet mit Lagerort "default" (Bestand heute) → rot mit Klartext, sperrt aber nicht nachträglich', () => {
    const a = originAmpel({ origin: CN, locations: {}, policies: WITH_ORIGIN_POLICIES, live: { merchantLocationKey: 'default', fulfillmentPolicyId: '276306574014' } });
    expect(a.standort).toBe('red');
    expect(a.standortText).toContain('"default"');
    expect(a.standortText).toContain('CN-Shenzhen');
    expect(a.blockError).toBeNull();
  });
});

describe('Bestandsliste (nur lesen)', () => {
  test('China-Angebot heute: default/276306574014 → CN-Shenzhen/FP-CN, Umstellung nötig', () => {
    const r = inventoryRow({ productId: 120, itemId: '198693421029', origin: CN, locations: {}, policies: WITH_ORIGIN_POLICIES, live: { merchantLocationKey: 'default', fulfillmentPolicyId: '276306574014' } });
    expect(r).toEqual({
      steleNr: 'stele-120', itemId: '198693421029', herkunft: 'China',
      heuteLagerort: 'default', neuerLagerort: 'CN-Shenzhen (Ort geschätzt)',
      heuteRichtlinie: '276306574014 "Versand"', neueRichtlinie: 'FP-CN "Versand aus China"',
      umstellungNoetig: true,
    });
  });
  test('Polen ohne Ort → Grund statt Ziel, nicht entscheidbar', () => {
    const r = inventoryRow({ productId: 97, itemId: '198601100567', origin: PL, locations: {}, policies: WITH_ORIGIN_POLICIES, live: { merchantLocationKey: 'default', fulfillmentPolicyId: '294010673014' } });
    expect(r.herkunft).toBe('Poland');
    expect(r.neuerLagerort).toContain('Kein Lagerort für Herkunft PL');
    expect(r.umstellungNoetig).toBeNull();
  });
  test('Offer nicht lesbar → "nicht lesbar", nicht entscheidbar', () => {
    const r = inventoryRow({ productId: 1, itemId: '1', origin: CN, locations: {}, policies: WITH_ORIGIN_POLICIES, live: null });
    expect(r.heuteLagerort).toBe('nicht lesbar');
    expect(r.umstellungNoetig).toBeNull();
  });
});
