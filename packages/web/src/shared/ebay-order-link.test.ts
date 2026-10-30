import { describe, expect, test } from 'bun:test';
import { ebayOrderDetailsUrl } from './ebay-order-link';

describe('eBay-Bestell-Link', () => {
  test('echte Bestellnummer (Uwe Holk, 30.10.2026)', () => {
    expect(ebayOrderDetailsUrl('09-15365-02551')).toBe('https://www.ebay.de/sh/ord/details?orderid=09-15365-02551');
  });
  test('Leerzeichen werden entfernt', () => {
    expect(ebayOrderDetailsUrl(' 09-15365-02551 ')).toBe('https://www.ebay.de/sh/ord/details?orderid=09-15365-02551');
  });
  test('kein eBay-Format → kein Link', () => {
    expect(ebayOrderDetailsUrl('3077498840207211')).toBeNull();
    expect(ebayOrderDetailsUrl('')).toBeNull();
    expect(ebayOrderDetailsUrl(null)).toBeNull();
  });
});
