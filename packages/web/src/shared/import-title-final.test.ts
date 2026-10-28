import { describe, expect, test } from 'bun:test';
import { keepImportTitle } from './title-clean';

// Live-Fund 28.10.2026: stele-245 ging mit englischem Rohtitel live (Import-Tab schickte den unberührten buildTitle-Wert).
const RAW245 = 'Disposable Food Cover Food Grade Home Fruit Vegetable Saran Wrap Storage Bag ...';

describe('Import-Titel: nur bearbeiteten/KI-Titel behalten', () => {
  test('unberührter Rohtitel → KI erzeugt (nicht behalten)', () => {
    expect(keepImportTitle({ generatedTitle: RAW245 })).toBe(false);
    expect(keepImportTitle({ generatedTitle: RAW245, titleFinal: false })).toBe(false);
  });
  test('bearbeiteter oder KI-Titel → behalten', () => {
    expect(keepImportTitle({ generatedTitle: 'Einweg Frischhaltehauben Elastisch', titleFinal: true })).toBe(true);
  });
  test('leerer Titel → KI erzeugt', () => {
    expect(keepImportTitle({ generatedTitle: '  ', titleFinal: true })).toBe(false);
  });
});
