import { describe, expect, test } from 'bun:test';
import { isAllowedImageUrl, normalizeImageUrl, parseAliImageSearchResponse, cheapestFirst } from './ali-image-search';
import type { AliSearchHit } from './ali-search';

describe('isAllowedImageUrl', () => {
  test('AliExpress-Hosts über https erlaubt', () => {
    expect(isAllowedImageUrl('https://ae01.alicdn.com/kf/abc.jpg')).toBe(true);
    expect(isAllowedImageUrl('//ae01.alicdn.com/kf/abc.jpg')).toBe(true);
    expect(isAllowedImageUrl('https://de.aliexpress.com/x.jpg')).toBe(true);
  });
  test('fremde Hosts, http, Lookalikes und Müll abgelehnt', () => {
    expect(isAllowedImageUrl('http://ae01.alicdn.com/a.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://evil.example.com/a.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://alicdn.com.evil.example.com/a.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://evilalicdn.com/a.jpg')).toBe(false);
    expect(isAllowedImageUrl('http://169.254.169.254/')).toBe(false);
    expect(isAllowedImageUrl('kein url')).toBe(false);
  });
  test('normalizeImageUrl ergänzt https', () => {
    expect(normalizeImageUrl('//x.alicdn.com/a.jpg')).toBe('https://x.alicdn.com/a.jpg');
  });
});

// Beispielstrukturen (vermutet, nicht live belegt) — Parser muss beide Formen lesen.
const respA = (items: Array<[string, string, string]>) => ({
  aliexpress_ds_image_searchV2_response: {
    rsp_code: '00',
    data: { products: { traffic_product_d_t_o: items.map(([id, title, price]) => ({ itemId: id, title, targetSalePrice: price, evaluateRate: '96.5%', orders: '120' })) } },
  },
});

describe('parseAliImageSearchResponse', () => {
  test('liest verschachteltes Produkt-Array und mappt Felder', () => {
    const r = parseAliImageSearchResponse(respA([['11', 'Schaufel A', '3.20'], ['12', 'Schaufel B', '1.90']]));
    if (!r.ok) throw new Error('parse');
    expect(r.hits.map(h => h.id)).toEqual(['11', '12']);
    expect(r.hits[0]).toMatchObject({ title: 'Schaufel A', price: 3.2, rating: 96.5, sold: 120, url: 'https://de.aliexpress.com/item/11.html' });
  });
  test('zwei verschiedene Bilder → verschiedene Treffer', () => {
    const a = parseAliImageSearchResponse(respA([['1', 'Katzenschaufel', '2.00']]));
    const b = parseAliImageSearchResponse(respA([['2', 'Handyhülle', '1.00'], ['3', 'Handyhülle Pro', '2.00']]));
    if (!a.ok || !b.ok) throw new Error('parse');
    expect(a.hits.map(h => h.id)).not.toEqual(b.hits.map(h => h.id));
    expect(b.hits).toHaveLength(2);
  });
  test('Fehlerantwort wörtlich', () => {
    expect(parseAliImageSearchResponse({ error_response: { code: 'IllegalAccessToken', msg: 'Invalid access token' } }))
      .toEqual({ ok: false, code: 'IllegalAccessToken', msg: 'Invalid access token' });
    const r = parseAliImageSearchResponse({ aliexpress_ds_image_searchV2_response: { rsp_code: '500', rsp_msg: 'no permission' } });
    expect(r).toEqual({ ok: false, code: '500', msg: 'no permission' });
  });
  test('unbekannte Struktur → keine Treffer statt Absturz', () => {
    const r = parseAliImageSearchResponse({ aliexpress_ds_image_searchV2_response: { rsp_code: '00', data: { foo: 1 } } });
    expect(r).toEqual({ ok: true, hits: [] });
    expect(parseAliImageSearchResponse({ x: 1 }).ok).toBe(false);
  });
});

describe('cheapestFirst', () => {
  const mk = (id: string, price: number): AliSearchHit => ({ id, title: '', image: '', price, shipFrom: '?', isEU: false, rating: 0, sold: 0, url: '', relevant: true });
  test('Preis aufsteigend, ohne Preis ans Ende, stabil', () => {
    expect(cheapestFirst([mk('a', 3), mk('b', 0), mk('c', 1.5), mk('d', 1.5)]).map(h => h.id)).toEqual(['c', 'd', 'a', 'b']);
  });
});
