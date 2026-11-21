// D4 Schritt A: Achsen-Namen bei eBay umbenennen, Werte bleiben.
import { describe, expect, test } from 'bun:test';
import { planGroupAxisRename, renameItemAspects } from '../shared/axis-rename';
import { renameListingAxes } from './axis-rename';

const group = () => ({ aspects: { Marke: ['Markenlos'] }, variantSKUs: ['stele-212-GRAY', 'stele-212-PINK'],
  variesBy: { aspectsImageVariesBy: ['Varianten'], specifications: [{ name: 'Varianten', values: ['Gray', 'Pink'] }] } });

describe('planGroupAxisRename', () => {
  test('Varianten → Farbe: Name und Bild-Achse, Werte gleich', () => {
    const p = planGroupAxisRename(group(), { Varianten: 'Farbe' });
    expect(p.ok).toBe(true);
    expect(p.group?.variesBy?.specifications).toEqual([{ name: 'Farbe', values: ['Gray', 'Pink'] }]);
    expect(p.group?.variesBy?.aspectsImageVariesBy).toEqual(['Farbe']);
  });
  test('unbekannte Achse → Fehler', () => expect(planGroupAxisRename(group(), { Color: 'Farbe' }).ok).toBe(false));
  test('Zielname schon Artikelmerkmal (25013) → Fehler', () => expect(planGroupAxisRename(group(), { Varianten: 'Marke' }).error).toContain('25013'));
  test('gleicher Name → nichts zu tun', () => expect(planGroupAxisRename(group(), { Varianten: 'Varianten' }).renames).toEqual([]));
});

describe('renameItemAspects', () => {
  const a = { Varianten: ['Gray'], Marke: ['X'] };
  test('Phase 1: neu dazu, alt bleibt', () => expect(renameItemAspects(a, [{ von: 'Varianten', nach: 'Farbe' }], true)).toEqual({ Varianten: ['Gray'], Marke: ['X'], Farbe: ['Gray'] }));
  test('Phase 3: alt weg', () => expect(renameItemAspects(a, [{ von: 'Varianten', nach: 'Farbe' }], false)).toEqual({ Marke: ['X'], Farbe: ['Gray'] }));
});

function fake(opts: { failGroupPut?: boolean } = {}) {
  const st: { group: ReturnType<typeof group>; items: Record<string, { product: { aspects: Record<string, string[]> } }>; log: string[] } = {
    group: group(), items: { 'stele-212-GRAY': { product: { aspects: { Varianten: ['Gray'] } } }, 'stele-212-PINK': { product: { aspects: { Varianten: ['Pink'] } } } }, log: [] };
  const f = (async (url: string, init?: RequestInit) => {
    const u = String(url); const gm = /inventory_item_group\//.test(u); const im = u.match(/inventory_item\/([^?]+)/);
    if (init?.method === 'PUT') {
      const b = JSON.parse(String(init.body));
      if (gm) {
        st.log.push('PUT group');
        if (opts.failGroupPut) return new Response('nein', { status: 400 });
        // eBay-Regel nachgebildet: jede Achse muss in jedem Item als Merkmal stehen
        for (const sp of b.variesBy.specifications) for (const it of Object.values(st.items)) if (!it.product.aspects[sp.name]) return new Response('25002 Merkmal fehlt', { status: 400 });
        st.group = b;
      } else { st.log.push('PUT ' + decodeURIComponent(im![1])); st.items[decodeURIComponent(im![1])] = b; }
      return new Response(null, { status: 204 });
    }
    if (gm) return new Response(JSON.stringify(st.group), { status: 200 });
    if (im) return new Response(JSON.stringify(st.items[decodeURIComponent(im[1])]), { status: 200 });
    return new Response('?', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, st };
}

describe('renameListingAxes', () => {
  const base = { productId: 212, renames: { Varianten: 'Farbe' }, token: 't', baseUrl: 'https://x' };
  test('Vorschau schreibt nichts', async () => {
    const e = fake();
    const r = await renameListingAxes({ ...base, confirm: false, fetchFn: e.f });
    expect(e.st.log).toEqual([]);
    expect(r.renames).toEqual([{ von: 'Varianten', nach: 'Farbe' }]);
  });
  test('confirm: 3 Phasen in der richtigen Reihenfolge, Werte unverändert, zurückgelesen', async () => {
    const e = fake();
    const r = await renameListingAxes({ ...base, confirm: true, fetchFn: e.f });
    expect(e.st.log).toEqual(['PUT stele-212-GRAY', 'PUT stele-212-PINK', 'PUT group', 'PUT stele-212-GRAY', 'PUT stele-212-PINK']);
    expect(r.verified).toBe(true);
    expect(e.st.group.variesBy.specifications).toEqual([{ name: 'Farbe', values: ['Gray', 'Pink'] }]);
    expect(e.st.items['stele-212-GRAY'].product.aspects).toEqual({ Farbe: ['Gray'] });
  });
  test('Gruppe abgelehnt → Fehler, Items behalten alten Schlüssel (Angebot bleibt gültig)', async () => {
    const e = fake({ failGroupPut: true });
    const r = await renameListingAxes({ ...base, confirm: true, fetchFn: e.f });
    expect(r.error).toContain('Gruppe abgelehnt');
    expect(e.st.items['stele-212-GRAY'].product.aspects.Varianten).toEqual(['Gray']);
  });
});
