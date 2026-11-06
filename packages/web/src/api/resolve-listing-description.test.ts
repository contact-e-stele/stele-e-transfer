// P71-C Teil 2: /ebay/list baut eine gespeicherte Vorlage mit Dauerregel-Verstößen neu statt abzubrechen.
import { describe, expect, test } from 'bun:test';
import { resolveListingDescription, buildProductDescriptionForEbay, type ProductDescriptionFields } from './ebay-description-builder';
import { TEXT_VERSION_MARKER, shippingReturnFooter } from '../shared/shipping-return-text';

const product: ProductDescriptionFields = {
  title: 'Frischhaltedose Edelstahl 3er Set',
  generatedTitle: 'Frischhaltedose Edelstahl 3er Set',
  generatedDescription: '###INTRO### Praktisches Set.###BULLETS### - Auslaufsicher###OUTRO### Ideal für Meal Prep.',
  specs: JSON.stringify({ Material: 'Edelstahl' }),
  images: JSON.stringify(['https://i.ebayimg.com/a.jpg']),
};
// Alte Vorlage (Marker wie in der echten) mit E-Mail im Impressum
const OLD_TEMPLATE_WITH_EMAIL = '<div class="stet-l-tabs">STELE-E-TRANSFER <p>Impressum: contact@stele-e-transfer.com</p></div>';
// OFFEN 029: "sauber" heißt jetzt auch: aktuelle Versand-/Rückgabe-Texte (Textmarke vorhanden).
// OFFEN 030: und die Fußzeile passt zur Herkunft (hier unbekannt → neutrale Sätze).
// Beschreibung v3 (06.11.2026): "sauber" heißt zusätzlich v3-Aufbau (Merkmal) — gespeicherte v3-Vorlage mit gleicher Fußzeile.
const CLEAN_TEMPLATE = buildProductDescriptionForEbay(product).html.replace('</h1>', '</h1><p>Gespeichert</p>');
// v2-Vorlage (OFFEN 029/030: Textmarke + Tab 5 + Ein-Zeilen-Fußzeile, aber ohne v3-Merkmal) → wird neu gebaut.
const CLEAN_TEMPLATE_V2 = `<div class="stet-l-tabs">STELE-E-TRANSFER ${TEXT_VERSION_MARKER}<input id="stet-l5"/><p>Sauber</p><span>${shippingReturnFooter(null, null)}</span></div>`;
const CLEAN_TEMPLATE_OLD_TEXTS = '<div class="stet-l-tabs">STELE-E-TRANSFER <input id="stet-l5"/><p>Lieferzeit 3–10 Werktage</p></div>';
const CLEAN_TEMPLATE_WITHOUT_TAB5 = '<div class="stet-l-tabs">STELE-E-TRANSFER <p>Sauber, aber nur 4 Tabs</p></div>';

describe('resolveListingDescription', () => {
  test('alte Vorlage mit E-Mail → Neubau ohne Verstöße statt Fehler', () => {
    const r = resolveListingDescription(product, OLD_TEMPLATE_WITH_EMAIL);
    expect(r.violations).toEqual([]);
    expect(r.html).not.toContain('contact@stele-e-transfer.com');
    expect(r.html).toContain('Frischhaltedose Edelstahl 3er Set');
  });

  test('saubere gespeicherte Vorlage wird unverändert übernommen', () => {
    const r = resolveListingDescription(product, CLEAN_TEMPLATE);
    expect(r.html).toBe(CLEAN_TEMPLATE);
    expect(r.violations).toEqual([]);
  });

  test('v3: saubere v2-Vorlage (ohne v3-Merkmal) wird neu im v3-Aufbau gebaut', () => {
    const r = resolveListingDescription(product, CLEAN_TEMPLATE_V2);
    expect(r.html).not.toBe(CLEAN_TEMPLATE_V2);
    expect(r.html).toContain('<!-- stele-beschreibung: v3 -->');
    expect(r.violations).toEqual([]);
  });

  test('v3: gleiche Fußzeile, aber ohne v3-Merkmal (alter Aufbau) → neu bauen, nicht übernehmen', () => {
    const noMarker = CLEAN_TEMPLATE.replace('<!-- stele-beschreibung: v3 -->', '');
    const r = resolveListingDescription(product, noMarker);
    expect(r.html).not.toBe(noMarker);
    expect(r.html).toContain('<!-- stele-beschreibung: v3 -->');
  });

  test('OFFEN 029: saubere Vorlage mit ALTEN Texten (ohne Textmarke) wird neu gebaut', () => {
    const r = resolveListingDescription(product, CLEAN_TEMPLATE_OLD_TEXTS);
    expect(r.html).not.toBe(CLEAN_TEMPLATE_OLD_TEXTS);
    expect(r.html).not.toContain('3–10');
  });

  test('saubere gespeicherte Vorlage OHNE Tab 5 wird neu gebaut (5 Tabs immer)', () => {
    const r = resolveListingDescription(product, CLEAN_TEMPLATE_WITHOUT_TAB5);
    expect(r.html).not.toBe(CLEAN_TEMPLATE_WITHOUT_TAB5);
    expect(r.html).toContain('id="stet-l5"');
  });

  test('keine Vorlage → Neubau', () => {
    const r = resolveListingDescription(product, null);
    expect(r.violations).toEqual([]);
    expect(r.html).toContain('STELE-E-TRANSFER');
  });
});
