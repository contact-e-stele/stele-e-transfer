// A-014 (04.10.2026): Preisformel v2 — Kosten K = Ware + Versand + Einfuhrabgaben, Rundung ,95 unter dem Rohpreis mit Boden,
// Margen-Stufen A–D. Quellen: Drive PREIS-KALKULATOR "Übergabe Preisformel v2", "P1b Nachprüfung", "Nachtrag 1 Margen-Stufen".
//
// Grundgesetz Regel 3: JEDE Zahl in dieser Datei wurde frisch mit bun nachgerechnet (scripts/tmp/calc*.ts während der
// Entwicklung), nicht aus den Übergabe-Dokumenten oder aus dem Gedächtnis übernommen. Die Beispiele der Übergabe
// (Abschnitt 5 / Nachtrag Abschnitt 4) stimmen mit der Nachrechnung überein.
import { describe, expect, test } from 'bun:test';
import {
  computeAliCosts, computeMinSellPrice, profitAtSellPrice, profitFloorFor, evaluatePriceAlarm, evaluateTargetDisplay,
  evaluateVariantRule6c, computeVariantSellPrices, applyRaiseOnly, roundToProfitFloor, DEFAULT_PRICING_CONFIG,
} from './pricing';
import {
  ALI_VERSAND_EUR, ALI_VERSAND_FREI_AB_EUR, ALI_EINFUHR_EUR, MARGIN_TIERS, HIDDEN_MARGIN_TIER, VARIANT_RULE_6C_ENABLED,
} from './constants';

const FEES = { ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19 };

function v2Price(ware: number, targetMarginEur: number, opts: { china?: boolean; ad?: number } = {}) {
  const china = opts.china ?? true;
  const ad = opts.ad ?? 5;
  const r = computeMinSellPrice({
    buyPrice: ware, isChinaOrigin: china, ...FEES, adRatePercent: ad,
    targetMarginEur, safetyBufferEur: 0, rounding: 'floor95',
  });
  const profit = profitAtSellPrice({ sellPrice: r.minSellPrice, buyPrice: ware, isChinaOrigin: china, ...FEES, adRatePercent: ad });
  return { raw: r.rawMinSellPrice, price: r.minSellPrice, profit, totalCost: r.totalCost, result: r };
}

describe('Konstanten Preisformel v2', () => {
  test('Versand 1,99 €, frei ab 10,00 €, Einfuhrabgaben 3,57 € (belegt am AliExpress-Beleg 3077135261597211)', () => {
    expect(ALI_VERSAND_EUR).toBe(1.99);
    expect(ALI_VERSAND_FREI_AB_EUR).toBe(10.00);
    expect(ALI_EINFUHR_EUR).toBe(3.57);
  });

  test('Margen-Stufen A–D (Inhaber 04.10.2026 10:21): Ziel/Boden 1,00/1,00 · 1,50/1,20 · 2,00/1,30 · 3,00/1,50', () => {
    expect(MARGIN_TIERS.map(t => [t.label, t.targetEur, t.floorEur])).toEqual([
      ['A', 1.00, 1.00], ['B', 1.50, 1.20], ['C', 2.00, 1.30], ['D', 3.00, 1.50],
    ]);
  });

  test('4,50 € / Boden 2,00 € ist bestätigt, aber NICHT in der Auswahl', () => {
    expect(HIDDEN_MARGIN_TIER).toEqual({ label: '4,50', targetEur: 4.50, floorEur: 2.00 });
    expect(MARGIN_TIERS.some(t => t.targetEur === 4.50)).toBe(false);
  });

  test('Standard-Zielgewinn 2,00 € ist Stufe C (Boden 1,30 €); Varianten-Regel 6c ist im Betrieb AUS', () => {
    expect(DEFAULT_PRICING_CONFIG.targetMarginEur).toBe(2.00);
    expect(profitFloorFor(DEFAULT_PRICING_CONFIG.targetMarginEur)).toBe(1.30);
    expect(VARIANT_RULE_6C_ENABLED).toBe(false);
  });
});

