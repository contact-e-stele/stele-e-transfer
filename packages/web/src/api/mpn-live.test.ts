import { describe, expect, test } from 'bun:test';
import { fixMpnAspects } from '../shared/identifier-aspect';
import { fixListingIdentifierAspects } from './identifier-aspect-fix';
import { sanitizeItemProductForPut, stripZeroWeight } from './ebay';

// „ja MPN" (Inhaber 27.10.2026). Live-Beleg stele-107 (eBay 198601087866): Merkmal „MPN: 1005009281437592" = AliExpress-Produkt-ID.
describe('MPN: AliExpress-ID in alten Live-Angeboten', () => {
  test('reine Funktion: AliExpress-ID → Nicht zutreffend, echte Herstellernummer bleibt', () => {
    expect(fixMpnAspects({ MPN: ['1005009281437592'], Marke: ['Markenlos'] })).toEqual({ aspects: { MPN: ['Nicht zutreffend'], Marke: ['Markenlos'] }, changed: ['MPN: 1005009281437592'] });
    expect(fixMpnAspects({ Herstellernummer: ['WD-4471B'] }).changed).toEqual([]);
    expect(fixMpnAspects({ MPN: ['Nicht zutreffend'] }).changed).toEqual([]);
  });

  const mk = (docs: Record<string, Record<string, unknown>>) => {
    const store = JSON.parse(JSON.stringify(docs)) as Record<string, Record<string, unknown>>;
    const puts: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      const key = decodeURIComponent(url.split('/').pop()!);
      if (init?.method === 'PUT') { puts.push(key); store[key] = JSON.parse(String(init.body)); return new Response(null, { status: 204 }); }
      return store[key] ? new Response(JSON.stringify(store[key]), { status: 200 }) : new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    return { f, store, puts };
  };
  const prepareItem = (item: Record<string, unknown>) => { if (item.product) item.product = sanitizeItemProductForPut(item.product as Record<string, unknown>); stripZeroWeight(item); };

  test('Gruppe + Items: Vorschau schreibt nichts, Schreiben ersetzt nur MPN', async () => {
    const docs = {
      'stele-107-GROUP': { aspects: { MPN: ['1005009281437592'], Marke: ['Markenlos'], Material: ['Gel'] }, variantSKUs: ['A'] },
      A: { product: { aspects: { MPN: ['1005009281437592'], EAN: ['Nicht zutreffend'] }, mpn: '1005009281437592', title: 'T' }, availability: { shipToLocationAvailability: { quantity: 4 } } },
    };
    const pre = mk(docs);
    const p = await fixListingIdentifierAspects({ productId: 107, token: 't', baseUrl: 'https://x', confirm: false, itemSkus: ['A'], fetchFn: pre.f, prepareItem });
    expect(p.rows.map(r => r.changed)).toEqual([['MPN: 1005009281437592'], ['MPN: 1005009281437592', 'product.mpn: 1005009281437592']]);
    expect(pre.puts).toEqual([]);
    const ap = mk(docs);
    const a = await fixListingIdentifierAspects({ productId: 107, token: 't', baseUrl: 'https://x', confirm: true, itemSkus: ['A'], fetchFn: ap.f, prepareItem });
    expect(a.rows.every(r => r.written)).toBe(true);
    expect(ap.store['stele-107-GROUP']).toEqual({ aspects: { MPN: ['Nicht zutreffend'], Marke: ['Markenlos'], Material: ['Gel'] }, variantSKUs: ['A'] });
    expect((ap.store['A'].product as Record<string, unknown>).mpn).toBeUndefined();
    expect((ap.store['A'].product as { aspects: Record<string, string[]> }).aspects.MPN).toEqual(['Nicht zutreffend']);
    expect(ap.store['A'].availability).toEqual({ shipToLocationAvailability: { quantity: 4 } });
  });

  test('Einzelangebot (keine Gruppe) wird jetzt auch geprüft', async () => {
    // synthetischer Fall (Format wie AliExpress-ID), kein echtes Produkt
    const m = mk({ 'stele-50': { product: { aspects: { MPN: ['1005001234567890'] } } } });
    const r = await fixListingIdentifierAspects({ productId: 50, token: 't', baseUrl: 'https://x', confirm: true, itemSkus: [], fetchFn: m.f, prepareItem });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ target: 'stele-50', written: true });
    expect(m.puts).toEqual(['stele-50']);
  });
});
