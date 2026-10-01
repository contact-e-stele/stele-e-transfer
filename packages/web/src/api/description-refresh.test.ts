// Paket 4 (2026-08-31) / eBay-Verstoßserie 2026-09-28: Tests für die eine gemeinsame
// Rechenstelle des Beschreibungs-Nachzieh-Wegs (refreshOneProductDescription /
// refreshDescriptionsBatch). Reine Funktionen mit injizierten Deps — kein DB-/eBay-Zugriff nötig
// (GRUNDGESETZ Regel 2).
//
// Seit der Umstellung auf "regenerieren statt patchen" (buildProductDescriptionForEbay) braucht
// jedes Test-Produkt die vollen Beschreibungsfelder (title/generatedTitle/specs/...) statt nur
// einer fertigen htmlDescription — htmlDescription simuliert hier nur noch den ALTEN, ggf. mit
// eBay-Verstößen behafteten Stand vor dem Refresh (für den changed-/violationsBefore-Vergleich).
import { describe, expect, test } from 'bun:test';
import { checkBatchSize, MAX_DESCRIPTION_REFRESH_BATCH, refreshDescriptionsBatch, refreshOneProductDescription, type DescriptionRefreshDeps, type DescriptionRefreshProduct } from './description-refresh';

// Alter, stale gespeicherter Stand mit einer fremden Kontakt-Adresse — wie er vor diesem Fix
// erzeugt worden sein könnte (GPSR-Tab existierte damals noch generell).
const STALE_HTML_WITH_CONTACT = (email: string) => `<div>
<!-- TAB 5: Produktsicherheit (GPSR) -->
<pre>Hersteller: Foo Ltd, ${email}</pre>
</div>`;

// Sauberes Produkt ohne Varianten — buildProductDescriptionForEbay() erzeugt daraus eine
// Beschreibung ohne jeden Verstoß (kein gpsrRaw wird hier je an den Generator weitergereicht).
function makeProduct(overrides: Partial<DescriptionRefreshProduct> & { id: number; ebayListingId: string | null }): DescriptionRefreshProduct {
  return {
    title: 'Frischhaltedose Edelstahl 3er Set',
    generatedTitle: 'Frischhaltedose Edelstahl 3er Set',
    description: null,
    generatedDescription: '###INTRO### Praktisches Set für Küche und Aufbewahrung.###BULLETS### - Auslaufsicher\n- Spülmaschinenfest###OUTRO### Ideal für Meal Prep.',
    specs: JSON.stringify({ Material: 'Edelstahl', Farbe: 'Silber' }),
    variants: null,
    variantContents: null,
    variantPrices: null,
    bullets: JSON.stringify([]),
    images: JSON.stringify(['https://ae01.alicdn.com/kf/example.jpg']),
    htmlDescription: null,
    // P71-C Teil 2: vollständige GPSR-Pflichtangaben (EU-Person), sonst sperrt der Nachzug mit 422
    gpsrName: 'Muster EU SARL', gpsrAddress: '12 Rue de Test', gpsrCity: '75017 Paris', gpsrEmail: 'eu@example.fr', gpsrPhone: null, gpsrCountry: 'FR',
    ...overrides,
  };
}