describe('computeAliCosts — K = Ware + Versand + Einfuhrabgaben', () => {
  test('China, Ware 4,79 € (< 10): Versand 1,99 + Einfuhrabgaben 3,57 → K 10,35 €', () => {
    const c = computeAliCosts(4.79, true);
    expect(c.shipping).toBe(1.99);
    expect(c.customs).toBe(3.57);
    expect(c.totalCost).toBeCloseTo(10.35, 10);
  });

  test('Ware ab 10,00 € ohne Versand: 9,99 mit, 10,00 ohne (Schwelle ist "ab 10,00")', () => {
    expect(computeAliCosts(9.99, true).shipping).toBe(1.99);
    expect(computeAliCosts(10, true).shipping).toBe(0);
    expect(computeAliCosts(10, true).totalCost).toBeCloseTo(13.57, 10);
  });

  test('Ware 10,29 € (Bestellung 27.08.): Nebenkosten nur 3,57 → Ali Gesamt 13,86 € wie im Beleg', () => {
    expect(computeAliCosts(10.29, true).totalCost).toBeCloseTo(13.86, 10);
  });

  test('K-004: nicht China (EU-Lager): weder Einfuhrabgaben noch Versand — K = Ware', () => {
    const c = computeAliCosts(4.79, false);
    expect(c.customs).toBe(0);
    expect(c.shipping).toBe(0);
    expect(c.totalCost).toBeCloseTo(4.79, 10);
    expect(computeAliCosts(8.99, false).totalCost).toBeCloseTo(8.99, 10); // K-004-Pflichttest "EU: Ware 8,99 → Kosten 8,99"
  });

  test('die Produktfelder shippingCost/CHINA_ZOLL_EUR fließen nicht mehr ein: computeMinSellPrice ignoriert fremde Felder und liefert K aus computeAliCosts', () => {
    const r = computeMinSellPrice({
      buyPrice: 3.15, isChinaOrigin: true, ...FEES, adRatePercent: 5, targetMarginEur: 2, safetyBufferEur: 0, rounding: 'none',
      // @ts-expect-error — alte Felder gibt es nicht mehr; ein versehentlich übergebener Wert darf das Ergebnis nicht ändern
      supplierShipping: 99, customsFlat: 99,
    });
    expect(r.totalCost).toBeCloseTo(8.71, 10);
    expect(r.shipping).toBe(1.99);
    expect(r.customs).toBe(3.57);
  });
});

describe('profitFloorFor — Boden je Stufe', () => {
  test.each([[1.00, 1.00], [1.50, 1.20], [2.00, 1.30], [3.00, 1.50], [4.50, 2.00]])('Ziel %f → Boden %f', (t, floor) => {
    expect(profitFloorFor(t)).toBe(floor);
  });
  test('unbekannter Zielgewinn (z. B. 5,00 oder 4,00 aus alten Importen) → 1,00 € (nie Gewinn unter 1,00 €)', () => {
    expect(profitFloorFor(5)).toBe(1.00);
    expect(profitFloorFor(4)).toBe(1.00);
  });
});

