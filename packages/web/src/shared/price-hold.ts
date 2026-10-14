// K-008 (Kalkulator, Inhaber 14.10.2026 21:14): "Preis halten" je Variante (bzw. Einzelartikel).
// Anlass: stele-220 GRAY bei 19,95 HALTEN — Formel: Ware 11,47 + 3,57, adRate 0, Stufe A → Gewinn 0,99 € < Boden 1,00 €; die Preisprüfung
// würde sonst auf 20,45 anheben.
// Regeln:
//  - Gehalten + Gewinn beim gehaltenen Preis ≥ 0,90 € → Preisprüfung/Alarm heben NICHT an; Anzeige "gehalten – Gewinn x,xx €".
//  - Gewinn < 0,90 € (z. B. Ali teurer) → Sicherheitsnetz: anheben wie bisher, "Preis halten" automatisch aufheben, Hinweis an den Inhaber.
//  - Gilt nur, solange der heutige VK der Variante dem gehaltenen Preis entspricht (± 0,005 €). Wurde der Preis inzwischen geändert,
//    ist das Halten "veraltet" und wirkt nicht (nichts geraten).
// REINE Funktionen (Grundgesetz 2/8). Gewinn kommt aus productProfitRows (dieselbe Formel wie "Erwartet" in Listings/Produkte).
import { productProfitRows, type ProfitProduct } from './target-margin-bulk';

export const PRICE_HOLD_MIN_PROFIT_EUR = 0.90;
export const PRICE_HOLDS_SETTING_KEY = 'price_holds';
export const PRICE_HOLD_NOTICES_SETTING_KEY = 'price_hold_notices';
export const SINGLE_ITEM_HOLD_KEY = '_'; // Einzelartikel (ohne Varianten)

export interface PriceHold { sellPrice: number; at: string; note?: string | null }
export type ProductHolds = Record<string, PriceHold>;           // skuId (oder '_') → Halten
export type PriceHolds = Record<string, ProductHolds>;          // productId → Halten je Variante

export interface PriceHoldNotice { productId: number; key: string; label: string; heldPrice: number; profit: number; at: string; text: string }

export function parsePriceHolds(json: string | null | undefined): PriceHolds {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: PriceHolds = {};
    for (const [pid, holds] of Object.entries(raw as Record<string, unknown>)) {
      if (!holds || typeof holds !== 'object' || Array.isArray(holds)) continue;
      const ph: ProductHolds = {};
      for (const [key, h] of Object.entries(holds as Record<string, unknown>)) {
        const x = h as Partial<PriceHold>;
        if (typeof x?.sellPrice === 'number' && Number.isFinite(x.sellPrice) && x.sellPrice > 0 && typeof x.at === 'string') {
          ph[key] = { sellPrice: x.sellPrice, at: x.at, note: typeof x.note === 'string' ? x.note : null };
        }
      }
      if (Object.keys(ph).length > 0) out[pid] = ph;
    }
    return out;
  } catch { return {}; }
}

export function parsePriceHoldNotices(json: string | null | undefined): PriceHoldNotice[] {
  if (!json) return [];
  try { const a = JSON.parse(json) as unknown; return Array.isArray(a) ? a as PriceHoldNotice[] : []; } catch { return []; }
}

export type HoldState = 'held' | 'release' | 'stale';
export interface HoldRow { key: string; label: string; state: HoldState; heldPrice: number; currentSell: number | null; profit: number | null; at: string; note: string | null }
export interface HoldResolution {
  rows: HoldRow[];
  heldKeys: Set<string>;     // wirken: kein Anheben, kein Alarm für diese Varianten
  releaseKeys: string[];     // Gewinn < 0,90 → anheben wie bisher, Halten aufheben, Hinweis
  allHeld: boolean;          // jede Zeile mit Gewinn ist gehalten (Einzelartikel: der Artikel selbst)
}

/** Wertet das Halten eines Produkts gegen den heutigen VK und Gewinn je Variante aus. */
export function resolvePriceHolds(product: ProfitProduct, holds: ProductHolds | undefined): HoldResolution {
  const empty: HoldResolution = { rows: [], heldKeys: new Set(), releaseKeys: [], allHeld: false };
  if (!holds || Object.keys(holds).length === 0) return empty;
  const { rows: profitRows, isVariant } = productProfitRows(product);
  const rows: HoldRow[] = [];
  const heldKeys = new Set<string>();
  const releaseKeys: string[] = [];
  for (const [key, h] of Object.entries(holds)) {
    const pr = isVariant ? profitRows.find(r => r.skuId === key) : (key === SINGLE_ITEM_HOLD_KEY ? profitRows[0] : undefined);
    const currentSell = pr?.sellPrice ?? null;
    const profit = pr?.profit ?? null;
    const base = { key, label: pr?.label ?? key, heldPrice: h.sellPrice, currentSell, profit, at: h.at, note: h.note ?? null };
    if (pr == null || currentSell == null || profit == null || Math.abs(currentSell - h.sellPrice) > 0.005) { rows.push({ ...base, state: 'stale' }); continue; }
    if (profit >= PRICE_HOLD_MIN_PROFIT_EUR - 1e-9) { heldKeys.add(key); rows.push({ ...base, state: 'held' }); }
    else { releaseKeys.push(key); rows.push({ ...base, state: 'release' }); }
  }
  const keyOf = (r: { skuId?: string }) => (isVariant ? r.skuId ?? '' : SINGLE_ITEM_HOLD_KEY);
  const allHeld = profitRows.length > 0 && profitRows.every(r => heldKeys.has(keyOf(r)));
  return { rows, heldKeys, releaseKeys, allHeld };
}

export function releaseNoticeText(productId: number, r: HoldRow): string {
  return `stele-${productId} ${r.label || r.key}: "Preis halten" aufgehoben — Gewinn bei ${r.heldPrice.toFixed(2)} € nur noch ${(r.profit ?? 0).toFixed(2)} € (< ${PRICE_HOLD_MIN_PROFIT_EUR.toFixed(2)} €), Preis wird wie bisher angehoben.`;
}
