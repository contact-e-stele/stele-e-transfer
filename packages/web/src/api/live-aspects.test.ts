import { describe, expect, test } from 'bun:test';
import { applySpecAspectsToListing, aspectAdditions, parsePrimaryCategoryId } from './live-aspects';
import type { CategoryAspectDef } from '../shared/spec-aspects';

const CAT: CategoryAspectDef[] = [
  { localizedAspectName: 'Material' }, { localizedAspectName: 'Herstellungsland und -region' }, { localizedAspectName: 'Farbe' }, { localizedAspectName: 'Marke' },
];
// echte Merkmale stele-127 (Probelauf 25.10.2026)
const SPECS127 = { 'Brand Name': 'NONE', Material: 'Plastic', 'Require Food Contact': 'Yes', 'High-concerned chemical': 'none', Origin: 'Mainland China', Choice: 'yes', semi_Choice: 'yes' };

function mockEbay(docs: Record<string, Record<string, unknown>>, categoryId = '12345') {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const store = JSON.parse(JSON.stringify(docs)) as Record<string, Record<string, unknown>>;
  const f = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes('/offer?sku=')) return new Response(JSON.stringify({ offers: [{ categoryId }] }), { status: 200 });
    const key = decodeURIComponent(url.split('/').pop()!);
    if (method === 'PUT') { store[key] = JSON.parse(String(init!.body)); return new Response(null, { status: 204 }); }
    return store[key] ? new Response(JSON.stringify(store[key]), { status: 200 }) : new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls, store };
}

describe('C2: Merkmale in Live-Angebote (nur fehlende ergänzen)', () => {
  test('aspectAdditions: vorhandene und Variations-Merkmale bleiben unberührt', () => {
    expect(aspectAdditions({ Marke: ['Markenlos'] }, SPECS127, CAT)).toEqual({ Material: 'Kunststoff', 'Herstellungsland und -region': 'China' });
    expect(aspectAdditions({ Material: ['PP'] }, SPECS127, CAT)).toEqual({ 'Herstellungsland und -region': 'China' });
    expect(aspectAdditions({}, { Material: 'Plastic' }, CAT, ['Material'])).toEqual({});
  });

  test('Varianten-Angebot: Vorschau schreibt nichts', async () => {
    const m = mockEbay({ 'stele-127-GROUP': { aspects: { Marke: ['Markenlos'] }, variesBy: { specifications: [{ name: 'Farbe' }] } }, A: { product: { aspects: { Marke: ['Markenlos'], Farbe: ['Weiß'] } } } });
    const r = await applySpecAspectsToListing({ productId: 127, specs: SPECS127, token: 't', baseUrl: 'https://x', confirm: false, itemSkus: ['A'], getCategoryAspects: async () => CAT, fetchFn: m.f });
    expect(r.categoryId).toBe('12345');
    expect(r.rows.map(x => [x.target, x.written, x.added])).toEqual([
      ['stele-127-GROUP', false, { Material: 'Kunststoff', 'Herstellungsland und -region': 'China' }],
      ['A', false, { Material: 'Kunststoff', 'Herstellungsland und -region': 'China' }],
    ]);
    expect(m.calls.filter(c => c.method === 'PUT')).toEqual([]);
  });

  test('Varianten-Angebot: Schreiben ergänzt nur, voller Doc, zurückgelesen', async () => {
    const m = mockEbay({ 'stele-127-GROUP': { aspects: { Marke: ['Markenlos'] }, variantSKUs: ['A'], title: 'T', variesBy: { specifications: [{ name: 'Farbe' }] } }, A: { product: { aspects: { Marke: ['Markenlos'], Farbe: ['Weiß'] }, title: 'T' }, availability: { shipToLocationAvailability: { quantity: 4 } } } });
    const r = await applySpecAspectsToListing({ productId: 127, specs: SPECS127, token: 't', baseUrl: 'https://x', confirm: true, itemSkus: ['A'], getCategoryAspects: async () => CAT, fetchFn: m.f });
    expect(r.rows.every(x => x.written && x.verified)).toBe(true);
    expect(m.store['stele-127-GROUP']).toMatchObject({ aspects: { Marke: ['Markenlos'], Material: ['Kunststoff'], 'Herstellungsland und -region': ['China'] }, variantSKUs: ['A'], title: 'T' });
    expect(m.store['A']).toMatchObject({ product: { aspects: { Marke: ['Markenlos'], Farbe: ['Weiß'], Material: ['Kunststoff'] } }, availability: { shipToLocationAvailability: { quantity: 4 } } });
  });

  test('Einzelangebot ohne Gruppe: Item stele-<id>', async () => {
    const m = mockEbay({ 'stele-220': { product: { aspects: { Marke: ['Markenlos'] } } } });
    const r = await applySpecAspectsToListing({ productId: 220, specs: { Origin: 'Mainland China', Filling: 'POLYESTER' }, token: 't', baseUrl: 'https://x', confirm: true, itemSkus: [], getCategoryAspects: async () => CAT, fetchFn: m.f });
    expect(r.rows).toEqual([{ target: 'stele-220', added: { 'Herstellungsland und -region': 'China' }, written: true, verified: true }]);
  });

  test('Kategorie nicht lesbar → nichts geschrieben', async () => {
    const m = mockEbay({ 'stele-1': { product: { aspects: {} } } }, '');
    const r = await applySpecAspectsToListing({ productId: 1, specs: SPECS127, token: 't', baseUrl: 'https://x', confirm: true, itemSkus: [], getCategoryAspects: async () => CAT, fetchFn: m.f });
    expect(r.error).toMatch(/Kategorie nicht lesbar/);
    expect(m.calls.filter(c => c.method === 'PUT')).toEqual([]);
  });
});

