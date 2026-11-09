// Design-Sprint S2 "Pflicht-Daten" (Auftrag Aufsicht 043). Fixtures 225/127 wie in description-v3/v4.test.ts (echte Werte aus dem
// DB-Backup stele-db-2026-11-05-23h.json); Fixture "Servierplatte" ist eine lokale Testzeile (keine Produktionsdaten).
// Alle Erwartungswerte wurden mit bun aus den Funktionen nachgerechnet (Grundgesetz 3).
import { describe, expect, test } from 'bun:test';
import {
  checkMaterialEvidence, extractPflichtProposal, matchPflichtToCategoryAspects, parseMeasureText, parsePflichtDatenPatch,
  pflichtAspects, pflichtDatenForImport, readPflichtDaten, resolvePflichtDaten, SINGLE_UNIT_KEY,
} from './pflicht-daten';
import { translateColorExact } from './variant-text-de';
import { formatMeasure } from './variant-measure';
import { parseMeasure } from './product-data-patch';
import { introSentence, v4Rows } from './description-v4';
import { buildEbayHTMLLight, buildEbayHTMLv4 } from '../web/lib/ebay-description';
import { buildAspects } from '../api/ebay';
import type { CategoryAspectDef } from './spec-aspects';

const P225 = { title: 'Reisekissen', variants: [{ name: 'Varianten', values: ['BLAU', 'SCHWARZ', 'GRAU'] }], specs: { 'Brand Name': 'NONE', Filling: 'COTTON', Origin: 'Mainland China' } };
const P127 = { title: 'Lebensmittelhaube', variants: [{ name: 'Varianten ', values: ['Multicolour 100pcs', 'Multicolour 50pcs', 'White 500pcs', 'Multicolour 500pcs'] }], specs: { Material: 'Plastic' } };
const PLATTE = {
  title: 'Servierplatte',
  variantPrices: [
    { skuId: '1', attrs: { Color: 'White', Size: 'Diameter 20cm', 'Ships From': 'CHINA' } },
    { skuId: '2', attrs: { Color: 'Champagne', Size: 'Diameter 25cm', 'Ships From': 'CHINA' } },
  ],
  specs: { Material: 'Stainless Steel', Produktart: 'Servierplatte' },
};

describe('P5 Farbe: feste Liste EN→DE', () => {
  test('bekannte Farben', () => {
    expect(translateColorExact('White')).toBe('Weiß');
    expect(translateColorExact('BLACK')).toBe('Schwarz');
    expect(translateColorExact('Navy Blue')).toBe('Marineblau');
    expect(translateColorExact('Multicolour')).toBe('Mehrfarbig');
    expect(translateColorExact('GRAU')).toBe('Grau');
  });
  test('unbekannt oder zwei Farben → null (nicht übernehmen)', () => {
    expect(translateColorExact('Champagne')).toBeNull();
    expect(translateColorExact('Black Red')).toBeNull();
    expect(translateColorExact('')).toBeNull();
  });
  test('je Variante aus der Auswahl (Quelle a, Wortlaut gespeichert); unbekannte Farbe → GELB, kein Wert', () => {
    const p = extractPflichtProposal(PLATTE);
    expect(p.stored.farben).toEqual({ '1': { value: 'Weiß', source: 'a', location: 'Variantenauswahl "Color"', wording: 'White' } });
    expect(p.unbekannteFarben).toEqual(['Champagne']);
    const r = resolvePflichtDaten(PLATTE);
    expect(r.farben['2']).toBeUndefined();
    expect(r.ampel.status).toBe('GELB');
    expect(r.ampel.missing).toContain('P5 Farbe unbekannt (nicht übernommen): Champagne');
  });
  test('Farbe + Stückzahl im Variantenwert (127): "White 500pcs" → Weiß', () => {
    expect(extractPflichtProposal(P127).stored.farben?.['White 500pcs']?.value).toBe('Weiß');
  });
});

