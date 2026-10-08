// A-014 (04.10.2026): Die Tests zur Preisformel selbst (Kosten, Rundung/Boden, Stufen, Gewinn, Alarm, Varianten-Plan)
// stehen in pricing-v2.test.ts. Diese Datei behält die formel-unabhängigen Bausteine (Rundungshelfer, Senkungsbremse,
// Nur-Anheben, variant_sell_prices, Bestellungs-Gewinn). Die Alt-Fixtures der Formel bis v1 (Zoll 4,00 € + shippingCost) sind
// durch die v2-Tests ersetzt, nicht stillschweigend gelöscht.
// Teil 2A+2B+2C (P-27/P-28-Preis-Fundament, 2026-09-10): Tests für die einzige Kalkulationsfunktion
// computeMinSellPrice(). Teil 2A bewies WERTNEUTRALITÄT des reinen Struktur-Refactors. Teil 2B
// korrigierte DEFAULT_PRICING_CONFIG auf die real gemessenen Werte (15% + 0,30€). Teil 2C
// ("Zielgewinn trifft exakt") entfernt den Sicherheitspuffer (safetyBufferEur jetzt fest 0, vorher
// 1,50€ zusätzlich zum Zielgewinn) und stellt alle automatischen Aufrufstellen von 'up95'
// (rundet IMMER aufwärts) auf 'nearest95' (rundet zur nächsten ,95-Marke, auch abwärts) um — beides
// zusammen war die Ursache dafür, dass aus einem gewünschten 2,00€-Zielgewinn real 3,50-4,25€
// wurden. Alle Fixture-Erwartungszahlen in diesem Test wurden darum NEU mit der Teil-2C-Formel
// berechnet (nicht mehr mit Sicherheitspuffer/up95) und als feste Literale hinterlegt.
//
// Datenherkunft der Snapshot-Fixtures: mindestens 10 reale Produkte, darunter stele-98/110/141
// (12 reale Einkaufspreis-Datenpunkte in Summe, vom Nutzer in Teil 1 direkt mitgeteilt).
// shippingCost/adRate/shipsFrom für diese konkreten Produkte sind ohne Live-DB-Zugriff nicht
// bekannt und mit den App-Standardwerten angenommen (versand=0, adRate=5, kein China-Versand) —
// bewusst dokumentierte Vereinfachung, keine Behauptung realer Feldwerte. stele-152 bleibt NICHT
// enthalten (keine reale Zahl dafür im Chat verfügbar, siehe Teil-2A-Testdatei-Historie).
import { describe, expect, test } from 'bun:test';
import { applyDecreaseCap, applyRaiseOnly, planCappedPriceSteps, computeVariantSellPrices, parseVariantSellPrices, serializeVariantSellPrices, resolveVariantSellPrice, roundUpToX95, roundToNearest95, computeOrderProfit, DEFAULT_PRICING_CONFIG, AUTO_PRICE_WRITE_ENABLED } from './pricing';
import { MAX_PRICE_DECREASE_PERCENT } from './constants';

describe('DEFAULT_PRICING_CONFIG — Teil 2B/2C: real gemessene Werte, kein Sicherheitspuffer mehr', () => {
  test('Gebührensatz, Fixbetrag und MwSt-Faktor entsprechen den in 13 realen Bestellungen gemessenen Werten', () => {
    expect(DEFAULT_PRICING_CONFIG.ebayFeeRatePercent).toBe(15);
    expect(DEFAULT_PRICING_CONFIG.ebayFixedFeeEur).toBe(0.30);
    expect(DEFAULT_PRICING_CONFIG.vatFactor).toBe(1.19);
  });

  // Teil 2C, Ursache 1 der Zielgewinn-Abweichung: der Sicherheitspuffer wurde ZUSÄTZLICH zum
  // Zielgewinn addiert. Ab jetzt fest 0 — PRICE_SAFETY_BUFFER_EUR (shared/constants.ts) bleibt
  // als Konstante bestehen, wird aber von keiner Kalkulation mehr referenziert.
  test('safetyBufferEur ist 0 (Teil 2C — vorher 1,50€, Ursache der Zielgewinn-Abweichung)', () => {
    expect(DEFAULT_PRICING_CONFIG.safetyBufferEur).toBe(0);
  });

  // SICHERHEITSKRITISCH (Pflichtbestandteil der strikten Grenzen): Teil 4/5 (2026-09-13) setzt
  // AUTO_PRICE_WRITE_ENABLED auf true — das ist NUR zulässig, weil applyRaiseOnly() im selben PR
  // die automatischen Pfade (price-monitor.ts checkOne(), index.ts check-all-prices) auf
  // ausschließliches Anheben beschränkt. Siehe describe-Block "applyRaiseOnly" unten für den
  // Nachweis, dass diese beiden Pfade nie mehr senken können.
  test('AUTO_PRICE_WRITE_ENABLED ist true (Teil 4/5) — nur zulässig, weil die Automatik jetzt ausschließlich anheben kann', () => {
    expect(AUTO_PRICE_WRITE_ENABLED).toBe(true);
  });
});

