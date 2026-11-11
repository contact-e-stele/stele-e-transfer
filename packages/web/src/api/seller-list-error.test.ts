import { describe, expect, test } from 'bun:test';
import { sellerListPageError } from './ebay';

// Fund 11.11.2026: Listings-Tab zeigte 0, weil ein fehlgeschlagener GetSellerList-Abruf still als leere Liste gecacht wurde.
describe('sellerListPageError', () => {
  test('Success = kein Fehler', () => {
    expect(sellerListPageError(200, '<GetSellerListResponse><Ack>Success</Ack><ItemArray></ItemArray></GetSellerListResponse>')).toBeNull();
  });
  test('Warning = kein Fehler', () => {
    expect(sellerListPageError(200, '<R><Ack>Warning</Ack></R>')).toBeNull();
  });
  test('Failure mit Code und Text', () => {
    expect(sellerListPageError(200, '<R><Ack>Failure</Ack><Errors><ShortMessage>Auth token is invalid.</ShortMessage><ErrorCode>931</ErrorCode></Errors></R>'))
      .toBe('eBay Failure 931: Auth token is invalid.');
  });
  test('HTTP-Fehler', () => {
    expect(sellerListPageError(503, '')).toBe('HTTP 503');
  });
  test('Antwort ohne Ack (z. B. HTML-Fehlerseite)', () => {
    expect(sellerListPageError(200, '<html>Service Unavailable</html>')).toBe('Antwort ohne Ack');
  });
});
