// Teil 2A+2B+2C (P-27/P-28-Preis-Fundament, 2026-09-10): EINE einzige Kalkulations-Quelle mit den
// real gemessenen Gebühren-Werten.
//
// Vorher gab es sieben (tatsächlich acht — ebay.ts's Varianten-Listing-Fallback wurde in der
// Teil-1-Bestandsaufnahme übersehen) unabhängige Formel-Stellen im Code, dazu drei verschiedene
// eBay-Gebühren-Annahmen (13% / 17% / 18%), keine traf die real gemessenen ~15% + 0,30 EUR.
// Teil 2A (reiner Struktur-Refactor, wertneutral) ersetzte die sieben-plus-eins unabhängigen
// Kopien der Rechenlogik durch Aufrufe derselben Funktion, ohne ein Rechenergebnis zu ändern —
// die abweichenden Gebühren-Annahmen blieben dabei absichtlich als von der Aufrufstelle
// übergebene Parameter erhalten. Teil 2B (diese Version) korrigiert DEFAULT_PRICING_CONFIG auf
// die real gemessenen Werte — da alle Aufrufstellen bereits auf DEFAULT_PRICING_CONFIG statt
// eigener Literale zeigen, wirkt sich die Korrektur überall gleichzeitig aus.
//
// Standort: `shared/`, weil sowohl Backend (price-monitor.ts, ebay.ts, index.ts) als auch
// Frontend (index.tsx, produkte.tsx, lieferanten.tsx) die Funktion brauchen — exakt der Grund,
// aus dem die Vorgänger-Version dieser Datei (P-27/P-28-Konsolidierung, 08.09.) hier lag. Der im
// Teil-2A-Auftrag vorgeschlagene Pfad `src/lib/pricing.ts` existiert in diesem Projekt nicht
// (nur `src/web/lib/`, ausschließlich Frontend) — `shared/pricing.ts` ist der bereits etablierte,
// von beiden Seiten importierbare Ort und wird hier in-place ersetzt statt eine zweite,
// parallele Datei anzulegen.

import { MIN_GEWINN_EUR, CHINA_ZOLL_EUR } from './constants';

export type RoundingMode = 'up95' | 'nearest95' | 'cent' | 'none';

// Rundet AUFWÄRTS zur nächsten ,95-Endung (P-11). Teil 2C (2026-09-10): keine produktive
// Aufrufstelle mehr — genau dieses "immer aufwärts" trug zur Zielgewinn-Abweichung bei (s.u.
// DEFAULT_PRICING_CONFIG-Kommentar). Bleibt exportiert für roundToNearest95()-Vergleichstests.
export function roundUpToX95(price: number): number {
  return Math.round((Math.ceil(price - 0.95) + 0.95) * 100) / 100;
}

// Rundet zur NÄCHSTEN ,95-Endung (auf oder ab) — P-74, bewusst anders als roundUpToX95: im
// manuellen Varianten-Import-Modal (lieferanten.tsx) darf der Preis auch knapp unter den
// berechneten Mindestpreis fallen.
export function roundToNearest95(price: number): number {
  const nearestInt = Math.round(price - 0.95);
  return Math.round((nearestInt + 0.95) * 100) / 100;
}

function applyRounding(price: number, mode: RoundingMode): number {
  switch (mode) {
    case 'up95': return roundUpToX95(price);
    case 'nearest95': return roundToNearest95(price);
    case 'cent': return Math.ceil(price * 100) / 100;
    case 'none': return price;
  }
}

