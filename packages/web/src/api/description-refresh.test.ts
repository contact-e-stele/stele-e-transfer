// Paket 4: Tests für die eine gemeinsame Rechenstelle des Beschreibungs-Nachzieh-Wegs
// (refreshOneProductDescription / refreshDescriptionsBatch). Reine Funktionen mit injizierten
// Deps — kein DB-/eBay-Zugriff nötig (GRUNDGESETZ Regel 2).
import { describe, expect, test } from 'bun:test';
import { checkBatchSize, MAX_DESCRIPTION_REFRESH_BATCH, refreshDescriptionsBatch, refreshOneProductDescription, type DescriptionRefreshDeps, type DescriptionRefreshProduct } from './description-refresh';

const GPSR_HTML = (email: string) => `<div>
<!-- TAB 5: Produktsicherheit (GPSR) -->
<pre>Hersteller: Foo Ltd, ${email}</pre>
</div>`;

function makeDeps(products: DescriptionRefreshProduct[], opts?: { reviseOk?: boolean; reviseError?: string; failReviseForItemIds?: string[] }): DescriptionRefreshDeps & { updated: Map<number, string>; revisedItemIds: string[] } {
  const byId = new Map(products.map(p => [p.id, p]));
  const updated = new Map<number, string>();
  const revisedItemIds: string[] = [];
  return {
    updated,
    revisedItemIds,
    getProduct: async (id) => byId.get(id),
    reviseListingContent: async (itemId) => {
      revisedItemIds.push(itemId);
      if (opts?.failReviseForItemIds?.includes(itemId)) {
        return { ok: false, error: opts.reviseError ?? `Fehler für ${itemId}` };
      }
      if (opts?.reviseOk === false) return { ok: false, error: opts.reviseError ?? 'Fehler' };
      return { ok: true };
    },
    updateProductDescription: async (id, htmlDescription) => { updated.set(id, htmlDescription); },
  };
}

describe('checkBatchSize — Obergrenze', () => {
  test('greift bei 11 Produkten (Grenze ist 10)', () => {
    expect(MAX_DESCRIPTION_REFRESH_BATCH).toBe(10);
    const ids = Array.from({ length: 11 }, (_, i) => i + 1);
    const err = checkBatchSize(ids);
    expect(err).not.toBeNull();
    expect(err).toContain('Höchstens 10');
    expect(err).toContain('11 übergeben');
  });

  test('erlaubt genau 10 Produkte', () => {
    const ids = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(checkBatchSize(ids)).toBeNull();
  });
});

describe('refreshOneProductDescription — Trockenlauf ohne confirm', () => {
  test('lädt nichts hoch, wenn confirm fehlt', async () => {
    const product = { id: 1, ebayListingId: '198601064695', htmlDescription: GPSR_HTML('qin_fang@foxmail.com') };
    const deps = makeDeps([product]);
    const outcome = await refreshOneProductDescription(1, {}, deps);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.dryRun).toBe(true);
      if (outcome.dryRun) {
        expect(outcome.foreignEmailsBefore).toEqual(['qin_fang@foxmail.com']);
        expect(outcome.foreignEmailsAfter).toEqual([]);
        expect(outcome.changed).toBe(true);
      }
    }
    // Kein Upload und kein DB-Write im Trockenlauf:
    expect(deps.revisedItemIds).toEqual([]);
    expect(deps.updated.size).toBe(0);
  });

  test('confirm:false ist ebenfalls ein Trockenlauf', async () => {
    const product = { id: 1, ebayListingId: '198601064695', htmlDescription: GPSR_HTML('qin_fang@foxmail.com') };
    const deps = makeDeps([product]);
    const outcome = await refreshOneProductDescription(1, { confirm: false }, deps);
    expect(outcome.ok && outcome.dryRun).toBe(true);
    expect(deps.revisedItemIds).toEqual([]);
  });
});

describe('refreshOneProductDescription — 422-Sperre', () => {
  test('bleibt nach der Bereinigung eine fremde Mail stehen (außerhalb des GPSR-Tabs), wird übersprungen und gemeldet', async () => {
    const html = `${GPSR_HTML('qin_fang@foxmail.com')}<p>Bei Fragen: successservice2@hotmail.com</p>`;
    const product = { id: 2, ebayListingId: '198646122180', htmlDescription: html };
    const deps = makeDeps([product]);
    const outcome = await refreshOneProductDescription(2, { confirm: true }, deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.httpStatus).toBe(422);
      expect(outcome.foreignEmails).toEqual(['successservice2@hotmail.com']);
    }
    // Trotz confirm:true: kein Upload, kein DB-Write.
    expect(deps.revisedItemIds).toEqual([]);
    expect(deps.updated.size).toBe(0);
  });
});