function makeDeps(products: DescriptionRefreshProduct[], opts?: { reviseOk?: boolean; reviseError?: string; failReviseForItemIds?: string[] }): DescriptionRefreshDeps & { updated: Map<number, string>; revisedItemIds: string[]; revisedTitles: string[] } {
  const byId = new Map(products.map(p => [p.id, p]));
  const updated = new Map<number, string>();
  const revisedItemIds: string[] = [];
  const revisedTitles: string[] = [];
  return {
    updated,
    revisedItemIds,
    revisedTitles,
    getProduct: async (id) => byId.get(id),
    reviseListingContent: async (_productId, itemId, input) => {
      revisedItemIds.push(itemId);
      if (input.title !== undefined) revisedTitles.push(input.title);
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
  test('lädt nichts hoch, wenn confirm fehlt; erkennt den Verstoß im ALTEN Stand und null Verstöße im NEU aufgebauten Stand', async () => {
    const product = makeProduct({ id: 1, ebayListingId: '198601064695', htmlDescription: STALE_HTML_WITH_CONTACT('qin_fang@foxmail.com') });
    const deps = makeDeps([product]);
    const outcome = await refreshOneProductDescription(1, {}, deps);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.dryRun).toBe(true);
      if (outcome.dryRun) {
        expect(outcome.violationsBefore.some(v => v.kind === 'email' && v.match === 'qin_fang@foxmail.com')).toBe(true);
        expect(outcome.violationsAfter).toEqual([]);
        expect(outcome.changed).toBe(true);
      }
    }
    // Kein Upload und kein DB-Write im Trockenlauf:
    expect(deps.revisedItemIds).toEqual([]);
    expect(deps.updated.size).toBe(0);
  });

  test('confirm:false ist ebenfalls ein Trockenlauf', async () => {
    const product = makeProduct({ id: 1, ebayListingId: '198601064695', htmlDescription: STALE_HTML_WITH_CONTACT('qin_fang@foxmail.com') });
    const deps = makeDeps([product]);
    const outcome = await refreshOneProductDescription(1, { confirm: false }, deps);
    expect(outcome.ok && outcome.dryRun).toBe(true);
    expect(deps.revisedItemIds).toEqual([]);
  });
});

describe('refreshOneProductDescription — 422-Sperre', () => {
  // Freitext (Titel/Beschreibung/Bullets/Specs) wird beim Neuaufbau über cleanText()/
  // stripSupplierContact() (ebay-description.ts) von Kontaktdaten befreit — ein Verstoß, der
  // NACH dem Neuaufbau noch übrig bleibt, kommt daher realistisch aus einem Feld, das dort NICHT
  // bereinigt wird: dem Varianten-Namen (buildVariantsHtml schreibt v.name ungefiltert ins HTML).
  test('bleibt nach dem Neuaufbau ein Verstoß stehen (z.B. Kontakt im Varianten-Namen), wird übersprungen und gemeldet', async () => {
    const product = makeProduct({
      id: 2, ebayListingId: '198646122180',
      variantPrices: JSON.stringify([{ sku: 'successservice2@hotmail.com', price: 9.99 }]),
    });
    const deps = makeDeps([product]);
    const outcome = await refreshOneProductDescription(2, { confirm: true }, deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.httpStatus).toBe(422);
      expect(outcome.violations?.some(v => v.kind === 'email' && v.match === 'successservice2@hotmail.com')).toBe(true);
    }
    // Trotz confirm:true: kein Upload, kein DB-Write.
    expect(deps.revisedItemIds).toEqual([]);
    expect(deps.updated.size).toBe(0);
  });

  // Code-Review-Fund: der Titel (<Title> bei reviseListingContent) lief zunächst NICHT durch den
  // Validator — ein verunreinigter alter generatedTitle (genau die Quelle des ursprünglichen
  // Verstoßes) hätte die Sperre umgangen und wäre live an eBay gesendet worden. Eine saubere
  // Beschreibung darf einen verunreinigten Titel nicht "durchwinken".
  test('sauberer Beschreibungs-Text, aber verunreinigter generatedTitle → ebenfalls 422, kein Upload', async () => {
    const product = makeProduct({
      id: 6, ebayListingId: '198601075438',
      generatedTitle: 'Backmatte Set — Kontakt service@zreeshop.com bei Fragen',
    });
    const deps = makeDeps([product]);
    const outcome = await refreshOneProductDescription(6, { confirm: true }, deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.httpStatus).toBe(422);
      expect(outcome.violations?.some(v => v.kind === 'email' && v.match === 'service@zreeshop.com')).toBe(true);
    }
    expect(deps.revisedItemIds).toEqual([]);
    expect(deps.updated.size).toBe(0);
  });
});

