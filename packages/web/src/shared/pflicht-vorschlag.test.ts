// 050 P4: Vorschläge statt Stopp. PLZ-Fixtures = echte Herstellerangaben aus dem Einsteller-Protokoll 17.11.2026 (Nr 780, Nr 781).
// Konkurrenz-Merkmale sind KONSTRUIERT (api.ebay.com ist aus der Sandbox gesperrt: "403 request blocked"); sie prüfen nur die Regel
// „mindestens 2 gleiche Angaben“, keine echten eBay-Werte.
import { describe, expect, test } from 'bun:test';
import { plzVorschlag, konkurrenzVorschlaege, aspectsFromBrowseItem, CN_STADT_PLZ } from './pflicht-vorschlag';

describe('plzVorschlag', () => {
  test('Nr 781: Guangzhou ohne PLZ in der Straße → Haupt-PLZ der Stadt aus dem Verzeichnis', () => {
    const v = plzVorschlag({ gpsrMfrCity: '', gpsrMfrAddress: 'Shop 101, 102, Building 11, No. 60, Bicun Archway Street, Huadu District, Guangzhou' });
    expect(v).toEqual({ wert: '510000 Guangzhou', quelle: 'Stadt-PLZ-Verzeichnis (Haupt-PLZ der Stadt)', fundstelle: 'Stadt „Guangzhou“ aus der Herstellerangabe' });
  });
  test('Nr 780: Zhengzhou steht nicht im (belegten) Verzeichnis → kein Vorschlag, nichts geraten', () => {
    expect(plzVorschlag({ gpsrMfrCity: 'Zhengzhou, Henan', gpsrMfrAddress: 'Unit 1403, building 1, no. 11, hongguanghe park, no. 99, no. 7th street, jingkai, guancheng hui district' })).toBeNull();
  });
  test('eindeutige 6-stellige Zahl in der Straße → aus der Herstellerangabe (vor dem Verzeichnis)', () => {
    expect(plzVorschlag({ gpsrMfrCity: 'Shenzhen', gpsrMfrAddress: 'Bantian Street 5, Longgang, 518129' })).toEqual({
      wert: '518129 Shenzhen', quelle: 'AliExpress-Herstellerangabe', fundstelle: 'Hersteller-Straße: „Bantian Street 5, Longgang, 518129“',
    });
  });
  test('zwei verschiedene 6-stellige Zahlen → nicht daraus, sondern Verzeichnis', () => {
    expect(plzVorschlag({ gpsrMfrCity: 'Shenzhen', gpsrMfrAddress: 'Room 518129, Building 518000' })?.quelle).toBe('Stadt-PLZ-Verzeichnis (Haupt-PLZ der Stadt)');
  });
  test('Format schon „PLZ Stadt“ → nichts vorzuschlagen', () => {
    expect(plzVorschlag({ gpsrMfrCity: '518000 Shenzhen' })).toBeNull();
  });
  test('Straße „Beijing Road, Guangzhou“ ohne Ort → zwei Städte → kein Vorschlag', () => {
    expect(plzVorschlag({ gpsrMfrCity: '', gpsrMfrAddress: 'No. 8 Beijing Road, Yuexiu, Guangzhou' })).toBeNull();
  });
  test('Ort-Feld hat Vorrang vor der Straße', () => {
    expect(plzVorschlag({ gpsrMfrCity: 'Hangzhou', gpsrMfrAddress: 'No. 8 Beijing Road' })?.wert).toBe('310000 Hangzhou');
  });
  test('Verzeichnis enthält nur belegte Städte', () => {
    expect(Object.keys(CN_STADT_PLZ).sort()).toEqual(['beijing', 'guangzhou', 'hangzhou', 'shanghai', 'shantou', 'shenzhen']);
  });
});

describe('konkurrenzVorschlaege (konstruierte Merkmale)', () => {
  const items = [
    { itemId: '111', aspects: { Material: ['Kunststoff'], 'Maße': ['35 cm'] } },
    { itemId: '222', aspects: { material: ['kunststoff '], 'Maße': ['40 cm'] } },
    { itemId: '333', aspects: { Material: ['Metall'] } },
  ];
  test('Material bei 2 gleichen Angaben → Vorschlag mit beiden Quellen', () => {
    expect(konkurrenzVorschlaege(items, { material: true, masse: false })).toEqual([{ feld: 'material', wert: 'Kunststoff', aspekt: 'Material', quellen: ['111', '222'] }]);
  });
  test('Maße nur je 1× → kein Vorschlag', () => {
    expect(konkurrenzVorschlaege(items, { material: false, masse: true })).toEqual([]);
  });
  test('Gleichstand 2:2 → kein Vorschlag', () => {
    const tie = [...items, { itemId: '444', aspects: { Material: ['Metall'] } }];
    expect(konkurrenzVorschlaege(tie, { material: true, masse: false })).toEqual([]);
  });
  test('ein Angebot mit doppeltem Wert zählt einmal', () => {
    expect(konkurrenzVorschlaege([{ itemId: '1', aspects: { Material: ['Holz', 'Holz'] } }], { material: true, masse: false })).toEqual([]);
  });
  test('nur was fehlt', () => {
    expect(konkurrenzVorschlaege(items, { material: false, masse: false })).toEqual([]);
  });
});

describe('aspectsFromBrowseItem', () => {
  test('localizedAspects → Liste je Name, Komma getrennt', () => {
    expect(aspectsFromBrowseItem({ localizedAspects: [{ name: 'Material', value: 'Kunststoff, Metall' }, { name: 'Farbe', value: 'Rot' }] }))
      .toEqual({ Material: ['Kunststoff', 'Metall'], Farbe: ['Rot'] });
  });
});

// Inhaber 17.11. 19:39 „ja“: Maße mit Quelle e in den Pflicht-Daten (nicht in den A-045-variantDetails).
import { parsePflichtDatenPatch, resolvePflichtDaten } from './pflicht-daten';
import { parseMeasure, parseProductDataPatch } from './product-data-patch';

describe('Maße mit Quelle e', () => {
  const masseE = { single: { kind: 'D', values: [35], text: '35 cm', source: 'e', location: 'eBay-Angebote 111, 222' } };
  test('pflichtDaten.masse akzeptiert Quelle e und behält sie', () => {
    const r = parsePflichtDatenPatch({ masse: masseE }, parseMeasure);
    expect(r.ok).toBe(true);
    expect(JSON.parse((r as { json: string }).json).masse.single.source).toBe('e');
  });
  test('gespeichertes Maß mit Quelle e zählt: Maße fehlen nicht mehr', () => {
    const r = parsePflichtDatenPatch({ masse: masseE }, parseMeasure) as { json: string };
    const res = resolvePflichtDaten({ pflichtDaten: JSON.parse(r.json), variants: [], variantPrices: [] });
    expect(res.ampel.missing.includes('Maße')).toBe(false);
  });
  test('Quelle e ohne Fundstelle wird abgelehnt', () => {
    const r = parsePflichtDatenPatch({ masse: { single: { ...masseE.single, location: '' } } }, parseMeasure);
    expect(r.ok).toBe(false);
  });
  test('A-045 variantDetails bleiben bei a–d (Quelle e abgelehnt)', () => {
    const r = parseProductDataPatch({ variantDetails: { x: { displayNameDe: 'X', pieces: 1, measure: { kind: 'D', values: [35], source: 'e', location: 'eBay' } } } });
    expect(r.ok).toBe(false);
  });
});
