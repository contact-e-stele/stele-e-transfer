import { describe, expect, test } from 'bun:test';
import { isAliInternalLogisticsId } from './aliexpress-api';

// P2-Korrektur (2026-09-14, Live-Fund): logistics_no aus aliexpress.trade.ds.order.get ist
// AliExpress' eigene interne Sendungs-ID (Präfix "AP"), NICHT die Nummer des Zustellers (DHL).
// Reale Werte, beide gegen die Sendungsverfolgungs-Seite gegengeprüft (s. aliexpress-api.ts):
//   3076306514497211: logistics_no AP00843143208329, DHL-Seite 00340434886289512140
//   3075188992327211: logistics_no AP00832504143414, DHL-Seite 00340434886283998797
describe('isAliInternalLogisticsId', () => {
  test('erkennt reale AliExpress-interne IDs (Präfix "AP" + Ziffern) — echte Werte aus dem Live-Fund', () => {
    expect(isAliInternalLogisticsId('AP00843143208329')).toBe(true);
    expect(isAliInternalLogisticsId('AP00832504143414')).toBe(true);
  });

  test('lässt echte DHL-Nummern (rein numerisch, kein AP-Präfix) durch — echte Werte aus dem Live-Fund', () => {
    expect(isAliInternalLogisticsId('00340434886289512140')).toBe(false);
    expect(isAliInternalLogisticsId('00340434886283998797')).toBe(false);
  });

  test('ist tolerant gegenüber Groß-/Kleinschreibung und Leerraum', () => {
    expect(isAliInternalLogisticsId('ap00843143208329')).toBe(true);
    expect(isAliInternalLogisticsId('  AP00843143208329  ')).toBe(true);
  });

  test('ein "AP" mitten im String ohne Ziffernfolge direkt danach zählt NICHT als internes Präfix', () => {
    expect(isAliInternalLogisticsId('DHLAP12345')).toBe(false);
  });
});