describe('refreshOneProductDescription — erfolgreicher Upload', () => {
  test('confirm:true ohne verbleibenden Verstoß lädt hoch (mit aktuellem Titel) und schreibt die DB', async () => {
    const product = makeProduct({ id: 3, ebayListingId: '198600000001', htmlDescription: STALE_HTML_WITH_CONTACT('836207972@qq.com') });
    const deps = makeDeps([product]);
    const outcome = await refreshOneProductDescription(3, { confirm: true }, deps);
    expect(outcome.ok).toBe(true);
    if (outcome.ok && !outcome.dryRun) {
      expect(outcome.itemId).toBe('198600000001');
      expect(outcome.violationsBefore.some(v => v.kind === 'email' && v.match === '836207972@qq.com')).toBe(true);
    }
    expect(deps.revisedItemIds).toEqual(['198600000001']);
    expect(deps.revisedTitles).toEqual(['Frischhaltedose Edelstahl 3er Set']);
    expect(deps.updated.get(3)).not.toContain('836207972@qq.com');
  });

  test('regeneriert die Beschreibung aus dem AKTUELLEN generatedTitle statt die alte Überschrift zu übernehmen (SOLL f)', async () => {
    const product = makeProduct({
      id: 5, ebayListingId: '198601075438',
      title: 'Old English Stainless Steel Box Set',
      generatedTitle: 'Frischhaltedose Edelstahl 3er Set — Neuer Titel',
      htmlDescription: '<h3>Old English Stainless Steel Box Set</h3>',
    });
    const deps = makeDeps([product]);
    const outcome = await refreshOneProductDescription(5, { confirm: true }, deps);
    expect(outcome.ok).toBe(true);
    expect(deps.revisedTitles).toEqual(['Frischhaltedose Edelstahl 3er Set — Neuer Titel']);
    const uploaded = deps.updated.get(5) ?? '';
    expect(uploaded).toContain('Frischhaltedose Edelstahl 3er Set — Neuer Titel');
    expect(uploaded).not.toContain('Old English Stainless Steel Box Set');
  });

  test('unbekanntes Produkt → 404, kein Upload', async () => {
    const deps = makeDeps([]);
    const outcome = await refreshOneProductDescription(999, { confirm: true }, deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.httpStatus).toBe(404);
  });

  test('Produkt ohne laufendes Angebot → 400, kein Upload', async () => {
    const product = makeProduct({ id: 4, ebayListingId: null });
    const deps = makeDeps([product]);
    const outcome = await refreshOneProductDescription(4, { confirm: true }, deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.httpStatus).toBe(400);
    expect(deps.revisedItemIds).toEqual([]);
  });
});

describe('refreshDescriptionsBatch — läuft weiter nach Fehler, Ergebnis pro Produkt', () => {
  test('ein Fehler bei Produkt 3 stoppt die übrigen nicht', async () => {
    const products: DescriptionRefreshProduct[] = [1, 2, 3, 4].map(id => makeProduct({ id, ebayListingId: `item-${id}` }));
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
    const products: DescriptionRefreshProduct[] = [1, 2].map(id => makeProduct({ id, ebayListingId: `item-${id}` }));
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
    const products: DescriptionRefreshProduct[] = [1, 2].map(id => makeProduct({ id, ebayListingId: `item-${id}` }));
    const deps = makeDeps(products);
    const { results } = await refreshDescriptionsBatch([1, 2], {}, deps, 0);
    expect(results.every(r => r.ok)).toBe(true);
    expect(deps.revisedItemIds).toEqual([]);
    expect(deps.updated.size).toBe(0);
  });

  test('doppelte productIds im Aufruf werden nur einmal verarbeitet (Code-Review-Vorschlag)', async () => {
    const products: DescriptionRefreshProduct[] = [1, 2].map(id => makeProduct({ id, ebayListingId: `item-${id}` }));
    const deps = makeDeps(products);
    const { results } = await refreshDescriptionsBatch([1, 2, 1], { confirm: true }, deps, 0);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.productId)).toEqual([1, 2]);
    expect(deps.revisedItemIds).toEqual(['item-1', 'item-2']);
  });
});

