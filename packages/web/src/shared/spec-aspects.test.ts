import { describe, expect, test } from 'bun:test';
import { matchSpecsToCategoryAspects, parseAliItemProperties, type CategoryAspectDef } from './spec-aspects';
import { aliIdFromUrl, hasSpecs, runSpecsBackfill, selectForBackfill, SPECS_BACKFILL_MAX_PER_CALL } from '../api/specs-backfill';
import { buildAspects } from '../api/ebay';

// Kategorie wie sie die Taxonomy API liefert (Ausschnitt, Namen/Modi als Testdaten)
const CAT: CategoryAspectDef[] = [
  { localizedAspectName: 'Material', aspectConstraint: { aspectMode: 'FREE_TEXT' } },
  { localizedAspectName: 'Herstellungsland und -region', aspectConstraint: { aspectMode: 'SELECTION_ONLY' }, aspectValues: [{ localizedValue: 'China' }, { localizedValue: 'Deutschland' }] },
  { localizedAspectName: 'Produktart', aspectConstraint: { aspectMode: 'FREE_TEXT' } },
  { localizedAspectName: 'Abteilung', aspectConstraint: { aspectMode: 'SELECTION_ONLY' }, aspectValues: [{ localizedValue: 'Unisex' }] },
  { localizedAspectName: 'Zubehör', aspectConstraint: { aspectMode: 'FREE_TEXT' } },
  { localizedAspectName: 'Marke', aspectConstraint: { aspectMode: 'FREE_TEXT' } },
];

describe('Punkt C: AliExpress-Merkmale → eBay-Merkmale der Kategorie', () => {
  test('Reisekissen-Fall: Material und Herkunft ja; Typ/Zubehör (englische Freitexte) nein — C2', () => {
    const r = matchSpecsToCategoryAspects({ Material: 'PVC', Origin: 'Mainland China', Type: 'Travel Pillow', Accessory: 'Storage Bag' }, CAT);
    expect(r.aspects).toEqual({ Material: 'PVC', 'Herstellungsland und -region': 'China' });
  });
  test('C2: echte Werte vom 25.10. werden übersetzt, unklare ausgelassen', () => {
    const cat = [...CAT, { localizedAspectName: 'Füllmaterial' }, { localizedAspectName: 'Muster' }, { localizedAspectName: 'Maße' }] as CategoryAspectDef[];
    expect(matchSpecsToCategoryAspects({ Material: 'Plastic', Filling: 'POLYESTER', 'Pattern Type': 'Solid', Size: '45x50cm' }, cat).aspects)
      .toEqual({ Material: 'Kunststoff', Füllmaterial: 'Polyester', Muster: 'Einfarbig', Maße: '45 x 50 cm' });
    expect(matchSpecsToCategoryAspects({ Material: 'Polyester / Cotton' }, cat).aspects).toEqual({ Material: 'Polyester, Baumwolle' });
    expect(matchSpecsToCategoryAspects({ Material: '304 Stainless Steel' }, cat).aspects).toEqual({ Material: 'Edelstahl' });
    expect(matchSpecsToCategoryAspects({ Material: 'other', Size: 'Pack of 100', 'Place Of Origin': 'China (mainland)' }, cat).aspects)
      .toEqual({ 'Herstellungsland und -region': 'China' });
    expect(matchSpecsToCategoryAspects({ Size: 'About 13.5*3cm' }, cat).aspects).toEqual({ Maße: '13,5 x 3 cm' });
  });
  test('Auswahl-Merkmal: Wert außerhalb der Liste wird NICHT gesendet (kein Raten)', () => {
    const cat = [{ localizedAspectName: 'Material', aspectConstraint: { aspectMode: 'SELECTION_ONLY' }, aspectValues: [{ localizedValue: 'Holz' }] }] as CategoryAspectDef[];
    const r = matchSpecsToCategoryAspects({ Material: 'Plastic' }, cat);
    expect(r.aspects).toEqual({});
    expect(r.skipped[0].reason).toMatch(/Auswahlliste/);
    expect(matchSpecsToCategoryAspects({ Origin: 'Guangdong' }, CAT).aspects).toEqual({}); // keine eindeutige China-Angabe
  });
  test('Auswahl-Merkmal: eBay-Schreibweise wird übernommen', () => {
    expect(matchSpecsToCategoryAspects({ Herkunft: 'china' }, CAT).aspects).toEqual({ 'Herstellungsland und -region': 'China' });
  });
  test('Marke und Kennungen nie aus AliExpress (Markenlos-Pflicht, EAN/MPN-Regeln)', () => {
    const r = matchSpecsToCategoryAspects({ 'Brand Name': 'Wanchuan', Marke: 'X', 'Model Number': '1005006123456789' }, CAT);
    expect(r.aspects).toEqual({});
  });
  test('Merkmal, das die Kategorie nicht kennt → ausgelassen', () => {
    const r = matchSpecsToCategoryAspects({ 'Is Smart Device': 'no' }, CAT);
    expect(r.aspects).toEqual({});
    expect(r.skipped[0].reason).toMatch(/kein passendes/);
  });
  test('schon gesetzte Merkmale werden nicht überschrieben; Wert > 65 Zeichen ausgelassen', () => {
    const r = matchSpecsToCategoryAspects({ Material: 'PVC', Type: 'x'.repeat(66) }, CAT, ['Material']);
    expect(r.aspects).toEqual({});
  });
});

