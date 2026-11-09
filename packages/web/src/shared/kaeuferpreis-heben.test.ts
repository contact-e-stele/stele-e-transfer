// AUFSICHT 045 Teil A (09.11.2026, gestaffelte eBay-Fixgebühr 0,35/0,45 statt 0,30): Erwartungswerte in dieser Datei mit bun neu gerechnet.
// Zahlen in Testnamen/Kommentaren können noch den Stand mit 0,30 zeigen — maßgeblich sind die expect-Werte. Liste alt → neu: docs/fixgebuehr-testaenderungen.md
// AUFTRAG Kalkulator an 7 App – 162/208 (09.11.2026 07:00): "Käuferpreis auf Angebotsdaten heben".
// ECHTE beobachtete Werte (Kalkulator): stele-162 Variante "10" (skuId 12000056749494569, EK 2,35, China, Anzeige 5 %): Käufer (GetItem)
// 15,45, Angebotsdaten (Offer) 16,45. stele-208 SILVER (skuId 12000048693957042, EK 2,89, China, 5 %): Käufer 16,95, Angebotsdaten 17,45.
// TESTWERTE (nicht aus der Produktions-DB, offengelegt in der PR): Zielgewinn 1,50 € (Stufe B; Stufe A 1,00 ergibt denselben Zielpreis),
// Einfuhr = Betriebswert 5,95 €, kein Kassen-Faktor, nicht Elektro, eine Varianten-Gruppe "Farbe" mit genau dieser Variante, eBay-SKU "stele-162-10" / "stele-208-SILVER".
// Zielpreis wird NICHT hart codiert, sondern von planTierReprice gerechnet (mit bun nachgerechnet: 16,45 / 17,45).
import { afterAll, describe, expect, test } from 'bun:test';
import { setAliEinfuhrEur, ALI_EINFUHR_EUR, ALI_EINFUHR_ALT_EUR } from './constants';
import { planTierReprice, type RepriceProduct } from './tier-reprice';
import {
  planBuyerPriceRaise, targetVkFor, skipLogLine, compareRaiseExpected, expectedFromRaisePlan, parseRaiseBuyerBody,
  evaluateRaiseReadback, buildReviseInventoryStatusPriceXml, parseTradingAck, type RaiseBuyerInputRow,
} from './kaeuferpreis-heben';
import { runBuyerPriceRaise, previewBuyerPriceRaise } from '../api/kaeuferpreis-heben';

// Betriebswert Einfuhr 5,95 (der Test-Preload setzt sonst den alten Beleg-Wert 3,57, s. test-preload-einfuhr.ts).
setAliEinfuhrEur(ALI_EINFUHR_EUR);
afterAll(() => setAliEinfuhrEur(ALI_EINFUHR_ALT_EUR));

const SKU162 = '12000056749494569';
const SKU208 = '12000048693957042';
const mk = (id: number, skuId: string, ek: number, value: string, target = 1.5): RepriceProduct & { targetMarginEur: number } => ({
  id, variants: JSON.stringify([{ name: 'Farbe', values: [value] }]), buyPrice: ek, sellPrice: null, shipsFrom: 'China', adRate: 5,
  variantPrices: JSON.stringify([{ skuId, attrs: { Farbe: value }, price: ek }]), variantSellPrices: null, targetMarginEur: target,
});
const target = (p: ReturnType<typeof mk>, skuId: string) =>
  targetVkFor(planTierReprice(p, p.targetMarginEur, [{ name: 'Farbe', values: JSON.parse(p.variants as string)[0].values }]), skuId);