describe('refreshOneProductDescription — P71-C Teil 2: GPSR-Pflichtangaben (regulatory)', () => {
  test('ohne EU-Person (kein eu) → 422 mit "GPSR-Pflichtangaben fehlen", KEIN Sende-Aufruf, KEINE DB-Schrift', async () => {
    const product = makeProduct({ id: 8, ebayListingId: '198600000008', gpsrName: null, gpsrAddress: null, gpsrCity: null, gpsrEmail: null, gpsrCountry: null, gpsrRaw: null });
    const deps = makeDeps([product]);
    const outcome = await refreshOneProductDescription(8, { confirm: true }, deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.httpStatus).toBe(422);
      expect(outcome.error).toStartWith('GPSR-Pflichtangaben fehlen: ');
      expect(outcome.error).toContain('Name der verantwortlichen Person in der EU');
      expect(outcome.gpsr?.complete).toBe(false);
    }
    expect(deps.revisedItemIds).toEqual([]);
    expect(deps.updated.size).toBe(0);
  });

  test('Trockenlauf meldet gpsr.complete:true und sendet nichts', async () => {
    const product = makeProduct({ id: 9, ebayListingId: '198600000009' });
    const deps = makeDeps([product]);
    const outcome = await refreshOneProductDescription(9, {}, deps);
    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.dryRun) expect(outcome.gpsr).toEqual({ complete: true, missing: [], manufacturerMissing: [], eu: { complete: true, missing: [] }, manufacturer: { complete: false, missing: [], present: false } });
    expect(deps.revisedItemIds).toEqual([]);
  });

  test('confirm:true übergibt den regulatory-Block (EU-Person) an reviseListingContent', async () => {
    const product = makeProduct({ id: 10, ebayListingId: '198600000010' });
    const seen: unknown[] = [];
    const deps = makeDeps([product]);
    const inner = deps.reviseListingContent;
    deps.reviseListingContent = async (pid, itemId, input) => { seen.push(input.regulatory); return inner(pid, itemId, input); };
    const outcome = await refreshOneProductDescription(10, { confirm: true }, deps);
    expect(outcome.ok).toBe(true);
    expect(seen).toEqual([{ responsiblePersons: [{
      companyName: 'Muster EU SARL', addressLine1: '12 Rue de Test', postalCode: '75017', city: 'Paris',
      country: 'FR', email: 'eu@example.fr', types: ['EU_RESPONSIBLE_PERSON'],
    }] }]);
  });

  test('P71-C Teil 3: Hersteller ohne PLZ/Ort → Trockenlauf meldet manufacturerMissing, und der Sende-Block enthält keinen manufacturer', async () => {
    const raw = ['Informationen zum Hersteller', 'Name: Foo Ltd', 'Adresse: Building 5, Shenzhen, China', 'E-Mail: h@foo.cn'].join('\n');
    const product = makeProduct({ id: 11, ebayListingId: '198600000011', gpsrRaw: raw });
    const dry = await refreshOneProductDescription(11, {}, makeDeps([product]));
    expect(dry.ok).toBe(true);
    if (dry.ok && dry.dryRun) expect(dry.gpsr).toEqual({ complete: true, missing: [], manufacturerMissing: ['PLZ und Ort'], eu: { complete: true, missing: [] }, manufacturer: { complete: false, missing: ['PLZ und Ort'], present: true } });
    const seen: any[] = [];
    const deps = makeDeps([product]);
    const inner = deps.reviseListingContent;
    deps.reviseListingContent = async (pid, itemId, input) => { seen.push(input.regulatory); return inner(pid, itemId, input); };
    await refreshOneProductDescription(11, { confirm: true }, deps);
    expect(seen.length).toBe(1);
    expect('manufacturer' in seen[0]).toBe(false);
  });
});