describe('P3 Maße nach D2 (Zahl zuerst, immer cm)', () => {
  const f = (t: string, hint?: 'D' | 'L') => formatMeasure(parseMeasureText(t, hint));
  test('Ø, L, B × T × H, ↔', () => {
    expect(f('30x20x15cm')).toBe('30 × 20 × 15 cm');
    expect(f('about 13.5*3*2cm')).toBe('13,5 × 3 × 2 cm');
    expect(f('Diameter 20cm')).toBe('Ø 20 cm');
    expect(f('Length: 150cm')).toBe('L 150 cm');
    expect(f('stretch 14-29cm')).toBe('↔ 14 – 29 cm');
  });
  test('Umrechnung: Zoll → cm (converted), mm → cm', () => {
    expect(parseMeasureText('10inch', 'D')).toEqual({ kind: 'D', values: [25.4], converted: true });
    expect(f('125mm', 'D')).toBe('Ø 12,5 cm');
  });
  test('nicht eindeutig → null (kein Raten): Spanne ohne "dehnbar", zwei Maße, Buchstabengröße, Zahl ohne Art', () => {
    expect(parseMeasureText('14-29cm')).toBeNull();
    expect(parseMeasureText('45x50cm')).toBeNull();
    expect(parseMeasureText('S')).toBeNull();
    expect(parseMeasureText('20cm')).toBeNull();
  });
  test('Variantenauswahl (a) je Variante mit Fundstelle + Wortlaut', () => {
    expect(extractPflichtProposal(PLATTE).stored.masse).toEqual({
      '1': { kind: 'D', values: [20], source: 'a', location: 'Variantenauswahl "Size"', text: 'Diameter 20cm' },
      '2': { kind: 'D', values: [25], source: 'a', location: 'Variantenauswahl "Size"', text: 'Diameter 25cm' },
    });
  });
  test('Spezifikation (b) nur ohne Größen-Achse; D1: Variantenauswahl schlägt Spezifikation', () => {
    const single = extractPflichtProposal({ specs: { 'Product Size': '30x20x15cm' } });
    expect(single.stored.masse?.[SINGLE_UNIT_KEY]).toEqual({ kind: 'BTH', values: [30, 20, 15], source: 'b', location: 'Spezifikation "Product Size"', text: '30x20x15cm' });
    const withAxis = extractPflichtProposal({ specs: { 'Product Size': '30x20x15cm' }, variantPrices: [{ skuId: 'x', attrs: { Size: 'S' } }] });
    expect(withAxis.stored.masse).toBeUndefined();
    const both = extractPflichtProposal({ ...PLATTE, specs: { Diameter: '30cm' } });
    expect(both.stored.masse?.['1']?.source).toBe('a');
  });
});

describe('leer → GELB, keine Platzhalter', () => {
  test('225: P1–P4 fehlen → GELB mit Klartext', () => {
    const r = resolvePflichtDaten(P225);
    expect(r.ampel).toEqual({ status: 'GELB', missing: ['P1 Produktart', 'P2 Material', 'P3 Maße', 'P4 Lieferumfang'], text: 'Pflicht-Daten fehlen: P1 Produktart, P2 Material, P3 Maße, P4 Lieferumfang' });
    expect(r.produktart).toBeNull();
    expect(r.material).toBeNull();
    expect(r.lieferumfang).toBeNull();
  });
  test('127: Material (b) + Menge (a) belegt; Produktart/Maße fehlen', () => {
    const r = resolvePflichtDaten(P127);
    expect(r.material?.value).toBe('Kunststoff');
    expect(r.lieferumfang?.value).toBe('50 / 100 / 500 Stück');
    expect(r.ampel.text).toBe('Pflicht-Daten fehlen: P1 Produktart, P3 Maße');
  });
  test('englische Typ-Angabe wird keine Produktart; Material unübersetzbar → leer + Hinweis', () => {
    const p = extractPflichtProposal({ specs: { Type: 'Travel Pillow', Material: 'Memory Foam' } });
    expect(p.stored.produktart).toBeUndefined();
    expect(p.stored.material).toBeUndefined();
    expect(p.hinweise).toEqual(['Material „Memory Foam“ nicht eindeutig übersetzbar — nicht übernommen']);
  });
  test('Stückzahl nur in einem Teil der Varianten → P4 leer', () => {
    expect(extractPflichtProposal({ variants: [{ name: 'Menge', values: ['100pcs', 'Set'] }] }).stored.lieferumfang).toBeUndefined();
  });
  test('alles belegt → GRÜN', () => {
    const r = resolvePflichtDaten({ variantPrices: [{ skuId: '1', attrs: { Color: 'White', Size: 'Diameter 20cm' } }], specs: { Material: 'Plastic', Produktart: 'Teller', Quantity: '1' } , pflichtDaten: { lieferumfang: { value: '1 Teller', source: 'c', location: 'Galeriebild 3', wording: '1 x plate' } } });
    expect(r.ampel).toEqual({ status: 'GRUEN', missing: [], text: null });
  });
});