// Alle Eingaben sind PFLICHT — bewusst keine Default-Werte in dieser Datei (Teil-2A-Vorgabe).
// Defaults für die "echte" Formel (Gebührensatz, Fixbetrag, Mindestgewinn, Sicherheitspuffer,
// China-Zollpauschale) leben separat in DEFAULT_PRICING_CONFIG weiter unten. Der Preise-Tab-
// Verhandlungsrechner übergibt weiterhin einen eigenen, dort frei editierbaren Gebührensatz
// (Default jetzt ebenfalls 15%, siehe index.tsx) statt DEFAULT_PRICING_CONFIG direkt — bewusst so
// belassen, weil dieser Rechner explizit auch mit hypothetischen/abweichenden Sätzen rechnen
// können soll (z.B. um ein Käufer-Gegenangebot bei einem angenommenen anderen Gebührensatz zu
// prüfen), nicht weil der Wert falsch wäre.
export interface PricingInput {
  buyPrice: number;          // Einkaufspreis
  supplierShipping: number;  // Versandkosten Lieferant
  isChinaOrigin: boolean;    // Herkunft: China (Zoll wird angesetzt) oder EU/sonstige (kein Zoll)
  customsFlat: number;       // Zollpauschale — wird nur angesetzt, wenn isChinaOrigin=true
  ebayFeeRatePercent: number; // eBay-Gebührensatz in % (Default 15, siehe DEFAULT_PRICING_CONFIG)
  ebayFixedFeeEur: number;    // eBay-Fixbetrag in EUR, netto (vor MwSt)
  vatFactor: number;          // MwSt-Faktor (z.B. 1.19 = 19% MwSt.)
  adRatePercent: number;      // Anzeigentarif in % (Promoted Listings)
  targetMarginEur: number;    // Zielmarge/Mindestgewinn in EUR
  safetyBufferEur: number;    // zusätzlicher Sicherheitspuffer in EUR (0, wenn an dieser Stelle nicht verwendet)
  rounding: RoundingMode;     // Rundungsmodus für minSellPrice
}

export interface PricingResult {
  totalCost: number;         // buyPrice + supplierShipping + customs
  customs: number;           // tatsächlich angesetzter Zollbetrag (0 oder customsFlat)
  baseFeeRateGross: number;  // ebayFeeRatePercent/100 × vatFactor — OHNE Anzeigentarif
  totalFeeRateGross: number; // (ebayFeeRatePercent + adRatePercent)/100 × vatFactor — MIT Anzeigentarif
  fixedFeeGross: number;     // ebayFixedFeeEur × vatFactor
  rawMinSellPrice: number;   // Mindest-Verkaufspreis vor Rundung
  minSellPrice: number;      // Mindest-Verkaufspreis nach `rounding`
}

// Die eine zentrale Kalkulationsfunktion (Teil-2A-Vorgabe: "genau eine exportierte
// Kalkulationsfunktion"). Berechnet den Mindest-Verkaufspreis aus den Kosten-Eingaben; das
// Ergebnis enthält zusätzlich die Zwischenwerte (Gebührensätze, Fixbetrag, Gesamtkosten), damit
// Aufrufstellen, die NICHT direkt einen Mindestpreis brauchen, sondern z.B. bei einem gegebenen
// Verkaufspreis die Marge/Gebühren zeigen wollen (Preise-Tab-Verhandlungsrechner,
// Produkte-Tab-Badge), dieselben Gebühren-Konstanten wiederverwenden können, statt sie ein
// zweites Mal selbst zu berechnen.
export function computeMinSellPrice(input: PricingInput): PricingResult {
  const customs = input.isChinaOrigin ? input.customsFlat : 0;
  const totalCost = input.buyPrice + input.supplierShipping + customs;
  const baseFeeRateGross = (input.ebayFeeRatePercent / 100) * input.vatFactor;
  const totalFeeRateGross = ((input.ebayFeeRatePercent + input.adRatePercent) / 100) * input.vatFactor;
  const fixedFeeGross = input.ebayFixedFeeEur * input.vatFactor;
  const rawMinSellPrice = (totalCost + input.targetMarginEur + input.safetyBufferEur + fixedFeeGross) / (1 - totalFeeRateGross);
  const minSellPrice = applyRounding(rawMinSellPrice, input.rounding);
  return { totalCost, customs, baseFeeRateGross, totalFeeRateGross, fixedFeeGross, rawMinSellPrice, minSellPrice };
}