describe('roundUpToX95 / roundToNearest95 — reine Rundungsfunktionen (unverändert gegenüber Teil 2A)', () => {
  test('roundUpToX95 rundet immer aufwärts, nie ab', () => {
    expect(roundUpToX95(10.00)).toBe(10.95);
    expect(roundUpToX95(10.94)).toBe(10.95);
    expect(roundUpToX95(10.96)).toBe(11.95);
    expect(roundUpToX95(10.95)).toBe(10.95);
  });

  test('roundToNearest95 rundet zur nächstgelegenen ,95-Marke, auch abwärts', () => {
    expect(roundToNearest95(10.00)).toBe(9.95);
    expect(roundToNearest95(10.50)).toBe(10.95);
    expect(roundToNearest95(10.95)).toBe(10.95);
  });
});

describe('applyDecreaseCap — Teil 2D "Senkungsbremse": computeMinSellPrice() liefert eine Untergrenze, kein Zielpreis', () => {
  test('MAX_PRICE_DECREASE_PERCENT ist 8 (Vorgabe des Nutzers, 2026-09-10)', () => {
    expect(MAX_PRICE_DECREASE_PERCENT).toBe(8);
  });

  // a) Anheben, weil der aktuelle Preis unter dem Mindestpreis liegt — darf NICHT gedeckelt werden
  test('a) Anheben wird NIE gedeckelt (schützt vor Verlust)', () => {
    const result = applyDecreaseCap(15.00, 18.95, MAX_PRICE_DECREASE_PERCENT);
    expect(result).toEqual({ price: 18.95, wasCapped: false, uncappedPrice: 18.95 });
  });

  // b) Absenken um mehr als 8% — muss auf 8% begrenzt werden (reale Beispiele aus dem Auftrag)
  test('b) Absenken um mehr als 8% wird begrenzt — real beobachtete Fälle stele-141/stele-110', () => {
    // stele-141: eBay aktuell 23,95€, berechneter Mindestpreis 10,95€ (−54,3%, weit über 8%)
    const stele141 = applyDecreaseCap(23.95, 10.95, MAX_PRICE_DECREASE_PERCENT);
    expect(stele141.wasCapped).toBe(true);
    expect(stele141.uncappedPrice).toBe(10.95);
    expect(stele141.price).toBe(22.95);
    expect((23.95 - stele141.price) / 23.95).toBeLessThanOrEqual(0.08);

    // stele-110: eBay aktuell 20,95€, berechneter Mindestpreis 10,95€ (−47,7%, weit über 8%)
    const stele110 = applyDecreaseCap(20.95, 10.95, MAX_PRICE_DECREASE_PERCENT);
    expect(stele110.wasCapped).toBe(true);
    expect(stele110.uncappedPrice).toBe(10.95);
    expect(stele110.price).toBe(19.95);
    expect((20.95 - stele110.price) / 20.95).toBeLessThanOrEqual(0.08);
  });

  // Regressionsschutz für die Rundungs-Präzisierung (s. Kommentar in pricing.ts): eine naive
  // roundToNearest95()-Anwendung auf den 8%-Grenzwert selbst würde hier 21,95€ ergeben — das wäre
  // bereits 8,35% Absenkung, eine Verletzung der 8%-Bremse. Beweist, dass die Zwei-Modi-Rundung
  // (roundUpToX95 als Fallback) das tatsächlich verhindert.
  test('Regressionsschutz: eine reine roundToNearest95()-Rundung des Grenzwerts würde die 8%-Bremse verletzen', () => {
    const naiveFloor = 23.95 * (1 - 8 / 100);
    const naiveRounded = roundToNearest95(naiveFloor);
    expect(naiveRounded).toBe(21.95); // würde die Bremse verletzen, s.u.
    expect((23.95 - naiveRounded) / 23.95).toBeGreaterThan(0.08); // 8,35% — genau der Bug, den applyDecreaseCap vermeidet
    // applyDecreaseCap() selbst bleibt innerhalb der Bremse (Test b oben: 22,95€, 4,18%).
  });

  // c) Absenken um weniger als 8% — muss unveraendert durchgehen
  test('c) Absenken um weniger als 8% bleibt unverändert (kein unnötiges Runden/Verändern)', () => {
    const result = applyDecreaseCap(20.00, 19.00, MAX_PRICE_DECREASE_PERCENT); // −5%
    expect(result).toEqual({ price: 19.00, wasCapped: false, uncappedPrice: 19.00 });
  });

  test('currentPrice null/undefined (Erst-Listing, kein bisheriger Preis) — computedMinPrice unverändert', () => {
    expect(applyDecreaseCap(null, 12.95, MAX_PRICE_DECREASE_PERCENT)).toEqual({ price: 12.95, wasCapped: false, uncappedPrice: 12.95 });
    expect(applyDecreaseCap(undefined, 12.95, MAX_PRICE_DECREASE_PERCENT)).toEqual({ price: 12.95, wasCapped: false, uncappedPrice: 12.95 });
  });

  test('computedMinPrice === currentPrice — keine Änderung, kein Deckeln (Grenzfall, kein Absinken)', () => {
    expect(applyDecreaseCap(18.95, 18.95, MAX_PRICE_DECREASE_PERCENT)).toEqual({ price: 18.95, wasCapped: false, uncappedPrice: 18.95 });
  });

  test('gedeckelter Preis überschreitet die 8%-Bremse in keinem der Testfälle (a/b/c + Regressionsfall)', () => {
    const cases: Array<[number, number]> = [[15.00, 18.95], [23.95, 10.95], [20.95, 10.95], [20.00, 19.00]];
    for (const [currentPrice, computedMinPrice] of cases) {
      const { price } = applyDecreaseCap(currentPrice, computedMinPrice, MAX_PRICE_DECREASE_PERCENT);
      if (price < currentPrice) {
        expect((currentPrice - price) / currentPrice).toBeLessThanOrEqual(MAX_PRICE_DECREASE_PERCENT / 100);
      }
    }
  });
});