describe('refreshOneProductDescription — erfolgreicher Upload', () => {
  test('confirm:true ohne verbleibende fremde Mail lädt hoch und schreibt die DB', async () => {
    const product = { id: 3, ebayListingId: '198600000001', htmlDescription: GPSR_HTML('836207972@qq.com') };
    const deps = makeDeps([product]);
    const outcome = await refreshOneProductDescription(3, { confirm: true }, deps);
    expect(outcome.ok).toBe(true);
    if (outcome.ok && !outcome.dryRun) {
      expect(outcome.itemId).toBe('198600000001');
      expect(outcome.foreignEmailsBefore).toEqual(['836207972@qq.com']);
    }
    expect(deps.revisedItemIds).toEqual(['198600000001']);
    expect(deps.updated.get(3)).not.toContain('836207972@qq.com');
  });

  test('unbekanntes Produkt → 404, kein Upload', async () => {
    const deps = makeDeps([]);
    const outcome = await refreshOneProductDescription(999, { confirm: true }, deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.httpStatus).toBe(404);
  });

  test('Produkt ohne laufendes Angebot → 400, kein Upload', async () => {
    const product = { id: 4, ebayListingId: null, htmlDescription: GPSR_HTML('foo@bar.com') };
    const deps = makeDeps([product]);
    const outcome = await refreshOneProductDescription(4, { confirm: true }, deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.httpStatus).toBe(400);
    expect(deps.revisedItemIds).toEqual([]);
  });
});

describe('refreshDescriptionsBatch — läuft weiter nach Fehler, Ergebnis pro Produkt', () => {
  test('ein Fehler bei Produkt 3 stoppt die übrigen nicht', async () => {
    const products: DescriptionRefreshProduct[] = [
      { id: 1, ebayListingId: 'item-1', htmlDescription: GPSR_HTML('a@foxmail.com') },
      { id: 2, ebayListingId: 'item-2', htmlDescription: GPSR_HTML('b@foxmail.com') },
      { id: 3, ebayListingId: 'item-3', htmlDescription: GPSR_HTML('c@foxmail.com') },
      { id: 4, ebayListingId: 'item-4', htmlDescription: GPSR_HTML('d@foxmail.com') },
    ];
    const deps = makeDeps(products, { failReviseForItemIds: ['item-3'], reviseError: 'eBay: Session ungültig' });
    const { results } = await refreshDescriptionsBatch([1, 2, 3, 4], { confirm: true }, deps, 0);

    expect(results).toHaveLength(4);
    expect(results.map(r => r.productId)).toEqual([1, 2, 3, 4]);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(true);
    expect(results[2].ok).toBe(false);
    if (!results[2].ok) expect(results[2].error).toBe('eBay: Session ungültig');
    // Produkt 4 (nach dem Fehler) lief trotzdem durch:
    expect(results[3].ok).toBe(true);
    expect(deps.updated.has(4)).toBe(true);
  });

  test('eine Exception bei einem Produkt stoppt die übrigen nicht', async () => {
    const products: DescriptionRefreshProduct[] = [
      { id: 1, ebayListingId: 'item-1', htmlDescription: GPSR_HTML('a@foxmail.com') },
      { id: 2, ebayListingId: 'item-2', htmlDescription: GPSR_HTML('b@foxmail.com') },
    ];
    const deps: DescriptionRefreshDeps = {
      getProduct: async (id) => {
        if (id === 1) throw new Error('DB weg');
        return products.find(p => p.id === id);
      },
      reviseListingContent: async () => ({ ok: true }),
      updateProductDescription: async () => {},
    };
    const { results } = await refreshDescriptionsBatch([1, 2], { confirm: true }, deps, 0);
    expect(results[0].ok).toBe(false);
    expect(results[1].ok).toBe(true);
  });

  test('ohne confirm wird bei keinem Produkt im Stapel etwas hochgeladen', async () => {
    const products: DescriptionRefreshProduct[] = [
      { id: 1, ebayListingId: 'item-1', htmlDescription: GPSR_HTML('a@foxmail.com') },
      { id: 2, ebayListingId: 'item-2', htmlDescription: GPSR_HTML('b@foxmail.com') },
    ];
    const deps = makeDeps(products);
    const { results } = await refreshDescriptionsBatch([1, 2], {}, deps, 0);
    expect(results.every(r => r.ok)).toBe(true);
    expect(deps.revisedItemIds).toEqual([]);
    expect(deps.updated.size).toBe(0);
  });

  test('doppelte productIds im Aufruf werden nur einmal verarbeitet (Code-Review-Vorschlag)', async () => {
    const products: DescriptionRefreshProduct[] = [
      { id: 1, ebayListingId: 'item-1', htmlDescription: GPSR_HTML('a@foxmail.com') },
      { id: 2, ebayListingId: 'item-2', htmlDescription: GPSR_HTML('b@foxmail.com') },
    ];
    const deps = makeDeps(products);
    const { results } = await refreshDescriptionsBatch([1, 2, 1], { confirm: true }, deps, 0);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.productId)).toEqual([1, 2]);
    expect(deps.revisedItemIds).toEqual(['item-1', 'item-2']);
  });
});
