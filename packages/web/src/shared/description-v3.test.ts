// Beschreibung v3 (06.11.2026). Fixtures: echte Werte aus dem DB-Backup stele-db-2026-11-05-23h.json (Produkte 225, 119, 127),
// Maße aus DESIGN-VORGABE v2.3 Regel D2 (stele-119 "↔ 14 – 29 cm", Quelle c, Beschreibungsbild 3).
import { describe, expect, test } from 'bun:test';
import { piecesOf, formatPieces, measureText, factRows, headingText, v3Bullets, DESCRIPTION_V3_MARKER } from './description-v3';
import { shippingReturnFooterLines, USTG19_FOOTER_TEXT } from './shipping-return-text';
import { buildEbayHTMLLight } from '../web/lib/ebay-description';
import { buildProductDescriptionForEbay } from '../api/ebay-description-builder';
import { findDescriptionComplianceViolations } from './description-compliance';

// echte Daten (Backup 05.11.2026 23:35)
const P225 = {
  title: 'Aufblasbares Reisekissen Nackenkissen Kopfstütze Kinnstütze, verbesserte Version',
  variants: [{ name: 'Varianten', values: ['BLAU', 'SCHWARZ', 'GRAU'] }],
  specs: { 'Brand Name': 'NONE', Filling: 'COTTON', 'High-concerned chemical': 'none', Origin: 'Mainland China', CN: 'Guangdong', Choice: 'yes' },
};
const P119 = {
  title: 'Einweg Frischhaltehauben, Lebensmittelabdeckung',
  variants: [{ name: 'Varianten ', values: ['200pcs', '100pcs'] }],
  specs: { 'Brand Name': 'NONE', 'High-concerned chemical': 'none', Origin: 'Mainland China', Choice: 'yes' },
};
const P127 = {
  title: 'Lebensmittelhaube Frischhalteplatte Mehrweg Abdeckungen Bunt Essensschutz',
  variants: [{ name: 'Varianten ', values: ['Multicolour 100pcs', 'Multicolour 50pcs', 'White 500pcs', 'Multicolour 500pcs'] }],
  specs: { 'Brand Name': 'NONE', Material: 'Plastic', 'Require Food Contact': 'Yes', 'High-concerned chemical': 'none', Origin: 'Mainland China', Choice: 'yes', semi_Choice: 'yes' },
};
const STRETCH_119 = { kind: 'STRETCH' as const, values: [14, 29], source: 'c' as const, location: 'Beschreibungsbild 3' };

describe('Menge (Inhalt)', () => {
  test('aus Variantennamen: 119 → 100 / 200 Stück, 127 → 50 / 100 / 500 Stück, 225 → keine', () => {
    expect(formatPieces(piecesOf(P119))).toBe('100 / 200 Stück');
    expect(formatPieces(piecesOf(P127))).toBe('50 / 100 / 500 Stück');
    expect(formatPieces(piecesOf(P225))).toBeNull();
  });
  test('variantDetails.pieces hat Vorrang vor dem Variantennamen', () => {
    expect(piecesOf({ ...P119, variantDetails: { a: { displayNameDe: 'Transparent', pieces: 100 } } })).toEqual([100]);
  });
  test('"Ships From" zählt nicht als Variante', () => {
    expect(piecesOf({ title: 'x', variants: [{ name: 'Ships From', values: ['10pcs'] }] })).toEqual([]);
  });
});

describe('Maße (D2)', () => {
  test('einheitlich → ein Wert; verschieden → je Variante; keine Daten → nichts', () => {
    expect(measureText({ a: { displayNameDe: 'A', pieces: 100, measure: STRETCH_119 }, b: { displayNameDe: 'B', pieces: 200, measure: STRETCH_119 } }))
      .toEqual({ uniform: '↔ 14 – 29 cm', perVariant: null });
    expect(measureText({ s: { displayNameDe: 'S', pieces: 1, measure: { kind: 'D', values: [40], source: 'a', location: 'Variante' } }, m: { displayNameDe: 'M', pieces: 1, measure: { kind: 'D', values: [50], source: 'a', location: 'Variante' } } }))
      .toEqual({ uniform: null, perVariant: 'S: Ø 40 cm &middot; M: Ø 50 cm' });
    expect(measureText(null)).toEqual({ uniform: null, perVariant: null });
  });
});

