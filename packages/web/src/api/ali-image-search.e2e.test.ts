// End-to-end der Bildsuche gegen gemockte AliExpress-Antworten (kein Netz, kein echter Token).
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';

const realFetch = globalThis.fetch;
const calls: Array<{ url: string; body: string }> = [];

function mockFetch(handler: (url: string, body: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    const body = init?.body ? String(init.body) : '';
    calls.push({ url, body });
    return handler(url, body);
  }) as typeof fetch;
}

beforeAll(() => { process.env.ALIEXPRESS_ACCESS_TOKEN = 'TESTTOKEN'; });
afterEach(() => { globalThis.fetch = realFetch; calls.length = 0; });

const searchResp = {
  aliexpress_ds_image_searchV2_response: {
    rsp_code: '00',
    data: { products: { traffic_product_d_t_o: [
      { itemId: '2', title: 'teurer', targetSalePrice: '9.90', evaluateRate: '90.5', orders: '10' },
      { itemId: '1', title: 'billig', targetSalePrice: '1.90', evaluateRate: '97.1', orders: '300' },
    ] } },
  },
};
const productResp = (shipFrom: string) => ({
  aliexpress_ds_product_get_response: { result: {
    ae_item_base_info_dto: { subject: 'x' },
    logistics_info_list: { ae_logistics_info: [{ ship_from_country: shipFrom }] },
  } },
});

describe('searchAliByImageApi (gemockt)', () => {
  test('fremde Bild-URL wird abgelehnt, ohne Netzzugriff', async () => {
    const { searchAliByImageApi } = await import('./aliexpress-api');
    mockFetch(() => { throw new Error('darf nicht aufgerufen werden'); });
    const r = await searchAliByImageApi('https://evil.example.com/a.jpg');
    expect(r.status).toBe('api_error');
    expect(r.code).toBe('bad_image_url');
    expect(calls).toHaveLength(0);
  });

  test('Anfrage-Form, günstigste zuerst, Versandland-Zähler', async () => {
    const { searchAliByImageApi } = await import('./aliexpress-api');
    mockFetch((url, body) => {
      if (url.includes('alicdn.com')) return new Response(new Uint8Array([1, 2, 3, 4]));
      const p = new URLSearchParams(body);
      if (p.get('method') === 'aliexpress.ds.image.searchV2') return Response.json(searchResp);
      if (p.get('method') === 'aliexpress.ds.product.get') return Response.json(productResp(p.get('product_id') === '1' ? 'Poland' : 'China'));
      return Response.json({});
    });
    const r = await searchAliByImageApi('https://ae01.alicdn.com/kf/a.jpg');
    expect(r.status).toBe('ok');
    expect(r.results.map(h => h.id)).toEqual(['1', '2']); // 1,90 € vor 9,90 €
    expect(r.results[0]).toMatchObject({ price: 1.9, rating: 97.1, sold: 300, shipFrom: 'Poland', isEU: true });
    expect(r.results[1]).toMatchObject({ shipFrom: 'China', isEU: false });
    const imgCall = calls.find(c => new URLSearchParams(c.body).get('method') === 'aliexpress.ds.image.searchV2')!;
    const p = new URLSearchParams(imgCall.body);
    expect(p.get('image_file_bytes')).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'));
    expect(p.get('shpt_to')).toBe('DE');
    expect(p.get('target_currency')).toBe('EUR');
    expect(p.get('sign')).toMatch(/^[0-9A-F]{32}$/);
  });

  test('zwei verschiedene Bilder → verschiedene Treffer', async () => {
    const { searchAliByImageApi } = await import('./aliexpress-api');
    const respFor = (id: string) => ({ aliexpress_ds_image_searchV2_response: { rsp_code: '00', data: { products: { traffic_product_d_t_o: [{ itemId: id, title: id, targetSalePrice: '1.00' }] } } } });
    mockFetch((url, body) => {
      const p = new URLSearchParams(body);
      if (url.includes('alicdn.com')) return new Response(new Uint8Array([url.includes('/a.jpg') ? 1 : 2]));
      if (p.get('method') === 'aliexpress.ds.image.searchV2') return Response.json(respFor(p.get('image_file_bytes') === 'AQ==' ? 'A' : 'B'));
      return Response.json(productResp('Germany'));
    });
    const a = await searchAliByImageApi('https://ae01.alicdn.com/kf/a.jpg');
    const b = await searchAliByImageApi('https://ae01.alicdn.com/kf/b.jpg');
    expect(a.results.map(h => h.id)).toEqual(['A']);
    expect(b.results.map(h => h.id)).toEqual(['B']);
  });

  test('API-Fehler wörtlich, nie Exception', async () => {
    const { searchAliByImageApi } = await import('./aliexpress-api');
    mockFetch((url) => url.includes('alicdn.com')
      ? new Response(new Uint8Array([1]))
      : Response.json({ error_response: { code: 'IllegalAccessToken', msg: 'Invalid access token' } }));
    const r = await searchAliByImageApi('https://ae01.alicdn.com/kf/a.jpg');
    expect(r).toMatchObject({ status: 'api_error', results: [], total: 0, code: 'IllegalAccessToken' });
    expect(r.message).toBe('IllegalAccessToken: Invalid access token');
  });
});
