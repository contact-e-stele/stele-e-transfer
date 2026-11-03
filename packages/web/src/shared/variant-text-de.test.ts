import { describe, expect, test } from 'bun:test';
import { translateVariantValue, translateGroupName, planVariantTexts, applyVariantRename, findDuplicateValues, translatedGroups, renameContentKeys, valueKey } from './variant-text-de';
import { resolveVariantEntries, type VariantGroup, type VariantPriceEntry } from './variant-resolver';

const v = (s: string) => translateVariantValue(s);

describe('OFFEN 023 — Beispiele aus dem Aufsichts-Befund', () => {
  test('"1 holder  24 blades" → "1 Halter 24 Klingen" (doppeltes Leerzeichen weg)', () => {
    expect(v('1 holder  24 blades')).toEqual({ value: '1 Halter 24 Klingen', changed: true, unknownWords: [] });
  });
  test('"Multicolour 100pcs" → "Mehrfarbig 100 Stück"', () => {
    expect(v('Multicolour 100pcs')).toEqual({ value: 'Mehrfarbig 100 Stück', changed: true, unknownWords: [] });
  });
  test('"flat Vacuum Bag XL" → unbekannte Wörter, Wert bleibt unverändert', () => {
    expect(v('flat Vacuum Bag XL')).toEqual({ value: 'flat Vacuum Bag XL', changed: false, unknownWords: ['flat', 'Vacuum', 'Bag'] });
  });
  test('"Navy blue 3 pcs set" → "Marineblau 3-teiliges Set"', () => {
    expect(v('Navy blue 3 pcs set')).toEqual({ value: 'Marineblau 3-teiliges Set', changed: true, unknownWords: [] });
  });
  test('GRAY/BLUE/BLACK → Grau/Blau/Schwarz (normale Großschreibung)', () => {
    expect(v('GRAY').value).toBe('Grau');
    expect(v('BLUE').value).toBe('Blau');
    expect(v('BLACK').value).toBe('Schwarz');
  });
  test('"gold Snowflak" → "Snowflak" unbekannt (Tippfehler wird nicht geraten), Wert unverändert', () => {
    expect(v('gold Snowflak')).toEqual({ value: 'gold Snowflak', changed: false, unknownWords: ['Snowflak'] });
  });
});

describe('Farbtabelle', () => {
  const cases: Array<[string, string]> = [
    ['Grey', 'Grau'], ['Gray', 'Grau'], ['Light Grey', 'Hellgrau'], ['light gray', 'Hellgrau'], ['Navy blue', 'Marineblau'],
    ['Multicolor', 'Mehrfarbig'], ['Black', 'Schwarz'], ['White', 'Weiß'], ['Blue', 'Blau'], ['Red', 'Rot'], ['Green', 'Grün'],
    ['Pink', 'Rosa'], ['Brown', 'Braun'], ['Beige', 'Beige'], ['Gold', 'Gold'], ['Silver', 'Silber'], ['Yellow', 'Gelb'],
    ['Orange', 'Orange'], ['Purple', 'Lila'], ['Khaki', 'Khaki'], ['Rose Gold', 'Roségold'],
  ];
  for (const [en, de] of cases) test(`${en} → ${de}`, () => expect(v(en).value).toBe(de));
});