describe('Quelle gespeichert (Import nur a/b)', () => {
  test('pflichtDatenForImport speichert Wert + Quelle + Fundstelle + Wortlaut', () => {
    const json = pflichtDatenForImport(PLATTE)!;
    const s = readPflichtDaten(json)!;
    expect(s.produktart).toEqual({ value: 'Servierplatte', source: 'b', location: 'Spezifikation "Produktart"', wording: 'Servierplatte' });
    expect(s.material).toEqual({ value: 'Edelstahl', source: 'b', location: 'Spezifikation "Material"', wording: 'Stainless Steel' });
    expect(s.anwendung).toBeUndefined();
    expect(s.besonderheit).toBeUndefined();
  });
  test('nichts belegt → null (keine leere Hülle)', () => {
    expect(pflichtDatenForImport({ specs: { 'Brand Name': 'NONE' } })).toBeNull();
  });
  test('Lesereihenfolge: gespeichert → Altfeld → Vorschlag', () => {
    const stored = resolvePflichtDaten({ ...P127, material: 'Silikon', pflichtDaten: { material: { value: 'Polyethylen (PE)', source: 'c', location: 'Bild 2', wording: 'PE' } } });
    expect([stored.material?.value, stored.material?.herkunft]).toEqual(['Polyethylen (PE)', 'gespeichert']);
    const legacy = resolvePflichtDaten({ ...P127, material: 'Silikon' });
    expect([legacy.material?.value, legacy.material?.herkunft]).toEqual(['Silikon', 'altfeld']);
    const prop = resolvePflichtDaten(P127);
    expect([prop.material?.value, prop.material?.source, prop.material?.herkunft]).toEqual(['Kunststoff', 'b', 'vorschlag']);
  });
});

describe('P2 Material-Beleg', () => {
  test('Echtleder nur mit Beleg in a/b', () => {
    expect(checkMaterialEvidence('Echtleder', 'c', 'Leder').value).toBe('Leder');
    expect(checkMaterialEvidence('Echtleder', 'b', 'Genuine Leather')).toEqual({ value: 'Echtleder', downgraded: false });
  });
  test('Edelstahl 304 nur mit "304" im Wortlaut, sonst allgemeines Wort', () => {
    expect(checkMaterialEvidence('Edelstahl 304', 'b', 'Stainless Steel').value).toBe('Metall');
    expect(checkMaterialEvidence('Edelstahl 304', 'b', '304 Stainless Steel').value).toBe('Edelstahl 304');
    expect(checkMaterialEvidence('Edelstahl 304', 'c', '304 Stainless Steel').value).toBe('Metall');
  });
  test('Altfeld ohne Quelle wird ebenfalls geprüft', () => {
    const r = resolvePflichtDaten({ material: 'Echtleder' });
    expect(r.material?.value).toBe('Leder');
    expect(r.hinweise).toEqual(['„Echtleder“ ohne Beleg in Quelle a/b → „Leder“']);
  });
});

describe('Beschreibung v4 liest die Pflicht-Daten', () => {
  const FULL = {
    ...P127,
    variants: [{ name: 'Varianten ', values: ['100pcs', '200pcs'] }],
    pflichtDaten: {
      produktart: { value: 'Frischhaltehaube', source: 'c' as const, location: 'Galeriebild 1', wording: 'food cover' },
      masse: {
        '100pcs': { kind: 'STRETCH' as const, values: [14, 29], source: 'c' as const, location: 'Beschreibungsbild 3', text: '14-29cm stretch' },
        '200pcs': { kind: 'STRETCH' as const, values: [14, 29], source: 'c' as const, location: 'Beschreibungsbild 3', text: '14-29cm stretch' },
      },
    },
  };
  test('Einleitung "<Produktart> aus <Material>, <Menge>, <Maß>."', () => {
    expect(introSentence(FULL, 'Praktische Abdeckung. Zweiter Satz.')).toBe('Frischhaltehaube aus Kunststoff, 100 / 200 Stück, ↔ 14 – 29 cm.');
  });
  test('Einleitung: fehlende Teile fallen weg', () => {
    expect(introSentence({ title: 'X', pflichtDaten: { produktart: FULL.pflichtDaten.produktart } }, 'Gemini-Satz der lang genug ist.')).toBe('Frischhaltehaube.');
  });
  test('Zeilen: nur belegte, leere fallen weg', () => {
    expect(v4Rows(FULL)).toEqual([
      { key: 'MATERIAL', text: 'Kunststoff' },
      { key: 'MASSE', text: '↔ 14 – 29 cm' },
      { key: 'LIEFERUMFANG', text: '100 / 200 Stück' },
    ]);
    expect(v4Rows({ title: 'X' })).toEqual([]);
  });
  test('v3 ignoriert pflicht_daten (Ausgabe identisch mit/ohne)', () => {
    const { pflichtDaten: _pd, ...withoutPd } = FULL;
    expect(buildEbayHTMLLight(FULL)).toBe(buildEbayHTMLLight(withoutPd));
    expect(buildEbayHTMLv4(FULL)).not.toBe(buildEbayHTMLv4(withoutPd));
  });
});

