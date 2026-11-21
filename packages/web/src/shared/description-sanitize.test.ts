// P-BESCHREIBUNG (20.11.2026): echte KI-Texte aus der App (stele-259, stele-243, gelesen 20.11. über /api/products).
import { describe, expect, test } from 'bun:test';
import { brandNamesFrom, colorsIn, offeredColors, sanitizeDescriptionText } from './description-sanitize';

const intro259 = 'HOLAPET Hundeschuhe im 4er-Set für kleine Hunde wie Chihuahua, wasserdicht und warm für den Winter.';
const bullets259 = [
  'Marke Holapet: Schuhe mit PU-Obermaterial und PVC-Außensohle aus Zhejiang, China.',
  'Materialmix: Das Innenmaterial besteht aus warmer Wolle für Komfort.',
  'Farbvielfalt: Erhältlich in Rot, Blau, Gelb und Schwarz.',
  'Größenwahl: Das Set umfasst die Größen 1, 2, 3, 4 und 5.',
  'Einsatzbereich: Geeignet als wasserdichte Regenschuhe und warme Winterschuhe für Hunde.',
];
const variants259 = [{ name: 'Farbe', values: ['Schwarz'] }, { name: 'Größe', values: ['Gr. 1 – Pfote 3,0 × 2,5 cm', 'Gr. 5 – Pfote 5,0 × 4,0 cm'] }];

describe('stele-259 (HOLAPET, nur Schwarz angeboten)', () => {
  const r = sanitizeDescriptionText({ introText: intro259, bulletLines: bullets259, specs: { 'Brand Name': 'HOLAPET' }, variants: variants259 });
  test('Marke aus der Einleitung entfernt', () => {
    expect(r.introText).toBe('Hundeschuhe im 4er-Set für kleine Hunde wie Chihuahua, wasserdicht und warm für den Winter.');
  });
  test('Zeilen "Marke …" und "Rot, Blau, Gelb" fallen weg, Rest bleibt', () => {
    expect(r.bulletLines).toEqual([bullets259[1], bullets259[3], bullets259[4]]);
    expect(r.removed).toEqual([bullets259[0], bullets259[2]]);
  });
});

describe('stele-243 (WRELS, GRAY/BLACK)', () => {
  const r = sanitizeDescriptionText({
    introText: 'Warme Touchscreen-Handschuhe von WRELS für Damen und Herren: Komfort und Funktionalität für kalte Tage im Freien.',
    bulletLines: ['Marke: WRELS', 'Materialmix: Baumwolle, Leder, PU für Komfort und Strapazierfähigkeit'],
    specs: { 'Brand Name': 'WRELS' }, variants: [{ name: 'Varianten', values: ['GRAY', 'BLACK'] }],
  });
  test('"von WRELS" raus, Zeile "Marke: WRELS" raus', () => {
    expect(r.introText).toBe('Warme Touchscreen-Handschuhe für Damen und Herren: Komfort und Funktionalität für kalte Tage im Freien.');
    expect(r.bulletLines).toEqual(['Materialmix: Baumwolle, Leder, PU für Komfort und Strapazierfähigkeit']);
  });
  test('angebotene Farbe (Grau/Schwarz, englisch benannt) bleibt erlaubt', () => {
    const k = sanitizeDescriptionText({ introText: '', bulletLines: ['Farbe: In Grau und Schwarz erhältlich.'], variants: [{ name: 'Varianten', values: ['GRAY', 'BLACK'] }] });
    expect(k.bulletLines).toEqual(['Farbe: In Grau und Schwarz erhältlich.']);
  });
});

describe('Grenzen', () => {
  test('ohne Farbachse keine Farbprüfung', () => {
    expect(offeredColors([{ name: 'Größe', values: ['S'] }])).toBeNull();
    const r = sanitizeDescriptionText({ introText: 'Rote Box.', bulletLines: ['Farbe: Rot und Blau.'], variants: [{ name: 'Größe', values: ['S'] }] });
    expect(r.bulletLines).toEqual(['Farbe: Rot und Blau.']);
    expect(r.introText).toBe('Rote Box.');
  });
  test('gebeugte Farben zählen (rote, blauen); Rotation nicht', () => {
    expect([...colorsIn('rote Sohle mit blauen Nähten')].sort()).toEqual(['blau', 'rot']);
    const r = sanitizeDescriptionText({ introText: '', bulletLines: ['Sohle: Rote Gummisohle.'], variants: variants259 });
    expect(r.bulletLines).toEqual([]);
  });
  test('"Markenlos" in den Specs ist keine Marke', () => {
    expect(brandNamesFrom({ 'Brand Name': 'Markenlos', Marke: 'none', Material: 'PU' })).toEqual([]);
  });
  test('Wortteile: Dunkelblau = blau; "Rotation" ist keine Farbe', () => {
    expect([...colorsIn('Dunkelblau')]).toEqual(['blau']);
    expect([...colorsIn('Rotation und Gelbfilter')]).toEqual([]);
  });
  test('Einleitung mit nicht angebotener Farbe fällt ganz weg', () => {
    const r = sanitizeDescriptionText({ introText: 'Hundeschuhe in Rot und Schwarz.', bulletLines: [], variants: variants259 });
    expect(r.introText).toBe('');
  });
});

// Teil 2 (20.11.2026, Fund nach Neusenden 259): Überschrift (generatedTitle) und Datentabelle "Farbe" (Spezifikation "Color").
// Echte Daten stele-259 aus /api/products: generatedTitle, specs "Brand Name": "Holapet", "Color": "Red Blue Yellow Black".
import { factRows, headingText } from './description-v3';
import { stripBrandFromTitle } from './description-sanitize';
describe('Teil 2: Überschrift + Farbe-Zeile stele-259', () => {
  const specs = { 'Brand Name': 'Holapet', Color: 'Red Blue Yellow Black' };
  const title = 'HOLAPET Hundeschuhe Winter 4 Stück Fleece wasserdicht kleine Hunde Chihuahua';
  test('Marke aus Titelzeile/Überschrift', () => {
    expect(stripBrandFromTitle(title, specs)).toBe('Hundeschuhe Winter 4 Stück Fleece wasserdicht kleine Hunde Chihuahua');
    expect(headingText({ title, specs, variants: variants259 })).not.toMatch(/holapet/i);
  });
  test('Farbe = nur angebotene Variante (Schwarz), nicht die Spezifikation', () => {
    const farbe = factRows({ title, specs, variants: variants259 }).find(r => r.label === 'Farbe');
    expect(farbe?.value).toBe('Schwarz');
  });
  test('ohne Farbachse bleibt die Spezifikation wie bisher', () => {
    const farbe = factRows({ title, specs: { Color: 'Black' }, variants: [{ name: 'Größe', values: ['S'] }] }).find(r => r.label === 'Farbe');
    expect(farbe?.value).toBe('Schwarz');
  });
});
