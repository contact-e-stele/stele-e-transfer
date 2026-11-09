// S2-Folge "Übersetzungsliste + Maß aus Varianten" — DESIGN an 7 App 09.11.2026 12:41 + ABNAHME DESIGN S2: MÄNGEL 12:41.
// Fixtures 70/120/226 = echte Live-Daten (gelesen 09.11., Titel/Spezifikationen/Varianten wörtlich wie im Auftrag).
// Erwartungswerte mit bun aus den Funktionen nachgerechnet (Grundgesetz 3).
import { describe, expect, test } from 'bun:test';
import {
  extractPflichtProposal, materialProposalFromText, parseVariantPlainMeasure, pflichtAspects, pflichtDatenForImport,
  resolvePflichtDaten, titleWordFor, translateProductType,
} from './pflicht-daten';
import { formatMeasure } from './variant-measure';
import { parseMeasure } from './product-data-patch';
import { v4Content } from './description-v4';

const P70 = {
  title: 'Edelstahl Waschschüssel Abtropfsieb Küchenhelfer Kochzubehör Praktisch Flexibel',
  specs: { 'Brand Name': 'KEMORELA', 'Metal Type': 'Stainless Steel', 'Model Number': 'YS-9481', Feature: 'Eco-Friendly', Type: 'Colanders & Strainers', Origin: 'Mainland China' },
  variants: [{ name: 'Color', values: ['Silber-Optik', 'Gold-Optik'] }],
};
const P120 = {
  title: 'Frischhaltehauben für Lebensmittel, Bunt, Elastisch, Staubdicht, Lebensmittelech',
  specs: { Material: 'PE', Size: 'Pack of 100', 'Disposable Food Cove': 'Food Cover Plastic', 'Product category': 'Fresh keeping film', 'Type of plastic wrap': 'Fresh keeping of ordinary refriger', Feature: 'Bpa-free plastic' },
  variants: [
    { name: 'Color', values: ['Light Grey'] },
    { name: 'Number of Pcs', values: ['50PCS', '100PCS'] },
    { name: 'Specification', values: ['120CM', '40-42CM', '70CM', '47CM', '52CM', '60CM'] },
  ],
};
const P226 = {
  title: 'Leder Adressanhänger Business Reisegepäck Koffer Namensschild Boarding Pass',
  specs: { Type: 'Tag', Material: 'leather' },
};

describe('stele-70 (echte Daten)', () => {
  const r = resolvePflichtDaten(P70);
  test('Produktart: Merkmal = Listenwort "Küchensieb", Einleitung = Titelwort "Abtropfsieb"', () => {
    expect(r.produktart).toEqual({ value: 'Küchensieb', source: 'b', location: 'Spezifikation "Type" – b, übersetzt (Liste)', wording: 'Colanders & Strainers', herkunft: 'vorschlag', titelwort: 'Abtropfsieb' });
    expect(pflichtAspects(r)).toEqual({ Produktart: 'Küchensieb', Material: 'Edelstahl' });
    expect(v4Content(P70).intro).toBe('Abtropfsieb aus Edelstahl.');
  });
  test('Material aus "Metal Type: Stainless Steel" → "Edelstahl" (Quelle b, nicht "Edelstahl 304")', () => {
    expect(r.material).toEqual({ value: 'Edelstahl', source: 'b', location: 'Spezifikation "Metal Type"', wording: 'Stainless Steel', herkunft: 'vorschlag' });
  });
  test('Maße leer (kein Beleg), GELB nur bei echten Lücken', () => {
    expect(r.masseText).toBeNull();
    expect(r.ampel).toEqual({
      status: 'GELB',
      missing: ['Maße', 'Lieferumfang', 'Farbe unbekannt (nicht übernommen): Silber-Optik, Gold-Optik'],
      text: 'Pflicht-Daten fehlen: Maße, Lieferumfang · Farbe unbekannt: Silber-Optik, Gold-Optik',
    });
    expect(r.hinweise).toEqual([]);
  });
});

