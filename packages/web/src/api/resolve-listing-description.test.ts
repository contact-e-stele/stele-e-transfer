// P71-C Teil 2: /ebay/list baut eine gespeicherte Vorlage mit Dauerregel-Verstößen neu statt abzubrechen.
import { describe, expect, test } from 'bun:test';
import { resolveListingDescription, type ProductDescriptionFields } from './ebay-description-builder';

const product: ProductDescriptionFields = {
  title: 'Frischhaltedose Edelstahl 3er Set',
  generatedTitle: 'Frischhaltedose Edelstahl 3er Set',
  generatedDescription: '###INTRO### Praktisches Set.###BULLETS### - Auslaufsicher###OUTRO### Ideal für Meal Prep.',
  specs: JSON.stringify({ Material: 'Edelstahl' }),
  images: JSON.stringify(['https://i.ebayimg.com/a.jpg']),
};
// Alte Vorlage (Marker wie in der echten) mit E-Mail im Impressum
const OLD_TEMPLATE_WITH_EMAIL = '<div class="stet-l-tabs">STELE-E-TRANSFER <p>Impressum: contact@stele-e-transfer.com</p></div>';
const CLEAN_TEMPLATE = '<div class="stet-l-tabs">STELE-E-TRANSFER <input id="stet-l5"/><p>Sauber</p></div>';
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
