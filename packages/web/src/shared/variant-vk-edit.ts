// 050 P1 (Anlass stele-225, Inhaber 17.11. 07:34: +0,50 € je Variante): Verkaufspreis je Variante im Produkte-Tab von Hand setzen.
// REINE Funktionen (Grundgesetz 2/8): keine eigene Formel – Gewinn kommt aus productProfitRows (dieselbe Rechnung wie „Erwartet“
// und der Preiswächter). Gesendet wird über den bestehenden Weg POST /products/variant-reprice (Senken: 8-%-Bremse, Gewinn ≥ max(1,00; Ziel);
// Anheben: Sprung > 15 % abgelehnt) – diese Regeln werden hier NICHT nachgebaut, nur die Eingaben aufgeteilt.
import { productProfitRows, type ProfitProduct } from './target-margin-bulk';

/** Warnschwelle aus Auftrag 050 P1: Gewinn je Variante unter 0,50 € → rot markieren. */
export const MANUAL_VK_WARN_PROFIT_EUR = 0.5;

export interface VkEditRow {
  skuId: string;
  label: string;
  alt: number;
  neu: number;
  geaendert: boolean;
  gewinnAlt: number;
  gewinnNeu: number;
  warnung: boolean;
}

/** Eingabe-Text → Preis mit höchstens 2 Nachkommastellen, sonst null (Komma oder Punkt erlaubt). */
export function parseVkInput(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const v = Number(t);
  return v > 0 ? Math.round(v * 100) / 100 : null;
}

/** Gewinn je angebotener Variante beim heutigen und beim eingegebenen VK. Nicht angebotene Varianten (K-014) erscheinen nicht. */
export function planManualVk(product: ProfitProduct, edited: Readonly<Record<string, number>>): VkEditRow[] {
  const before = productProfitRows(product).rows.filter(r => r.skuId);
  let stored: Record<string, number> = {};
  try { stored = product.variantSellPrices ? JSON.parse(product.variantSellPrices) as Record<string, number> : {}; } catch { stored = {}; }
  const merged: Record<string, number> = { ...stored };
  for (const r of before) {
    const n = edited[r.skuId as string];
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) merged[r.skuId as string] = n;
  }
  const afterBySku = new Map(productProfitRows({ ...product, variantSellPrices: JSON.stringify(merged) }).rows.map(r => [r.skuId, r]));
  return before.map(r => {
    const after = afterBySku.get(r.skuId) ?? r;
    const neu = after.sellPrice;
    return {
      skuId: r.skuId as string,
      label: r.label,
      alt: r.sellPrice,
      neu,
      geaendert: Math.abs(neu - r.sellPrice) > 0.004,
      gewinnAlt: r.profit,
      gewinnNeu: after.profit,
      warnung: after.profit < MANUAL_VK_WARN_PROFIT_EUR - 1e-9,
    };
  });
}

/** Teilt die geänderten Zeilen in die beiden Aufrufe von /products/variant-reprice (eine Richtung je Aufruf). */
export function splitByDirection(rows: readonly VkEditRow[]): { up: Record<string, number>; down: Record<string, number> } {
  const up: Record<string, number> = {};
  const down: Record<string, number> = {};
  for (const r of rows) {
    if (!r.geaendert) continue;
    if (r.neu > r.alt) up[r.skuId] = r.neu; else down[r.skuId] = r.neu;
  }
  return { up, down };
}