const t162 = target(mk(162, SKU162, 2.35, '10'), SKU162);
const t208 = target(mk(208, SKU208, 2.89, 'SILVER'), SKU208);
// AUFSICHT 045 Teil A (09.11.2026): mit gestaffelter Fixgebühr (0,45) rechnet die App für 162 jetzt 16,95 (bun) ≠ Angebotsdaten 16,45 →
// mit den echten Werten wird 162 übersprungen (ziel_abweichend), siehe "Plan 162/208 mit den echten Werten". Die Regel-Tests unten
// prüfen die Mechanik (a)–(c) und brauchen Ziel = Angebotsdaten: dort TESTWERT targetVk 16,45 (vorher = t162, damals 16,45).
const row162 = (o: Partial<RaiseBuyerInputRow> = {}): RaiseBuyerInputRow => ({ skuId: SKU162, sku: 'stele-162-10', label: '10', buyerPrice: 15.45, offerPrice: 16.45, targetVk: 16.45, ...o });
const row208 = (o: Partial<RaiseBuyerInputRow> = {}): RaiseBuyerInputRow => ({ skuId: SKU208, sku: 'stele-208-SILVER', label: 'SILVER', buyerPrice: 16.95, offerPrice: 17.45, targetVk: t208, ...o });

describe('Zielpreis der App aus planTierReprice (Formel v2, China, 5 %)', () => {
  test('stele-162 "10" EK 2,35 → 16,95 € (045 A: vorher 16,45 = Angebotsdaten, jetzt ≠)', () => { expect(t162).toBe(16.95); });
  test('stele-208 SILVER EK 2,89 → 17,45 € = Angebotsdaten', () => { expect(t208).toBe(17.45); });
  test('Stufe A (1,00) ergibt denselben Zielpreis, Stufe C (2,00) nicht (17,45 / 18,45)', () => {
    expect(target(mk(162, SKU162, 2.35, '10', 1.0), SKU162)).toBe(16.95);
    expect(target(mk(162, SKU162, 2.35, '10', 2.0), SKU162)).toBe(17.45);
    expect(target(mk(208, SKU208, 2.89, 'SILVER', 2.0), SKU208)).toBe(18.45);
  });
});

// Bündel A+B (Teil B): 162 hat laut Auftrag die eBay-Kategorie 10900 (14 %). Mit dem Kategorie-Satz rechnet planTierReprice
// (bun): Ziel 16,45 € = Angebotsdaten 16,45 → 162 würde wieder gehoben. Gewinn bei 16,45 (China, S 1,19, 5 %, Fix 0,45): 1,1984794.
// Zielgewinn 1,50 bleibt TESTWERT (Stufe A 1,00 ergibt dieselben 16,45; Stufe C 2,00 → 17,45).
describe('Bündel A+B: stele-162 mit Kategorie 10900 (14 %)', () => {
  const mk162 = (t: number) => ({ ...mk(162, SKU162, 2.35, '10', t), ebayCategory: '10900' });
  const t162neu = target(mk162(1.5), SKU162);
  test('Ziel 16,45 € (ohne Kategorie 16,95); Stufe A 16,45, Stufe C 17,45', () => {
    expect(t162neu).toBe(16.45);
    expect(target(mk162(1.0), SKU162)).toBe(16.45);
    expect(target(mk162(2.0), SKU162)).toBe(17.45);
    expect(planTierReprice(mk162(1.5), 1.5, [{ name: 'Farbe', values: ['10'] }]).rows[0].newProfit).toBeCloseTo(1.1984794, 6);
  });
  test('Plan 162/208: 162 wieder gehoben 15,45 → 16,45 (+6,47 %), 208 (Kategorie unbekannt → 15 %) gehoben 16,95 → 17,45', () => {
    const plan = planBuyerPriceRaise([row162({ targetVk: t162neu }), row208()]);
    expect(plan.raiseCount).toBe(2);
    expect(plan.actions.map(a => [a.status, a.to, a.jumpPct])).toEqual([['heben', 16.45, 6.47], ['heben', 17.45, 2.95]]);
  });
});

