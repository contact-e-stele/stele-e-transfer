// AUFSICHT AUFTRAG 23.11.2026 10:10: v4 Inhalt-Fallback (Live-Befund 137/160/215 fast ohne Produktinhalt).
import { describe, expect, test } from 'bun:test';
import { buildEbayHTMLv4 } from '../web/lib/ebay-description';
import { stripEnglishParenthetical, v4FallbackBullets, v4FallbackIntro, V4_MIN_ROWS } from './description-v4';

// Produkt ohne Pflicht-Daten P1–P7, mit alter KI-Beschreibung im v3-Format (wie 215 vor der Umstellung).
const OHNE_PFLICHT = {
  title: 'Küchensieb Edelstahl Nudelsieb',
  description: '###INTRO### Edelstahl-Küchensieb für Reis, Obst und Gemüse.###BULLETS###\n- Material: Hochwertiger Edelstahl, rostfrei\n- Produkttyp: Küchensieb (Colander) für die Küche\n- Form: Schüssel (Washing Bowls) mit Griffen\n- Schnell bei Ihnen in 3–10 Werktagen per DHL / Deutsche Post\n- Spülmaschinenfest und leicht zu reinigen###OUTRO### Ideal für jede Küche.',
  specs: {},
};

describe('v4 Inhalt-Fallback', () => {
  test('ohne Pflicht-Daten: v4 zeigt die Stichpunkte der bisherigen Beschreibung', () => {
    const html = buildEbayHTMLv4(OHNE_PFLICHT);
    expect(html).toContain('stele-v4-bullets');
    expect(html).toContain('Hochwertiger Edelstahl, rostfrei');
    expect(html).toContain('Spülmaschinenfest und leicht zu reinigen');
    expect(html).toContain('Edelstahl-Küchensieb für Reis, Obst und Gemüse.');
  });
  test('kein alter Versand-/Varianten-Text: kein „3–10 Werktage“, kein „DHL“, kein „VERFÜGBARE VARIANTEN“', () => {
    const html = buildEbayHTMLv4(OHNE_PFLICHT);
    expect(html).not.toContain('3–10');
    expect(html).not.toContain('DHL');
    expect(html.toUpperCase()).not.toContain('VERFÜGBARE VARIANTEN');
  });
  test('englische Klammern werden entfernt', () => {
    const html = buildEbayHTMLv4(OHNE_PFLICHT);
    expect(html).not.toContain('(Colander)');
    expect(html).not.toContain('(Washing Bowls)');
    expect(html).toContain('Küchensieb für die Küche');
  });
  test('stripEnglishParenthetical lässt Abkürzungen und Zahlen stehen', () => {
    expect(stripEnglishParenthetical('Küchensieb (Colander)')).toBe('Küchensieb');
    expect(stripEnglishParenthetical('Größe (XXL) passt')).toBe('Größe (XXL) passt');
    expect(stripEnglishParenthetical('Set (2 Stück)')).toBe('Set (2 Stück)');
  });
  test('genug Pflicht-Daten-Zeilen → kein Fallback', () => {
    const row = { key: 'MATERIAL' as const };
    expect(v4FallbackBullets(['Spülmaschinenfest und leicht zu reinigen'], Array(V4_MIN_ROWS).fill(row))).toEqual([]);
    expect(v4FallbackBullets(['Spülmaschinenfest und leicht zu reinigen'], [row]).length).toBe(1);
    // Stichpunkt mit Stichwort, das schon als Zeile steht, entfällt (keine Doppelung)
    expect(v4FallbackBullets(['Material: Kunststoff, lebensmittelecht'], [row])).toEqual([]);
    // Doppelung belegt keinen der 5 Plätze (Vorschau 215: sonst fiel „Form“ weg)
    const six = ['Material: Edelstahl', 'Funktion: Waschen von Reis', 'Einsatzbereich: Küche', 'Produkttyp: Küchensieb', 'Anwendung: Reinigung', 'Form: Schüssel mit Griffen'];
    expect(v4FallbackBullets(six, [row]).map(b => b.keyword)).toEqual(['FUNKTION', 'EINSATZBEREICH', 'PRODUKTTYP', 'ANWENDUNG', 'FORM']);
    expect(v4FallbackIntro('Sieb aus Edelstahl.', 'KI-Satz', 0)).toBeNull();
    expect(v4FallbackIntro(null, 'KI-Satz', 0)).toBe('KI-Satz');
  });
});

// ABNAHME DESIGN 24.11. 16:25 Punkt 4 (Befund 127): KI-Stichpunkte dürfen belegten Angaben nicht widersprechen.
import { contradictsListing } from './description-v4';
describe('v4 Fallback: keine Widersprüche zu Menge und Mehrweg/Einweg (Befund 127)', () => {
  test('Mengen-Stichpunkt fällt weg, wenn LIEFERUMFANG steht; sonst bleibt er', () => {
    expect(contradictsListing('Erhältlich in Packungen zu 50 Stück, 100 Stück und 300 Stück.', 'X', true)).toBe(true);
    expect(contradictsListing('Erhältlich in Packungen zu 50 Stück, 100 Stück und 300 Stück.', 'X', false)).toBe(false);
    expect(contradictsListing('Set aus 3 Taschen', 'X', true)).toBe(true);
    expect(contradictsListing('Hält Speisen 2 Tage frisch', 'X', true)).toBe(false);
  });
  test('Einweg gegen Titel Mehrweg und umgekehrt', () => {
    expect(contradictsListing('Hygienische Einweglösung zur Abdeckung', 'Frischhalteplatte Mehrweg Abdeckungen', false)).toBe(true);
    expect(contradictsListing('Wiederverwendbar und abwaschbar', 'Einweg Frischhaltehauben', false)).toBe(true);
    expect(contradictsListing('Wiederverwendbar und abwaschbar', 'Frischhalteplatte Mehrweg', false)).toBe(false);
  });
  test('127-Fall im HTML: richtige Zeile bleibt, widersprüchliche Stichpunkte und Einleitung fallen weg', () => {
    const html = buildEbayHTMLv4({
      title: 'Lebensmittelhaube Frischhalteplatte Mehrweg Abdeckungen Bunt Essensschutz',
      description: '###INTRO### Schützen Sie Lebensmittel mit diesen bunten Einweg-Frischhaltehauben.###BULLETS###\n- ERHÄLTLICH IN PACKUNGSGRÖSSEN: 50 Stück, 100 Stück und 300 Stück.\n- Flexible Passform dank elastischem Rand für verschiedene Behälter.\n- Einfache und hygienische Einweglösung zur Abdeckung von Speisen.\n- Farbige Gestaltung zur besseren Übersicht.###OUTRO### x',
      specs: {}, material: 'Kunststoff',
      pflichtDaten: { lieferumfang: { value: '50 / 100 / 500 Stück', source: 'a', location: 'Variantenauswahl', wording: '50/100/500pcs' } },
    } as any);
    expect(html).toContain('50 / 100 / 500 Stück');
    expect(html).not.toContain('300 Stück');
    expect(html).not.toContain('Einweg');
    expect(html).toContain('Flexible Passform');
    expect(html).toContain('Farbige Gestaltung');
  });
});