describe('Mengen, Set, Größen, Maße', () => {
  test('pcs/pc/piece(s)/PCS → Stück', () => {
    expect(v('100pcs').value).toBe('100 Stück');
    expect(v('1PC').value).toBe('1 Stück');
    expect(v('2 pieces').value).toBe('2 Stück');
    expect(v('1 piece').value).toBe('1 Stück');
    expect(v('50 PCS').value).toBe('50 Stück');
    expect(v('3pcs set').value).toBe('3-teiliges Set');
  });
  test('"set" → "Set"', () => expect(v('Black set').value).toBe('Schwarz Set'));
  test('Größen S/M/L/XL/XXL bleiben', () => {
    for (const s of ['S', 'M', 'L', 'XL', 'XXL']) expect(v(s)).toEqual({ value: s, changed: false, unknownWords: [] });
    expect(v('Black XL').value).toBe('Schwarz XL');
  });
  test('cm/mm und Maß-Codes bleiben', () => {
    expect(v('30x40cm')).toEqual({ value: '30x40cm', changed: false, unknownWords: [] });
    expect(v('Grey 20 cm').value).toBe('Grau 20 cm');
    expect(v('5 mm').value).toBe('5 mm');
  });
  test('schon deutsch → unverändert, nicht "unbekannt"', () => {
    expect(v('Grau')).toEqual({ value: 'Grau', changed: false, unknownWords: [] });
    expect(v('Marineblau 3-teiliges Set')).toEqual({ value: 'Marineblau 3-teiliges Set', changed: false, unknownWords: [] });
    expect(v('SCHWARZ').value).toBe('Schwarz');
  });
  test('Grenzfälle: leer, nur Leerzeichen, Zahl, Trennzeichen', () => {
    expect(v('')).toEqual({ value: '', changed: false, unknownWords: [] });
    expect(v('  Grey  ')).toEqual({ value: 'Grau', changed: true, unknownWords: [] });
    expect(v('12')).toEqual({ value: '12', changed: false, unknownWords: [] });
    expect(v('Black/White').value).toBe('Schwarz/Weiß');
    expect(v('Black + 2 blades').value).toBe('Schwarz + 2 Klingen');
  });
  test('Teilwörter werden nicht angefasst ("Redwood" ist nicht "Rot…", "Setting" ist nicht "Set")', () => {
    expect(v('Redwood').unknownWords).toEqual(['Redwood']);
    expect(v('Setting').unknownWords).toEqual(['Setting']);
  });
});

describe('Gruppennamen', () => {
  test('Color/Size/Number of Pcs/Quantity/Specification/Style', () => {
    expect(translateGroupName('Color').value).toBe('Farbe');
    expect(translateGroupName('Size').value).toBe('Größe');
    expect(translateGroupName('Number of Pcs').value).toBe('Menge');
    expect(translateGroupName('Quantity').value).toBe('Menge');
    expect(translateGroupName('Specification').value).toBe('Ausführung');
    expect(translateGroupName('Style').value).toBe('Stil');
  });
  test('deutsch bleibt, Ships From bleibt, unbekannt wird gemeldet', () => {
    expect(translateGroupName('Varianten')).toEqual({ value: 'Varianten', changed: false, unknownWords: [] });
    expect(translateGroupName('Ships From')).toEqual({ value: 'Ships From', changed: false, unknownWords: [] });
    expect(translateGroupName('Plug Type')).toEqual({ value: 'Plug Type', changed: false, unknownWords: ['Plug Type'] });
  });
});

describe('planVariantTexts', () => {
  test('meldet doppelte Vorschläge ("Gray" + "Grey" → zweimal "Grau")', () => {
    const p = planVariantTexts([{ name: 'Color', values: ['Gray', 'Grey', 'Black'] }]);
    expect(p.groups[0].values.map(x => x.value)).toEqual(['Grau', 'Grau', 'Schwarz']);
    expect(p.duplicates).toEqual(['Farbe: "grau" 2×']);
    expect(p.anyChange).toBe(true);
  });
  test('sammelt unbekannte Wörter', () => {
    const p = planVariantTexts([{ name: 'Color', values: ['gold Snowflak', 'GRAY'] }]);
    expect(p.unknownWords).toEqual(['Snowflak']);
    expect(p.duplicates).toEqual([]);
  });
  test('findDuplicateValues: doppelte Gruppennamen', () => {
    expect(findDuplicateValues([{ name: 'Farbe', values: ['A'] }, { name: 'farbe', values: ['B'] }])).toEqual(['Gruppenname "farbe" doppelt']);
  });
});

