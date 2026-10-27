import { describe, expect, test } from 'bun:test';
import { cleanGeneratedTitle } from './title-clean';
import { carrierFromTrackingNumber, carrierFromEbayCode } from './carrier-guess';
import { mergeImportDuplicates } from './variant-dedupe';
import { maxVariantsError } from './variant-cleanup';
import { resolveVariantEntries } from './variant-resolver';

describe('OFFEN 009 Punkt 1: KI-Titel ohne Längenangabe', () => {
  test('echte Fälle stele-181 (live) und stele-241', () => {
    expect(cleanGeneratedTitle('Quilt Aufbewahrungstasche Staubdicht Feuchtigkeitsdicht Groß 75 Zeichen')).toBe('Quilt Aufbewahrungstasche Staubdicht Feuchtigkeitsdicht Groß');
    expect(cleanGeneratedTitle('Plüsch Hausschuhe Bär Damen Herren Winter Warm Bequem Rutschfest 78 Zeichen')).toBe('Plüsch Hausschuhe Bär Damen Herren Winter Warm Bequem Rutschfest');
  });
  test('Varianten der Anhängsel, Anführungszeichen', () => {
    expect(cleanGeneratedTitle('"Kissen Weich Groß (80 Zeichen)"')).toBe('Kissen Weich Groß');
    expect(cleanGeneratedTitle('Kissen Weich Groß - 79 characters')).toBe('Kissen Weich Groß');
    expect(cleanGeneratedTitle('Kissen Weich Groß Länge: 78')).toBe('Kissen Weich Groß');
  });
  test('echte Wörter und Zahlen bleiben (stele-155 "Zeichenbuch", Altersangabe)', () => {
    expect(cleanGeneratedTitle('Kinder Zeichenbuch Malbuch Kindergarten 3-14 Jahre Kreativität Lehren')).toBe('Kinder Zeichenbuch Malbuch Kindergarten 3-14 Jahre Kreativität Lehren');
    expect(cleanGeneratedTitle('Haarnetze 100 Stück Einweg')).toBe('Haarnetze 100 Stück Einweg');
  });
  test('höchstens 80 Zeichen', () => expect(cleanGeneratedTitle('x'.repeat(90)).length).toBe(80));
});

describe('OFFEN 009 Punkt 2: Versanddienst aus eindeutigem Nummernformat', () => {
  test('echtes Format vom 27.10. (00340434…, 20 Ziffern) → DHL; Hermes H+19', () => {
    expect(carrierFromTrackingNumber('00340434886115235908')).toBe('DHL');
    expect(carrierFromTrackingNumber('H1000123456789012345')).toBe('Hermes');
  });
  test('alles andere → null (nichts raten)', () => {
    expect(carrierFromTrackingNumber('LP00123456789012')).toBeNull();
    expect(carrierFromTrackingNumber('0034043488611523590')).toBeNull(); // 19 Ziffern
    expect(carrierFromTrackingNumber(null)).toBeNull();
  });
  test('eBay-Codes', () => {
    expect(carrierFromEbayCode('DHL')).toBe('DHL');
    expect(carrierFromEbayCode('Hermes')).toBe('Hermes');
    expect(carrierFromEbayCode('Other')).toBeNull();
  });
});

describe('OFFEN 009 Punkt 3: Dubletten beim Import (echte Daten stele-242, ds.product.get 1005006904740326)', () => {
  const groups = [{ name: 'Color', values: ['SET086-10pcs set', 'SET086-12pcs set', 'SET040', 'SET009-Green', 'SET086-7pcs set'] }];
  // skuIds: nur die letzten 6 Ziffern sind belegt (Live-Abruf 27.10.), daher als '…NNNNNN' — Preise und Lager echt.
  const e = (skuId: string, v: string, price: number, stock: number) => ({ skuId, attrs: { Color: v }, price, stock, imageUrl: 'x' });
  const entries = [
    e('…604031', 'SET086-10pcs set', 4.49, 125), e('…604030', 'SET086-12pcs set', 6.39, 32),
    e('…604029', 'SET040', 5.59, 19), e('…131812', 'SET086-10pcs set', 4.39, 18),
    e('…604033', 'SET009-Green', 3.15, 53), e('…604032', 'SET086-7pcs set', 4.09, 206),
  ];
  test('vorher: Grenze 5 erfüllt, aber 6 Einträge → Listen "Mehrdeutig"', () => {
    expect(maxVariantsError(groups, 5)).toBeNull();
    expect(resolveVariantEntries(242, groups, entries).filter(r => r.error?.startsWith('Mehrdeutig'))).toHaveLength(1);
  });
  test('nachher: 5 Einträge, EK 4,49 (höchster), SKU mit größtem Lager (125), Listen ohne Fehler', () => {
    const m = mergeImportDuplicates(groups, entries);
    expect(m.entries).toHaveLength(5);
    expect(m.merged).toEqual([{ label: 'Color=SET086-10pcs set', keptSkuId: '…604031', removedSkuIds: ['…131812'], price: 4.49 }]);
    expect(resolveVariantEntries(242, groups, m.entries).every(r => !r.error)).toBe(true);
  });
  test('höherer EK beim kleineren Lager wird trotzdem übernommen', () => {
    const m = mergeImportDuplicates([{ name: 'Color', values: ['A'] }], [e('1', 'A', 3.0, 100), e('2', 'A', 3.5, 10)]);
    expect(m.entries).toEqual([{ skuId: '1', attrs: { Color: 'A' }, price: 3.5, stock: 100, imageUrl: 'x' }]);
  });
  test('ohne Dubletten unverändert', () => {
    const one = [e('1', 'A', 3, 1)];
    expect(mergeImportDuplicates([{ name: 'Color', values: ['A'] }], one).entries).toEqual(one);
  });
});

describe('Meldung 27.10. 18:25: Versanddienst per Gegencheck eBay/AliExpress (01-15317-84805, stele-220-BLUE)', () => {
  test('gespeichert ohne "H" → Format allein unklar', async () => {
    const { decideCarrier } = await import('./carrier-guess');
    expect(decideCarrier({ local: '1003660829824501016' })).toBeNull();
  });
  test('eBay meldet Hermes → Hermes (Quelle eBay)', async () => {
    const { decideCarrier } = await import('./carrier-guess');
    expect(decideCarrier({ local: '1003660829824501016', ebayCodes: ['Hermes'] })).toEqual({ carrier: 'Hermes', source: 'ebay' });
  });
  test('AliExpress liefert H1003660829824501016 (dieselbe Sendung) → Hermes (Quelle AliExpress)', async () => {
    const { decideCarrier } = await import('./carrier-guess');
    expect(decideCarrier({ local: '1003660829824501016', ebayCodes: [null], aliTracking: 'H1003660829824501016' })).toEqual({ carrier: 'Hermes', source: 'aliexpress' });
  });
  test('AliExpress-Nummer einer ANDEREN Sendung zählt nicht', async () => {
    const { decideCarrier } = await import('./carrier-guess');
    expect(decideCarrier({ local: '1003660829824501016', aliTracking: 'H1003660829824509999' })).toBeNull();
  });
  test('eindeutiges Format geht vor (DHL)', async () => {
    const { decideCarrier } = await import('./carrier-guess');
    expect(decideCarrier({ local: '00340434886115235908', ebayCodes: ['DHL'] })).toEqual({ carrier: 'DHL', source: 'format' });
  });
});