describe('stele-120 (echte Daten)', () => {
  const r = resolvePflichtDaten(P120);
  test('Produktart aus "Disposable Food Cove: Food Cover Plastic" → Frischhaltehaube, Titelwort "Frischhaltehauben"', () => {
    expect(r.produktart).toEqual({ value: 'Frischhaltehaube', source: 'b', location: 'Spezifikation "Disposable Food Cove" – b, übersetzt (Liste)', wording: 'Food Cover Plastic', herkunft: 'vorschlag', titelwort: 'Frischhaltehauben' });
  });
  test('Maß je Variante aus "Specification" (Quelle a), ohne Ø/↔; Anzeige "je nach Variante, siehe Auswahl"', () => {
    expect(r.units.length).toBe(12);
    expect(Object.keys(r.masse).length).toBe(12);
    expect(r.masse['Light Grey / 50PCS / 120CM']).toEqual({ kind: 'M', values: [120], source: 'a', location: 'Variantenauswahl "Specification"', text: '120CM', herkunft: 'vorschlag' });
    expect(r.masse['Light Grey / 100PCS / 40-42CM']).toEqual({ kind: 'SPANNE', values: [40, 42], source: 'a', location: 'Variantenauswahl "Specification"', text: '40-42CM', herkunft: 'vorschlag' });
    expect(formatMeasure(r.masse['Light Grey / 50PCS / 120CM'])).toBe('120 cm');
    expect(formatMeasure(r.masse['Light Grey / 100PCS / 40-42CM'])).toBe('40–42 cm');
    expect(Object.values(r.masse).map(m => formatMeasure(m)).join('|')).not.toMatch(/Ø|↔/);
    expect(r.masseText).toBe('je nach Variante, siehe Auswahl');
  });
  test('Lieferumfang bleibt "50 / 100 Stück", Material PE, Ampel GRÜN', () => {
    expect(r.lieferumfang?.value).toBe('50 / 100 Stück');
    expect(r.material?.value).toBe('Polyethylen (PE)');
    expect(r.ampel).toEqual({ status: 'GRUEN', missing: [], text: null });
    expect(r.hinweise).toEqual([]);
  });
  test('v4: Einleitung mit Titelwort + Menge, MASSE als eigene Zeile', () => {
    expect(v4Content(P120)).toEqual({
      intro: 'Frischhaltehauben aus Polyethylen (PE), 50 / 100 Stück.',
      rows: [{ key: 'MASSE', text: 'je nach Variante, siehe Auswahl' }],
    });
  });
  test('nur eine Größe → "120 cm (laut Variante)", nicht in der Einleitung', () => {
    const one = { ...P120, variants: [P120.variants[0], P120.variants[1], { name: 'Specification', values: ['120CM'] }] };
    expect(resolvePflichtDaten(one).masseText).toBe('120 cm (laut Variante)');
    expect(v4Content(one)).toEqual({
      intro: 'Frischhaltehauben aus Polyethylen (PE), 50 / 100 Stück.',
      rows: [{ key: 'MASSE', text: '120 cm (laut Variante)' }],
    });
  });
  test('nicht lesbarer Varianten-Wert → kein Maß, GELB (nie schätzen)', () => {
    const bad = { ...P120, variants: [P120.variants[0], P120.variants[1], { name: 'Specification', values: ['120CM', 'Large'] }] };
    const rb = resolvePflichtDaten(bad);
    expect(rb.ampel.status).toBe('GELB');
    expect(rb.ampel.missing).toEqual(['Maße (Light Grey / 50PCS / Large, Light Grey / 100PCS / Large)']);
  });
});

describe('stele-226 (echte Daten)', () => {
  const r = resolvePflichtDaten(P226);
  test('"Tag" + Titel mit "Reisegepäck"/"Koffer" → Gepäckanhänger, Titelwort "Adressanhänger"', () => {
    expect(r.produktart).toEqual({ value: 'Gepäckanhänger', source: 'b', location: 'Spezifikation "Type" – b, übersetzt (Liste)', wording: 'Tag', herkunft: 'vorschlag', titelwort: 'Adressanhänger' });
    expect(r.material?.value).toBe('Leder');
    expect(v4Content(P226).intro).toBe('Adressanhänger aus Leder.');
  });
  test('Maße/Lieferumfang ohne Beleg → GELB', () => {
    expect(r.masseText).toBeNull();
    expect(r.ampel).toEqual({ status: 'GELB', missing: ['Maße', 'Lieferumfang'], text: 'Pflicht-Daten fehlen: Maße, Lieferumfang' });
  });
  test('"Tag" ohne Gepäck/Koffer im Titel → leer + GELB + Hinweis', () => {
    const r2 = resolvePflichtDaten({ ...P226, title: 'Leder Namensschild Business' });
    expect(r2.produktart).toBeNull();
    expect(r2.ampel.missing[0]).toBe('Produktart');
    expect(r2.hinweise).toContain('Produktart „Tag“ nur mit „Gepäck“/„Koffer“ im Titel → Gepäckanhänger — nicht übernommen');
  });
});

