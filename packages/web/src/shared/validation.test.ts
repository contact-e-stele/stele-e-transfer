import { describe, expect, test } from 'bun:test';
import { isStringRecord } from './validation';

describe('isStringRecord', () => {
  test('P-88 Nacharbeit NACHWEIS: Objekt mit reinen String-Werten → true', () => {
    expect(isStringRecord({ Marke: 'Markenlos', Farbe: 'Schwarz' })).toBe(true);
  });

  test('leeres Objekt → true (keine Werte zu verletzen)', () => {
    expect(isStringRecord({})).toBe(true);
  });

  test('Zahl als Wert → false', () => {
    expect(isStringRecord({ Marke: 123 })).toBe(false);
  });

  test('verschachteltes Objekt als Wert → false', () => {
    expect(isStringRecord({ Marke: { nested: 'x' } })).toBe(false);
  });

  test('Array statt Objekt → false', () => {
    expect(isStringRecord(['Markenlos'])).toBe(false);
  });

  test('null → false', () => {
    expect(isStringRecord(null)).toBe(false);
  });

  test('primitiver Wert (String) → false', () => {
    expect(isStringRecord('Markenlos')).toBe(false);
  });
});