describe('applyRaiseOnly — Teil 4/5: automatische Pfade dürfen AUSSCHLIESSLICH anheben, nie senken', () => {
  // a) Mindestpreis höher als aktuell → wird angehoben
  test('a) Mindestpreis höher als aktueller Preis → anheben', () => {
    const result = applyRaiseOnly(15.00, 18.95);
    expect(result).toEqual({ action: 'raise', price: 18.95, wasBelowBreakEven: true, isInitialPrice: false });
  });

  // b) Mindestpreis niedriger als aktuell → KEIN Schreibvorgang (reale Fälle aus dem Auftrag:
  // stele-141 23,95€→10,95€, stele-123 35,95€→12,95€ — beides würde applyDecreaseCap gedeckelt
  // auf einen niedrigeren Preis SENKEN; applyRaiseOnly tut hier NICHTS)
  test('b) Mindestpreis niedriger als aktueller Preis → KEIN Schreibvorgang (kein Senken, auch nicht gedeckelt)', () => {
    const stele141 = applyRaiseOnly(23.95, 10.95);
    expect(stele141).toEqual({ action: 'none', price: 23.95, wasBelowBreakEven: false, isInitialPrice: false });

    const stele123 = applyRaiseOnly(35.95, 12.95);
    expect(stele123).toEqual({ action: 'none', price: 35.95, wasBelowBreakEven: false, isInitialPrice: false });
  });

  // c) Mindestpreis gleich aktuellem Preis → KEIN Schreibvorgang (zählt ausdrücklich NICHT als
  // Anheben um 0€ — Grenzfall aus dem Auftrag)
  test('c) Mindestpreis gleich aktuellem Preis → KEIN Schreibvorgang', () => {
    const result = applyRaiseOnly(18.95, 18.95);
    expect(result).toEqual({ action: 'none', price: 18.95, wasBelowBreakEven: false, isInitialPrice: false });
  });

  test('kein bisheriger Preis (Erst-Setzung) → anheben, aber NICHT als "lag unter Break-Even" markiert', () => {
    const result = applyRaiseOnly(null, 12.95);
    expect(result).toEqual({ action: 'raise', price: 12.95, wasBelowBreakEven: false, isInitialPrice: true });
    expect(applyRaiseOnly(undefined, 12.95)).toEqual({ action: 'raise', price: 12.95, wasBelowBreakEven: false, isInitialPrice: true });
  });

  // Regressionsschutz: applyRaiseOnly darf in KEINEM Fall einen Preis unter den aktuellen Preis
  // zurückgeben — das ist die eigentliche Sicherheitsgarantie von Teil 4/5, geprüft über eine
  // breite Fallmatrix inkl. der realen 32-von-34-Produkte-Situation aus dem Auftrag.
  test('Regressionsschutz: das Ergebnis liegt NIE unter dem aktuellen Preis', () => {
    const cases: Array<[number, number]> = [
      [15.00, 18.95],   // anheben
      [23.95, 10.95],   // stele-141 — würde mit applyDecreaseCap gesenkt, hier nicht
      [35.95, 12.95],   // stele-123 — größte im Auftrag genannte Differenz
      [20.95, 10.95],   // stele-110
      [18.95, 18.95],   // gleich
      [9.95, 9.94],     // hauchdünn niedriger
    ];
    for (const [currentPrice, computedMinPrice] of cases) {
      const { price } = applyRaiseOnly(currentPrice, computedMinPrice);
      expect(price).toBeGreaterThanOrEqual(currentPrice);
    }
  });

  test('wasBelowBreakEven ist NUR bei tatsächlichem Anheben mit vorhandenem Altpreis true', () => {
    expect(applyRaiseOnly(15.00, 18.95).wasBelowBreakEven).toBe(true);   // raise, Altpreis vorhanden
    expect(applyRaiseOnly(18.95, 18.95).wasBelowBreakEven).toBe(false);  // none
    expect(applyRaiseOnly(23.95, 10.95).wasBelowBreakEven).toBe(false);  // none (würde senken)
    expect(applyRaiseOnly(null, 12.95).wasBelowBreakEven).toBe(false);   // Erst-Setzung, kein Altpreis
  });
});

