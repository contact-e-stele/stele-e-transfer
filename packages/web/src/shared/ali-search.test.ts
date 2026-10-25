import { describe, expect, test } from 'bun:test';
import { mapAliSearchSort, parseAliTextSearchResponse, sortEuFirst, isEuShipFrom, type AliSearchHit } from './ali-search';

describe('mapAliSearchSort', () => {
  test('Frontend → API', () => {
    expect(mapAliSearchSort('LAST_VOLUME_DESC')).toBe('orders,desc');
    expect(mapAliSearchSort('SALE_PRICE_ASC')).toBe('min_price,asc');
    expect(mapAliSearchSort('SALE_PRICE_DESC')).toBe('min_price,desc');
    expect(mapAliSearchSort('xyz')).toBe('orders,desc');
  });
});

describe('parseAliTextSearchResponse', () => {
  const sample = {
    aliexpress_ds_text_search_response: {
      data: {
        totalCount: '1234',
        products: [
          { itemId: 1005001, title: ' Katzenstreuschaufel ', itemMainPic: '//ae01.alicdn.com/a.jpg', targetSalePrice: '3.49', salePrice: '4.00', evaluateRate: '95.0%', orders: '1500', itemUrl: '//de.aliexpress.com/item/1005001.html' },
          { itemId: 1005002, title: 'B', itemMainPic: 'https://x/b.jpg', salePrice: '2,10', evaluateRate: '4.6', orders: 20 },
        ],
      },
      rsp_code: '200',
    },
  };
  test('mappt Felder', () => {
    const r = parseAliTextSearchResponse(sample);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.total).toBe(1234);
    expect(r.hits[0]).toMatchObject({ id: '1005001', title: 'Katzenstreuschaufel', image: 'https://ae01.alicdn.com/a.jpg', price: 3.49, rating: 4.8, sold: 1500, url: 'https://de.aliexpress.com/item/1005001.html', shipFrom: '?', isEU: false });
    expect(r.hits[1]).toMatchObject({ price: 2.1, rating: 4.6, sold: 20, url: 'https://de.aliexpress.com/item/1005002.html' });
  });
  test('IllegalAccessToken → Fehler wörtlich', () => {
    const r = parseAliTextSearchResponse({ error_response: { code: 'IllegalAccessToken', msg: 'Invalid access token' } });
    expect(r).toEqual({ ok: false, code: 'IllegalAccessToken', msg: 'Invalid access token' });
  });
});

describe('sortEuFirst', () => {
  const mk = (id: string, shipFrom: string): AliSearchHit => ({ id, title: '', image: '', price: 1, shipFrom, isEU: isEuShipFrom(shipFrom), rating: 0, sold: 0, url: '' });
  test('EU nach oben, stabil, nichts versteckt', () => {
    const out = sortEuFirst([mk('a', 'China'), mk('b', 'Poland'), mk('c', '?'), mk('d', 'Germany')], 'DE');
    expect(out.map(h => h.id)).toEqual(['b', 'd', 'a', 'c']);
  });
  test('ohne DE-Filter unverändert', () => {
    expect(sortEuFirst([mk('a', 'China'), mk('b', 'Poland')], 'ALL').map(h => h.id)).toEqual(['a', 'b']);
  });
});