// ─── Teil 3 (2026-09-13): Verkaufspreis JE VARIANTE ───────────────────────────────────────────
//
// Datenmodell (Auftragspunkt 1): der Verkaufspreis je Variante bekommt eine EIGENE Spalte
// `products.variant_sell_prices` (JSON-Map `{"<skuId>": 12.95}`, additive Migration, keine
// bestehende Spalte angefasst).
//
// Vorgeschichte, damit die Entscheidung nachvollziehbar bleibt: ein VK je Variante existierte
// faktisch schon als optionales Feld `ebayPrice` an den `variantPrices`-Einträgen — gelesen beim
// Listing (`ebay.ts:1299`), angezeigt (`produkte.tsx:1613`), beim Import geschrieben
// (`lieferanten.tsx:624`). Ich hatte deshalb zunächst vorgeschlagen, es dabei zu belassen; der
// Nutzer hat sich am 13.09.2026 ausdrücklich für die eigene Spalte entschieden. Vorteil der
// Spalte: der VK ist nicht mehr ein optionales Beiwerk der EINKAUFSpreis-Struktur, sondern ein
// eigenständiges, gezielt beschreibbares Feld — und `variantPrices` bleibt reine Lieferantendaten.
//
// DAMIT DARAUS KEINE ZWEITE KONKURRIERENDE WAHRHEIT WIRD, gilt eine feste Vorrang-Regel, die
// ausschließlich über resolveVariantSellPrice() angewandt werden darf:
//   1. `variant_sell_prices[skuId]` (neue Spalte) — gewinnt immer, wenn gesetzt
//   2. sonst `variantPrices[].ebayPrice` (Altbestand, für noch nicht migrierte Produkte)
//   3. sonst kein gespeicherter VK → die Aufrufstelle rechnet ihn über computeVariantSellPrices()
// Neue Schreibvorgänge befüllen ausschließlich (1). (2) wird nur noch gelesen, nie mehr neu
// geschrieben — so läuft der Altbestand aus, ohne dass etwas migriert werden muss.
export interface VariantPriceEntry {
  skuId: string;
  attrs?: Record<string, string>;
  price: number;           // EINKAUFSpreis der Variante (AliExpress) — Bestand, unverändert
  ebayPrice?: number;      // ALT: VK je Variante. Nur noch Lesequelle (Stufe 2), nicht mehr befüllen.
  originalPrice?: number;
  stock?: number;
  imageUrl?: string;
}

// Inhalt der Spalte `products.variant_sell_prices`: skuId → Verkaufspreis in EUR.
export type VariantSellPriceMap = Record<string, number>;