describe('eBay-Merkmale aus denselben Pflicht-Daten', () => {
  const CAT: CategoryAspectDef[] = [
    { localizedAspectName: 'Produktart', aspectConstraint: { aspectMode: 'FREE_TEXT' } },
    { localizedAspectName: 'Material', aspectConstraint: { aspectMode: 'SELECTION_ONLY' }, aspectValues: [{ localizedValue: 'Edelstahl' }, { localizedValue: 'Kunststoff' }] },
    { localizedAspectName: 'Farbe', aspectConstraint: { aspectMode: 'FREE_TEXT' } },
  ];
  test('pflichtAspects: Farbe nur bei einer gemeinsamen belegten Farbe', () => {
    expect(pflichtAspects(resolvePflichtDaten(PLATTE))).toEqual({ Produktart: 'Servierplatte', Material: 'Edelstahl' });
    expect(pflichtAspects(resolvePflichtDaten({ specs: { Color: 'Black', Produktart: 'Teller' } }))).toEqual({ Produktart: 'Teller', Farbe: 'Schwarz' });
  });
  test('Kategorie-Abgleich: unbekanntes Merkmal und Wert außerhalb der Auswahlliste werden nicht gesetzt', () => {
    const m = matchPflichtToCategoryAspects({ Produktart: 'Teller', Material: 'Metall', Muster: 'x' }, CAT);
    expect(m.aspects).toEqual({ Produktart: 'Teller' });
    expect(m.skipped).toEqual(['Material: „Metall“ nicht in der eBay-Auswahlliste', 'Muster: Kategorie kennt das Merkmal nicht']);
  });
  test('buildAspects setzt Produktart/Material aus den Pflicht-Daten (vor Titel-/AliExpress-Ableitung, manualAspects gewinnt)', async () => {
    const fetchCat = (async () => new Response(JSON.stringify({ aspects: CAT }), { status: 200 })) as unknown as typeof fetch;
    const a = await buildAspects({}, undefined, 'CAT-S2-1', undefined, { Produktart: 'Hand' }, [], ['White Plate'], fetchCat, async () => 't', { Produktart: 'Servierplatte', Material: 'Edelstahl', Farbe: 'Weiß' });
    expect(a['Material']).toEqual(['Edelstahl']);
    expect(a['Farbe']).toEqual(['Weiß']);
    expect(a['Produktart']).toEqual(['Hand']);
    const none = await buildAspects({}, undefined, 'CAT-S2-2', undefined, undefined, [], [], fetchCat, async () => 't');
    expect(none['Material']).toBeUndefined();
  });
});

describe('Handeingabe speichern (PATCH pflichtDaten)', () => {
  const pm = (k: string, m: unknown, at: string) => parseMeasure(k, m, at);
  test('gültig: Wert + Quelle + Fundstelle + Wortlaut; Farbe wird auf die feste Schreibweise gebracht', () => {
    const r = parsePflichtDatenPatch({
      produktart: { value: 'Servierplatte', source: 'c', location: 'Galeriebild 1', wording: 'serving plate' },
      farben: { '1': { value: 'weiss', source: 'a', location: 'Variantenauswahl', wording: 'White' } },
      masse: { '1': { kind: 'D', values: [20], source: 'a', location: 'Variantenauswahl', text: 'Diameter 20cm' } },
    }, pm);
    expect(r.ok).toBe(true);
    const s = readPflichtDaten((r as { json: string }).json)!;
    expect(s.farben?.['1']?.value).toBe('Weiß');
    expect(s.masse?.['1']).toEqual({ kind: 'D', values: [20], text: 'Diameter 20cm', source: 'a', location: 'Variantenauswahl' });
  });
  test('ohne Quelle / ohne Wortlaut / unbekannte Farbe / Produktart über 3 Wörter → Fehler', () => {
    expect(parsePflichtDatenPatch({ material: { value: 'Holz', source: 'x', location: 'a', wording: 'wood' } }, pm)).toEqual({ ok: false, error: 'pflichtDaten.material.source muss a, b, c oder d sein' });
    expect(parsePflichtDatenPatch({ material: { value: 'Holz', source: 'b', location: 'Spezifikation', wording: '' } }, pm)).toEqual({ ok: false, error: 'pflichtDaten.material.wording (Wortlaut der Quelle) ist Pflicht' });
    expect((parsePflichtDatenPatch({ farben: { '1': { value: 'Champagner', source: 'a', location: 'x', wording: 'Champagne' } } }, pm) as { ok: false; error: string }).error).toContain('nicht in der festen Farbliste');
    expect(parsePflichtDatenPatch({ produktart: { value: 'Ein sehr langer Produktname', source: 'c', location: 'x', wording: 'y' } }, pm)).toEqual({ ok: false, error: 'pflichtDaten.produktart: höchstens 3 Wörter' });
  });
  test('leere Werte und null → null (Feld leer)', () => {
    expect(parsePflichtDatenPatch(null, pm)).toEqual({ ok: true, json: null });
    expect(parsePflichtDatenPatch({ produktart: { value: '  ', source: 'c', location: 'x', wording: 'y' } }, pm)).toEqual({ ok: true, json: null });
  });
});
