import { describe, expect, test } from 'bun:test';
import { isAliOrderIdNotTracking, findAliAsTrackingNotes, ALI_ORDER_ID_AS_TRACKING_ERROR } from './tracking-guard';

describe('isAliOrderIdNotTracking (A-038 / AH-02)', () => {
  test('Nummer gleich einer bekannten AliExpress-Bestellnummer → true (getrimmt)', () => {
    expect(isAliOrderIdNotTracking('3077135261597211', ['3000000000000001', '3077135261597211'])).toBe(true);
    expect(isAliOrderIdNotTracking(' 3077135261597211 ', ['3077135261597211 '])).toBe(true);
  });
  test('echte DHL-Nummer, leere Eingaben und null/undefined in der Liste → false', () => {
    expect(isAliOrderIdNotTracking('00340434886283998797', ['3075188992327211', null, undefined])).toBe(false);
    expect(isAliOrderIdNotTracking('', [''])).toBe(false);
    expect(isAliOrderIdNotTracking(null, ['3077135261597211'])).toBe(false);
  });
  test('Fehlertext wörtlich laut Auftrag', () => {
    expect(ALI_ORDER_ID_AS_TRACKING_ERROR).toBe('Sendungsnummer ist die AliExpress-Bestellnummer – nicht übernommen');
  });
});

describe('findAliAsTrackingNotes (Bericht, nur lesen)', () => {
  const notes = [
    { ebayOrderId: 'A', aliexpressOrderId: '3077135261597211', trackingNumber: '3077135261597211', trackingEbaySubmitted: true, createdAt: '2026-09-01' },
    { ebayOrderId: 'B', aliexpressOrderId: '3075188992327211', trackingNumber: '3077135261597211', trackingEbaySubmitted: false, createdAt: '2026-09-02' },
    { ebayOrderId: 'C', aliexpressOrderId: '3076306514497211', trackingNumber: '00340434886289512140' },
    { ebayOrderId: 'D', aliexpressOrderId: null, trackingNumber: null },
  ];
  test('findet eigene und fremde Bestellnummer, lässt echte Sendungsnummern und leere aus', () => {
    expect(findAliAsTrackingNotes(notes)).toEqual([
      { ebayOrderId: 'A', trackingNumber: '3077135261597211', kind: 'eigene-bestellnummer', trackingEbaySubmitted: true, createdAt: '2026-09-01' },
      { ebayOrderId: 'B', trackingNumber: '3077135261597211', kind: 'bestellnummer-einer-anderen-bestellung', trackingEbaySubmitted: false, createdAt: '2026-09-02' },
    ]);
  });
});
