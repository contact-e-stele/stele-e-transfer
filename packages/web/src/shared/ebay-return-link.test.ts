// Fixture: Live 30.10.2026 — Rückgabe 5332416921 zu Bestellung 04-15332-43723 (stele-220-GRAY, Grund "Passt nicht").
import { describe, expect, test } from 'bun:test';
import { ebayReturnDetailsUrl, postOrderAuthHeader, returnIdsByOrderId } from './ebay-return-link';

describe('eBay-Retoure-Link', () => {
  test('Link zur Rückgabe', () => {
    expect(ebayReturnDetailsUrl('5332416921')).toBe('https://www.ebay.de/rt/ReturnDetails?returnId=5332416921');
    expect(ebayReturnDetailsUrl('')).toBeNull();
    expect(ebayReturnDetailsUrl('abc')).toBeNull();
  });
  test('Zuordnung je Bestellnummer, ohne Doppelte, Leere übersprungen', () => {
    expect(returnIdsByOrderId([
      { returnId: '5332416921', orderId: '04-15332-43723' },
      { returnId: '5332416921', orderId: '04-15332-43723' },
      { returnId: '', orderId: '09-15365-02551' },
    ])).toEqual({ '04-15332-43723': ['5332416921'] });
  });
  test('Post-Order-Header ist IAF, nicht Bearer', () => {
    expect(postOrderAuthHeader('t')).toBe('IAF t');
  });
});
