// A-019 Teil 2: Preisprüfung hebt bei Varianten-Produkten NUR Varianten unter dem Boden an (raise-only), hinter AUTO_VARIANT_RAISE_ENABLED.
// Fixture 119 nach Auftrag: EK 4,79 / 3,15 / 3,45, China, Stufe C (Ziel 2,00, Boden 1,30), alle Varianten ohne eigenen gespeicherten VK →
// Produkt-VK 14,95 € (so steht es in der Produktion). Alle Zahlen frisch mit bun nachgerechnet.
import { describe, expect, test } from 'bun:test';
import { planVariantRaises, runVariantRaise, type VariantRaiseDeps, type VariantRaiseProduct, type VariantSendResult } from './variant-raise';
import { AUTO_VARIANT_RAISE_ENABLED } from '../shared/constants';

// price-monitor.ts importiert db/index.ts, das ohne TURSO_DATABASE_URL beim Laden wirft — Dummy-URL setzen, dann dynamisch importieren
// (kein echter DB-Zugriff in den hier getesteten Funktionen; eBay-Aufrufe laufen über das injizierte fetch).
process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'file:/tmp/variant-raise-test.db';
const { sendVariantRaises, updateOfferPriceBySku } = await import('./price-monitor');

const GROUPS119 = [{ name: 'Menge', values: ['200pcs', '100pcs A', '100pcs B'] }];
const product119 = (over: Partial<VariantRaiseProduct> = {}): VariantRaiseProduct => ({
  id: 119, variants: JSON.stringify(GROUPS119), buyPrice: 3.15, sellPrice: 14.95, shipsFrom: 'China', adRate: 5, targetMarginEur: 2,
  variantSellPrices: null, ebayStatus: 'listed', ebayListingId: '198601077240',
  variantPrices: JSON.stringify([
    { skuId: 'v200', attrs: { Menge: '200pcs' }, price: 4.79, stock: 50 },
    { skuId: 'v100a', attrs: { Menge: '100pcs A' }, price: 3.15, stock: 50 },
    { skuId: 'v100b', attrs: { Menge: '100pcs B' }, price: 3.45, stock: 50 },
  ]),
  ...over,
});

// Produkt 95 (Produktion): Varianten-GRUPPEN, aber nur EIN variantPrices-Eintrag, shipsFrom leer, VK 15,95 €, Ware 8,99 €.
// Die Herkunft dieses Produkts steht NUR im Varianten-Attribut "Ships From" (= Germany), nicht im Produktfeld — genau der Fall,
// für den K-004 Lücke 2 die Rangfolge "Varianten-Attribut vor Produktfeld, sonst vorsichtig China" festlegt.
const product95 = (over: Partial<VariantRaiseProduct> = {}): VariantRaiseProduct => ({
  id: 95, variants: '[{"name":"Set","values":["6pcs set"]},{"name":"Stk.","values":["10ml x 6pcs"]}]', buyPrice: 8.99, sellPrice: 15.95, shipsFrom: null,
  adRate: 5, targetMarginEur: 2, variantSellPrices: null, ebayStatus: 'listed', ebayListingId: '198601103721',
  variantPrices: JSON.stringify([{ skuId: '12000056840616727', attrs: { Color: '6pcs set', 'Net Contents': '10ml x 6pcs', 'Ships From': 'Germany' }, price: 8.99, stock: 17 }]),
  ...over,
});

function makeDeps(over: Partial<VariantRaiseDeps> = {}) {
  const calls = { send: 0, store: 0 };
  const logs: string[] = [];
  const stored: Array<Record<string, number>> = [];
  const sentRaises: Array<Array<{ skuId: string; newSell: number }>> = [];
  const deps: VariantRaiseDeps = {
    enabled: true,
    send: async (raises) => { calls.send++; sentRaises.push(raises.map(r => ({ skuId: r.skuId, newSell: r.newSell }))); return { resolved: true, results: raises.map(r => ({ skuId: r.skuId, ok: true })) }; },
    store: async (updates) => { calls.store++; stored.push(updates); },
    log: (m) => logs.push(m),
    ...over,
  };
  return { deps, calls, logs, stored, sentRaises };
}

