import { describe, expect, test } from 'bun:test';
import { statusAfterErrorCleared } from './listing-status-guard';

describe('OFFEN 017: Status nach "Fehler zurücksetzen"/Pflichtfeld', () => {
  test('mit eBay-Nr (stele-243, 198755130523) → listed', () => {
    expect(statusAfterErrorCleared({ ebayStatus: 'listed', ebayListingId: '198755130523' })).toBe('listed');
    expect(statusAfterErrorCleared({ ebayStatus: 'error', ebayListingId: '198755130523' })).toBe('listed');
  });
  test('ohne eBay-Nr → none', () => {
    expect(statusAfterErrorCleared({ ebayStatus: 'error', ebayListingId: null })).toBe('none');
  });
});
