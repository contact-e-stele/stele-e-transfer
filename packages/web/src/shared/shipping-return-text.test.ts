// OFFEN 029 + NACHTRAG + OFFEN 030 — EINE Fußzeile für Versand & Rückgabe, Lieferzeit je Herkunft, nie eine geratene Zahl.
import { describe, test, expect } from 'bun:test';
import { parseReturnPolicy, shippingReturnFooter, TEXT_VERSION_MARKER, NEUTRAL_RETURN_TEXT, NEUTRAL_DELIVERY_TEXT, FOOTER_REFERENCE } from './shipping-return-text';
import { listingOrigin, deliveryTimeFor, mixedOriginError, parseDeliveryTimes, classifyOrigin } from './listing-origin';
import { buildEbayHTMLLight, buildEbayHTML } from '../web/lib/ebay-description';
import { resolveListingDescription, buildProductDescriptionForEbay } from '../api/ebay-description-builder';

const SELLER = { returnsAccepted: true, days: 30, costPayer: 'SELLER' as const };
const BUYER = { returnsAccepted: true, days: 30, costPayer: 'BUYER' as const };
const KAEUFER_ZAHLT = 'R&uuml;cksendekosten tr&auml;gt der K&auml;ufer';

describe('parseReturnPolicy (eBay Account API return_policy)', () => {
  test('SELLER, 30 DAY', () => {
    expect(parseReturnPolicy({ returnsAccepted: true, returnPeriod: { value: 30, unit: 'DAY' }, returnShippingCostPayer: 'SELLER' })).toEqual(SELLER);
  });
  test('unlesbar → null', () => {
    expect(parseReturnPolicy(null)).toBeNull();
    expect(parseReturnPolicy({ foo: 1 })).toBeNull();
  });
});

describe('NACHTRAG 029: Versand & Rückgabe nur noch in EINER Fußzeile (beide Vorlagen)', () => {
  for (const [name, build] of [['Light', buildEbayHTMLLight], ['Black&Gold', buildEbayHTML]] as const) {
    test(`${name}: kein Reiter "Versand & Retouren", keine Kachel, kein Ort/Versanddienst, keine alte Zahl`, () => {
      const html = build({ title: 'Test', bullets: ['a'], deliveryTime: '7–12 Werktage', returnTerms: SELLER });
      expect(html).not.toContain('Versand &amp; Retouren');
      expect(html).not.toContain('INFO BOXEN');
      expect(html).not.toContain('KOSTENLOSER VERSAND');
      expect(html).not.toContain('Deutsche Post');
      expect(html).not.toContain('DHL');
      expect(html).not.toContain('WIESBADEN &middot; DEUTSCHLAND');
      expect(html).not.toContain('3–10');
      expect(html).toContain(TEXT_VERSION_MARKER);
      // genau EINE Stelle mit Lieferzeit und Rückversand; AGB verweisen darauf
      expect(html.split('Lieferzeit 7–12 Werktage').length - 1).toBe(1);
      expect(html.split('Kostenloser R&uuml;ckversand').length - 1).toBe(1);
      expect(html.split(FOOTER_REFERENCE).length - 1).toBe(2); // AGB Lieferung + AGB Rücksendekosten
    });
    test(`${name}: Rückversand nur aus der Richtlinie — Käufer zahlt / unbekannt`, () => {
      expect(build({ title: 'T', bullets: ['a'], returnTerms: BUYER })).toContain(KAEUFER_ZAHLT);
      const neutral = build({ title: 'T', bullets: ['a'], returnTerms: null });
      expect(neutral).toContain(NEUTRAL_RETURN_TEXT);
      expect(neutral).not.toContain(KAEUFER_ZAHLT);
      expect(neutral).not.toContain('Kostenloser R&uuml;ckversand');
    });
    test(`${name}: ohne Lieferzeit → neutraler Satz, keine Zahl`, () => {
      const html = build({ title: 'T', bullets: ['a'], deliveryTime: null });
      expect(html).toContain(NEUTRAL_DELIVERY_TEXT);
      expect(html).not.toMatch(/Lieferzeit \d/);
    });
  }
  test('Fußzeile wörtlich', () => {
    expect(shippingReturnFooter('7–12 Werktage', SELLER)).toBe('Versand &amp; R&uuml;ckgabe: Lieferzeit 7–12 Werktage &middot; Kostenloser R&uuml;ckversand &middot; 30 Tage R&uuml;ckgabe');
  });
});