describe('planVariantRaises — 119: nur 200pcs unter dem Boden', () => {
  test('200pcs (EK 4,79): Gewinn 0,6849 € < Boden 1,30 → neuer VK 15,95 € (Gewinn 1,4469 €); 100pcs (EK 3,15 / 3,45) bleiben (Gewinn 2,3249 / 2,0249 ≥ Boden)', () => {
    const raises = planVariantRaises(product119());
    expect(raises).toHaveLength(1);
    expect(raises[0].skuId).toBe('v200');
    expect(raises[0].oldSell).toBe(14.95);
    expect(raises[0].newSell).toBe(15.95);
    expect(raises[0].oldProfit).toBeCloseTo(0.6849, 4);
    expect(raises[0].newProfit).toBeCloseTo(1.4469, 4);
  });

  test('Senken nie: eine Variante mit Gewinn ≥ Boden wird nicht angefasst, auch wenn der Formelpreis darunter läge (VK 19,95 € bei EK 3,15)', () => {
    const p = product119({ variantSellPrices: JSON.stringify({ v100a: 19.95, v100b: 14.95, v200: 15.95 }) });
    expect(planVariantRaises(p)).toEqual([]);
  });

  // Stufe D (Ziel 3,00, Boden 1,50), EK 3,15 China: Formelpreis 14,95 €; VK 13,95 € liegt UNTER dem Ziel, aber über dem Boden (Gewinn 1,5629 ≥ 1,50).
  // Angehoben wird nur unter dem BODEN — nicht bis zum Ziel (das wäre der Preis-Zug nach Stufenwechsel, den nur der ausdrückliche Knopf auslöst).
  test('Gewinn zwischen Boden und Ziel → KEINE Anhebung, obwohl der Formelpreis höher wäre (Stufe D, EK 3,15, VK 13,95)', () => {
    const p = product119({
      targetMarginEur: 3, variants: JSON.stringify([{ name: 'Menge', values: ['100pcs A'] }]),
      variantPrices: JSON.stringify([{ skuId: 'v100a', attrs: { Menge: '100pcs A' }, price: 3.15 }, { skuId: 'v100x', attrs: { Menge: 'x' }, price: 3.15 }]),
      variantSellPrices: JSON.stringify({ v100a: 13.95, v100x: 13.95 }),
    });
    expect(planVariantRaises(p)).toEqual([]);
  });

  test('Variante mit eigenem gespeicherten VK unter dem Boden wird auf den Formelpreis angehoben (nicht auf den Produkt-VK)', () => {
    const p = product119({ variantSellPrices: JSON.stringify({ v100a: 11.95 }) }); // 11,95 bei EK 3,15 → Gewinn 0,0389
    const r = planVariantRaises(p);
    expect(r.map(x => x.skuId).sort()).toEqual(['v100a', 'v200']);
    expect(r.find(x => x.skuId === 'v100a')!.newSell).toBe(13.95);
  });

  test('ohne bekannten alten VK keine Anhebung (nichts geraten)', () => {
    expect(planVariantRaises(product119({ sellPrice: null }))).toEqual([]);
  });

  test('Einzelartikel ohne Varianten-Gruppen ist KEIN Varianten-Fall (gehört zum Einzel-Zweig der Preisprüfung)', () => {
    const single = product119({ variants: '[]', variantPrices: null });
    expect(planVariantRaises(single)).toEqual([]);
  });
});

