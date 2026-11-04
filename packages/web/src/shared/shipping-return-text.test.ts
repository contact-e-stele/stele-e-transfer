// OFFEN 029 — Versand-/Rückgabe-Texte aus einer Stelle; Beschreibung widerspricht der eBay-Richtlinie nie.
import { describe, test, expect } from 'bun:test';
import { parseReturnPolicy, returnTextBlocks, DELIVERY_TIME_TEXT, TEXT_VERSION_MARKER, NEUTRAL_RETURN_TEXT } from './shipping-return-text';
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

describe('Vorlage Light (live genutzt) und Black & Gold', () => {
  for (const [name, build] of [['Light', buildEbayHTMLLight], ['Black&Gold', buildEbayHTML]] as const) {
    test(`${name}: R2 überall ${DELIVERY_TIME_TEXT}, keine alte Zahl, R3 kein DHL/Deutsche Post`, () => {
      const html = build({ title: 'Test', bullets: ['a'] });
      expect(html).not.toContain('3–10');
      expect(html).not.toContain('3-7 Werktage');
      expect(html).not.toContain('Deutsche Post');
      expect(html).not.toContain('DHL');
      expect(html.split(DELIVERY_TIME_TEXT).length - 1).toBe(3); // Kachel, Reiter Versand, AGB §5
      expect(html).toContain(TEXT_VERSION_MARKER);
    });
    test(`${name}: R1 Richtlinie "Verkäufer zahlt" → "Kostenloser Rückversand", nie "Käufer trägt"`, () => {
      const html = build({ title: 'Test', bullets: ['a'], returnTerms: SELLER });
      expect(html).toContain('Kostenloser R&uuml;ckversand');
      expect(html).not.toContain(KAEUFER_ZAHLT);
      expect(html).toContain('30 TAGE R&Uuml;CKGABE');
    });
    test(`${name}: R1 Richtlinie "Käufer zahlt" → Käufer-Satz, kein "Kostenloser Rückversand"`, () => {
      const html = build({ title: 'Test', bullets: ['a'], returnTerms: BUYER });
      expect(html).toContain(KAEUFER_ZAHLT);
      expect(html).not.toContain('Kostenloser R&uuml;ckversand');
    });
    test(`${name}: R1 Richtlinie nicht lesbar → neutraler Satz, keine eigene Kostenangabe`, () => {
      const html = build({ title: 'Test', bullets: ['a'], returnTerms: null });
      expect(html).toContain(NEUTRAL_RETURN_TEXT);
      expect(html).not.toContain(KAEUFER_ZAHLT);
      expect(html).not.toContain('Kostenloser R&uuml;ckversand');
    });
  }
});

describe('Erst-Listing / Nachzieh-Weg', () => {
  const product = { title: 'Frischhaltehauben 100 Stück', bullets: JSON.stringify(['Gummizug']), images: JSON.stringify(['https://x/1.jpg']), gpsrRaw: 'x' };
  test('gespeicherte ALT-Vorlage (ohne Textmarke) wird neu gebaut → neue Texte', () => {
    const alt = buildProductDescriptionForEbay(product).html.replace(TEXT_VERSION_MARKER, '').replace(/7–12 Werktage/g, '3–10 Werktage');
    const r = resolveListingDescription(product, alt, SELLER);
    expect(r.html).toContain(TEXT_VERSION_MARKER);
    expect(r.html).not.toContain('3–10');
    expect(r.html).toContain('Kostenloser R&uuml;ckversand');
  });
  test('gespeicherte AKTUELLE Vorlage bleibt (keine unnötige Neuberechnung)', () => {
    const aktuell = buildProductDescriptionForEbay(product, SELLER).html;
    expect(resolveListingDescription(product, aktuell, SELLER).html).toBe(aktuell);
  });
  test('returnTextBlocks: SELLER-Texte enthalten nie den Käufer-Satz', () => {
    const b = returnTextBlocks(SELLER);
    expect([b.boxSub, b.agbCost, ...b.tabItems].join(' ')).not.toContain(KAEUFER_ZAHLT);
  });
});