describe('Punkt C: ds.product.get-Eigenschaften lesen', () => {
  test('attr_name/attr_value (DS-API) wird gelesen — bisher leer', () => {
    expect(parseAliItemProperties({ ae_item_property: [{ attr_name: 'Material', attr_value: 'PVC', attr_name_id: 1 }, { attr_name: 'Origin', attr_value: 'Mainland China' }] }))
      .toEqual({ Material: 'PVC', Origin: 'Mainland China' });
  });
  test('alte Schreibweise property_name/property_value bleibt lesbar', () => {
    expect(parseAliItemProperties({ ae_item_property: [{ property_name: 'Material', property_value: 'PVC' }] })).toEqual({ Material: 'PVC' });
  });
  test('leer/kaputt → {}; doppelter Name: erster gewinnt', () => {
    expect(parseAliItemProperties(undefined)).toEqual({});
    expect(parseAliItemProperties({ ae_item_property: 'x' })).toEqual({});
    expect(parseAliItemProperties({ ae_item_property: [{ attr_name: 'A', attr_value: '1' }, { attr_name: 'A', attr_value: '2' }] })).toEqual({ A: '1' });
  });
});

describe('Punkt C: buildAspects nutzt die Merkmale (Kategorie aus der Taxonomy API)', () => {
  const fetchCat = (async () => new Response(JSON.stringify({ aspects: CAT }), { status: 200 })) as unknown as typeof fetch;
  test('Material (übersetzt) und Herkunft landen im Angebot; Typ/Zubehör/Größe-Rohwerte nicht; Marke bleibt Markenlos', async () => {
    const a = await buildAspects({ Material: 'Plastic', Origin: 'Mainland China', Accessory: 'Storage Bag', Type: 'cats', Size: 'Pack of 100', 'Brand Name': 'Wanchuan' }, undefined, 'CAT-SPEC-C-1', undefined, undefined, [], [], fetchCat, async () => 't');
    expect(a['Material']).toEqual(['Kunststoff']);
    expect(a['Herstellungsland und -region']).toEqual(['China']);
    expect(a['Zubehör']).toBeUndefined();
    expect(a['Typ']).toBeUndefined();
    expect(a['Größe']).toBeUndefined();
    expect(a['Marke']).toEqual(['Markenlos']);
  });
  test('ohne specs: unverändert wie bisher (nur Marke/EAN)', async () => {
    const a = await buildAspects({}, undefined, 'CAT-SPEC-C-2', undefined, undefined, [], [], fetchCat, async () => 't');
    expect(a['Material']).toBeUndefined();
    expect(a['Marke']).toEqual(['Markenlos']);
  });
});

describe('Punkt C: Merkmale nachladen (nur leere specs, Trockenlauf Standard)', () => {
  const prods = [
    { id: 220, sourceUrl: 'https://de.aliexpress.com/item/1005006000000220.html', specs: null, ebayListingId: '198712713157' },
    { id: 221, sourceUrl: 'https://de.aliexpress.com/item/1005006000000221.html', specs: '{"Material":"Holz"}', ebayListingId: '1' },
    { id: 222, sourceUrl: 'manual', specs: null, ebayListingId: '2' },
    { id: 223, sourceUrl: 'https://de.aliexpress.com/item/1005006000000223.html', specs: null, ebayListingId: null },
  ];
  test('Auswahl: nur gelistete ohne Merkmale; vorhandene nie anfassen', () => {
    expect(selectForBackfill(prods).map(p => p.id)).toEqual([220, 222]);
    expect(selectForBackfill(prods, [223]).map(p => p.id)).toEqual([223]);
    expect(hasSpecs('{}')).toBe(false);
    expect(aliIdFromUrl('https://de.aliexpress.com/item/1005006000000220.html?spm=x')).toBe('1005006000000220');
  });
  test('Trockenlauf speichert nichts; apply speichert', async () => {
    const saved: Array<[number, string]> = [];
    const deps = { listProducts: async () => prods, fetchSpecs: async () => ({ Material: 'PVC' }), saveSpecs: async (id: number, j: string) => { saved.push([id, j]); }, pause: async () => {} };
    const dry = await runSpecsBackfill({}, deps);
    expect(dry.dryRun).toBe(true);
    expect(dry.rows.map(r => r.status)).toEqual(['gefunden', 'keine-ali-id']);
    expect(saved).toEqual([]);
    const real = await runSpecsBackfill({ apply: true }, deps);
    expect(real.rows[0].status).toBe('gespeichert');
    expect(saved).toEqual([[220, '{"Material":"PVC"}']]);
  });
  test('AliExpress liefert keine Merkmale → "leer", nichts gespeichert; Obergrenze je Aufruf', async () => {
    const saved: number[] = [];
    const r = await runSpecsBackfill({ apply: true, limit: 999 }, { listProducts: async () => prods, fetchSpecs: async () => ({}), saveSpecs: async (id) => { saved.push(id); }, pause: async () => {} });
    expect(r.rows[0].status).toBe('leer');
    expect(saved).toEqual([]);
    expect(SPECS_BACKFILL_MAX_PER_CALL).toBe(20);
  });
});