describe('C2 Nachtrag: erste SKU ohne Offer (Live 27.10., stele-121/127)', () => {
  test('Kategorie kommt aus der nächsten SKU der Gruppe', async () => {
    const calls: string[] = [];
    const store: Record<string, Record<string, unknown>> = { 'stele-127-GROUP': { aspects: {}, variesBy: { specifications: [] } }, A: { product: { aspects: {} } }, B: { product: { aspects: {} } } };
    const f = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/offer?sku=A')) return new Response(JSON.stringify({ offers: [] }), { status: 200 });
      if (url.includes('/offer?sku=B')) return new Response(JSON.stringify({ offers: [{ categoryId: '777' }] }), { status: 200 });
      const key = decodeURIComponent(url.split('/').pop()!);
      return new Response(JSON.stringify(store[key] ?? {}), { status: store[key] ? 200 : 404 });
    }) as unknown as typeof fetch;
    const r = await applySpecAspectsToListing({ productId: 127, specs: { Origin: 'Mainland China' }, token: 't', baseUrl: 'https://x', confirm: false, itemSkus: ['A', 'B'], getCategoryAspects: async () => CAT, fetchFn: f });
    expect(r.categoryId).toBe('777');
    expect(r.error).toBeUndefined();
  });
});

describe('Nachtrag 28.10.: Offer ohne categoryId → Kategorie aus GetItem', () => {
  const offerOhneKat = (store: Record<string, Record<string, unknown>>) => (async (url: string, init?: RequestInit) => {
    if (url.includes('/offer?sku=')) return new Response(JSON.stringify({ offers: [{ offerId: 'O1' }] }), { status: 200 });
    const key = decodeURIComponent(url.split('/').pop()!);
    if (init?.method === 'PUT') { store[key] = JSON.parse(String(init.body)); return new Response(null, { status: 204 }); }
    return new Response(JSON.stringify(store[key] ?? {}), { status: store[key] ? 200 : 404 });
  }) as unknown as typeof fetch;

  test('parsePrimaryCategoryId liest PrimaryCategory, nicht SecondaryCategory', () => {
    const xml = '<Item><SecondaryCategory><CategoryID>111</CategoryID></SecondaryCategory><PrimaryCategory>\n  <CategoryID>179723</CategoryID>\n  <CategoryName>Fußpflege</CategoryName></PrimaryCategory></Item>';
    expect(parsePrimaryCategoryId(xml)).toBe('179723');
    expect(parsePrimaryCategoryId('<Item></Item>')).toBeNull();
  });

  test('ohne categoryId im Offer: Fallback liefert Kategorie, Vorschau zeigt Ergänzung', async () => {
    const store: Record<string, Record<string, unknown>> = { 'stele-148': { product: { aspects: { Marke: ['Markenlos'] } } } };
    const r = await applySpecAspectsToListing({ productId: 148, specs: { Origin: 'Mainland China' }, token: 't', baseUrl: 'https://x', confirm: false, itemSkus: [],
      getCategoryAspects: async () => CAT, getFallbackCategoryId: async () => '179723', fetchFn: offerOhneKat(store) });
    expect(r.categoryId).toBe('179723');
    expect(r.rows).toEqual([{ target: 'stele-148', added: { 'Herstellungsland und -region': 'China' }, written: false }]);
  });

  test('ohne Fallback: Fehlertext nennt die Offer-Anzahl', async () => {
    const r = await applySpecAspectsToListing({ productId: 148, specs: { Origin: 'Mainland China' }, token: 't', baseUrl: 'https://x', confirm: true, itemSkus: [],
      getCategoryAspects: async () => CAT, fetchFn: offerOhneKat({}) });
    expect(r.error).toBe('Kategorie nicht lesbar (Offer GET stele-148:200/1 Offer)');
  });
});