describe('variant_sell_prices — Teil 3: eigene Spalte für den VK je Variante + Vorrang-Regel', () => {
  test('parseVariantSellPrices liest eine gültige Map', () => {
    expect(parseVariantSellPrices('{"v1":19.95,"v2":12.95}')).toEqual({ v1: 19.95, v2: 12.95 });
  });

  test('parseVariantSellPrices ist tolerant: null/leer/kaputt/Array ergibt eine leere Map statt Absturz', () => {
    expect(parseVariantSellPrices(null)).toEqual({});
    expect(parseVariantSellPrices(undefined)).toEqual({});
    expect(parseVariantSellPrices('')).toEqual({});
    expect(parseVariantSellPrices('{kaputt')).toEqual({});
    expect(parseVariantSellPrices('[1,2,3]')).toEqual({});
  });

  test('parseVariantSellPrices verwirft nicht-numerische und unplausible Werte einzeln', () => {
    // Ein Schrottwert darf nicht als Preis durchrutschen — die übrigen bleiben gültig.
    expect(parseVariantSellPrices('{"v1":19.95,"v2":"12,95","v3":null,"v4":0,"v5":-5}')).toEqual({ v1: 19.95 });
  });

  test('serializeVariantSellPrices erzeugt genau das Format, das parseVariantSellPrices wieder liest', () => {
    const rows = [{ skuId: 'v1', sellPrice: 19.95 }, { skuId: 'v2', sellPrice: 12.95 }];
    expect(parseVariantSellPrices(serializeVariantSellPrices(rows))).toEqual({ v1: 19.95, v2: 12.95 });
  });

  // Die Vorrang-Regel ist der eigentliche Schutz davor, dass die neue Spalte und das alte
  // ebayPrice-Feld zu zwei konkurrierenden Wahrheiten werden.
  test('Vorrang 1: die neue Spalte gewinnt gegen das alte ebayPrice-Feld', () => {
    expect(resolveVariantSellPrice('v1', { v1: 15.95 }, { ebayPrice: 19.95 }))
      .toEqual({ sellPrice: 15.95, source: 'column' });
  });

  test('Vorrang 2: ohne Spaltenwert greift der Altbestand ebayPrice', () => {
    expect(resolveVariantSellPrice('v1', {}, { ebayPrice: 19.95 }))
      .toEqual({ sellPrice: 19.95, source: 'legacy' });
  });

  test('Vorrang 3: ohne beides kein gespeicherter VK — die Aufrufstelle muss rechnen', () => {
    expect(resolveVariantSellPrice('v1', {}, null)).toEqual({ sellPrice: null, source: 'none' });
    expect(resolveVariantSellPrice('v1', {}, {})).toEqual({ sellPrice: null, source: 'none' });
    expect(resolveVariantSellPrice('v1', {}, { ebayPrice: 0 })).toEqual({ sellPrice: null, source: 'none' });
  });

  test('ein Plan aus computeVariantSellPrices lässt sich verlustfrei in die Spalte schreiben und zurücklesen', () => {
    const plan = computeVariantSellPrices({
      variants: [{ skuId: 'v1', buyPrice: 7.69 }, { skuId: 'v2', buyPrice: 2.15 }],
      anchorSellPrice: 19.95, isChinaOrigin: true,
      ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19, adRatePercent: 5, targetMarginEur: 2.00,
    });
    const wieder = parseVariantSellPrices(serializeVariantSellPrices(plan.rows));
    expect(wieder).toEqual({ v1: 19.95, v2: 12.95 });
    for (const row of plan.rows) {
      expect(resolveVariantSellPrice(row.skuId, wieder, null).sellPrice).toBe(row.sellPrice);
    }
  });
});