// K-004 (08.10.2026) — KORRIGIERTE ERWARTUNG und ein echter Live-Befund: dieser Test fixierte
// bisher, dass Produkt 95 von 15,95 € auf 16,95 € ANGEHOBEN wird, weil sein Gewinn mit 0,8169 €
// unter dem Boden 1,30 € zu liegen schien. Beides war falsch gerechnet:
//   * products.shipsFrom ist bei 95 leer — das wurde wie EU behandelt (0 € Einfuhrabgaben), obwohl
//     "unbekannt" vorsichtig wie China zu rechnen wäre (Lücke 2);
//   * gleichzeitig wurden 1,99 € AliExpress-Versand angesetzt, obwohl das Varianten-Attribut
//     "Ships From" = Germany sagt und aus einem EU-Lager kein Versand anfällt (Lücke 3).
// Mit der Herkunft aus dem Varianten-Attribut (Germany → EU) ist K = 8,99 € und der echte Gewinn
// 2,8069 € — weit über dem Boden. Die Anhebung entfällt also: 95 wäre zu Unrecht teurer geworden.
describe('Produkt 95 (K-004): Herkunft laut Varianten-Attribut = Germany → EU → keine Anhebung', () => {
  test('95: VK 15,95 € bei Ware 8,99 € → echter Gewinn 2,8069 ≥ Boden 1,30 → keine Zeile', () => {
    expect(planVariantRaises(product95())).toEqual([]);
  });

  // Regressions-Beweis (Grundgesetz Regel 5): dasselbe Produkt, aber Herkunft ausdrücklich China
  // → K = 8,99 + 3,57 = 12,56 € (kein Versand, Ware ≥ 10 €? nein: 8,99 < 10 → + 1,99 = 14,55 €),
  // Gewinn 15,95 × 0,762 − 0,357 − 14,55 < Boden → wird angehoben. Die Fixture unterscheidet also,
  // ob die Herkunft überhaupt gelesen wird.
  test('dieselbe Variante mit "Ships From" = China wird weiterhin angehoben', () => {
    const china = product95({
      variantPrices: JSON.stringify([{ skuId: '12000056840616727', attrs: { Color: '6pcs set', 'Net Contents': '10ml x 6pcs', 'Ships From': 'China' }, price: 8.99, stock: 17 }]),
    });
    const r = planVariantRaises(china);
    expect(r).toHaveLength(1);
    expect(r[0].skuId).toBe('12000056840616727');
    expect(r[0].oldSell).toBe(15.95);
    expect(r[0].newSell).toBeGreaterThan(15.95);
  });
});

