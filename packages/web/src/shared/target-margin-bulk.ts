// A-016: gemeinsame, REINE Bausteine für die Margen-Stufen A–D außerhalb von Rechnern — Gewinn-Zeilen je Produkt/Variante
// (vorher inline in produkte.tsx TargetBadge, jetzt EINE Quelle für Produkte-Tab und Listings-Tab, Grundgesetz Regel 8),
// Vorschau "was wird rot nach einem Stufenwechsel", Validierung des Sammel-Endpunkts und der Filter "neu eingestellt".
// Nichts hier schreibt an eBay oder in die DB.
import { MARGIN_TIERS } from './constants';
import {
  profitAtSellPrice, evaluateTargetDisplay, isChinaShipping,
  parseVariantSellPrices, resolveVariantSellPrice, DEFAULT_PRICING_CONFIG,
} from './pricing';

export interface ProfitProduct {
  id: number;
  targetMarginEur?: number | null;
  shipsFrom?: string | null;
  adRate: number | null;
  sellPrice: number | null;
  buyPrice: number | null;
  variantPrices: string | null;       // JSON [{skuId, attrs, price, ebayPrice?}]
  variantSellPrices?: string | null;  // JSON {skuId: VK}
}

export interface ProfitRow { label: string; profit: number }

export function productTarget(p: Pick<ProfitProduct, 'targetMarginEur'>): number {
  return p.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur;
}

// Gewinn beim heutigen VK je Variante (Varianten-Produkt: variant_sell_prices → alter ebayPrice → Produkt-VK) bzw. je
// Einzelartikel. Formel v2 über profitAtSellPrice. Zeilen ohne VK oder ohne Einkaufspreis fehlen (nichts geraten).
export function productProfitRows(p: ProfitProduct): { rows: ProfitRow[]; isVariant: boolean } {
  const china = isChinaShipping(p.shipsFrom);
  const adRate = p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
  const profitAt = (sellPrice: number, buyPrice: number) => profitAtSellPrice({
    sellPrice, buyPrice, isChinaOrigin: china,
    ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
    vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
  });

  let entries: Array<{ skuId: string; attrs?: Record<string, string>; price: number; ebayPrice?: number }> = [];
  try { entries = p.variantPrices ? JSON.parse(p.variantPrices) : []; } catch { entries = []; }
  const isVariant = entries.length > 1;
  const rows: ProfitRow[] = [];
  if (isVariant) {
    const stored = parseVariantSellPrices(p.variantSellPrices);
    for (const v of entries) {
      if (typeof v.price !== 'number' || v.price <= 0) continue;
      const sell = resolveVariantSellPrice(v.skuId, stored, v).sellPrice ?? p.sellPrice;
      if (sell == null) continue;
      const label = Object.values(v.attrs ?? {}).join(' / ') || `…${v.skuId.slice(-6)}`;
      rows.push({ label, profit: profitAt(sell, v.price) });
    }
  } else if (p.sellPrice && p.buyPrice) {
    rows.push({ label: '', profit: profitAt(p.sellPrice, p.buyPrice) });
  }
  return { rows, isVariant };
}

export interface TierChangePreview {
  total: number;          // Produkte in der Auswahl
  red: number;            // davon: schlechtester Gewinn liegt nach dem Wechsel unter dem Boden der neuen Stufe
  redSingle: number;      // davon Einzelartikel → die automatische Preisprüfung hebt sie beim nächsten Lauf an
  redVariant: number;     // davon Varianten-Produkte → nur markiert, die Automatik hebt sie NICHT an
  yellow: number;         // unter dem Ziel, aber über dem Boden
  unknown: number;        // nicht berechenbar (kein VK/EK) — weder rot noch gelb
  redIds: number[];
}

// Vorschau für den Bestätigungsdialog "N Listings → Stufe X. Davon rot nach Wechsel: M". Rechnet nichts selbst:
// Gewinn aus productProfitRows (Formel v2), Bewertung aus evaluateTargetDisplay/profitFloorFor (shared/pricing.ts).
export function previewTierChange(products: ProfitProduct[], newTargetEur: number): TierChangePreview {
  const out: TierChangePreview = { total: products.length, red: 0, redSingle: 0, redVariant: 0, yellow: 0, unknown: 0, redIds: [] };
  for (const p of products) {
    const { rows, isVariant } = productProfitRows(p);
    if (rows.length === 0) { out.unknown++; continue; }
    const level = evaluateTargetDisplay(newTargetEur, Math.min(...rows.map(r => r.profit))).level;
    if (level === 'red') {
      out.red++; out.redIds.push(p.id);
      if (isVariant) out.redVariant++; else out.redSingle++;
    } else if (level === 'yellow') out.yellow++;
  }
  return out;
}

export const BULK_TARGET_MARGIN_MAX = 200;

export type BulkTargetMarginParse =
  | { ok: true; productIds: number[]; targetMarginEur: number }
  | { ok: false; error: string };

// Validierung des Sammel-Endpunkts PATCH /products/target-margin. Nur die Stufen A–D (MARGIN_TIERS; die ausgeblendete 4,50
// ist NICHT wählbar), ausdrückliche Bestätigung (confirm === true), begrenzte Anzahl, nur ganze positive IDs, keine Dubletten.
export function parseBulkTargetMarginBody(body: unknown): BulkTargetMarginParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body fehlt' };
  const b = body as Record<string, unknown>;
  if (b.confirm !== true) return { ok: false, error: '"confirm": true fehlt — Stufenwechsel für mehrere Produkte nur nach Bestätigung' };
  const t = b.targetMarginEur;
  if (typeof t !== 'number' || !MARGIN_TIERS.some(x => Math.abs(x.targetEur - t) < 0.005)) {
    return { ok: false, error: '"targetMarginEur" muss eine Margen-Stufe sein (1,00 / 1,50 / 2,00 / 3,00)' };
  }
  const ids = b.productIds;
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: '"productIds" muss eine nicht-leere Liste sein' };
  if (ids.length > BULK_TARGET_MARGIN_MAX) return { ok: false, error: `Höchstens ${BULK_TARGET_MARGIN_MAX} Produkte je Aufruf (übergeben: ${ids.length})` };
  if (!ids.every(i => typeof i === 'number' && Number.isInteger(i) && i > 0)) return { ok: false, error: '"productIds" darf nur positive ganze Zahlen enthalten' };
  return { ok: true, productIds: [...new Set(ids as number[])], targetMarginEur: t };
}

// Filter "Neu eingestellt": Die eBay-Anzeige trägt StartTime (Listings-API). days = 0 → heute (lokaler Kalendertag), sonst
// "innerhalb der letzten N Tage" (N × 24 h). Ungültiges/leeres Datum → false (nicht geraten).
export function isListedWithin(startTimeIso: string | null | undefined, days: number, now: Date = new Date()): boolean {
  if (!startTimeIso) return false;
  const t = new Date(startTimeIso);
  if (isNaN(t.getTime())) return false;
  if (t.getTime() > now.getTime() + 60_000) return false; // Zukunftsdatum = kein "bereits eingestellt"
  if (days <= 0) {
    return t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth() && t.getDate() === now.getDate();
  }
  return now.getTime() - t.getTime() <= days * 24 * 60 * 60 * 1000;
}

export function startTimeMillis(startTimeIso: string | null | undefined): number {
  if (!startTimeIso) return -Infinity;
  const t = new Date(startTimeIso).getTime();
  return isNaN(t) ? -Infinity : t;
}