describe('planCappedPriceSteps — Teil 3: Varianten-Umstellung unter der 8-%-Bremse (Entscheidung des Nutzers)', () => {
  test('grösster stele-110-Sprung (19,95 → 12,95) braucht 7 Läufe, der erste setzt 18,95', () => {
    expect(planCappedPriceSteps(19.95, 12.95, MAX_PRICE_DECREASE_PERCENT))
      .toEqual({ nextPrice: 18.95, runsToTarget: 7, reachesTarget: true });
  });

  test('kleinere Sprünge brauchen entsprechend weniger Läufe', () => {
    expect(planCappedPriceSteps(19.95, 15.95, MAX_PRICE_DECREASE_PERCENT).runsToTarget).toBe(4);
    expect(planCappedPriceSteps(19.95, 14.95, MAX_PRICE_DECREASE_PERCENT).runsToTarget).toBe(5);
    expect(planCappedPriceSteps(19.95, 13.95, MAX_PRICE_DECREASE_PERCENT).runsToTarget).toBe(6);
  });

  test('kein Schritt der Kette überschreitet die 8-%-Bremse', () => {
    let price = 19.95;
    const target = 12.95;
    for (let i = 0; i < 20 && price > target; i++) {
      const next = planCappedPriceSteps(price, target, MAX_PRICE_DECREASE_PERCENT).nextPrice;
      expect((price - next) / price).toBeLessThanOrEqual(MAX_PRICE_DECREASE_PERCENT / 100);
      price = next;
    }
    expect(price).toBe(target);
  });

  test('Anheben ist nie gedeckelt und daher in einem Lauf erledigt', () => {
    expect(planCappedPriceSteps(15.00, 18.95, MAX_PRICE_DECREASE_PERCENT))
      .toEqual({ nextPrice: 18.95, runsToTarget: 1, reachesTarget: true });
  });

  test('Zielpreis gleich aktueller Preis: nichts zu tun', () => {
    expect(planCappedPriceSteps(19.95, 19.95, MAX_PRICE_DECREASE_PERCENT))
      .toEqual({ nextPrice: 19.95, runsToTarget: 0, reachesTarget: true });
  });

  test('kein Fortschritt möglich → Abbruch statt Endlosschleife (reachesTarget false)', () => {
    // Bei niedrigen Preisen liegt die nächste ,95-Marke unterhalb des 8-%-Grenzwerts, die Bremse
    // hält den Preis deshalb auf dem Ausgangswert fest: 1,95€ → Grenzwert 1,794€ → gerundet wieder
    // 1,95€. Der Zielpreis 1,00€ ist so nie erreichbar; die Funktion muss das melden statt endlos
    // zu drehen.
    const plan = planCappedPriceSteps(1.95, 1.00, MAX_PRICE_DECREASE_PERCENT);
    expect(plan).toEqual({ nextPrice: 1.95, runsToTarget: 0, reachesTarget: false });
  });
});

