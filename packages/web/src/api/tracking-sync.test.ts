import { describe, expect, test, mock } from 'bun:test';
import { syncTrackingNumbers, ALIEXPRESS_TRACKING_SYNC_ENABLED, type TrackingSyncOrder } from './tracking-sync';
import type { AliOrderTrackingInfo } from './aliexpress-api';

describe('ALIEXPRESS_TRACKING_SYNC_ENABLED', () => {
  test('P2 (2026-09-14): scharf geschaltet, nachdem der volle Trockenlauf gegen die echte DB gesichtet wurde', () => {
    expect(ALIEXPRESS_TRACKING_SYNC_ENABLED).toBe(true);
  });
});

describe('syncTrackingNumbers — Kernverhalten', () => {
  const ORDERS: TrackingSyncOrder[] = [
    { ebayOrderId: '20-15127-76586', aliexpressOrderId: '3076306514497211', trackingNumber: null },
  ];

  test('Sendungsnummer gefunden → wird geschrieben (writeFn aufgerufen), gilt als "übernommen"', async () => {
    const fetchFn = mock(async (_aliId: string, _token: string): Promise<AliOrderTrackingInfo> => ({
      orderStatus: 'WAIT_BUYER_ACCEPT_GOODS',
      logisticsStatus: 'SELLER_SEND_GOODS',
      trackingNumber: 'AP00843143208329',
      logisticsService: 'CAINIAO_FULFILLMENT_STD',
    }));
    const writeFn = mock(async (_ebayOrderId: string, _trackingNumber: string) => {});

    const result = await syncTrackingNumbers({ orders: ORDERS, fetchFn, writeFn, accessToken: 'fake-token', pauseMs: 0 });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe('3076306514497211');
    expect(writeFn).toHaveBeenCalledTimes(1);
    expect(writeFn.mock.calls[0]).toEqual(['20-15127-76586', 'AP00843143208329']);
    expect(result).toEqual({
      checked: 1, found: 1, written: 1, errors: 0,
      rows: [{ ebayOrderId: '20-15127-76586', aliexpressOrderId: '3076306514497211', orderStatus: 'WAIT_BUYER_ACCEPT_GOODS', trackingFound: true, trackingNumber: 'AP00843143208329', written: true }],
    });
  });

  test('noch keine Sendungsnummer bei AliExpress → nichts geschrieben, kein Fehler', async () => {
    const fetchFn = mock(async (): Promise<AliOrderTrackingInfo> => ({
      orderStatus: 'WAIT_SELLER_SEND_GOODS',
      logisticsStatus: null,
      trackingNumber: null,
      logisticsService: null,
    }));
    const writeFn = mock(async () => {});

    const result = await syncTrackingNumbers({ orders: ORDERS, fetchFn, writeFn, accessToken: 'fake-token', pauseMs: 0 });

    expect(writeFn).not.toHaveBeenCalled();
    expect(result).toEqual({
      checked: 1, found: 0, written: 0, errors: 0,
      rows: [{ ebayOrderId: '20-15127-76586', aliexpressOrderId: '3076306514497211', orderStatus: 'WAIT_SELLER_SEND_GOODS', trackingFound: false, trackingNumber: null, written: false }],
    });
  });

  test('dryRun:true → Sendungsnummer wird gefunden UND gemeldet, aber writeFn NIE aufgerufen (Aufgabe 6)', async () => {
    const fetchFn = mock(async (): Promise<AliOrderTrackingInfo> => ({
      orderStatus: 'WAIT_BUYER_ACCEPT_GOODS', logisticsStatus: 'SELLER_SEND_GOODS',
      trackingNumber: 'AP00843143208329', logisticsService: 'CAINIAO_FULFILLMENT_STD',
    }));
    const writeFn = mock(async () => {});

    const result = await syncTrackingNumbers({ orders: ORDERS, fetchFn, writeFn, accessToken: 'fake-token', dryRun: true, pauseMs: 0 });

    expect(writeFn).not.toHaveBeenCalled();
    expect(result.found).toBe(1);
    expect(result.written).toBe(0);
    expect(result.rows[0].trackingFound).toBe(true);
    expect(result.rows[0].written).toBe(false);
  });

  test('ein Fehler bei einer Bestellung (z.B. fetchFn wirft) bricht den Lauf nicht ab — läuft mit der nächsten weiter, zählt als errors', async () => {
    const orders: TrackingSyncOrder[] = [
      { ebayOrderId: 'ebay-1', aliexpressOrderId: 'ali-1', trackingNumber: null },
      { ebayOrderId: 'ebay-2', aliexpressOrderId: 'ali-2', trackingNumber: null },
    ];
    const fetchFn = mock(async (aliId: string): Promise<AliOrderTrackingInfo | null> => {
      if (aliId === 'ali-1') throw new Error('Netzwerkfehler');
      return { orderStatus: 'WAIT_BUYER_ACCEPT_GOODS', logisticsStatus: 'SELLER_SEND_GOODS', trackingNumber: 'TRACK-2', logisticsService: null };
    });
    const writeFn = mock(async () => {});

    const result = await syncTrackingNumbers({ orders, fetchFn, writeFn, accessToken: 'fake-token', pauseMs: 0 });

    expect(fetchFn).toHaveBeenCalledTimes(2); // beide Bestellungen wurden versucht, der Fehler hat den Lauf nicht gestoppt
    expect(writeFn).toHaveBeenCalledTimes(1); // nur die zweite (erfolgreiche) wurde geschrieben
    expect(result).toEqual({
      checked: 2, found: 1, written: 1, errors: 1,
      rows: [
        { ebayOrderId: 'ebay-1', aliexpressOrderId: 'ali-1', orderStatus: null, trackingFound: false, trackingNumber: null, written: false, error: 'Error: Netzwerkfehler' },
        { ebayOrderId: 'ebay-2', aliexpressOrderId: 'ali-2', orderStatus: 'WAIT_BUYER_ACCEPT_GOODS', trackingFound: true, trackingNumber: 'TRACK-2', written: true },
      ],
    });
  });

  test('fetchFn liefert null (API-Fehler ohne Exception) → als errors gezählt, kein Absturz, kein Schreiben', async () => {
    const fetchFn = mock(async (): Promise<AliOrderTrackingInfo | null> => null);
    const writeFn = mock(async () => {});

    const result = await syncTrackingNumbers({ orders: ORDERS, fetchFn, writeFn, accessToken: 'fake-token', pauseMs: 0 });

    expect(writeFn).not.toHaveBeenCalled();
    expect(result.errors).toBe(1);
    expect(result.found).toBe(0);
    expect(result.written).toBe(0);
  });

  test('Bestellungen ohne AliExpress-Nr. oder mit bereits vorhandener Sendungsnummer werden übersprungen (fetchFn nicht aufgerufen)', async () => {
    const orders: TrackingSyncOrder[] = [
      { ebayOrderId: 'ebay-1', aliexpressOrderId: null, trackingNumber: null },
      { ebayOrderId: 'ebay-2', aliexpressOrderId: '', trackingNumber: null },
      { ebayOrderId: 'ebay-3', aliexpressOrderId: 'ali-3', trackingNumber: 'BEREITS-DA' },
    ];
    const fetchFn = mock(async (): Promise<AliOrderTrackingInfo | null> => null);
    const writeFn = mock(async () => {});

    const result = await syncTrackingNumbers({ orders, fetchFn, writeFn, accessToken: 'fake-token', pauseMs: 0 });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, found: 0, written: 0, errors: 0, rows: [] });
  });

  test('kein Access-Token verfügbar → Abbruch ohne Fehler, kein fetchFn-Aufruf', async () => {
    const fetchFn = mock(async (): Promise<AliOrderTrackingInfo | null> => null);
    const writeFn = mock(async () => {});

    const result = await syncTrackingNumbers({ orders: ORDERS, fetchFn, writeFn, accessToken: null, pauseMs: 0 });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, found: 0, written: 0, errors: 0, rows: [] });
  });
});