describe('OFFEN 030: Herkunft → Lieferzeit (Inhaber 17:45)', () => {
  test('China-Artikel → 7–12 Werktage', () => {
    const o = listingOrigin('China', []);
    expect(o.kind).toBe('CN');
    expect(deliveryTimeFor(o)).toBe('7–12 Werktage');
  });
  test('EU-Artikel → nie 7–12, ohne hinterlegten Wert keine Zahl (null → neutraler Satz)', () => {
    for (const land of ['Spain', 'Poland', 'Czech Republic', 'Germany']) {
      const o = listingOrigin(land, []);
      expect(['EU', 'DE']).toContain(o.kind);
      expect(deliveryTimeFor(o)).toBeNull();
    }
  });
  test('EU-Artikel mit Wert in den Einstellungen → genau dieser Wert', () => {
    const times = parseDeliveryTimes(JSON.stringify({ EU: '4–8 Werktage' }));
    expect(deliveryTimeFor(listingOrigin('Spain', []), times)).toBe('4–8 Werktage');
    expect(times.CN).toBe('7–12 Werktage');
  });
  test('Herkunft je Variante ("Ships From") schlägt Produkt-Herkunft; gemischt → Sperre', () => {
    const o = listingOrigin('China', [{ 'Ships From': 'China', Color: 'Rot' }, { 'Ships From': 'Spain', Color: 'Rot' }]);
    expect(o.mixed).toBe(true);
    expect(deliveryTimeFor(o)).toBeNull();
    expect(mixedOriginError(o)).toContain('China, Spain');
    expect(mixedOriginError(listingOrigin('China', [{ 'Ships From': 'China' }, {}]))).toBeNull();
  });
  test('unbekannte Herkunft ist für die Anzeige NICHT China', () => {
    expect(classifyOrigin('').kind).toBe('UNKNOWN');
    expect(classifyOrigin('Unknown').kind).toBe('UNKNOWN');
    expect(deliveryTimeFor(listingOrigin('', []))).toBeNull();
  });
  test('ungültige Einstellungswerte ohne Zahl werden ignoriert', () => {
    expect(parseDeliveryTimes(JSON.stringify({ EU: 'schnell' })).EU).toBeUndefined();
    expect(parseDeliveryTimes('kaputt')).toEqual({ CN: '7–12 Werktage' });
  });
});

describe('Erst-Listing / Nachzieh-Weg', () => {
  const china = { title: 'Frischhaltehauben 100 Stück', bullets: JSON.stringify(['Gummizug']), images: JSON.stringify(['https://x/1.jpg']), gpsrRaw: 'x', shipsFrom: 'China' };
  const spanien = { ...china, shipsFrom: 'Spain' };
  test('Builder: China → Fußzeile 7–12, Spanien → neutral', () => {
    expect(buildProductDescriptionForEbay(china, { returnTerms: SELLER }).html).toContain('Lieferzeit 7–12 Werktage');
    const es = buildProductDescriptionForEbay(spanien, { returnTerms: SELLER }).html;
    expect(es).not.toContain('7–12');
    expect(es).toContain(NEUTRAL_DELIVERY_TEXT);
  });
  test('gespeicherte ALT-Vorlage (ohne Textmarke) wird neu gebaut', () => {
    const alt = buildProductDescriptionForEbay(china, { returnTerms: SELLER }).html.replace(TEXT_VERSION_MARKER, '');
    const r = resolveListingDescription(china, alt, { returnTerms: SELLER });
    expect(r.html).toContain(TEXT_VERSION_MARKER);
  });
  test('gespeicherte aktuelle Vorlage mit FALSCHER Lieferzeit (Herkunft geändert) wird neu gebaut', () => {
    const alsChina = buildProductDescriptionForEbay(china, { returnTerms: SELLER }).html;
    const r = resolveListingDescription(spanien, alsChina, { returnTerms: SELLER });
    expect(r.html).not.toContain('7–12');
  });
  test('gespeicherte aktuelle, passende Vorlage bleibt unverändert', () => {
    const aktuell = buildProductDescriptionForEbay(china, { returnTerms: SELLER }).html;
    expect(resolveListingDescription(china, aktuell, { returnTerms: SELLER }).html).toBe(aktuell);
  });
});