describe('Plan 162/208 mit den echten Werten', () => {
  const plan = planBuyerPriceRaise([row162({ targetVk: t162 }), row208()]);
  // AUFSICHT 045 A: vorher wurden beide gehoben (raiseCount 2); jetzt Ziel 162 = 16,95 ≠ Angebotsdaten 16,45 → nur 208.
  test('echte Werte nach 045 A: 162 übersprungen (ziel_abweichend, Ziel 16,95 ≠ 16,45), 208 gehoben 16,95 → 17,45 (+2,95 %)', () => {
    expect(plan.raiseCount).toBe(1);
    expect(plan.skipCount).toBe(1);
    expect(plan.actions.map(a => [a.status, a.to, a.jumpPct])).toEqual([['uebersprungen', null, 6.47], ['heben', 17.45, 2.95]]);
    expect(plan.actions[0].code).toBe('ziel_abweichend');
  });
  test('expected aus der Vorschau = { sku: neuer Käuferpreis }', () => {
    expect(expectedFromRaisePlan(plan.actions)).toEqual({ 'stele-208-SILVER': 17.45 }); // 045 A: 162 nicht mehr enthalten
  });
});

describe('Regel (a): nur nach oben', () => {
  test('Angleichen-Fall (Angebotsdaten 15,45 < Käufer 16,45) → übersprungen nicht_hoeher', () => {
    const a = planBuyerPriceRaise([row162({ buyerPrice: 16.45, offerPrice: 15.45 })]).actions[0];
    expect(a.status).toBe('uebersprungen');
    expect(a.code).toBe('nicht_hoeher');
  });
  test('gleich (± 0,01) → "gleich", nichts gesendet', () => {
    expect(planBuyerPriceRaise([row162({ buyerPrice: 16.45 })]).actions[0].status).toBe('gleich');
    expect(planBuyerPriceRaise([row162({ buyerPrice: 16.44 })]).actions[0].status).toBe('gleich');
  });
});

describe('Regel (b): Angebotsdaten == Zielpreis der App ± 0,01', () => {
  test('Zielpreis bei Stufe C (2,00) = 17,45 ≠ 16,45 → übersprungen ziel_abweichend', () => {
    const tC = target(mk(162, SKU162, 2.35, '10', 2.0), SKU162);
    const a = planBuyerPriceRaise([row162({ targetVk: tC })]).actions[0];
    expect(a.code).toBe('ziel_abweichend');
  });
  test('Toleranz: Ziel 16,46 noch ok, 16,47 nicht', () => {
    expect(planBuyerPriceRaise([row162({ targetVk: 16.46 })]).actions[0].status).toBe('heben');
    expect(planBuyerPriceRaise([row162({ targetVk: 16.47 })]).actions[0].code).toBe('ziel_abweichend');
  });
  test('kein Zielpreis (ohne EK) → übersprungen kein_ziel', () => {
    expect(planBuyerPriceRaise([row162({ targetVk: null })]).actions[0].code).toBe('kein_ziel');
  });
});

describe('Regel (c): Sprung ≤ 15 % gegenüber dem Käuferpreis (OFFEN 010)', () => {
  test('Käufer 14,00 → 16,45 = +17,50 % → übersprungen preissprung', () => {
    const a = planBuyerPriceRaise([row162({ buyerPrice: 14.0 })]).actions[0];
    expect(a.code).toBe('preissprung');
    expect(a.jumpPct).toBe(17.5);
  });
  test('Grenze: Käufer 14,31 (+14,95 %) ok, 14,30 (+15,03 %) Sprung', () => {
    expect(planBuyerPriceRaise([row162({ buyerPrice: 14.31 })]).actions[0].status).toBe('heben');
    expect(planBuyerPriceRaise([row162({ buyerPrice: 14.3 })]).actions[0].code).toBe('preissprung');
  });
});

describe('weitere Gründe (nichts geraten)', () => {
  test('Käuferpreis oder Angebotsdaten unbekannt → unbekannt', () => {
    expect(planBuyerPriceRaise([row162({ buyerPrice: null })]).actions[0].code).toBe('unbekannt');
    expect(planBuyerPriceRaise([row162({ offerPrice: null })]).actions[0].code).toBe('unbekannt');
  });
  test('"Preis halten" → gehalten', () => {
    expect(planBuyerPriceRaise([row162({ held: true })]).actions[0].code).toBe('gehalten');
  });
  test('Log-Zeile je Grund', () => {
    const a = planBuyerPriceRaise([row162({ buyerPrice: 14.0 })]).actions[0];
    expect(skipLogLine(162, a)).toBe(`[Käuferpreis heben] stele-162 stele-162-10: übersprungen [preissprung] — ${a.grund}`);
  });
});