// Punkt 5: SKU bleibt unverändert (Bestellungen, Retouren, Finom hängen daran).
describe('applyVariantRename — SKU und skuId bleiben', () => {
  const groups: VariantGroup[] = [{ name: 'Color', values: ['GRAY', 'Multicolour 100pcs'] }];
  const entries: VariantPriceEntry[] = [
    { skuId: '1001', attrs: { Color: 'GRAY' }, price: 2.5, stock: 10 },
    { skuId: '1002', attrs: { Color: 'Multicolour 100pcs' }, price: 3.1, stock: 4 },
  ];
  const de: VariantGroup[] = [{ name: 'Farbe', values: ['Grau', 'Mehrfarbig 100 Stück'] }];

  test('gelistet (pinSku): resolveVariantEntries liefert danach EXAKT dieselben SKUs und skuIds wie vorher', () => {
    const before = resolveVariantEntries(232, groups, entries);
    expect(before.map(r => r.sku)).toEqual(['stele-232-GRAY', 'stele-232-MULTICOLOUR-100PCS']);
    const r = applyVariantRename(232, groups, de, entries, { pinSku: true });
    expect(r.ok).toBe(true);
    const after = resolveVariantEntries(232, r.variants, r.entries);
    expect(after.map(x => x.sku)).toEqual(before.map(x => x.sku));
    expect(after.map(x => x.entry?.skuId)).toEqual(['1001', '1002']);
    expect(after.map(x => x.entry?.price)).toEqual([2.5, 3.1]);
    expect(after.map(x => x.displayValues)).toEqual([{ Farbe: 'Grau' }, { Farbe: 'Mehrfarbig 100 Stück' }]);
    // AliExpress-Rohdaten bleiben unangetastet
    expect(r.entries.map(e => e.attrs)).toEqual(entries.map(e => e.attrs));
    expect(r.pinned).toEqual([{ skuId: '1001', sku: 'stele-232-GRAY' }, { skuId: '1002', sku: 'stele-232-MULTICOLOUR-100PCS' }]);
  });

  test('ohne Anker würde die SKU brechen (Beleg, warum der Anker nötig ist)', () => {
    const r = applyVariantRename(232, groups, de, entries, { pinSku: false });
    const after = resolveVariantEntries(232, r.variants, r.entries);
    expect(after.map(x => x.sku)).toEqual(['stele-232-GRAU', 'stele-232-MEHRFARBIG-100-ST-CK']);
    expect(after.map(x => x.entry?.skuId)).toEqual(['1001', '1002']); // Zuordnung skuId bleibt trotzdem
  });

  test('zweite Umbenennung behält den ersten Anker (nicht die Zwischen-SKU)', () => {
    const r1 = applyVariantRename(232, groups, de, entries, { pinSku: true });
    const r2 = applyVariantRename(232, r1.variants, [{ name: 'Farbe', values: ['Hellgrau', 'Bunt 100 Stück'] }], r1.entries, { pinSku: true });
    expect(resolveVariantEntries(232, r2.variants, r2.entries).map(x => x.sku)).toEqual(['stele-232-GRAY', 'stele-232-MULTICOLOUR-100PCS']);
  });

  test('doppelte Werte / Strukturänderung / leerer Wert → nichts gespeichert', () => {
    expect(applyVariantRename(1, groups, [{ name: 'Farbe', values: ['Grau', 'grau'] }], entries, { pinSku: true }).ok).toBe(false);
    expect(applyVariantRename(1, groups, [{ name: 'Farbe', values: ['Grau'] }], entries, { pinSku: true }).ok).toBe(false);
    expect(applyVariantRename(1, groups, [{ name: 'Farbe', values: ['Grau', ' '] }], entries, { pinSku: true }).ok).toBe(false);
  });

  test('Dubletten bleiben gleich mehrdeutig, verwaiste Einträge unverändert', () => {
    const dupEntries: VariantPriceEntry[] = [...entries, { skuId: '1003', attrs: { Color: 'GRAY' }, price: 2.9 }, { skuId: '9', attrs: { Color: 'Old' }, price: 1 }];
    const r = applyVariantRename(5, groups, de, dupEntries, { pinSku: true });
    expect(r.untouched).toEqual(['9']);
    const res = resolveVariantEntries(5, r.variants, r.entries);
    expect(res[0].error?.startsWith('Mehrdeutig')).toBe(true);
    expect(res[1].sku).toBe('stele-5-MULTICOLOUR-100PCS');
  });

  test('Mehrere Gruppen: Kombinationen bleiben an ihrer Stelle', () => {
    const g2: VariantGroup[] = [{ name: 'Color', values: ['Black', 'White'] }, { name: 'Size', values: ['S', 'M'] }];
    const e2: VariantPriceEntry[] = [
      { skuId: 'a', attrs: { Color: 'Black', Size: 'S' }, price: 1 }, { skuId: 'b', attrs: { Color: 'Black', Size: 'M' }, price: 2 },
      { skuId: 'c', attrs: { Color: 'White', Size: 'S' }, price: 3 }, { skuId: 'd', attrs: { Color: 'White', Size: 'M' }, price: 4 },
    ];
    const before = resolveVariantEntries(7, g2, e2);
    const r = applyVariantRename(7, g2, [{ name: 'Farbe', values: ['Schwarz', 'Weiß'] }, { name: 'Größe', values: ['S', 'M'] }], e2, { pinSku: true });
    const after = resolveVariantEntries(7, r.variants, r.entries);
    expect(after.map(x => [x.sku, x.entry?.skuId])).toEqual(before.map(x => [x.sku, x.entry?.skuId]));
    expect(after[3].displayValues).toEqual({ Farbe: 'Weiß', Größe: 'M' });
  });
});

