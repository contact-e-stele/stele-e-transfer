import { describe, expect, test } from 'bun:test';
import { evaluateVariantGate } from './variant-gate';
import type { VariantGroup, VariantPriceEntry } from './variant-resolver';

const variants: VariantGroup[] = [{ name: 'Farbe', values: ['Rot', 'Blau'] }];
const rot: VariantPriceEntry = { skuId: 'A', attrs: { Color: 'Rot' }, price: 3 };
const blau: VariantPriceEntry = { skuId: 'B', attrs: { Color: 'Blau' }, price: 4 };
const gruenOrphan: VariantPriceEntry = { skuId: 'C', attrs: { Color: 'Grün' }, price: 5 };

describe('evaluateVariantGate (P-85 Schritt 2c)', () => {
  test('sauber gelöst, nur ein verwaister Eintrag → nicht blockiert, Warnung geliefert', () => {
    const r = evaluateVariantGate(1, variants, [rot, blau, gruenOrphan]);
    expect(r.blockError).toBeNull();
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('skuId C');
    expect(r.warnings[0]).toContain('verwaister Eintrag');
  });

  test('sauber gelöst, kein verwaister Eintrag → keine Warnung, nicht blockiert', () => {
    const r = evaluateVariantGate(1, variants, [rot, blau]);
    expect(r).toEqual({ blockError: null, warnings: [] });
  });

  test('Kombinationsfehler (Blau ohne Eintrag) ohne Waise → blockiert, kein Hinweis-Teil', () => {
    const r = evaluateVariantGate(1, variants, [rot]);
    expect(r.blockError).toContain('Varianten-Zuordnung fehlgeschlagen');
    expect(r.blockError).toContain('"Farbe=Blau"');
    expect(r.blockError).not.toContain('Hinweis:');
    expect(r.warnings).toEqual([]);
  });

  test('Kombinationsfehler UND Waise → blockiert, nennt beides, Waise mit "Hinweis: "-Prefix', () => {
    const r = evaluateVariantGate(1, variants, [rot, gruenOrphan]);
    expect(r.blockError).toContain('"Farbe=Blau"');
    expect(r.blockError).toContain('\nHinweis: variantPrices-Eintrag (skuId C');
    expect(r.warnings).toHaveLength(1);
  });

  test('mehrere Waisen → je eine Hinweis-Zeile', () => {
    const r = evaluateVariantGate(1, variants, [rot, gruenOrphan, { skuId: 'D', attrs: { Color: 'Gelb' }, price: 6 }]);
    expect(r.blockError!.match(/\nHinweis: /g)).toHaveLength(2);
  });
});