describe('computeMinSellPrice mit Rundung "floor95" — Beispiele der Übergabe, frisch nachgerechnet (Anzeige 5 %)', () => {
  test('Ware 3,15 · Stufe B (1,50/1,20): Roh 13,8675 → 13,95 → Gewinn 1,5629', () => {
    const r = v2Price(3.15, 1.5);
    expect(r.raw).toBeCloseTo(13.8675, 4);
    expect(r.price).toBe(13.95);
    expect(r.profit).toBeCloseTo(1.5629, 4);
  });

  test('Ware 3,39 · Stufe B: Roh 14,1824 → 13,95 → Gewinn 1,3229 (≥ Boden 1,20)', () => {
    const r = v2Price(3.39, 1.5);
    expect(r.raw).toBeCloseTo(14.1824, 4);
    expect(r.price).toBe(13.95);
    expect(r.profit).toBeCloseTo(1.3229, 4);
  });

  test('Ware 4,79 · Stufe B: Roh 16,0197 → 15,95 → Gewinn 1,4469', () => {
    const r = v2Price(4.79, 1.5);
    expect(r.raw).toBeCloseTo(16.0197, 4);
    expect(r.price).toBe(15.95);
    expect(r.profit).toBeCloseTo(1.4469, 4);
  });

  test('Ware 5,89 · Stufe B: Roh 17,4633 → 16,95 wäre nur 1,1089 < Boden 1,20 → 17,95 → Gewinn 1,8709', () => {
    const r = v2Price(5.89, 1.5);
    expect(r.raw).toBeCloseTo(17.4633, 4);
    expect(r.price).toBe(17.95);
    expect(r.profit).toBeCloseTo(1.8709, 4);
    // Beweis, dass die 16,95 den Boden tatsächlich verletzt hätten (sonst prüft der Test die Boden-Schleife nicht):
    expect(profitAtSellPrice({ sellPrice: 16.95, buyPrice: 5.89, isChinaOrigin: true, ...FEES, adRatePercent: 5 })).toBeCloseTo(1.1089, 4);
  });

  test('Ware 4,79 · Stufe D (3,00/1,50): Roh 17,9882 → 17,95 → Gewinn 2,9709', () => {
    const r = v2Price(4.79, 3.0);
    expect(r.raw).toBeCloseTo(17.9882, 4);
    expect(r.price).toBe(17.95);
    expect(r.profit).toBeCloseTo(2.9709, 4);
  });

  // Nachtrag 1, Abschnitt 4 — Stufe C (2,00/1,30). Dieser Fall unterscheidet die neue Rundung von der alten
  // ("nearest95" ergäbe hier 14,95): Roh 14,5236 liegt ÜBER 14,5, die ,95 UNTER dem Rohpreis ist 13,95.
  test('Ware 3,15 · Stufe C: Roh 14,5236 → 13,95 (nicht 14,95) → Gewinn 1,5629 ≥ Boden 1,30 → "Ziel 2,00 · Erwartet 1,56"', () => {
    const r = v2Price(3.15, 2.0);
    expect(r.raw).toBeCloseTo(14.5236, 4);
    expect(r.price).toBe(13.95);
    expect(r.profit).toBeCloseTo(1.5629, 4);
    const alt = computeMinSellPrice({
      buyPrice: 3.15, isChinaOrigin: true, ...FEES, adRatePercent: 5, targetMarginEur: 2, safetyBufferEur: 0, rounding: 'nearest95',
    }).minSellPrice;
    expect(alt).toBe(14.95); // Gegenprobe: so rundete die alte Regel
    const display = evaluateTargetDisplay(2.0, r.profit);
    expect(display.expectedEur).toBe(1.56);
    expect(display.level).toBe('yellow');
  });

  test('Stufen A–D bei Ware 3,15: 13,95 / 13,95 / 13,95 / 14,95; ausgeblendete 4,50 → 16,95; unbekannt 5,00 → 17,95', () => {
    expect([1.0, 1.5, 2.0, 3.0, 4.5, 5.0].map(t => v2Price(3.15, t).price)).toEqual([13.95, 13.95, 13.95, 14.95, 16.95, 17.95]);
  });

  test('Anzeige nur wenn beworben: Ware 3,15 · Stufe C ohne Anzeige (0 %) → 12,95 (Roh 13,4717), mit 5 % → 13,95', () => {
    const ohne = v2Price(3.15, 2.0, { ad: 0 });
    expect(ohne.raw).toBeCloseTo(13.4717, 4);
    expect(ohne.price).toBe(12.95);
    expect(ohne.profit).toBeCloseTo(1.5714, 4);
    expect(v2Price(3.15, 2.0, { ad: 5 }).price).toBe(13.95);
  });

  test('Ware 12,00 (≥ 10, kein Versand): China 22,95 (K 15,57) · EU 17,95 (K 12,00)', () => {
    expect(v2Price(12, 2.0, { china: true }).price).toBe(22.95);
    expect(v2Price(12, 2.0, { china: true }).totalCost).toBeCloseTo(15.57, 10);
    expect(v2Price(12, 2.0, { china: false }).price).toBe(17.95);
    expect(v2Price(12, 2.0, { china: false }).totalCost).toBeCloseTo(12.0, 10);
  });

  // Folge der Annahme "Versand frei ab 10,00 €" (1 Beleg): die Preiskurve macht an der Schwelle einen Sprung nach UNTEN.
  // Dokumentiert, nicht korrigiert — offene Inhaber-Entscheidung (siehe PR-Beschreibung).
  test('Schwelle 10,00: Ware 9,99 → 22,95 €, Ware 10,00 → 19,95 € (Sprung nach unten wegen entfallendem Versand)', () => {
    expect(v2Price(9.99, 1.0).price).toBe(22.95);
    expect(v2Price(10, 1.0).price).toBe(19.95);
  });

  test('Eigenschaft über Ware 1,00–60,00 € (1-Cent-Schritte) und alle Stufen inkl. 4,50: Preis endet auf ,95, Gewinn nie unter Boden, nie unter 1,00 €', () => {
    const floors: Record<number, number> = { 1: 1.0, 1.5: 1.2, 2: 1.3, 3: 1.5, 4.5: 2.0 };
    let violations = 0;
    let minHeadroom = Infinity;
    for (let cents = 100; cents <= 6000; cents++) {
      const ware = cents / 100;
      for (const t of [1, 1.5, 2, 3, 4.5]) {
        const r = v2Price(ware, t);
        const floor = floors[t];
        if (Math.round(r.price * 100) % 100 !== 95) violations++;
        if (r.profit < floor - 1e-9) violations++;
        if (r.profit < 1.0 - 1e-9) violations++;
        minHeadroom = Math.min(minHeadroom, r.profit - floor);
      }
    }
    expect(violations).toBe(0);
    expect(minHeadroom).toBeGreaterThanOrEqual(0);
  });

  test('roundToProfitFloor: ,95 unter dem Rohpreis; exakt auf der Marke bleibt sie (kein Gleitkomma-Rauschen); Boden hebt in ganzen Euro an', () => {
    expect(roundToProfitFloor(13.8675, p => p * 0.762 - 0.357 - 8.71, 1.2)).toBe(13.95);
    expect(roundToProfitFloor(14.95, () => 10, 1)).toBe(14.95);
    expect(roundToProfitFloor(14.950000000000001, () => 10, 1)).toBe(14.95);
    expect(roundToProfitFloor(14.5, p => (p === 13.95 ? 0.5 : 5), 1)).toBe(14.95);
  });
});