describe('Resolver: SKU-Anker-Kollision', () => {
  test('Anker trifft die berechnete SKU einer anderen Kombination → beide harter Fehler', () => {
    const groups: VariantGroup[] = [{ name: 'Farbe', values: ['Grau', 'Gray'] }];
    const entries: VariantPriceEntry[] = [
      { skuId: '1', attrs: { Color: 'GRAY' }, displayValues: { Farbe: 'Grau' }, ebaySku: 'stele-3-GRAY', price: 1 },
      { skuId: '2', attrs: { Color: 'Gray2' }, displayValues: { Farbe: 'Gray' }, price: 1 },
    ];
    const res = resolveVariantEntries(3, groups, entries);
    expect(res.every(r => r.error?.includes('SKU stele-3-GRAY doppelt'))).toBe(true);
  });
  test('ohne Anker: bestehende Kollision verhält sich wie vorher (kein neuer Fehler)', () => {
    const groups: VariantGroup[] = [{ name: 'Farbe', values: ['a b', 'a-b'] }];
    const entries: VariantPriceEntry[] = [{ skuId: '1', attrs: { C: 'a b' }, price: 1 }, { skuId: '2', attrs: { C: 'a-b' }, price: 1 }];
    expect(resolveVariantEntries(3, groups, entries).map(r => r.error)).toEqual([null, null]);
  });
});

describe('Import-Tab-Helfer', () => {
  const groups: VariantGroup[] = [{ name: 'Color', values: ['GRAY', 'gold Snowflak'] }];
  test('Vorschlag, Hand-Eingabe hat Vorrang', () => {
    expect(translatedGroups(groups, {}, {})).toEqual([{ name: 'Farbe', values: ['Grau', 'gold Snowflak'] }]);
    expect(translatedGroups(groups, { Color: 'Muster' }, { [valueKey('Color', 'gold Snowflak')]: 'Gold Schneeflocke' }))
      .toEqual([{ name: 'Muster', values: ['Grau', 'Gold Schneeflocke'] }]);
  });
  test('variantContents-Schlüssel folgen der Umbenennung', () => {
    expect(renameContentKeys({ GRAY: 'x', SET1: 'y' }, groups, [{ name: 'Farbe', values: ['Grau', 'Gold'] }])).toEqual({ Grau: 'x', SET1: 'y' });
  });
  test('nichts umbenannt → Einträge unverändert (keine displayValues)', () => {
    const e: VariantPriceEntry[] = [{ skuId: '1', attrs: { Color: 'Grau' }, price: 1 }];
    const r = applyVariantRename(1, [{ name: 'Farbe', values: ['Grau'] }], [{ name: 'Farbe', values: ['Grau'] }], e, { pinSku: true });
    expect(r.ok).toBe(true);
    expect(r.entries).toBe(e);
    expect(r.pinned).toEqual([]);
  });
});
