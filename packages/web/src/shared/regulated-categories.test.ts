// P-66 Schritt 3 (2026-09-16): Tests für die feld-/stichwort-genaue Erkennung, die den
// Übersteuerungs-Dialog und die verbesserte Blockier-Meldung speist. Live-Fall: Katzen-
// Futterlabyrinth (https://de.aliexpress.com/item/1005009603522097.html) — "Toy" im Titel löst
// die Spielzeug-Kategorie aus, obwohl es Heimtierbedarf ist.
import { describe, expect, test } from 'bun:test';
import { matchRegulatedCategories, matchRegulatedCategoriesDetailed, COMPLIANCE_OVERRIDE_REASONS, complianceOverrideReasonLabel } from './regulated-categories';

describe('matchRegulatedCategoriesDetailed — Feld- und Stichwort-genaue Erkennung', () => {
  test('Katzen-Futterlabyrinth-Fall: "Toy" im Titel wird als Spielzeug erkannt, Feld = title', () => {
    const result = matchRegulatedCategoriesDetailed({
      title: 'Cat Feeder Maze Toy Interactive Slow Feeder Puzzle Bowl',
      description: 'Interactive slow feeding bowl for cats, reduces eating speed.',
    });
    expect(result).toHaveLength(1);
    expect(result[0].category.id).toBe('spielzeug');
    expect(result[0].keyword).toBe('toy');
    expect(result[0].field).toBe('title');
  });

  test('Treffer nur in der Beschreibung liefert field = "description"', () => {
    const result = matchRegulatedCategoriesDetailed({
      title: 'Katzenfutterlabyrinth interaktive Schüssel Edelstahl',
      description: 'Ein kleines Plüschtier ist als Zugabe enthalten.',
    });
    expect(result).toHaveLength(1);
    expect(result[0].category.id).toBe('spielzeug');
    expect(result[0].keyword).toBe('plüschtier');
    expect(result[0].field).toBe('description');
  });

  test('kein Treffer bei unauffälligem Text', () => {
    const result = matchRegulatedCategoriesDetailed({
      title: 'Katzenfutterlabyrinth interaktive Schüssel Edelstahl',
      description: 'Langsame Fütterung, rutschfester Boden, spülmaschinenfest.',
    });
    expect(result).toHaveLength(0);
  });

  test('mehrere Kategorien gleichzeitig werden alle gemeldet', () => {
    const result = matchRegulatedCategoriesDetailed({
      title: 'Baby Toy mit Akku und Ladegerät',
      description: '',
    });
    const ids = result.map(m => m.category.id).sort();
    expect(ids).toEqual(['ce_elektronik', 'spielzeug']);
  });

  test('bestehende matchRegulatedCategories() bleibt unverändert nutzbar', () => {
    const result = matchRegulatedCategories('Dieses Spielzeug ist toll');
    expect(result.map(c => c.id)).toEqual(['spielzeug']);
  });
});

describe('COMPLIANCE_OVERRIDE_REASONS / complianceOverrideReasonLabel', () => {
  test('enthält genau die 4 im Auftrag vorgegebenen Optionen', () => {
    expect(COMPLIANCE_OVERRIDE_REASONS.map(r => r.value)).toEqual([
      'heimtierbedarf', 'lieferant_bekannt', 'kategorie_trifft_nicht_zu', 'sonstiges',
    ]);
    expect(COMPLIANCE_OVERRIDE_REASONS.map(r => r.label)).toEqual([
      'Heimtierbedarf (kein Kinderspielzeug)',
      'Lieferant ist mir bekannt und geprüft',
      'Kategorie trifft nicht zu',
      'Sonstiges (Freitext)',
    ]);
  });

  test('complianceOverrideReasonLabel löst bekannten Slug auf', () => {
    expect(complianceOverrideReasonLabel('heimtierbedarf')).toBe('Heimtierbedarf (kein Kinderspielzeug)');
  });

  test('complianceOverrideReasonLabel liefert Fallback bei unbekanntem/leerem Wert', () => {
    expect(complianceOverrideReasonLabel(null)).toBe('(kein Grund angegeben)');
    expect(complianceOverrideReasonLabel(undefined)).toBe('(kein Grund angegeben)');
  });
});