describe('POST-Body und bestätigte Vorschau', () => {
  test('ohne confirm: true → abgelehnt', () => {
    expect(parseRaiseBuyerBody({}).ok).toBe(false);
    expect(parseRaiseBuyerBody({ confirm: 'true' }).ok).toBe(false);
    expect(parseRaiseBuyerBody(null).ok).toBe(false);
    expect(parseRaiseBuyerBody({ confirm: true }).ok).toBe(true);
    expect(parseRaiseBuyerBody({ confirm: true, expected: { a: 'x' } }).ok).toBe(false);
  });
  test('Plan seit der Vorschau geändert → Meldung', () => {
    const actions = planBuyerPriceRaise([row162()]).actions;
    expect(compareRaiseExpected(actions, { 'stele-162-10': 16.45 })).toBeNull();
    expect(compareRaiseExpected(actions, { 'stele-162-10': 16.95 })).toContain('geändert');
    expect(compareRaiseExpected(actions, {})).toContain('geändert');
  });
});

describe('Zurücklesen nach dem Senden', () => {
  const sent = [{ sku: 'stele-162-10', skuId: SKU162, to: 16.45, ok: true }];
  test('eBay hat übernommen (Käufer 16,45 = Offer 16,45) → bestätigt, Sperre auf', () => {
    const ev = evaluateRaiseReadback(sent, [{ sku: 'stele-162-10', buyerPrice: 16.45, offerPrice: 16.45 }]);
    expect(ev.confirmed).toEqual([{ sku: 'stele-162-10', skuId: SKU162, price: 16.45 }]);
    expect(ev.liftLock).toBe(true);
  });
  test('eBay hat NICHT übernommen (Käufer weiter 15,45) → nicht bestätigt, Sperre bleibt', () => {
    const ev = evaluateRaiseReadback(sent, [{ sku: 'stele-162-10', buyerPrice: 15.45, offerPrice: 16.45 }]);
    expect(ev.confirmed).toEqual([]);
    expect(ev.notConfirmed[0].reason).toContain('15,45');
    expect(ev.liftLock).toBe(false);
  });
  test('Senden abgelehnt → nicht bestätigt, auch wenn der Käuferpreis zufällig passt', () => {
    const ev = evaluateRaiseReadback([{ ...sent[0], ok: false }], [{ sku: 'stele-162-10', buyerPrice: 16.45, offerPrice: 16.45 }]);
    expect(ev.confirmed).toEqual([]);
  });
  test('Angebotsdaten unlesbar → Sperre bleibt', () => {
    expect(evaluateRaiseReadback(sent, [{ sku: 'stele-162-10', buyerPrice: 16.45, offerPrice: null }]).liftLock).toBe(false);
  });
});

describe('Trading ReviseInventoryStatus (XML / Antwort)', () => {
  test('Variante: ItemID + SKU + StartPrice', () => {
    const x = buildReviseInventoryStatusPriceXml('TOK', '123', 'stele-162-10', 16.45);
    expect(x).toContain('<ItemID>123</ItemID>');
    expect(x).toContain('<SKU>stele-162-10</SKU>');
    expect(x).toContain('<StartPrice>16.45</StartPrice>');
  });
  test('Einzelartikel: ohne SKU', () => {
    expect(buildReviseInventoryStatusPriceXml('TOK', '123', null, 9.95)).not.toContain('<SKU>');
  });
  test('Antwort Failure → Fehlercode wird gelesen (Testantwort, kein echter eBay-Text)', () => {
    const r = parseTradingAck('<R><Ack>Failure</Ack><Errors><LongMessage>Testmeldung</LongMessage><ErrorCode>25019</ErrorCode></Errors></R>');
    expect(r).toEqual({ ok: false, ack: 'Failure', errorCodes: ['25019'], message: 'Testmeldung' });
    expect(parseTradingAck('<R><Ack>Warning</Ack></R>').ok).toBe(true);
    expect(parseTradingAck('<R><Ack>Success</Ack></R>').ok).toBe(true);
  });
});