describe('Gewinn(VK) gegen die 16 echten Verkäufe (12.08.–03.10.2026) — Abweichung ≤ 0,20 € je Verkauf', () => {
  // Quelle: Sheet "KALKULATOR – Gegencheck Bestellungen (01.10.2026)" (15 Verkäufe) + P1b-Nachprüfung (Verkauf 16, 03.10.).
  // Ware = Ali Gesamt − Ali-Nebenkosten (Spalte H); die Zellen "03.03"/"04.03"/"09.08" des Sheets sind Datumsformat-Artefakte
  // für 3,03 / 4,03 / 9,08 (gegengeprüft: Einnahmen = VK − Gebühr, z. B. 14,95 − 3,03 = 11,92). Anzeige 5 % bzw. 0 %
  // aus der eBay-Gebühr je Verkauf abgeleitet: ohne Anzeige ist Gebühr = (VK × 15 % + 0,30) × 1,19, mit Anzeige kommt
  // VK × 5 % × 1,19 hinzu. shipsFrom wird für alle als China angenommen (Nebenkosten 5,5 € passen dazu).
  // "echt" = Einnahmen (eBay) − Ali Gesamt.
  type Sale = { nr: string; sku: string; vk: number; ware: number; anzeige: 0 | 5; echt: number; nebenkosten: number };
  const SALES: Sale[] = [
    { nr: '09-15210-97703', sku: 'stele-123-50PCS', vk: 17.95, ware: 5.99, anzeige: 5, echt: 1.79, nebenkosten: 5.57 },
    { nr: '26-15134-85187', sku: 'stele-119-100PCS', vk: 13.95, ware: 2.45, anzeige: 5, echt: 2.30, nebenkosten: 5.51 },
    { nr: '20-15127-76586', sku: 'stele-119-200PCS', vk: 14.95, ware: 3.59, anzeige: 5, echt: 1.95, nebenkosten: 5.49 },
    { nr: '02-15151-11415', sku: 'stele-98-WHITE-1PCS', vk: 4.99, ware: 4.99, anzeige: 0, echt: -6.81, nebenkosten: 5.56 },
    { nr: '10-15108-86230', sku: 'stele-127-MC-100PCS', vk: 14.95, ware: 2.95, anzeige: 0, echt: 6.98, nebenkosten: 1.99 },
    { nr: '02-15114-51502', sku: 'stele-127-MC-100PCS', vk: 14.95, ware: 3.05, anzeige: 0, echt: 3.31, nebenkosten: 5.56 },
    { nr: '24-15076-13627', sku: 'stele-127-MC-500PCS', vk: 8.95, ware: 10.29, anzeige: 5, echt: -7.36, nebenkosten: 3.57 },
    { nr: '13-15069-00183', sku: 'stele-93-OILS-15PCS', vk: 12.95, ware: 12.29, anzeige: 5, echt: -2.80, nebenkosten: 0.00 },
    { nr: '05-15078-66637', sku: 'stele-119-100PCS', vk: 14.49, ware: 2.35, anzeige: 5, echt: 2.81, nebenkosten: 5.51 },
    { nr: '26-15037-39927', sku: 'stele-119-100PCS', vk: 14.49, ware: 2.35, anzeige: 5, echt: 2.81, nebenkosten: 5.51 },
    { nr: '07-15070-97464', sku: 'stele-127-MC-100PCS', vk: 14.95, ware: 2.12, anzeige: 0, echt: 9.47, nebenkosten: 0.33 },
    { nr: '25-15027-66809', sku: 'stele-119-100PCS', vk: 14.49, ware: 2.39, anzeige: 5, echt: 2.77, nebenkosten: 5.51 },
    { nr: '10-15051-70754', sku: 'stele-119-200PCS', vk: 15.44, ware: 3.09, anzeige: 5, echt: 2.82, nebenkosten: 5.50 },
    { nr: '09-15052-35592', sku: 'stele-119-200PCS', vk: 15.44, ware: 3.15, anzeige: 5, echt: 2.76, nebenkosten: 5.50 },
    { nr: '12-15018-06429', sku: 'stele-119-200PCS', vk: 15.44, ware: 3.15, anzeige: 5, echt: 2.76, nebenkosten: 5.50 },
    { nr: '05-15256-08140', sku: 'stele-119-200PCS', vk: 14.95, ware: 4.79, anzeige: 5, echt: 0.78, nebenkosten: 5.46 },
  ];
  // Diese 3 Verkäufe haben Ali-Nebenkosten, die NICHT dem Kostenmodell entsprechen (1,99 / 0,00 / 0,33 statt ≈ 5,56) —
  // vom Auftrag als "Rabatt-Fälle ausgenommen" gedacht; ob es tatsächlich Rabatte sind, ist NICHT belegt (Aufschlüsselung der
  // AliExpress-Seite fehlt), deshalb hier nur als "weicht vom Kostenmodell ab" geführt.
  const AUSGENOMMEN = new Set(['10-15108-86230', '13-15069-00183', '07-15070-97464']);
  const formelGewinn = (s: Sale) => profitAtSellPrice({
    sellPrice: s.vk, buyPrice: s.ware, isChinaOrigin: true, ...FEES, adRatePercent: s.anzeige,
  });

  test('16 Verkäufe erfasst, davon 13 im Kostenmodell', () => {
    expect(SALES.length).toBe(16);
    expect(SALES.filter(s => !AUSGENOMMEN.has(s.nr)).length).toBe(13);
  });

  test('alle 13 Verkäufe im Kostenmodell: |Formel − echt| ≤ 0,20 € (größte Abweichung 0,10 €)', () => {
    let maxDiff = 0;
    for (const s of SALES.filter(x => !AUSGENOMMEN.has(x.nr))) {
      const diff = Math.abs(formelGewinn(s) - s.echt);
      maxDiff = Math.max(maxDiff, diff);
      expect(diff).toBeLessThanOrEqual(0.20);
    }
    expect(maxDiff).toBeLessThan(0.11);
  });

  test('letzter Verkauf (03.10., stele-119 200pcs): App zeigte 4,30 €, Formel v2 ergibt 0,68 €, echt 0,78 €', () => {
    const s = SALES[15];
    expect(formelGewinn(s)).toBeCloseTo(0.68, 2);
    expect(s.echt).toBe(0.78);
  });

  test('die 3 ausgenommenen Verkäufe weichen tatsächlich um mehr als 3 € ab (Ausnahme ist begründet, nicht bequem)', () => {
    for (const s of SALES.filter(x => AUSGENOMMEN.has(x.nr))) {
      expect(Math.abs(formelGewinn(s) - s.echt)).toBeGreaterThan(3);
    }
  });

  test('Ware aus Gesamt − Nebenkosten ist konsistent mit den Sheet-Spalten (Plausibilitätsprüfung der Transkription)', () => {
    // Ali Gesamt laut Sheet: Spalte G; Ware = G − H.
    const aliGesamt = [11.56, 7.96, 9.08, 10.55, 4.94, 8.61, 13.86, 12.29, 7.86, 7.86, 2.45, 7.90, 8.59, 8.65, 8.65, 10.25];
    SALES.forEach((s, i) => expect(Math.round((aliGesamt[i] - s.nebenkosten) * 100) / 100).toBe(s.ware));
  });
});