describe('Übersetzungsliste + Titel-Abgleich', () => {
  test('Listen-Einträge (DESIGN 12:41 Punkt 1)', () => {
    expect(translateProductType('Colanders & Strainers')).toBe('Küchensieb');
    expect(translateProductType('Food Cover Plastic')).toBe('Frischhaltehaube');
    expect(translateProductType('Tag', 'Koffer Anhänger')).toBe('Gepäckanhänger');
    expect(translateProductType('Tag', 'GEPÄCK Schild')).toBe('Gepäckanhänger');
    expect(translateProductType('Tag', 'Namensschild')).toBeNull();
    expect(translateProductType('Tag')).toBeNull();
    expect(translateProductType('Fresh keeping film')).toBeNull();
  });
  test('Titelwort: Kernwort "sieb"/"anhänger", sonst Listenwort selbst', () => {
    expect(titleWordFor('Küchensieb', P70.title)).toBe('Abtropfsieb');
    expect(titleWordFor('Frischhaltehaube', P120.title)).toBe('Frischhaltehauben');
    expect(titleWordFor('Gepäckanhänger', P226.title)).toBe('Adressanhänger');
    expect(titleWordFor('Wärmflasche', 'Kissen weich')).toBeNull();
  });
  test('passt nicht zum Titel → nicht übernommen (auch beim Import-Vorschlag)', () => {
    const p = extractPflichtProposal({ ...P120, title: 'Schüsselabdeckung bunt' });
    expect(p.stored.produktart).toBeUndefined();
    expect(p.hinweise).toContain('Produktart „Frischhaltehaube“ (Liste, aus „Food Cover Plastic“) passt nicht zum Titel — nicht übernommen');
    expect(JSON.parse(pflichtDatenForImport(P120)!).produktart.value).toBe('Frischhaltehaube');
    expect(JSON.parse(pflichtDatenForImport({ ...P120, title: 'Schüsselabdeckung bunt' })!).produktart).toBeUndefined();
  });
  test('zwei Typ-Schlüssel mit verschiedenen Übersetzungen → nichts übernommen', () => {
    const r = extractPflichtProposal({ title: 'Küchensieb Frischhaltehaube', specs: { Type: 'Strainer', 'Product category': 'Food Cover' } });
    expect(r.stored.produktart).toBeUndefined();
    expect(r.hinweise).toContain('Produktart widersprüchlich („Strainer“ → Küchensieb, „Food Cover“ → Frischhaltehaube) — nicht übernommen');
  });
});

describe('Maß aus Variantenwert (parseVariantPlainMeasure)', () => {
  test('nur Zahl + Einheit bzw. Spanne; sonst null', () => {
    expect(parseVariantPlainMeasure('120CM')).toEqual({ kind: 'M', values: [120] });
    expect(parseVariantPlainMeasure('40-42CM')).toEqual({ kind: 'SPANNE', values: [40, 42] });
    expect(parseVariantPlainMeasure('35mm')).toEqual({ kind: 'M', values: [3.5] });
    expect(parseVariantPlainMeasure('50PCS')).toBeNull();
    expect(parseVariantPlainMeasure('Pack of 100')).toBeNull();
    expect(parseVariantPlainMeasure('42-40CM')).toBeNull();
    expect(parseVariantPlainMeasure('120')).toBeNull();
  });
  test('Speichern: neue Arten M/SPANNE werden geprüft', () => {
    expect(parseMeasure('1', { kind: 'M', values: [120], source: 'a', location: 'Variantenauswahl "Specification"' }).ok).toBe(true);
    expect(parseMeasure('1', { kind: 'SPANNE', values: [42, 40], source: 'a', location: 'x' })).toEqual({ ok: false, error: 'variantDetails["1"].measure.values: bei SPANNE muss der erste Wert kleiner oder gleich dem zweiten sein' });
  });
});

describe('Lücke 3: Material aus Quelle c nur als Vorschlag', () => {
  test('"304 stainless steel" → Vorschlag "Edelstahl" mit Wortlaut, nicht übernommen, GELB "bitte bestätigen"', () => {
    expect(materialProposalFromText('Material: 304 stainless steel, durable', 'Beschreibungsbild 2'))
      .toEqual({ value: 'Edelstahl', wording: '304 stainless steel', location: 'Beschreibungsbild 2' });
    const noB = { ...P70, specs: { ...P70.specs, 'Metal Type': '' } };
    const r = resolvePflichtDaten({ ...noB, textC: { text: 'Material: 304 stainless steel, durable', location: 'Beschreibungsbild 2' } });
    expect(r.material).toBeNull();
    expect(r.materialVorschlagC).toEqual({ value: 'Edelstahl', wording: '304 stainless steel', location: 'Beschreibungsbild 2' });
    expect(r.ampel.missing).toContain('Material-Vorschlag „Edelstahl“ aus Quelle c (Beschreibungsbild 2: „304 stainless steel“) — bitte bestätigen, nicht übernommen');
    expect(pflichtAspects(r)['Material']).toBeUndefined();
  });
  test('mit Material aus b gibt es keinen c-Vorschlag; mehrdeutiger Text → kein Vorschlag', () => {
    expect(resolvePflichtDaten({ ...P70, textC: { text: '304 stainless steel', location: 'Bild 1' } }).materialVorschlagC).toBeNull();
    expect(materialProposalFromText('stainless steel and plastic handle', 'Bild 1')).toBeNull();
  });
});