describe('runVariantRaise — Schalter, Senden, Speichern, Log', () => {
  test('AUTO_VARIANT_RAISE_ENABLED ist im Code standardmäßig AUS', () => {
    expect(AUTO_VARIANT_RAISE_ENABLED).toBe(false);
  });

  test('Schalter AUS: 0 Sende-Aufrufe, 0 Speichern, aber "würde anheben"-Log mit SKU/alt/neu/EK/Gewinn', async () => {
    const { deps, calls, logs } = makeDeps({ enabled: false });
    const o = await runVariantRaise(product119(), deps);
    expect(o.status).toBe('disabled');
    expect(calls).toEqual({ send: 0, store: 0 });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('würde anheben');
    expect(logs[0]).toContain('v200');
    expect(logs[0]).toContain('14.95 → 15.95');
    expect(logs[0]).toContain('EK 4.79');
    expect(logs[0]).toContain('Gewinn 0.68 → 1.45');
  });

  test('Schalter AN: nur 200pcs wird gesendet (15,95), danach in variant_sell_prices gespeichert, Pflicht-Log je Anhebung', async () => {
    const { deps, calls, logs, stored, sentRaises } = makeDeps();
    const o = await runVariantRaise(product119(), deps);
    expect(o.status).toBe('sent');
    expect(calls).toEqual({ send: 1, store: 1 });
    expect(sentRaises[0]).toEqual([{ skuId: 'v200', newSell: 15.95 }]);
    expect(stored[0]).toEqual({ v200: 15.95 });
    expect(logs.some(l => l.includes('ANGEHOBEN') && l.includes('v200') && l.includes('14.95 → 15.95') && l.includes('EK 4.79'))).toBe(true);
  });

  test('store bekommt NUR die angehobenen Einträge — das Mergen gegen den frischen DB-Stand macht der Aufrufer (kein Überschreiben eines zwischenzeitlichen Stufenwechsels)', async () => {
    const { deps, stored } = makeDeps();
    await runVariantRaise(product119({ variantSellPrices: JSON.stringify({ v100a: 13.95 }) }), deps);
    expect(stored[0]).toEqual({ v200: 15.95 });
  });

  test('nicht live gelistet → nichts (0 Aufrufe)', async () => {
    const { deps, calls } = makeDeps();
    const o = await runVariantRaise(product119({ ebayStatus: 'none', ebayListingId: null }), deps);
    expect(o.status).toBe('not_live');
    expect(calls).toEqual({ send: 0, store: 0 });
  });

  test('nichts unter dem Boden → status nothing, 0 Aufrufe', async () => {
    const { deps, calls } = makeDeps();
    const o = await runVariantRaise(product119({ variantSellPrices: JSON.stringify({ v200: 15.95 }) }), deps);
    expect(o.status).toBe('nothing');
    expect(calls).toEqual({ send: 0, store: 0 });
  });

  test('SKU-Zuordnung nicht eindeutig → NICHTS getan: nichts gespeichert, Log "nicht eindeutig"', async () => {
    const { deps, calls, logs } = makeDeps({ send: async () => ({ resolved: false, reason: '2 mehrdeutige Kombination(en)', results: [] }) });
    const o = await runVariantRaise(product119(), deps);
    expect(o.status).toBe('ambiguous');
    expect(calls.store).toBe(0);
    expect(logs.some(l => l.includes('nicht eindeutig') && l.includes('NICHTS getan'))).toBe(true);
  });

  test('teilweise Erfolg: nur die tatsächlich gesendete Variante wird gespeichert; Fehler/übersprungene geloggt', async () => {
    const p = product119({ variantSellPrices: JSON.stringify({ v100a: 11.95 }) }); // zwei Anhebungen: v100a (13,95) und v200 (15,95)
    const { deps, stored, logs } = makeDeps({
      send: async (raises): Promise<VariantSendResult> => ({ resolved: true, results: raises.map(r => r.skuId === 'v200' ? { skuId: r.skuId, ok: true } : { skuId: r.skuId, ok: true, skipped: 'Live-Preis 14.95 € ist schon ≥ neuer Preis (nie senken)' }) }),
    });
    const o = await runVariantRaise(p, deps);
    expect(o.status).toBe('partial');
    expect(stored[0]).toEqual({ v200: 15.95 }); // v100a (übersprungen) wird NICHT gespeichert
    expect(logs.some(l => l.includes('NICHT angehoben') && l.includes('nie senken'))).toBe(true);
  });

  test('alle Sendungen scheitern → failed, nichts gespeichert; Exception beim Senden → error, nichts gespeichert (Cron läuft weiter)', async () => {
    const a = makeDeps({ send: async (raises) => ({ resolved: true, results: raises.map(r => ({ skuId: r.skuId, ok: false, error: 'PUT 400' })) }) });
    expect((await runVariantRaise(product119(), a.deps)).status).toBe('failed');
    expect(a.calls.store).toBe(0);
    const b = makeDeps({ send: async () => { throw new Error('Netz weg'); } });
    expect((await runVariantRaise(product119(), b.deps)).status).toBe('error');
    expect(b.calls.store).toBe(0);
  });
});