describe('evaluatePriceAlarm — Alarm nur bei Gewinn UNTER DEM BODEN der Stufe (A-014)', () => {
  const alarm = (cur: number | null, ware: number, t: number) => evaluatePriceAlarm({
    currentSellPrice: cur, variants: [{ buyPrice: ware }], isChinaOrigin: true, ...FEES, adRatePercent: 5, targetMarginEur: t,
  });

  test('VK 13,95 bei Ware 3,15, Stufe C: Gewinn 1,5629 liegt unter dem Ziel 2,00, aber über dem Boden 1,30 → KEIN Alarm (gelb, nicht rot)', () => {
    const r = alarm(13.95, 3.15, 2);
    expect(r.isAlarm).toBe(false);
    expect(r.worstProfit).toBeCloseTo(1.5629, 4);
  });

  test('VK 11,95 bei Ware 3,15, Stufe C: Gewinn 0,0389 < Boden 1,30 → Alarm', () => {
    const r = alarm(11.95, 3.15, 2);
    expect(r.isAlarm).toBe(true);
    expect(r.worstProfit).toBeCloseTo(0.0389, 4);
  });

  test('VK 11,95 bei Ware 3,39: Verlust (−0,2011) → Alarm; kein VK → kein Alarm', () => {
    expect(alarm(11.95, 3.39, 2).worstProfit).toBeCloseTo(-0.2011, 4);
    expect(alarm(11.95, 3.39, 2).isAlarm).toBe(true);
    expect(alarm(null, 3.15, 2)).toEqual({ isAlarm: false, worstProfit: null });
  });
});