describe('Ablauf runBuyerPriceRaise (eBay/DB gemockt)', () => {
  const mkDeps = (afterBuyer: number, reviseOk = true) => {
    const calls = { revise: [] as Array<[string | null, number]>, store: [] as unknown[], lock: [] as unknown[], log: [] as string[] };
    let n = 0;
    return {
      calls,
      deps: {
        readRows: async () => (n++ === 0 ? [row162(), row208({ buyerPrice: 17.45 })] : [row162({ buyerPrice: afterBuyer }), row208({ buyerPrice: 17.45 })]),
        revise: async (sku: string | null, price: number) => { calls.revise.push([sku, price]); return reviseOk ? { ok: true } : { ok: false, error: 'ReviseInventoryStatus Failure [25019]: Testmeldung' }; },
        store: async (c: unknown) => { calls.store.push(c); },
        setLock: async (l: unknown) => { calls.lock.push(l); },
        log: (m: string) => { calls.log.push(m); },
      },
    };
  };
  test('übernommen → genau ein Revise (162), App-Preis gespeichert, Sperre aufgehoben', async () => {
    const { calls, deps } = mkDeps(16.45);
    const out = await runBuyerPriceRaise(162, deps);
    expect(out.status).toBe('gesendet');
    expect(calls.revise).toEqual([['stele-162-10', 16.45]]);
    expect(calls.store).toEqual([[{ skuId: SKU162, price: 16.45 }]]);
    expect(calls.lock).toEqual([null]);
  });
  test('nicht übernommen → nichts gespeichert, Sperre bleibt mit dem neuen Stand', async () => {
    const { calls, deps } = mkDeps(15.45);
    const out = await runBuyerPriceRaise(162, deps);
    expect(out.status === 'gesendet' && out.locked).toBe(true);
    expect(calls.store).toEqual([]);
    expect(calls.lock).toEqual([[{ sku: 'stele-162-10', label: '10', buyerPrice: 15.45, offerPrice: 16.45 }]]);
    expect(calls.log.some(l => l.includes('NICHT bestätigt'))).toBe(true);
  });
  test('eBay lehnt ab → nichts gespeichert, Sperre bleibt', async () => {
    const { calls, deps } = mkDeps(15.45, false);
    await runBuyerPriceRaise(162, deps);
    expect(calls.store).toEqual([]);
    expect(calls.lock[0]).not.toBeNull();
  });
  test('Vorschau weicht ab → nichts gesendet, nichts gespeichert, Sperre unverändert', async () => {
    const { calls, deps } = mkDeps(16.45);
    const out = await runBuyerPriceRaise(162, deps, { 'stele-162-10': 16.95 });
    expect(out.status).toBe('abgelehnt');
    expect(calls.revise).toEqual([]);
    expect(calls.store).toEqual([]);
    expect(calls.lock).toEqual([]);
  });
  test('nichts zu heben (Preissprung) → nichts gesendet, Sperre unverändert, Log-Zeile mit Grund', async () => {
    const { calls, deps } = mkDeps(16.45);
    deps.readRows = async () => [row162({ buyerPrice: 14.0 })];
    const out = await runBuyerPriceRaise(162, deps);
    expect(out.status).toBe('nichts');
    expect(calls.revise).toEqual([]);
    expect(calls.lock).toEqual([]);
    expect(calls.log.some(l => l.includes('[preissprung]'))).toBe(true);
  });
  test('Vorschau schreibt nichts, loggt Gründe', async () => {
    const log: string[] = [];
    const plan = await previewBuyerPriceRaise(162, { readRows: async () => [row162({ targetVk: 17.45 })], log: m => log.push(m) });
    expect(plan.actions[0].code).toBe('ziel_abweichend');
    expect(log[0]).toContain('[ziel_abweichend]');
  });
});
