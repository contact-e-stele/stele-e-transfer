import { describe, expect, test, mock } from 'bun:test';
import { syncTrackingNumbers, ALIEXPRESS_TRACKING_SYNC_ENABLED, type TrackingSyncOrder } from './tracking-sync';
import type { PackageStatusEmailMatch } from './gmail';

describe('ALIEXPRESS_TRACKING_SYNC_ENABLED', () => {
  test('P2 FINALE (2026-09-14): scharf geschaltet, nachdem der echte Gmail-Trockenlauf (Render-Shell, nach PR #104) beide Referenzwerte exakt belegt hat', () => {
    expect(ALIEXPRESS_TRACKING_SYNC_ENABLED).toBe(true);
  });
});

describe('syncTrackingNumbers — Kernverhalten (P2 Teil 2, Quelle: Gmail statt AliExpress-API)', () => {
  const ORDERS: TrackingSyncOrder[] = [
    { ebayOrderId: '20-15127-76586', aliexpressOrderId: '3076306514497211', trackingNumber: null },
  ];
  const MATCH: PackageStatusEmailMatch = {
    trackingNumber: '00340434886289512140',
    aliexpressOrderId: '3076306514497211',
    emailDate: '2026-09-10T12:00:00.000Z',
  };

  test('passende Mail gefunden → wird geschrieben (writeFn aufgerufen), gilt als "übernommen"', async () => {
    const writeFn = mock(async (_ebayOrderId: string, _trackingNumber: string) => {});

    const result = await syncTrackingNumbers({ orders: ORDERS, matches: [MATCH], writeFn });

    expect(writeFn).toHaveBeenCalledTimes(1);
    expect(writeFn.mock.calls[0]).toEqual(['20-15127-76586', '00340434886289512140']);
    expect(result).toEqual({
      checked: 1, found: 1, written: 1, errors: 0,
      rows: [{ ebayOrderId: '20-15127-76586', aliexpressOrderId: '3076306514497211', trackingFound: true, trackingNumber: '00340434886289512140', written: true }],
    });
  });

  test('keine passende Mail für die Bestellung → nichts geschrieben, kein Fehler', async () => {
    const writeFn = mock(async () => {});

    const result = await syncTrackingNumbers({ orders: ORDERS, matches: [], writeFn });

    expect(writeFn).not.toHaveBeenCalled();
    expect(result).toEqual({
      checked: 1, found: 0, written: 0, errors: 0,
      rows: [{ ebayOrderId: '20-15127-76586', aliexpressOrderId: '3076306514497211', trackingFound: false, trackingNumber: null, written: false }],
    });
  });

  test('dryRun:true → Nummer wird gefunden UND gemeldet, aber writeFn NIE aufgerufen', async () => {
    const writeFn = mock(async () => {});

    const result = await syncTrackingNumbers({ orders: ORDERS, matches: [MATCH], writeFn, dryRun: true });

    expect(writeFn).not.toHaveBeenCalled();
    expect(result.found).toBe(1);
    expect(result.written).toBe(0);
    expect(result.rows[0].trackingFound).toBe(true);
    expect(result.rows[0].written).toBe(false);
  });

  test('ein Fehler beim Schreiben (z.B. writeFn wirft) bricht den Lauf nicht ab — läuft mit der nächsten Bestellung weiter, zählt als errors', async () => {
    const orders: TrackingSyncOrder[] = [
      { ebayOrderId: 'ebay-1', aliexpressOrderId: 'ali-1', trackingNumber: null },
      { ebayOrderId: 'ebay-2', aliexpressOrderId: 'ali-2', trackingNumber: null },
    ];
    const matches: PackageStatusEmailMatch[] = [
      { trackingNumber: 'TRACK-1', aliexpressOrderId: 'ali-1', emailDate: '' },
      { trackingNumber: 'TRACK-2', aliexpressOrderId: 'ali-2', emailDate: '' },
    ];
    const writeFn = mock(async (ebayOrderId: string) => {
      if (ebayOrderId === 'ebay-1') throw new Error('DB-Fehler');
    });

    const result = await syncTrackingNumbers({ orders, matches, writeFn });

    expect(writeFn).toHaveBeenCalledTimes(2); // beide Bestellungen wurden versucht, der Fehler hat den Lauf nicht gestoppt
    expect(result).toEqual({
      checked: 2, found: 2, written: 1, errors: 1,
      rows: [
        { ebayOrderId: 'ebay-1', aliexpressOrderId: 'ali-1', trackingFound: false, trackingNumber: null, written: false, error: 'Error: DB-Fehler' },
        { ebayOrderId: 'ebay-2', aliexpressOrderId: 'ali-2', trackingFound: true, trackingNumber: 'TRACK-2', written: true },
      ],
    });
  });

  test('Bestellungen ohne AliExpress-Nr. oder mit bereits vorhandener Sendungsnummer werden übersprungen', async () => {
    const orders: TrackingSyncOrder[] = [
      { ebayOrderId: 'ebay-1', aliexpressOrderId: null, trackingNumber: null },
      { ebayOrderId: 'ebay-2', aliexpressOrderId: '', trackingNumber: null },
      { ebayOrderId: 'ebay-3', aliexpressOrderId: 'ali-3', trackingNumber: 'BEREITS-DA' },
    ];
    const writeFn = mock(async () => {});

    const result = await syncTrackingNumbers({ orders, matches: [], writeFn });

    expect(writeFn).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, found: 0, written: 0, errors: 0, rows: [] });
  });

  test('Gmail-Suche schlägt fehl (z.B. nicht verbunden) → Abbruch ohne Absturz, nichts geschrieben', async () => {
    const searchFn = mock(async (_days?: number): Promise<PackageStatusEmailMatch[]> => {
      throw new Error('Gmail nicht verbunden');
    });
    const writeFn = mock(async () => {});

    const result = await syncTrackingNumbers({ orders: ORDERS, searchFn, writeFn });

    expect(searchFn).toHaveBeenCalledTimes(1);
    expect(writeFn).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, found: 0, written: 0, errors: 0, rows: [] });
  });

  test('mehrere Ziel-Bestellungen, nur eine hat eine passende Mail', async () => {
    const orders: TrackingSyncOrder[] = [
      { ebayOrderId: 'ebay-1', aliexpressOrderId: 'ali-1', trackingNumber: null },
      { ebayOrderId: 'ebay-2', aliexpressOrderId: 'ali-2', trackingNumber: null },
    ];
    const matches: PackageStatusEmailMatch[] = [
      { trackingNumber: 'TRACK-1', aliexpressOrderId: 'ali-1', emailDate: '' },
    ];
    const writeFn = mock(async (_ebayOrderId: string, _trackingNumber: string) => {});

    const result = await syncTrackingNumbers({ orders, matches, writeFn });

    expect(result.checked).toBe(2);
    expect(result.found).toBe(1);
    expect(result.written).toBe(1);
    expect(writeFn).toHaveBeenCalledTimes(1);
    expect(writeFn.mock.calls[0]).toEqual(['ebay-1', 'TRACK-1']);
  });

  test('widersprüchliche Nummern für dieselbe Bestellung in zwei Mails → erste gefundene wird behalten, kein Absturz', async () => {
    const matches: PackageStatusEmailMatch[] = [
      { trackingNumber: 'FIRST', aliexpressOrderId: '3076306514497211', emailDate: '' },
      { trackingNumber: 'SECOND', aliexpressOrderId: '3076306514497211', emailDate: '' },
    ];
    const writeFn = mock(async (_ebayOrderId: string, _trackingNumber: string) => {});

    const result = await syncTrackingNumbers({ orders: ORDERS, matches, writeFn });

    expect(result.rows[0].trackingNumber).toBe('FIRST');
    expect(writeFn.mock.calls[0]).toEqual(['20-15127-76586', 'FIRST']);
  });
});

// Regressionsschutz für die Abweichungs-Entscheidung (Grundgesetz Regel 6): writeFn bekommt in
// KEINEM Testfall einen carrier-Parameter übergeben — die Default-Implementierung
// (writeTrackingNumberToDb) schreibt nachweislich nur trackingNumber, niemals carrier, wodurch
// createShippingFulfillment (eBay als "verschickt" markieren) vom Cron nie ausgelöst werden kann.
describe('Strikte Grenze: kein automatischer eBay-"verschickt"-Marker', () => {
  test('writeFn wird mit genau (ebayOrderId, trackingNumber) aufgerufen — kein drittes carrier-Argument', async () => {
    const writeFn = mock(async (_ebayOrderId: string, _trackingNumber: string) => {});

    await syncTrackingNumbers({
      orders: [{ ebayOrderId: '20-15127-76586', aliexpressOrderId: '3076306514497211', trackingNumber: null }],
      matches: [{ trackingNumber: '00340434886289512140', aliexpressOrderId: '3076306514497211', emailDate: '' }],
      writeFn,
    });

    expect(writeFn.mock.calls[0]).toHaveLength(2);
  });
});
