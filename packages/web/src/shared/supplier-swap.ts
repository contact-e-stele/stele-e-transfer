// 050 P2 (Anlass stele-251, stele-224 TIEFBLAU): Lieferant eines bestehenden Produkts tauschen.
// Das eBay-Angebot bleibt (gleiche Item-ID, gleiche eBay-SKUs): Die eBay-SKU entsteht aus displayValues der Varianten-Einträge
// (variant-resolver comboSku). Deshalb übernimmt jeder neue Eintrag die displayValues (und ebayPrice) des alten Eintrags.
// Geändert werden nur Einkaufsseite und Bestand: skuId/attrs/EK/Lager/Bild aus dem neuen AliExpress-Angebot.
// Varianten ohne Gegenstück bleiben mit Lager 0 stehen (Mengen-Lauf setzt eBay auf 0), Verkaufspreise wandern auf die neue skuId.
// REINE Funktionen (Grundgesetz 2/8); Gewinn aus productProfitRows (dieselbe Rechnung wie „Erwartet“).
import { productProfitRows, type ProfitProduct } from './target-margin-bulk';

export interface SwapEntry {
  skuId: string;
  attrs?: Record<string, string>;
  price: number;
  stock?: number;
  imageUrl?: string;
  displayValues?: Record<string, string>;
  ebayPrice?: number;
  [k: string]: unknown;
}

/** Nicht-Varianten-Merkmale, die beim Abgleich nicht zählen (wie variant-resolver). */
const IGNORE_ATTRS = new Set(['ships from', 'ships_from', 'versandland']);

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function attrKey(attrs: Record<string, string> | undefined): string {
  return Object.entries(attrs ?? {})
    .filter(([k]) => !IGNORE_ATTRS.has(k.trim().toLowerCase()))
    .map(([, v]) => norm(String(v)))
    .sort()
    .join('|');
}

export function parseEntries(json: string | null | undefined): SwapEntry[] {
  try {
    const a = json ? JSON.parse(json) : [];
    return Array.isArray(a) ? a.filter((e): e is SwapEntry => e && typeof e.skuId === 'string' && typeof e.price === 'number') : [];
  } catch { return []; }
}

export function entryLabel(e: SwapEntry): string {
  const dv = Object.values(e.displayValues ?? {}).filter(Boolean);
  if (dv.length) return dv.join(' / ');
  const a = Object.entries(e.attrs ?? {}).filter(([k]) => !IGNORE_ATTRS.has(k.trim().toLowerCase())).map(([, v]) => v);
  return a.join(' / ') || `…${e.skuId.slice(-6)}`;
}

/** Vorschlag alt → neu: nur bei eindeutig gleichen Merkmalswerten (ohne Versandland, Groß/Klein egal). Sonst null – nichts geraten. */
export function suggestMapping(oldEntries: readonly SwapEntry[], newEntries: readonly SwapEntry[]): Record<string, string | null> {
  const byKey = new Map<string, string[]>();
  for (const n of newEntries) {
    const k = attrKey(n.attrs);
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), n.skuId]);
  }
  const out: Record<string, string | null> = {};
  for (const o of oldEntries) {
    const hits = byKey.get(attrKey(o.attrs)) ?? [];
    out[o.skuId] = hits.length === 1 ? hits[0] : null;
  }
  return out;
}

export interface SwapRow {
  oldSkuId: string;
  newSkuId: string | null;
  label: string;
  ekAlt: number;
  ekNeu: number | null;
  lagerNeu: number;
  vk: number | null;
  gewinnAlt: number | null;
  gewinnNeu: number | null;
}

export interface SwapPlan {
  ok: boolean;
  errors: string[];
  rows: SwapRow[];
  variantPrices: string;
  variantSellPrices: string | null;
  /** alte skuId → neue skuId (für „Preis halten“ u. Ä.). */
  rekey: Record<string, string>;
}

export interface NewOffer {
  itemId: string;
  variantPrices: SwapEntry[];
  shipsFrom?: string | null;
}

/**
 * Plant den Tausch. mapping: alte skuId → neue skuId (null = kein Gegenstück → Lager 0).
 * Fehler (ok=false): neue skuId unbekannt, eine neue skuId mehrfach vergeben, keine einzige Zuordnung.
 */