describe('evaluateTargetDisplay — "Ziel <Stufe> · Erwartet <echter Gewinn>"', () => {
  test('grün: Erwartet ≥ Ziel; gelb: Erwartet < Ziel; rot: Erwartet < Boden', () => {
    expect(evaluateTargetDisplay(2, 2.0).level).toBe('ok');
    expect(evaluateTargetDisplay(1.5, 1.87).level).toBe('ok');
    expect(evaluateTargetDisplay(2, 1.56).level).toBe('yellow');
    expect(evaluateTargetDisplay(2, 1.29).level).toBe('red');
  });

  test('genau auf dem Boden ist gelb, nicht rot; 1,2999 zählt auf Cent gerundet als 1,30 (kein Rauschen-Alarm)', () => {
    expect(evaluateTargetDisplay(2, 1.3).level).toBe('yellow');
    expect(evaluateTargetDisplay(2, 1.2999).level).toBe('yellow');
    expect(evaluateTargetDisplay(2, 1.2999).expectedEur).toBe(1.3);
  });

  test('liefert Ziel, Boden und auf Cent gerundeten Erwartungswert', () => {
    expect(evaluateTargetDisplay(2, 1.5629)).toEqual({ targetEur: 2, expectedEur: 1.56, floorEur: 1.3, level: 'yellow' });
  });
});