// Ende-zu-Ende mit gemocktem eBay (nur Anfragen, keine echten Aufrufe): Zuordnung über den echten Resolver, GET→PUT volles Offer, raise-only.
describe('sendVariantRaises / updateOfferPriceBySku (raise-only) mit gemocktem eBay', () => {
  const offerFor = (sku: string, price: string) => ({
    offerId: 'o-' + sku, sku, marketplaceId: 'EBAY_DE', format: 'FIXED_PRICE', status: 'PUBLISHED', categoryId: '57920',
    listingDescription: '<p>x</p>', availableQuantity: 5, pricingSummary: { price: { value: price, currency: 'EUR' } },
  });
  const entries = JSON.parse(product119().variantPrices!);
  const skuOf = (label: string) => 'stele-119-' + label.toUpperCase().replace(/[^A-Z0-9]/g, '-');

  function mockEbay(livePrices: Record<string, string>) {
    const puts: Array<{ sku: string; price: string; body: Record<string, unknown> }> = [];
    const gets: string[] = [];
    const fn = (async (url: string, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (u.includes('/inventory_item_group/')) return new Response(JSON.stringify({ variantSKUs: [skuOf('200pcs'), skuOf('100pcs A'), skuOf('100pcs B')] }), { status: 200 });
      const m = /offer\?sku=([^&]+)/.exec(u);
      if (m) { const sku = decodeURIComponent(m[1]); gets.push(sku); return new Response(JSON.stringify({ offers: [{ offerId: 'o-' + sku, sku }] }), { status: 200 }); }
      const o = /\/offer\/o-(.+)$/.exec(u);
      if (o) {
        const sku = o[1];
        if (init?.method === 'PUT') { const body = JSON.parse(init.body as string); puts.push({ sku, price: body.pricingSummary.price.value, body }); return new Response('', { status: 204 }); }
        return new Response(JSON.stringify(offerFor(sku, livePrices[sku] ?? '14.95')), { status: 200 });
      }
      throw new Error('Unmocked: ' + u);
    }) as unknown as typeof fetch;
    return { fn, puts, gets };
  }

  test('119: nur die 200pcs-SKU wird per PUT auf 15,95 gesetzt (volles Offer, nur der Preis neu); die 100pcs-SKUs werden nicht berührt', async () => {
    const { fn, puts, gets } = mockEbay({});
    const res = await sendVariantRaises(119, GROUPS119, entries, [{ skuId: 'v200', newSell: 15.95 }], 'tok', fn);
    expect(res.resolved).toBe(true);
    expect(res.results).toEqual([{ skuId: 'v200', sku: skuOf('200pcs'), ok: true, skipped: undefined, error: undefined }]);
    expect(puts).toHaveLength(1);
    expect(puts[0].sku).toBe(skuOf('200pcs'));
    expect(puts[0].price).toBe('15.95');
    expect(puts[0].body.listingDescription).toBe('<p>x</p>'); // volles Offer bleibt erhalten
    expect(gets).toEqual([skuOf('200pcs')]);
  });

  test('raise-only am Live-Preis: steht eBay schon auf 16,95 (≥ 15,95), wird NICHT gesendet (nie senken), Ergebnis "skipped"', async () => {
    const { fn, puts } = mockEbay({ [skuOf('200pcs')]: '16.95' });
    const res = await sendVariantRaises(119, GROUPS119, entries, [{ skuId: 'v200', newSell: 15.95 }], 'tok', fn);
    expect(puts).toHaveLength(0);
    expect(res.results[0].ok).toBe(true);
    expect(res.results[0].skipped).toContain('nie senken');
  });

  test('stele-194-Fall: Dubletten (zwei Einträge für dieselbe Kombination) → resolved:false, KEIN PUT, nichts getan', async () => {
    const dup = [...entries, { skuId: 'v200-dup', attrs: { Menge: '200pcs' }, price: 4.99, stock: 5 }];
    const { fn, puts } = mockEbay({});
    const res = await sendVariantRaises(119, GROUPS119, dup, [{ skuId: 'v200', newSell: 15.95 }], 'tok', fn);
    expect(res.resolved).toBe(false);
    expect(res.reason).toContain('mehrdeutig');
    expect(puts).toHaveLength(0);
  });

  test('SKU nicht in der eBay-Gruppe oder Variante ohne Zuordnung → resolved:false, KEIN PUT', async () => {
    const fnNoGroup = (async (url: string) => String(url).includes('/inventory_item_group/') ? new Response(JSON.stringify({ variantSKUs: [] }), { status: 200 }) : new Response('{}', { status: 500 })) as unknown as typeof fetch;
    const a = await sendVariantRaises(119, GROUPS119, entries, [{ skuId: 'v200', newSell: 15.95 }], 'tok', fnNoGroup);
    expect(a.resolved).toBe(false);
    const { fn, puts } = mockEbay({});
    const b = await sendVariantRaises(119, GROUPS119, entries, [{ skuId: 'unbekannt', newSell: 15.95 }], 'tok', fn);
    expect(b.resolved).toBe(false);
    expect(puts).toHaveLength(0);
  });

  test('Exception bei Variante B (fetch wirft) verwirft das Ergebnis von Variante A NICHT: A ok, B ok:false mit Fehlertext', async () => {
    const puts: string[] = [];
    const skuA = skuOf('200pcs');
    const skuB = skuOf('100pcs A');
    const fn = (async (url: string, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (u.includes('/inventory_item_group/')) return new Response(JSON.stringify({ variantSKUs: [skuA, skuB, skuOf('100pcs B')] }), { status: 200 });
      const m = /offer\?sku=([^&]+)/.exec(u);
      if (m) { const sku = decodeURIComponent(m[1]); if (sku === skuB) throw new Error('Netz weg'); return new Response(JSON.stringify({ offers: [{ offerId: 'o-' + sku, sku }] }), { status: 200 }); }
      const o = /\/offer\/o-(.+)$/.exec(u);
      if (o) { if (init?.method === 'PUT') { puts.push(o[1]); return new Response('', { status: 204 }); } return new Response(JSON.stringify(offerFor(o[1], '10.00')), { status: 200 }); }
      throw new Error('Unmocked: ' + u);
    }) as unknown as typeof fetch;
    const res = await sendVariantRaises(119, GROUPS119, entries, [{ skuId: 'v200', newSell: 15.95 }, { skuId: 'v100a', newSell: 13.95 }], 'tok', fn);
    expect(res.resolved).toBe(true);
    expect(res.results[0].ok).toBe(true);
    expect(res.results[1].ok).toBe(false);
    expect(res.results[1].error).toContain('Ausnahme beim Senden');
    expect(puts).toEqual([skuA]);
  });

  test('raise-only: nicht lesbarer Live-Preis → NICHT schreiben (Fehler statt PUT)', async () => {
    const puts: string[] = [];
    const fn = (async (url: string, init?: { method?: string }) => {
      const u = String(url);
      if (/offer\?sku=/.test(u)) return new Response(JSON.stringify({ offers: [{ offerId: 'o1', sku: 'x' }] }), { status: 200 });
      if (init?.method === 'PUT') { puts.push(u); return new Response('', { status: 204 }); }
      return new Response(JSON.stringify({ offerId: 'o1', pricingSummary: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await updateOfferPriceBySku('x', 15.95, 'tok', fn, true);
    expect(puts).toHaveLength(0);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('nicht lesbar');
  });

  test('updateOfferPriceBySku ohne raiseOnly (bisheriges Verhalten) schreibt auch einen niedrigeren Preis — der Standardaufruf ist unverändert', async () => {
    const { fn, puts } = mockEbay({ [skuOf('200pcs')]: '16.95' });
    const r = await updateOfferPriceBySku(skuOf('200pcs'), 15.95, 'tok', fn);
    expect(r).toEqual({ ok: true });
    expect(puts).toHaveLength(1);
  });
});
