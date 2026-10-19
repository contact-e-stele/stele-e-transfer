import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { productIdentifierFields, EAN_NOT_APPLICABLE_DE, prettifyEbayError } from './ebay';

// OFFEN 008: stele-232 (Kat 47921) und stele-228 (Kat 101406) — in der App-DB steht ean = "Nicht zutreffend" (live gelesen 19.10.2026),
// gesendet wurde es als "gtin" (kein Feld des Inventory-API-Typs Product) → "Das Feld EAN fehlt".
describe('EAN als Produktkennung (product.ean)', () => {
  test('ohne EAN → ["Nicht zutreffend"] (eBay.de Ersatztext)', () => {
    expect(EAN_NOT_APPLICABLE_DE).toBe('Nicht zutreffend');
    expect(productIdentifierFields(null)).toEqual({ ean: ['Nicht zutreffend'] });
    expect(productIdentifierFields('  ')).toEqual({ ean: ['Nicht zutreffend'] });
    expect(productIdentifierFields('Nicht zutreffend')).toEqual({ ean: ['Nicht zutreffend'] });
  });
  test('echte EAN wird unverändert (getrimmt) gesendet', () => {
    expect(productIdentifierFields(' 4006381333931 ')).toEqual({ ean: ['4006381333931'] });
  });
  test('kein "gtin" mehr im Inventory-Item, beide Stellen (Einzelartikel + Varianten) nutzen product.ean', () => {
    const src = readFileSync(resolve(import.meta.dir, 'ebay.ts'), 'utf-8');
    expect(src).not.toMatch(/\{\s*gtin:/);
    expect(src.match(/\.\.\.productIdentifierFields\(input\.ean\)/g)?.length).toBe(2);
  });
  test('Fehlertext sagt, dass eBay abgelehnt hat (mit Fehlernummer)', () => {
    // Aufbau einer eBay-Fehlerantwort; die Nummer ist hier ein Beispielwert (die echte für 232 steht erst nach dem Live-Versuch fest).
    const raw = 'publish failed: {"errors":[{"errorId":25002,"message":"Das Feld EAN fehlt."}]}';
    expect(prettifyEbayError(raw)).toBe('eBay lehnt ab (Fehler 25002): Pflichtfeld "EAN" fehlt und konnte nicht automatisch befüllt werden — bitte im Produkte-Tab manuell ergänzen oder eBay-Kategorie prüfen.');
  });
});
