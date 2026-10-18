import { describe, expect, test } from 'bun:test';
import { compareTracking, normalizeTracking } from './tracking-verify';

// Nummer aus der Bestellung 22-15284-59051 (Bestellungen-Tab, 18.10.2026).
const NR = '00340434886114582393';

describe('Sendungsnummer bei eBay prüfen', () => {
  test('eBay hat dieselbe Nummer → match', () => {
    expect(compareTracking(NR, [{ trackingNumber: NR }])).toBe('match');
  });
  test('Leerzeichen/Bindestriche/Groß-Klein egal', () => {
    expect(normalizeTracking(' 0034 0434-8861 ')).toBe('003404348861');
    expect(compareTracking('ab 12-3', [{ trackingNumber: 'AB123' }])).toBe('match');
  });
  test('eBay hat keine Nummer → missing', () => {
    expect(compareTracking(NR, [])).toBe('missing');
  });
  test('eBay hat eine andere Nummer → different', () => {
    expect(compareTracking(NR, [{ trackingNumber: '00340434886289512140' }])).toBe('different');
  });
});
