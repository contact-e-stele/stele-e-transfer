// OFFEN 007 (19.10.2026): Packmenge je Angebot (2er-/3er-Packs). EINE Rechenstelle (Grundgesetz 8):
// Ein Angebot = N Stück vom AliExpress-Artikel. Im variantPrices-Eintrag stehen dann:
//   unitPrice / unitStock = AliExpress-Werte je Stück (so wie gescrapt)
//   price = unitPrice × N (Ware je Angebot) — Versand und Einfuhr rechnet computeAliCosts darauf nur EINMAL je Bestellung,
//           also NICHT 2 × Einzelpreis inkl. Nebenkosten (ANTWORT 005 Punkt 4)
//   stock = ⌊unitStock ÷ N⌋ (so viele Angebote kann man bedienen)
// Alle bisherigen Leser von entry.price / entry.stock (Gewinn, Preis-Lauf, Stufen, Mengen-Lauf, Listen) bekommen dadurch
// automatisch die Pack-Werte — nur die SCHREIBER (Preis-Lauf, Bestand-Aktualisierung, Import-Tab) gehen durch diese Datei.
// N = 1 (Standard, auch fehlend/ungültig) → Verhalten exakt wie bisher.

export const MAX_PACK_QTY = 20;

export function normalizePackQty(n: unknown): number {
  const v = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : NaN;
  return Number.isInteger(v) && v >= 1 && v <= MAX_PACK_QTY ? v : 1;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export interface PackFields { price?: number; stock?: number; packQty?: number; unitPrice?: number; unitStock?: number }

/** Neue AliExpress-Werte je Stück in einen Eintrag schreiben (Preis-Lauf, Bestand-Aktualisierung). undefined = Wert bleibt. */
export function applyAliUnitValues<T extends PackFields>(e: T, unitPrice: number | undefined, unitStock: number | undefined): T {
  const q = normalizePackQty(e.packQty);
  if (q === 1) {
    return { ...e, ...(typeof unitPrice === 'number' ? { price: unitPrice } : {}), ...(typeof unitStock === 'number' ? { stock: unitStock } : {}) };
  }
  const out: T = { ...e, packQty: q };
  if (typeof unitPrice === 'number') { out.unitPrice = unitPrice; out.price = round2(unitPrice * q); }
  if (typeof unitStock === 'number') { out.unitStock = unitStock; out.stock = Math.floor(unitStock / q); }
  return out;
}

/** Packmenge setzen/ändern (Import-Tab). Ausgangswerte je Stück: unitPrice/unitStock, sonst die bisherigen price/stock (N war 1). */
export function setPackQty<T extends PackFields>(e: T, n: unknown): T {
  const q = normalizePackQty(n);
  const oldQ = normalizePackQty(e.packQty);
  const unitPrice = typeof e.unitPrice === 'number' ? e.unitPrice : (oldQ === 1 ? e.price : undefined);
  const unitStock = typeof e.unitStock === 'number' ? e.unitStock : (oldQ === 1 ? e.stock : undefined);
  if (q === 1) {
    const { packQty: _p, unitPrice: _u, unitStock: _s, ...rest } = e;
    return { ...rest, ...(typeof unitPrice === 'number' ? { price: unitPrice } : {}), ...(typeof unitStock === 'number' ? { stock: unitStock } : {}) } as T;
  }
  return applyAliUnitValues({ ...e, packQty: q }, unitPrice, unitStock);
}

/** Wie viele Stück bei AliExpress bestellen: eBay-Menge × Packmenge. */
export function aliOrderQuantity(ebayQty: number, packQty: unknown): number {
  return ebayQty * normalizePackQty(packQty);
}
