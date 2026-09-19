import { describe, expect, test } from 'bun:test';
import { isAliInternalLogisticsId, extractOrderAmount } from './aliexpress-api';

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

// Einkaufspreis-Einfrieren (19.09.2026, Nutzer-Korrektur nach Live-Prüfung): NUR order_amount
// (Fallback user_order_amount) ist der tatsächlich gezahlte Betrag inkl. Rabatt/Gutschein/Zoll —
// eine Rekonstruktion aus product_price/shipping_fee/actual_tax_fee ist nachweislich falsch (bei
// zwei live geprüften Bestellungen fehlten 0,87€ bzw. 0,89€ zwischen der Summe der sichtbaren
// Einzelfelder und dem tatsächlich gezahlten Betrag). Fixtures unten sind die ECHTEN, vollständig
// geprüften Rohantworten von aliexpress.trade.ds.order.get für die Bestellungen 3076306514497211
// und 3075188992327211 (live abgerufen, nicht nachgebaut).
describe('extractOrderAmount', () => {
  test('Live-Fund 3076306514497211: order_amount = 9.08€ (NICHT die 9.95€ aus product_price - sale_discount_fee + shipping_fee + actual_tax_fee)', () => {
    const raw = {
      user_order_amount: { amount: '9.08', currency_code: 'EUR' },
      order_amount: { amount: '9.08', currency_code: 'EUR' },
      child_order_list: {
        aeop_child_order_info: [{
          product_price: { amount: '3.59', currency_code: 'EUR' },
          sale_discount_fee: { amount: '0.07', currency_code: 'EUR' },
          shipping_fee: { amount: '1.98', currency_code: 'EUR' },
          actual_tax_fee: { amount: '4.45', currency_code: 'EUR' },
          actual_fee: { amount: '9.08', currency_code: 'EUR' },
        }],
      },
    };
    expect(extractOrderAmount(raw)).toBe(9.08);
  });

  test('Live-Fund 3075188992327211 (abgeschlossene, 7+ Wochen alte Bestellung, Status FINISH): order_amount = 9.21€', () => {
    const raw = {
      user_order_amount: { amount: '9.21', currency_code: 'EUR' },
      order_amount: { amount: '9.21', currency_code: 'EUR' },
      child_order_list: {
        aeop_child_order_info: [{
          product_price: { amount: '3.65', currency_code: 'EUR' },
          sale_discount_fee: { amount: '0.00', currency_code: 'EUR' },
          shipping_fee: { amount: '1.98', currency_code: 'EUR' },
          actual_tax_fee: { amount: '4.47', currency_code: 'EUR' },
          actual_fee: { amount: '9.21', currency_code: 'EUR' },
        }],
      },
    };
    expect(extractOrderAmount(raw)).toBe(9.21);
  });

  test('order_amount fehlt → Fallback auf user_order_amount', () => {
    expect(extractOrderAmount({ user_order_amount: { amount: '12.29' } })).toBe(12.29);
  });

  test('weder order_amount noch user_order_amount vorhanden → null (kein Raten)', () => {
    expect(extractOrderAmount({ order_status: 'FINISH' })).toBeNull();
  });

  test('raw ist null (Abruf fehlgeschlagen) → null', () => {
    expect(extractOrderAmount(null)).toBeNull();
  });
});
