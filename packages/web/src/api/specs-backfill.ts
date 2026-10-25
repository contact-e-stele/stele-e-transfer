// Punkt C (Inhaber 25.10.2026): AliExpress-Merkmale für bestehende Produkte nachladen. Schreibt AUSSCHLIESSLICH products.specs und
// nur dort, wo es bisher leer ist (nie überschreiben). Kein eBay, kein Preis, keine Menge. Standard = Trockenlauf.
// Live-Angebote bekommen die Merkmale erst in einem eigenen Schritt auf Knopfdruck (C2).

export const SPECS_BACKFILL_MAX_PER_CALL = 20; // je ds.product.get ca. 1–3 s → unter dem Render-Zeitlimit bleiben

export interface SpecsBackfillProduct { id: number; sourceUrl: string | null; specs: string | null; ebayListingId?: string | null }
export interface SpecsBackfillDeps {
  listProducts: () => Promise<SpecsBackfillProduct[]>;
  fetchSpecs: (aliProductId: string) => Promise<Record<string, string> | null>; // null = AliExpress nicht erreichbar/kein Produkt
  saveSpecs: (productId: number, specsJson: string) => Promise<void>;
  pause?: (ms: number) => Promise<void>;
}
export interface SpecsBackfillRow { productId: number; aliProductId: string | null; status: 'gefunden' | 'leer' | 'fehler' | 'keine-ali-id' | 'gespeichert'; count: number; specs?: Record<string, string>; error?: string }

export function aliIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/item\/(\d+)\.html/) || url.match(/[?&]id=(\d+)/);
  return m?.[1] ?? null;
}

export function hasSpecs(json: string | null | undefined): boolean {
  if (!json) return false;
  try { const o = JSON.parse(json); return !!o && typeof o === 'object' && Object.keys(o).length > 0; } catch { return false; }
}

/** Welche Produkte brauchen Merkmale? Ohne productIds: nur gelistete Produkte, älteste Nummer zuerst. */
export function selectForBackfill(products: SpecsBackfillProduct[], productIds?: number[]): SpecsBackfillProduct[] {
  const wanted = productIds && productIds.length > 0 ? new Set(productIds) : null;
  return products
    .filter(p => (wanted ? wanted.has(p.id) : !!p.ebayListingId) && !hasSpecs(p.specs))
    .sort((a, b) => a.id - b.id);
}

export async function runSpecsBackfill(opts: { apply?: boolean; productIds?: number[]; limit?: number }, deps: SpecsBackfillDeps) {
  const all = selectForBackfill(await deps.listProducts(), opts.productIds);
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? SPECS_BACKFILL_MAX_PER_CALL)), SPECS_BACKFILL_MAX_PER_CALL);
  const batch = all.slice(0, limit);
  const rows: SpecsBackfillRow[] = [];
  for (const [i, p] of batch.entries()) {
    if (i > 0) await (deps.pause ?? (ms => new Promise(r => setTimeout(r, ms))))(300);
    const aliId = aliIdFromUrl(p.sourceUrl);
    if (!aliId) { rows.push({ productId: p.id, aliProductId: null, status: 'keine-ali-id', count: 0 }); continue; }
    try {
      const specs = await deps.fetchSpecs(aliId);
      if (specs === null) { rows.push({ productId: p.id, aliProductId: aliId, status: 'fehler', count: 0, error: 'AliExpress lieferte kein Produkt' }); continue; }
      const count = Object.keys(specs).length;
      if (count === 0) { rows.push({ productId: p.id, aliProductId: aliId, status: 'leer', count: 0 }); continue; }
      if (opts.apply === true) {
        await deps.saveSpecs(p.id, JSON.stringify(specs));
        rows.push({ productId: p.id, aliProductId: aliId, status: 'gespeichert', count, specs });
      } else {
        rows.push({ productId: p.id, aliProductId: aliId, status: 'gefunden', count, specs });
      }
    } catch (e) {
      rows.push({ productId: p.id, aliProductId: aliId, status: 'fehler', count: 0, error: String(e).slice(0, 300) });
    }
  }
  return { dryRun: opts.apply !== true, offenGesamt: all.length, bearbeitet: batch.length, rest: all.length - batch.length, rows };
}
