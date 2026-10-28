import { describe, expect, test } from 'bun:test';
import { isPriceJump, priceJumpMessage, parseAutoPriceExclusions } from './price-jump';

describe('OFFEN 010: Preissprung-Grenze 15 %', () => {
  test('stele-119 100pcs 16,45 → 38,95 ist ein Sprung', () => {
    expect(isPriceJump(16.45, 38.95)).toBe(true);
    expect(priceJumpMessage(119, 'stele-119-100PCS', 16.45, 38.95)).toBe('PREISSPRUNG stele-119 stele-119-100PCS: 16.45 → 38.95 € (+137 %, Grenze 15 %) — NICHT gesendet, bitte prüfen');
  });
  test('genau 15 % ist erlaubt, knapp darüber nicht', () => {
    expect(isPriceJump(20, 23)).toBe(false);
    expect(isPriceJump(20, 23.01)).toBe(true);
  });
  test('ohne alten Preis kein Sprung', () => {
    expect(isPriceJump(null, 50)).toBe(false);
    expect(isPriceJump(0, 50)).toBe(false);
  });
  test('Ausnahmeliste lesen', () => {
    expect(parseAutoPriceExclusions('{"119":{"at":"2026-10-28T17:50:00Z","note":"OFFEN 010"},"x":{"at":"a"},"5":{}}')).toEqual({ '119': { at: '2026-10-28T17:50:00Z', note: 'OFFEN 010' } });
    expect(parseAutoPriceExclusions('kaputt')).toEqual({});
  });
});