describe('Datentabelle — nur belegte Zeilen', () => {
  test('127: Material übersetzt, Farbe aus Varianten, Inhalt', () => {
    expect(factRows(P127)).toEqual([
      { label: 'Material', value: 'Kunststoff' },
      { label: 'Farbe', value: 'Mehrfarbig / Weiß' },
      { label: 'Inhalt', value: '50 / 100 / 500 Stück' },
    ]);
  });
  test('225: nur Farbe (Füllung/Herkunft/Marke sind keine v3-Zeilen)', () => {
    expect(factRows(P225)).toEqual([{ label: 'Farbe', value: 'Blau / Schwarz / Grau' }]);
  });
  test('119: nur Inhalt (keine Material-/Farbangabe vorhanden → keine geratene Zeile)', () => {
    expect(factRows(P119)).toEqual([{ label: 'Inhalt', value: '100 / 200 Stück' }]);
  });
  test('A-045-Felder gehen vor, unbekanntes englisches Material fällt weg, deutsches bleibt', () => {
    const rows = factRows({ ...P119, material: 'PE', usePurpose: 'Frischhaltehaube, auch als Duschhaube nutzbar', usageNote: 'einmalig verwendbar', manualAspects: { Produktart: 'Frischhaltehaube' }, variantDetails: { a: { displayNameDe: 'Transparent', pieces: 100, measure: STRETCH_119 } } });
    expect(rows.map(r => r.label)).toEqual(['Produktart', 'Material', 'Maße'.replace('ß', '&szlig;'), 'Inhalt', 'Verwendung']);
    expect(factRows({ title: 'x', specs: { Material: 'Fancyfoam' } })).toEqual([]);
    expect(factRows({ title: 'x', specs: { Material: 'Edelstahl' } })).toEqual([{ label: 'Material', value: 'Edelstahl' }]);
  });
  test('Nutzer-Freitext wird HTML-sicher ausgegeben', () => {
    expect(factRows({ title: 'x', material: '<b>Kunststoff</b>' })[0].value).toBe('&lt;b&gt;Kunststoff&lt;/b&gt;');
  });
});

describe('Überschrift Name + Menge + Maß', () => {
  test('119 mit Maß aus D2', () => {
    expect(headingText({ ...P119, variantDetails: { a: { displayNameDe: 'T', pieces: 100, measure: STRETCH_119 }, b: { displayNameDe: 'T', pieces: 200, measure: STRETCH_119 } } }))
      .toBe('Einweg Frischhaltehauben, Lebensmittelabdeckung &middot; 100 / 200 Stück &middot; ↔ 14 – 29 cm');
  });
  test('ohne Daten nur der Name; Menge nicht doppelt, wenn schon im Namen', () => {
    expect(headingText(P225)).toBe(P225.title);
    expect(headingText({ title: 'Hauben 100 Stück', variants: [{ name: 'Menge', values: ['100pcs'] }] })).toBe('Hauben 100 Stück');
  });
});

describe('Stichpunkte ✓ STICHWORT', () => {
  test('höchstens 5, Versand-/Rückgabe-Füllsätze fallen weg, Stichwort nur wenn vorhanden', () => {
    const b = v3Bullets([
      'Luftkissen: individuell aufblasbar',
      'Schnelle Lieferung aus dem EU-Lager',
      '30 Tage Rückgabe über eBay Käuferschutz',
      'Stütze für Nacken, Kopf und Kinn',
      'c', 'd', 'e', 'f',
    ]);
    expect(b.length).toBe(5);
    expect(b[0]).toEqual({ keyword: 'LUFTKISSEN', text: 'individuell aufblasbar' });
    expect(b[1]).toEqual({ keyword: null, text: 'Stütze für Nacken, Kopf und Kinn' });
    expect(b.some(x => /Lieferung|Rückgabe/.test(x.text))).toBe(false);
  });
  test('"Lieferumfang" ist kein Versand-Thema und bleibt', () => {
    expect(v3Bullets(['Lieferumfang: Kissen und Tasche'])).toEqual([{ keyword: 'LIEFERUMFANG', text: 'Kissen und Tasche' }]);
  });
});

describe('Fußzeile v3: Versand · Rückgabe · §19 je eine Zeile', () => {
  test('aus der eBay-Richtlinie bzw. neutral', () => {
    expect(shippingReturnFooterLines('7–12 Werktage', { returnsAccepted: true, days: 30, costPayer: 'SELLER' })).toEqual({
      versand: 'Versand: Lieferzeit 7–12 Werktage',
      rueckgabe: 'R&uuml;ckgabe: Kostenloser R&uuml;ckversand &middot; 30 Tage R&uuml;ckgabe',
      ustg19: USTG19_FOOTER_TEXT,
    });
    expect(shippingReturnFooterLines(null, null).versand).toBe('Versand: Lieferzeit gem&auml;&szlig; eBay-Angabe zu diesem Angebot');
  });
});