describe('applyRaiseOnly mit Boden-Gate (price-monitor / check-all-prices, A-014)', () => {
  test('Gewinn beim aktuellen Preis NICHT unter Boden (belowFloor=false) → nichts anheben, auch wenn der Formelpreis höher ist', () => {
    expect(applyRaiseOnly(13.95, 14.95, false)).toEqual({ action: 'none', price: 13.95, wasBelowBreakEven: false, isInitialPrice: false });
  });

  test('Gewinn unter Boden (belowFloor=true) → sofort anheben, ungedeckelt', () => {
    expect(applyRaiseOnly(11.95, 13.95, true)).toEqual({ action: 'raise', price: 13.95, wasBelowBreakEven: true, isInitialPrice: false });
  });

  test('ohne Angabe bleibt das bisherige Verhalten (anheben, sobald der berechnete Preis höher ist)', () => {
    expect(applyRaiseOnly(13.95, 14.95).action).toBe('raise');
  });

  test('Erst-Setzung (kein bisheriger Preis) wird nie durch das Gate blockiert; Senken passiert nie', () => {
    expect(applyRaiseOnly(null, 13.95, false).action).toBe('raise');
    expect(applyRaiseOnly(23.95, 10.95, true).action).toBe('none');
  });
});

describe('computeVariantSellPrices unter Formel v2 (Anker = teuerste Variante, Gleich-Gewinn, Rundung floor95 mit Boden der Stufe)', () => {
  const stele110Eks = [7.69, 4.99, 4.19, 3.35, 2.55, 2.15];
  const variants = stele110Eks.map((ek, i) => ({ skuId: `stele-110-v${i + 1}`, buyPrice: ek }));
  const plan = (isChinaOrigin: boolean, anchorSellPrice = 19.95, targetMarginEur = 2) => computeVariantSellPrices({
    variants, anchorSellPrice, isChinaOrigin, ...FEES, adRatePercent: 5, targetMarginEur,
  });

  test('stele-110 (China, Anker 19,95): 19,95 / 16,95 / 15,95 / 13,95 / 12,95 / 12,95 — der Ankergewinn 1,5949 liegt unter dem Ziel 2,00, also gilt das Ziel', () => {
    const p = plan(true);
    expect(p.rows.map(r => r.sellPrice)).toEqual([19.95, 16.95, 15.95, 13.95, 12.95, 12.95]);
    expect(p.anchorSkuId).toBe('stele-110-v1');
    expect(p.anchorProfit).toBeCloseTo(1.5949, 4);
    expect(p.targetProfitSource).toBe('targetMargin');
    expect(p.targetProfit).toBe(2);
  });

  test('Befund neu nachgerechnet: beim Einheitspreis 19,95 € ergibt Formel v2 Gewinne von 1,5949 € (teuerste) bis 7,1349 € (billigste Variante)', () => {
    const profits = stele110Eks.map(ek => profitAtSellPrice({ sellPrice: 19.95, buyPrice: ek, isChinaOrigin: true, ...FEES, adRatePercent: 5 }));
    expect(profits.map(p => Math.round(p * 10000) / 10000)).toEqual([1.5949, 4.2949, 5.0949, 5.9349, 6.7349, 7.1349]);
  });

  test('keine Variante fällt unter den Boden der Stufe C (1,30 €)', () => {
    for (const row of plan(true).rows) expect(row.profit).toBeGreaterThanOrEqual(1.30 - 1e-9);
    for (const row of plan(false).rows) expect(row.profit).toBeGreaterThanOrEqual(1.30 - 1e-9);
  });

  test('Herkunft EU (keine Einfuhrabgaben) ergibt andere Preise: 19,95 / 15,95 / 14,95 / 13,95 / 12,95 / 11,95', () => {
    expect(plan(false).rows.map(r => r.sellPrice)).toEqual([19.95, 15.95, 14.95, 13.95, 12.95, 11.95]);
  });

  test('Anker behält EXAKT den heutigen Preis (20,00, keine Nachrundung); die billigere Variante 12,95', () => {
    const p = computeVariantSellPrices({
      variants: [{ skuId: 'a', buyPrice: 7.69 }, { skuId: 'b', buyPrice: 2.15 }],
      anchorSellPrice: 20.00, isChinaOrigin: true, ...FEES, adRatePercent: 5, targetMarginEur: 2.00,
    });
    expect(p.rows.map(r => r.sellPrice)).toEqual([20, 12.95]);
    expect(p.rows[0].isAnchor).toBe(true);
    expect(p.anchorProfit).toBeCloseTo(1.633, 3);
  });

  test('harte Schranke: kein Variantenpreis über dem heutigen sellPrice (19,50 bei zwei gleich teuren Varianten)', () => {
    const p = computeVariantSellPrices({
      variants: [{ skuId: 'a', buyPrice: 7.69 }, { skuId: 'b', buyPrice: 7.69 }],
      anchorSellPrice: 19.50, isChinaOrigin: true, ...FEES, adRatePercent: 5, targetMarginEur: 2.00,
    });
    expect(p.rows[1].sellPrice).toBe(19.50);
    expect(p.rows[1].limitedByAnchorPrice).toBe(true);
    for (const row of p.rows) expect(row.sellPrice).toBeLessThanOrEqual(19.50);
  });

  test('Anker verkauft mit Verlust (EK 15,00 bei VK 19,95 → −3,7251): Ziel 2,00 gilt, Anker behält den Preis, die andere Variante rechnet auf 12,95', () => {
    const p = computeVariantSellPrices({
      variants: [{ skuId: 'a', buyPrice: 15.00 }, { skuId: 'b', buyPrice: 2.15 }],
      anchorSellPrice: 19.95, isChinaOrigin: true, ...FEES, adRatePercent: 5, targetMarginEur: 2.00,
    });
    expect(p.targetProfitSource).toBe('targetMargin');
    expect(p.anchorProfit).toBeCloseTo(-3.7251, 4);
    expect(p.rows.map(r => r.sellPrice)).toEqual([19.95, 12.95]);
  });

  test('leere Variantenliste ergibt einen leeren Plan statt eines Absturzes', () => {
    const p = computeVariantSellPrices({
      variants: [], anchorSellPrice: 19.95, isChinaOrigin: false, ...FEES, adRatePercent: 5, targetMarginEur: 2.00,
    });
    expect(p.rows).toEqual([]);
  });
});

