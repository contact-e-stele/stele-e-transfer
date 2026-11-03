// OFFEN 026 — Variantenachse je Kategorie. Herkunft der Fixtures steht an jedem Test (Grundgesetz 4: nichts erfunden).
import { describe, test, expect } from 'bun:test';
import { planVariantAxes, matchAllowedValue, categoryAspectMap, type CategoryAspectInfo } from './variant-axis-aspect';
import { mapVariantGroupName, findColorInTitle, checkVariantAxisCoverage } from '../api/ebay';

const deps = { baseName: mapVariantGroupName, colorOf: (v: string) => findColorInTitle(v) };

// Kat. 11511 (Socken), Größe — live aus der eBay-Taxonomie gelesen am 29.10.2026 (ERGEBNIS 019, stele-244/248).
// Die dort genannten UK/US-Größen sind hier weggelassen (nicht wörtlich überliefert).
const SOCKEN_11511_GROESSE = ['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '35-38', '39-42', '43-46', '47-50', '51-54', 'Einheitsgröße'];

describe('Socken (Kat. 11511, stele-248): Größe nur aus eBays Liste', () => {
  const cat: Record<string, CategoryAspectInfo> = {
    'Größe': { allowedValues: SOCKEN_11511_GROESSE, mode: 'SELECTION_ONLY', required: true },
  };
  test('Inhaber "C2 ja": AliExpress "40-42(26cm)"/"43-45(28cm)" wird NICHT auf 39-42/43-46 gesetzt → Meldung, Vorab-Prüfung stoppt', () => {
    const [p] = planVariantAxes([{ name: 'Size', values: ['40-42(26cm)', '43-45(28cm)'] }], cat, deps);
    expect(p.aspectName).toBe('Größe');
    expect(p.values).toEqual(['40-42(26cm)', '43-45(28cm)']);
    expect(p.mapped).toEqual([]);
    expect(p.problems).toEqual(["Größe: Wert '40-42(26cm)' nicht in eBays Liste", "Größe: Wert '43-45(28cm)' nicht in eBays Liste"]);
  });
  test('REGRESSION: eine Spanne wird NIE auf eine andere eBay-Spanne abgebildet (auch nicht bei voller Enthaltung)', () => {
    for (const v of ['40-42', '39-41', '36-37', '44-45', '40']) {
      expect(matchAllowedValue(v, SOCKEN_11511_GROESSE)).toBeNull();
    }
  });
  test('Klammerzusatz ohne Größen-Änderung: "39-42(EU)" → "39-42", "M(EU)" → "M"', () => {
    const [p] = planVariantAxes([{ name: 'Size', values: ['39-42(EU)', 'M(EU)'] }], cat, deps);
    expect(p.values).toEqual(['39-42', 'M']);
    expect(p.problems).toEqual([]);
  });
  test('zwei App-Werte → derselbe eBay-Wert → Meldung (eBay sähe zwei gleiche Varianten)', () => {
    const [p] = planVariantAxes([{ name: 'Size', values: ['XXL', '2XL'] }], cat, deps);
    expect(p.problems).toEqual(["Größe: 'XXL' und '2XL' ergäben beide '2XL'"]);
  });
  test('Buchstabengrößen: XXL → 2XL, One Size → Einheitsgröße', () => {
    const [p] = planVariantAxes([{ name: 'Size', values: ['M', 'XXL', 'One Size'] }], cat, deps);
    expect(p.values).toEqual(['M', '2XL', 'Einheitsgröße']);
    expect(p.problems).toEqual([]);
  });
});

// Kat. 11632 — ERGEBNIS 019 zu stele-241 (29.10.2026): "EU-Schuhgröße" nur Einzelgrößen (36, 36,5, 37 …), keine Spannen.
// Werteliste hier nur der überlieferte Ausschnitt.
describe('Schuhe (Kat. 11632, stele-241): Achse "Shoe Size" → "EU-Schuhgröße"', () => {
  const cat: Record<string, CategoryAspectInfo> = {
    'EU-Schuhgröße': { allowedValues: ['36', '36,5', '37'], mode: 'SELECTION_ONLY', required: true },
  };
  test('Name wird je Kategorie umgestellt, Einzelgröße passt exakt', () => {
    const [p] = planVariantAxes([{ name: 'Shoe Size', values: ['36', '37'] }], cat, deps);
    expect(p.aspectName).toBe('EU-Schuhgröße');
    expect(p.renamedFrom).toBe('Shoe Size'); // feste Tabelle kennt "Shoe Size" nicht → bisher roher Name an eBay
    expect(p.values).toEqual(['36', '37']);
  });
  test('Spanne "36-37" ist keine Einzelgröße → Meldung (wie live bei 241)', () => {
    const [p] = planVariantAxes([{ name: 'Shoe Size', values: ['36-37'] }], cat, deps);
    expect(p.problems).toEqual(["EU-Schuhgröße: Wert '36-37' nicht in eBays Liste"]);
  });
});

// Handschuhe stele-243 (Kat. 105559, 29.10.2026): Pflicht "Farbe" + "Größe"; Achse hieß "Varianten" (GRAY/BLACK) und
// war nur mit manualAspects Farbe=Mehrfarbig / Größe=Einheitsgröße listbar. Ob Farbe in 105559 Freitext ist, ist NICHT
// live gelesen → Test mit Freitext (Werte bleiben) und mit Auswahlliste (deutsche Grundfarbe) getrennt.
describe('Handschuhe (Kat. 105559, stele-243): Farb-Achse wird "Farbe"', () => {
  test('Freitext-Farbe: Achse "Varianten" mit lauter Farbwörtern → "Farbe", Werte unverändert', () => {
    const cat = { 'Farbe': { allowedValues: [], mode: 'FREE_TEXT' as const, required: true }, 'Größe': { allowedValues: [], mode: 'FREE_TEXT' as const, required: true } };
    const [p] = planVariantAxes([{ name: 'Varianten', values: ['GRAY', 'BLACK'] }], cat, deps);
    expect(p.aspectName).toBe('Farbe');
    expect(p.values).toEqual(['GRAY', 'BLACK']);
  });
  test('Auswahlliste: GRAY/BLACK → Grau/Schwarz', () => {
    const cat = { 'Farbe': { allowedValues: ['Grau', 'Schwarz', 'Mehrfarbig'], mode: 'SELECTION_ONLY' as const, required: true } };
    const [p] = planVariantAxes([{ name: 'Color', values: ['GRAY', 'BLACK'] }], cat, deps);
    expect(p.aspectName).toBe('Farbe');
    expect(p.renamedFrom).toBe('Variante');
    expect(p.values).toEqual(['Grau', 'Schwarz']);
    expect(p.problems).toEqual([]);
  });
  test('"Color" mit Set-Namen (kein Farbwort) bleibt "Variante" (stele-163/164-Regel)', () => {
    const cat = { 'Farbe': { allowedValues: [], mode: 'FREE_TEXT' as const, required: true } };
    const [p] = planVariantAxes([{ name: 'Color', values: ['832pcs-No box', '100pcs-No box'] }], cat, deps);
    expect(p.aspectName).toBe('Variante');
  });
  test('Achse Farbe + Achse Größe zusammen (stele-247, Kat. 22683: Color [black, Blue] × Size [M, L, XL])', () => {
    const cat = { 'Farbe': { allowedValues: [], mode: 'FREE_TEXT' as const, required: true }, 'Größe': { allowedValues: [], mode: 'FREE_TEXT' as const, required: true } };
    const p = planVariantAxes([{ name: 'Color', values: ['black', 'Blue'] }, { name: 'Size', values: ['M', 'L', 'XL'] }], cat, deps);
    expect(p.map(a => a.aspectName)).toEqual(['Farbe', 'Größe']);
  });
});

// Hundebekleidung (309): Kategorie-ID und Merkmalsliste sind aus der Sandbox NICHT lesbar (api.ebay.com gesperrt). Die
// Fixture prüft die REGEL "Größen-Achse → abweichender Pflicht-Größenname der Kategorie" mit dem in OFFEN 026 genannten
// möglichen Namen "Hundegröße" — keine echten eBay-Daten.
describe('Hundebekleidung (309, Regel-Fixture): Size → kategorieeigener Größen-Pflichtname', () => {
  const cat: Record<string, CategoryAspectInfo> = {
    'Hundegröße': { allowedValues: ['S', 'M', 'L', 'XL', 'XXL'], mode: 'SELECTION_ONLY', required: true },
    'Größe': { allowedValues: [], mode: 'FREE_TEXT', required: false },
  };
  test('Pflicht ist "Hundegröße", nicht "Größe" → Achse heißt "Hundegröße"', () => {
    const [p] = planVariantAxes([{ name: 'Size', values: ['M', 'L', 'XL'] }], cat, deps);
    expect(p.aspectName).toBe('Hundegröße');
    expect(p.values).toEqual(['M', 'L', 'XL']);
    expect(p.problems).toEqual([]);
  });
  test('2XL → XXL über die Buchstaben-Normalisierung', () => {
    const [p] = planVariantAxes([{ name: 'Size', values: ['2XL'] }], cat, deps);
    expect(p.values).toEqual(['XXL']);
  });
  test('Merkmal nicht variationsfähig (aspectEnabledForVariations=false) → wird nicht als Achse gewählt', () => {
    const c2 = { ...cat, 'Hundegröße': { ...cat['Hundegröße'], variationEnabled: false } };
    const [p] = planVariantAxes([{ name: 'Size', values: ['M'] }], c2, deps);
    expect(p.aspectName).toBe('Größe');
  });
});

describe('Rückfall + Schnittstellen', () => {
  test('Kategorie-Abruf fehlgeschlagen (null) → bisheriges Verhalten: feste Tabelle, Werte unverändert', () => {
    const [p] = planVariantAxes([{ name: 'Size', values: ['40-42(26cm)'] }], null, deps);
    expect(p).toEqual({ groupName: 'Size', aspectName: 'Größe', values: ['40-42(26cm)'], mapped: [], problems: [] });
  });
  test('Kategorie verlangt "Größe" selbst (Kat. 100299 Spikes ging live) → Name bleibt, Freitext-Werte bleiben', () => {
    const [p] = planVariantAxes([{ name: 'Size', values: ['M', 'L'] }], { 'Größe': { allowedValues: [], mode: 'FREE_TEXT', required: true } }, deps);
    expect(p.aspectName).toBe('Größe');
    expect(p.values).toEqual(['M', 'L']);
  });
  test('checkVariantAxisCoverage nutzt denselben Plan: Socken-Größe "39-42(EU)" gedeckt, "40-42(26cm)" nicht', () => {
    const ok = checkVariantAxisCoverage('Größe', { allowedValues: SOCKEN_11511_GROESSE, mode: 'SELECTION_ONLY' }, [{ name: 'Size', values: ['39-42(EU)'] }]);
    expect(ok).toEqual({ isAxis: true, problems: [] });
    const nein = checkVariantAxisCoverage('Größe', { allowedValues: SOCKEN_11511_GROESSE, mode: 'SELECTION_ONLY' }, [{ name: 'Size', values: ['40-42(26cm)'] }]);
    expect(nein).toEqual({ isAxis: true, problems: ["Größe: Wert '40-42(26cm)' nicht in eBays Liste"] });
  });
  test('categoryAspectMap übernimmt aspectEnabledForVariations', () => {
    const m = categoryAspectMap([{ localizedAspectName: 'Größe', aspectConstraint: { aspectRequired: true, aspectMode: 'SELECTION_ONLY', aspectEnabledForVariations: true }, aspectValues: [{ localizedValue: 'M' }] }]);
    expect(m).toEqual({ 'Größe': { allowedValues: ['M'], mode: 'SELECTION_ONLY', required: true, variationEnabled: true } });
  });
});

// OFFEN 026c — live gelesen 03.11.2026 über GET /api/ebay/category-axis-aspects?categoryId=11511 bzw. 105559:
// "Größe" ist laut Taxonomy FREE_TEXT mit Werteliste; eBay nimmt trotzdem keine freien Größen (ERGEBNIS 019).
describe('OFFEN 026c: Größen-Liste ist verbindlich, auch wenn Taxonomy FREE_TEXT meldet', () => {
  const SOCKEN_LIVE = ['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '35-38', '39-42', '43-46', '47-50', '51-54', 'Einheitsgröße', 'UK 4-7', 'UK 7-9', 'UK 9-11', 'UK 10-13', 'UK 13-15', 'US 7-9', 'US 9-11', 'US 10-13', 'US 13-15'];
  const HANDSCHUH_LIVE = ['XS', 'S', 'M', 'L', 'XL', '2XL', '6', '6,5', '7', '7,5', '8', '8,5', '9', '9,5', '10', '10,5', '11', 'Einheitsgröße'];
  test('Socken 11511 (FREE_TEXT live): "40-42(26cm)" → Meldung, Vorab-Prüfung stoppt', () => {
    const [p] = planVariantAxes([{ name: 'Size', values: ['40-42(26cm)', '39-42'] }], { 'Größe': { allowedValues: SOCKEN_LIVE, mode: 'FREE_TEXT', required: true, variationEnabled: true } }, deps);
    expect(p.values).toEqual(['40-42(26cm)', '39-42']);
    expect(p.problems).toEqual(["Größe: Wert '40-42(26cm)' nicht in eBays Liste"]);
  });
  test('Handschuhe 105559 (FREE_TEXT live): "One Size" → Einheitsgröße, "XXL" → 2XL', () => {
    const [p] = planVariantAxes([{ name: 'Size', values: ['One Size', 'XXL'] }], { 'Größe': { allowedValues: HANDSCHUH_LIVE, mode: 'FREE_TEXT', required: true, variationEnabled: true } }, deps);
    expect(p.values).toEqual(['Einheitsgröße', '2XL']);
    expect(p.problems).toEqual([]);
  });
  test('Farbe FREE_TEXT bleibt frei (nur Größen-Merkmale betroffen)', () => {
    const farben = ['Beige', 'Blau', 'Grau', 'Schwarz'];
    const [p] = planVariantAxes([{ name: 'Color', values: ['GRAY', 'BLACK'] }], { 'Farbe': { allowedValues: farben, mode: 'FREE_TEXT', required: true, variationEnabled: true } }, deps);
    expect(p.aspectName).toBe('Farbe');
    expect(p.values).toEqual(['GRAY', 'BLACK']);
    expect(p.problems).toEqual([]);
  });
});