describe('buildEbayHTMLLight v3 — Aufbau', () => {
  const html = buildEbayHTMLLight({
    ...P127,
    description: '###INTRO### Einleitung.###BULLETS### - Elastischer Rand passt auf viele Schüsseln\n- Schnelle Lieferung aus dem EU-Lager###OUTRO### Schluss.',
    deliveryTime: '7–12 Werktage',
    returnTerms: { returnsAccepted: true, days: 30, costPayer: 'SELLER' },
    skuVariants: [{ name: 'Multicolour 100pcs', price: 1, imageUrl: 'https://ae01.alicdn.com/kf/x.jpg' }],
  });
  const tab1 = html.slice(html.indexOf('id="stet-lc1"'), html.indexOf('id="stet-lc3"'));
  test('Reiter Beschreibung, Impressum, AGB, Produktsicherheit — kein Reiter Versand & Retouren', () => {
    for (const l of ['Beschreibung', 'Impressum', 'AGB', 'Produktsicherheit']) expect(html).toContain(`>${l}</label>`);
    expect(html).not.toContain('Versand &amp; Retouren</label>');
  });
  test('v3-Merkmal, Überschrift mit Menge, Datentabelle, Fußzeile 3 Zeilen', () => {
    expect(html).toContain(DESCRIPTION_V3_MARKER);
    expect(tab1).toContain('Essensschutz &middot; 50 / 100 / 500 Stück</h1>');
    expect(tab1).toContain('>Kunststoff</td>');
    expect(html).toContain('<div>Versand: Lieferzeit 7–12 Werktage</div>');
    expect(html).toContain('<div>R&uuml;ckgabe: Kostenloser R&uuml;ckversand &middot; 30 Tage R&uuml;ckgabe</div>');
    expect(html).toContain(`<div>${USTG19_FOOTER_TEXT}</div>`);
  });
  test('weg: Einleitung/Schluss, TECHNISCHE DATEN, Variantentabelle/leere Bild-Kästchen, §19 im Beschreibungs-Reiter, Werbezeile, Füllsatz', () => {
    expect(tab1).not.toContain('Einleitung.');
    expect(tab1).not.toContain('Schluss.');
    expect(html).not.toContain('TECHNISCHE DATEN');
    expect(html).not.toContain('VERF&Uuml;GBARE VARIANTEN');
    expect(html).not.toContain('Multicolour');
    expect(html).not.toContain('width:34px;height:34px');
    expect(tab1).not.toContain('&sect;19');
    expect(html).not.toContain('SCHNELLE LIEFERUNG');
    expect(html).not.toContain('Schnelle Lieferung');
    expect(html).not.toContain('hochwertige Qualit');
    expect(findDescriptionComplianceViolations(html)).toEqual([]);
  });
  test('ohne Stichpunkte und ohne Einleitung: kein Füllsatz', () => {
    const h = buildEbayHTMLLight({ title: 'Nur Titel' });
    expect(h).not.toContain('hochwertige Qualit');
    expect(h).toContain('>Nur Titel</h1>');
  });
});

describe('ebay-description-builder: A-045-Felder kommen in die Beschreibung', () => {
  test('variantDetails/material/manualAspects (JSON) werden gelesen', () => {
    const { html, violations } = buildProductDescriptionForEbay({
      title: P119.title,
      variants: JSON.stringify(P119.variants),
      material: 'PE',
      manualAspects: JSON.stringify({ Produktart: 'Frischhaltehaube' }),
      variantDetails: JSON.stringify({ a: { displayNameDe: 'Transparent', pieces: 100, measure: STRETCH_119 } }),
    });
    expect(html).toContain('Lebensmittelabdeckung &middot; 100 Stück &middot; ↔ 14 – 29 cm</h1>');
    expect(html).toContain('>Frischhaltehaube</td>');
    expect(html).toContain('>PE</td>');
    expect(violations).toEqual([]);
  });
  test('kaputtes JSON → Zeile entfällt, kein Absturz', () => {
    const { html } = buildProductDescriptionForEbay({ title: 'x', variantDetails: '{kaputt', manualAspects: '[1]' });
    expect(html).toContain('>x</h1>');
  });
});