export function planSupplierSwap(
  product: ProfitProduct & { variantPrices?: string | null; variantSellPrices?: string | null },
  offer: NewOffer,
  mapping: Readonly<Record<string, string | null>>,
): SwapPlan {
  const errors: string[] = [];
  const oldEntries = parseEntries(product.variantPrices);
  const newBySku = new Map(offer.variantPrices.map(n => [n.skuId, n]));
  const used = new Map<string, string>();
  for (const o of oldEntries) {
    const t = mapping[o.skuId];
    if (t == null) continue;
    if (!newBySku.has(t)) errors.push(`${entryLabel(o)}: neue Variante ${t} gibt es im Angebot ${offer.itemId} nicht`);
    else if (used.has(t)) errors.push(`${entryLabel(o)}: neue Variante ${t} ist schon „${used.get(t)}“ zugeordnet`);
    else used.set(t, entryLabel(o));
  }
  if (oldEntries.length > 0 && used.size === 0) errors.push('Keine einzige Variante zugeordnet — nichts zu tauschen');

  let sell: Record<string, number> = {};
  try { sell = product.variantSellPrices ? JSON.parse(product.variantSellPrices) as Record<string, number> : {}; } catch { sell = {}; }

  const rekey: Record<string, string> = {};
  const newEntries: SwapEntry[] = oldEntries.map(o => {
    const t = mapping[o.skuId];
    const n = t != null ? newBySku.get(t) : undefined;
    if (!n) return { ...o, stock: 0, supplierMissing: true };
    rekey[o.skuId] = n.skuId;
    return {
      ...o,
      skuId: n.skuId,
      attrs: n.attrs,
      price: n.price,
      stock: typeof n.stock === 'number' ? n.stock : 0,
      ...(n.imageUrl ? { imageUrl: n.imageUrl } : {}),
      supplierMissing: undefined,
    };
  });
  const newSell: Record<string, number> = {};
  for (const [k, v] of Object.entries(sell)) newSell[rekey[k] ?? k] = v;

  const variantPrices = JSON.stringify(newEntries.map(e => { const c = { ...e }; if (c.supplierMissing === undefined) delete c.supplierMissing; return c; }));
  const variantSellPrices = Object.keys(newSell).length ? JSON.stringify(newSell) : (product.variantSellPrices ?? null);

  // Gewinn vorher/nachher je Variante. Nachher ohne Kassen-Faktor: der gilt nur für den alten Lieferanten.
  const before = new Map(productProfitRows(product).rows.filter(r => r.skuId).map(r => [r.skuId as string, r]));
  const after = new Map(productProfitRows({ ...product, variantPrices, variantSellPrices, aliCheckoutFactor: null, aliCheckoutFactorAt: null }).rows
    .filter(r => r.skuId).map(r => [r.skuId as string, r]));

  const rows: SwapRow[] = oldEntries.map(o => {
    const t = rekey[o.skuId] ?? null;
    const n = t ? newBySku.get(t) : undefined;
    const b = before.get(o.skuId);
    const a = after.get(t ?? o.skuId);
    return {
      oldSkuId: o.skuId,
      newSkuId: t,
      label: entryLabel(o),
      ekAlt: o.price,
      ekNeu: n ? n.price : null,
      lagerNeu: n ? (typeof n.stock === 'number' ? n.stock : 0) : 0,
      vk: b?.sellPrice ?? a?.sellPrice ?? null,
      gewinnAlt: b ? b.profit : null,
      gewinnNeu: t && a ? a.profit : null,
    };
  });

  return { ok: errors.length === 0, errors, rows, variantPrices, variantSellPrices, rekey };
}

/** AliExpress-Artikelnummer aus Eingabe (Nummer oder Link). */
export function parseAliItemId(input: string): string | null {
  const t = input.trim();
  const m = t.match(/\/item\/(\d{8,})\.html/) ?? t.match(/[?&]id=(\d{8,})/) ?? t.match(/^(\d{8,})$/);
  return m ? m[1] : null;
}

/** Gleiches Versandland? Unterschiedliche Herkunft ändert Standort/Einfuhr — dann nicht hier tauschen. */
export function sameOrigin(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => (s ?? '').trim().toLowerCase() || 'china';
  return n(a) === n(b);
}
