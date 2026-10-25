import { describe, expect, test } from 'bun:test';
import { mapAliSearchSort, parseAliTextSearchResponse, sortEuFirst, isEuShipFrom, sortAliHits, markRelevance, searchTerms, type AliSearchHit } from './ali-search';

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
    expect(r.hits[0]).toMatchObject({ id: '1005001', title: 'Katzenstreuschaufel', image: 'https://ae01.alicdn.com/a.jpg', price: 3.49, rating: 4.8, sold: 1500, url: 'https://de.aliexpress.com/item/1005001.html', shipFrom: '?', isEU: false, relevant: true });
    expect(r.hits[1]).toMatchObject({ price: 2.1, rating: 4.6, sold: 20, url: 'https://de.aliexpress.com/item/1005002.html' });
  });
  test('IllegalAccessToken → Fehler wörtlich', () => {
    const r = parseAliTextSearchResponse({ error_response: { code: 'IllegalAccessToken', msg: 'Invalid access token' } });
    expect(r).toEqual({ ok: false, code: 'IllegalAccessToken', msg: 'Invalid access token' });
  });
});

describe('sortEuFirst', () => {
  const mk = (id: string, shipFrom: string): AliSearchHit => ({ id, title: '', image: '', price: 1, shipFrom, isEU: isEuShipFrom(shipFrom), rating: 0, sold: 0, url: '', relevant: true });
  test('EU nach oben, stabil, nichts versteckt', () => {
    const out = sortEuFirst([mk('a', 'China'), mk('b', 'Poland'), mk('c', '?'), mk('d', 'Germany')], 'DE');
    expect(out.map(h => h.id)).toEqual(['b', 'd', 'a', 'c']);
  });
  test('ohne DE-Filter unverändert', () => {
    expect(sortEuFirst([mk('a', 'China'), mk('b', 'Poland')], 'ALL').map(h => h.id)).toEqual(['a', 'b']);
  });
});

// Echte Antwortstruktur (Render-Log 25.10.2026): zwei Begriffe liefern verschiedene Listen/totalCount
const mkResp = (total: string, items: Array<[string, string, string, string]>) => ({
  aliexpress_ds_text_search_response: {
    code: '00',
    data: {
      pageIndex: 1, pageSize: 20, totalCount: total,
      products: { selection_search_product: items.map(([id, title, price, orders]) => ({ itemId: id, title, targetSalePrice: price, targetOriginalPriceCurrency: 'EUR', orders })) },
    },
  },
});

describe('zwei Suchbegriffe → verschiedene Listen', () => {
  const katze = parseAliTextSearchResponse(mkResp('6410', [['1', 'Katzenstreuschaufel Edelstahl', '2.50', '10'], ['2', 'Kaffeelöffel', '1.69', '33']]));
  const handy = parseAliTextSearchResponse(mkResp('42809', [['3', 'Handyhülle transparent', '1.65', '5'], ['4', 'Handyhülle Panzer', '2.35', '7']]));
  test('Mapping gibt je Begriff die eigene Liste und eigenes total zurück', () => {
    if (!katze.ok || !handy.ok) throw new Error('parse');
    expect(katze.total).toBe(6410);
    expect(handy.total).toBe(42809);
    expect(katze.hits.map(h => h.id)).toEqual(['1', '2']);
    expect(handy.hits.map(h => h.id)).toEqual(['3', '4']);
  });
});

describe('sortAliHits (API ignoriert sortBy)', () => {
  const mk = (id: string, price: number, sold: number): AliSearchHit => ({ id, title: '', image: '', price, shipFrom: '?', isEU: false, rating: 0, sold, url: '', relevant: true });
  // Reihenfolge wie live: 1,69 / 0,05 / 1,89 / 1,75
  const live = [mk('a', 1.69, 33), mk('b', 0.05, 10), mk('c', 1.89, 5), mk('d', 1.75, 10)];
  test('Preis aufsteigend', () => {
    expect(sortAliHits(live, 'SALE_PRICE_ASC').map(h => h.price)).toEqual([0.05, 1.69, 1.75, 1.89]);
  });
  test('Preis absteigend', () => {
    expect(sortAliHits(live, 'SALE_PRICE_DESC').map(h => h.price)).toEqual([1.89, 1.75, 1.69, 0.05]);
  });
  test('Meistverkauft absteigend, stabil bei Gleichstand (b vor d)', () => {
    expect(sortAliHits(live, 'LAST_VOLUME_DESC').map(h => h.id)).toEqual(['a', 'b', 'd', 'c']);
  });
  test('unbekannte Sortierung = API-Reihenfolge', () => {
    expect(sortAliHits(live, 'xyz')).toBe(live);
  });
});

describe('markRelevance', () => {
  const mk = (id: string, title: string): AliSearchHit => ({ id, title, image: '', price: 1, shipFrom: '?', isEU: false, rating: 0, sold: 0, url: '', relevant: true });
  test('Suchwörter ab 3 Buchstaben, Groß/Klein egal', () => {
    expect(searchTerms('Cat Litter  Scoop')).toEqual(['cat', 'litter', 'scoop']);
    expect(searchTerms('an x')).toEqual([]);
  });
  test('markiert, blendet nicht aus', () => {
    const out = markRelevance([mk('1', 'Cat Litter Scoop Metal'), mk('2', 'Edelstahl Kaffeelöffel'), mk('3', 'Hamster Sand Scoop')], 'cat litter scoop');
    expect(out.map(h => h.relevant)).toEqual([true, false, true]);
    expect(out).toHaveLength(3);
  });
  test('Suchbegriff ohne Wort ≥3 Buchstaben → alles relevant', () => {
    expect(markRelevance([mk('1', 'x')], 'ab').every(h => h.relevant)).toBe(true);
  });
});