describe('Varianten-Regel 6c (nur vorbereitet, im Betrieb AUS)', () => {
  const rows = evaluateVariantRule6c({
    variants: [
      { skuId: 'unter-boden', buyPrice: 3.15, currentSellPrice: 11.95 },
      { skuId: 'ueber-boden', buyPrice: 4.79, currentSellPrice: 19.95 },
      { skuId: 'ohne-preis', buyPrice: 3.15, currentSellPrice: null },
    ],
    isChinaOrigin: true, ...FEES, adRatePercent: 5, targetMarginEur: 2,
  });

  test('Variante unter dem Boden (Gewinn 0,0389 < 1,30) wird auf den Formelpreis 13,95 angehoben', () => {
    expect(rows[0].action).toBe('raise');
    expect(rows[0].profitAtCurrent).toBeCloseTo(0.0389, 4);
    expect(rows[0].newSellPrice).toBe(13.95);
  });

  test('Variante über dem Boden (Gewinn 4,4949) behält ihren Preis — keine Erhöhung über die Formel', () => {
    expect(rows[1].action).toBe('keep');
    expect(rows[1].newSellPrice).toBe(19.95);
    expect(rows[1].profitAtCurrent).toBeCloseTo(4.4949, 4);
  });

  test('Variante ohne gespeicherten VK bleibt unberührt', () => {
    expect(rows[2]).toEqual({ skuId: 'ohne-preis', currentSellPrice: null, profitAtCurrent: null, action: 'keep', newSellPrice: null });
  });
});
