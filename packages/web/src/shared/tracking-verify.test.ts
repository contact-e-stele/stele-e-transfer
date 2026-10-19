import { describe, expect, test } from 'bun:test';
import { compareTracking, normalizeTracking, stripHermesH } from './tracking-verify';

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
  // Hermes mit/ohne "H" vorne (19.10.2026). Ziffern hier frei gewählt, NICHT die echte Nummer.
  test('Hermes: H vorne bei eBay, ohne in der App → match', () => {
    expect(compareTracking('12345678901234', [{ trackingNumber: 'H12345678901234', carrier: 'HERMES' }])).toBe('match');
  });
  test('Hermes: H in der App, ohne bei eBay, Versender aus der App-Notiz → match', () => {
    expect(compareTracking('h 1234-5678901234', [{ trackingNumber: '12345678901234', carrier: null }], 'Hermes')).toBe('match');
  });
  test('ohne Hermes zählt das H weiter als Unterschied → different', () => {
    expect(compareTracking('12345678901234', [{ trackingNumber: 'H12345678901234', carrier: 'DHL' }], 'DHL')).toBe('different');
  });
  test('Hermes, aber andere Ziffern → different', () => {
    expect(compareTracking('12345678901234', [{ trackingNumber: 'H12345678901235', carrier: 'HERMES' }])).toBe('different');
  });
  test('nur ein H vor reinen Ziffern wird entfernt', () => {
    expect(stripHermesH('H123')).toBe('123');
    expect(stripHermesH('HH123')).toBe('HH123');
    expect(stripHermesH('H12A')).toBe('H12A');
  });
});