// Tolerantes Parsen: kaputtes/leeres JSON ergibt eine leere Map statt eines Absturzes — dieselbe
// Haltung wie bei variantPrices überall sonst im Projekt. Nicht-numerische Werte werden verworfen,
// damit ein einzelner Schrottwert nicht als Preis durchrutscht.
export function parseVariantSellPrices(json: string | null | undefined): VariantSellPriceMap {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: VariantSellPriceMap = {};
    for (const [skuId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[skuId] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeVariantSellPrices(rows: Array<{ skuId: string; sellPrice: number }>): string {
  const map: VariantSellPriceMap = {};
  for (const row of rows) map[row.skuId] = row.sellPrice;
  return JSON.stringify(map);
}

// Die EINE Stelle, an der die Vorrang-Regel oben angewandt wird. Jede Aufrufstelle, die den
// gespeicherten VK einer Variante braucht, muss hierüber gehen — nie direkt auf eines der beiden
// Felder zugreifen, sonst entstehen genau die konkurrierenden Quellen, die Teil 2A beseitigt hat.
export function resolveVariantSellPrice(
  skuId: string,
  stored: VariantSellPriceMap,
  legacyEntry?: { ebayPrice?: number } | null
): { sellPrice: number | null; source: 'column' | 'legacy' | 'none' } {
  const fromColumn = stored[skuId];
  if (typeof fromColumn === 'number' && Number.isFinite(fromColumn) && fromColumn > 0) {
    return { sellPrice: fromColumn, source: 'column' };
  }
  const legacy = legacyEntry?.ebayPrice;
  if (typeof legacy === 'number' && Number.isFinite(legacy) && legacy > 0) {
    return { sellPrice: legacy, source: 'legacy' };
  }
  return { sellPrice: null, source: 'none' };
}

export interface ProfitAtSellPriceInput {
  sellPrice: number;
  buyPrice: number;
  supplierShipping: number;
  isChinaOrigin: boolean;
  customsFlat: number;
  ebayFeeRatePercent: number;
  ebayFixedFeeEur: number;
  vatFactor: number;
  adRatePercent: number;
}

// Gewinn bei einem GEGEBENEN Verkaufspreis — die Umkehrung von computeMinSellPrice(), exakt die
// Formel aus dem Teil-3-Auftrag:
//   Gewinn = Preis − (Varianten-EK + Lieferantenversand + Zollpauschale)
//            − (Preis × (15% + adRate) × 1,19 + 0,30 × 1,19)
export function profitAtSellPrice(input: ProfitAtSellPriceInput): number {
  const customs = input.isChinaOrigin ? input.customsFlat : 0;
  const totalCost = input.buyPrice + input.supplierShipping + customs;
  const totalFeeRateGross = ((input.ebayFeeRatePercent + input.adRatePercent) / 100) * input.vatFactor;
  const fixedFeeGross = input.ebayFixedFeeEur * input.vatFactor;
  return input.sellPrice - totalCost - (input.sellPrice * totalFeeRateGross + fixedFeeGross);
}

export interface VariantSellPriceInput {
  variants: Array<{ skuId: string; buyPrice: number; attrs?: Record<string, string> }>;
  anchorSellPrice: number;    // heutiger Verkaufspreis des Produkts — den behält die teuerste Variante exakt
  supplierShipping: number;
  isChinaOrigin: boolean;
  customsFlat: number;
  ebayFeeRatePercent: number;
  ebayFixedFeeEur: number;
  vatFactor: number;
  adRatePercent: number;
  targetMarginEur: number;    // Untergrenze, falls der Ankergewinn darunter liegt
}

export interface VariantSellPriceRow {
  skuId: string;
  attrs: Record<string, string>;
  buyPrice: number;
  sellPrice: number;              // neuer Verkaufspreis dieser Variante
  profit: number;                 // Gewinn bei diesem Preis
  isAnchor: boolean;              // teuerste Variante — behält anchorSellPrice exakt
  limitedByAnchorPrice: boolean;  // Preis wurde auf anchorSellPrice gedeckelt (harte Schranke "nie erhöhen")
}

export interface VariantSellPricePlan {
  anchorSkuId: string;
  anchorSellPrice: number;
  anchorProfit: number;                          // Gewinn der teuersten Variante beim heutigen Preis
  targetProfit: number;                          // Zielgewinn für ALLE Varianten
  targetProfitSource: 'anchor' | 'targetMargin'; // welche der beiden Schranken gegriffen hat
  rows: VariantSellPriceRow[];
}

// Preisregel Teil 3 (Vorgabe des Nutzers, verbindlich):
// Anker ist die TEUERSTE Variante (höchster Einkaufspreis) — sie behält exakt den heutigen
// sellPrice. Der daraus resultierende Gewinn ist der Zielgewinn für ALLE Varianten dieses Produkts;
// jede andere Variante bekommt den Preis, der denselben Gewinn ergibt, gerundet mit
// roundToNearest95(). Zwei harte Schranken:
//   - kein Variantenpreis darf über dem heutigen sellPrice liegen (nie erhöhen)
//   - liegt der Ankergewinn unter targetMarginEur, gilt targetMarginEur als Untergrenze
//
// Wichtig (Befund aus dem Auftrag): die heutigen Gewinne liegen fast überall DEUTLICH über dem
// Zielgewinn (stele-110: 3,15 bis 8,69 €). Die Varianten dürfen deshalb ausdrücklich NICHT auf den
// über computeMinSellPrice() berechneten Mindestpreis gesetzt werden — das würde den Gewinn
// zerstören. Diese Funktion setzt sie stattdessen auf GLEICHEN GEWINN wie die Ankervariante.
//
// Die Umkehrrechnung (Preis für einen gegebenen Zielgewinn) ist rechnerisch identisch mit
// computeMinSellPrice(targetMarginEur = Zielgewinn, safetyBufferEur = 0) — deshalb wird bewusst
// dieselbe Funktion wiederverwendet statt die Formel ein zweites Mal zu schreiben (Teil-2A-Prinzip:
// genau eine Kalkulations-Quelle).
export function computeVariantSellPrices(input: VariantSellPriceInput): VariantSellPricePlan {
  if (input.variants.length === 0) {
    return {
      anchorSkuId: '', anchorSellPrice: input.anchorSellPrice, anchorProfit: 0,
      targetProfit: input.targetMarginEur, targetProfitSource: 'targetMargin', rows: [],
    };
  }

  const costContext = {
    supplierShipping: input.supplierShipping,
    isChinaOrigin: input.isChinaOrigin,
    customsFlat: input.customsFlat,
    ebayFeeRatePercent: input.ebayFeeRatePercent,
    ebayFixedFeeEur: input.ebayFixedFeeEur,
    vatFactor: input.vatFactor,
    adRatePercent: input.adRatePercent,
  };

  // Anker = teuerste Variante. Bei Gleichstand gewinnt die erste — deterministisch, damit zwei
  // Läufe über dieselben Daten nie unterschiedliche Pläne ergeben.
  const anchor = input.variants.reduce((best, v) => (v.buyPrice > best.buyPrice ? v : best), input.variants[0]);
  const anchorProfit = profitAtSellPrice({ ...costContext, sellPrice: input.anchorSellPrice, buyPrice: anchor.buyPrice });
  const targetProfit = Math.max(anchorProfit, input.targetMarginEur);
  const targetProfitSource: 'anchor' | 'targetMargin' = targetProfit === anchorProfit ? 'anchor' : 'targetMargin';

  const rows: VariantSellPriceRow[] = input.variants.map(v => {
    const attrs = v.attrs ?? {};
    // Die Ankervariante behält exakt den heutigen Preis — bewusst NICHT neu gerundet/gerechnet,
    // sonst würde die Vorgabe "behält exakt den heutigen sellPrice" durch die ,95-Rundung verfehlt.
    if (v.skuId === anchor.skuId) {
      return {
        skuId: v.skuId, attrs, buyPrice: v.buyPrice,
        sellPrice: input.anchorSellPrice,
        profit: anchorProfit,
        isAnchor: true, limitedByAnchorPrice: false,
      };
    }
    const computed = computeMinSellPrice({
      ...costContext,
      buyPrice: v.buyPrice,
      targetMarginEur: targetProfit,
      safetyBufferEur: 0,
      rounding: 'nearest95',
    }).minSellPrice;
    // Harte Schranke: nie über den heutigen sellPrice erhöhen.
    const limitedByAnchorPrice = computed > input.anchorSellPrice;
    const sellPrice = limitedByAnchorPrice ? input.anchorSellPrice : computed;
    return {
      skuId: v.skuId, attrs, buyPrice: v.buyPrice,
      sellPrice,
      profit: profitAtSellPrice({ ...costContext, sellPrice, buyPrice: v.buyPrice }),
      isAnchor: false, limitedByAnchorPrice,
    };
  });

  return {
    anchorSkuId: anchor.skuId,
    anchorSellPrice: input.anchorSellPrice,
    anchorProfit,
    targetProfit,
    targetProfitSource,
    rows,
  };
}

export interface DecreaseCapResult {
  price: number;           // finaler Preis (gedeckelt oder unverändert)
  wasCapped: boolean;      // true, wenn die Absenkung auf maxDecreasePercent begrenzt wurde
  uncappedPrice: number;   // der übergebene computedMinPrice, unverändert — für die Vorschau ("ohne Deckel wäre X herausgekommen")
}

// Teil 2D (2026-09-10, "Senkungsbremse"), Vorgabe des Nutzers: computeMinSellPrice() liefert eine
// UNTERGRENZE, keinen Zielpreis. Ohne Bremse würde ein automatischer Neuberechnungs-Lauf ein
// laufendes Angebot direkt auf diese Untergrenze herunterziehen (real beobachtet: stele-141
// 23,95€→10,95€, stele-110 20,95€→10,95€ — beides deutlich mehr als 8%). Das ANHEBEN bei zu
// niedrigem Preis bleibt bewusst uneingeschränkt (schützt vor Verlust, darf nie gedeckelt werden)
// — nur das Absenken wird pro Lauf auf maxDecreasePercent begrenzt.
//
// currentPrice fehlt (z.B. Erst-Listing, noch kein bisheriger Preis) → computedMinPrice
// unverändert, nichts zu deckeln. computedMinPrice >= currentPrice → Anheben, nie gedeckelt.
// Sonst: nicht tiefer als currentPrice × (1 − maxDecreasePercent/100) — das Ergebnis wird
// anschließend gerundet.
//
// Rundungs-Präzisierung gegenüber der wörtlichen Vorgabe ("das Ergebnis danach mit
// roundToNearest95() runden"): roundToNearest95() rundet auch ABWÄRTS — angewandt auf den
// Deckel-Grenzwert selbst kann das den gedeckelten Preis unter genau diesen Grenzwert drücken und
// damit die Bremse leicht überschreiten (Beispiel: currentPrice=23,95€, 8% → Grenzwert 22,034€ →
// roundToNearest95(22,034) = 21,95€ = 8,35% Absenkung, nicht 8%). Die Pflichtverifikation verlangt
// aber ausdrücklich "kein Produkt fällt in einem Lauf um mehr als 8 Prozent" — diese harte Grenze
// hat Vorrang vor der Rundungs-Vorgabe. Deshalb: erst mit roundToNearest95() runden (trifft in der
// Mehrzahl der Fälle ohnehin einen Wert ≥ Grenzwert), nur falls das Ergebnis DOCH unter den
// Grenzwert fällt, stattdessen mit roundUpToX95() runden (rundet garantiert aufwärts, verletzt die
// Bremse nie) — exakt dieselbe Zwei-Modi-Logik, die computeMinSellPrice() bereits kennt.
export function applyDecreaseCap(
  currentPrice: number | null | undefined,
  computedMinPrice: number,
  maxDecreasePercent: number
): DecreaseCapResult {
  if (currentPrice == null) {
    return { price: computedMinPrice, wasCapped: false, uncappedPrice: computedMinPrice };
  }
  if (computedMinPrice >= currentPrice) {
    return { price: computedMinPrice, wasCapped: false, uncappedPrice: computedMinPrice };
  }
  const floor = currentPrice * (1 - maxDecreasePercent / 100);
  if (computedMinPrice >= floor) {
    return { price: computedMinPrice, wasCapped: false, uncappedPrice: computedMinPrice };
  }
  const nearest = roundToNearest95(floor);
  const capped = nearest >= floor ? nearest : roundUpToX95(floor);
  return { price: capped, wasCapped: true, uncappedPrice: computedMinPrice };
}

// ─── Konstanten-Konfiguration (Teil-2A-Vorgabe: Defaults gehören hierher, nicht in die Funktion) ──
//
// Teil 2B (2026-09-10): Gebührensatz + Fixbetrag auf die real gemessenen Werte umgestellt — aus
// 13 realen Bestellungen (90 Tage) ermittelt: eBay-Verkaufsgebühr ≈ 15% + 0,30 € netto, brutto
// (0,15 × Preis + 0,30) × 1,19. Restunsicherheit ca. ±0,05 €. Der ×1,19-Schritt (MwSt-Faktor) war
// bereits vorher korrekt — bestätigt dadurch, dass ein konstanter 5%-Anzeigentarif real als 5,95%
// abgebucht wurde (5 × 1,19). Alle 8 Aufrufstellen aus Teil 2A lesen diese Werte bereits über
// DEFAULT_PRICING_CONFIG (keine eigenen Literale mehr) — die Korrektur wirkt sich also überall
// gleichzeitig aus, ohne dass an den Aufrufstellen selbst etwas geändert werden musste.
// Teil 2C (2026-09-10): safetyBufferEur auf 0 gesetzt. Vorher wurde PRICE_SAFETY_BUFFER_EUR
// (1,50€, shared/constants.ts) hier ZUSÄTZLICH zum Zielgewinn addiert, kombiniert mit der immer
// AUFWÄRTS rundenden roundUpToX95() (alle Aufrufstellen inzwischen auf roundToNearest95()
// umgestellt) — aus einem gewünschten 2,00€-Zielgewinn wurden dadurch real 3,50-4,25€. Die
// Konstante PRICE_SAFETY_BUFFER_EUR bleibt in shared/constants.ts definiert, wird aber ab hier
// von KEINER Kalkulation mehr referenziert (bewusst kein Import mehr in dieser Datei).
export const DEFAULT_PRICING_CONFIG = {
  ebayFeeRatePercent: 15,
  ebayFixedFeeEur: 0.30,
  vatFactor: 1.19,
  defaultAdRatePercent: 5,                    // DB-Default (schema.ts ad_rate.default(5))
  targetMarginEur: MIN_GEWINN_EUR,            // 2,00 € — globaler Fallback, wenn product.targetMarginEur null ist (Teil 2C)
  safetyBufferEur: 0,                         // Teil 2C: kein Sicherheitspuffer mehr, s.o.
  chinaCustomsFlatEur: CHINA_ZOLL_EUR,        // 4,00 €
} as const;

export function isChinaShipping(shipsFrom?: string | null): boolean {
  if (!shipsFrom) return false;
  return shipsFrom.toLowerCase().includes('china');
}

// Teil 2B (2026-09-10), SICHERHEITSKRITISCH: die neuen Gebühren-Konstanten (15%/0,30€) sind noch
// NICHT gegen einen vollen Preiszyklus mit echten Bestellungen bestätigt (nur gegen 13
// vergangene Bestellungen rückgerechnet, ±0,05€ Restunsicherheit). Bis zur manuellen Freigabe
// durch den Nutzer darf KEIN automatischer, unbeaufsichtigter Pfad einen mit der neuen Formel
// berechneten Verkaufspreis in die DB schreiben oder an eBay senden — nur die menschlich
// bestätigten Preview→Übernehmen-Abläufe (recalculate-preview/-apply, Erst-/Re-Listing,
// Varianten-Reparatur) bleiben aktiv, da dort vor jedem Schreibvorgang eine Vorschau mit den
// neuen Zahlen gezeigt wird. Betrifft konkret: price-monitor.ts checkOne() (8h-Cron, komplett
// unbeaufsichtigt) und index.ts POST /products/check-all-prices (schreibt+pusht ohne
// Zwischenschritt, sobald der Job läuft). Auf true setzen, sobald die neue Formel freigegeben ist.
export const AUTO_PRICE_WRITE_ENABLED = false;
