// K-005 Punkt 1, Weg b (Inhaber 14.10.2026): Kassen-Faktor je Produkt = Kassenpreis ÷ App-Preis (AliExpress-DS-API).
// Die DS-API liefert teils höhere Preise als die Kasse (stele-97 Jasmine 13,79 statt 12,59, stele-220 schwarz 12,19 statt 11,59);
// die Kasse ist vom Server nicht lesbar (#169/#173 live geprüft). Deshalb: aus jeder AliExpress-Rechnung (Einkauf "Insgesamt"
// einer Bestellung) einen Faktor je Produkt ableiten und die App-Ware damit multiplizieren.
// Regeln des Inhabers: Faktor nie über 1,00 · älter als 14 Tage oder fehlend = ohne Faktor rechnen · automatisch nachjustiert.
// REINE Funktionen (Grundgesetz 2/8) — eine Stelle für Gültigkeit, Anwendung und Ableitung.
import { ALI_EINFUHR_EUR, ALI_VERSAND_EUR, ALI_VERSAND_FREI_AB_EUR } from './constants';

export const CHECKOUT_FACTOR_MAX_AGE_DAYS = 14;
export const CHECKOUT_FACTOR_MAX = 1.0;
// Plausibilitätsgrenze (Inhaber 14.10.2026, 20:50: "Grenze 0,85: ja"): ein Faktor unter 0,85 ist eher Eingabefehler/Rabattaktion als ein
// echter Dauer-Preisunterschied → wird nicht übernommen (Abgleich) UND nie angewendet (activeCheckoutFactor → ohne Faktor rechnen).
export const CHECKOUT_FACTOR_MIN_PLAUSIBLE = 0.85;

const DAY_MS = 24 * 60 * 60 * 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Gültiger Faktor oder null: 0,85 ≤ f ≤ 1 und Rechnungsdatum nicht älter als 14 Tage (und nicht in der Zukunft). */
export function activeCheckoutFactor(factor: number | null | undefined, at: string | null | undefined, now: Date = new Date()): number | null {
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < CHECKOUT_FACTOR_MIN_PLAUSIBLE - 1e-9 || factor > CHECKOUT_FACTOR_MAX + 1e-9) return null;
  if (!at) return null;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  const age = now.getTime() - t;
  if (age < -DAY_MS || age > CHECKOUT_FACTOR_MAX_AGE_DAYS * DAY_MS) return null;
  return factor;
}

/** Ware für die Formel: App-Preis × Faktor (auf Cent gerundet); ohne gültigen Faktor unverändert. */
export function applyCheckoutFactor(ware: number, factor: number | null | undefined): number {
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0 || factor >= 1) return ware;
  return Math.round(ware * factor * 100) / 100;
}

/**
 * Ware an der Kasse aus dem Rechnungsbetrag "Insgesamt" (eine Position, Menge 1): Einfuhr (China) und Versand
 * (China, Ware < 10 €) werden mit denselben Konstanten wie computeAliCosts herausgerechnet.
 * Hinweis: Rabatte/Münzen stecken im Rechnungsbetrag und lassen sich daraus nicht trennen (Faktor dann etwas niedriger).
 */
export function checkoutWareFromInvoiceTotal(total: number, isChinaOrigin: boolean, apiWareHint?: number): number {
  if (!isChinaOrigin) return total;
  // Zwischen 13,57 und 15,56 € ist der Betrag doppeldeutig: Ware ≥ 10 ohne Versand ODER Ware < 10 mit Versand. Beide Lesarten
  // werden nur genommen, wenn sie in sich stimmig sind; passen beide, entscheidet die Nähe zum App-Preis der Variante
  // (stele-220: 15,04, App 12,19 → 11,47 statt 9,48). Ohne Hinweis gilt "Ware ≥ 10" zuerst.
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const noShip = r2(total - ALI_EINFUHR_EUR);                    // stimmig, wenn ≥ 10
  const withShip = r2(total - ALI_EINFUHR_EUR - ALI_VERSAND_EUR); // stimmig, wenn < 10
  const noShipOk = noShip >= ALI_VERSAND_FREI_AB_EUR;
  const withShipOk = withShip < ALI_VERSAND_FREI_AB_EUR;
  if (noShipOk && withShipOk && typeof apiWareHint === 'number' && apiWareHint > 0) {
    return Math.abs(withShip - apiWareHint) < Math.abs(noShip - apiWareHint) ? withShip : noShip;
  }
  return noShipOk ? noShip : withShip;
}

export interface FactorOrderLine { sku: string | null; quantity: number }
export interface FactorOrder { orderId: string; orderDate: string; lineItems: FactorOrderLine[]; manualBuyPrice: number | null }
export interface FactorMatch { productId: number; apiWare: number; isChinaOrigin: boolean }
export interface DerivedFactor { productId: number; factor: number; at: string; orderId: string; checkoutWare: number; apiWare: number }
export interface SkippedFactor { orderId: string; reason: string }

/**
 * Aus Bestellungen mit erfasstem Einkauf (Rechnung) je Produkt den neuesten Faktor ableiten.
 * Nur eindeutige Fälle: genau eine Position, Menge 1, Produkt + Varianten-Preis bekannt. Faktor = min(1, Kasse ÷ API).
 */
export function deriveCheckoutFactors(
  orders: FactorOrder[],
  match: (sku: string | null) => FactorMatch | null,
): { factors: DerivedFactor[]; skipped: SkippedFactor[] } {
  const best = new Map<number, DerivedFactor>();
  const skipped: SkippedFactor[] = [];
  for (const o of orders) {
    if (o.manualBuyPrice == null || !(o.manualBuyPrice > 0)) continue;
    if (o.lineItems.length !== 1 || o.lineItems[0].quantity !== 1) { skipped.push({ orderId: o.orderId, reason: 'mehrere Positionen oder Menge > 1' }); continue; }
    const m = match(o.lineItems[0].sku);
    if (!m || !(m.apiWare > 0)) { skipped.push({ orderId: o.orderId, reason: 'Produkt/Variante oder App-Preis unbekannt' }); continue; }
    const checkoutWare = checkoutWareFromInvoiceTotal(o.manualBuyPrice, m.isChinaOrigin, m.apiWare);
    const raw = checkoutWare / m.apiWare;
    if (!(raw >= CHECKOUT_FACTOR_MIN_PLAUSIBLE)) { skipped.push({ orderId: o.orderId, reason: `Faktor ${r4(raw)} unplausibel (< ${CHECKOUT_FACTOR_MIN_PLAUSIBLE})` }); continue; }
    const factor = r4(Math.min(CHECKOUT_FACTOR_MAX, raw));
    const prev = best.get(m.productId);
    if (!prev || Date.parse(o.orderDate) > Date.parse(prev.at)) {
      best.set(m.productId, { productId: m.productId, factor, at: o.orderDate, orderId: o.orderId, checkoutWare, apiWare: m.apiWare });
    }
  }
  return { factors: [...best.values()], skipped };
}