// Regressionsschutz für die Abweichungs-Entscheidung (Grundgesetz Regel 6): writeFn bekommt in
// KEINEM Testfall einen carrier-Parameter übergeben — die Default-Implementierung
// (writeTrackingNumberToDb) schreibt nachweislich nur trackingNumber, niemals carrier, wodurch
// createShippingFulfillment (eBay als "verschickt" markieren) vom Cron nie ausgelöst werden kann.
describe('Strikte Grenze: kein automatischer eBay-"verschickt"-Marker', () => {
  test('writeFn wird mit genau (ebayOrderId, trackingNumber) aufgerufen — kein drittes carrier-Argument', async () => {
    const fetchFn = mock(async (): Promise<AliOrderTrackingInfo> => ({
      orderStatus: 'WAIT_BUYER_ACCEPT_GOODS', logisticsStatus: 'SELLER_SEND_GOODS',
      trackingNumber: 'AP00843143208329', logisticsService: 'CAINIAO_FULFILLMENT_STD',
    }));
    const writeFn = mock(async (_ebayOrderId: string, _trackingNumber: string) => {});

    await syncTrackingNumbers({
      orders: [{ ebayOrderId: '20-15127-76586', aliexpressOrderId: '3076306514497211', trackingNumber: null }],
      fetchFn, writeFn, accessToken: 'fake-token', pauseMs: 0,
    });

    expect(writeFn.mock.calls[0]).toHaveLength(2);
  });
});