describe('computeOrderProfit — Bestellungs-Gewinn NACH eBay-Gebühren (PRIO-1-PAKET, Punkt "ERGEBNIS")', () => {
  test('Auftragsvorgabe: 17,95 € Verkauf, 11,56 € wahrer Einkauf ergibt 1,76 € (Toleranz 1 Cent)', () => {
    const { profit } = computeOrderProfit(17.95, 11.56, DEFAULT_PRICING_CONFIG.defaultAdRatePercent);
    expect(Math.abs(profit - 1.76)).toBeLessThanOrEqual(0.01);
  });

  // Regressions-Beweis (Grundgesetz Regel 5): eine Rechnung OHNE Gebührenabzug (Rohdifferenz, der
  // alte Bug) ergäbe 17.95 - 11.56 = 6.39 — deutlich mehr als 1,76€. Die Fixture unterscheidet die
  // beiden Verhalten also eindeutig.
  test('unterscheidet sich von der alten Rohdifferenz (ohne Gebührenabzug)', () => {
    const rohdifferenz = 17.95 - 11.56;
    const { profit } = computeOrderProfit(17.95, 11.56, DEFAULT_PRICING_CONFIG.defaultAdRatePercent);
    expect(profit).not.toBeCloseTo(rohdifferenz, 1);
  });

  test('nutzt ausschließlich DEFAULT_PRICING_CONFIG — Gebührensatz+Anzeigentarif, Fixgebühr, MwSt.', () => {
    const totalFeeRateGross = ((DEFAULT_PRICING_CONFIG.ebayFeeRatePercent + DEFAULT_PRICING_CONFIG.defaultAdRatePercent) / 100) * DEFAULT_PRICING_CONFIG.vatFactor;
    const fixedFeeGross = DEFAULT_PRICING_CONFIG.ebayFixedFeeEur * DEFAULT_PRICING_CONFIG.vatFactor;
    const erwarteterGewinn = Math.round((20 * (1 - totalFeeRateGross) - fixedFeeGross - 10) * 100) / 100;
    const erwarteteGebuehren = Math.round((20 * totalFeeRateGross + fixedFeeGross) * 100) / 100;
    const { profit, feesDeducted } = computeOrderProfit(20, 10, DEFAULT_PRICING_CONFIG.defaultAdRatePercent);
    expect(profit).toBe(erwarteterGewinn);
    expect(feesDeducted).toBe(erwarteteGebuehren);
  });
});
