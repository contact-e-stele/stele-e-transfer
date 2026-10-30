import { describe, expect, test } from 'bun:test';
import { matchesTileFilter } from './product-tile-filter';

const ps = [
  { id: 1, ebayStatus: 'listed', priceChanged: true },
  { id: 2, ebayStatus: 'listed', priceChanged: false },
  { id: 3, ebayStatus: 'error', priceChanged: 0 },
  { id: 4, ebayStatus: 'unavailable', priceChanged: 1 },
  { id: 5, ebayStatus: 'none', priceChanged: null },
];
const ids = (f: Parameters<typeof matchesTileFilter>[1]) => ps.filter(p => matchesTileFilter(p, f)).map(p => p.id);

describe('Kachel-Filter Produkte-Tab', () => {
  test('Preisalarm zeigt auch live gelistete', () => { expect(ids('priceAlert')).toEqual([1, 4]); });
  test('eBay aktiv / Fehler / nicht verfügbar / ohne Filter', () => {
    expect(ids('listed')).toEqual([1, 2]);
    expect(ids('error')).toEqual([3]);
    expect(ids('unavailable')).toEqual([4]);
    expect(ids(null)).toEqual([1, 2, 3, 4, 5]);
  });
});
